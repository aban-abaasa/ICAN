-- ============================================================================
-- CMMS staff -> ICAN account auto-link
-- ============================================================================
-- Run after: CMMS_ATTENDANCE_CHECKOUT_PAY_CONFIRMATION.sql
--
-- BUG: cmms_users.ican_user_id is only ever written by one code path in the
-- whole app -- an admin manually searching ICAN users by email and clicking
-- the dropdown result in CMSSModule.jsx (handleSelectUser -> auth_user_id ->
-- written as ican_user_id on insert/update). Every backend way of creating a
-- cmms_users row (add_cmms_user(), the auto-enrollment in
-- fn_create_cmms_company[_with_departments](), the admin-setup scripts)
-- leaves ican_user_id NULL, and nothing ever revisits or backfills it. There
-- is no trigger, no email-based auto-link, no cross-company propagation --
-- linking is per cmms_users ROW, not per person, so the same email can be
-- linked under one company and NULL under another.
--
-- This silently breaks cmms_checkout_pay_status() (see
-- CMMS_ATTENDANCE_CHECKOUT_PAY_CONFIRMATION.sql), which returns
-- required:false, reason:'not_linked' the instant ican_user_id IS NULL --
-- before it ever looks at pay_frequency or compensation profiles. Check-in
-- and check-out themselves keep working fine either way, because
-- staff_check_out_with_qr resolves staff by email match alone -- so a staff
-- member checks in/out completely normally while never once being asked to
-- confirm pay, for any pay frequency, indefinitely, with nothing in the UI
-- hinting why.
--
-- FIX (three parts):
--   1. One-time backfill: link every existing cmms_users row that's
--      currently NULL to the matching auth.users account by email.
--   2. Going forward, self-heal at write time: a BEFORE INSERT OR UPDATE
--      trigger on cmms_users fills ican_user_id from auth.users by email
--      whenever it's NULL and a match already exists -- covers
--      add_cmms_user(), company auto-enrollment, and any future insert path,
--      without having to touch each of those functions individually.
--   3. Cover the "staff added before they ever had an ICAN account" case: an
--      AFTER INSERT trigger on auth.users links any pending cmms_users rows
--      for that email the moment the person finally signs up. Named
--      distinctly (on_auth_user_created_cmms_staff_link) so it coexists
--      with this app's existing per-app-namespaced signup trigger
--      (on_auth_user_created_ican, see FIX_AUTO_SIGNUP_TRIGGER_NAMESPACE_ICAN.sql)
--      instead of colliding with it -- Postgres fires every trigger on a
--      table independently, so adding this one does not touch that one.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Backfill existing rows
-- ----------------------------------------------------------------------------
UPDATE public.cmms_users cu
SET ican_user_id = au.id
FROM auth.users au
WHERE cu.ican_user_id IS NULL
  AND lower(cu.email) = lower(au.email);

-- ----------------------------------------------------------------------------
-- 2. Auto-link on cmms_users insert/update
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cmms_users_auto_link_ican_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.ican_user_id IS NULL THEN
    SELECT id INTO NEW.ican_user_id
      FROM auth.users
     WHERE lower(email) = lower(NEW.email)
     LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cmms_users_auto_link_ican_user ON public.cmms_users;
CREATE TRIGGER trg_cmms_users_auto_link_ican_user
  BEFORE INSERT OR UPDATE OF email, ican_user_id ON public.cmms_users
  FOR EACH ROW
  EXECUTE FUNCTION public.cmms_users_auto_link_ican_user();

-- ----------------------------------------------------------------------------
-- 3. Back-link pending staff rows when the person finally signs up
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cmms_link_new_signup_to_staff_records()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.cmms_users
     SET ican_user_id = NEW.id
   WHERE ican_user_id IS NULL
     AND lower(email) = lower(NEW.email);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_cmms_staff_link ON auth.users;
CREATE TRIGGER on_auth_user_created_cmms_staff_link
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.cmms_link_new_signup_to_staff_records();

NOTIFY pgrst, 'reload schema';

SELECT 'cmms_users.ican_user_id backfilled and now self-links going forward (on write, and on signup)' AS status;
