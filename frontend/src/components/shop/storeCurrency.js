import CountryService from '../../services/countryService';

// Every price on the platform is stored in UGX. A store shows it in its own
// country's currency (the store owner's signup country, user_accounts.country_code,
// else supermarkets.country -- a code or a name), converted with
// the app's exchange-rate table; when the store has no known country or that
// currency has no rate, the price simply stays in UGX instead of guessing.
export const formatStorePrice = (amountUGX, storeCountry) => {
  const code = CountryService.resolveCountryCode(storeCountry);
  const converted = code ? CountryService.convertFromUGX(amountUGX, code) : null;
  const currency = converted ? converted.currency : 'UGX';
  const amount = converted ? converted.amount : Number(amountUGX || 0);
  return {
    currency,
    amount: amount.toLocaleString(undefined, {
      minimumFractionDigits: amount < 100 && currency !== 'UGX' ? 2 : 0,
      maximumFractionDigits: amount < 100 && currency !== 'UGX' ? 2 : 0,
    }),
  };
};
