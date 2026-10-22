// Fee rules for the money-moving Edge Functions (flutterwave-momo-send).
//
// The rates live in public.ican_fee_rates - a developer changes one with
//     UPDATE public.ican_fee_rates SET rate = 0.02 WHERE key = 'send_mobile_money';
// and it takes effect on the next request, with no redeploy. See supabase/migrations/20261106100000_fee_rates.sql.
//
// A fee is TAKEN OUT of the amount: the wallet is debited `amount`, the recipient receives amount - fee. request_fiat_momo_send
// and request_fiat_bank_send already work that way (p_fee), and a failed transfer refunds the whole `amount`.
//
// Plain JavaScript (JSDoc types) on purpose: Deno imports it as it is, and Node unit-tests this very file
// (frontend/tests/feeRates.test.js, which also checks it agrees with the website's own copy of the maths).

/** What a missing row in ican_fee_rates means - the same 3% public.ican_fee_rate() falls back to. */
export const DEFAULT_FEE_RATE = 0.03;

/**
 * Which rate applies. Decided only from what the server can verify - never from the `purpose` the caller claims,
 * or anyone could ask for the cheaper rate on an ordinary send.
 *   bank account                              send_bank
 *   mobile money to the caller's OWN number   withdraw_wallet   (cashing out)
 *   mobile money to any other number          send_mobile_money
 * @param {{isBank: boolean, toOwnNumber: boolean}} p
 * @returns {'send_bank'|'withdraw_wallet'|'send_mobile_money'}
 */
export function feeRateKey({ isBank, toOwnNumber }) {
  if (isBank) return 'send_bank';
  return toOwnNumber ? 'withdraw_wallet' : 'send_mobile_money';
}

/** A usable rate: a fraction from 0 up to (not including) 1 - the same rule the table enforces. */
export function isValidFeeRate(rate) {
  const n = Number(rate);
  return rate !== null && rate !== '' && Number.isFinite(n) && n >= 0 && n < 1;
}

/**
 * The fee on `amount`, in whole shillings, rounded UP so it is never under-collected. 0 when there is no rate or amount.
 * (The 1e-9 absorbs float noise, e.g. 10000 * 0.03 is 300.00000000000006, which must be 300 and not 301.)
 * @param {number|string} amount
 * @param {number|string} rate
 */
export function feeFor(amount, rate) {
  const a = Number(amount);
  const r = Number(rate);
  if (!(a > 0) || !(r > 0)) return 0;
  return Math.ceil(a * r - 1e-9);
}

/**
 * Read one rate with the service-role client.
 *   - the table is not there yet (the SQL has not been run): { ok: true, rate: 0 }  -> no fee, exactly as before this feature
 *   - the table is there but the row is missing:             { ok: true, rate: DEFAULT_FEE_RATE }
 *   - the read failed for any other reason:                  { ok: false }          -> the caller must refuse, never guess a price
 * @param {{from: Function}} client a Supabase client
 * @param {string} key
 * @returns {Promise<{ok: true, rate: number} | {ok: false, error: string}>}
 */
export async function loadFeeRate(client, key) {
  const { data, error } = await client.from('ican_fee_rates').select('rate').eq('key', key).maybeSingle();
  if (error) {
    // PGRST205 = PostgREST cannot find the table, 42P01 = undefined_table
    if (error.code === 'PGRST205' || error.code === '42P01') return { ok: true, rate: 0 };
    return { ok: false, error: error.message || 'Could not read the fee rates.' };
  }
  if (!data) return { ok: true, rate: DEFAULT_FEE_RATE };
  if (!isValidFeeRate(data.rate)) return { ok: false, error: `The ${key} fee rate is not a valid rate.` };
  return { ok: true, rate: Number(data.rate) };
}
