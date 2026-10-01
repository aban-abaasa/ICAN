-- Reset a wallet PIN through a Supabase Auth recovery session.
-- The email link is issued by supabase.auth.resetPasswordForEmail(), so the
-- caller must have a valid authenticated recovery session. Keep the update
-- scoped to the selected personal/business wallet account.

-- Drop the old 2-arg signature so the new one (with an optional account id)
-- doesn't create an ambiguous overload.
DROP FUNCTION IF EXISTS public.reset_wallet_pin_from_recovery(text, text);

CREATE OR REPLACE FUNCTION public.reset_wallet_pin_from_recovery(
  p_account_type text,
  p_new_pin_hash text,
  p_account_id uuid DEFAULT NULL  -- the specific business wallet to reset
)
RETURNS TABLE (success boolean, message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_owned_count integer;
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

  -- Accounts this user may reset: their own rows, plus business wallets
  -- attached to business profiles they own.
  SELECT count(*) INTO v_owned_count
  FROM public.user_accounts
  WHERE account_type = p_account_type
    AND (
      user_id = v_user_id
      OR (
        p_account_type = 'business'
        AND business_id IN (SELECT bp.id FROM public.business_profiles bp WHERE bp.user_id = v_user_id)
      )
    );

  -- A user can own several businesses; never reset them all by accident.
  IF p_account_type = 'business' AND p_account_id IS NULL AND v_owned_count > 1 THEN
    RETURN QUERY SELECT false, 'You have more than one business account. Choose which business to reset.'::text;
    RETURN;
  END IF;

  UPDATE public.user_accounts
  SET pin_hash = p_new_pin_hash,
      pin_attempts = 0,
      pin_locked_until = NULL,
      failed_pin_attempts = 0,
      updated_at = now()
  WHERE account_type = p_account_type
    AND (p_account_id IS NULL OR id = p_account_id)
    AND (
      user_id = v_user_id
      OR (
        p_account_type = 'business'
        AND business_id IN (SELECT bp.id FROM public.business_profiles bp WHERE bp.user_id = v_user_id)
      )
    );

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, ('No ' || p_account_type || ' account found for this user.')::text;
    RETURN;
  END IF;

  RETURN QUERY SELECT true, 'PIN reset successfully.'::text;
END;
$$;

REVOKE ALL ON FUNCTION public.reset_wallet_pin_from_recovery(text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reset_wallet_pin_from_recovery(text, text, uuid) TO authenticated;
