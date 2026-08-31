/**
 * Country Tax Rules Routes
 *
 * Worldwide tax engine backing advancedReportService.js's tax return /
 * balance sheet / income statement generation. Two-tier lookup against
 * public.country_tax_rules (a shared, non-user-scoped reference table):
 *   - 'verified' rows were hand-researched and seeded via
 *     ADD_COUNTRY_TAX_RULES.sql — never overwritten here.
 *   - 'ai_generated' rows are produced on first request for a country with
 *     no cached row (or a stale one) by asking an AI provider (OpenAI and/or
 *     Gemini, via aiProviderService.js) for structured tax data, then cached
 *     so we don't re-ask on every report.
 *
 * Writes use the Supabase service-role key deliberately: this is shared
 * reference data, and the browser must never be able to write it directly
 * (an anon/user JWT has no INSERT/UPDATE grant on this table by RLS design).
 *
 * Routes:
 * GET /api/tax-rules/:countryCode - Fetch (and generate/cache if needed) tax rules for a country
 */

const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { callAI } = require('../services/aiProviderService');

const router = express.Router();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const adminSupabase =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
    : null;

// AI-generated rows are refreshed after this many days; verified rows never expire here.
const AI_REFRESH_WINDOW_DAYS = 90;

const isStale = (row) => {
  if (!row) return true;
  if (row.source === 'verified') return false;
  if (!row.last_verified_at) return true;
  const ageMs = Date.now() - new Date(row.last_verified_at).getTime();
  return ageMs > AI_REFRESH_WINDOW_DAYS * 24 * 60 * 60 * 1000;
};

const TAX_RULES_JSON_SCHEMA_INSTRUCTION = `You are a tax research assistant. Given an ISO 3166-1 alpha-2 country code, respond with ONLY a single JSON object (no markdown, no prose) matching exactly this shape:
{
  "country_name": string,
  "currency": string (ISO 4217 code, e.g. "USD"),
  "personal_tax_brackets": [ { "upTo": number|null, "rate": number } ],
  "personal_tax_period": "annual" | "monthly",
  "corporate_tax_rate": number,
  "vat_rate": number,
  "capital_gains_rate": number,
  "deductible_expenses": string[],
  "filing_date": string,
  "regulatory_body": string,
  "requirements": string[]
}
Rules:
- "personal_tax_brackets" is the country's actual progressive individual income tax bands, marginal, in the country's local currency, ordered ascending by "upTo". The last band's "upTo" must be null. If the country genuinely has a single flat personal rate, return one band with "upTo": null.
- Rates are decimals (0.30 for 30%), not percentages.
- Use your best current knowledge. If you are not confident about exact bracket thresholds, provide your best reasonable estimate rather than omitting fields, but keep the structure valid.
- Do not wrap the JSON in markdown code fences.`;

const fetchAiGeneratedTaxRules = async (countryCode) => {
  // callAI races OpenAI and Gemini when both are configured, or uses
  // whichever single provider is available — see aiProviderService.js.
  const result = await callAI({
    messages: [
      { role: 'system', content: TAX_RULES_JSON_SCHEMA_INSTRUCTION },
      { role: 'user', content: `Country code: ${countryCode}` }
    ],
    temperature: 0.2,
    maxTokens: 1200,
    jsonMode: true
  });

  let parsed;
  try {
    parsed = JSON.parse(result.content);
  } catch {
    throw new Error(`${result.provider} returned malformed JSON for tax rules`);
  }

  if (!Array.isArray(parsed.personal_tax_brackets) || parsed.personal_tax_brackets.length === 0) {
    throw new Error(`${result.provider} response missing personal_tax_brackets`);
  }

  parsed.__provider = result.provider;
  return parsed;
};

/**
 * GET /api/tax-rules/:countryCode
 */
router.get('/:countryCode', async (req, res) => {
  try {
    if (!adminSupabase) {
      return res.status(500).json({ error: 'Server is missing Supabase configuration.' });
    }

    const countryCode = String(req.params.countryCode || '').trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(countryCode)) {
      return res.status(400).json({ error: 'countryCode must be a 2-letter ISO country code' });
    }

    const { data: existing, error: fetchError } = await adminSupabase
      .from('country_tax_rules')
      .select('*')
      .eq('country_code', countryCode)
      .maybeSingle();

    if (fetchError) {
      console.error('❌ country_tax_rules lookup error:', fetchError);
      return res.status(500).json({ error: 'Failed to look up tax rules' });
    }

    if (existing && !isStale(existing)) {
      return res.status(200).json(existing);
    }

    // Missing, or an ai_generated row past its refresh window — (re)generate.
    let generated;
    try {
      generated = await fetchAiGeneratedTaxRules(countryCode);
    } catch (aiError) {
      // If we have a stale-but-present row, better to serve it than fail outright.
      if (existing) {
        console.warn(`⚠️ AI refresh failed for ${countryCode}, serving stale cached row:`, aiError.message);
        return res.status(200).json(existing);
      }
      console.error(`❌ Could not generate tax rules for ${countryCode}:`, aiError.message);
      return res.status(502).json({ error: 'Could not generate tax rules for this country', message: aiError.message });
    }

    const row = {
      country_code: countryCode,
      country_name: generated.country_name,
      currency: generated.currency,
      personal_tax_brackets: generated.personal_tax_brackets,
      personal_tax_period: generated.personal_tax_period === 'monthly' ? 'monthly' : 'annual',
      corporate_tax_rate: Number(generated.corporate_tax_rate) || 0,
      vat_rate: Number(generated.vat_rate) || 0,
      capital_gains_rate: Number(generated.capital_gains_rate) || 0,
      deductible_expenses: Array.isArray(generated.deductible_expenses) ? generated.deductible_expenses : [],
      filing_date: generated.filing_date || null,
      regulatory_body: generated.regulatory_body || null,
      requirements: Array.isArray(generated.requirements) ? generated.requirements : [],
      source: 'ai_generated',
      source_citation: `AI-generated estimate (${generated.__provider}) — not independently verified`,
      last_verified_at: new Date().toISOString()
    };

    const { data: upserted, error: upsertError } = await adminSupabase
      .from('country_tax_rules')
      .upsert(row, { onConflict: 'country_code' })
      .select('*')
      .single();

    if (upsertError) {
      console.error('❌ Failed to cache AI-generated tax rules:', upsertError);
      // Still return the freshly generated data even if caching failed.
      return res.status(200).json(row);
    }

    return res.status(200).json(upserted);
  } catch (err) {
    console.error('❌ tax-rules route error:', err);
    return res.status(500).json({ error: 'Internal error', message: err.message });
  }
});

module.exports = router;
