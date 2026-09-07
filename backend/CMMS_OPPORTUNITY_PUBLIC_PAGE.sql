-- ============================================================
-- CMMS Business Opportunities -- public page + poster/document attachments.
-- ============================================================
-- Jobs and announcements (CMMS_ANNOUNCEMENTS_AND_JOBS.sql) already have a
-- no-login public board at /notices/<companyId> (PublicCompanyNoticeBoard.jsx),
-- with a poster image and a PDF document attachable from the posting form
-- (CMMSAnnouncementsPanel.jsx). Business opportunities
-- (CMMS_BUSINESS_OPPORTUNITIES_AND_BIDS.sql) had neither: browsing an open
-- opportunity required an ICAN account (RLS was `TO authenticated`), and the
-- posting form had no poster/document fields at all.
--
-- This file brings opportunities up to the same posture as jobs, in the same
-- two ways:
--  1. poster_url/poster_path/document_url/document_path columns on
--     cmms_business_opportunities, filled in from the same "Post
--     Opportunity" form's new upload fields (CMMSBusinessOpportunitiesPanel.jsx).
--  2. Two SECURITY DEFINER read functions, granted to anon, mirroring
--     fn_get_public_cmms_notices/fn_get_public_cmms_notice exactly -- the
--     underlying table's RLS is untouched (still `TO authenticated` only,
--     per that file's explicit "every participant already has an ICAN
--     account" design for bids), so this adds a public *read* path without
--     reopening the table itself to anon.
--
-- Bidding itself stays exactly as it was: a visitor who wants to bid must
-- sign in first (same as browsing the rest of ICAN), then bids through the
-- existing authenticated insert policy (cmms_biz_bids_insert) -- there is no
-- anonymous-bid path here, unlike job applications. Only browsing is public.
--
-- Run after: CMMS_BUSINESS_OPPORTUNITIES_AND_BIDS.sql,
-- CMMS_ANNOUNCEMENTS_AND_JOBS.sql (fn_get_public_cmms_company_header already
-- covers the header; this file only adds the opportunities list/detail).
-- Safe to run more than once.
-- ============================================================

-- ============================================================
-- 1. Poster image + PDF document, same shape as cmms_announcements
-- ============================================================

ALTER TABLE public.cmms_business_opportunities
  ADD COLUMN IF NOT EXISTS poster_url TEXT,
  ADD COLUMN IF NOT EXISTS poster_path TEXT,
  ADD COLUMN IF NOT EXISTS document_url TEXT,
  ADD COLUMN IF NOT EXISTS document_path TEXT;

-- ============================================================
-- 2. Public list -- this company's open opportunities, newest first
-- ============================================================

DROP FUNCTION IF EXISTS public.fn_get_public_cmms_opportunities(UUID);
CREATE OR REPLACE FUNCTION public.fn_get_public_cmms_opportunities(p_company_id UUID)
RETURNS TABLE (
  id UUID,
  title VARCHAR,
  description TEXT,
  budget_hint VARCHAR,
  deadline TIMESTAMPTZ,
  poster_url TEXT,
  document_url TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT o.id, o.title, o.description, o.budget_hint, o.deadline, o.poster_url, o.document_url, o.created_at
  FROM public.cmms_business_opportunities o
  WHERE o.cmms_company_id = p_company_id
    AND o.status = 'open'
    AND (o.deadline IS NULL OR o.deadline > NOW())
  ORDER BY o.created_at DESC;
$$;

-- ============================================================
-- 3. Public detail -- single opportunity, with the company name so the
-- opportunity detail view can stand alone (e.g. opened straight from a
-- shared link, same as fn_get_public_cmms_notice for a shared job/notice).
-- ============================================================

DROP FUNCTION IF EXISTS public.fn_get_public_cmms_opportunity(UUID);
CREATE OR REPLACE FUNCTION public.fn_get_public_cmms_opportunity(p_opportunity_id UUID)
RETURNS TABLE (
  id UUID,
  cmms_company_id UUID,
  company_name VARCHAR,
  title VARCHAR,
  description TEXT,
  budget_hint VARCHAR,
  deadline TIMESTAMPTZ,
  poster_url TEXT,
  document_url TEXT,
  created_at TIMESTAMPTZ,
  is_open BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    o.id, o.cmms_company_id, cp.company_name, o.title, o.description, o.budget_hint,
    o.deadline, o.poster_url, o.document_url, o.created_at,
    (o.status = 'open' AND (o.deadline IS NULL OR o.deadline > NOW())) AS is_open
  FROM public.cmms_business_opportunities o
  JOIN public.cmms_company_profiles cp ON cp.id = o.cmms_company_id
  WHERE o.id = p_opportunity_id;
$$;

GRANT EXECUTE ON FUNCTION public.fn_get_public_cmms_opportunities(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_get_public_cmms_opportunity(UUID) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

SELECT 'CMMS business opportunities public page (poster/document + public browse) installed' AS status;
