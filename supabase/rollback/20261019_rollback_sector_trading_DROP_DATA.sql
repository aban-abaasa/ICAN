-- ============================================================================
-- Rollback of IcanEra Sector Markets, part 2 of 2: DELETE THE DATA.   *** DESTRUCTIVE ***
--
-- Run 20261019_rollback_sector_trading.sql first. This drops the whole icanera_trading schema: every fill, every
-- holding, the vault ledger, the consent records and the revenue outbox. It cannot be undone.
--
-- It REFUSES to run while any user still holds sector units, because dropping the tables would erase what they own
-- without paying them. Pay them out first (sell on their behalf at today's index price, or refund their cost), then
-- run this. If you have done that another way and really mean it:
--     SET icanera.force_drop = 'yes';
-- in the same session before running this file.
-- ============================================================================

DO $$
DECLARE v_users BIGINT; v_units NUMERIC;
BEGIN
  IF to_regclass('icanera_trading.sector_holdings') IS NOT NULL THEN
    SELECT count(DISTINCT user_id), COALESCE(sum(units), 0) INTO v_users, v_units
      FROM icanera_trading.sector_holdings WHERE units > 0;
    IF v_users > 0 AND COALESCE(current_setting('icanera.force_drop', true), '') <> 'yes' THEN
      RAISE EXCEPTION '% user(s) still hold % sector units. Pay them out first (see the note at the top of this file); nothing was dropped.', v_users, v_units;
    END IF;
  END IF;
END $$;

DROP SCHEMA IF EXISTS icanera_trading CASCADE;

NOTIFY pgrst, 'reload schema';
