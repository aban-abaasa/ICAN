-- ============================================================
-- CMMS Notice Board — "About" + Products/Services (Dropship link)
-- ============================================================
-- Turns a company's public notice board (/notices/<companyId>, see
-- PublicCompanyNoticeBoard.jsx and CMMS_ANNOUNCEMENTS_AND_JOBS.sql) into a
-- full free mini-website for the business: a real "what we do" description,
-- and — when the company links its existing ICANera Dropship storefront —
-- its products/services right there on the board.
--
-- Design:
--   - `about`: a public-facing description column on cmms_company_profiles,
--     editable the same way company_name/industry already are (existing
--     "allow_update_company_profile" RLS policy, admin-only).
--   - `business_profile_id`: an optional link from a CMMS company to one of
--     ICANera's `business_profiles` (the entity Dropship storefronts,
--     wallets, etc. hang off). These are deliberately separate tables (CMMS
--     predates the unified business system) with no existing relationship,
--     so this is a new, nullable, admin-set link — not a merge.
--   - Browsing the linked storefront is public (get_dropship_storefront is
--     already anon-safe); paying for it requires an ICANera account and
--     goes through the *existing* dropship_checkout() wallet-to-wallet
--     transfer untouched — this file adds no new money-movement logic.
--   - Setting the link goes through fn_set_cmms_company_business_profile()
--     rather than a plain column UPDATE, because it must additionally
--     verify the caller actually owns/manages the target business_profile
--     (otherwise a CMMS admin could put a stranger's storefront — real
--     stock, real payouts — on their own public board without consent).
--
-- Run after: CMMS_ANNOUNCEMENTS_AND_JOBS.sql, CMMS_CREATOR_AND_RLS_SETUP.sql
-- (for cmms_is_company_admin), DROPSHIP_RESELLER_SYSTEM.sql (for
-- business_profiles / business_member_roles / get_dropship_storefront).
-- Safe to run more than once.
-- ============================================================

-- ============================================================
-- 1. New columns on cmms_company_profiles
-- ============================================================
ALTER TABLE public.cmms_company_profiles
  ADD COLUMN IF NOT EXISTS about TEXT,
  ADD COLUMN IF NOT EXISTS business_profile_id UUID REFERENCES public.business_profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_cmms_company_business_profile ON public.cmms_company_profiles(business_profile_id);

-- One-time convenience backfill: if this company's creator owns exactly one
-- business profile, link it automatically so existing companies don't start
-- with an empty Products tab. Ambiguous (0 or 2+ matches) is left NULL for
-- an admin to set explicitly via fn_set_cmms_company_business_profile.
UPDATE public.cmms_company_profiles cp
SET business_profile_id = matched.business_profile_id
FROM (
  SELECT bp.user_id, MIN(bp.id) AS business_profile_id
  FROM public.business_profiles bp
  GROUP BY bp.user_id
  HAVING COUNT(*) = 1
) AS matched
WHERE cp.business_profile_id IS NULL
  AND cp.created_by = matched.user_id;

-- ============================================================
-- 2. fn_set_cmms_company_business_profile — the only sanctioned way to
-- link/unlink a storefront. Requires the caller to have "edit" on this
-- company's announcements tool (same permission that already governs the
-- public board's content, see CMMS_ANNOUNCEMENTS_AND_JOBS.sql) AND to
-- actually own or actively manage the target business_profile.
-- Pass p_business_profile_id = NULL to unlink.
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_set_cmms_company_business_profile(
  p_company_id UUID,
  p_business_profile_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owns_business BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in is required';
  END IF;

  IF NOT public.cmms_has_tool_action(p_company_id, 'announcements', 'edit') THEN
    RAISE EXCEPTION 'You do not have permission to manage this company''s storefront link';
  END IF;

  IF p_business_profile_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.business_profiles bp
      WHERE bp.id = p_business_profile_id AND bp.user_id = auth.uid()
      UNION ALL
      SELECT 1 FROM public.business_member_roles bmr
      WHERE bmr.business_profile_id = p_business_profile_id
        AND bmr.auth_user_id = auth.uid()
        AND bmr.status = 'active'
    ) INTO v_owns_business;

    IF NOT v_owns_business THEN
      RAISE EXCEPTION 'You can only link a business storefront you own or manage';
    END IF;
  END IF;

  UPDATE public.cmms_company_profiles
  SET business_profile_id = p_business_profile_id, updated_at = NOW()
  WHERE id = p_company_id;

  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_set_cmms_company_business_profile(UUID, UUID) TO authenticated;

COMMENT ON FUNCTION public.fn_set_cmms_company_business_profile(UUID, UUID)
  IS 'Links (or, with NULL, unlinks) a CMMS company''s public notice board to one of the caller''s own ICANera business_profiles, so its Dropship storefront appears on the board.';

-- ============================================================
-- 3. Public header RPC now also returns about/phone/website/
-- business_profile_id, so the board can render a real "About" section and
-- know whether to fetch a Products & Services tab.
-- ============================================================
DROP FUNCTION IF EXISTS public.fn_get_public_cmms_company_header(UUID);
CREATE OR REPLACE FUNCTION public.fn_get_public_cmms_company_header(p_company_id UUID)
RETURNS TABLE (
  id UUID,
  company_name VARCHAR,
  industry VARCHAR,
  location VARCHAR,
  website VARCHAR,
  phone VARCHAR,
  about TEXT,
  logo_url TEXT,
  business_profile_id UUID
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT cp.id, cp.company_name, cp.industry, cp.location, cp.website, cp.phone, cp.about, cp.logo_url, cp.business_profile_id
  FROM public.cmms_company_profiles cp
  WHERE cp.id = p_company_id;
$$;

GRANT EXECUTE ON FUNCTION public.fn_get_public_cmms_company_header(UUID) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

SELECT 'CMMS notice board about + products/services (Dropship link) installed' AS status;
