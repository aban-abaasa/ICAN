/**
 * Pure helpers for the IcanEra wallet's Send and Withdraw flows: who a payment
 * is going to, which server call moves the money, and which balance a cash-out
 * should come from. No network, no React — everything here is unit tested
 * (tests/walletRouting.test.js).
 *
 * Account numbers are 16 digits and the first digit says what the number is:
 *   1 = personal fiat account (user_accounts, account_type 'personal')
 *   2 = business fiat account (user_accounts, account_type 'business')
 *   3 = a PitchIn business's IcanEra coin wallet (ican_business_wallets)
 * No phone number in this app is 16 digits, so length alone tells a number
 * from a phone.
 */

import { feeFor, isValidFeeRate } from './feeRates.js';

export const BUSINESS_WALLET_ADDRESS_RE = /^3\d{15}$/;

/**
 * What did the sender type? Spaces and dashes inside a pasted account number
 * ("1234 5678 9012 3456") are ignored.
 * @returns {{kind: 'empty'|'business_wallet'|'account'|'email'|'phone', value: string, accountType?: 'personal'|'business'}}
 */
export function classifyRecipient(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return { kind: 'empty', value: '' };

  const compact = value.replace(/[\s-]/g, '');
  if (BUSINESS_WALLET_ADDRESS_RE.test(compact)) return { kind: 'business_wallet', value: compact };
  if (/^\d{16}$/.test(compact)) {
    return { kind: 'account', value: compact, accountType: compact[0] === '2' ? 'business' : 'personal' };
  }
  if (value.includes('@')) return { kind: 'email', value: value.toLowerCase() };
  return { kind: 'phone', value };
}

/**
 * Every way the same phone number may be stored ("0701234567", "256701234567",
 * "+256701234567", "701234567"). The national-number expansion only runs when
 * the caller says which country calling code to assume — a bare "07…" number
 * is ambiguous between countries, so we never guess a country for the sender.
 * @param {string} raw
 * @param {{countryCallingCode?: string}} [opts] e.g. '256' for Uganda
 * @returns {string[]}
 */
export function phoneLookupVariants(raw, { countryCallingCode = null } = {}) {
  const trimmed = String(raw ?? '').trim();
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return [];

  const out = new Set([trimmed, digits, `+${digits}`]);
  if (countryCallingCode) {
    const cc = String(countryCallingCode).replace(/\D/g, '');
    let national = null;
    if (digits.startsWith(cc) && digits.length > cc.length + 6) national = digits.slice(cc.length);
    else if (digits.startsWith('0') && digits.length >= 10) national = digits.slice(1);
    else if (digits.length === 9) national = digits;
    if (national) {
      out.add(national);
      out.add(`0${national}`);
      out.add(`${cc}${national}`);
      out.add(`+${cc}${national}`);
    }
  }
  return [...out];
}

const accountTypeOf = (row) => (row?.account_type === 'business' || row?.business_id ? 'business' : 'personal');

/**
 * A phone number or email can match several user_accounts rows — a person who
 * also runs a business has a personal and a business account that share both.
 * `.maybeSingle()` errors on that, which made those people impossible to pay.
 * Pick the one the sender meant (personal unless told otherwise) and report the
 * rest so the UI can say which account it resolved.
 * @param {Array<object>} rows user_accounts rows
 * @param {{prefer?: 'personal'|'business'}} [opts]
 */
export function pickRecipientAccount(rows, { prefer = 'personal' } = {}) {
  const list = (rows || []).filter(Boolean);
  if (!list.length) return { account: null, accountType: null, alternatives: [] };
  const account = list.find((r) => accountTypeOf(r) === prefer) || list[0];
  return {
    account,
    accountType: accountTypeOf(account),
    alternatives: list.filter((r) => r !== account),
  };
}

/**
 * Which server call moves IcanEra coin between two wallets? A wallet is
 * { type: 'personal', userId } or { type: 'business', businessProfileId }.
 *
 * A business paying its owner's personal wallet (and an owner funding their own
 * business) is allowed on purpose: it's how an owner takes money out of, or puts
 * money into, the business. Only "the very same wallet" is refused.
 *
 * @returns {{route: 'user_to_user'|'user_to_business'|'business_to_user'|'business_to_business'|null, error?: string}}
 */
