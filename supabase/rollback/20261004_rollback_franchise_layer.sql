-- Rollback for: Franchise layer (migration 20261004100000_franchise_layer).
--
-- WHAT THIS DOES
--   Detaches the franchise trigger from ican_business_wallet_settlements, drops every
--   ican_franchise_* function, and DROPS THE ican_franchise_* TABLES (partners, rate card,
--   assignments, revenue events, payable lines, statements, landing-page enquiries, the admin
--   allowlist, audit log).
--
-- WHAT IT DOES NOT TOUCH
--   Platform fees, wallets and settlements are untouched: HQ keeps receiving 100% of every
--   fee exactly as before the franchise layer existed.
--
-- BEFORE YOU RUN IT
--   The franchise ledger is destroyed. If any statement was paid, or any partner is owed
--   money, export it first, for example in the SQL editor:
--     \copy (SELECT * FROM public.ican_franchise_payable_lines) TO 'lines.csv' CSV HEADER
--     \copy (SELECT * FROM public.ican_franchise_statements)    TO 'statements.csv' CSV HEADER
--   Switching the program off without losing anything is safer:
--     SELECT public.ican_franchise_admin_save_settings('{"enabled": false}');
--   (the trigger then records nothing, and every table and balance stays intact).
BEGIN;

-- Stop the daily tier refresh if pg_cron is installed.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('ican-franchise-tiers');
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL; -- job was never scheduled
END $$;

-- The hook into the fee ledger goes first, so no fee can fire it half-removed.
DO $$
BEGIN
  IF to_regclass('public.ican_business_wallet_settlements') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_ican_franchise_on_fee_settlement ON public.ican_business_wallet_settlements;
  END IF;
END $$;

-- Tables, children before parents. (CASCADE removes their triggers and policies.)
DROP TABLE IF EXISTS public.ican_franchise_enquiries            CASCADE;
DROP TABLE IF EXISTS public.ican_franchise_payable_lines        CASCADE;
DROP TABLE IF EXISTS public.ican_franchise_statements           CASCADE;
DROP TABLE IF EXISTS public.ican_franchise_revenue_events       CASCADE;
DROP TABLE IF EXISTS public.ican_franchise_customer_assignments CASCADE;
DROP TABLE IF EXISTS public.ican_franchise_split_rules          CASCADE;
DROP TABLE IF EXISTS public.ican_franchise_partners             CASCADE;
DROP TABLE IF EXISTS public.ican_franchise_territories          CASCADE;
DROP TABLE IF EXISTS public.ican_franchise_demand_signals       CASCADE;
DROP TABLE IF EXISTS public.ican_franchise_allocation_errors    CASCADE;
DROP TABLE IF EXISTS public.ican_franchise_audit_log            CASCADE;
DROP TABLE IF EXISTS public.ican_franchise_admins               CASCADE;
DROP TABLE IF EXISTS public.ican_franchise_settings             CASCADE;

