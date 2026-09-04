-- My Resume / Portfolio — ratings & recommendations, document verification,
-- and the public "Professionals" directory. Builds on
-- CREATE_USER_PORTFOLIO_SCHEMA.sql (run that one first).
--
-- Verification is two-track, per product decision: a "firm" track where an
-- admin/creator of a CMMS company can confirm a document for one of their own
-- team members, and a "platform" track where the IcanEra team confirms it
-- directly (see platform_admins below — there is no third-party ID-verification
-- vendor wired up here; seed platform_admins with your team's emails to use
-- this track). Both tracks go through the same verify_user_document() RPC so
-- there is one auditable place authorization happens, matching how
-- cmms_bootstrap_creator/handle_ican_new_user already do privileged writes
-- via SECURITY DEFINER functions in this codebase.
--
-- Idempotent: safe to run more than once.

-- ══════════════════════════════════════════════════════════════════════════
-- RATINGS & RECOMMENDATIONS
-- ══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.portfolio_ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ratee_user_id UUID NOT NULL REFERENCES public.ican_user_profiles(id) ON DELETE CASCADE,
  rater_user_id UUID NOT NULL REFERENCES public.ican_user_profiles(id) ON DELETE CASCADE,
  rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  recommendation_text TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT portfolio_ratings_no_self_rating CHECK (ratee_user_id <> rater_user_id),
  CONSTRAINT portfolio_ratings_one_per_rater UNIQUE (ratee_user_id, rater_user_id)
);

CREATE INDEX IF NOT EXISTS idx_portfolio_ratings_ratee ON public.portfolio_ratings(ratee_user_id);

CREATE OR REPLACE FUNCTION public.update_portfolio_ratings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_portfolio_ratings_updated_at ON public.portfolio_ratings;
CREATE TRIGGER trigger_update_portfolio_ratings_updated_at
  BEFORE UPDATE ON public.portfolio_ratings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_portfolio_ratings_updated_at();

ALTER TABLE public.portfolio_ratings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "portfolio_ratings_public_read" ON public.portfolio_ratings;
CREATE POLICY "portfolio_ratings_public_read" ON public.portfolio_ratings
  FOR SELECT TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "portfolio_ratings_rater_write" ON public.portfolio_ratings;
CREATE POLICY "portfolio_ratings_rater_write" ON public.portfolio_ratings
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = rater_user_id);

DROP POLICY IF EXISTS "portfolio_ratings_rater_update" ON public.portfolio_ratings;
CREATE POLICY "portfolio_ratings_rater_update" ON public.portfolio_ratings
  FOR UPDATE TO authenticated
  USING (auth.uid() = rater_user_id)
  WITH CHECK (auth.uid() = rater_user_id);

DROP POLICY IF EXISTS "portfolio_ratings_rater_delete" ON public.portfolio_ratings;
CREATE POLICY "portfolio_ratings_rater_delete" ON public.portfolio_ratings
  FOR DELETE TO authenticated
  USING (auth.uid() = rater_user_id);

-- Aggregate view — average + count per professional, public-readable since
-- it's derived entirely from already-public rating rows.
CREATE OR REPLACE VIEW public.portfolio_rating_summary AS
SELECT
  ratee_user_id AS user_id,
  ROUND(AVG(rating)::numeric, 2) AS avg_rating,
  COUNT(*) AS ratings_count
FROM public.portfolio_ratings
GROUP BY ratee_user_id;

GRANT SELECT ON public.portfolio_rating_summary TO anon, authenticated;

-- ══════════════════════════════════════════════════════════════════════════
-- DOCUMENT VERIFICATION
-- ══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.platform_admins (
  email VARCHAR(255) PRIMARY KEY,
  added_at TIMESTAMPTZ DEFAULT NOW()
);
-- Seed your IcanEra team's review accounts, e.g.:
--   INSERT INTO public.platform_admins (email) VALUES ('you@icanera.app') ON CONFLICT DO NOTHING;

ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;
-- No public policies: only readable/writable via SECURITY DEFINER functions below.

CREATE TABLE IF NOT EXISTS public.document_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.ican_user_profiles(id) ON DELETE CASCADE,
  document_url TEXT NOT NULL,
  document_type VARCHAR(50) NOT NULL DEFAULT 'id_document',
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  review_method VARCHAR(20) CHECK (review_method IN ('firm', 'platform')),
  reviewed_by UUID REFERENCES public.ican_user_profiles(id),
  reviewed_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_document_verifications_user_id ON public.document_verifications(user_id);
CREATE INDEX IF NOT EXISTS idx_document_verifications_status ON public.document_verifications(status);

ALTER TABLE public.document_verifications ENABLE ROW LEVEL SECURITY;

-- can_review_user()/verify_user_document() are defined before the RLS
-- policies below because CREATE POLICY validates its USING/WITH CHECK
-- expression at creation time — the function must already exist, unlike a
-- plpgsql function body which is only checked when it's called.

-- Returns true if the calling user may review target_user_id's documents:
-- either as an admin/creator of a CMMS company the target is an active
-- member of ("firm" track), or as a seeded platform_admins email
-- ("platform" track). SECURITY DEFINER so it can read across
-- cmms_users/cmms_user_roles/platform_admins regardless of the caller's own
-- row-level access to those tables.
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
    JOIN public.ican_user_profiles target_profile
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

-- Approves/rejects a pending document. Runs as SECURITY DEFINER so it can
-- update document_verifications.status (no user-facing UPDATE policy exists)
-- and flip ican_user_profiles.is_verified, but only after re-checking
-- can_review_user() itself — the privilege escalation is entirely contained
-- to this one function.
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

  UPDATE public.ican_user_profiles
  SET is_verified = p_approve
  WHERE id = target_user;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.can_review_user(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_user_document(UUID, BOOLEAN, TEXT) TO authenticated;

DROP POLICY IF EXISTS "document_verifications_owner_read" ON public.document_verifications;
CREATE POLICY "document_verifications_owner_read" ON public.document_verifications
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.can_review_user(user_id));

DROP POLICY IF EXISTS "document_verifications_owner_insert" ON public.document_verifications;
CREATE POLICY "document_verifications_owner_insert" ON public.document_verifications
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
-- No UPDATE policy for regular users — status changes only via verify_user_document() above.

-- Private storage bucket for uploaded ID/certificate documents.
INSERT INTO storage.buckets (id, name, public)
VALUES ('verification-documents', 'verification-documents', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "verification_documents_owner_rw" ON storage.objects;
CREATE POLICY "verification_documents_owner_rw" ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'verification-documents' AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id = 'verification-documents' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "verification_documents_reviewer_read" ON storage.objects;
CREATE POLICY "verification_documents_reviewer_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'verification-documents' AND public.can_review_user((storage.foldername(name))[1]::uuid));

-- ══════════════════════════════════════════════════════════════════════════
-- PUBLIC PROFESSIONALS DIRECTORY
-- ══════════════════════════════════════════════════════════════════════════

-- Backs the dashboard "Professionals" tab and the landing-page carousel.
-- Only surfaces users who opted in (handle set + portfolio is_public).
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
FROM public.ican_user_profiles p
JOIN public.user_portfolios up ON up.user_id = p.id
LEFT JOIN public.portfolio_rating_summary rs ON rs.user_id = p.id
WHERE p.handle IS NOT NULL
  AND up.is_public = true;

GRANT SELECT ON public.public_professionals TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

SELECT 'Ratings, document verification, and the public professionals directory are set up' AS status;
