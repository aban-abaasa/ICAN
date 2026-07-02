/**
 * currencyService.js
 *
 * Detects the user's local currency from their browser locale,
 * fetches UGX → local currency exchange rates (cached 4 h in localStorage),
 * and provides formatting helpers.
 *
 * All monetary values in ICAN are stored in UGX.  Call convertFromUGX()
 * before displaying any amount to a user.
 */

const CACHE_KEY   = 'ican_fx_rates_ugx';
const CACHE_TTL   = 4 * 60 * 60 * 1000; // 4 hours

// Country code (ISO 3166-1 alpha-2) → ISO 4217 currency code
const COUNTRY_CURRENCY = {
  // East Africa
  UG: 'UGX', KE: 'KES', TZ: 'TZS', RW: 'RWF', BI: 'BIF',
  SS: 'SSP', ET: 'ETB', SO: 'SOS', ER: 'ERN', DJ: 'DJF',
  // West Africa
  NG: 'NGN', GH: 'GHS', SN: 'XOF', CI: 'XOF', CM: 'XAF',
  // Southern Africa
  ZA: 'ZAR', ZW: 'ZWL', ZM: 'ZMW', BW: 'BWP', MZ: 'MZN',
  // North Africa / Middle East
  EG: 'EGP', MA: 'MAD', AE: 'AED', SA: 'SAR',
  // Europe
  GB: 'GBP', DE: 'EUR', FR: 'EUR', IT: 'EUR', ES: 'EUR',
  NL: 'EUR', BE: 'EUR', PT: 'EUR', SE: 'SEK', NO: 'NOK',
  CH: 'CHF', PL: 'PLN',
  // Americas
  US: 'USD', CA: 'CAD', MX: 'MXN', BR: 'BRL',
  // Asia-Pacific
  IN: 'INR', CN: 'CNY', JP: 'JPY', AU: 'AUD', NZ: 'NZD',
  SG: 'SGD', MY: 'MYR', PH: 'PHP',
};

// Currencies where showing decimals adds no value
const NO_DECIMAL = new Set(['UGX', 'TZS', 'RWF', 'BIF', 'SSP', 'DJF', 'XAF', 'XOF', 'JPY']);

/**
 * Returns the ISO 4217 currency code for the user's locale.
 * Falls back to 'UGX' (the platform's base currency).
 */
export function getLocalCurrencyCode() {
  try {
    const langs = navigator.languages?.length ? navigator.languages : [navigator.language];
    for (const lang of langs) {
      const parts = lang.split('-');
      const country = parts[parts.length - 1].toUpperCase();
      if (COUNTRY_CURRENCY[country]) return COUNTRY_CURRENCY[country];
    }
  } catch {}
  return 'UGX';
}

/**
 * Fetches UGX-based exchange rates, with 4-hour localStorage cache.
 * Returns an object like { USD: 0.000271, KES: 0.035, ... }
 */
async function getRates() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) {
      const { rates, fetchedAt } = JSON.parse(raw);
      if (Date.now() - fetchedAt < CACHE_TTL) return rates;
    }
  } catch {}

  const res  = await fetch('https://open.er-api.com/v6/latest/UGX', { cache: 'no-store' });
  const data = await res.json();
  if (data.result !== 'success') throw new Error('FX fetch failed');

  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ rates: data.rates, fetchedAt: Date.now() }));
  } catch {}
  return data.rates;
}

/**
 * Converts a UGX amount to the target currency.
 * If the rate is unavailable, returns the original UGX amount.
 */
export async function convertFromUGX(amountUgx, targetCurrency) {
  if (!targetCurrency || targetCurrency === 'UGX') return Number(amountUgx) || 0;
  try {
    const rates = await getRates();
    const rate  = rates[targetCurrency];
    if (!rate) return Number(amountUgx) || 0;
    return (Number(amountUgx) || 0) * rate;
  } catch {
    return Number(amountUgx) || 0;
  }
}

/**
 * Formats a converted amount using the browser's locale + Intl.NumberFormat.
 * Example: formatCurrency(35.40, 'KES') → "KES 35.40"
 *          formatCurrency(5000, 'UGX')  → "UGX 5,000"
 *          formatCurrency(1.35, 'USD')  → "$1.35"
 */
export function formatCurrency(amount, currencyCode) {
  const code = currencyCode || 'UGX';
  const decimals = NO_DECIMAL.has(code) ? 0 : 2;
  try {
    return new Intl.NumberFormat(undefined, {
      style:                 'currency',
      currency:              code,
      minimumFractionDigits: 0,
      maximumFractionDigits: decimals,
    }).format(amount);
  } catch {
    return `${code} ${Number(amount).toLocaleString(undefined, { maximumFractionDigits: decimals })}`;
  }
}

/**
 * One-shot hook helper: returns { currency, convert, format } with rates pre-loaded.
 * Call once per component via useCurrency() hook (see below).
 */
export async function loadCurrencyContext() {
  const currency = getLocalCurrencyCode();
  let rates = {};
  try { rates = await getRates(); } catch {}
  const rate = (currency === 'UGX') ? 1 : (rates[currency] || 1);

  return {
    currency,
    /** Convert a UGX number synchronously using the cached rate */
    convert: (ugx) => (Number(ugx) || 0) * rate,
    /** Format a converted number */
    format:  (converted) => formatCurrency(converted, currency),
    /** Convert + format in one call */
    fmt:     (ugx) => formatCurrency((Number(ugx) || 0) * rate, currency),
    /** The raw multiplier (UGX × rate = local) */
    rate,
  };
}
