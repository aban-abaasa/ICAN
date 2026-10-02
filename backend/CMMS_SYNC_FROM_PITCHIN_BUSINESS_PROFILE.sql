-- ============================================================
-- Editing the business profile in Pitchin now updates what CMMS shows
-- ============================================================
-- The CMMS public board header (fn_get_public_cmms_company_header) uses
-- cmms_company_profiles.<field> FIRST and only falls back to the Pitchin
-- business_profiles row when the CMMS field is empty. So once a CMMS admin
-- (or the first Pitchin sync) had filled in logo/website/about/location,
-- later edits in Pitchin's "Edit business profile" form never reached CMMS.
--
-- Fix: an AFTER UPDATE trigger on business_profiles that pushes the changed
-- fields into the linked CMMS company (explicit business_profile_id link, or
-- the same business-name match the header already uses):
--   avatar_url       -> logo_url (logo_path cleared, it no longer matches)
--   business_address -> location
--   website          -> website
--   description      -> about
-- Only fields that actually changed are pushed, so a CMMS-only value for an
-- untouched field is left alone. Business name is NOT pushed (the name match
-- above depends on it; rename is a deliberate CMMS action).
--
-- Safe to run more than once.
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_sync_business_profile_to_cmms()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.avatar_url       IS NOT DISTINCT FROM OLD.avatar_url
     AND NEW.business_address IS NOT DISTINCT FROM OLD.business_address
     AND NEW.website          IS NOT DISTINCT FROM OLD.website
     AND NEW.description      IS NOT DISTINCT FROM OLD.description THEN
    RETURN NEW;
  END IF;

  UPDATE public.cmms_company_profiles cp SET
    logo_url = CASE WHEN NEW.avatar_url IS DISTINCT FROM OLD.avatar_url THEN NEW.avatar_url ELSE cp.logo_url END,
    logo_path = CASE WHEN NEW.avatar_url IS DISTINCT FROM OLD.avatar_url THEN NULL ELSE cp.logo_path END,
    location = CASE WHEN NEW.business_address IS DISTINCT FROM OLD.business_address THEN NEW.business_address ELSE cp.location END,
    website = CASE WHEN NEW.website IS DISTINCT FROM OLD.website THEN NEW.website ELSE cp.website END,
    about = CASE WHEN NEW.description IS DISTINCT FROM OLD.description THEN NEW.description ELSE cp.about END
  WHERE cp.business_profile_id = NEW.id
     OR (cp.business_profile_id IS NULL
         AND LOWER(TRIM(cp.company_name)) = LOWER(TRIM(OLD.business_name)));

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_business_profile_to_cmms ON public.business_profiles;
CREATE TRIGGER trg_sync_business_profile_to_cmms
  AFTER UPDATE ON public.business_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_sync_business_profile_to_cmms();

SELECT 'Pitchin business-profile edits now sync to the linked CMMS company' AS status;
