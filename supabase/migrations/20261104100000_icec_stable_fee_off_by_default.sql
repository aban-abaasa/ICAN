-- ============================================================================
-- ICEC-S: NO FEE by default. The fee stays a setting the developer panel can change at any time.
--
-- 20261028100000 put a 3% cash-out fee on selling ICEC-S (buying was already free). That fee is now OFF:
--
--   * icanera_stable.settings.fee_bps defaults to 0 (was 300) and is set to 0 here, ONCE, so a sell pays the full value and
--     nothing is paid to the platform fee business.
--   * Nothing else about a swap changes. ican_stable_swap / ican_stable_quote already read fee_bps, so the moment an
--     administrator saves a fee in the developer panel (ICEC-S tab -> Settings -> Cash-out fee, in basis points: 100 = 1%) it
--     applies to the next cash-out, goes to the platform fee business as before, and the screens show it. Saving 0 turns it off again.
--   * A fee taken earlier stays in the books exactly as recorded; the reconcile still balances those swaps.
--
-- The reset happens once only: this file marks fee_bps with a column comment the first time it runs, and a later re-run (or
-- pasting the whole ICEC-S bundle again) leaves whatever fee an administrator chose after that.
--
-- Run after 20261028100000_icec_stable_cash_out_fee.sql. Safe to run more than once.
-- ============================================================================

DO $$ BEGIN
  IF to_regclass('icanera_stable.settings') IS NULL OR to_regprocedure('public.ican_stable_dev_set_settings(text,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'Apply the earlier ICEC-S migrations first.';
  END IF;
END $$;

ALTER TABLE icanera_stable.settings ALTER COLUMN fee_bps SET DEFAULT 0;

DO $$
DECLARE
  v_note CONSTANT TEXT := 'Cash-out fee in basis points (100 = 1%). 0 = no fee, the default. Changed from the developer panel.';
  v_col  SMALLINT;
BEGIN
  SELECT attnum INTO v_col FROM pg_attribute WHERE attrelid = 'icanera_stable.settings'::regclass AND attname = 'fee_bps';
  IF col_description('icanera_stable.settings'::regclass, v_col) IS DISTINCT FROM v_note THEN
    UPDATE icanera_stable.settings SET fee_bps = 0, updated_at = now() WHERE id;
    EXECUTE format('COMMENT ON COLUMN icanera_stable.settings.fee_bps IS %L', v_note);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
