-- =====================================================
-- MANUAL TRANSACTION HELPERS + NEVER-DELETE FOR PERMANENT TRANSACTIONS
-- =====================================================
-- Pitchin > Share Value > Manual Transactions lets a business owner assign
-- helpers (business_team_members) — including people from the business's CMMS
-- company — to enter data on behalf of the company. This script makes what they
-- record, and every other transaction that ties two accounts together,
-- permanent.
--
-- A row in ican_transactions is PERMANENT (involves_two_accounts = TRUE, with
-- lock_reason saying why) when it is:
--     helper       recorded by an assigned helper on behalf of the company
--     cmms         booked from CMMS (metadata.source_app = 'cmms')
--     wallet       an IcanEra wallet movement (top-up, transfer, card/cash payment…)
--     co_owner     recorded by someone other than the company's owner
--     counterparty carrying metadata.counterparty_user_id (e.g. cash payments)
-- The flag is set by a trigger at INSERT time, so a client can neither skip nor
-- fake it. Wallet-ledger rows in ican_coin_transactions can't be deleted either.
--
-- A permanent row can never be deleted, edited or "cancelled" (amount, type,
-- date, owner, bucket and completed status are frozen). Instead it can be
-- ARCHIVED: fn_archive_ican_transaction() compacts the stored detail to save
-- space, keeps the accounting facts and proof references, stamps a SHA-256
-- digest of the original row, and the entry keeps counting toward the share
-- valuation.
--
-- Deletes that come from an FK cascade (a whole account or business being
-- removed) are still allowed: pg_trigger_depth() > 1 identifies them, so deleting
-- an auth user is never blocked by this guard. Bulk clean-up
-- (cleanup_user_transactions) skips permanent rows instead of failing.
--
-- Safe to run more than once, and contains no DROP statements. Run after
-- PITCHIN_LIVE_SHARE_VALUE_MIGRATION.sql (business_profile_id) and
-- BUSINESS_TRANSACTIONS_BY_CONTRIBUTOR.sql (fn_can_view_business_financials).
-- BUSINESS_TEAM_MEMBERS_SETUP.sql supplies the helper roster (the flag trigger
-- degrades gracefully if it is missing).
-- Admins who really must purge a row can run
--   ALTER TABLE public.ican_transactions DISABLE TRIGGER trg_ican_tx_block_two_account_delete;
-- in the SQL editor — it is never reachable from the app.
-- =====================================================

-- ─── 1. Columns ─────────────────────────────────────────────────────────────

ALTER TABLE public.ican_transactions
  ADD COLUMN IF NOT EXISTS involves_two_accounts BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS entered_on_behalf     BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS lock_reason           TEXT,
  ADD COLUMN IF NOT EXISTS archived_at           TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_by           UUID;

CREATE INDEX IF NOT EXISTS idx_ican_tx_two_accounts
  ON public.ican_transactions (business_profile_id)
  WHERE involves_two_accounts;

-- ─── 2. Flag permanent rows at INSERT ───────────────────────────────────────
-- Always recomputed from the data, whatever the client sent.

CREATE OR REPLACE FUNCTION public.fn_ican_tx_flag_two_accounts()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner     TEXT;
  v_other     BOOLEAN := FALSE;   -- recorded by someone other than the company's owner
  v_helper    BOOLEAN := FALSE;   -- ...and that someone is an assigned helper
  v_cmms      BOOLEAN;
  v_wallet    BOOLEAN;
  v_counter   BOOLEAN;
BEGIN
  IF NEW.business_profile_id IS NOT NULL AND NEW.user_id IS NOT NULL THEN
    SELECT bp.user_id::TEXT INTO v_owner
    FROM public.business_profiles bp
    WHERE bp.id = NEW.business_profile_id;

    IF v_owner IS NOT NULL AND v_owner <> NEW.user_id::TEXT THEN
      v_other := TRUE;
      IF to_regclass('public.business_team_members') IS NOT NULL THEN
        EXECUTE 'SELECT EXISTS (
                   SELECT 1 FROM public.business_team_members m
                   WHERE m.business_profile_id = $1
                     AND m.user_id::TEXT = $2
                     AND m.status = ''active'')'
        INTO v_helper
        USING NEW.business_profile_id, NEW.user_id::TEXT;
      END IF;
    END IF;
  END IF;

  v_cmms := COALESCE(NEW.metadata->>'source_app', '') = 'cmms'
         OR COALESCE(NEW.metadata->>'category', '') = 'cmms_inventory'
         OR COALESCE(NEW.metadata->>'cmms_txn_id', '') <> '';

  v_wallet := COALESCE(NEW.transaction_type, '') IN
                ('top_up', 'transfer', 'card_payment', 'cash_payment', 'withdrawal', 'withdraw', 'cash_in', 'cash_out')
           OR COALESCE(NEW.metadata->>'source', '') IN ('wallet', 'ican_wallet', 'icanera_wallet');

  -- An explicit counterparty (cash payments write metadata.counterparty_user_id).
  v_counter := COALESCE(NEW.metadata->>'counterparty_user_id', '') <> ''
           AND (NEW.metadata->>'counterparty_user_id') <> NEW.user_id::TEXT;

  NEW.lock_reason := CASE
    WHEN COALESCE(v_helper, FALSE) THEN 'helper'
    WHEN v_cmms                    THEN 'cmms'
    WHEN v_wallet                  THEN 'wallet'
    WHEN v_other                   THEN 'co_owner'
    WHEN v_counter                 THEN 'counterparty'
    ELSE NULL
  END;
  NEW.involves_two_accounts := NEW.lock_reason IS NOT NULL;
  NEW.entered_on_behalf     := COALESCE(v_helper, FALSE);
  NEW.archived_at           := NULL;
  NEW.archived_by           := NULL;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_ican_tx_flag_two_accounts
  BEFORE INSERT ON public.ican_transactions
  FOR EACH ROW EXECUTE FUNCTION public.fn_ican_tx_flag_two_accounts();

