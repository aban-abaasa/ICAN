-- =====================================================
-- Private pitch invites -- support an imported/branded .pptx deck alongside
-- (or instead of) a video
-- =====================================================
-- PITCHIN_PRIVATE_INVESTOR_INVITES.sql's pitch_private_invites only ever
-- carried video_url/thumbnail_url as the pitch's real content. Now that a
-- pitch can be published from a video, an imported deck, or both
-- (CMMS_PITCH_PUBLICITY_TAB.sql), a private investor invite needs to be able
-- to carry a deck_url too -- so a business that shared a deck instead of a
-- video can still send it privately to one named investor, PIN-locked and
-- time-limited, exactly the way a video pitch already can.
--
-- Purely additive: every existing caller of fn_create_private_pitch_invite/
-- fn_open_private_pitch_invite keeps working (the two new params default to
-- NULL), it just gets one more optional field in and out.
--
-- Run after: PITCHIN_PRIVATE_INVESTOR_INVITES.sql, CMMS_PITCH_PUBLICITY_TAB.sql.
-- Safe to run more than once.
-- =====================================================

ALTER TABLE public.pitch_private_invites
  ADD COLUMN IF NOT EXISTS deck_url TEXT,
  ADD COLUMN IF NOT EXISTS deck_path TEXT;

-- =====================================================
-- fn_create_private_pitch_invite -- now also accepts a deck
-- =====================================================
DROP FUNCTION IF EXISTS public.fn_create_private_pitch_invite(UUID, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.fn_create_private_pitch_invite(UUID, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT);
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
  p_category TEXT DEFAULT NULL,
  p_deck_url TEXT DEFAULT NULL,
  p_deck_path TEXT DEFAULT NULL
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
    thumbnail_url, pitch_type, category, deck_url, deck_path, expires_at
  ) VALUES (
    p_business_profile_id, auth.uid(), v_token, crypt(p_pin, gen_salt('bf')),
    p_investor_name, p_investor_contact, p_custom_message,
    COALESCE(p_title, 'A private investment opportunity'), p_description,
    p_video_url, p_thumbnail_url, p_pitch_type, p_category,
    p_deck_url, p_deck_path, p_expires_at
  )
  RETURNING pitch_private_invites.id INTO v_id;

  RETURN QUERY SELECT v_id, v_token;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_create_private_pitch_invite(UUID, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_create_private_pitch_invite(UUID, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- =====================================================
-- fn_open_private_pitch_invite -- now also returns the deck, if any
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
    'deck_url', v_row.deck_url,
    'expires_at', v_row.expires_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_open_private_pitch_invite(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_open_private_pitch_invite(TEXT, TEXT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

SELECT 'Private pitch invites now support an imported/branded deck alongside or instead of a video' AS status;
