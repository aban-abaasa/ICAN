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

/** sell_ican_coins() takes a flat 3% off every coin → cash payout. */
export const COIN_PAYOUT_FEE_RATE = 0.03;

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const floor8 = (n) => Math.floor(n * 1e8 + 1e-6) / 1e8;

/**
 * What a withdrawal of `amountUgx` costs and pays, per balance it can come from.
 * - 'fiat': the wallet balance → mobile money / bank, no wallet fee.
 * - 'coin': IcanEra coin sold at `rate` UGX per coin, minus the flat payout fee —
 *   mirrors sell_ican_coins() (gross = coins × rate, fee = gross × 3%, both
 *   rounded to 2 dp) so the preview matches what the server pays.
 * @returns {{icanDebit: number, gross: number, fee: number, net: number}}
 */
export function quoteWithdrawal({ amountUgx, source, rate, feeRate = COIN_PAYOUT_FEE_RATE }) {
  const amount = Number(amountUgx);
  if (!(amount > 0)) return { icanDebit: 0, gross: 0, fee: 0, net: 0 };
  if (source === 'coin') {
    const icanDebit = floor8(amount / rate);
    const gross = round2(icanDebit * rate);
    const fee = round2(gross * feeRate);
    return { icanDebit, gross, fee, net: round2(gross - fee) };
  }
  return { icanDebit: 0, gross: round2(amount), fee: 0, net: round2(amount) };
}

/**
 * Pick the balance a cash-out should come from. The wallet balance wins when it
 * covers the amount (no fee); otherwise the coin balance does; otherwise there's
 * a shortfall. A cash-out never silently splits across two balances.
 * @returns {{source: 'fiat'|'coin'|null, reason?: string, shortfall?: number, maxUgx: number}}
 */
export function planWithdrawalSource({ amountUgx, fiatUgx = 0, coinIcan = 0, rate, feeRate = COIN_PAYOUT_FEE_RATE }) {
  const fiat = Math.max(0, Number(fiatUgx) || 0);
  const coinUgx = Math.max(0, (Number(coinIcan) || 0) * rate);
  const maxUgx = Math.max(fiat, coinUgx);
  const amount = Number(amountUgx);

  if (!(amount > 0)) return { source: null, reason: 'Enter an amount', maxUgx };
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
