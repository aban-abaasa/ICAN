-- =====================================================
-- Private, PIN-locked, time-limited pitch invites
-- =====================================================
-- Lets a business owner hand-craft a pitch for ONE named investor, gated
-- behind a PIN and an expiry, instead of posting to the public PitchIn feed
-- or the public business board. The real content (title/description/video/
-- personal message) lives ONLY in pitch_private_invites, which has no
-- anon/authenticated SELECT policy at all -- the only way in is the PIN-
-- gated RPC below. Investing still goes through the exact same live
-- valuation + ShareSigningFlow engine as the public flow: investment_
-- agreements.pitch_id is NOT NULL REFERENCES pitches(id)
-- (INVESTOR_SHARE_SIGNING_TABLES.sql), so a real (but content-empty)
-- pitches row is created lazily -- only if/when this specific investor
-- actually clicks Invest -- via fn_materialize_private_pitch_for_investment.
--
-- Reuses, rather than reinvents:
--  - public.ican_business_operation_access(business_profile_id) for the
--    owner/co-owner check (UNIFIED_BUSINESS_WALLET_OPERATIONS.sql).
--  - extensions.crypt()/gen_salt('bf') for PIN hashing, the same mechanism
--    already used for wallet PINs (PITCHIN_BUSINESS_WALLET_CMMS_FINANCE_
--    APPROVAL.sql:273 -- extensions.crypt(p_pin, pin_hash) = pin_hash).
--  - the pitches.visibility column, already defined (04_business_profiles_
--    blockchain.sql:192) with 'investor_only' as one of its documented
--    intended values, just never populated by any existing code path.
-- =====================================================

CREATE TABLE IF NOT EXISTS public.pitch_private_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_profile_id UUID NOT NULL REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES auth.users(id),

  -- The two secrets: `token` is the URL-bearing one (same unguessable-uuid-
  -- style trust model every other shared PitchIn link already relies on),
  -- `pin_hash` is the second factor that link alone doesn't satisfy.
  token TEXT NOT NULL UNIQUE,
  pin_hash TEXT NOT NULL,

  -- Personalization -- shown only after the PIN is verified.
  investor_name TEXT,
  investor_contact TEXT,
  custom_message TEXT,

  -- The actual pitch content for this invite. Independent of the public
  -- `pitches` table on purpose -- a business can prefill these from one of
  -- their own published pitches client-side, but nothing here is ever read
  -- by the public feed/board.
  title TEXT NOT NULL DEFAULT 'A private investment opportunity',
  description TEXT,
  video_url TEXT,
  thumbnail_url TEXT,
  pitch_type TEXT,
  category TEXT,

  expires_at TIMESTAMPTZ NOT NULL,

  -- Brute-force lockout -- essential, not decorative, given a 4-digit PIN
  -- only has 10,000 possibilities.
  max_attempts INT NOT NULL DEFAULT 5,
  failed_attempts INT NOT NULL DEFAULT 0,
  locked_at TIMESTAMPTZ,

  -- Manual kill switch, independent of expiry.
  revoked_at TIMESTAMPTZ,

  -- "Has my investor even opened this?" -- surfaced in the Manage view.
  viewed_count INT NOT NULL DEFAULT 0,
  first_viewed_at TIMESTAMPTZ,

  -- Set lazily by fn_materialize_private_pitch_for_investment, only if/when
  -- this investor actually invests. NULL for the life of most invites.
  materialized_pitch_id UUID REFERENCES public.pitches(id),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pitch_private_invites_business
  ON public.pitch_private_invites(business_profile_id);

ALTER TABLE public.pitch_private_invites ENABLE ROW LEVEL SECURITY;

-- Owner/co-owner can list + revoke their own invites. No INSERT policy --
-- creation only happens through fn_create_private_pitch_invite, which hashes
-- the PIN server-side; a direct client insert would have nowhere safe to
-- put a plaintext PIN. No anon/authenticated SELECT policy either -- the
-- investor never queries this table directly, only through
-- fn_open_private_pitch_invite.
DROP POLICY IF EXISTS "pitch_private_invites_owner_select" ON public.pitch_private_invites;
CREATE POLICY "pitch_private_invites_owner_select" ON public.pitch_private_invites
  FOR SELECT USING (public.ican_business_operation_access(business_profile_id));

