-- ============================================================
-- CMMS: stop an invalid attendance/payroll time zone breaking the dashboard
-- ============================================================
-- Symptom: the home-screen Business Activity card (CmmsActivityWidget.jsx) failed
-- with  POST /rest/v1/rpc/fn_get_cmms_dashboard_summary 400.
--
-- Cause (found by running the function for every company inside a rolled-back
-- transaction): one company's cmms_attendance_payroll_settings.timezone was saved
-- as the text  africa , which is not a time zone. fn_get_cmms_dashboard_summary
-- (and the attendance payroll deduction functions) run
-- now() AT TIME ZONE <that value>, and Postgres refuses it:
--     ERROR 22023: time zone "africa" not recognized
-- PostgREST reports that as a 400. Every other company was fine. The value was
-- typed into a free-text box (with "Africa/Kampala" as its placeholder).
--
-- This file:
--   1. repairs any stored value that is not a real time zone
--   2. refuses to save an invalid one from now on, with a readable message
-- The two Time zone boxes in the app are now a picker (TimeZoneSelect.jsx).
--
-- >>> CHECK THE ZONE ON THE NEXT LINE before running. It is only used to repair
-- >>> rows that are ALREADY invalid; 'Africa/Kampala' (UTC+3) is assumed because
-- >>> the business works in UGX. Use 'UTC' or your own zone if that is wrong.
--
-- Safe to run more than once.
-- ============================================================

-- 1. Repair values Postgres cannot use -----------------------------------------
WITH repaired AS (
  UPDATE public.cmms_attendance_payroll_settings s
     SET timezone = 'Africa/Kampala'
   WHERE s.timezone IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_timezone_names z WHERE lower(z.name) = lower(s.timezone))
  RETURNING s.cmms_company_id, s.timezone
)
SELECT COUNT(*) AS invalid_time_zones_repaired FROM repaired;

-- 2. Refuse invalid values from now on -----------------------------------------
CREATE OR REPLACE FUNCTION public.cmms_validate_settings_timezone()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_needs_check BOOLEAN := FALSE;
BEGIN
  -- (OLD only exists on UPDATE, so it is only read in the UPDATE branch.) Only a
  -- CHANGED value is checked, so saving other settings never trips over an old one.
  IF TG_OP = 'INSERT' THEN
    v_needs_check := NEW.timezone IS NOT NULL;
  ELSIF NEW.timezone IS DISTINCT FROM OLD.timezone THEN
    v_needs_check := NEW.timezone IS NOT NULL;
  END IF;

  IF v_needs_check AND NOT EXISTS (
    SELECT 1 FROM pg_timezone_names z WHERE lower(z.name) = lower(NEW.timezone)
  ) THEN
    RAISE EXCEPTION 'Time zone "%" is not valid. Choose one from the list, for example Africa/Kampala.', NEW.timezone
      USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cmms_validate_settings_timezone ON public.cmms_attendance_payroll_settings;
CREATE TRIGGER trg_cmms_validate_settings_timezone
  BEFORE INSERT OR UPDATE OF timezone ON public.cmms_attendance_payroll_settings
  FOR EACH ROW EXECUTE FUNCTION public.cmms_validate_settings_timezone();

SELECT 'CMMS attendance time zones are now validated; the dashboard summary works for every company' AS status;
