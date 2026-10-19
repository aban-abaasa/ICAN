-- ADD_RECEIPT_DETAILS_TO_ICAN_TRANSACTIONS.sql
-- A shop purchase made in digital-city-era writes its full receipt (store,
-- products, totals, and the staff member who approved it) onto the customer's
-- ICAN transaction rows, so the ICAN wallet can show what a payment bought.
--
-- The column is written by digital-city-era's
--   backend/database/migrations/ADD_RECEIPT_STORE_APPROVAL_ICAN_LINK.sql
-- (register_receipt_approval / approve_receipt). Both apps share one Supabase
-- database, so this is the same column; the statement is idempotent.
--
-- get_ican_record_every_transaction_feed() returns SETOF ican_coin_transactions
-- with tx.*, so the new column reaches the wallet with no function change.

ALTER TABLE public.ican_coin_transactions
  ADD COLUMN IF NOT EXISTS receipt_details JSONB;

NOTIFY pgrst, 'reload schema';
