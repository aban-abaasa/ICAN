-- =============================================================================
-- FIX_MISSING_COLUMNS.sql
--
-- Quick patch — run this ONCE in Supabase SQL Editor if you see:
--   ERROR: 42703: column "transaction_type" does not exist
--
-- Root cause: ican_coin_transactions was created by an earlier migration run
-- before transaction_type / ugx_floor_value were added to the schema.
-- CREATE TABLE IF NOT EXISTS skips the new column definitions on re-runs,
-- and the original DO-block did not patch those two columns.
--
-- This file is safe to run multiple times (all ADD COLUMN IF NOT EXISTS).
-- After running this, re-run ICAN_CROSS_APP_WALLET_MIGRATION.sql and then
-- DCE_CUSTOMER_SELFCHECKOUT.sql normally.
-- =============================================================================

-- 1. transaction_type — required by every INSERT in transfer_ican /
--    credit_ican_earning / farm_credit_listing_sale etc.
ALTER TABLE public.ican_coin_transactions
  ADD COLUMN IF NOT EXISTS transaction_type TEXT NOT NULL DEFAULT 'earn'
  CHECK (transaction_type IN (
    'earn','transfer_in','transfer_out','tithe',
    'cashback','purchase','sale','refund'
  ));

-- 2. ugx_floor_value — stored generated column (1 ICAN = 5,000 UGX floor)
--    Only add if not already present (generated columns can't use IF NOT EXISTS
--    directly, so wrap in a DO block)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ican_coin_transactions'
      AND column_name = 'ugx_floor_value'
  ) THEN
    ALTER TABLE public.ican_coin_transactions
      ADD COLUMN ugx_floor_value DECIMAL(18,2)
      GENERATED ALWAYS AS (ican_amount * 5000) STORED;
  END IF;
END $$;

-- 3. status — used in some reporting queries
ALTER TABLE public.ican_coin_transactions
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'completed'
  CHECK (status IN ('pending','completed','failed','reversed'));

-- 4. data_hash — optional integrity field
ALTER TABLE public.ican_coin_transactions
  ADD COLUMN IF NOT EXISTS data_hash TEXT;

-- Confirm
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'ican_coin_transactions'
ORDER BY ordinal_position;
