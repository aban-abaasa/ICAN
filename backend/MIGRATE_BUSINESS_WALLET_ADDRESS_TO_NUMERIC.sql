-- ================================================================
-- Backfill existing ican_business_wallets.wallet_address values to the
-- pure-digit format that PITCHIN_BUSINESS_PROFILE_ICAN_WALLET.sql's table
-- default now produces for new business wallets: 16 digits, leading digit
-- 3 (matching the existing user_accounts.account_number convention where
-- 1 = personal fiat and 2 = business fiat — see
-- MIGRATE_EXISTING_ACCOUNT_NUMBERS_TO_NUMERIC.sql).
--
-- Rows created before that switch still hold 'BIZ-<16 hex chars>' values.
-- Any row still in that shape fails the /^3\d{15}$/ business-wallet lookup
-- used by ICANWallet.jsx's send flow and AgentDashboard.jsx's cash-out, so
-- those businesses can't be paid or cashed out to until this runs.
--
-- No other table has a foreign key on wallet_address (everything else joins
-- through business_profile_id), so rewriting it here is safe — only
-- cosmetic text in old transaction descriptions/receipts (if any) would
-- still show an old-format address, and that's expected for historical
-- records.
--
-- Run once in the Supabase SQL Editor, after
-- PITCHIN_BUSINESS_PROFILE_ICAN_WALLET.sql. Safe to run more than once:
-- only touches rows that don't already match the numeric format, and
-- re-checks for collisions before assigning.
-- ================================================================

DO $$
DECLARE
  v_row RECORD;
  v_new_address TEXT;
  v_migrated INTEGER := 0;
BEGIN
  FOR v_row IN
    SELECT id
    FROM public.ican_business_wallets
    WHERE wallet_address !~ '^\d{16}$'
    FOR UPDATE
  LOOP
    LOOP
      v_new_address := '3' || lpad((floor(random() * 1e15))::bigint::text, 15, '0');
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM public.ican_business_wallets WHERE wallet_address = v_new_address
      );
    END LOOP;

    UPDATE public.ican_business_wallets
    SET wallet_address = v_new_address,
        updated_at = now()
    WHERE id = v_row.id;

    v_migrated := v_migrated + 1;
  END LOOP;

  RAISE NOTICE 'Migrated % existing wallet_address value(s) to the numeric-only format.', v_migrated;
END $$;

SELECT
  count(*) FILTER (WHERE wallet_address ~ '^\d{16}$') AS numeric_business_wallets,
  count(*) FILTER (WHERE wallet_address !~ '^\d{16}$') AS still_non_numeric
FROM public.ican_business_wallets;
