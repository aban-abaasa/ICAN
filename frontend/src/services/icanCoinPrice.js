// ICAN Coin price configuration
// Update this when ICAN coin price changes

export const ICAN_COIN_PRICES = {
  UGX: 5000,      // 1 ICAN coin = 5,000 UGX
  USD: 1.35,      // 1 ICAN coin = $1.35 USD
  KES: 175,       // 1 ICAN coin = 175 KES
  EUR: 1.25,      // 1 ICAN coin = €1.25
  GBP: 1.08       // 1 ICAN coin = £1.08
};

export const getIcanCoinPrice = (currency = 'UGX') => {
  return ICAN_COIN_PRICES[currency] || ICAN_COIN_PRICES.UGX;
};

export const convertToIcanCoins = (amount, fromCurrency = 'UGX') => {
  const price = getIcanCoinPrice(fromCurrency);
  return amount / price;
};

export const convertFromIcanCoins = (coins, toCurrency = 'UGX') => {
  const price = getIcanCoinPrice(toCurrency);
  return coins * price;
};
