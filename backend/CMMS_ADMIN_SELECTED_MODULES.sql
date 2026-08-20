-- ============================================================================
-- CMMS administrator-selected modules
-- ============================================================================
-- Run after UNIFIED_BUSINESS_MANAGEMENT_AND_SUPPLIER_MARKETPLACE.sql.
--
-- This intentionally turns off every currently configured business module.
-- Each business administrator must then enable only the CMMS features that
-- apply to that business from CMMS > Configure modules.

UPDATE public.business_profile_modules
SET enabled = FALSE,
    updated_at = now()
WHERE enabled = TRUE;

-- Make every CMMS tab selectable by an administrator without activating it.
-- Existing rows are preserved and remain disabled by the update above.
INSERT INTO public.business_profile_modules (business_profile_id, module_key, enabled)
SELECT bp.id, module_key, FALSE
FROM public.business_profiles bp
CROSS JOIN unnest(ARRAY[
  'company', 'departments', 'users', 'inventory', 'attendance', 'visitor-mgmt',
  'payroll', 'fees', 'production', 'quality', 'clinical', 'pharmacy',
  'transport', 'requisitions', 'approvals', 'reports', 'tasks'
]) AS module_key
ON CONFLICT (business_profile_id, module_key) DO NOTHING;

NOTIFY pgrst, 'reload schema';
