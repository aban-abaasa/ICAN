-- ============================================================
-- ICANera push: let every app in the shared project register its own devices
-- ============================================================
-- ICAN, SupermartKera (digital-city-era), Farm Agent and BodaGoEra (mybodaguy)
-- share ONE Supabase project, ONE VAPID key pair, ONE relay (the "wallet-push"
-- Edge Function) and ONE device table (ican_wallet_push_subscriptions).
-- A push subscription belongs to the ORIGIN it was created on, so a phone that
-- enabled alerts inside SupermartKera or BodaGoEra needs its own row - tagged
-- with the app it came from, so the relay can send a ride request to the
-- BodaGoEra phone and open the right screen when it is tapped.
--
-- This file adds only three things:
--   1. ican_wallet_push_subscriptions.application_id  (which app the device is)
--   2. ican_register_app_push_subscription(subscription, application_id)
--      - a NEW function name, so it cannot clash with the two overloads of
--        ican_register_wallet_push_subscription described in
--        ICAN_WALLET_PUSH_FIX_DUPLICATE_OVERLOAD.sql
--   3. ican_push_relay(body) - one private helper every push trigger calls, so
--      the relay URL and webhook secret live in ONE place instead of being
--      pasted into every SQL file.
--
-- The webhook secret is NOT written in this file. It is copied, once, from the
-- ican_dispatch_wallet_push_webhook() function that ICAN_SHARED_WALLET_PUSH_SETUP.sql
-- already installed, into a table no browser can read.
--
-- Run AFTER ICAN_CROSS_APP_WALLET_NOTIFICATIONS.sql and
-- ICAN_SHARED_WALLET_PUSH_SETUP.sql. Safe to run more than once.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_net;

-- 1. Which app registered the device ---------------------------------------
ALTER TABLE public.ican_wallet_push_subscriptions
  ADD COLUMN IF NOT EXISTS application_id TEXT NOT NULL DEFAULT 'ican';

-- 2. Registration RPC --------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ican_register_app_push_subscription(
  p_subscription   JSONB,
  p_application_id TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NULLIF(p_subscription ->> 'endpoint', '') IS NULL THEN
    RAISE EXCEPTION 'A signed-in user and a valid push subscription are required';
  END IF;
  IF p_application_id NOT IN ('ican', 'digital-city-era', 'farm-agent', 'mybodaguy') THEN
    RAISE EXCEPTION 'Unknown application: %', p_application_id;
  END IF;

  INSERT INTO public.ican_wallet_push_subscriptions
    (user_id, endpoint, subscription, user_agent, is_active, application_id)
  VALUES
    (auth.uid(), p_subscription ->> 'endpoint', p_subscription,
     current_setting('request.headers', TRUE)::JSONB ->> 'user-agent', TRUE, p_application_id)
  ON CONFLICT (endpoint) DO UPDATE
    SET user_id = EXCLUDED.user_id,
        subscription = EXCLUDED.subscription,
        application_id = EXCLUDED.application_id,
        is_active = TRUE,
        updated_at = now();
  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.ican_register_app_push_subscription(JSONB, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ican_register_app_push_subscription(JSONB, TEXT) TO authenticated;

-- 3. Private relay config + helper -------------------------------------------
CREATE TABLE IF NOT EXISTS public.ican_push_relay_config (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
ALTER TABLE public.ican_push_relay_config ENABLE ROW LEVEL SECURITY;  -- no policies: API roles cannot read it
REVOKE ALL ON TABLE public.ican_push_relay_config FROM PUBLIC, anon, authenticated;

-- Copy the relay URL + secret out of the existing wallet trigger function.
DO $$
DECLARE
  v_def    TEXT;
  v_secret TEXT;
  v_url    TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM public.ican_push_relay_config WHERE key = 'webhook_secret') THEN
    RETURN;
  END IF;

  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'ican_dispatch_wallet_push_webhook'
   LIMIT 1;

  IF v_def IS NULL THEN
    RAISE NOTICE 'ican_dispatch_wallet_push_webhook() not found - run ICAN_SHARED_WALLET_PUSH_SETUP.sql first, or insert the two ican_push_relay_config rows by hand (keys: relay_url, webhook_secret).';
    RETURN;
  END IF;

  v_secret := substring(v_def FROM 'v_webhook_secret CONSTANT TEXT := ''([^'']+)''');
  v_url    := substring(v_def FROM 'url := ''([^'']+)''');

  IF v_secret IS NULL OR v_url IS NULL THEN
    RAISE NOTICE 'Could not read the relay URL/secret from ican_dispatch_wallet_push_webhook() - insert ican_push_relay_config rows (relay_url, webhook_secret) by hand.';
    RETURN;
  END IF;

  INSERT INTO public.ican_push_relay_config (key, value) VALUES ('webhook_secret', v_secret), ('relay_url', v_url)
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
END;
$$;

CREATE OR REPLACE FUNCTION public.ican_push_relay(p_body JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret TEXT;
  v_url    TEXT;
BEGIN
  SELECT value INTO v_secret FROM public.ican_push_relay_config WHERE key = 'webhook_secret';
  SELECT value INTO v_url    FROM public.ican_push_relay_config WHERE key = 'relay_url';
  IF v_secret IS NULL OR v_url IS NULL THEN
    RAISE NOTICE 'Push relay is not configured (ican_push_relay_config is empty) - push skipped.';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := v_url,
    body := p_body,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-ican-wallet-webhook-secret', v_secret),
    timeout_milliseconds := 10000
  );
EXCEPTION WHEN OTHERS THEN
  -- Never let a push-delivery hiccup block the ride, message or payment that caused it.
  RAISE NOTICE 'Push relay call failed - %', SQLERRM;
END;
$$;

-- Only other SECURITY DEFINER functions (owned by the same role) call this.
REVOKE ALL ON FUNCTION public.ican_push_relay(JSONB) FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';

SELECT CASE WHEN EXISTS (SELECT 1 FROM public.ican_push_relay_config WHERE key = 'webhook_secret')
            THEN 'Push registration ready: relay config found'
            ELSE 'Push registration ready, BUT relay config is empty - see the NOTICE above' END AS status;
