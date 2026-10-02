-- ===========================================================================
-- ICAN DIGITAL CARD: register every card payment as a wallet transaction.
--
-- Problem: paying with the digital card (PIN at scan, or owner confirm) moved
-- the money but wrote NO row to wallet_transactions, so the payment never
-- showed up in the wallet's transaction history. The only trace was the scan
-- row in ican_card_qr_requests.
--
-- Fix (all inside the same database transaction as the money movement, so a
-- payment can never be debited without being recorded):
--   * ICANera account  -> card_pin_send_to_account writes a 'send' row for the
--                         card owner and a 'receive' row for the recipient.
--   * Mobile money / bank (PIN at scan) -> new wrappers card_pin_request_momo_send
--                         / card_pin_request_bank_send call the existing
--                         request_fiat_*_send and record a pending 'send' row.
--   * Owner-confirm path -> finish_card_qr_request records the 'send' row.
--   * A trigger on ican_fiat_send_requests keeps the row's status in step with
--     the Flutterwave outcome (completed, or failed + refunded), so
--     resolve_fiat_momo_send and the transfer webhook need no change.
--   * Every row is tagged metadata.source = 'digital_card'; the wallet History
--     tab reads exactly those rows.
--
-- Run AFTER: ICAN_DIGITAL_CARD_QR.sql, ICAN_FIAT_MOBILE_MONEY_SEND_MIGRATION.sql
--            and ADD_CARD_PIN_PAY_ACCOUNT_AND_BANK.sql.
-- Redeploy:  supabase functions deploy card-pay-with-pin
--            (it now calls card_pin_request_momo_send / card_pin_request_bank_send
--             and passes the scan id to card_pin_send_to_account)
--
-- Safe to re-run: the backfill skips payments that already have a row.
-- ===========================================================================

-- ─── 1. Ledger helper (only other SECURITY DEFINER functions call it) ───────
CREATE OR REPLACE FUNCTION public._card_record_wallet_tx(
  p_user        UUID,
  p_type        TEXT,        -- 'send' | 'receive'
  p_amount      NUMERIC,
  p_status      TEXT,        -- 'pending' | 'completed' | 'failed'
  p_description TEXT,
  p_reference   TEXT,
  p_metadata    JSONB
) RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.wallet_transactions
    (id, wallet_id, user_id, transaction_type, amount, currency, status,
     description, reference, metadata, created_at)
  VALUES
    (gen_random_uuid(), NULL, p_user, p_type, p_amount, 'UGX', p_status,
     p_description, p_reference,
     COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object('source', 'digital_card'),
     now());
