-- Run this after PITCHIN_BUSINESS_PROFILE_ICAN_WALLET.sql if the PIN RPC
-- returns HTTP 404 because the original migration was rolled back.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.ican_business_wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_profile_id UUID NOT NULL UNIQUE REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  wallet_address TEXT NOT NULL UNIQUE DEFAULT 'BIZ-' || upper(substr(md5(gen_random_uuid()::text), 1, 16)),
  ican_balance NUMERIC(18,8) NOT NULL DEFAULT 0 CHECK (ican_balance >= 0),
  total_earned NUMERIC(18,8) NOT NULL DEFAULT 0,
  total_spent NUMERIC(18,8) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'frozen')),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ican_business_wallet_settings (
  business_profile_id UUID PRIMARY KEY REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  large_transaction_threshold_ican NUMERIC(18,8) NOT NULL DEFAULT 1000,
  approval_percentage NUMERIC(5,2) NOT NULL DEFAULT 60,
  pin_hash TEXT,
  pin_failed_attempts INTEGER NOT NULL DEFAULT 0,
  pin_locked_until TIMESTAMPTZ,
  pin_set_at TIMESTAMPTZ,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.ican_business_wallet_settings
  ADD COLUMN IF NOT EXISTS pin_hash TEXT,
  ADD COLUMN IF NOT EXISTS pin_failed_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pin_locked_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pin_set_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.ican_business_wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_profile_id UUID NOT NULL UNIQUE REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  wallet_address TEXT NOT NULL UNIQUE DEFAULT 'BIZ-' || upper(substr(md5(gen_random_uuid()::text), 1, 16)),
  ican_balance NUMERIC(18,8) NOT NULL DEFAULT 0 CHECK (ican_balance >= 0),
  total_earned NUMERIC(18,8) NOT NULL DEFAULT 0,
  total_spent NUMERIC(18,8) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'frozen')),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ican_business_wallet_settings (
  business_profile_id UUID PRIMARY KEY REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  large_transaction_threshold_ican NUMERIC(18,8) NOT NULL DEFAULT 1000,
  approval_percentage NUMERIC(5,2) NOT NULL DEFAULT 60,
  pin_hash TEXT,
  pin_failed_attempts INTEGER NOT NULL DEFAULT 0,
  pin_locked_until TIMESTAMPTZ,
  pin_set_at TIMESTAMPTZ,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.pitchin_business_shareholder_access(p_business_profile_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.business_profiles bp
             WHERE bp.id = p_business_profile_id AND bp.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.business_co_owners co
             WHERE co.business_profile_id = p_business_profile_id
               AND (co.user_id = auth.uid()
                    OR lower(co.owner_email) = lower(auth.jwt() ->> 'email'))
               AND lower(co.status) IN ('active', 'approved'))
  );
$$;

CREATE OR REPLACE FUNCTION public.pitchin_business_wallet_operator(p_business_profile_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH coowner_totals AS (
    SELECT COALESCE(SUM(ownership_share) FILTER (WHERE lower(status) IN ('active', 'approved')), 0) AS total
      FROM public.business_co_owners
     WHERE business_profile_id = p_business_profile_id
  ), shareholders AS (
    SELECT bp.user_id, NULL::TEXT AS email,
           GREATEST(0, 100 - ct.total)::NUMERIC AS ownership, true AS is_owner
      FROM public.business_profiles bp CROSS JOIN coowner_totals ct
     WHERE bp.id = p_business_profile_id
    UNION ALL
    SELECT co.user_id, co.owner_email, co.ownership_share, false
      FROM public.business_co_owners co
     WHERE co.business_profile_id = p_business_profile_id
       AND lower(co.status) IN ('active', 'approved')
  ), highest_holder AS (
    SELECT * FROM shareholders ORDER BY ownership DESC, is_owner DESC LIMIT 1
  )
  SELECT EXISTS (SELECT 1 FROM highest_holder
                 WHERE user_id = auth.uid()
                    OR lower(email) = lower(auth.jwt() ->> 'email'));
$$;

DROP FUNCTION IF EXISTS public.get_or_create_pitchin_business_wallet(UUID);

CREATE OR REPLACE FUNCTION public.get_or_create_pitchin_business_wallet(p_business_profile_id UUID)
RETURNS public.ican_business_wallets
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_wallet public.ican_business_wallets;
  v_owner UUID;
BEGIN
  IF NOT public.pitchin_business_shareholder_access(p_business_profile_id) THEN
    RAISE EXCEPTION 'You do not have access to this PitchIn business profile';
  END IF;
  SELECT user_id INTO v_owner FROM public.business_profiles WHERE id = p_business_profile_id;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'PitchIn business profile not found'; END IF;

  INSERT INTO public.ican_business_wallets (business_profile_id, created_by)
  VALUES (p_business_profile_id, v_owner)
  ON CONFLICT (business_profile_id) DO NOTHING;
  INSERT INTO public.ican_business_wallet_settings (business_profile_id)
  VALUES (p_business_profile_id)
  ON CONFLICT (business_profile_id) DO NOTHING;

  SELECT * INTO v_wallet FROM public.ican_business_wallets
   WHERE business_profile_id = p_business_profile_id;
  RETURN v_wallet;
END;
$$;

REVOKE ALL ON FUNCTION public.get_or_create_pitchin_business_wallet(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_or_create_pitchin_business_wallet(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.register_pitchin_business_wallet(p_business_profile_id UUID)
RETURNS public.ican_business_wallets
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_wallet public.ican_business_wallets;
BEGIN
  v_wallet := public.get_or_create_pitchin_business_wallet(p_business_profile_id);
  RETURN v_wallet;
END;
$$;

REVOKE ALL ON FUNCTION public.register_pitchin_business_wallet(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_pitchin_business_wallet(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_pitchin_business_wallet_pin(
  p_business_profile_id UUID,
  p_pin TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.pitchin_business_wallet_operator(p_business_profile_id) THEN
    RAISE EXCEPTION 'Only the highest-ownership shareholder may set the business-wallet PIN';
  END IF;

  IF p_pin IS NULL OR p_pin !~ '^[0-9]{4,6}$' THEN
    RAISE EXCEPTION 'Business-wallet PIN must contain 4 to 6 digits';
  END IF;

  PERFORM public.get_or_create_pitchin_business_wallet(p_business_profile_id);

  UPDATE public.ican_business_wallet_settings
     SET pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf')),
         pin_failed_attempts = 0,
         pin_locked_until = NULL,
         pin_set_at = now(),
         updated_by = auth.uid(),
         updated_at = now()
   WHERE business_profile_id = p_business_profile_id;

  RETURN jsonb_build_object('success', true, 'pin_configured', true);
END;
$$;

REVOKE ALL ON FUNCTION public.set_pitchin_business_wallet_pin(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_pitchin_business_wallet_pin(UUID, TEXT) TO authenticated;

-- Refresh PostgREST's RPC schema cache immediately.
NOTIFY pgrst, 'reload schema';

SELECT n.nspname AS schema_name,
       p.proname AS function_name,
       pg_get_function_identity_arguments(p.oid) AS arguments
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('register_pitchin_business_wallet', 'set_pitchin_business_wallet_pin')
 ORDER BY p.proname;
