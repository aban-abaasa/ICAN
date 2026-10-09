-- =============================================================================
-- DROPSHIP_CHECKOUT_REQUIRE_PIN.sql
-- Run after ADD_DROPSHIP_SMART_TRANSPORT.sql (the 11-argument dropship_checkout).
--
-- Paying for a dropship order from the IcanEra wallet now needs the customer's
-- wallet PIN, checked HERE on the server -- not just by a prompt in the page,
-- which anyone could skip by calling the RPC directly.
--
--  1. dropship_checkout_with_pin(p_pin_hash, ...same arguments...)
--     Verifies the signed-in user's PIN against user_accounts.pin_hash exactly
--     like the other wallet PIN flows (process_transaction_with_pin): the app
--     sends the same hashPIN() value, a wrong PIN bumps failed_pin_attempts, a
--     correct one resets it, and more than 3 failures locks the PIN. Only then
--     does it call dropship_checkout (which still runs as the customer).
--
--  2. dropship_checkout can no longer be called directly by signed-in or
--     anonymous clients. Internal callers (the instalment engine, guest
--     checkout's service-role function) are unaffected: they run as the
--     function owner / service role, not as `authenticated`.
-- =============================================================================

SET check_function_bodies = off;

DROP FUNCTION IF EXISTS public.dropship_checkout_with_pin(TEXT, UUID, JSONB, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, UUID, TEXT[]);

CREATE OR REPLACE FUNCTION public.dropship_checkout_with_pin(
  p_pin_hash           TEXT,
  p_reseller_business_profile_id UUID,
  p_cart               JSONB,
  p_customer_name      TEXT DEFAULT NULL,
  p_customer_phone     TEXT DEFAULT NULL,
  p_delivery_address   TEXT DEFAULT NULL,
  p_store_location     TEXT DEFAULT NULL,
  p_delivery_lat       NUMERIC DEFAULT NULL,
  p_delivery_lng       NUMERIC DEFAULT NULL,
  p_max_delivery_hours NUMERIC DEFAULT NULL,
  p_rider_id           UUID DEFAULT NULL,
  p_vehicle_types      TEXT[] DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid      UUID := auth.uid();
  v_hash     TEXT;
  v_attempts INTEGER;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Sign in to pay with your IcanEra wallet');
  END IF;

  SELECT pin_hash, COALESCE(failed_pin_attempts, 0) INTO v_hash, v_attempts
  FROM public.user_accounts
  WHERE user_id = v_uid
  LIMIT 1
  FOR UPDATE;

  IF v_hash IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Set up your IcanEra wallet PIN before paying');
  END IF;

  IF v_attempts > 3 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Your PIN is locked after too many wrong attempts. Reset your PIN from the wallet.');
  END IF;

  IF p_pin_hash IS NULL OR p_pin_hash <> v_hash THEN
    UPDATE public.user_accounts SET failed_pin_attempts = v_attempts + 1 WHERE user_id = v_uid;
    RETURN jsonb_build_object('success', false, 'error',
      'Wrong PIN. Attempts remaining: ' || GREATEST(3 - v_attempts, 0)::TEXT);
  END IF;

  IF v_attempts > 0 THEN
    UPDATE public.user_accounts SET failed_pin_attempts = 0 WHERE user_id = v_uid;
  END IF;

  RETURN public.dropship_checkout(
    p_reseller_business_profile_id, p_cart, p_customer_name, p_customer_phone, p_delivery_address,
    p_store_location, p_delivery_lat, p_delivery_lng, p_max_delivery_hours, p_rider_id, p_vehicle_types
  );
END;
$$;

REVOKE ALL ON FUNCTION public.dropship_checkout_with_pin(TEXT, UUID, JSONB, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, UUID, TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dropship_checkout_with_pin(TEXT, UUID, JSONB, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, UUID, TEXT[]) TO authenticated;

-- Close the side door: the PIN-less checkout is no longer callable from the client.
REVOKE EXECUTE ON FUNCTION public.dropship_checkout(UUID, JSONB, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, UUID, TEXT[]) FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';

SELECT 'dropship checkout now requires the wallet PIN' AS status, now() AS run_at;
