-- ============================================================================
-- Adds a country to business_profiles (Pitch In) so a financial report
-- generated for a specific business can use where that business is actually
-- registered, instead of only the investor-user's personal signup country
-- (user_accounts.country_code, via useCountry.js) — which may differ from
-- the business's own country.
--
-- Report country resolution order (see AdvancedFinancialReports.jsx /
-- MobileView.jsx): selected business's business_profiles.country, if set
-- and a specific Pitch In business is chosen for the report -> the user's
-- own user_accounts.country_code -> manual picker as a last resort.
--
-- Run once in Supabase SQL Editor. Safe to re-run.
-- ============================================================================

ALTER TABLE public.business_profiles
  ADD COLUMN IF NOT EXISTS country VARCHAR(2);

COMMENT ON COLUMN public.business_profiles.country IS 'ISO 3166-1 alpha-2 code of the country this business is registered/operates in. Drives which country''s tax rules (country_tax_rules) a report generated for this business defaults to.';

-- No new RLS policy needed: this column is covered by the existing
-- "owner_update_share_config"-style policies already on business_profiles
-- (owner or co-owner can update their own profile) — see
-- 04_business_profiles_blockchain.sql for the base SELECT/INSERT/UPDATE
-- policies this column inherits.

SELECT 'business_profiles.country column added' AS status;