-- ─── 3. Never delete ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_ican_tx_block_two_account_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- depth 1 = a direct DELETE; deeper = an FK cascade from an account/business
  -- being removed, which has to go through.
  IF OLD.involves_two_accounts AND pg_trigger_depth() <= 1 THEN
    RAISE EXCEPTION 'This transaction is permanent (it involves two accounts, the IcanEra wallet or CMMS) and can never be deleted. Archive it instead.'
      USING HINT = 'select public.fn_archive_ican_transaction(<transaction id>)';
  END IF;
  RETURN OLD;
END;
$$;

CREATE OR REPLACE TRIGGER trg_ican_tx_block_two_account_delete
  BEFORE DELETE ON public.ican_transactions
  FOR EACH ROW EXECUTE FUNCTION public.fn_ican_tx_block_two_account_delete();

-- ─── 4. Freeze the facts of a permanent row ─────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_ican_tx_guard_two_account_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_archiving BOOLEAN := COALESCE(current_setting('ican.archiving', TRUE), '') = 'on';
BEGIN
  IF v_archiving THEN
    RETURN NEW;               -- fn_archive_ican_transaction() is the only caller that sets this
  END IF;

  -- The flags are system-managed: ignore any attempt to change them (the app's
  -- generic update helper sends whole rows, so don't raise for that).
  NEW.involves_two_accounts := OLD.involves_two_accounts;
  NEW.entered_on_behalf     := OLD.entered_on_behalf;
  NEW.lock_reason           := OLD.lock_reason;
  NEW.archived_at           := OLD.archived_at;
  NEW.archived_by           := OLD.archived_by;

  IF OLD.involves_two_accounts AND pg_trigger_depth() <= 1 THEN
    IF NEW.user_id              IS DISTINCT FROM OLD.user_id
       OR NEW.business_profile_id IS DISTINCT FROM OLD.business_profile_id
       OR NEW.amount             IS DISTINCT FROM OLD.amount
       OR NEW.transaction_type   IS DISTINCT FROM OLD.transaction_type
       OR NEW.created_at         IS DISTINCT FROM OLD.created_at
       OR (OLD.status = 'completed' AND NEW.status IS DISTINCT FROM OLD.status)
       -- some deployments carry a deleted_at soft-delete column: that is a delete too
       OR (to_jsonb(NEW)->>'deleted_at') IS DISTINCT FROM (to_jsonb(OLD)->>'deleted_at')
       OR (NEW.metadata->>'reporting_bucket') IS DISTINCT FROM (OLD.metadata->>'reporting_bucket') THEN
      RAISE EXCEPTION 'This transaction is permanent: its amount, type, date, owner and status can never be changed, and it can never be deleted.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_ican_tx_guard_two_account_update
  BEFORE UPDATE ON public.ican_transactions
  FOR EACH ROW EXECUTE FUNCTION public.fn_ican_tx_guard_two_account_update();

-- ─── 5. Archive instead of delete ───────────────────────────────────────────
-- Only the business owner may archive a company's entries (the company is the
-- record keeper); a row with no business is archived by the account holding it.
-- One-way: the dropped detail (free text, quantities, product names…) is gone,
-- but the digest proves what the full row used to be.

