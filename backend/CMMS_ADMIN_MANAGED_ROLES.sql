-- Company-admin-managed CMMS roles and tool access.
-- Run after the existing CMMS role schema.
ALTER TABLE public.cmms_roles
  ADD COLUMN IF NOT EXISTS cmms_company_id UUID REFERENCES public.cmms_company_profiles(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS tool_access JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS is_system_role BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS created_by UUID;

ALTER TABLE public.cmms_roles DROP CONSTRAINT IF EXISTS cmms_roles_role_name_key;
CREATE UNIQUE INDEX IF NOT EXISTS cmms_roles_company_name_key
  ON public.cmms_roles (COALESCE(cmms_company_id, '00000000-0000-0000-0000-000000000000'::uuid), role_name);

CREATE INDEX IF NOT EXISTS cmms_roles_company_active_idx ON public.cmms_roles(cmms_company_id, is_active);

ALTER TABLE public.cmms_roles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cmms_roles_company_select ON public.cmms_roles;
CREATE POLICY cmms_roles_company_select ON public.cmms_roles FOR SELECT USING (
  cmms_company_id IS NULL OR EXISTS (
    SELECT 1 FROM public.cmms_users u
    WHERE u.cmms_company_id = cmms_roles.cmms_company_id
      AND lower(u.email) = lower((SELECT email FROM auth.users WHERE id = auth.uid()))
      AND u.is_active = TRUE
  )
);
DROP POLICY IF EXISTS cmms_roles_admin_manage ON public.cmms_roles;
CREATE POLICY cmms_roles_admin_manage ON public.cmms_roles FOR ALL USING (
  cmms_company_id IS NOT NULL AND public.cmms_is_company_admin(cmms_company_id)
) WITH CHECK (
  cmms_company_id IS NOT NULL AND public.cmms_is_company_admin(cmms_company_id)
);

COMMENT ON COLUMN public.cmms_roles.tool_access IS 'Company-admin-controlled CMMS navigation/tool access map';

-- Repair creator metadata used by company-scoped admin checks. This keeps an
-- owner/admin in control of every CMMS company they actually created, while
-- not promoting ordinary guest memberships in companies they do not own.
UPDATE public.cmms_company_profiles cp
SET created_by_user_id = cp.created_by
WHERE cp.created_by_user_id IS NULL
  AND EXISTS (
    SELECT 1 FROM public.cmms_users u
    WHERE u.id = cp.created_by AND u.cmms_company_id = cp.id
  );

UPDATE public.cmms_company_profiles cp
SET created_by_user_id = u.id
FROM public.cmms_users u
WHERE cp.created_by_user_id IS NULL
  AND cp.owner_email IS NOT NULL
  AND lower(cp.owner_email) = lower(u.email)
  AND u.cmms_company_id = cp.id;

INSERT INTO public.cmms_company_creators (cmms_company_id, creator_user_id, creator_email)
SELECT cp.id, cp.created_by_user_id, u.email
FROM public.cmms_company_profiles cp
JOIN public.cmms_users u ON u.id = cp.created_by_user_id
WHERE cp.created_by_user_id IS NOT NULL
ON CONFLICT (cmms_company_id) DO UPDATE
SET creator_user_id = EXCLUDED.creator_user_id,
    creator_email = EXCLUDED.creator_email;

-- The old roster is no longer used as the company permission model. Keep the
-- administrator role for the owner/safety boundary and deactivate the legacy
-- operational roles so each company can replace them with its own definitions.
UPDATE public.cmms_roles
SET is_active = FALSE
WHERE cmms_company_id IS NULL
  AND lower(role_name) IN ('coordinator', 'supervisor', 'technician', 'storeman', 'finance', 'service-provider', 'manager');

-- Remove existing assignments to the retired built-in roles as well. Users
-- remain company members but show as unassigned until an administrator gives
-- them a company-created role.
UPDATE public.cmms_user_roles ur
SET is_active = FALSE
FROM public.cmms_roles r
WHERE r.id = ur.cmms_role_id
  AND lower(r.role_name) IN ('coordinator', 'supervisor', 'technician', 'storeman', 'finance', 'service-provider', 'manager');

-- Company-created roles are active by default and remain available when a
-- member switches between their CMMS companies. This does not reactivate the
-- retired global role roster above.
UPDATE public.cmms_roles
SET is_active = TRUE
WHERE cmms_company_id IS NOT NULL
  AND is_system_role = FALSE;

UPDATE public.cmms_user_roles ur
SET is_active = TRUE
FROM public.cmms_roles r
WHERE r.id = ur.cmms_role_id
  AND r.cmms_company_id IS NOT NULL
  AND r.is_active = TRUE;
