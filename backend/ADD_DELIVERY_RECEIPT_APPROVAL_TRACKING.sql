-- ============================================================================
-- Turns icanera_confirm_pickup into a real "Approve" step, trackable by
-- email, and makes re-scanning an already-approved code show who approved
-- it instead of silently letting it be claimed again.
--
-- Run after ADD_DELIVERY_RECEIPT_VERIFICATION.sql.
--
-- 1. WHO CAN APPROVE
--    Previously only auth.uid() = store_owner_user_id or rider_user_id
--    could approve. In practice the person tapping "Approve" at the store
--    counter is often staff, not the registered supermarkets.owner_user_id
--    account — and the whole point of adding Google sign-in here is to let
--    ANYONE physically present with the QR code approve in one tap, with no
--    pre-existing mybodaguy/ICAN account. The real security boundary is
--    POSSESSION of the unguessable verification_code (40 bits of entropy)
--    plus the approval being ONE-SHOT: once a receipt leaves 'paid', it can
--    never be approved again by anyone else. So this drops the owner/rider
--    identity check and instead just requires being signed in (any
--    provider, Google included) — the accountability comes from recording
--    exactly who did it, not from gatekeeping who's allowed to try.
--
-- 2. WHO APPROVED IT
--    picked_up_confirmed_by_email is captured from auth.users at the
--    moment of approval and surfaced back through
--    icanera_verify_delivery_receipt — so scanning an already-approved
--    code shows "Approved by <email> at <time>" instead of just failing
--    silently. This is what makes the code genuinely single-use in
--    practice: a second rider or store scanning it sees, in plain text,
--    that someone else already claimed it and when.
-- ============================================================================

ALTER TABLE public.icanera_delivery_receipts
  ADD COLUMN IF NOT EXISTS picked_up_confirmed_by_email TEXT;

CREATE OR REPLACE FUNCTION public.icanera_confirm_pickup(p_verification_code TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_receipt public.icanera_delivery_receipts%ROWTYPE;
  v_email TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Sign in with Google to approve this pickup');
  END IF;

  SELECT * INTO v_receipt FROM public.icanera_delivery_receipts
  WHERE verification_code = upper(p_verification_code) FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Receipt not found');
  END IF;

  IF v_receipt.status <> 'paid' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', CASE
        WHEN v_receipt.status IN ('picked_up', 'delivered') THEN
          'Already approved by ' || COALESCE(v_receipt.picked_up_confirmed_by_email, 'someone')
            || ' at ' || to_char(v_receipt.picked_up_at, 'YYYY-MM-DD HH24:MI')
        ELSE 'This receipt is not awaiting pickup'
      END,
      'status', v_receipt.status,
      'picked_up_by_email', v_receipt.picked_up_confirmed_by_email,
      'picked_up_at', v_receipt.picked_up_at
    );
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = auth.uid();

  UPDATE public.icanera_delivery_receipts
  SET status = 'picked_up', picked_up_at = now(), picked_up_confirmed_by = auth.uid(), picked_up_confirmed_by_email = v_email
  WHERE id = v_receipt.id;

  RETURN jsonb_build_object('success', true, 'status', 'picked_up', 'picked_up_by_email', v_email);
END;
$$;
REVOKE ALL ON FUNCTION public.icanera_confirm_pickup(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.icanera_confirm_pickup(TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.icanera_verify_delivery_receipt(p_code TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_receipt public.icanera_delivery_receipts%ROWTYPE;
BEGIN
  SELECT * INTO v_receipt FROM public.icanera_delivery_receipts
  WHERE verification_code = upper(p_code);

  IF NOT FOUND THEN
    RETURN jsonb_build_object('is_valid', false);
  END IF;

  RETURN jsonb_build_object(
    'is_valid', true,
    'status', v_receipt.status,
    'store_name', v_receipt.store_name,
    'item_summary', v_receipt.item_summary,
    'created_at', v_receipt.created_at,
    'picked_up_at', v_receipt.picked_up_at,
    'picked_up_by_email', v_receipt.picked_up_confirmed_by_email,
    'delivered_at', v_receipt.delivered_at
  );
END;
$$;
REVOKE ALL ON FUNCTION public.icanera_verify_delivery_receipt(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.icanera_verify_delivery_receipt(TEXT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '✅ icanera_confirm_pickup now records the approver''s email and icanera_verify_delivery_receipt surfaces it — a re-scanned code shows who already approved it instead of allowing another approval.';
END $$;
