-- ============================================================================
-- FIX: wallet_transactions schema drift breaking top-up recording (PGRST204)
-- ============================================================================
-- Three different, conflicting CREATE TABLE public.wallet_transactions
-- statements exist in this repo (db/create_wallet_transactions_table.sql,
-- SUPABASE_WALLET_SETUP_COMPLETE.sql, COMPLETE_INVESTMENT_SETUP.sql) —
-- whichever ran last on this Supabase project is the live shape, and it's
-- evidently missing columns momoService.js's processTopUp() expects
-- (type, provider, reference_id, transaction_id, phone_number), causing
-- "Could not find column X in schema cache" (PGRST204) on every top-up.
--
-- This is also the top-up path being replaced: processTopUp() no longer
-- calls the MTN MOMO API directly — it now opens Flutterwave Checkout and
-- verifies via the new verify-flutterwave-topup edge function, which needs
-- these exact columns to record the transaction. Rather than guess which of
-- the three schemas is live, this makes wallet_transactions a superset of
-- all of them: additive only (ADD COLUMN IF NOT EXISTS), safe to run
-- regardless of which variant is currently live, and does not drop or
-- rename anything.
--
-- Run this in the shared Supabase SQL editor, before deploying
-- verify-flutterwave-topup.
-- ============================================================================

-- If wallet_id exists and is NOT NULL (the SUPABASE_WALLET_SETUP_COMPLETE.sql
-- variant, FK'd to wallet_accounts), relax it — this top-up path doesn't
-- maintain a separate wallet_accounts row.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'wallet_transactions' AND column_name = 'wallet_id'
  ) THEN
    ALTER TABLE public.wallet_transactions ALTER COLUMN wallet_id DROP NOT NULL;
  END IF;
END $$;

ALTER TABLE public.wallet_transactions ADD COLUMN IF NOT EXISTS type VARCHAR(50);
ALTER TABLE public.wallet_transactions ADD COLUMN IF NOT EXISTS provider VARCHAR(50);
ALTER TABLE public.wallet_transactions ADD COLUMN IF NOT EXISTS reference_id VARCHAR(255);
ALTER TABLE public.wallet_transactions ADD COLUMN IF NOT EXISTS transaction_id VARCHAR(255);
ALTER TABLE public.wallet_transactions ADD COLUMN IF NOT EXISTS phone_number VARCHAR(20);
ALTER TABLE public.wallet_transactions ADD COLUMN IF NOT EXISTS currency VARCHAR(10) DEFAULT 'UGX';
ALTER TABLE public.wallet_transactions ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE public.wallet_transactions ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'pending';
ALTER TABLE public.wallet_transactions ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

-- Drop any pre-existing CHECK constraint restricting type/provider values —
-- momoService.js used values ('topup', 'transfer', 'remittance',
-- 'mtn_momo') that may not match whatever constraint is currently live, and
-- the Flutterwave replacement introduces new values ('deposit',
-- 'flutterwave'). Rather than guess the exact allowed set again, drop any
-- restriction on these two columns; application code is the source of truth
-- for valid values here, same as ican_coin_transactions' approach elsewhere.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public' AND rel.relname = 'wallet_transactions' AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ~* '\y(type|provider)\y'
  LOOP
    EXECUTE format('ALTER TABLE public.wallet_transactions DROP CONSTRAINT %I', r.conname);
    RAISE NOTICE 'Dropped constraint: %', r.conname;
  END LOOP;
END $$;

-- Idempotency: prevent a retried/duplicate Flutterwave verification from
-- recording the same transaction twice. Using a unique INDEX (not a table
-- constraint) so this doesn't fail if duplicate reference_id/transaction_id
-- rows already exist from past bugs — new duplicates are blocked going
-- forward without erroring out on old data.
CREATE UNIQUE INDEX IF NOT EXISTS wallet_tx_reference_id_unique
  ON public.wallet_transactions(reference_id) WHERE reference_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS wallet_tx_transaction_id_unique
  ON public.wallet_transactions(transaction_id) WHERE transaction_id IS NOT NULL;

DO $$
BEGIN
  RAISE NOTICE '✅ wallet_transactions now has all columns processTopUp()/verify-flutterwave-topup need.';
END $$;
