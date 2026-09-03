-- ============================================================
-- CMMS Announcements & Jobs -- cross-company landing page browse
-- ============================================================
-- Lets the marketing landing page show a live feed of public notices/jobs
-- from EVERY business on ICANEra, not just one company's board -- same
-- "browse anything, no login" posture as get_dropship_browsable_products
-- (DROPSHIP_BROWSE_PRODUCTS.sql), just for CMMS instead of the marketplace.
-- fn_get_public_cmms_notices (CMMS_ANNOUNCEMENTS_AND_JOBS.sql) stays
-- single-company for the per-business notice board; this is the
-- multi-company sibling used only by the landing preview.
--
-- Run after CMMS_ANNOUNCEMENTS_AND_JOBS.sql.
-- Safe to run more than once.
-- ============================================================

DROP FUNCTION IF EXISTS public.fn_browse_public_cmms_notices(TEXT, INTEGER, INTEGER);
CREATE OR REPLACE FUNCTION public.fn_browse_public_cmms_notices(
  p_post_type TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 12,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  id UUID,
  cmms_company_id UUID,
  company_name VARCHAR,
  company_logo_url TEXT,
  post_type VARCHAR,
  title VARCHAR,
  summary VARCHAR,
  poster_url TEXT,
  location VARCHAR,
  employment_type VARCHAR,
  application_deadline DATE,
  published_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    a.id, a.cmms_company_id, cp.company_name, cp.logo_url,
    a.post_type, a.title, a.summary, a.poster_url, a.location,
    a.employment_type, a.application_deadline, a.published_at
  FROM public.cmms_announcements a
  JOIN public.cmms_company_profiles cp ON cp.id = a.cmms_company_id
  WHERE a.visibility = 'public'
    AND a.status = 'published'
    AND (a.expires_at IS NULL OR a.expires_at > NOW())
    AND (p_post_type IS NULL OR a.post_type = p_post_type)
  ORDER BY a.published_at DESC NULLS LAST
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 12), 1), 50)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$$;

GRANT EXECUTE ON FUNCTION public.fn_browse_public_cmms_notices(TEXT, INTEGER, INTEGER) TO anon, authenticated;

SELECT 'fn_browse_public_cmms_notices created' AS status;
