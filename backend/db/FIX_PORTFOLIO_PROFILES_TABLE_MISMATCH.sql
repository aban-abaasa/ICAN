-- Fixes "JSON object requested, multiple (or no) rows returned" on the
-- My Resume / Portfolio tab's Save button (and the whole portfolio/ratings/
-- verification/professionals-directory feature set).
--
-- Root cause: CREATE_USER_PORTFOLIO_SCHEMA.sql and
-- CREATE_PORTFOLIO_RATINGS_VERIFICATION.sql were built against
-- public.ican_user_profiles, but the rest of the app (AuthContext.jsx,
-- login/signup) reads and auto-creates rows in public.profiles instead.
-- ican_user_profiles never gets a row for real users, so any
-- .eq('id', userId) against it (e.g. the handle UPDATE) matches zero rows,
-- and PostgREST's .single() throws PGRST116 ("JSON object requested,
-- multiple (or no) rows returned").
--
-- This migration repoints the portfolio feature at public.profiles, the
-- table that's actually populated. It does NOT drop ican_user_profiles —
-- other code (pitchingService.js) still reads it as a legacy fallback.
--
-- Run this AFTER CREATE_USER_PORTFOLIO_SCHEMA.sql and
-- CREATE_PORTFOLIO_RATINGS_VERIFICATION.sql have already been applied.
-- Idempotent: safe to run more than once.

-- ── 1. Move the public handle onto profiles ─────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS handle VARCHAR(60) UNIQUE;

-- Backfill any handle already set on the (unused) legacy table.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ican_user_profiles') THEN
    UPDATE public.profiles p
    SET handle = i.handle
    FROM public.ican_user_profiles i
    WHERE p.id = i.id AND i.handle IS NOT NULL AND p.handle IS NULL;
  END IF;
END $$;

-- Public read of handle/name/avatar/verification for the /portfolio/<handle>
-- page and the professionals directory (profiles' base RLS is own-row-only).
DROP POLICY IF EXISTS "profiles_public_handle_read" ON public.profiles;
CREATE POLICY "profiles_public_handle_read" ON public.profiles
  FOR SELECT TO anon, authenticated
  USING (handle IS NOT NULL);

-- ── 2. Repoint foreign keys at profiles(id) ─────────────────────────────
ALTER TABLE public.user_portfolios
  DROP CONSTRAINT IF EXISTS user_portfolios_user_id_fkey,
  ADD CONSTRAINT user_portfolios_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE public.user_portfolio_items
  DROP CONSTRAINT IF EXISTS user_portfolio_items_user_id_fkey,
  ADD CONSTRAINT user_portfolio_items_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE public.portfolio_ratings
  DROP CONSTRAINT IF EXISTS portfolio_ratings_ratee_user_id_fkey,
  ADD CONSTRAINT portfolio_ratings_ratee_user_id_fkey
    FOREIGN KEY (ratee_user_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  DROP CONSTRAINT IF EXISTS portfolio_ratings_rater_user_id_fkey,
  ADD CONSTRAINT portfolio_ratings_rater_user_id_fkey
    FOREIGN KEY (rater_user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE public.document_verifications
  DROP CONSTRAINT IF EXISTS document_verifications_user_id_fkey,
  ADD CONSTRAINT document_verifications_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  DROP CONSTRAINT IF EXISTS document_verifications_reviewed_by_fkey,
  ADD CONSTRAINT document_verifications_reviewed_by_fkey
    FOREIGN KEY (reviewed_by) REFERENCES public.profiles(id);

-- ── 3. Repoint functions ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.can_review_user(target_user_id UUID)
RETURNS BOOLEAN
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  caller_email TEXT;
  is_platform_admin BOOLEAN;
  is_firm_admin BOOLEAN;
BEGIN
  SELECT email INTO caller_email FROM auth.users WHERE id = auth.uid();
  IF caller_email IS NULL THEN
    RETURN false;
  END IF;

  SELECT EXISTS(SELECT 1 FROM public.platform_admins WHERE email = caller_email)
    INTO is_platform_admin;
  IF is_platform_admin THEN
    RETURN true;
  END IF;

  SELECT EXISTS(
    SELECT 1
    FROM public.cmms_users target_cu
    JOIN public.cmms_users admin_cu
      ON admin_cu.cmms_company_id = target_cu.cmms_company_id
    JOIN public.profiles target_profile
      ON target_profile.id = target_user_id
    WHERE target_cu.email = target_profile.email
      AND target_cu.is_active = true
      AND admin_cu.email = caller_email
      AND admin_cu.is_active = true
      AND (admin_cu.is_creator = true OR admin_cu.role ILIKE 'admin')
  ) INTO is_firm_admin;

  RETURN COALESCE(is_firm_admin, false);
END;
$$;

CREATE OR REPLACE FUNCTION public.verify_user_document(
  p_document_id UUID,
  p_approve BOOLEAN,
  p_notes TEXT DEFAULT NULL
)
RETURNS public.document_verifications
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  target_user UUID;
  caller_email TEXT;
  is_platform BOOLEAN;
  result public.document_verifications;
BEGIN
  SELECT user_id INTO target_user FROM public.document_verifications WHERE id = p_document_id;
  IF target_user IS NULL THEN
    RAISE EXCEPTION 'Document not found';
  END IF;

  IF NOT public.can_review_user(target_user) THEN
    RAISE EXCEPTION 'Not authorized to review this document';
  END IF;

  SELECT email INTO caller_email FROM auth.users WHERE id = auth.uid();
  SELECT EXISTS(SELECT 1 FROM public.platform_admins WHERE email = caller_email) INTO is_platform;

  UPDATE public.document_verifications
  SET status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
      review_method = CASE WHEN is_platform THEN 'platform' ELSE 'firm' END,
      reviewed_by = auth.uid(),
      reviewed_at = NOW(),
      notes = p_notes
  WHERE id = p_document_id
  RETURNING * INTO result;

  UPDATE public.profiles
  SET is_verified = p_approve
  WHERE id = target_user;

  RETURN result;
END;
$$;

-- ── 4. Repoint the public professionals directory view ──────────────────
CREATE OR REPLACE VIEW public.public_professionals AS
SELECT
  p.id AS user_id,
  p.handle,
  p.full_name,
  p.avatar_url,
  p.is_verified,
  up.headline,
  up.summary,
  up.skills,
  COALESCE(rs.avg_rating, 0) AS avg_rating,
  COALESCE(rs.ratings_count, 0) AS ratings_count
FROM public.profiles p
JOIN public.user_portfolios up ON up.user_id = p.id
LEFT JOIN public.portfolio_rating_summary rs ON rs.user_id = p.id
WHERE p.handle IS NOT NULL
  AND up.is_public = true;

GRANT SELECT ON public.public_professionals TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

SELECT 'Portfolio feature repointed from ican_user_profiles to profiles' AS status;
