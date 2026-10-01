-- Reset an iCanEra business-wallet PIN through a Supabase Auth recovery session.
-- The business-wallet PIN lives in ican_business_wallet_settings.pin_hash (bcrypt),
-- keyed by business_profile_id — NOT in user_accounts. Same authority rule as
-- set_pitchin_business_wallet_pin: only the highest-ownership shareholder.

CREATE OR REPLACE FUNCTION public.reset_business_wallet_pin_from_recovery(
  p_business_profile_id uuid,
  p_new_pin text
)
RETURNS TABLE (success boolean, message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN QUERY SELECT false, 'Sign in through the PIN recovery link and try again.'::text; RETURN;
  END IF;
  IF p_business_profile_id IS NULL THEN
    RETURN QUERY SELECT false, 'Choose which business to reset.'::text; RETURN;
  END IF;
  IF NOT public.pitchin_business_wallet_operator(p_business_profile_id) THEN
    RETURN QUERY SELECT false, 'Only the highest-ownership shareholder can reset this business wallet PIN.'::text; RETURN;
  END IF;
  IF p_new_pin IS NULL OR p_new_pin !~ '^[0-9]{4,6}$' THEN
    RETURN QUERY SELECT false, 'PIN must be 4-6 digits.'::text; RETURN;
  END IF;

  PERFORM public.get_or_create_pitchin_business_wallet(p_business_profile_id);

  UPDATE public.ican_business_wallet_settings
     SET pin_hash = extensions.crypt(p_new_pin, extensions.gen_salt('bf')),
         pin_failed_attempts = 0,
         pin_locked_until = NULL,
         pin_set_at = now(),
         updated_by = auth.uid(),
         updated_at = now()
   WHERE business_profile_id = p_business_profile_id;

  RETURN QUERY SELECT true, 'Business wallet PIN reset successfully.'::text;
END;
$$;

REVOKE ALL ON FUNCTION public.reset_business_wallet_pin_from_recovery(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reset_business_wallet_pin_from_recovery(uuid, text) TO authenticated;
NOTIFY pgrst, 'reload schema';
