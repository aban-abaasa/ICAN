/**
 * Refreshes ican_currency_rates.local_inflation_pct from the World Bank API
 * (indicator FP.CPI.TOTL.ZG — "Inflation, consumer prices, annual %").
 *
 * Official inflation figures are published annually per country, not
 * continuously like an FX tick — "live" here means "always the latest
 * officially published figure", tracked via inflation_as_of_year so the
 * UI can be honest about data age instead of implying a live feed.
 */

const { createClient } = require('@supabase/supabase-js');

const WORLD_BANK_INDICATOR = 'FP.CPI.TOTL.ZG';
const WORLD_BANK_URL =
  `https://api.worldbank.org/v2/country/all/indicator/${WORLD_BANK_INDICATOR}` +
  `?format=json&per_page=4000&date=2018:${new Date().getFullYear()}`;

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key);
}

// World Bank returns one entry per country per year; keep only the latest
// year that actually has a non-null value for each entity.
function pickLatestPerCountry(rows) {
  const latest = new Map(); // country_code (2-letter) -> { value, year }
  for (const row of rows) {
    if (row.value === null || row.value === undefined) continue;
    const code = row.country?.id;
    const year = parseInt(row.date, 10);
    if (!code || !Number.isFinite(year)) continue;
    const existing = latest.get(code);
    if (!existing || year > existing.year) {
      latest.set(code, { value: Number(row.value), year });
    }
  }
  return latest;
}

async function fetchWorldBankInflation() {
  const res = await fetch(WORLD_BANK_URL);
  if (!res.ok) throw new Error(`World Bank API returned HTTP ${res.status}`);
  const body = await res.json();
  const rows = Array.isArray(body) ? body[1] : null;
  if (!Array.isArray(rows)) throw new Error('Unexpected World Bank API response shape');
  return pickLatestPerCountry(rows);
}

/**
 * Pull the latest published inflation rate for every currency this app
 * tracks (matched via each row's representative country_code) and write it
 * into ican_currency_rates. Rows whose country has no World Bank data are
 * left untouched rather than overwritten with a guess.
 */
async function refreshGlobalInflation() {
  const supabase = getSupabase();
  const inflationByCountry = await fetchWorldBankInflation();

  const { data: currencyRows, error } = await supabase
    .from('ican_currency_rates')
    .select('currency_code, country_code, local_inflation_pct');
  if (error) throw error;

  let updated = 0;
  let skipped = 0;
  // Falls back to base columns only if ADD_LIVE_INFLATION_TRACKING.sql hasn't
  // been applied yet (inflation_as_of_year / inflation_source don't exist) —
  // lets the actual numbers go live immediately without blocking on that migration.
  let trackingColumnsAvailable = true;

  for (const row of currencyRows || []) {
    const match = inflationByCountry.get((row.country_code || '').toUpperCase());
    if (!match) { skipped++; continue; }

    const payload = {
      local_inflation_pct: Math.round(match.value * 100) / 100,
      updated_at: new Date().toISOString()
    };
    if (trackingColumnsAvailable) {
      payload.inflation_as_of_year = match.year;
      payload.inflation_source = 'world_bank_fp_cpi_totl_zg';
    }

    const { error: updateError } = await supabase
      .from('ican_currency_rates')
      .update(payload)
      .eq('currency_code', row.currency_code);

    if (updateError && trackingColumnsAvailable && /column|schema cache/i.test(updateError.message)) {
      console.warn('[inflation] Tracking columns not found — run ADD_LIVE_INFLATION_TRACKING.sql for freshness metadata. Continuing with local_inflation_pct only.');
      trackingColumnsAvailable = false;
      delete payload.inflation_as_of_year;
      delete payload.inflation_source;
      const { error: retryError } = await supabase
        .from('ican_currency_rates')
        .update(payload)
        .eq('currency_code', row.currency_code);
      if (retryError) { console.error(`[inflation] Failed to update ${row.currency_code}:`, retryError.message); skipped++; continue; }
    } else if (updateError) {
      console.error(`[inflation] Failed to update ${row.currency_code}:`, updateError.message);
      skipped++;
      continue;
    }
    updated++;
  }

  console.log(`[inflation] Refreshed ${updated} currencies from World Bank, ${skipped} left unchanged (no match).`);
  return { updated, skipped, total: currencyRows?.length || 0 };
}

module.exports = { refreshGlobalInflation };
