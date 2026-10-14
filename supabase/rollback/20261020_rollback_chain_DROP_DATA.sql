-- ============================================================================
-- Rollback of the IcanEra on-chain bridge, part 2 of 2: DELETE THE DATA.   *** DESTRUCTIVE ***
--
-- Run 20261020_rollback_chain.sql first. This drops the whole icanera_chain schema: the locked-ICEC ledger, every
-- withdrawal and burn, the proofs of address ownership, the FX history. It cannot be undone.
--
-- It REFUSES to run while ledger ICEC is still locked for tokens that may exist on-chain (the locked total is not zero),
-- because dropping the ledger would erase the record of ICEC that users are owed. Make them whole first: let holders
-- burn back before you remove the API (see the note in the first rollback), or credit them by hand from the ledger.
-- If you have done that another way and really mean it:
--     SET icanera.force_drop = 'yes';
-- in the same session before running this file.
-- ============================================================================

DO $$
DECLARE v_locked NUMERIC;
BEGIN
  IF to_regclass('icanera_chain.locked_entries') IS NOT NULL THEN
    SELECT COALESCE(SUM(amount), 0) INTO v_locked FROM icanera_chain.locked_entries;
    IF v_locked <> 0 AND COALESCE(current_setting('icanera.force_drop', true), '') <> 'yes' THEN
      RAISE EXCEPTION '% ICEC is still locked in the bridge ledger (it stands for ICEC-C that may be held on-chain). Pay it out first (see the note at the top of this file); nothing was dropped.', v_locked;
    END IF;
  END IF;
END $$;

DROP SCHEMA IF EXISTS icanera_chain CASCADE;

NOTIFY pgrst, 'reload schema';
