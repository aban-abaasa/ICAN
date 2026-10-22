/**
 * ICANera's sale fees, for the dev panel's "Sale fees" tab. Pure: no React, no network (tests/saleFees.test.js).
 *
 * Two fees, both taken from the BUSINESS and never added to what the customer pays (supabase/migrations/20261107100000_sale_platform_fees.sql):
 *   dropship_sale   every dropship sale - out of the reseller's markup
 *   store_sale      every Digital City Era store sale paid from an IcanEra wallet - out of what the store receives
 * They are rows in public.ican_fee_rates; the panel changes them through ican_dev_set_sale_fee (20261109100000_sale_fees_dev_panel.sql).
 * The server stores a fraction (0.02 = 2%) to six decimals; the panel shows and takes PERCENT with up to four decimals, which is
 * exactly what six decimals of a fraction can hold.
 */

export const SALE_FEES = Object.freeze([
  Object.freeze({ key: 'dropship_sale', title: 'Dropship sales', paidBy: 'the reseller, out of their markup (never more than the markup left)', defaultRate: 0.02 }),
  Object.freeze({ key: 'store_sale', title: 'Digital City Era store sales', paidBy: 'the store, out of what it receives', defaultRate: 0.01 }),
]);

/** Above this the panel asks for a second, more pointed confirmation: a typo like 20 for 2 should not go through on one click. */
export const BIG_FEE_PERCENT = 10;

/**
 * What the developer typed (percent) -> the fraction the server wants.
 *   "2" -> 0.02,  "1.25" -> 0.0125,  "2%" -> 0.02,  "0" -> 0
 * Refused: nothing, text, negative, 100 or more, more than four decimals (the server keeps six decimals of a fraction).
 * @returns {{ ok: true, rate: number, percent: number } | { ok: false, error: string }}
 */
export function percentToRate(text) {
  const raw = String(text ?? '').trim().replace(/%$/, '').trim();
  if (raw === '') return { ok: false, error: 'Type a percentage, for example 2' };
  if (!/^\d+(\.\d+)?$/.test(raw)) return { ok: false, error: 'Digits only, for example 2 or 1.25' };
  if (/\.\d{5,}$/.test(raw)) return { ok: false, error: 'At most four decimals, for example 1.2575' };
  const percent = Number(raw);
  if (!(percent < 100)) return { ok: false, error: 'A fee must be below 100%' };
  return { ok: true, percent, rate: Number((percent / 100).toFixed(6)) };
}

/** 0.02 -> "2", 0.0125 -> "1.25", 0 -> "0" (what goes in the input box). */
export function rateToPercent(rate) {
  if (rate === null || rate === undefined || rate === '') return '';   // no rate is not 0%
  const n = Number(rate);
  if (!Number.isFinite(n) || n < 0) return '';
  return String(Number((n * 100).toFixed(4)));
}

/** 0.02 -> "2%" */
export function describeFee(rate) {
  const p = rateToPercent(rate);
  return p === '' ? '—' : `${p}%`;
}

/**
 * The sentence the developer confirms before a fee changes. `big` = ask harder; `off` = the fee is being switched off.
 * @returns {{ message: string, big: boolean, off: boolean, changed: boolean }}
 */
export function describeChange(fee, oldRate, newRate) {
  const changed = Number(oldRate) !== Number(newRate);
  const off = Number(newRate) === 0 && changed;
  const big = Number(newRate) * 100 > BIG_FEE_PERCENT;
  let message = `${fee.title}: change ICANera's fee from ${describeFee(oldRate)} to ${describeFee(newRate)}?\n\nIt is paid by ${fee.paidBy}. The customer pays the same either way. It applies from the next sale.`;
  if (off) message += '\n\nThis switches the fee OFF: ICANera will take nothing from these sales.';
  if (big) message += `\n\nThat is more than ${BIG_FEE_PERCENT}% of every sale. Is that really what you mean?`;
  return { message, big, off, changed };
}
