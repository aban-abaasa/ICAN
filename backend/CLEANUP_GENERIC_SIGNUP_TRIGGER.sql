-- ============================================================================
-- RUN THIS LAST — only after all three of the following have been applied:
--   ICAN/backend/FIX_AUTO_SIGNUP_TRIGGER_NAMESPACE_ICAN.sql
--   digital-city-era/backend/database/FIX_AUTO_SIGNUP_TRIGGER_NAMESPACE_DCE.sql
--   FARM-AGENT/backend/FIX_AUTO_SIGNUP_TRIGGER_NAMESPACE_FARMAGENT.sql
-- ============================================================================
-- Each app now has its own independently-named trigger
-- (on_auth_user_created_ican / _dce / _farmagent / mybodaguy's existing
-- on_auth_user_created_mbg), so the old shared generic-named trigger is now
-- redundant. Drop it so nobody accidentally resurrects the collision by
-- re-running an old CREATE_AUTO_SIGNUP_TRIGGERS.sql / FIX_AUTO_SIGNUP_
-- TRIGGER.sql / 01_auth_tables.sql copy later.
-- ============================================================================

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

DO $$
BEGIN
  RAISE NOTICE '✅ Generic on_auth_user_created trigger removed. All 4 apps now run their own independent, non-colliding signup trigger.';
END $$;
