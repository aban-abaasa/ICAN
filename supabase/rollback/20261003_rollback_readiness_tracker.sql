-- Rollback for: Readiness tracker (migration 20261003092000_readiness_tracker).
-- DESTRUCTIVE: drops the three readiness tables and every row in them (checklist progress,
-- connected Google links, settings). Take a backup first if any of that data matters.
BEGIN;
DROP TABLE IF EXISTS public.ican_readiness_links;
DROP TABLE IF EXISTS public.ican_readiness_progress;
DROP TABLE IF EXISTS public.ican_readiness_settings;
DROP FUNCTION IF EXISTS public.ican_readiness_touch();
NOTIFY pgrst, 'reload schema';
COMMIT;
