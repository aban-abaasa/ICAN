// The platform's own FX table (public.ican_currency_rates) -> the shape CountryService.updateExchangeRates expects.
//
// The table stores UGX per ONE unit of the currency (USD ~ 4,088). CountryService converts with "units of the currency
// per ONE UGX" (USD ~ 0.000245), so each rate is inverted. The server's trade function converts with this same table,
// so the previews on the Buy and Sell screens now show the numbers that will actually execute. Rows that are not a
// positive, finite number are skipped (the built-in rate for that currency stays), and UGX is always exactly 1.
export const ratesFromRows = (rows) => {
  const out = {};
  for (const row of rows || []) {
    const code = String(row?.currency_code || '').trim().toUpperCase();
    const ugxPerUnit = Number(row?.rate_to_ugx);
    if (!/^[A-Z]{3}$/.test(code) || code === 'UGX') continue;
    if (!Number.isFinite(ugxPerUnit) || ugxPerUnit <= 0) continue;
    out[code] = 1 / ugxPerUnit;
  }
  return out;
};
