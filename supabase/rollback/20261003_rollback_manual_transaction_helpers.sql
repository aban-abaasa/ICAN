-- Rolls back MANUAL_TRANSACTION_HELPERS.sql (20261003090000_manual_transaction_helpers.sql).
-- Re-run BUSINESS_TRANSACTIONS_BY_CONTRIBUTOR.sql afterwards to restore the original
-- fn_get_business_transactions_by_contributor (without the lock/archive columns).
-- The columns are left in place on purpose: archived rows have already had detail
-- compacted, and dropping the flags would lose which entries were protected.

DROP TRIGGER IF EXISTS trg_ican_tx_flag_two_accounts        ON public.ican_transactions;
DROP TRIGGER IF EXISTS trg_ican_tx_block_two_account_delete ON public.ican_transactions;
DROP TRIGGER IF EXISTS trg_ican_tx_guard_two_account_update ON public.ican_transactions;

DROP FUNCTION IF EXISTS public.fn_ican_tx_flag_two_accounts();
DROP FUNCTION IF EXISTS public.fn_ican_tx_block_two_account_delete();
DROP FUNCTION IF EXISTS public.fn_ican_tx_guard_two_account_update();
DROP FUNCTION IF EXISTS public.fn_archive_ican_transaction(UUID);
DROP FUNCTION IF EXISTS public.fn_get_business_transactions_by_contributor(UUID);