-- Every function the migration created (signatures as created).
DROP FUNCTION IF EXISTS public.ican_franchise_admin_revoke_admin(UUID);
DROP FUNCTION IF EXISTS public.ican_franchise_admin_grant_admin(TEXT, TEXT);
DROP FUNCTION IF EXISTS public.ican_franchise_admin_list_admins();
DROP FUNCTION IF EXISTS public.ican_franchise_admin_convert_enquiry(UUID);
DROP FUNCTION IF EXISTS public.ican_franchise_admin_set_enquiry_status(UUID, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.ican_franchise_admin_list_enquiries(TEXT, INTEGER);
DROP FUNCTION IF EXISTS public.ican_franchise_admin_backfill(TIMESTAMPTZ);
DROP FUNCTION IF EXISTS public.ican_franchise_admin_retry_errors();
DROP FUNCTION IF EXISTS public.ican_franchise_admin_void_event(UUID, TEXT);
DROP FUNCTION IF EXISTS public.ican_franchise_admin_list_statements(TEXT, INTEGER);
DROP FUNCTION IF EXISTS public.ican_franchise_admin_void_statement(UUID);
DROP FUNCTION IF EXISTS public.ican_franchise_admin_mark_statement_paid(UUID, TEXT);
DROP FUNCTION IF EXISTS public.ican_franchise_admin_approve_statement(UUID);
DROP FUNCTION IF EXISTS public.ican_franchise_admin_generate_statements(DATE, DATE);
DROP FUNCTION IF EXISTS public.ican_franchise_admin_save_settings(JSONB);
DROP FUNCTION IF EXISTS public.ican_franchise_admin_save_rule(TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, BOOLEAN, TEXT);
DROP FUNCTION IF EXISTS public.ican_franchise_admin_save_territory(TEXT, TEXT, INTEGER, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.ican_franchise_admin_assign_customer(UUID, UUID);
DROP FUNCTION IF EXISTS public.ican_franchise_admin_terminate_partner(UUID, UUID, TEXT);
DROP FUNCTION IF EXISTS public.ican_franchise_admin_set_status(UUID, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.ican_franchise_admin_save_partner(UUID, JSONB);
DROP FUNCTION IF EXISTS public.ican_franchise_admin_list_partners(TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.ican_franchise_admin_overview();
DROP FUNCTION IF EXISTS public.ican_franchise_submit_enquiry(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT[], TEXT, INTEGER, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.ican_franchise_public_overview();
DROP FUNCTION IF EXISTS public.ican_franchise_my_agency(UUID);
DROP FUNCTION IF EXISTS public.ican_franchise_release_agency(UUID);
DROP FUNCTION IF EXISTS public.ican_franchise_claim_agency(TEXT, UUID);
DROP FUNCTION IF EXISTS public.ican_franchise_my_customers(UUID, INTEGER);
DROP FUNCTION IF EXISTS public.ican_franchise_my_earnings(UUID, INTEGER);
DROP FUNCTION IF EXISTS public.ican_franchise_my_summary();
DROP FUNCTION IF EXISTS public.ican_franchise_apply(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT[], UUID, TEXT);
DROP FUNCTION IF EXISTS public.ican_franchise_refresh_tiers();
DROP FUNCTION IF EXISTS public.ican_franchise_tier_for(INTEGER);
DROP FUNCTION IF EXISTS public.ican_franchise_active_accounts(UUID);
DROP FUNCTION IF EXISTS public.ican_franchise_on_fee_settlement();
DROP FUNCTION IF EXISTS public.ican_franchise_reverse(TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.ican_franchise_allocate(TEXT, TEXT, NUMERIC, TEXT, UUID, UUID, JSONB);
DROP FUNCTION IF EXISTS public.ican_franchise_lines_immutable();
DROP FUNCTION IF EXISTS public.ican_franchise_events_immutable();
DROP FUNCTION IF EXISTS public.ican_franchise_validate_partner();
DROP FUNCTION IF EXISTS public.ican_franchise_make_code(TEXT, TEXT);
DROP FUNCTION IF EXISTS public.ican_franchise_country_of(UUID, UUID);
DROP FUNCTION IF EXISTS public.ican_franchise_country_from_name(TEXT);
DROP FUNCTION IF EXISTS public.ican_franchise_product_for(TEXT);
DROP FUNCTION IF EXISTS public.ican_franchise_stream_for(TEXT, TEXT);
DROP FUNCTION IF EXISTS public.ican_franchise_audit(TEXT, TEXT, TEXT, JSONB);
DROP FUNCTION IF EXISTS public.ican_franchise_my_business_ids();
DROP FUNCTION IF EXISTS public.ican_franchise_downline_ids();
DROP FUNCTION IF EXISTS public.ican_franchise_my_partner_ids();
DROP FUNCTION IF EXISTS public.ican_franchise_require_admin();
DROP FUNCTION IF EXISTS public.ican_franchise_is_hq_admin();
DROP FUNCTION IF EXISTS public.ican_franchise_is_service();

NOTIFY pgrst, 'reload schema';
COMMIT;
