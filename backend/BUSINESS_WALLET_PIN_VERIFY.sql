-- Verify an iCanEra business-wallet PIN without moving any money, so the wallet
-- can offer "enter your PIN" on the business Wallet Access page.
--
-- Mirrors the PIN rules inside pitchin_business_wallet_transfer(): bcrypt
-- compare against ican_business_wallet_settings.pin_hash, and 5 wrong tries lock
-- the PIN for 15 minutes. Only shareholders of the business may call it.
-- Expected outcomes come back as JSON (success true/false + message) rather than
-- exceptions, so the client can show the message and a failed attempt is still
-- counted.

CREATE OR REPLACE FUNCTION public.verify_pitchin_business_wallet_pin(
  p_business_profile_id uuid,
  p_pin text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pin_hash text;
  v_failed integer;
  v_locked timestamptz;
BEGIN
  IF auth.uid() IS NULL OR NOT public.pitchin_business_shareholder_access(p_business_profile_id) THEN
    RETURN jsonb_build_object('success', false, 'message', 'You do not have access to this business wallet.');
  END IF;

  SELECT pin_hash, pin_failed_attempts, pin_locked_until
    INTO v_pin_hash, v_failed, v_locked
    FROM public.ican_business_wallet_settings
   WHERE business_profile_id = p_business_profile_id
   FOR UPDATE;

  IF v_pin_hash IS NULL THEN
    RETURN jsonb_build_object('success', false, 'pin_set', false, 'message', 'No business-wallet PIN has been set yet.');
  END IF;

  IF v_locked IS NOT NULL AND v_locked > now() THEN
    RETURN jsonb_build_object('success', false, 'locked_until', v_locked,
      'message', 'Business-wallet PIN is temporarily locked. Try again later.');
  END IF;

  IF p_pin IS NULL OR p_pin !~ '^[0-9]{4,6}$' THEN
    RETURN jsonb_build_object('success', false, 'message', 'PIN must be 4 to 6 digits.');
  END IF;

  IF extensions.crypt(p_pin, v_pin_hash) <> v_pin_hash THEN
    v_failed := COALESCE(v_failed, 0) + 1;
    UPDATE public.ican_business_wallet_settings
       SET pin_failed_attempts = v_failed,
           pin_locked_until = CASE WHEN v_failed >= 5 THEN now() + interval '15 minutes' ELSE NULL END,
           updated_at = now()
     WHERE business_profile_id = p_business_profile_id;
    RETURN jsonb_build_object('success', false, 'message',
      CASE WHEN v_failed >= 5 THEN 'Too many wrong PINs. Locked for 15 minutes.'
           ELSE 'Incorrect PIN. ' || (5 - v_failed) || ' attempts left.' END);
  END IF;

  UPDATE public.ican_business_wallet_settings
     SET pin_failed_attempts = 0, pin_locked_until = NULL, updated_at = now()
   WHERE business_profile_id = p_business_profile_id;

  RETURN jsonb_build_object('success', true, 'message', 'PIN verified.');
END;
$$;

REVOKE ALL ON FUNCTION public.verify_pitchin_business_wallet_pin(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_pitchin_business_wallet_pin(uuid, text) TO authenticated;
NOTIFY pgrst, 'reload schema';
