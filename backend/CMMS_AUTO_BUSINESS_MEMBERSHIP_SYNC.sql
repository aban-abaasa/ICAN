-- ============================================================
-- CMMS EMPLOYEES → UNIFIED BUSINESS MEMBERSHIP (auto-sync)
-- ============================================================
-- The gap this closes: assigning a CMMS role that grants, say,
-- tool_access.clinical.view only ever controlled what the CMMS UI shows
-- (CMSSModule.jsx's getTabs()/hasToolAction()). Every write RPC behind that
-- UI (cmms_save_consultation_form, cmms_record_consultation_submission, the
-- rest of CMMS_CLINICAL_CONSULTATION_FORMS.sql, and every other specialist
-- module built the same way) is instead gated by
-- public.unified_business_member(), which checks
-- public.business_account_members — a completely separate table that a
-- CMMS role assignment never touched. So an employee could see a tab the
-- admin granted and still get "Business membership required" the moment
-- they tried to actually use it, because they were never registered as a
-- business member at all.
--
-- This adds an automatic sync, triggered the same way
-- cmms_ensure_small_business_authority() already provisions the CMMS
-- creator/managers into business_account_members (same table, same
-- (business_profile_id, auth_user_id) upsert shape) — except here it runs
-- for ANY CMMS employee the moment they have an active role, not just the
-- small-team bootstrap case, and it fires from a trigger so it applies no
-- matter which screen/flow performs the role assignment:
--
--   1. _cmms_sync_business_membership_for_user(cmms_user_id) — the shared
--      worker: resolves the employee's linked business (via
--      cmms_company_profiles.pichin_business_profile_id) and their auth
--      account (by email, matching cmms_ensure_small_business_authority's
--      own lookup), and upserts an active business_account_members row —
--      but only when the employee actually has at least one active CMMS
--      role and a business/auth account are both resolvable; otherwise it
--      quietly does nothing (nothing to sync yet).
--
--   2. A trigger on cmms_user_roles (fires on every INSERT/activation)
--      and one on cmms_users (fires when email/company/active status
--      changes, covering "account got linked after the role was already
--      assigned") both call it.
--
--   3. A one-time backfill runs the same sync for every CMMS employee who
--      already has an active role today, so existing "granted the role but
--      still blocked" employees are fixed by running this file, with no
--      need to re-save their role assignment.
--
-- Deliberately one-directional: revoking a CMMS role does NOT deactivate
-- business_account_members here. That table is shared platform-wide
-- (Pichin, wallet, payroll...), so silently downgrading it as a side
-- effect of a CMMS-only change is the wrong default. Offboarding a member
-- entirely stays a deliberate action in existing business-member
-- management, not an automatic one.
--
-- Run after: SHARED_BUSINESS_AUTHORITY_AND_PAYROLL.sql,
-- UNIFIED_BUSINESS_MANAGEMENT_AND_SUPPLIER_MARKETPLACE.sql.
-- Safe to run more than once.
-- ============================================================

CREATE OR REPLACE FUNCTION public._cmms_sync_business_membership_for_user(p_cmms_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE
  v_user public.cmms_users;
  v_business_id UUID;
  v_auth_id UUID;
  v_has_active_role BOOLEAN;
BEGIN
  SELECT * INTO v_user FROM public.cmms_users WHERE id = p_cmms_user_id;
  IF v_user.id IS NULL OR v_user.email IS NULL OR trim(v_user.email) = '' THEN RETURN; END IF;

  SELECT pichin_business_profile_id INTO v_business_id
  FROM public.cmms_company_profiles WHERE id = v_user.cmms_company_id;
  IF v_business_id IS NULL THEN RETURN; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.cmms_user_roles
    WHERE cmms_user_id = p_cmms_user_id AND is_active = true
  ) INTO v_has_active_role;
  IF NOT v_has_active_role THEN RETURN; END IF;

  SELECT id INTO v_auth_id FROM auth.users WHERE lower(email) = lower(v_user.email) LIMIT 1;
  IF v_auth_id IS NULL THEN RETURN; END IF;

  INSERT INTO public.business_account_members (
    business_profile_id, auth_user_id, employment_status, job_title, department, permissions, invited_by, joined_at
  ) VALUES (
    v_business_id, v_auth_id, 'active', v_user.job_title, v_user.department, '{}'::jsonb, v_user.added_by, now()
  )
  ON CONFLICT (business_profile_id, auth_user_id) DO UPDATE
    SET employment_status = 'active', updated_at = now()
    WHERE public.business_account_members.employment_status IS NULL
       OR public.business_account_members.employment_status = 'pending';
END; $$;

REVOKE ALL ON FUNCTION public._cmms_sync_business_membership_for_user(UUID) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public._cmms_user_roles_sync_membership()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public._cmms_sync_business_membership_for_user(NEW.cmms_user_id);
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_cmms_user_roles_sync_membership ON public.cmms_user_roles;
CREATE TRIGGER trg_cmms_user_roles_sync_membership
AFTER INSERT OR UPDATE OF is_active ON public.cmms_user_roles
FOR EACH ROW
WHEN (NEW.is_active = true)
EXECUTE FUNCTION public._cmms_user_roles_sync_membership();

CREATE OR REPLACE FUNCTION public._cmms_users_sync_membership()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public._cmms_sync_business_membership_for_user(NEW.id);
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_cmms_users_sync_membership ON public.cmms_users;
CREATE TRIGGER trg_cmms_users_sync_membership
AFTER INSERT OR UPDATE OF email, cmms_company_id, is_active ON public.cmms_users
FOR EACH ROW
WHEN (NEW.is_active = true)
EXECUTE FUNCTION public._cmms_users_sync_membership();

-- One-time backfill for employees who already hold an active role today.
DO $$
DECLARE
  v_row RECORD;
BEGIN
  FOR v_row IN SELECT DISTINCT cmms_user_id FROM public.cmms_user_roles WHERE is_active = true LOOP
    PERFORM public._cmms_sync_business_membership_for_user(v_row.cmms_user_id);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

SELECT 'CMMS employee -> business membership auto-sync installed.' AS status;
