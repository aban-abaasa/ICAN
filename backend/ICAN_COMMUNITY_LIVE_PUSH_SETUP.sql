-- ============================================================
-- Community "Go Live": notify every signed-in user by phone push
-- ============================================================
-- Reuses the exact same push pipeline as the wallet and CMMS notifications
-- (see ICAN_SHARED_WALLET_PUSH_SETUP.sql / ICAN_CMMS_PUSH_NOTIFICATIONS.sql):
-- ican_wallet_push_subscriptions holds each signed-in user's registered
-- device, and the "wallet-push" Edge Function sends the actual Web Push
-- message. Anyone who has turned on "Push notifications (phone alerts)" in
-- Settings gets this with no extra opt-in -- same as CMMS.
--
-- Unlike wallet/CMMS notifications, a "someone went live" alert isn't aimed
-- at one recipient and doesn't need a durable inbox row (nothing reads it
-- back later, there's no bell/history UI for it) -- so instead of an inbox
-- table + AFTER INSERT trigger, this is a single RPC the frontend calls
-- once when a broadcast successfully starts (useCommunityLive.js's
-- goLive()). It fans out to every active device except the broadcaster's
-- own -- see the Edge Function change below for how "no recipient_user_id"
-- is read as "broadcast to everyone".
--
-- Run this AFTER ICAN_CROSS_APP_WALLET_NOTIFICATIONS.sql.
-- You must also redeploy the "wallet-push" Edge Function
-- (backend/supabase/functions/wallet-push/index.ts) after this -- it was
-- updated to handle a broadcast (no single recipient) payload.
-- Safe to run more than once.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.ican_notify_community_live(p_broadcaster_name TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Same relay + secret as every other ICAN push source -- one shared relay.
  v_webhook_secret CONSTANT TEXT := 'MpaszdslwCEBCXBsVjXi6P5XXRhlfUZ2fryVUitOycU';
  v_broadcaster_id UUID := auth.uid();
BEGIN
  IF v_broadcaster_id IS NULL THEN
    RAISE EXCEPTION 'Must be signed in to go live';
  END IF;

  PERFORM net.http_post(
    url := 'https://hswxazpxcgtqbxeqcxxw.supabase.co/functions/v1/wallet-push',
    body := jsonb_build_object(
      'id', gen_random_uuid(),
      'source', 'community_live',
      'broadcaster_id', v_broadcaster_id,
      'title', 'Community is live',
      'message', COALESCE(NULLIF(TRIM(p_broadcaster_name), ''), 'Someone') || ' is live in Community — tap to join.'
    ),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-ican-wallet-webhook-secret', v_webhook_secret
    ),
    timeout_milliseconds := 10000
  );
END;
$$;

-- Any signed-in user may announce their own broadcast; the function reads
-- auth.uid() itself rather than trusting a caller-supplied id.
REVOKE ALL ON FUNCTION public.ican_notify_community_live(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ican_notify_community_live(TEXT) TO authenticated;

SELECT 'Community go-live now dispatches phone push alerts to everyone' AS status;
