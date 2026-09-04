-- Fix: "Could not choose the best candidate function between:
-- ican_register_wallet_push_subscription(p_subscription => jsonb),
-- ican_register_wallet_push_subscription(p_subscription => jsonb, p_application_id => text)"
--
-- Two overloads of this function exist live in the shared wallet database
-- (ICAN, Digital City Era, FARM-AGENT and MyBodaGuy all share it):
--   1. ican_register_wallet_push_subscription(p_subscription jsonb)                       -- old, tracked in
--      ICAN_CROSS_APP_WALLET_NOTIFICATIONS.sql, superseded but never dropped
--   2. ican_register_wallet_push_subscription(p_subscription jsonb, p_application_id text
--      DEFAULT 'ican') -- newer, cross-app-aware (writes application_id, validates it
--      against the four sibling apps) -- not tracked anywhere in this repo, so it must
--      have been added directly in the SQL editor, presumably by one of the sibling apps
--
-- Every "Enable phone alerts" call across every app in this shared project passes only
-- p_subscription, which both overloads accept -- Postgres refuses to pick one. Since
-- overload 2 fully covers overload 1's calling convention via its default parameter,
-- dropping overload 1 fixes every caller (this app and the three siblings) with no loss
-- of behavior.
--
-- Safe to run more than once.

DROP FUNCTION IF EXISTS public.ican_register_wallet_push_subscription(jsonb);

NOTIFY pgrst, 'reload schema';

SELECT 'Dropped the old single-argument overload; only the cross-app-aware version remains' AS status;
