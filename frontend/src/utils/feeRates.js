/**
 * What the wallet charges - the rules, in one place. Pure; no React, no network (tests/feeRates.test.js).
 *
 *   IcanEra account -> IcanEra account   free
 *   IcanEra coin -> anyone               free
 *   wallet money -> a mobile-money number / a bank account / cashing out      the rates below
 *   IcanEra coin sold for money (cash-out, conversion, payouts)               coin_cash_out
 *
 * The RATES themselves are not here: they live in the database table public.ican_fee_rates, which the server charges from and
 * this app only reads to show the fee before you pay. A developer changes one with
 *     UPDATE public.ican_fee_rates SET rate = 0.02 WHERE key = 'send_mobile_money';
 * No code change, no redeploy (the app picks it up within a minute). See supabase/migrations/20261106100000_fee_rates.sql.
 *
 * A fee is TAKEN OUT of the amount: send UGX 10,000 at 3% and the wallet is debited 10,000 while the recipient receives 9,700.
 * feeFor() below is the same maths as backend/components/supabase/functions/_shared/fees.js (what the server really charges);
 * a test runs both over the same cases so they cannot drift apart.
 */

/** What the server charges when a rate row is missing - the same 3% as public.ican_fee_rate(). */
export const DEFAULT_FEE_RATE = 0.03;

export const FEE_KEYS = Object.freeze({
  SEND_MOBILE: 'send_mobile_money',
  SEND_BANK: 'send_bank',
  WITHDRAW_WALLET: 'withdraw_wallet',
  COIN_CASH_OUT: 'coin_cash_out',
});

/** Nothing read yet (or the read failed): show the default rather than hide a fee. */
export const UNLOADED_FEE_RATES = Object.freeze({ rates: Object.freeze({}), deployed: true, loaded: false });

/** A usable rate: a fraction from 0 up to (not including) 1 - the same rule the table enforces. */
export function isValidFeeRate(rate) {
  const n = Number(rate);
  return rate !== null && rate !== undefined && rate !== '' && Number.isFinite(n) && n >= 0 && n < 1;
}

/**
 * The fee on `amount` in whole shillings, rounded UP so it is never under-collected; 0 for no rate or amount.
 * (The 1e-9 absorbs float noise: 10000 * 0.03 is 300.00000000000006, which must be 300, not 301.)
 */
export function feeFor(amount, rate) {
  const a = Number(amount);
  const r = Number(rate);
  if (!(a > 0) || !(r > 0)) return 0;
  return Math.ceil(a * r - 1e-9);
}

/**
 * Which rate the server applies to wallet money leaving the app. It decides from what it can verify, never from what the app
 * claims: a bank account is always send_bank (it cannot be proven to be yours), your own registered number is withdraw_wallet,
 * any other number is send_mobile_money.
 */
export function feeRateKey({ isBank, toOwnNumber }) {
  if (isBank) return FEE_KEYS.SEND_BANK;
  return toOwnNumber ? FEE_KEYS.WITHDRAW_WALLET : FEE_KEYS.SEND_MOBILE;
}

/** Rows from ican_fee_rates ([{key, rate}]) -> { key: number }, keeping only valid rates. */
export function normalizeFeeRates(rows) {
  const out = {};
  for (const row of rows || []) {
    if (row && typeof row.key === 'string' && isValidFeeRate(row.rate)) out[row.key] = Number(row.rate);
  }
  return out;
}

/**
 * The rate to SHOW for `key`, given what was read ({ rates, deployed, loaded }).
 *   - the fee table does not exist yet (the SQL has not been run): nothing is charged on wallet-money sends, but coin
 *     cash-outs still pay the 3% that was typed into the database functions before the table existed
 *   - read fine, row present:  that rate
 *   - read fine, row missing, or not read at all: the default 3% (what the server falls back to) - never "free"
 */
export function rateFor(state, key) {
  const s = state || UNLOADED_FEE_RATES;
  if (s.deployed === false) return key === FEE_KEYS.COIN_CASH_OUT ? DEFAULT_FEE_RATE : 0;
  const rate = s.rates?.[key];
  return isValidFeeRate(rate) ? Number(rate) : DEFAULT_FEE_RATE;
}

/** What a transfer of `amount` at `rate` costs and delivers. */
export function quoteTransfer({ amount, rate }) {
  const gross = Number(amount) > 0 ? Number(amount) : 0;
  const fee = feeFor(gross, rate);
  return { rate: Number(rate) || 0, gross, fee, net: gross - fee };
}

/** "3%", "1.25%", "no fee" */
export function describeRate(rate) {
  const r = Number(rate);
  return r > 0 ? `${Number((r * 100).toFixed(4))}%` : 'no fee';
}