export function planCoinTransfer({ from, to }) {
  if (!from || !to) return { route: null, error: 'Choose where the money is coming from and going to.' };

  if (from.type === 'personal' && to.type === 'personal') {
    if (from.userId && from.userId === to.userId) return { route: null, error: 'Cannot send IcanEra to yourself' };
    return { route: 'user_to_user' };
  }
  if (from.type === 'personal' && to.type === 'business') return { route: 'user_to_business' };
  if (from.type === 'business' && to.type === 'personal') return { route: 'business_to_user' };
  if (from.type === 'business' && to.type === 'business') {
    if (from.businessProfileId && from.businessProfileId === to.businessProfileId) {
      return { route: null, error: 'A business cannot send to its own wallet' };
    }
    return { route: 'business_to_business' };
  }
  return { route: null, error: 'Unsupported transfer.' };
}

// ─── Withdraw ───────────────────────────────────────────────────────────────

/**
 * The fee on selling IcanEra coin for money (cash-out, payouts, conversions): 3% unless a developer has changed
 * coin_cash_out in public.ican_fee_rates. A live binding: services/feeRatesService.js updates it once the table has been read,
 * and every importer - including the `feeRate = COIN_PAYOUT_FEE_RATE` defaults below, which are read at call time - follows.
 * Until then it is the 3% the database functions used before the table existed.
 */
export let COIN_PAYOUT_FEE_RATE = 0.03;

/** Follow the coin_cash_out rate. Anything that is not a usable rate (0 up to, not including, 1) is ignored. */
export function setCoinPayoutFeeRate(rate) {
  if (isValidFeeRate(rate)) COIN_PAYOUT_FEE_RATE = Number(rate);
}

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const floor8 = (n) => Math.floor(n * 1e8 + 1e-6) / 1e8;

/**
 * What a withdrawal of `amountUgx` costs and pays, per balance it can come from.
 * - 'fiat': the wallet balance → mobile money / bank. `fiatFeeRate` is the fee, TAKEN OUT of the
 *   amount (you withdraw 10,000 at 3%: 300 fee, 9,700 lands) - what flutterwave-momo-send charges.
 * - 'coin': IcanEra coin sold at `rate` UGX per coin, minus the payout fee —
 *   mirrors sell_ican_coins() (gross = coins × rate, fee = gross × the coin_cash_out rate, both
 *   rounded to 2 dp) so the preview matches what the server pays.
 * @returns {{icanDebit: number, gross: number, fee: number, net: number}}
 */
export function quoteWithdrawal({ amountUgx, source, rate, feeRate = COIN_PAYOUT_FEE_RATE, fiatFeeRate = 0 }) {
  const amount = Number(amountUgx);
  if (!(amount > 0)) return { icanDebit: 0, gross: 0, fee: 0, net: 0 };
  if (source === 'coin') {
    const icanDebit = floor8(amount / rate);
    const gross = round2(icanDebit * rate);
    const fee = round2(gross * feeRate);
    return { icanDebit, gross, fee, net: round2(gross - fee) };
  }
  const gross = round2(amount);
  const fee = feeFor(gross, fiatFeeRate);
  return { icanDebit: 0, gross, fee, net: round2(gross - fee) };
}

/**
 * Pick the balance a cash-out should come from: the one that pays it with the lower fee rate
 * (the wallet balance on a tie). If only one balance covers the amount, that one. Otherwise
 * there's a shortfall. A cash-out never silently splits across two balances.
 * `feeRate` is the coin cash-out rate, `fiatFeeRate` the wallet-money one.
 * @returns {{source: 'fiat'|'coin'|null, reason?: string, shortfall?: number, maxUgx: number}}
 */
export function planWithdrawalSource({ amountUgx, fiatUgx = 0, coinIcan = 0, rate, feeRate = COIN_PAYOUT_FEE_RATE, fiatFeeRate = 0 }) {
  const fiat = Math.max(0, Number(fiatUgx) || 0);
  const coinUgx = Math.max(0, (Number(coinIcan) || 0) * rate);
  const maxUgx = Math.max(fiat, coinUgx);
  const amount = Number(amountUgx);

  if (!(amount > 0)) return { source: null, reason: 'Enter an amount', maxUgx };
  if (fiat >= amount && coinUgx >= amount) return { source: feeRate < fiatFeeRate ? 'coin' : 'fiat', maxUgx };
  if (fiat >= amount) return { source: 'fiat', maxUgx };
  if (coinUgx >= amount) return { source: 'coin', maxUgx };
  return {
    source: null,
    reason: maxUgx > 0
      ? `Your biggest single balance is UGX ${Math.floor(maxUgx).toLocaleString()}. A withdrawal can't be split across balances.`
      : 'No balance to withdraw yet.',
    shortfall: round2(amount - maxUgx),
    maxUgx,
  };
}

