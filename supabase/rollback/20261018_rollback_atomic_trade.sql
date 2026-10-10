-- Rolls back 20261018110000_icaneracoin_atomic_trade.sql.
--
-- The app keeps working: icanCoinService falls back to its earlier browser-side buy/sell when the function is
-- missing. Executed trades stay in ican_coin_transactions (they are ordinary ledger rows). The idempotency
-- records and the settings row are dropped with their tables.

DO $$
BEGIN
  IF to_regnamespace('cron') IS NOT NULL THEN
    PERFORM cron.unschedule('icaneracoin-prune-trade-requests');
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL; -- the job was never scheduled
END $$;

DROP FUNCTION IF EXISTS public.ican_trade_execute(TEXT, NUMERIC, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, TEXT);
DROP TABLE IF EXISTS public.ican_trade_requests;
DROP TABLE IF EXISTS public.ican_trade_settings;

NOTIFY pgrst, 'reload schema';
