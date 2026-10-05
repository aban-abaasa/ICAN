-- Rollback for: Security Center (migration 20261003091500_security_center).
-- Drops the four read/revoke functions. Nothing else was created, and no data is lost.
BEGIN;
DROP FUNCTION IF EXISTS public.ican_security_password_changed_at();
DROP FUNCTION IF EXISTS public.ican_security_activity(INTEGER);
DROP FUNCTION IF EXISTS public.ican_security_revoke_session(UUID);
DROP FUNCTION IF EXISTS public.ican_security_list_sessions();
NOTIFY pgrst, 'reload schema';
COMMIT;
