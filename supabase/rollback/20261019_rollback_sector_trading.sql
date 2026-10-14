-- ============================================================================
-- Rollback of IcanEra Sector Markets (20261019100000 .. 20261019130000), part 1: STOP, KEEP THE BOOKS.
--
-- What this does
--   * turns sector trading off;
--   * removes the revenue hook from the business side (the sale path goes back to exactly what it was);
--   * removes every public.ican_sector_* function and the scheduled jobs;
--   * leaves the icanera_trading schema, with its fills, vault ledger and holdings, in place. Nothing in it is
--     reachable by anon/authenticated (that never changes), and every user's ICEC is exactly where it was.
--
-- What it does NOT do: touch anyone's wallet. Sector trades never wrote to ican_coin_transactions, so the icaneracoin
-- chart, price and ledgers are unaffected by this migration being there or not.
--
-- To delete the data as well (only after users have been made whole), run the second file:
--   supabase/rollback/20261019_rollback_sector_trading_DROP_DATA.sql
-- Safe to run twice.
-- ============================================================================

DO $$
BEGIN
  IF to_regclass('icanera_trading.sector_settings') IS NOT NULL THEN
    UPDATE icanera_trading.sector_settings SET trading_enabled = FALSE;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.ican_business_wallet_settlements') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_icanera_capture_settlement ON public.ican_business_wallet_settlements;
  END IF;
END $$;

DO $$
DECLARE j TEXT;
BEGIN
  IF to_regnamespace('cron') IS NOT NULL THEN
    FOREACH j IN ARRAY ARRAY['icanera-sector-fold', 'icanera-sector-prune', 'icanera-sector-prune-requests'] LOOP
      BEGIN
        PERFORM cron.unschedule(j);
      EXCEPTION WHEN OTHERS THEN NULL;       -- not scheduled
      END;
    END LOOP;
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.ican_sector_trade(TEXT, TEXT, NUMERIC, TEXT, TEXT, NUMERIC, NUMERIC);
DROP FUNCTION IF EXISTS public.ican_sector_my_holdings();
DROP FUNCTION IF EXISTS public.ican_sector_my_fills(INT, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS public.ican_get_sector_feed(BIGINT, TEXT, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS public.ican_sector_data_terms();
DROP FUNCTION IF EXISTS public.ican_sector_data_consent_status(UUID);
DROP FUNCTION IF EXISTS public.ican_sector_accept_data_terms(UUID, INT);
DROP FUNCTION IF EXISTS public.ican_sector_dev_overview(TEXT);
DROP FUNCTION IF EXISTS public.ican_sector_dev_set_settings(TEXT, JSONB);
DROP FUNCTION IF EXISTS public.ican_sector_dev_set_sector(TEXT, TEXT, BOOLEAN, BOOLEAN);
DROP FUNCTION IF EXISTS public.ican_sector_dev_map_industry(TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.ican_sector_dev_vault_adjust(TEXT, NUMERIC, TEXT);
DROP FUNCTION IF EXISTS public.ican_sector_dev_reconcile(TEXT);

NOTIFY pgrst, 'reload schema';
