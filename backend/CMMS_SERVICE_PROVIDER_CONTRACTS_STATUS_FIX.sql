-- ============================================================
-- CMMS Service Provider Contracts -- status backfill/lockdown fix.
--
-- cmms_service_provider_contracts.status is documented (CMMS_SERVICE_
-- PROVIDER_CONTRACTS.sql) as CHECK (status IN ('published', 'revoked')),
-- DEFAULT 'published' -- and fn_publish_service_provider_contract's INSERT
-- never sets status at all, relying on that default. So the app can only
-- ever produce 'published' or (via revoke) 'revoked' rows.
--
-- But CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS are no-ops
-- against a table that already exists -- so if this table was originally
-- created with a different default/CHECK (e.g. the same DEFAULT 'draft'
-- pattern used by cmms_job_postings, cmms_employment_documents,
-- cmms_written_tests in this app), that original default/constraint is
-- still what's live today, never actually replaced by the file above.
-- That produced contracts stuck at status='draft': invisible to the
-- 'published'-only staff action buttons (CMMSServiceProviderContractPanel.
-- jsx) AND rejected by the public link's own status='published' gate
-- (fn_get_service_provider_contract_public / fn_verify_*), even though the
-- row has a real access_token and was created through "Publish & Get
-- Link" with no separate draft-editing step anywhere in the UI.
--
-- This backfills any such stale row to 'published' (the only status the
-- current UI ever intends for a freshly created contract) and pins down
-- the default + CHECK so a table created under an older schema converges
-- on the same rules the current code assumes.
--
-- Run after: CMMS_SERVICE_PROVIDER_CONTRACTS.sql.
-- Safe to run more than once.
-- ============================================================

UPDATE public.cmms_service_provider_contracts
SET status = 'published'
WHERE status NOT IN ('published', 'revoked');

ALTER TABLE public.cmms_service_provider_contracts
  ALTER COLUMN status SET DEFAULT 'published';

ALTER TABLE public.cmms_service_provider_contracts
  DROP CONSTRAINT IF EXISTS cmms_service_provider_contracts_status_check;
ALTER TABLE public.cmms_service_provider_contracts
  ADD CONSTRAINT cmms_service_provider_contracts_status_check
  CHECK (status IN ('published', 'revoked'));

SELECT 'CMMS service provider contracts status backfilled to published/revoked and locked down' AS status;
