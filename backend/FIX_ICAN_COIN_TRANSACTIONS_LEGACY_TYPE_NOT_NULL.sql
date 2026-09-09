-- =============================================================================
-- FIX_ICAN_COIN_TRANSACTIONS_LEGACY_TYPE_NOT_NULL.sql
--
-- Run this ONCE in Supabase SQL Editor if you see either:
--   ERROR: 23502: null value in column "type"/"local_amount" of relation
--   "ican_coin_transactions" violates not-null constraint
-- or:
--   ERROR: 23514: new row for relation "ican_coin_transactions" violates
--   check constraint "ican_coin_transactions_transaction_type_check"
--
-- (e.g. thrown from mbg_credit_ride_earning when a rider finishes a ride in
-- mybodaguy, or from transfer_ican / credit_ican_earning elsewhere.)
--
-- Root cause: DEPLOY_ICAN_COIN_TRANSACTIONS.sql (or add_ican_coin_system.sql,
-- depending on which ran first on a given database) originally created this
-- table with `type TEXT/VARCHAR NOT NULL` and `local_amount DECIMAL(18,8) NOT
-- NULL` — both with no default. ICAN_CROSS_APP_WALLET_MIGRATION.sql later
-- introduced `transaction_type` as the column every current earn/credit
-- function actually writes (mbg_credit_ride_earning, mbg_credit_rider_delivery,
-- transfer_ican, etc. — all INSERT transaction_type, never type), and
-- ICAN_TRANSACTION_CONTEXT_MIGRATION.sql made local_amount optional
-- (COALESCE'd from ican_amount when absent) but only inside
-- mbg_transfer_ican_with_context — every other insert path still just skips
-- the column. So on any database where the original CREATE TABLE ran first,
-- both `type` and `local_amount` are still sitting there NOT NULL with
-- nothing populating them from most call sites, and inserts fail this
-- leftover constraint one column at a time as each gets hit. Neither column
-- is read by any current query (grep across ICAN/digital-city-era/mybodaguy/
-- farm-agent finds zero reads of `type`; `local_amount` is only read/written
-- by the context-aware transfer path) — so we stop enforcing NOT NULL on
-- both rather than retrofit every insert call site to populate them.
--
-- Safe to run multiple times.
-- =============================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ican_coin_transactions' AND column_name = 'type'
  ) THEN
    -- Backfill any existing NULLs (shouldn't be any, since NOT NULL was
    -- enforced, but be defensive) from transaction_type before relaxing.
    UPDATE public.ican_coin_transactions
    SET type = transaction_type
    WHERE type IS NULL;

    ALTER TABLE public.ican_coin_transactions ALTER COLUMN type DROP NOT NULL;
    ALTER TABLE public.ican_coin_transactions ALTER COLUMN type SET DEFAULT NULL;

    RAISE NOTICE 'Legacy "type" column on ican_coin_transactions is now nullable — new inserts that only set transaction_type will no longer fail.';
  ELSE
    RAISE NOTICE 'ican_coin_transactions has no legacy "type" column — nothing to fix.';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ican_coin_transactions' AND column_name = 'local_amount'
      AND is_nullable = 'NO'
  ) THEN
    -- Backfill any existing NULLs before relaxing, using the same
    -- 1 ICAN = 5,000 UGX floor mbg_transfer_ican_with_context falls back to.
    UPDATE public.ican_coin_transactions
    SET local_amount = ROUND(ican_amount * 5000, 2)
    WHERE local_amount IS NULL;

    ALTER TABLE public.ican_coin_transactions ALTER COLUMN local_amount DROP NOT NULL;

    RAISE NOTICE 'Legacy NOT NULL on "local_amount" dropped — inserts that don''t set it (mbg_credit_ride_earning, mbg_credit_rider_delivery, etc.) will no longer fail.';
  ELSE
    RAISE NOTICE 'ican_coin_transactions.local_amount is already nullable — nothing to fix.';
  END IF;
END $$;

-- ── transaction_type CHECK constraint ───────────────────────────────────────
-- ICAN_BUY_SELL_COINS_ADDENDUM.sql widens this to add 'buy'/'sell', and
-- CREATE_JOURNEY_ESCROW_FUNCTION.sql widens it again to add
-- 'journey_payment' (used by mbg_debit_journey_fare, called from
-- mbg_complete_ride's wallet-payment branch). If either of those two
-- migrations never ran on this database, the constraint is still stuck at
-- the base ICAN_CROSS_APP_WALLET_MIGRATION.sql list and any insert using
-- 'journey_payment' (or 'buy'/'sell') fails with:
--   ERROR: 23514: new row for relation "ican_coin_transactions" violates
--   check constraint "ican_coin_transactions_transaction_type_check"
-- Re-widening to the full known superset here makes this idempotent
-- regardless of which of those scripts already ran.
ALTER TABLE public.ican_coin_transactions
  DROP CONSTRAINT IF EXISTS ican_coin_transactions_transaction_type_check;

ALTER TABLE public.ican_coin_transactions
  ADD CONSTRAINT ican_coin_transactions_transaction_type_check
  CHECK (transaction_type IN (
    'earn','transfer_in','transfer_out','tithe',
    'cashback','purchase','sale','refund',
    'buy','sell','journey_payment'
  ));

-- Confirm
SELECT column_name, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'ican_coin_transactions'
ORDER BY ordinal_position;

SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'public.ican_coin_transactions'::regclass
  AND contype = 'c';
