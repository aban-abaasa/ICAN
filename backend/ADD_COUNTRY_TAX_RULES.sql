-- ============================================================================
-- Global, non-user-scoped reference table of per-country tax rules, backing
-- the AI-assisted worldwide tax engine in advancedReportService.js.
--
-- Problem: tax rules used to live only as a hardcoded 5-country JS object
-- (COUNTRY_REGULATIONS in advancedReportService.js) with a flat personal tax
-- rate. That doesn't scale to ICAN being a worldwide app (users pick any
-- country at signup — user_accounts.country_code), and a flat rate is wrong
-- for most countries' progressive personal income tax.
--
-- Design: two-tier data.
--   - 'verified'     rows are hand-researched with a cited source, seeded
--                     once below, and never silently overwritten by an AI
--                     refresh (see backend/routes/taxRulesRoutes.js).
--   - 'ai_generated' rows are produced on-demand by the backend route when a
--                     user picks a country with no row here yet, using
--                     OpenAI, and refreshed periodically (last_verified_at).
--
-- This table is NOT user-scoped (unlike country_tax_settings, which stores a
-- user's own tax ID per country in CREATE_ADVANCED_FINANCIAL_REPORTS_SCHEMA.sql).
-- It is shared reference data: readable by any authenticated user, but only
-- writable by the backend's service-role key — the browser must never write
-- shared tax data directly.
--
-- Run once in Supabase SQL Editor. Safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.country_tax_rules (
  id BIGSERIAL PRIMARY KEY,
  country_code VARCHAR(2) NOT NULL UNIQUE,
  country_name VARCHAR(100) NOT NULL,
  currency VARCHAR(10) NOT NULL,

  -- Progressive personal income tax bands, e.g.
  -- [{"upTo": 235000, "rate": 0}, {"upTo": 335000, "rate": 0.10}, {"upTo": null, "rate": 0.40}]
  -- "upTo": null marks the top (uncapped) band. Rates apply marginally.
  personal_tax_brackets JSONB NOT NULL DEFAULT '[]',
  personal_tax_period VARCHAR(10) NOT NULL DEFAULT 'annual' CHECK (personal_tax_period IN ('annual', 'monthly')),

  corporate_tax_rate NUMERIC NOT NULL DEFAULT 0,
  vat_rate NUMERIC NOT NULL DEFAULT 0,
  capital_gains_rate NUMERIC NOT NULL DEFAULT 0,

  deductible_expenses JSONB NOT NULL DEFAULT '[]',
  filing_date VARCHAR(50),
  regulatory_body VARCHAR(255),
  requirements JSONB NOT NULL DEFAULT '[]',

  source TEXT NOT NULL DEFAULT 'ai_generated' CHECK (source IN ('verified', 'ai_generated')),
  source_citation TEXT,
  last_verified_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_country_tax_rules_country_code ON public.country_tax_rules(country_code);

CREATE OR REPLACE FUNCTION public.update_country_tax_rules_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_country_tax_rules_updated_at ON public.country_tax_rules;
CREATE TRIGGER trg_country_tax_rules_updated_at
  BEFORE UPDATE ON public.country_tax_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_country_tax_rules_updated_at();

ALTER TABLE public.country_tax_rules ENABLE ROW LEVEL SECURITY;

-- Shared reference data: any authenticated user can read it (needed so the
-- frontend can show the source/last-verified badge), nobody can write it
-- from the browser — only the backend's service-role key (which bypasses
-- RLS entirely) populates/refreshes rows via POST /api/tax-rules/:countryCode.
DROP POLICY IF EXISTS "authenticated_can_read_country_tax_rules" ON public.country_tax_rules;
CREATE POLICY "authenticated_can_read_country_tax_rules"
  ON public.country_tax_rules FOR SELECT
  TO authenticated
  USING (true);

COMMENT ON TABLE public.country_tax_rules IS 'Global (non-user-scoped) per-country tax rules: a small hand-verified core plus AI-generated/cached rows for worldwide coverage. Written only by the backend service role.';

-- ============================================================================
-- SEED: verified tier for the countries ICAN has historically supported
-- (previously the hardcoded COUNTRY_REGULATIONS in advancedReportService.js).
-- Personal tax restructured from a flat rate into real progressive PAYE/
-- income-tax bands. Each row cites its source; re-verify before relying on
-- these for an actual filing, and periodically re-check against the cited
-- authority since rates change.
-- ============================================================================

INSERT INTO public.country_tax_rules (
  country_code, country_name, currency, personal_tax_brackets, personal_tax_period,
  corporate_tax_rate, vat_rate, capital_gains_rate,
  deductible_expenses, filing_date, regulatory_body, requirements,
  source, source_citation, last_verified_at
) VALUES
(
  'UG', 'Uganda', 'UGX',
  '[{"upTo":335000,"rate":0},{"upTo":410000,"rate":0.20},{"upTo":485000,"rate":0.25},{"upTo":10000000,"rate":0.30},{"upTo":null,"rate":0.40}]'::jsonb,
  'monthly',
  0.30, 0.18, 0.30,
  '["business_expenses","depreciation","employee_salaries","utilities","office_equipment","professional_fees","advertising"]'::jsonb,
  'June 30',
  'Uganda Revenue Authority (URA)',
  '["Itemized expense records","Income source documentation","Investment proof","Business registration"]'::jsonb,
  'verified',
  'PAYE bands per Income Tax (Amendment) Act 2026, effective Jul 2026 — a very recent law; secondary sources conflicted on the 335k-410k band rate (10% vs 20%), resolved via ChimpReports quoting URA''s announcement, cross-checked against MRT Tax''s annual table. RECOMMEND a direct URA gazette check before relying on this. Corporate/VAT: taxsummaries.pwc.com/uganda. Capital gains: Uganda has NO separate CGT law (ura.go.ug/en/taxation-of-capital-gains) — gains are added to ordinary income and taxed at progressive personal/corporate rates; the 30% here approximates the modal band, it is not a distinct CGT rate.',
  '2026-08-31'
),
(
  'KE', 'Kenya', 'KES',
  '[{"upTo":24000,"rate":0.10},{"upTo":32333,"rate":0.25},{"upTo":500000,"rate":0.30},{"upTo":800000,"rate":0.325},{"upTo":null,"rate":0.35}]'::jsonb,
  'monthly',
  0.30, 0.16, 0.15,
  '["business_expenses","depreciation","employee_salaries","utilities","office_rent","insurance"]'::jsonb,
  'June 30',
  'Kenya Revenue Authority (KRA)',
  '["PIN (Personal Identification Number)","Monthly ITR filing","Expense receipts","Bank statements"]'::jsonb,
  'verified',
  'PAYE bands per Finance Act 2023, current as of 2026 (taxsummaries.pwc.com/kenya). Does not net the monthly personal relief of KES 2,400 against tax payable — a simplification. Capital gains 15% standard rate confirmed. NOTE: Finance Act 2026 moves the individual filing deadline to Apr 30 for returns filed from Jan 1, 2027 onward — June 30 shown here is the deadline still in effect through the 2026 filing season.',
  '2026-08-31'
),
(
  'TZ', 'Tanzania', 'TZS',
  '[{"upTo":270000,"rate":0},{"upTo":520000,"rate":0.08},{"upTo":760000,"rate":0.20},{"upTo":1000000,"rate":0.25},{"upTo":null,"rate":0.30}]'::jsonb,
  'monthly',
  0.30, 0.18, 0.10,
  '["business_expenses","employee_compensation","utilities","office_supplies","professional_services"]'::jsonb,
  'June 30',
  'Tanzania Revenue Authority (TRA)',
  '["TIN (Tax Identification Number)","Expense documentation","Income records","Annual reconciliation"]'::jsonb,
  'verified',
  'PAYE bands per taxsummaries.pwc.com/tanzania (reviewed Jan 2026); one secondary source quoted 9% instead of 8% for the second band — PwC''s 8% used as the more authoritative figure, recommend a spot-check against TRA''s "Taxes and Duties at a Glance 2025/2026". Capital gains structured as a realization tax: 10% standard on net gain used here (a 3% alternate rate applies on gross proceeds when cost-basis records are unavailable) — not a classic flat CGT.',
  '2026-08-31'
),
(
  'RW', 'Rwanda', 'RWF',
  '[{"upTo":60000,"rate":0},{"upTo":200000,"rate":0.20},{"upTo":null,"rate":0.30}]'::jsonb,
  'monthly',
  0.28, 0.18, 0.10,
  '["business_operating_expenses","employee_salaries","utilities","insurance","depreciation"]'::jsonb,
  'March 31',
  'Rwanda Revenue Authority (RRA)',
  '["TIN registration","Monthly VAT returns","Quarterly tax payments","Detailed transaction logs"]'::jsonb,
  'verified',
  'PAYE bands per PwC Rwanda (reviewed Feb 2026) collapse the 60k-100k and 100k-200k tiers to the same 20% rate — some sources describe a transitional 10% for the lower of those two; RECOMMEND verifying against RRA''s own PAYE calculator/Income Tax Law text before relying on this. Corporate tax corrected to 28% (reduced from 30% under Law No. 051/2023, effective 2024) — the app previously had this wrong at 30%. Capital gains: 10% general rate used here; a separate 30% rate applies specifically to commercial immovable property, not modeled.',
  '2026-08-31'
),
(
  'US', 'United States', 'USD',
  '[{"upTo":12400,"rate":0.10},{"upTo":50400,"rate":0.12},{"upTo":105700,"rate":0.22},{"upTo":201775,"rate":0.24},{"upTo":256225,"rate":0.32},{"upTo":640600,"rate":0.35},{"upTo":null,"rate":0.37}]'::jsonb,
  'annual',
  0.21, 0, 0.15,
  '["business_expenses","home_office","vehicle_expenses","education","medical_insurance","retirement_contributions"]'::jsonb,
  'April 15',
  'Internal Revenue Service (IRS)',
  '["EIN or SSN","Form 1099s","Schedule C (Self-employed)","Qualified business expense documentation"]'::jsonb,
  'verified',
  'Federal single-filer brackets for tax year 2026 per Tax Foundation, citing IRS Rev. Proc. 2025-32 (taxfoundation.org/data/all/federal/2026-tax-brackets). Federal only — state income tax not modeled. Capital gains: long-term federal rate is actually a progressive 0%/15%/20% schedule by income tier (plus a possible 3.8% NIIT surcharge above $200k MAGI); 15% used here as the single flat figure this schema supports — a simplification of ustax.tools 2026 LTCG brackets, not independently confirmed against IRS.gov directly.',
  '2026-08-31'
)
ON CONFLICT (country_code) DO UPDATE SET
  country_name = EXCLUDED.country_name,
  currency = EXCLUDED.currency,
  personal_tax_brackets = EXCLUDED.personal_tax_brackets,
  personal_tax_period = EXCLUDED.personal_tax_period,
  corporate_tax_rate = EXCLUDED.corporate_tax_rate,
  vat_rate = EXCLUDED.vat_rate,
  capital_gains_rate = EXCLUDED.capital_gains_rate,
  deductible_expenses = EXCLUDED.deductible_expenses,
  filing_date = EXCLUDED.filing_date,
  regulatory_body = EXCLUDED.regulatory_body,
  requirements = EXCLUDED.requirements,
  source = EXCLUDED.source,
  source_citation = EXCLUDED.source_citation,
  last_verified_at = EXCLUDED.last_verified_at
WHERE public.country_tax_rules.source = 'verified';
-- ^ only ever overwrite verified rows with this seed (never clobber an
--   ai_generated row that happens to share a code we later add here).

SELECT 'country_tax_rules table created and seeded' AS status;
