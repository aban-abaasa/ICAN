-- ICANera Wallet: shared push-delivery setup for ONE Supabase project.
--
-- Paste this into Supabase SQL Editor AFTER running
-- ICAN_CROSS_APP_WALLET_NOTIFICATIONS.sql.
--
-- This is deliberately ONE relay and ONE webhook: ICAN, Digital City Era,
-- FARM-AGENT and MyBodaGuy share the same wallet, inbox and Supabase project.
-- Do NOT create four relays or four VAPID key pairs.
--
-- Before executing, replace only the value below with a long random secret.
-- It must exactly match the ICAN_WALLET_PUSH_WEBHOOK_SECRET Edge Function
-- secret configured in Supabase Dashboard.

CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.ican_dispatch_wallet_push_webhook()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_webhook_secret CONSTANT TEXT := 'MpaszdslwCEBCXBsVjXi6P5XXRhlfUZ2fryVUitOycU';
BEGIN
  -- pg_net queues the request after the transaction commits. The Edge Function
  -- receives the new shared inbox row and looks up active devices for the
  -- recipient; wallet balances and private keys never leave the server.
  PERFORM net.http_post(
    url := 'https://hswxazpxcgtqbxeqcxxw.supabase.co/functions/v1/wallet-push',
    body := to_jsonb(NEW),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-ican-wallet-webhook-secret', v_webhook_secret
    ),
    timeout_milliseconds := 10000
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ican_wallet_push_webhook ON public.ican_wallet_inbox_notifications;
CREATE TRIGGER ican_wallet_push_webhook
AFTER INSERT ON public.ican_wallet_inbox_notifications
FOR EACH ROW EXECUTE FUNCTION public.ican_dispatch_wallet_push_webhook();

-- Keep calls private; the trigger is the only caller.
REVOKE ALL ON FUNCTION public.ican_dispatch_wallet_push_webhook() FROM PUBLIC;

-- Verify this only after inserting a wallet notification:
-- SELECT * FROM net._http_response ORDER BY created DESC LIMIT 20;
