/**
 * How a service is priced on a business website. The business keeps its lowest price in
 * `price` and, for a range, the top in `price_max`; a service with no price at all is
 * "on request". (get_cmms_site_products only reports a price_max above the lowest price.)
 */

const amount = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** 'fixed' (one price), 'range' (from - to) or 'quote' (no price: ask the business). */
export const servicePriceKind = (item = {}) => {
  const from = amount(item.price);
  const to = amount(item.price_max);
  if (from > 0 && to > from) return 'range';
  return from > 0 ? 'fixed' : 'quote';
};

/** Only one fixed price can be paid for on the site; a range or a quote is agreed first. */
export const isFixedPrice = (item = {}) => servicePriceKind(item) === 'fixed';

/**
 * Text for the price. `format(amount, currency)` formats one amount (the site's formatMoney);
 * a range repeats the currency once, e.g. "UGX 20,000 - 50,000".
 */
export const servicePriceText = (item = {}, format) => {
  const kind = servicePriceKind(item);
  if (kind === 'quote') return 'Ask for a quote';
  if (kind === 'fixed') return format(item.price, item.currency);
  const low = format(item.price, item.currency);
  const high = format(item.price_max, item.currency);
  // "UGX 20,000" + "UGX 50,000" -> "UGX 20,000 - 50,000"
  const code = String(item.currency || 'UGX').toUpperCase();
  return `${low} - ${high.startsWith(code) ? high.slice(code.length).trim() : high}`;
};
