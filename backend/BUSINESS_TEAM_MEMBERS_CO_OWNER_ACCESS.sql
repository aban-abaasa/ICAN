-- =====================================================
-- LET MANAGEMENT CO-OWNERS ASSIGN ENTRY HELPERS
-- =====================================================
-- BUSINESS_TEAM_MEMBERS_SETUP.sql lets only the business OWNER add, update, remove
-- and list business_team_members (the people who record transactions on the
-- company's behalf). A co-owner in a management role (Founder, Co-Founder, CEO,
-- CFO, CTO, Partner, Owner/Co-owner, Administrator) could not assign anyone, even
-- though they can already record entries and read the ledger themselves.
--
-- This adds four ADDITIVE policies next to the owner ones (Postgres ORs permissive
-- policies together, so owners are unaffected). Passive holders — Investor,
-- Shareholder, Guarantor — are not included: what a helper records is permanent
-- and moves the share value.
--
-- Keep the role list in step with frontend/src/utils/businessAccess.js (which only
-- decides whether the app shows the control; this function is what enforces it).
--
-- Safe to run more than once. Contains no DROP statements.
-- Rollback (run by hand if ever needed):
--   DROP POLICY "Co-owner admins can view team members"   ON public.business_team_members;
--   DROP POLICY "Co-owner admins can add team members"    ON public.business_team_members;
--   DROP POLICY "Co-owner admins can update team members" ON public.business_team_members;
--   DROP POLICY "Co-owner admins can remove team members" ON public.business_team_members;
--   DROP FUNCTION public.fn_can_manage_business_helpers(UUID);
-- =====================================================

-- SECURITY DEFINER so the check can read business_co_owners without being blocked by
-- (or recursing into) that table's own row-level security.
CREATE OR REPLACE FUNCTION public.fn_can_manage_business_helpers(p_business_profile_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.business_profiles bp
    WHERE bp.id = p_business_profile_id AND bp.user_id = auth.uid()
  ) OR EXISTS (
    SELECT 1 FROM public.business_co_owners co
    WHERE co.business_profile_id = p_business_profile_id
      AND (
        co.user_id = auth.uid()
        OR (
          co.owner_email IS NOT NULL
          AND lower(co.owner_email) = lower(COALESCE(auth.jwt() ->> 'email', ''))
        )
      )
      -- "Co-Founder", "co founder" and "cofounder" are the same role.
      AND lower(regexp_replace(COALESCE(co.role, ''), '[^a-zA-Z]', '', 'g')) IN
          ('owner', 'coowner', 'founder', 'cofounder', 'ceo', 'cfo', 'cto', 'partner', 'administrator')
  );
$$;

GRANT EXECUTE ON FUNCTION public.fn_can_manage_business_helpers(UUID) TO authenticated;

DO $$
BEGIN
  IF to_regclass('public.business_team_members') IS NULL THEN
    RAISE NOTICE 'business_team_members does not exist yet - run BUSINESS_TEAM_MEMBERS_SETUP.sql first.';
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                 AND tablename = 'business_team_members'
                 AND policyname = 'Co-owner admins can view team members') THEN
    CREATE POLICY "Co-owner admins can view team members"
    ON public.business_team_members FOR SELECT
    USING (public.fn_can_manage_business_helpers(business_profile_id));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                 AND tablename = 'business_team_members'
                 AND policyname = 'Co-owner admins can add team members') THEN
    CREATE POLICY "Co-owner admins can add team members"
    ON public.business_team_members FOR INSERT
    WITH CHECK (public.fn_can_manage_business_helpers(business_profile_id));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                 AND tablename = 'business_team_members'
                 AND policyname = 'Co-owner admins can update team members') THEN
    CREATE POLICY "Co-owner admins can update team members"
    ON public.business_team_members FOR UPDATE
    USING (public.fn_can_manage_business_helpers(business_profile_id))
    WITH CHECK (public.fn_can_manage_business_helpers(business_profile_id));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                 AND tablename = 'business_team_members'
                 AND policyname = 'Co-owner admins can remove team members') THEN
    CREATE POLICY "Co-owner admins can remove team members"
    ON public.business_team_members FOR DELETE
    USING (public.fn_can_manage_business_helpers(business_profile_id));
  END IF;
END
$$;
