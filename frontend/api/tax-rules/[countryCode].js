/**
 * Vercel Serverless Function — worldwide tax engine
 *
 * Backs advancedReportService.js's tax return / balance sheet / income
 * statement generation. Two-tier lookup against public.country_tax_rules
 * (a shared, non-user-scoped reference table):
 *   - 'verified' rows were hand-researched and seeded via
 *     backend/ADD_COUNTRY_TAX_RULES.sql — never overwritten here.
 *   - 'ai_generated' rows are produced on first request for a country with
 *     no cached row (or a stale one) via callAI() (OpenAI and/or Gemini,
 *     see api/_lib/aiProvider.js), then cached so we don't re-ask on every
 *     report.
 *
 * Talks to Supabase over its REST API directly (no @supabase/supabase-js —
 * that package isn't a dependency of the root api/ workspace; see the same
 * pattern in api/report-automation.js) using the service-role key. This is
 * shared reference data: the browser must never be able to write it
 * directly (see country_tax_rules' RLS policy — read-only for authenticated,
 * no INSERT/UPDATE grant at all), so writes only ever happen here.
 *
 * Requires env vars:
 * - SUPABASE_URL
 * - SUPABASE_SERVICE_ROLE_KEY
 * - OPENAI_API_KEY and/or GEMINI_API_KEY (for countries with no cached row)
 *
 * Route: GET /api/tax-rules/:countryCode
 */

import { callAI } from '../_lib/aiProvider.js';

const TABLE = 'country_tax_rules';
const AI_REFRESH_WINDOW_DAYS = 90;

const supabaseRequest = async ({ url, serviceKey, path, method = 'GET', query, body, prefer }) => {
  const endpoint = new URL(`${url}/rest/v1/${path}`);
  if (query) {
    Object.entries(query).forEach(([key, value]) => {
      endpoint.searchParams.set(key, value);
    });
  }

  const response = await fetch(endpoint.toString(), {
    method,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Supabase request failed (${response.status}): ${text}`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) return response.json();
  return null;
};

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

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return res.status(500).json({ error: 'Server is missing Supabase configuration.' });
  }

  const countryCode = String(req.query.countryCode || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(countryCode)) {
    return res.status(400).json({ error: 'countryCode must be a 2-letter ISO country code' });
  }

  try {
    const rows = await supabaseRequest({
      url,
      serviceKey,
      path: TABLE,
      query: { select: '*', country_code: `eq.${countryCode}`, limit: '1' }
    });
    const existing = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;

    if (existing && !isStale(existing)) {
      return res.status(200).json(existing);
    }

    let generated;
    try {
      generated = await fetchAiGeneratedTaxRules(countryCode);
    } catch (aiError) {
      if (existing) {
        console.warn(`AI refresh failed for ${countryCode}, serving stale cached row:`, aiError.message);
        return res.status(200).json(existing);
      }
      console.error(`Could not generate tax rules for ${countryCode}:`, aiError.message);
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

    try {
      const upserted = await supabaseRequest({
        url,
        serviceKey,
        path: `${TABLE}?on_conflict=country_code`,
        method: 'POST',
        body: row,
        prefer: 'resolution=merge-duplicates,return=representation'
      });
      return res.status(200).json(Array.isArray(upserted) ? upserted[0] : row);
    } catch (upsertError) {
      console.error('Failed to cache AI-generated tax rules:', upsertError.message);
      // Still return the freshly generated data even if caching failed.
      return res.status(200).json(row);
    }
  } catch (err) {
    console.error('tax-rules route error:', err);
    return res.status(500).json({ error: 'Internal error', message: err.message });
  }
}
