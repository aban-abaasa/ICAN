-- ============================================================
-- CMMS Notifications: deliver as real phone push notifications
-- ============================================================
-- Problem: cmms_notifications only ever fed the in-app bell
-- (NotificationsPanel.jsx / MobileView's universal notifications list).
-- Nothing popped up on the phone the way Gmail does when the app isn't
-- open/focused.
--
-- ICAN already has a working push pipeline for the shared wallet inbox
-- (see ICAN_SHARED_WALLET_PUSH_SETUP.sql + ICAN_CROSS_APP_WALLET_
-- NOTIFICATIONS.sql: ican_wallet_push_subscriptions holds each signed-in
-- user's browser/device push subscription, and the "wallet-push" Edge
-- Function sends the actual Web Push message). This migration reuses that
-- SAME subscription table and relay instead of building a second one -
-- anyone who has already turned on "Push notifications (phone alerts)" in
-- Settings starts getting CMMS pushes with no extra opt-in.
--
-- Run this AFTER:
--   1. ICAN_CROSS_APP_WALLET_NOTIFICATIONS.sql (creates
--      ican_wallet_push_subscriptions + pg_net)
--   2. CMMS_TASK_NOTIFICATION_DEEPLINK.sql (adds cmms_notifications.
--      related_task_id, used below so a tapped push can open the exact task)
--
-- You must also redeploy the "wallet-push" Edge Function
-- (backend/supabase/functions/wallet-push/index.ts) after this - it was
-- updated to handle both wallet and CMMS notification payloads.
-- Safe to run more than once.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.ican_dispatch_cmms_push_webhook()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Same relay + secret as the wallet push webhook (ICAN_SHARED_WALLET_
  -- PUSH_SETUP.sql) - one relay, shared across ICAN's notification sources.
  v_webhook_secret CONSTANT TEXT := 'MpaszdslwCEBCXBsVjXi6P5XXRhlfUZ2fryVUitOycU';
  v_recipient_user_id UUID;
BEGIN
  -- cmms_notifications.cmms_user_id is a cmms_users.id, not an auth user id.
  -- Resolve it the same way the rest of CMMS resolves identity: by email.
  SELECT au.id INTO v_recipient_user_id
    FROM public.cmms_users cu
    JOIN auth.users au ON LOWER(TRIM(au.email)) = LOWER(TRIM(cu.email))
   WHERE cu.id = NEW.cmms_user_id
   LIMIT 1;

  IF v_recipient_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := 'https://hswxazpxcgtqbxeqcxxw.supabase.co/functions/v1/wallet-push',
    body := jsonb_build_object(
      'id', NEW.id,
      'recipient_user_id', v_recipient_user_id,
      'title', NEW.title,
      'message', NEW.message,
      'source', 'cmms',
      'action_tab', NEW.action_tab,
      'related_task_id', NEW.related_task_id
    ),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-ican-wallet-webhook-secret', v_webhook_secret
    ),
    timeout_milliseconds := 10000
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never let a push-delivery hiccup block the notification itself.
  RAISE NOTICE 'Warning: Failed to dispatch CMMS push webhook - %', SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ican_cmms_push_webhook ON public.cmms_notifications;
CREATE TRIGGER ican_cmms_push_webhook
AFTER INSERT ON public.cmms_notifications
FOR EACH ROW EXECUTE FUNCTION public.ican_dispatch_cmms_push_webhook();

REVOKE ALL ON FUNCTION public.ican_dispatch_cmms_push_webhook() FROM PUBLIC;

SELECT 'CMMS notifications now dispatch phone push alerts' AS status;
