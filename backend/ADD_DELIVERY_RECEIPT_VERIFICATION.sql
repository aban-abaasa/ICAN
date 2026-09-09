-- ============================================================================
-- Shared "3-party" delivery receipt + public QR verification layer.
--
-- Used by any app in this shared Supabase project that charges a customer's
-- ICAN wallet for a delivery at ACCEPTANCE time (not at drop-off) and wants
-- one receipt that the customer, the store, and the rider can all check —
-- via a QR code pointing at a public, unauthenticated verification page.
--
-- This file only adds the shared table + 3 functions. Callers:
--   - mybodaguy/backend/database/ADD_DELIVERY_ACCEPTANCE_WALLET_CHARGE_AND_QR_RECEIPT.sql
--     (Bodagoera/Supermarkera delivery rides — calls icanera_create_delivery_receipt
--     from mbg_respond_to_ride once the customer's wallet debit succeeds)
--   - ICAN/backend/ADD_DROPSHIP_QR_RECEIPT.sql
--     (Dropshipper — calls it from dropship_checkout, which already debits the
--     customer at checkout; rider_user_id stays NULL there until a live
--     rider-dispatch integration exists, per DROPSHIP_BUSINESS_WALLET_AND_DELIVERY.sql's
--     own "no live BodaGoera ride-booking API" note)
--
-- icanera_verify_delivery_receipt is intentionally granted to `anon`: it is
-- the function the public verification page calls when a QR code is
-- scanned, and it only ever returns non-sensitive fields (no customer name,
-- phone, or amount) — proving the receipt is real and showing pickup status
-- without leaking anything a random scanner shouldn't see.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.icanera_delivery_receipts (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  verification_code       TEXT UNIQUE NOT NULL,
  source_app              TEXT NOT NULL CHECK (source_app IN ('mybodaguy', 'digital-city-era')),
  reference_type          TEXT NOT NULL CHECK (reference_type IN ('mbg_ride', 'dropship_order')),
  reference_id            UUID NOT NULL,
  customer_user_id        UUID NOT NULL,
  store_owner_user_id     UUID NOT NULL,
  rider_user_id           UUID,
  store_name              TEXT NOT NULL,
  item_summary            TEXT,
  amount_ican             NUMERIC NOT NULL,
  status                  TEXT NOT NULL DEFAULT 'paid' CHECK (status IN ('paid', 'picked_up', 'delivered', 'cancelled')),
  picked_up_at            TIMESTAMPTZ,
  picked_up_confirmed_by  UUID,
  delivered_at            TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS icanera_delivery_receipts_reference_idx
  ON public.icanera_delivery_receipts(source_app, reference_type, reference_id);
CREATE INDEX IF NOT EXISTS icanera_delivery_receipts_customer_idx ON public.icanera_delivery_receipts(customer_user_id);
CREATE INDEX IF NOT EXISTS icanera_delivery_receipts_store_idx ON public.icanera_delivery_receipts(store_owner_user_id);
CREATE INDEX IF NOT EXISTS icanera_delivery_receipts_rider_idx ON public.icanera_delivery_receipts(rider_user_id);

ALTER TABLE public.icanera_delivery_receipts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "parties_read_own_delivery_receipts" ON public.icanera_delivery_receipts;
CREATE POLICY "parties_read_own_delivery_receipts" ON public.icanera_delivery_receipts
  FOR SELECT USING (
    auth.uid() = customer_user_id OR auth.uid() = store_owner_user_id OR auth.uid() = rider_user_id
  );

-- ── Create a receipt (trusted server-side callers only — mbg_respond_to_ride,
-- dropship_checkout — never called directly from a client). ────────────────
CREATE OR REPLACE FUNCTION public.icanera_create_delivery_receipt(
  p_source_app       TEXT,
  p_reference_type   TEXT,
  p_reference_id     UUID,
  p_customer_user_id UUID,
  p_store_owner_user_id UUID,
  p_rider_user_id    UUID,
  p_store_name       TEXT,
  p_item_summary     TEXT,
  p_amount_ican      NUMERIC
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_code TEXT;
  v_id UUID;
BEGIN
  v_code := upper(substr(md5(gen_random_uuid()::text), 1, 10));

  INSERT INTO public.icanera_delivery_receipts (
    verification_code, source_app, reference_type, reference_id,
    customer_user_id, store_owner_user_id, rider_user_id,
    store_name, item_summary, amount_ican
  ) VALUES (
    v_code, p_source_app, p_reference_type, p_reference_id,
    p_customer_user_id, p_store_owner_user_id, p_rider_user_id,
    p_store_name, p_item_summary, p_amount_ican
  ) RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'success', true,
    'receipt_id', v_id,
    'verification_code', v_code,
    'verify_url', 'https://bodagoera.icanera.space/verify/' || v_code
  );
END;
$$;
REVOKE ALL ON FUNCTION public.icanera_create_delivery_receipt(TEXT, TEXT, UUID, UUID, UUID, UUID, TEXT, TEXT, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.icanera_create_delivery_receipt(TEXT, TEXT, UUID, UUID, UUID, UUID, TEXT, TEXT, NUMERIC) TO authenticated, service_role;

-- ── Store (or rider, once assigned) confirms the product has physically
-- left the store. Requires being one of the two parties actually present
-- at pickup — never callable by the customer or an anonymous scanner. ─────
CREATE OR REPLACE FUNCTION public.icanera_confirm_pickup(p_verification_code TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_receipt public.icanera_delivery_receipts%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Sign in required');
  END IF;

  SELECT * INTO v_receipt FROM public.icanera_delivery_receipts
  WHERE verification_code = upper(p_verification_code) FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Receipt not found');
  END IF;
  IF auth.uid() <> v_receipt.store_owner_user_id AND auth.uid() <> v_receipt.rider_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only the store or the assigned rider can confirm pickup');
  END IF;
  IF v_receipt.status <> 'paid' THEN
    RETURN jsonb_build_object('success', false, 'error', 'This receipt is not awaiting pickup', 'status', v_receipt.status);
  END IF;

  UPDATE public.icanera_delivery_receipts
  SET status = 'picked_up', picked_up_at = now(), picked_up_confirmed_by = auth.uid()
  WHERE id = v_receipt.id;

  RETURN jsonb_build_object('success', true, 'status', 'picked_up');
END;
$$;
REVOKE ALL ON FUNCTION public.icanera_confirm_pickup(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.icanera_confirm_pickup(TEXT) TO authenticated;

-- ── Public lookup for the QR verification page. No auth required — this is
-- what a random scan proves. Only non-sensitive fields are returned: no
-- customer name/phone, no amount, no user ids. ─────────────────────────────
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
    'delivered_at', v_receipt.delivered_at
  );
END;
$$;
REVOKE ALL ON FUNCTION public.icanera_verify_delivery_receipt(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.icanera_verify_delivery_receipt(TEXT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '✅ icanera_delivery_receipts + create/confirm-pickup/verify functions installed. Public verification page can now call icanera_verify_delivery_receipt(code) as anon.';
END $$;
