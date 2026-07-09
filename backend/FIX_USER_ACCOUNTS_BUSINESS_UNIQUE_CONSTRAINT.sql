-- ============================================================
-- FIX: user_accounts unique constraint blocks business wallets
-- Run once in Supabase SQL editor
--
-- AUTO_CREATE_USER_ACCOUNTS.sql added `UNIQUE (user_id)` on
-- user_accounts (one personal wallet per signed-up user) plus a
-- trigger that auto-creates that personal row on signup.
--
-- walletAccountService.createBusinessWalletAccount() also inserts
-- into user_accounts — same user_id (the business owner), different
-- business_id — to give each business its own wallet row. Since
-- every user already has a personal row from signup, that insert
-- always hit `user_id_unique` and failed with:
--   "duplicate key value violates unique constraint user_id_unique"
--
-- First attempt at this migration just DROPped user_id_unique, which
-- fails: DEV_PANEL_ACCESS.sql's ican_subscriptions.user_id_fkey
-- targets that exact unique index (FK targets must be a full, non-
-- partial unique constraint in Postgres, which is why we can't just
-- swap in partial indexes and keep the old FK pointed at user_accounts).
-- Since ican_subscriptions.user_id is really just "the auth user" (not
-- specifically their personal wallet row — target_type can be
-- 'company'/'agent'/'business' too), repoint that FK at auth.users(id)
-- first — the same values already always equalled auth.users.id, so
-- this is a no-op for existing data. That frees user_id_unique to be
-- replaced with two partial unique indexes matching how the table is
-- actually used:
--   - at most one personal account per user  (business_id IS NULL)
--   - at most one wallet account per business (business_id IS NOT NULL)
-- This matches createBusinessWalletAccount()'s own pre-insert check,
-- which already looks up by business_id, not user_id.
-- ============================================================

-- 1. Repoint ican_subscriptions off user_accounts.user_id so nothing
--    still depends on the constraint we're about to drop.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ican_subscriptions_user_id_fkey'
  ) THEN
    ALTER TABLE public.ican_subscriptions DROP CONSTRAINT ican_subscriptions_user_id_fkey;
  END IF;

  ALTER TABLE public.ican_subscriptions
    ADD CONSTRAINT ican_subscriptions_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
END $$;

-- 2. Now safe to drop — nothing references this index anymore.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_id_unique'
  ) THEN
    ALTER TABLE public.user_accounts DROP CONSTRAINT user_id_unique;
  END IF;
END $$;

-- 3. Replace with scoped uniqueness: one personal account per user,
--    one wallet account per business.
CREATE UNIQUE INDEX IF NOT EXISTS user_accounts_personal_unique
  ON public.user_accounts (user_id)
  WHERE business_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS user_accounts_business_unique
  ON public.user_accounts (business_id)
  WHERE business_id IS NOT NULL;

SELECT 'user_accounts constraint fixed — business wallets can now be created alongside a personal wallet' AS status;
