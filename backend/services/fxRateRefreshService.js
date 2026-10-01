/**
 * Refreshes ican_currency_rates.rate_to_ugx from a live FX feed.
 *
 * open.er-api.com is free, requires no signup/API key, and updates once a
 * day (its own daily refresh cadence, not per-second) — matching the daily
 * cadence of inflationRefreshService.js, and avoiding any billing or key
 * management for a Free-Plan-hosted project.
 *
 * initial_rate_to_ugx is NEVER touched here — it's the launch anchor that
 * ican_get_price_by_country() etc. compare today's rate_to_ugx against to
 * compute each currency's own appreciation (see
 * FIX_ICAN_PER_CURRENCY_STABILITY.sql). Only rate_to_ugx moves.
 */

const { createClient } = require('@supabase/supabase-js');

const FX_API_URL = 'https://open.er-api.com/v6/latest/USD';

// Optional fresher source: a Google Sheet "Published to the web" as CSV, with
// column A = currency code and column B = =GOOGLEFINANCE("CURRENCY:USD"&A2)
// (units of that currency per 1 USD). GOOGLEFINANCE is the only free official
// Google Finance access and is delayed up to ~20 min, but that is far fresher
// than the daily open.er-api.com feed. Sheet values override the daily feed
// per currency; anything missing/invalid falls back to it.
const GOOGLE_SHEET_FX_CSV_URL = process.env.GOOGLE_SHEET_FX_CSV_URL ||
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vSpFRW0csXSByWiRw36lNsADXR5kOMXXnYnL7s2W1M8pPB-lhUHf3_TG2dL0mR60QUZJtiE1GlW7GC-/pub?gid=0&single=true&output=csv';

async function fetchGoogleSheetRates() {
  if (!GOOGLE_SHEET_FX_CSV_URL) return {};
  try {
    const res = await fetch(GOOGLE_SHEET_FX_CSV_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rates = {};
    for (const line of (await res.text()).split(/\r?\n/)) {
      const [code, value] = line.split(',').map(c => c.trim().replace(/^"|"$/g, ''));
      const n = Number(value);
      if (/^[A-Z]{3}$/.test(code || '') && Number.isFinite(n) && n > 0) rates[code] = n;
    }
    return rates;
  } catch (err) {
    console.warn('[fx-rates] Google Sheet feed unavailable, using daily feed only:', err.message);
    return {};
  }
}

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key);
}

async function fetchUsdRates() {
  const res = await fetch(FX_API_URL);
  if (!res.ok) throw new Error(`FX API returned HTTP ${res.status}`);
  const body = await res.json();
  if (body.result !== 'success' || !body.rates || typeof body.rates.UGX !== 'number') {
    throw new Error('Unexpected FX API response shape (missing rates.UGX)');
  }
  return body.rates; // { USD: 1, UGX: 3700.x, NGN: 1500.x, ... } — units of currency per 1 USD
}

/**
 * Pull the latest USD cross-rates and derive UGX-per-unit for every currency
 * this app tracks: rate_to_ugx(X) = rates.UGX / rates.X, since both are
 * expressed per 1 USD. Currencies the feed doesn't carry are left untouched
 * rather than overwritten with a guess.
 */
async function refreshLiveFxRates() {
  const supabase = getSupabase();
  const usdRates = { ...(await fetchUsdRates()), ...(await fetchGoogleSheetRates()) };

  const { data: currencyRows, error } = await supabase
    .from('ican_currency_rates')
    .select('currency_code, rate_to_ugx');
  if (error) throw error;

  let updated = 0;
  let skipped = 0;

  for (const row of currencyRows || []) {
    const code = row.currency_code;
    const unitsPerUsd = usdRates[code];
    if (!unitsPerUsd || unitsPerUsd <= 0) { skipped++; continue; }

    const rateToUgx = usdRates.UGX / unitsPerUsd;
    // Per-minute cadence: don't rewrite rows whose rate hasn't moved.
    const current = Number(row.rate_to_ugx);
    if (current > 0 && Math.abs(rateToUgx - current) / current < 1e-9) { skipped++; continue; }

    const { error: updateError } = await supabase
      .from('ican_currency_rates')
      .update({ rate_to_ugx: rateToUgx, updated_at: new Date().toISOString() })
      .eq('currency_code', code);

    if (updateError) {
      console.error(`[fx-rates] Failed to update ${code}:`, updateError.message);
      skipped++;
      continue;
    }
    updated++;
  }

  console.log(`[fx-rates] Refreshed ${updated} currencies from live FX feed, ${skipped} unchanged.`);
  return { updated, skipped, total: currencyRows?.length || 0 };
}

module.exports = { refreshLiveFxRates };