/** "256701234567" → "2567••••567" — enough to recognise a saved destination. */
export function maskDestination(value) {
  const s = String(value ?? '').replace(/\s/g, '');
  if (s.length <= 6) return s;
  return `${s.slice(0, 4)}••••${s.slice(-3)}`;
}

/** Stable identity of a payout destination, so a repeat withdrawal isn't saved twice. */
export function destinationKey(dest) {
  return [dest?.channel || '', dest?.bankCode || '', String(dest?.account || '').replace(/\s/g, '')].join('|');
}

/**
 * Remember a payout destination: newest first, no duplicates, capped.
 * @param {Array<object>} list existing saved destinations
 * @param {{channel: 'mobile'|'bank', account: string, bankCode?: string, name?: string, label?: string}} dest
 */
export function rememberDestination(list, dest, max = 5) {
  if (!dest?.account) return list || [];
  const key = destinationKey(dest);
  const rest = (list || []).filter((d) => destinationKey(d) !== key);
  return [{ ...dest, usedAt: dest.usedAt || Date.now() }, ...rest].slice(0, max);
}

// ─── Converting between currency and coin ───────────────────────────────────
//
// The server prices every conversion at the coin's live price in the person's own
// currency (get_my_ican_trading_info). Currency → coin (buy_ican_coins_from_wallet)
// has no fee; coin → currency (sell_ican_coins_to_wallet) keeps the flat 3%. The
// helpers below only plan the maths — nothing here moves money.

const round8 = (n) => Math.round(n * 1e8) / 1e8;
const ceil8 = (n) => Math.ceil(n * 1e8 - 1e-6) / 1e8;

// Every conversion is in the person's OWN currency (the country they chose at sign-up),
// never a fixed one. Same rule as services/topUpCurrency.js: USD / EUR / GBP show cents,
// the rest are whole units.
const TWO_DECIMAL_CURRENCIES = new Set(['USD', 'EUR', 'GBP']);
export const moneyDecimals = (currency) => (TWO_DECIMAL_CURRENCIES.has(String(currency || '').toUpperCase()) ? 2 : 0);

/** "UGX 20,000" / "USD 1.30" — in the currency's own precision. */
export function formatMoney(currency, n) {
  const d = moneyDecimals(currency);
  const text = Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
  return currency ? `${currency} ${text}` : text;
}

/**
 * Selling coin for a non-UGX currency pays round2(gross × the 97% ratio) on the server,
 * which can differ from our own rounding by one cent. A cent of headroom keeps a planned
 * conversion from landing a cent short; the cent stays in the wallet.
 */
export const conversionMargin = (currency) => (moneyDecimals(currency) === 2 ? 0.01 : 0);

const moneyText = formatMoney;

/** Coins that `amount` of currency buys at `price` per coin, floored so the cost never exceeds the amount. */
export function coinsForCurrency(amount, price) {
  const a = Number(amount);
  const p = Number(price);
  if (!(a > 0) || !(p > 0)) return 0;
  return floor8(a / p);
}

/** What `coins` are worth (or cost) at `price`, rounded to 2 dp the way the server does. */
export function currencyForCoins(coins, price) {
  const c = Number(coins);
  const p = Number(price);
  if (!(c > 0) || !(p > 0)) return 0;
  return round2(c * p);
}

/**
 * How a personal wallet pays `coinsNeeded` coins.
 * - 'coins_first' (the amount was typed in coins): coins on hand are spent first and
 *   only the shortfall is bought with money from the wallet — so "send 4 coins"
 *   works with 1.5 coins and enough money.
 * - 'currency_only' (the amount was typed in money): the coins are bought with
 *   money and the coin balance is left alone — someone who typed UGX 20,000 did
 *   not ask to spend their coins.
 * @returns {{ok: true, fromCoins: number, buyCoins: number, cost: number, convert: boolean} | {ok: false, error: string}}
 */
export function planCoinPayment({ coinsNeeded, coinBalance = 0, walletBalance = 0, price, mode = 'coins_first', currency = '' }) {
  const need = Number(coinsNeeded);
  if (!(need > 0)) return { ok: false, error: 'Enter an amount' };
  if (!(Number(price) > 0)) return { ok: false, error: 'The live coin price is not available right now. Try again in a moment.' };

  const have = Math.max(0, Number(coinBalance) || 0);
  const fromCoins = mode === 'currency_only' ? 0 : Math.min(have, need);
  const buyCoins = round8(need - fromCoins);
  const cost = currencyForCoins(buyCoins, price);

  if (cost > (Number(walletBalance) || 0) + 1e-9) {
    return {
      ok: false,
      error: buyCoins === need
        ? `Not enough money in your wallet: ${need.toFixed(4)} IcanEra costs ${moneyText(currency, cost)}, you have ${moneyText(currency, Number(walletBalance) || 0)}.`
        : `You have ${have.toFixed(4)} IcanEra, and converting the other ${buyCoins.toFixed(4)} costs ${moneyText(currency, cost)} — more than the ${moneyText(currency, Number(walletBalance) || 0)} in your wallet.`,
    };
  }
  return { ok: true, fromCoins, buyCoins, cost, convert: buyCoins > 0 };
}