CREATE OR REPLACE FUNCTION public.fn_archive_ican_transaction(p_transaction_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     UUID := auth.uid();
  r         public.ican_transactions;
  v_owner   TEXT;
  v_keep    TEXT[] := ARRAY[
    'category', 'source', 'source_app', 'record_category', 'accounting_type',
    'reporting_bucket', 'ledger_side', 'counterparty_user_id',
    'business_profile_id', 'recipient_business_profile_id',
    'payment_method', 'paymentMethod', 'momoTransactionId',
    'cash_receipt_id', 'receipt_number',
    'receipt_url', 'receipt_ref', 'receipt_attached_at', 'cmms_txn_id'
  ];
  v_compact JSONB;
  v_digest  TEXT;
  v_before  INTEGER;
  v_after   INTEGER;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO r FROM public.ican_transactions WHERE id = p_transaction_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transaction not found';
  END IF;

  IF NOT r.involves_two_accounts THEN
    RAISE EXCEPTION 'Only permanent transactions are archived; this one can be deleted normally.';
  END IF;

  IF r.business_profile_id IS NOT NULL THEN
    SELECT bp.user_id::TEXT INTO v_owner FROM public.business_profiles bp WHERE bp.id = r.business_profile_id;
    IF v_owner IS DISTINCT FROM v_uid::TEXT THEN
      RAISE EXCEPTION 'Only the business owner can archive this transaction.';
    END IF;
  ELSIF r.user_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'Only the account that holds this transaction can archive it.';
  END IF;

  IF r.archived_at IS NOT NULL THEN
    RETURN jsonb_build_object('id', r.id, 'archived_at', r.archived_at, 'already_archived', TRUE, 'bytes_saved', 0);
  END IF;

  v_digest := encode(sha256(convert_to(to_jsonb(r)::TEXT, 'UTF8')), 'hex');

  SELECT COALESCE(jsonb_object_agg(e.key, e.value), '{}'::JSONB)
    INTO v_compact
  FROM jsonb_each(COALESCE(r.metadata, '{}'::JSONB)) AS e(key, value)
  WHERE e.key = ANY (v_keep) AND e.value <> 'null'::JSONB;

  v_compact := v_compact || jsonb_build_object('archived', TRUE, 'archive_digest', v_digest);
  v_before  := pg_column_size(r.metadata);
  v_after   := pg_column_size(v_compact);

  PERFORM set_config('ican.archiving', 'on', TRUE);
  UPDATE public.ican_transactions
     SET metadata    = v_compact,
         archived_at = now(),
         archived_by = v_uid
   WHERE id = r.id
   RETURNING archived_at INTO r.archived_at;
  PERFORM set_config('ican.archiving', 'off', TRUE);

  RETURN jsonb_build_object(
    'id', r.id,
    'archived_at', r.archived_at,
    'already_archived', FALSE,
    'bytes_saved', GREATEST(COALESCE(v_before, 0) - v_after, 0)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_archive_ican_transaction(UUID) TO authenticated;

-- ─── 6. Day-book feed: tell the owner which entries are permanent / archived ─
-- Same shape as fn_get_business_transactions_by_contributor (left untouched) plus
-- the lock columns. A new name, because a function's return type can't change
-- in place without dropping it.

CREATE OR REPLACE FUNCTION public.fn_get_business_ledger_entries(p_business_profile_id UUID)
RETURNS TABLE (
  id UUID,
  contributor_user_id UUID,
  contributor_name TEXT,
  contributor_email TEXT,
  amount NUMERIC,
  reporting_bucket TEXT,
  description TEXT,
  created_at TIMESTAMPTZ,
  entered_on_behalf BOOLEAN,
  involves_two_accounts BOOLEAN,
  lock_reason TEXT,
  archived_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT fn_can_view_business_financials(p_business_profile_id) THEN
    RAISE EXCEPTION 'Not authorized to view this business''s transaction history';
  END IF;

  -- Text-ish columns are cast to TEXT for the same VARCHAR/TEXT reason as the
  -- original function — do not remove the casts.
  RETURN QUERY
  SELECT
    t.id,
    t.user_id AS contributor_user_id,
    COALESCE(p.full_name, btm.member_name, bco.owner_name, 'User ' || LEFT(t.user_id::TEXT, 8))::TEXT AS contributor_name,
    COALESCE(p.email, btm.member_email, bco.owner_email)::TEXT AS contributor_email,
    t.amount,
    (t.metadata->>'reporting_bucket')::TEXT AS reporting_bucket,
    t.description::TEXT,
    t.created_at,
    t.entered_on_behalf,
    t.involves_two_accounts,
    t.lock_reason::TEXT,
    t.archived_at
  FROM ican_transactions t
  LEFT JOIN profiles p
    ON p.id = t.user_id
  LEFT JOIN business_team_members btm
    ON btm.business_profile_id = t.business_profile_id AND btm.user_id = t.user_id
  LEFT JOIN business_co_owners bco
    ON bco.business_profile_id = t.business_profile_id AND bco.user_id = t.user_id
  WHERE t.business_profile_id = p_business_profile_id
    AND t.status = 'completed'
  ORDER BY t.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_get_business_ledger_entries(UUID) TO authenticated;

-- ─── 7. IcanEra wallet ledger: no deleting ──────────────────────────────────
-- ican_coin_transactions is the sender -> recipient ledger between two wallets.

CREATE OR REPLACE FUNCTION public.fn_block_wallet_ledger_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF pg_trigger_depth() <= 1 THEN      -- FK cascades (account removal) still go through
    RAISE EXCEPTION 'IcanEra wallet transactions involve two accounts and can never be deleted.';
  END IF;
  RETURN OLD;
END;
$$;

DO $guard$
BEGIN
  IF to_regclass('public.ican_coin_transactions') IS NOT NULL THEN
    EXECUTE 'CREATE OR REPLACE TRIGGER trg_ican_coin_tx_no_delete
               BEFORE DELETE ON public.ican_coin_transactions
               FOR EACH ROW EXECUTE FUNCTION public.fn_block_wallet_ledger_delete()';
  END IF;
END
$guard$;

-- ─── 8. Bulk clean-up skips permanent rows instead of failing ───────────────
-- Only if the deployment has the RPC (it deletes the caller's own transactions).

DO $cleanup$
BEGIN
  IF to_regprocedure('public.cleanup_user_transactions(text,integer,text)') IS NOT NULL THEN
    EXECUTE $def$
      CREATE OR REPLACE FUNCTION public.cleanup_user_transactions(cleanup_type text DEFAULT 'all'::text, param integer DEFAULT NULL::integer, param_text text DEFAULT NULL::text)
      RETURNS TABLE(deleted_count integer, message text)
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path TO 'public', 'pg_temp'
      AS $body$
      DECLARE
        _deleted INT;
      BEGIN
        -- Permanent transactions (two accounts / IcanEra wallet / CMMS) are never deleted;
        -- every branch below leaves them in place.
        IF cleanup_type = 'all' THEN
          DELETE FROM ican_transactions WHERE user_id = auth.uid() AND NOT involves_two_accounts;
          GET DIAGNOSTICS _deleted = ROW_COUNT;
          RETURN QUERY SELECT _deleted, 'All deletable transactions deleted (permanent ones are kept)';

        ELSIF cleanup_type = 'old' THEN
          DELETE FROM ican_transactions
          WHERE user_id = auth.uid() AND NOT involves_two_accounts
            AND created_at < NOW() - (param || ' days')::INTERVAL;
          GET DIAGNOSTICS _deleted = ROW_COUNT;
          RETURN QUERY SELECT _deleted, 'Transactions older than ' || param || ' days deleted';

        ELSIF cleanup_type = 'type' THEN
          DELETE FROM ican_transactions
          WHERE user_id = auth.uid() AND NOT involves_two_accounts
            AND transaction_type = param_text;
          GET DIAGNOSTICS _deleted = ROW_COUNT;
          RETURN QUERY SELECT _deleted, 'All ' || param_text || ' transactions deleted';

        ELSIF cleanup_type = 'offline' THEN
          DELETE FROM ican_transactions
          WHERE user_id = auth.uid() AND NOT involves_two_accounts
            AND metadata->>'synced_from_offline' = 'true';
          GET DIAGNOSTICS _deleted = ROW_COUNT;
          RETURN QUERY SELECT _deleted, 'Offline synced transactions deleted';

        ELSIF cleanup_type = 'low_confidence' THEN
          DELETE FROM ican_transactions
          WHERE user_id = auth.uid() AND NOT involves_two_accounts
            AND (metadata->>'confidence')::float < (param::FLOAT / 100);
          GET DIAGNOSTICS _deleted = ROW_COUNT;
          RETURN QUERY SELECT _deleted, 'Transactions with <' || param || '% confidence deleted';

        ELSE
          RETURN QUERY SELECT 0, 'Unknown cleanup type: ' || cleanup_type;
        END IF;
      END;
      $body$
    $def$;
  END IF;
END
$cleanup$;

-- ─── 9. Optional: protect entries recorded before this script ───────────────
-- Rows written earlier are NOT locked. To lock the ones existing helpers
-- entered, uncomment and run once as an admin (the update guard otherwise resets
-- the flags, hence the setting):
--
-- BEGIN;
-- SET LOCAL ican.archiving = 'on';
-- UPDATE public.ican_transactions t
--    SET involves_two_accounts = TRUE, entered_on_behalf = TRUE, lock_reason = 'helper'
--  WHERE t.business_profile_id IS NOT NULL
--    AND EXISTS (SELECT 1 FROM public.business_team_members m
--                 WHERE m.business_profile_id = t.business_profile_id
--                   AND m.user_id = t.user_id AND m.status = 'active');
-- COMMIT;
