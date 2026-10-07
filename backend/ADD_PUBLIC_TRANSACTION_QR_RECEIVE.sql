-- ============================================================================
-- PUBLIC QR ON EVERY TRANSACTION — the client can also RECEIVE money from the business
-- ============================================================================
-- Run AFTER ADD_PUBLIC_TRANSACTION_QR.sql (it extends that file's QR) and after the business-wallet
-- files (PITCHIN_BUSINESS_PROFILE_ICAN_WALLET.sql, UNIFIED_BUSINESS_WALLET_OPERATIONS.sql).
--
-- The QR printed on a recorded transaction already lets a visitor SEE the receipt and, for a
-- money-in entry the owner switched on, PAY it. This adds the other direction: for a money-OUT
-- (expense) entry tagged to a business — a refund, a supplier or customer payout, change owed — the
-- owner can switch on "Let the client receive this money by scanning". The person named on the
-- receipt then scans the QR, signs in to IcanEra, and the amount moves from the BUSINESS WALLET to
-- their IcanEra wallet, priced at the live icaneracoin value.
--
-- Because this moves money OUT of a business, it is deliberately stricter than "pay by scanning":
--   * OFF by default, and only the business owner, a co-owner or someone given finance access
--     (not just whoever recorded the entry) can switch it on or off;
--   * the amount and the business always come from the server, never from the browser;
--   * ONE claim only (single use): the entry becomes 'received' and the link then shows a receipt;
--   * the switch expires on its own after 7 days, so a forgotten printout cannot be cashed later;
--   * the person who recorded the entry, the person who switched it on, and anyone on the
--     business's own team cannot claim it for themselves;
--   * the business wallet is debited atomically and only if it holds enough — otherwise nothing
--     moves; the claimer needs an IcanEra account (no Mobile Money payout here);
--   * every claim is written to the business wallet ledger, the coin ledger and a payout log, and
--     the owners / finance team are notified.
-- ============================================================================

SET lock_timeout = '5s';

-- ----------------------------------------------------------------------------
-- 1. Columns on the ledger (same guard as public_code / public_pay_status)
-- ----------------------------------------------------------------------------
ALTER TABLE public.ican_transactions
  ADD COLUMN IF NOT EXISTS public_receive_status     TEXT NOT NULL DEFAULT 'off',
  ADD COLUMN IF NOT EXISTS public_receive_enabled_by UUID,
  ADD COLUMN IF NOT EXISTS public_receive_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS public_received_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS public_received_by        UUID;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ican_transactions_public_receive_status_check') THEN
    ALTER TABLE public.ican_transactions
      ADD CONSTRAINT ican_transactions_public_receive_status_check
      CHECK (public_receive_status IN ('off', 'open', 'received', 'closed'));
  END IF;
END $$;

-- These columns decide where business money goes: a direct UPDATE may never change them.
CREATE OR REPLACE FUNCTION public.fn_guard_public_tx_fields()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('app.public_tx_write', TRUE) = 'on' THEN
    RETURN NEW;
  END IF;
  NEW.public_code               := OLD.public_code;
  NEW.public_pay_status         := OLD.public_pay_status;
  NEW.public_paid_at            := OLD.public_paid_at;
  NEW.public_receive_status     := OLD.public_receive_status;
  NEW.public_receive_enabled_by := OLD.public_receive_enabled_by;
  NEW.public_receive_expires_at := OLD.public_receive_expires_at;
  NEW.public_received_at        := OLD.public_received_at;
  NEW.public_received_by        := OLD.public_received_by;
  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- 2. Payout log — one row per claim, unique per entry (a second claim cannot be written)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.public_tx_receipts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id        UUID NOT NULL UNIQUE,
  business_profile_id   UUID NOT NULL,
  recipient_user_id     UUID NOT NULL,
  recipient_name        TEXT,
  authorised_by         UUID NOT NULL,
  amount_ugx            NUMERIC NOT NULL CHECK (amount_ugx > 0),
  ican_amount           NUMERIC NOT NULL CHECK (ican_amount > 0),
  reference_id          TEXT NOT NULL UNIQUE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS public_tx_receipts_biz_idx ON public.public_tx_receipts (business_profile_id, created_at DESC);
ALTER TABLE public.public_tx_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.public_tx_receipts FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. Rules
-- ----------------------------------------------------------------------------
-- Why this entry cannot pay a client (NULL = it can).
CREATE OR REPLACE FUNCTION public._public_tx_receive_blocker(r public.ican_transactions)
RETURNS TEXT LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF to_jsonb(r) ->> 'deleted_at' IS NOT NULL THEN
    RETURN 'This entry was deleted';
  END IF;
  IF r.business_profile_id IS NULL THEN
    RETURN 'Only entries recorded for a business can pay out of the business wallet';
  END IF;
  IF r.transaction_type IS DISTINCT FROM 'expense' THEN
    RETURN 'Only money-out (expense) entries can be received through the QR';
  END IF;
  IF upper(COALESCE(r.currency, 'UGX')) <> 'UGX' THEN
    RETURN 'Receiving by QR works for entries recorded in UGX';
  END IF;
  IF COALESCE(r.amount, 0) < 100 THEN
    RETURN 'The amount is too small (minimum UGX 100)';
  END IF;
  RETURN NULL;
END;
$$;

-- Is the switch really on right now? (on AND not expired)
CREATE OR REPLACE FUNCTION public._public_tx_receive_is_open(r public.ican_transactions)
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT r.public_receive_status = 'open'
     AND r.public_receive_expires_at IS NOT NULL
     AND r.public_receive_expires_at > now();
$$;

REVOKE ALL ON FUNCTION public._public_tx_receive_blocker(public.ican_transactions) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._public_tx_receive_is_open(public.ican_transactions)  FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4. What a scan shows about receiving (anon) — kept separate from public_tx_receipt
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.public_tx_receive_info(p_code TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r         public.ican_transactions%ROWTYPE;
  v_blocker TEXT;
  v_open    BOOLEAN;
BEGIN
  IF p_code IS NULL OR p_code !~ '^[a-z0-9]{16,40}$' THEN
    RETURN jsonb_build_object('found', FALSE);
  END IF;
  SELECT * INTO r FROM public.ican_transactions WHERE public_code = p_code;
  IF NOT FOUND OR to_jsonb(r) ->> 'deleted_at' IS NOT NULL THEN
    RETURN jsonb_build_object('found', FALSE);
  END IF;
  v_blocker := public._public_tx_receive_blocker(r);
  v_open    := v_blocker IS NULL AND public._public_tx_receive_is_open(r);
  RETURN jsonb_build_object(
    'found',        TRUE,
    'receivable',   v_open,
    'receive_status', CASE WHEN r.public_receive_status = 'open' AND NOT v_open THEN 'closed' ELSE r.public_receive_status END,
    'received',     r.public_receive_status = 'received',
    'received_at',  r.public_received_at,
    'amount_ugx',   CASE WHEN v_open THEN CEIL(r.amount) END,
    'expires_at',   CASE WHEN v_open THEN r.public_receive_expires_at END
  );
END;
$$;
REVOKE ALL ON FUNCTION public.public_tx_receive_info(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_tx_receive_info(TEXT) TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- 5. The owner's side — see the state, switch it on / off
-- ----------------------------------------------------------------------------
-- Who may switch it: the business owner, a co-owner, or anyone given finance access to the business.
CREATE OR REPLACE FUNCTION public.public_tx_receive_state(p_tx_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r         public.ican_transactions%ROWTYPE;
  v_blocker TEXT;
  v_manage  BOOLEAN;
  v_pay     RECORD;
  v_open    BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Please sign in');
  END IF;
  SELECT * INTO r FROM public.ican_transactions WHERE id = p_tx_id;
  IF NOT FOUND OR NOT public._public_tx_can_manage(r) THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Transaction not found');
  END IF;
  v_blocker := public._public_tx_receive_blocker(r);
  v_manage  := r.business_profile_id IS NOT NULL AND public._public_tx_business_access(r.business_profile_id);
  v_open    := public._public_tx_receive_is_open(r);

  SELECT pr.recipient_name, pr.amount_ugx INTO v_pay
    FROM public.public_tx_receipts pr WHERE pr.transaction_id = r.id;

  RETURN jsonb_build_object(
    'success',        TRUE,
    'receive_status', CASE WHEN r.public_receive_status = 'open' AND NOT v_open THEN 'closed' ELSE r.public_receive_status END,
    'can_enable',     v_blocker IS NULL AND v_manage AND r.public_receive_status IN ('off', 'closed', 'open'),
    'can_manage',     v_manage,
    'blocker',        v_blocker,
    'expires_at',     CASE WHEN v_open THEN r.public_receive_expires_at END,
    'received', CASE WHEN r.public_receive_status = 'received' THEN jsonb_build_object(
                  'recipient_name', v_pay.recipient_name,
                  'received_at', r.public_received_at,
                  'amount_ugx', COALESCE(v_pay.amount_ugx, r.amount)) END
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.public_tx_set_receive(p_tx_id UUID, p_enable BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r         public.ican_transactions%ROWTYPE;
  v_blocker TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Please sign in');
  END IF;
  SELECT * INTO r FROM public.ican_transactions WHERE id = p_tx_id FOR UPDATE;
  IF NOT FOUND OR NOT public._public_tx_can_manage(r) THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Transaction not found');
  END IF;
  IF r.public_receive_status = 'received' THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'This money was already received');
  END IF;
  -- Switching it ON releases business money: owner, co-owner or finance access only.
  IF r.business_profile_id IS NULL OR NOT public._public_tx_business_access(r.business_profile_id) THEN
    RETURN jsonb_build_object('success', FALSE,
      'error', 'Only the business owner, a co-owner or someone with finance access can allow this');
  END IF;
  IF p_enable THEN
    v_blocker := public._public_tx_receive_blocker(r);
    IF v_blocker IS NOT NULL THEN
      RETURN jsonb_build_object('success', FALSE, 'error', v_blocker);
    END IF;
  END IF;

  PERFORM set_config('app.public_tx_write', 'on', TRUE);
  UPDATE public.ican_transactions
     SET public_receive_status     = CASE WHEN p_enable THEN 'open' ELSE 'closed' END,
         public_receive_enabled_by = CASE WHEN p_enable THEN auth.uid() ELSE public_receive_enabled_by END,
         public_receive_expires_at = CASE WHEN p_enable THEN now() + INTERVAL '7 days' ELSE NULL END,
         public_code               = COALESCE(public_code, public.fn_new_public_tx_code())
   WHERE id = r.id;
  PERFORM set_config('app.public_tx_write', 'off', TRUE);

  RETURN public.public_tx_receive_state(p_tx_id);
END;
$$;

REVOKE ALL ON FUNCTION public.public_tx_receive_state(UUID)          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.public_tx_set_receive(UUID, BOOLEAN)   FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.public_tx_receive_state(UUID)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.public_tx_set_receive(UUID, BOOLEAN) TO authenticated;

-- ----------------------------------------------------------------------------
-- 6. The client claims it (signed in): business wallet -> the client's IcanEra wallet
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.public_tx_receive_wallet(p_code TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid      UUID := auth.uid();
  r          public.ican_transactions%ROWTYPE;
  v_blocker  TEXT;
  v_amount   NUMERIC;
  v_price    NUMERIC;
  v_ican     NUMERIC;
  v_name     TEXT;
  v_issuer   TEXT;
  v_receipt  TEXT;
  v_ref      TEXT;
  v_note     TEXT;
  v_approver UUID;
  v_wallet   public.ican_business_wallets%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Sign in to receive this money in your IcanEra wallet');
  END IF;
  IF p_code IS NULL OR p_code !~ '^[a-z0-9]{16,40}$' THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'This receipt link is not valid');
  END IF;

  SELECT * INTO r FROM public.ican_transactions WHERE public_code = p_code FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'This receipt link is not valid');
  END IF;
  IF r.public_receive_status = 'received' THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'This money has already been received');
  END IF;
  IF NOT public._public_tx_receive_is_open(r) THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Receiving is not switched on for this receipt, or it has expired — ask the business to switch it on again');
  END IF;
  v_blocker := public._public_tx_receive_blocker(r);
  IF v_blocker IS NOT NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', v_blocker);
  END IF;

  -- The business's own people cannot cash out through a customer-facing QR.
  IF v_uid = r.user_id OR v_uid = r.public_receive_enabled_by
     OR public._public_tx_business_access(r.business_profile_id)
     OR v_uid = ANY (public._public_tx_approver_ids(r.business_profile_id, r.user_id)) THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'This is the business''s own payout — the client must scan it with their own IcanEra account');
  END IF;

  SELECT COALESCE(NULLIF(btrim(p.full_name), ''), 'IcanEra member') INTO v_name
    FROM public.profiles p WHERE p.id = v_uid;
  v_name := COALESCE(v_name, 'IcanEra member');
  SELECT business_name INTO v_issuer FROM public.business_profiles WHERE id = r.business_profile_id;
  v_receipt := public._public_tx_receipt_no(r.created_at, r.id, r.metadata);
  v_ref     := 'PUBTX-R-' || r.id::text;
  v_amount  := CEIL(r.amount);
  v_note    := format('Received by QR — %s | receipt %s | %s', v_name, v_receipt, COALESCE(NULLIF(r.description, ''), 'Payout'));

  BEGIN
    v_price := public.public_tx_ican_price_ugx();
    v_ican  := GREATEST(ROUND(v_amount / v_price, 8), 0.00000001);

    PERFORM public.get_or_create_pitchin_business_wallet(r.business_profile_id);

    -- Debit the BUSINESS wallet first, atomically and only when it can afford it.
    UPDATE public.ican_business_wallets
       SET ican_balance = ican_balance - v_ican,
           total_spent  = total_spent + v_ican,
           updated_at   = now()
     WHERE business_profile_id = r.business_profile_id
       AND status = 'active'
       AND ican_balance >= v_ican;
    IF NOT FOUND THEN
      SELECT * INTO v_wallet FROM public.ican_business_wallets WHERE business_profile_id = r.business_profile_id;
      IF v_wallet.id IS NULL OR v_wallet.status <> 'active' THEN
        RAISE EXCEPTION 'The business wallet is not available right now';
      END IF;
      RAISE EXCEPTION 'The business wallet does not have enough ICAN to pay this out right now — ask the business to top it up';
    END IF;

    -- Credit the client.
    PERFORM public.get_or_create_ican_wallet(v_uid);
    UPDATE public.ican_user_wallets
       SET ican_balance = ican_balance + v_ican, total_earned = total_earned + v_ican
     WHERE user_id = v_uid;

    INSERT INTO public.ican_business_wallet_transactions
      (business_profile_id, initiated_by, recipient_user_id, amount_ican, note, reference_id,
       status, executed_at, direction, source_app, operation_type, metadata)
    VALUES
      (r.business_profile_id, r.public_receive_enabled_by, v_uid, v_ican, v_note, v_ref,
       'completed', now(), 'out', 'ican', 'qr_receive',
       jsonb_build_object('receipt_number', v_receipt, 'transaction_id', r.id, 'amount_ugx', v_amount));

    INSERT INTO public.ican_coin_transactions
      (sender_user_id, recipient_user_id, ican_amount, type, transaction_type, status,
       local_amount, local_currency, source_app, reference_id, note, business_profile_id)
    VALUES
      (r.public_receive_enabled_by, v_uid, v_ican, 'transfer_out', 'transfer_out', 'completed',
       v_amount, 'UGX', 'ican', v_ref, v_note, r.business_profile_id);

    INSERT INTO public.public_tx_receipts
      (transaction_id, business_profile_id, recipient_user_id, recipient_name, authorised_by,
       amount_ugx, ican_amount, reference_id)
    VALUES
      (r.id, r.business_profile_id, v_uid, v_name, r.public_receive_enabled_by, v_amount, v_ican, v_ref);

    PERFORM set_config('app.public_tx_write', 'on', TRUE);
    UPDATE public.ican_transactions
       SET public_receive_status = 'received',
           public_received_at    = now(),
           public_received_by    = v_uid,
           metadata = COALESCE(metadata, '{}'::JSONB)
                      || jsonb_build_object('public_receive', jsonb_build_object(
                           'via', 'wallet', 'recipient_name', v_name, 'ican_amount', v_ican,
                           'amount_ugx', v_amount, 'received_at', now()))
     WHERE id = r.id;
    PERFORM set_config('app.public_tx_write', 'off', TRUE);

    FOREACH v_approver IN ARRAY public._public_tx_approver_ids(r.business_profile_id, r.user_id) LOOP
      PERFORM public._public_tx_notify(
        v_approver, 'qr_payout_received',
        'Paid out by QR: UGX ' || to_char(v_amount, 'FM999,999,999,990'),
        v_name || ' received UGX ' || to_char(v_amount, 'FM999,999,999,990') || ' from ' || COALESCE(v_issuer, 'the business wallet')
          || ' for "' || left(COALESCE(r.description, 'payout'), 80) || '" (' || v_receipt || ').',
        r.business_profile_id, r.id);
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    -- the whole block rolls back: no half-moved money
    PERFORM set_config('app.public_tx_write', 'off', TRUE);
    RETURN jsonb_build_object('success', FALSE, 'error', SQLERRM);
  END;

  RETURN jsonb_build_object('success', TRUE, 'receipt_number', v_receipt,
                            'amount_ugx', v_amount, 'ican_received', v_ican);
END;
$$;

REVOKE ALL ON FUNCTION public.public_tx_receive_wallet(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.public_tx_receive_wallet(TEXT) TO authenticated;

RESET lock_timeout;

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '✅ A recorded money-out entry''s public QR can now pay the client from the business wallet: the owner (or finance) switches it on, the client scans, signs in and receives it once.';
END $$;
