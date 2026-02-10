/**
 * Currency mapping by country code
 * Maps country code to currency code and symbol
 */
export const CURRENCY_BY_COUNTRY = {
  'UG': { code: 'UGX', symbol: 'UGX', name: 'Ugandan Shilling' },
  'KE': { code: 'KES', symbol: 'KES', name: 'Kenyan Shilling' },
  'TZ': { code: 'TZS', symbol: 'TZS', name: 'Tanzanian Shilling' },
  'RW': { code: 'RWF', symbol: 'RWF', name: 'Rwandan Franc' },
  'ZA': { code: 'ZAR', symbol: 'R', name: 'South African Rand' },
  'NG': { code: 'NGN', symbol: '₦', name: 'Nigerian Naira' },
  'ET': { code: 'ETB', symbol: 'Br', name: 'Ethiopian Birr' },
  'GH': { code: 'GHS', symbol: 'GH₵', name: 'Ghanaian Cedi' },
  'US': { code: 'USD', symbol: '$', name: 'US Dollar' },
  'GB': { code: 'GBP', symbol: '£', name: 'British Pound' },
  'EU': { code: 'EUR', symbol: '€', name: 'Euro' },
  'IN': { code: 'INR', symbol: '₹', name: 'Indian Rupee' },
  'CN': { code: 'CNY', symbol: '¥', name: 'Chinese Yuan' },
  'JP': { code: 'JPY', symbol: '¥', name: 'Japanese Yen' }
};

/**
 * Get currency symbol by country code
 * @param {string} countryCode - Two-letter country code (e.g., 'UG', 'KE')
 * @returns {string} Currency symbol or code
 */
export const getCurrencySymbol = (countryCode) => {
  if (!countryCode) return '$'; // Default fallback
  const currency = CURRENCY_BY_COUNTRY[countryCode.toUpperCase()];
  return currency ? currency.symbol : '$';
};

/**
 * Get currency code by country code
 * @param {string} countryCode - Two-letter country code
 * @returns {string} Currency code (e.g., 'UGX', 'USD')
 */
export const getCurrencyCode = (countryCode) => {
  if (!countryCode) return 'USD'; // Default fallback
  const currency = CURRENCY_BY_COUNTRY[countryCode.toUpperCase()];
  return currency ? currency.code : 'USD';
};

/**
 * Get full currency information by country code
 * @param {string} countryCode - Two-letter country code
 * @returns {object} Currency information { code, symbol, name }
 */
export const getCurrencyInfo = (countryCode) => {
  if (!countryCode) return CURRENCY_BY_COUNTRY['US'];
  const currency = CURRENCY_BY_COUNTRY[countryCode.toUpperCase()];
  return currency || CURRENCY_BY_COUNTRY['US'];
};

/**
 * Format amount with currency symbol
 * @param {number} amount - Amount to format
 * @param {string} currencyCode - Currency code (e.g., 'UGX', 'USD')
 * @returns {string} Formatted amount with symbol
 */
export const formatCurrencyAmount = (amount, currencyCode) => {
  const symbol = getCurrencySymbolByCode(currencyCode);
  return `${symbol}${Number(amount).toLocaleString()}`;
};

/**
 * Get currency symbol by currency code
 * @param {string} currencyCode - Currency code (e.g., 'UGX', 'USD')
 * @returns {string} Currency symbol
 */
export const getCurrencySymbolByCode = (currencyCode) => {
  for (const country in CURRENCY_BY_COUNTRY) {
    if (CURRENCY_BY_COUNTRY[country].code === currencyCode) {
      return CURRENCY_BY_COUNTRY[country].symbol;
    }
  }
  return '$'; // Default fallback for unknown currencies
};

export default {
  getCurrencySymbol,
  getCurrencyCode,
  getCurrencyInfo,
  formatCurrencyAmount,
  getCurrencySymbolByCode,
  CURRENCY_BY_COUNTRY
};
