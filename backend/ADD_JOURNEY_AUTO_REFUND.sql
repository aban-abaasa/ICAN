-- ============================================================================
-- Automatic refund when a paid journey's flight could not be booked.
--
-- confirm.js (mybodaguy) debits the customer's ICAN wallet and THEN books the
-- flight with the airline. If the airline rejects the booking, the customer used
-- to be told to contact support for a refund. This puts the money straight back:
-- one idempotent, service-role-only function that reverses the journey's debit
-- (tithe-free, exactly the amount taken) and stamps mbg_journeys.refunded_at so
-- the customer's page stops showing the "contact support" notice.
--
-- Safe against double refunds (a refund row per journey is checked under the
-- journey's row lock) and refuses to refund a journey that is not 'failed'.
--
-- Run after CREATE_JOURNEY_ESCROW_FUNCTION.sql. Safe to re-run.
-- ============================================================================

ALTER TABLE public.mbg_journeys ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.mbg_refund_journey_fare(p_journey_id UUID, p_reason TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_journey public.mbg_journeys%ROWTYPE;
  v_debit RECORD;
  v_ref TEXT := 'journey-refund:' || p_journey_id::TEXT;
BEGIN
  SELECT * INTO v_journey FROM public.mbg_journeys WHERE id = p_journey_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Journey not found');
  END IF;
  IF v_journey.status <> 'failed' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only a failed journey can be refunded');
  END IF;
  IF v_journey.ican_journey_tx_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'No payment was taken for this journey');
  END IF;
  IF v_journey.refunded_at IS NOT NULL OR EXISTS (
    SELECT 1 FROM public.ican_coin_transactions WHERE transaction_type = 'refund' AND reference_id = v_ref
  ) THEN
    RETURN jsonb_build_object('success', true, 'already_refunded', true);
  END IF;

  SELECT sender_user_id, ican_amount INTO v_debit
  FROM public.ican_coin_transactions
  WHERE id = v_journey.ican_journey_tx_id AND transaction_type = 'journey_payment';
  IF v_debit.sender_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Original payment not found');
  END IF;

  -- Reverse the debit in full — not credit_ican_earning(), which would apply a
  -- tithe to money the customer never actually earned.
  UPDATE public.ican_user_wallets
  SET ican_balance = ican_balance + v_debit.ican_amount,
      total_spent  = GREATEST(total_spent - v_debit.ican_amount, 0)
  WHERE user_id = v_debit.sender_user_id;

  INSERT INTO public.ican_coin_transactions
    (recipient_user_id, ican_amount, transaction_type, source_app, reference_id, note, status)
  VALUES
    (v_debit.sender_user_id, v_debit.ican_amount, 'refund', 'mybodaguy', v_ref,
     format('Journey booking failed, refunded: %s', COALESCE(p_reason, 'airline could not confirm the booking')),
     'completed');

  UPDATE public.mbg_journeys SET refunded_at = now(), updated_at = now() WHERE id = p_journey_id;

  RETURN jsonb_build_object('success', true, 'refunded_ican', v_debit.ican_amount);
END;
$$;

-- Server-side only: never callable from a browser.
REVOKE ALL ON FUNCTION public.mbg_refund_journey_fare(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mbg_refund_journey_fare(UUID, TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '✅ mbg_refund_journey_fare ready — a journey whose flight could not be booked is refunded automatically.';
END $$;
