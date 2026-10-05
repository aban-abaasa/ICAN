-- Rolls back MANUAL_TRANSACTION_HELPERS.sql (20261003090000_manual_transaction_helpers.sql).
-- The columns are left in place on purpose: archived rows have already had detail
-- compacted, and dropping the flags would lose which entries were protected.
-- cleanup_user_transactions keeps its "skip permanent rows" filter; restore it from
-- your own backup if you need the old behaviour.

DROP TRIGGER IF EXISTS trg_ican_tx_flag_two_accounts        ON public.ican_transactions;
DROP TRIGGER IF EXISTS trg_ican_tx_block_two_account_delete ON public.ican_transactions;
DROP TRIGGER IF EXISTS trg_ican_tx_guard_two_account_update ON public.ican_transactions;
DO $$ BEGIN
  IF to_regclass('public.ican_coin_transactions') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS trg_ican_coin_tx_no_delete ON public.ican_coin_transactions';
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.fn_ican_tx_flag_two_accounts();
DROP FUNCTION IF EXISTS public.fn_ican_tx_block_two_account_delete();
DROP FUNCTION IF EXISTS public.fn_ican_tx_guard_two_account_update();
DROP FUNCTION IF EXISTS public.fn_block_wallet_ledger_delete();
DROP FUNCTION IF EXISTS public.fn_archive_ican_transaction(UUID);
DROP FUNCTION IF EXISTS public.fn_get_business_ledger_entries(UUID);
