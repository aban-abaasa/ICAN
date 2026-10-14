-- ============================================================================
-- Rollback of the IcanEra on-chain bridge (20261020100000 .. 20261020120000), part 1: STOP, KEEP THE BOOKS.
--
-- What this does
--   * turns the bridge off (no new withdrawals);
--   * removes every public.ican_chain_* / ican_bridge_* / ican_fx_rate function, so nothing can reach the bridge over the
--     API any more, and unschedules the nightly prune;
--   * leaves the icanera_chain schema in place: the locked-ICEC ledger, every withdrawal and burn, the linked addresses
--     and the FX history. Nothing in it is reachable by anon/authenticated (that never changes) and nobody's ledger
--     ICEC moves.
--
-- READ THIS BEFORE YOU RUN IT
--   Removing the functions removes the way a burn on the chain becomes ledger credit. Anyone still holding ICEC-C
--   on-chain would be stuck with a receipt the platform can no longer honour through the API.
--   The gentle way to stop is the PAUSE: set bridge_enabled to FALSE (the dev panel, or
--       UPDATE icanera_chain.chain_settings SET bridge_enabled = FALSE WHERE bridge_enabled;
--   ). That stops new withdrawals while burn-backs are still credited. Wait until the locked total reaches zero
--   (SELECT icanera_chain.locked_total();), then run this. If you run it earlier, the locked ICEC stays recorded in the
--   ledger and can be paid out by hand from it.
--
-- It does NOT touch the on-chain contracts (they are immutable and not ours to remove) or anyone's wallet.
-- Safe to run twice.
-- ============================================================================

DO $$
BEGIN
  IF to_regclass('icanera_chain.chain_settings') IS NOT NULL THEN
    UPDATE icanera_chain.chain_settings SET bridge_enabled = FALSE WHERE bridge_enabled;
  END IF;
END $$;

DO $$
DECLARE j TEXT;
BEGIN
  IF to_regnamespace('cron') IS NOT NULL THEN
    FOREACH j IN ARRAY ARRAY['icanera-chain-prune-fx'] LOOP
      BEGIN
        PERFORM cron.unschedule(j);
      EXCEPTION WHEN OTHERS THEN NULL;       -- not scheduled
      END;
    END LOOP;
  END IF;
END $$;

-- users
DROP FUNCTION IF EXISTS public.ican_chain_public_config();
DROP FUNCTION IF EXISTS public.ican_chain_link_challenge(TEXT);
DROP FUNCTION IF EXISTS public.ican_chain_unlink_address(TEXT);
DROP FUNCTION IF EXISTS public.ican_bridge_request_withdrawal(NUMERIC, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.ican_bridge_cancel_withdrawal(UUID);
DROP FUNCTION IF EXISTS public.ican_chain_my_overview();
DROP FUNCTION IF EXISTS public.ican_fx_rate(TEXT);
-- the relayer
DROP FUNCTION IF EXISTS public.ican_chain_operator_lease(TEXT, TEXT, INT);
DROP FUNCTION IF EXISTS public.ican_chain_operator_release(TEXT, TEXT);
DROP FUNCTION IF EXISTS public.ican_chain_operator_cursor(TEXT, BIGINT);
DROP FUNCTION IF EXISTS public.ican_chain_operator_next_mints(INT, INT);
DROP FUNCTION IF EXISTS public.ican_chain_operator_mark_submitted(UUID, TEXT);
DROP FUNCTION IF EXISTS public.ican_chain_operator_requeue(UUID, TEXT);
DROP FUNCTION IF EXISTS public.ican_chain_operator_record_mint(BIGINT, TEXT, TEXT, INT, BIGINT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.ican_chain_operator_record_burn(BIGINT, TEXT, INT, BIGINT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.ican_chain_operator_retry_unclaimed(INT);
DROP FUNCTION IF EXISTS public.ican_chain_operator_check_supply(BIGINT, BIGINT, TEXT);
DROP FUNCTION IF EXISTS public.ican_chain_operator_halt(TEXT);
DROP FUNCTION IF EXISTS public.ican_chain_operator_link(UUID, TEXT);
DROP FUNCTION IF EXISTS public.ican_chain_operator_get_challenge(UUID);
DROP FUNCTION IF EXISTS public.ican_chain_operator_sync_contracts(TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.ican_chain_operator_adopt_chain(BIGINT);
DROP FUNCTION IF EXISTS public.ican_chain_operator_auto_start();
DROP FUNCTION IF EXISTS public.ican_chain_operator_fx_observe(TEXT, NUMERIC, TEXT, TIMESTAMPTZ);
-- administrators
DROP FUNCTION IF EXISTS public.ican_chain_dev_overview(TEXT);
DROP FUNCTION IF EXISTS public.ican_chain_dev_set_settings(TEXT, JSONB);
DROP FUNCTION IF EXISTS public.ican_chain_dev_set_contracts(TEXT, JSONB);
DROP FUNCTION IF EXISTS public.ican_chain_dev_reconcile(TEXT);
DROP FUNCTION IF EXISTS public.ican_chain_dev_resolve_anomaly(TEXT, BIGINT, TEXT);
DROP FUNCTION IF EXISTS public.ican_chain_dev_requeue(TEXT, UUID, TEXT);
DROP FUNCTION IF EXISTS public.ican_chain_dev_fx_overview(TEXT);

NOTIFY pgrst, 'reload schema';