$$;
REVOKE ALL ON FUNCTION public._card_record_wallet_tx(UUID, TEXT, NUMERIC, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;

-- ─── 2. Wallet -> ICANera account: now records both sides ───────────────────
-- Signature gains p_request_id (the scan row) so the record links back to it
-- and the backfill below stays idempotent. Drop the old signature first so
-- there is only one overload.
DROP FUNCTION IF EXISTS public.card_pin_send_to_account(UUID, TEXT, DECIMAL);

CREATE OR REPLACE FUNCTION public.card_pin_send_to_account(
  p_from_user      UUID,
  p_account_number TEXT,
  p_amount         DECIMAL,
  p_request_id     UUID DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_to_user UUID;
  v_to_name TEXT;
BEGIN
  IF NOT (p_amount > 0) THEN
    RETURN jsonb_build_object('success', false, 'error', 'amount must be a positive number');
  END IF;

  SELECT user_id, account_holder_name INTO v_to_user, v_to_name
    FROM public.user_accounts
   WHERE account_number = p_account_number AND business_id IS NULL AND coalesce(status, 'active') = 'active'
   LIMIT 1;
  IF v_to_user IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'No active personal ICANera account with that number');
  END IF;
  IF v_to_user = p_from_user THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot pay the card owner''s own account');
  END IF;

  -- Lock both wallets in a fixed order (no deadlocks), recipient must have a UGX wallet.
  PERFORM 1 FROM public.wallet_accounts
   WHERE user_id IN (p_from_user, v_to_user) AND currency = 'UGX'
   ORDER BY user_id FOR UPDATE;
  IF NOT EXISTS (SELECT 1 FROM public.wallet_accounts WHERE user_id = v_to_user AND currency = 'UGX') THEN
    RETURN jsonb_build_object('success', false, 'error', 'That account has no UGX wallet yet');
  END IF;

  UPDATE public.wallet_accounts SET balance = balance - p_amount
   WHERE user_id = p_from_user AND currency = 'UGX' AND balance >= p_amount;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Insufficient balance or wallet not found');
  END IF;

  UPDATE public.wallet_accounts SET balance = balance + p_amount
   WHERE user_id = v_to_user AND currency = 'UGX';

  PERFORM public._card_record_wallet_tx(
    p_from_user, 'send', p_amount, 'completed',
    'Card payment to ' || COALESCE(NULLIF(trim(v_to_name), ''), 'ICANera account ' || right(p_account_number, 4)),
    NULL,
    jsonb_build_object('channel', 'icanera', 'recipient_id', v_to_user::text,
                       'account_number', p_account_number, 'card_request_id', p_request_id));
  PERFORM public._card_record_wallet_tx(
    v_to_user, 'receive', p_amount, 'completed',
    'Card payment received',
    NULL,
    jsonb_build_object('channel', 'icanera', 'sender_id', p_from_user::text,
                       'card_request_id', p_request_id));

  RETURN jsonb_build_object('success', true, 'recipient_name', v_to_name);
END $$;

REVOKE ALL ON FUNCTION public.card_pin_send_to_account(UUID, TEXT, DECIMAL, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.card_pin_send_to_account(UUID, TEXT, DECIMAL, UUID) TO service_role;

-- ─── 3. Mobile money / bank (PIN at scan): debit + record in one transaction ─
CREATE OR REPLACE FUNCTION public.card_pin_request_momo_send(
  p_user_id    UUID,
  p_amount     DECIMAL,
  p_phone      TEXT,
  p_network    TEXT,
  p_note       TEXT DEFAULT NULL,
  p_request_id UUID DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_res JSONB;
BEGIN
  v_res := public.request_fiat_momo_send(p_user_id, p_amount, 'UGX', p_phone, p_network, p_note);
  IF COALESCE((v_res->>'success')::boolean, false) THEN
    PERFORM public._card_record_wallet_tx(
      p_user_id, 'send', p_amount, 'pending',
      'Card payment to ' || p_network || ' ' || p_phone,
      v_res->>'reference',
      jsonb_build_object('channel', 'momo', 'network', p_network, 'recipient_phone', p_phone,
                         'note', p_note, 'card_request_id', p_request_id));
  END IF;
  RETURN v_res;
END $$;

REVOKE ALL ON FUNCTION public.card_pin_request_momo_send(UUID, DECIMAL, TEXT, TEXT, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.card_pin_request_momo_send(UUID, DECIMAL, TEXT, TEXT, TEXT, UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.card_pin_request_bank_send(
  p_user_id        UUID,
  p_amount         DECIMAL,
  p_account_number TEXT,
  p_bank_code      TEXT,
  p_beneficiary    TEXT,
  p_note           TEXT DEFAULT NULL,
  p_request_id     UUID DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_res JSONB;
BEGIN
  v_res := public.request_fiat_bank_send(p_user_id, p_amount, p_account_number, p_bank_code, p_beneficiary, p_note);
  IF COALESCE((v_res->>'success')::boolean, false) THEN
    PERFORM public._card_record_wallet_tx(
      p_user_id, 'send', p_amount, 'pending',
      'Card payment to ' || left(trim(p_beneficiary), 60) || ' (bank)',
      v_res->>'reference',
      jsonb_build_object('channel', 'bank', 'bank_code', p_bank_code, 'account_number', p_account_number,
                         'beneficiary', left(trim(p_beneficiary), 80), 'note', p_note,
                         'card_request_id', p_request_id));
  END IF;
  RETURN v_res;
END $$;

REVOKE ALL ON FUNCTION public.card_pin_request_bank_send(UUID, DECIMAL, TEXT, TEXT, TEXT, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.card_pin_request_bank_send(UUID, DECIMAL, TEXT, TEXT, TEXT, TEXT, UUID) TO service_role;

-- ─── 4. Owner-confirm path: record when the owner's confirmed send succeeds ──
-- The owner path pays through flutterwave-momo-send (no card wrapper), so the
-- record is made here, once the request is marked completed.
CREATE OR REPLACE FUNCTION public.finish_card_qr_request(
  p_request_id UUID, p_ok BOOLEAN, p_reference TEXT, p_reason TEXT
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row    public.ican_card_qr_requests;
  v_status TEXT;
BEGIN
  UPDATE public.ican_card_qr_requests
     SET status = CASE WHEN p_ok THEN 'completed' ELSE 'failed' END,
         fiat_reference = p_reference, failure_reason = left(p_reason, 300), resolved_at = now()
   WHERE id = p_request_id AND owner_user_id = auth.uid() AND status = 'processing'
  RETURNING * INTO v_row;

  IF v_row.id IS NOT NULL AND p_ok AND p_reference IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.wallet_transactions WHERE reference = p_reference) THEN
    -- The webhook may already have settled the transfer; start from its real state.
    SELECT CASE status WHEN 'completed' THEN 'completed' WHEN 'failed' THEN 'failed' ELSE 'pending' END
      INTO v_status FROM public.ican_fiat_send_requests WHERE flutterwave_reference = p_reference;
    PERFORM public._card_record_wallet_tx(
      v_row.owner_user_id, 'send', v_row.amount, COALESCE(v_status, 'pending'),
      'Card payment to ' || COALESCE(NULLIF(trim(v_row.requester_name), ''), v_row.recipient_network || ' ' || v_row.recipient_phone),
      p_reference,
      jsonb_build_object('channel', 'momo', 'network', v_row.recipient_network,
                         'recipient_phone', v_row.recipient_phone, 'note', v_row.note,
                         'card_request_id', v_row.id));
  END IF;
END $$;

-- ─── 5. Keep the record's status in step with the real transfer outcome ─────
-- resolve_fiat_momo_send (called by the webhook / on failure) updates
-- ican_fiat_send_requests; this mirrors that onto the card's wallet row.
CREATE OR REPLACE FUNCTION public._sync_card_wallet_tx_status() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    UPDATE public.wallet_transactions
       SET status = CASE NEW.status WHEN 'completed' THEN 'completed' WHEN 'failed' THEN 'failed' ELSE 'pending' END,
           updated_at = now()
     WHERE reference = NEW.flutterwave_reference
       AND user_id = NEW.sender_user_id
       AND metadata->>'source' = 'digital_card';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS card_wallet_tx_status_sync ON public.ican_fiat_send_requests;
CREATE TRIGGER card_wallet_tx_status_sync
  AFTER UPDATE OF status ON public.ican_fiat_send_requests
  FOR EACH ROW EXECUTE FUNCTION public._sync_card_wallet_tx_status();

-- ─── 6. Backfill payments already made before this fix ──────────────────────
-- ICANera-account payments (matched on the scan row, so re-running is a no-op).
INSERT INTO public.wallet_transactions
  (id, wallet_id, user_id, transaction_type, amount, currency, status, description, reference, metadata, created_at)
SELECT gen_random_uuid(), NULL, r.owner_user_id, 'send', r.amount, 'UGX', 'completed',
       'Card payment to ' || COALESCE(NULLIF(trim(ua.account_holder_name), ''), 'ICANera account ' || right(r.recipient_phone, 4)),
       NULL,
       jsonb_build_object('source', 'digital_card', 'channel', 'icanera', 'recipient_id', ua.user_id::text,
                          'account_number', r.recipient_phone, 'card_request_id', r.id, 'backfilled', true),
       COALESCE(r.resolved_at, r.created_at)
  FROM public.ican_card_qr_requests r
  JOIN public.user_accounts ua ON ua.account_number = r.recipient_phone AND ua.business_id IS NULL
 WHERE r.dest_type = 'icanera' AND r.status = 'completed'
   AND NOT EXISTS (SELECT 1 FROM public.wallet_transactions w
                    WHERE w.metadata->>'source' = 'digital_card' AND w.metadata->>'card_request_id' = r.id::text);

INSERT INTO public.wallet_transactions
  (id, wallet_id, user_id, transaction_type, amount, currency, status, description, reference, metadata, created_at)
SELECT gen_random_uuid(), NULL, ua.user_id, 'receive', r.amount, 'UGX', 'completed',
       'Card payment received', NULL,
       jsonb_build_object('source', 'digital_card', 'channel', 'icanera', 'sender_id', r.owner_user_id::text,
                          'card_request_id', r.id, 'backfilled', true),
       COALESCE(r.resolved_at, r.created_at)
  FROM public.ican_card_qr_requests r
  JOIN public.user_accounts ua ON ua.account_number = r.recipient_phone AND ua.business_id IS NULL
 WHERE r.dest_type = 'icanera' AND r.status = 'completed'
   AND NOT EXISTS (SELECT 1 FROM public.wallet_transactions w
                    WHERE w.user_id = ua.user_id AND w.transaction_type = 'receive'
                      AND w.metadata->>'source' = 'digital_card' AND w.metadata->>'card_request_id' = r.id::text);

-- Mobile money / bank payments that reached Flutterwave (matched on reference).
INSERT INTO public.wallet_transactions
  (id, wallet_id, user_id, transaction_type, amount, currency, status, description, reference, metadata, created_at)
SELECT gen_random_uuid(), NULL, r.owner_user_id, 'send', r.amount, 'UGX',
       CASE f.status WHEN 'completed' THEN 'completed' WHEN 'failed' THEN 'failed' ELSE 'pending' END,
       'Card payment to ' || CASE WHEN r.dest_type = 'bank'
                                  THEN COALESCE(NULLIF(trim(r.beneficiary_name), ''), 'bank account') || ' (bank)'
                                  ELSE r.recipient_network || ' ' || r.recipient_phone END,
       r.fiat_reference,
       jsonb_build_object('source', 'digital_card', 'channel', CASE WHEN r.dest_type = 'bank' THEN 'bank' ELSE 'momo' END,
                          'card_request_id', r.id, 'backfilled', true),
       COALESCE(r.resolved_at, r.created_at)
  FROM public.ican_card_qr_requests r
  JOIN public.ican_fiat_send_requests f ON f.flutterwave_reference = r.fiat_reference
 WHERE r.dest_type IN ('momo', 'bank') AND r.status = 'completed' AND r.fiat_reference IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.wallet_transactions w WHERE w.reference = r.fiat_reference);

NOTIFY pgrst, 'reload schema';