DROP POLICY IF EXISTS "pitch_private_invites_owner_update" ON public.pitch_private_invites;
CREATE POLICY "pitch_private_invites_owner_update" ON public.pitch_private_invites
  FOR UPDATE USING (public.ican_business_operation_access(business_profile_id));

REVOKE ALL ON public.pitch_private_invites FROM anon;
GRANT SELECT, UPDATE ON public.pitch_private_invites TO authenticated;

-- =====================================================
-- fn_create_private_pitch_invite
-- =====================================================
DROP FUNCTION IF EXISTS public.fn_create_private_pitch_invite(UUID, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.fn_create_private_pitch_invite(
  p_business_profile_id UUID,
  p_pin TEXT,
  p_expires_at TIMESTAMPTZ,
  p_investor_name TEXT DEFAULT NULL,
  p_investor_contact TEXT DEFAULT NULL,
  p_custom_message TEXT DEFAULT NULL,
  p_title TEXT DEFAULT NULL,
  p_description TEXT DEFAULT NULL,
  p_video_url TEXT DEFAULT NULL,
  p_thumbnail_url TEXT DEFAULT NULL,
  p_pitch_type TEXT DEFAULT NULL,
  p_category TEXT DEFAULT NULL
)
RETURNS TABLE(id UUID, token TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_id UUID;
  v_token TEXT;
BEGIN
  IF NOT public.ican_business_operation_access(p_business_profile_id) THEN
    RAISE EXCEPTION 'Business operation access required';
  END IF;
  IF p_pin IS NULL OR p_pin !~ '^[0-9]{4,8}$' THEN
    RAISE EXCEPTION 'PIN must be 4-8 digits';
  END IF;
  IF p_expires_at IS NULL OR p_expires_at <= now() THEN
    RAISE EXCEPTION 'Expiry must be in the future';
  END IF;

  v_token := encode(gen_random_bytes(16), 'hex');

  INSERT INTO public.pitch_private_invites (
    business_profile_id, created_by, token, pin_hash, investor_name,
    investor_contact, custom_message, title, description, video_url,
    thumbnail_url, pitch_type, category, expires_at
  ) VALUES (
    p_business_profile_id, auth.uid(), v_token, crypt(p_pin, gen_salt('bf')),
    p_investor_name, p_investor_contact, p_custom_message,
    COALESCE(p_title, 'A private investment opportunity'), p_description,
    p_video_url, p_thumbnail_url, p_pitch_type, p_category, p_expires_at
  )
  RETURNING pitch_private_invites.id INTO v_id;

  RETURN QUERY SELECT v_id, v_token;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_create_private_pitch_invite(UUID, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_create_private_pitch_invite(UUID, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- =====================================================
-- fn_open_private_pitch_invite -- the only public door into this table.
-- Status checks happen BEFORE the PIN comparison so a stale/dead link never
-- needs a correct PIN to explain itself, and a wrong PIN never reveals
-- anything about the invite's content.
-- =====================================================
DROP FUNCTION IF EXISTS public.fn_open_private_pitch_invite(TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.fn_open_private_pitch_invite(p_token TEXT, p_pin TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_row public.pitch_private_invites;
BEGIN
  SELECT * INTO v_row FROM public.pitch_private_invites WHERE token = p_token;

  IF v_row.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'not_found');
  END IF;
  IF v_row.revoked_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'revoked');
  END IF;
  IF v_row.expires_at <= now() THEN
    RETURN jsonb_build_object('success', false, 'reason', 'expired');
  END IF;
  IF v_row.locked_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'locked');
  END IF;

  IF p_pin IS NULL OR crypt(p_pin, v_row.pin_hash) <> v_row.pin_hash THEN
    UPDATE public.pitch_private_invites
      SET failed_attempts = failed_attempts + 1,
          locked_at = CASE WHEN failed_attempts + 1 >= max_attempts THEN now() ELSE locked_at END
      WHERE id = v_row.id;
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'wrong_pin',
      'attempts_left', GREATEST(0, v_row.max_attempts - v_row.failed_attempts - 1)
    );
  END IF;

  UPDATE public.pitch_private_invites
    SET failed_attempts = 0,
        viewed_count = viewed_count + 1,
        first_viewed_at = COALESCE(first_viewed_at, now())
    WHERE id = v_row.id;

  RETURN jsonb_build_object(
    'success', true,
    'invite_id', v_row.id,
    'business_profile_id', v_row.business_profile_id,
    'investor_name', v_row.investor_name,
    'custom_message', v_row.custom_message,
    'title', v_row.title,
    'description', v_row.description,
    'video_url', v_row.video_url,
    'thumbnail_url', v_row.thumbnail_url,
    'pitch_type', v_row.pitch_type,
    'category', v_row.category,
    'expires_at', v_row.expires_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_open_private_pitch_invite(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_open_private_pitch_invite(TEXT, TEXT) TO anon, authenticated;

-- =====================================================
-- fn_check_private_pitch_invite_status -- a zero-PIN-attempt status probe,
-- so a dead link can say "expired"/"revoked" immediately instead of making
-- the visitor try a PIN first just to find that out.
-- =====================================================
DROP FUNCTION IF EXISTS public.fn_check_private_pitch_invite_status(TEXT);
CREATE OR REPLACE FUNCTION public.fn_check_private_pitch_invite_status(p_token TEXT)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
STABLE
AS $$
  SELECT CASE
    WHEN v.id IS NULL THEN jsonb_build_object('status', 'not_found')
    WHEN v.revoked_at IS NOT NULL THEN jsonb_build_object('status', 'revoked')
    WHEN v.expires_at <= now() THEN jsonb_build_object('status', 'expired', 'expires_at', v.expires_at)
    WHEN v.locked_at IS NOT NULL THEN jsonb_build_object('status', 'locked')
    ELSE jsonb_build_object('status', 'active', 'expires_at', v.expires_at, 'investor_name', v.investor_name)
  END
  FROM (SELECT * FROM public.pitch_private_invites WHERE token = p_token) v;
$$;

REVOKE ALL ON FUNCTION public.fn_check_private_pitch_invite_status(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_check_private_pitch_invite_status(TEXT) TO anon, authenticated;

-- =====================================================
-- fn_materialize_private_pitch_for_investment -- called once, lazily, the
-- moment an unlocked (PIN-verified) investor actually clicks Invest.
-- Deliberately omits video_url/thumbnail_url on the created pitches row --
-- even a guessed pitch id (practically infeasible: a full random uuid)
-- would show no video, matching the row's role as a bookkeeping anchor for
-- investment_agreements.pitch_id, not a second copy of the private content.
-- =====================================================
DROP FUNCTION IF EXISTS public.fn_materialize_private_pitch_for_investment(UUID);
CREATE OR REPLACE FUNCTION public.fn_materialize_private_pitch_for_investment(p_invite_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_row public.pitch_private_invites;
  v_pitch_id UUID;
BEGIN
  SELECT * INTO v_row FROM public.pitch_private_invites WHERE id = p_invite_id;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'This invitation was not found';
  END IF;
  IF v_row.revoked_at IS NOT NULL OR v_row.expires_at <= now() OR v_row.locked_at IS NOT NULL THEN
    RAISE EXCEPTION 'This invitation is no longer available';
  END IF;

  IF v_row.materialized_pitch_id IS NOT NULL THEN
    RETURN v_row.materialized_pitch_id;
  END IF;

  INSERT INTO public.pitches (
    business_profile_id, title, description, category, pitch_type, status, visibility
  ) VALUES (
    v_row.business_profile_id, v_row.title, v_row.description, v_row.category,
    v_row.pitch_type, 'private_invite', 'investor_only'
  )
  RETURNING id INTO v_pitch_id;

  UPDATE public.pitch_private_invites SET materialized_pitch_id = v_pitch_id WHERE id = v_row.id;

  RETURN v_pitch_id;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_materialize_private_pitch_for_investment(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_materialize_private_pitch_for_investment(UUID) TO authenticated;

-- =====================================================
-- VERIFICATION
-- =====================================================
SELECT 'pitch_private_invites RLS' AS check, rowsecurity AS enabled
FROM pg_tables WHERE schemaname = 'public' AND tablename = 'pitch_private_invites';

SELECT 'functions created' AS check, proname
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND proname IN (
    'fn_create_private_pitch_invite',
    'fn_open_private_pitch_invite',
    'fn_check_private_pitch_invite_status',
    'fn_materialize_private_pitch_for_investment'
  );
