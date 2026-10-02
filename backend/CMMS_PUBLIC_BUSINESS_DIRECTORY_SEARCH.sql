-- ============================================================
-- Landing page: search ANY business on IcanEra by name and open its website
-- ============================================================
-- Every CMMS company already has a free public website at /notices/<companyId>
-- (PublicCompanyNoticeBoard.jsx). Until now the only way to reach one from the
-- landing page was to spot one of its notices/jobs in the shelf. This adds a
-- directory search: type (part of) a business name -- or its industry, town,
-- tagline -- and get the matching businesses with their IcanEra website link.
--
-- Matching (every word the visitor typed must match somewhere):
--   * name starts with the text          -> best
--   * a word in the name starts with it  -> next
--   * name contains it (spaces/punctuation ignored, so "bodago" finds
--     "Boda-Go Era")                      -> next
--   * industry / location / tagline      -> lowest
-- Businesses with open jobs/notices are lifted within the same score, so the
-- active ones are found first. An empty search returns the active businesses.
--
-- Only fields the public board header already exposes to anon visitors are
-- returned, plus counts of published public posts. A business is listed only if
-- it has a name and something public to show (about, tagline, website, or a
-- published public post), so empty auto-created shells don't appear.
--
-- Run after: CMMS_ANNOUNCEMENTS_AND_JOBS.sql, CMMS_PUBLIC_BOARD_WEBSITE_FALLBACK.sql.
-- Safe to run more than once.
-- ============================================================

DROP FUNCTION IF EXISTS public.fn_search_public_cmms_businesses(TEXT, INTEGER, INTEGER);
CREATE OR REPLACE FUNCTION public.fn_search_public_cmms_businesses(
  p_query TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 12,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  id UUID,
  company_name VARCHAR,
  industry VARCHAR,
  location VARCHAR,
  tagline VARCHAR,
  website VARCHAR,
  logo_url TEXT,
  cover_image_url TEXT,
  open_jobs BIGINT,
  notices BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH q AS (
    SELECT
      lower(btrim(COALESCE(p_query, ''))) AS raw,
      regexp_replace(lower(COALESCE(p_query, '')), '[^a-z0-9]+', '', 'g') AS squashed,
      -- search words, capped so a pasted paragraph can't make a huge scan
      (SELECT COALESCE(array_agg(w), ARRAY[]::text[])
         FROM (SELECT w FROM unnest(regexp_split_to_array(lower(btrim(COALESCE(p_query, ''))), '\s+')) AS w
               WHERE w <> '' LIMIT 6) t) AS words
  ),
  posts AS (
    SELECT
      a.cmms_company_id,
      COUNT(*) FILTER (WHERE a.post_type = 'job') AS open_jobs,
      COUNT(*) FILTER (WHERE a.post_type <> 'job') AS notices
    FROM public.cmms_announcements a
    WHERE a.visibility = 'public'
      AND a.status = 'published'
      AND (a.expires_at IS NULL OR a.expires_at > NOW())
    GROUP BY a.cmms_company_id
  ),
  base AS (
    SELECT
      cp.id,
      cp.company_name,
      cp.industry,
      COALESCE(cp.location, bp.business_address)::VARCHAR AS location,
      cp.tagline,
      COALESCE(cp.website, bp.website)::VARCHAR AS website,
      COALESCE(cp.logo_url, bp.avatar_url) AS logo_url,
      cp.cover_image_url,
      COALESCE(p.open_jobs, 0) AS open_jobs,
      COALESCE(p.notices, 0) AS notices,
      lower(cp.company_name) AS lname,
      regexp_replace(lower(cp.company_name), '[^a-z0-9]+', '', 'g') AS sname,
      lower(concat_ws(' ', cp.industry, COALESCE(cp.location, bp.business_address), cp.tagline)) AS extra
    FROM public.cmms_company_profiles cp
    LEFT JOIN public.business_profiles bp ON bp.id = cp.business_profile_id
    LEFT JOIN posts p ON p.cmms_company_id = cp.id
    WHERE NULLIF(btrim(cp.company_name), '') IS NOT NULL
      AND (
        COALESCE(p.open_jobs, 0) + COALESCE(p.notices, 0) > 0
        OR NULLIF(btrim(cp.about), '') IS NOT NULL
        OR NULLIF(btrim(cp.tagline), '') IS NOT NULL
        OR NULLIF(btrim(COALESCE(cp.website, bp.website)), '') IS NOT NULL
      )
  ),
  scored AS (
    SELECT
      b.*,
      CASE
        WHEN q.raw = '' THEN 0
        WHEN b.lname = q.raw THEN 100
        WHEN b.lname LIKE q.raw || '%' THEN 90
        WHEN b.lname LIKE '% ' || q.raw || '%' THEN 80
        WHEN q.squashed <> '' AND b.sname LIKE '%' || q.squashed || '%' THEN 70
        WHEN b.lname LIKE '%' || q.raw || '%' THEN 60
        ELSE 30
      END AS score
    FROM base b
    CROSS JOIN q
    WHERE q.raw = ''
       OR (
         -- every typed word must hit the name or the industry/location/tagline
         (SELECT bool_and(
                   b.lname LIKE '%' || replace(replace(w, '%', ''), '_', '') || '%'
                   OR b.extra LIKE '%' || replace(replace(w, '%', ''), '_', '') || '%'
                 )
            FROM unnest(q.words) AS w)
         OR (q.squashed <> '' AND b.sname LIKE '%' || q.squashed || '%')
       )
  )
  SELECT
    s.id, s.company_name, s.industry, s.location, s.tagline, s.website,
    s.logo_url, s.cover_image_url, s.open_jobs, s.notices
  FROM scored s
  ORDER BY s.score DESC, (s.open_jobs + s.notices) DESC, s.company_name ASC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 12), 1), 50)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$$;

REVOKE ALL ON FUNCTION public.fn_search_public_cmms_businesses(TEXT, INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_search_public_cmms_businesses(TEXT, INTEGER, INTEGER) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

SELECT 'fn_search_public_cmms_businesses created (landing business directory search)' AS status;
