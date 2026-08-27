-- ================================================================
-- Backfill existing user_accounts.account_number values to the pure-digit
-- format that generateAccountNumber() (walletAccountService.js) and
-- handle_new_user() (ACCOUNT_NUMBER_AND_PIN_RESET_SCOPING.sql) already
-- produce for new accounts: 16 digits, leading digit 1 = personal,
-- 2 = business.
--
-- Rows created before that switch (via AUTO_CREATE_USER_ACCOUNTS.sql or
-- FIX_AUTO_SIGNUP_TRIGGER_NAMESPACE_ICAN.sql) still hold
-- 'ICAN-<timestamp>-<uuid prefix>' strings. Any row still in that shape
-- fails the /^\d{16}$/ account-number lookup used by ICANWallet.jsx's
-- send flow, AgentDashboard.jsx's cash-in/cash-out, and the ICAN/BIZ
-- recipient-type selector added on top of it — so those users can't be
-- paid or cashed out by account number until this runs.
--
-- No other table has a foreign key on account_number (everything else
-- joins through user_id), so rewriting it here is safe — only cosmetic
-- text in old transaction descriptions/receipts (if any) would still show
-- an old-format number, and that's expected for historical records.
--
-- Safe to run more than once: only touches rows that don't already match
-- the numeric format, and re-checks for collisions before assigning.
-- ================================================================

DO $$
DECLARE
  v_row RECORD;
  v_type_digit TEXT;
  v_new_number TEXT;
  v_migrated INTEGER := 0;
BEGIN
  FOR v_row IN
    SELECT id, account_type
    FROM public.user_accounts
    WHERE account_number !~ '^\d{16}$'
    FOR UPDATE
  LOOP
    v_type_digit := CASE WHEN COALESCE(v_row.account_type, 'personal') = 'business' THEN '2' ELSE '1' END;

    LOOP
      v_new_number := v_type_digit || lpad((floor(random() * 1e15))::bigint::text, 15, '0');
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM public.user_accounts WHERE account_number = v_new_number
      );
    END LOOP;

    UPDATE public.user_accounts
    SET account_number = v_new_number,
        updated_at = now()
    WHERE id = v_row.id;

    v_migrated := v_migrated + 1;
  END LOOP;

  RAISE NOTICE 'Migrated % existing account_number value(s) to the numeric-only format.', v_migrated;
END $$;

SELECT
  count(*) FILTER (WHERE account_number ~ '^\d{16}$') AS numeric_accounts,
  count(*) FILTER (WHERE account_number !~ '^\d{16}$') AS still_non_numeric
FROM public.user_accounts;
