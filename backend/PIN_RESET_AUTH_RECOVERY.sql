-- Reset a wallet PIN through a Supabase Auth recovery session.
-- The email link is issued by supabase.auth.resetPasswordForEmail(), so the
-- caller must have a valid authenticated recovery session. Keep the update
-- scoped to the selected personal/business wallet account.

CREATE OR REPLACE FUNCTION public.reset_wallet_pin_from_recovery(
  p_account_type text,
  p_new_pin_hash text
)
RETURNS TABLE (success boolean, message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RETURN QUERY SELECT false, 'Sign in through the password recovery link and try again.'::text;
    RETURN;
  END IF;

  IF p_account_type NOT IN ('personal', 'business') THEN
    RETURN QUERY SELECT false, 'Invalid account type.'::text;
    RETURN;
  END IF;

  IF p_new_pin_hash IS NULL OR p_new_pin_hash = '' THEN
    RETURN QUERY SELECT false, 'New PIN is required.'::text;
    RETURN;
  END IF;

  UPDATE public.user_accounts
  SET pin_hash = p_new_pin_hash,
      pin_attempts = 0,
      pin_locked_until = NULL,
      failed_pin_attempts = 0,
      updated_at = now()
  WHERE user_id = v_user_id
    AND account_type = p_account_type;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, ('No ' || p_account_type || ' account found for this user.')::text;
    RETURN;
  END IF;

  RETURN QUERY SELECT true, 'PIN reset successfully.'::text;
END;
$$;

REVOKE ALL ON FUNCTION public.reset_wallet_pin_from_recovery(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reset_wallet_pin_from_recovery(text, text) TO authenticated;