/** What selling `coins` pays — mirrors sell_ican_coins(): gross and fee each rounded to 2 dp. */
export function simulateSell(coins, price, feeRate = COIN_PAYOUT_FEE_RATE) {
  const gross = currencyForCoins(coins, price);
  const fee = round2(gross * feeRate);
  return { gross, fee, net: round2(gross - fee) };
}

/** Coins to sell so the wallet gains at least `needed` after the fee (nudged up past any rounding). */
export function coinsToSellFor(needed, price, feeRate = COIN_PAYOUT_FEE_RATE, margin = 0) {
  const n = Number(needed) + (Number(margin) || 0);
  const p = Number(price);
  if (!(Number(needed) > 0) || !(p > 0)) return 0;
  const perCoin = p * (1 - feeRate);
  let coins = ceil8(n / perCoin);
  for (let i = 0; i < 10; i += 1) {
    const { net } = simulateSell(coins, p, feeRate);
    if (net >= n) break;
    coins = round8(coins + ceil8((n - net) / perCoin));
  }
  return coins;
}

/**
 * How a personal wallet pays `amount` of currency. The wallet's own money is used
 * first; if it falls short, just enough coin is sold (3% fee) to cover the
 * difference. Never more coin than is held.
 * @returns {{ok: true, convert: false} | {ok: true, convert: true, sellCoins: number, shortfall: number, proceeds: number, fee: number} | {ok: false, error: string}}
 */
export function planCurrencyPayment({ amount, walletBalance = 0, coinBalance = 0, price, feeRate = COIN_PAYOUT_FEE_RATE, currency = '' }) {
  const a = Number(amount);
  if (!(a > 0)) return { ok: false, error: 'Enter an amount' };
  const wallet = Math.max(0, Number(walletBalance) || 0);
  const shortfall = round2(a - wallet);
  if (shortfall <= 0) return { ok: true, convert: false };

  if (!(Number(price) > 0)) return { ok: false, error: 'The live coin price is not available right now. Try again in a moment.' };
  const sellCoins = coinsToSellFor(shortfall, price, feeRate, conversionMargin(currency));
  const have = Math.max(0, Number(coinBalance) || 0);
  if (sellCoins > have + 1e-9) {
    const reach = round2(wallet + simulateSell(have, price, feeRate).net);
    return {
      ok: false,
      error: `Not enough: you have ${moneyText(currency, wallet)} in your wallet and ${have.toFixed(4)} IcanEra (about ${moneyText(currency, simulateSell(have, price, feeRate).net)} after the fee), which reaches ${moneyText(currency, reach)}.`,
    };
  }
  const sold = simulateSell(sellCoins, price, feeRate);
  return { ok: true, convert: true, sellCoins, shortfall, proceeds: sold.net, fee: sold.fee };
}

// ─── Quick amounts in the person's own currency ────────────────────────────

const NICE_STEPS = [1, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10];
/** The largest "friendly" figure (1, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10 × a power of ten) not above x. */
function niceFloor(x) {
  if (!(x > 0)) return 0;
  const mag = 10 ** Math.floor(Math.log10(x));
  const n = x / mag;
  const step = [...NICE_STEPS].reverse().find((v) => v <= n + 1e-9) || 1;
  return Math.round(step * mag * 1e8) / 1e8;
}

/**
 * Quick-pick amounts that scale with what one coin costs in this person's currency:
 * 1, 2, 4 and 10 coins' worth, rounded down to a friendly figure. UGX at ~5,000 a coin
 * gives 5,000 / 10,000 / 20,000 / 50,000; USD at 1.30 gives 1 / 2.5 / 5 / 10.
 */
export function quickMoneyAmounts(price, currency) {
  const p = Number(price);
  if (!(p > 0)) return [];
  const floorAt = moneyDecimals(currency) === 0 ? 1 : 0.01;
  const out = [];
  for (const k of [1, 2, 4, 10]) {
    const v = Math.max(floorAt, niceFloor(p * k));
    if (!out.includes(v)) out.push(v);
  }
  return out;
}
