CREATE OR REPLACE FUNCTION public._cmms_caller_email()
RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT lower(NULLIF(auth.jwt()->>'email', ''));
$$;
CREATE OR REPLACE FUNCTION public._cmms_member_user_id(p_company_id UUID)
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.id
  FROM public.cmms_users u
  WHERE u.cmms_company_id = p_company_id
    AND u.is_active = TRUE
    AND public._cmms_caller_email() IS NOT NULL
    AND lower(u.email) = public._cmms_caller_email()
  LIMIT 1;
$$;
CREATE OR REPLACE FUNCTION public._cmms_is_company_admin(p_company_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.cmms_users u
    WHERE u.id = public._cmms_member_user_id(p_company_id)
      AND (
        u.is_creator = TRUE
        OR lower(COALESCE(u.role, '')) = 'admin'
        OR EXISTS (
          SELECT 1
          FROM public.cmms_user_roles ur
          JOIN public.cmms_roles r ON r.id = ur.cmms_role_id
          WHERE ur.cmms_user_id = u.id AND ur.is_active
            AND lower(r.role_name) = 'admin'
        )
      )
  );
$$;
CREATE OR REPLACE FUNCTION public._cmms_can_manage_inventory(p_company_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public._cmms_is_company_admin(p_company_id)
      OR EXISTS (
        SELECT 1
        FROM public.cmms_users u
        WHERE u.id = public._cmms_member_user_id(p_company_id)
          AND (
            lower(COALESCE(u.role, '')) = 'storeman'
            OR EXISTS (
              SELECT 1
              FROM public.cmms_user_roles ur
              JOIN public.cmms_roles r ON r.id = ur.cmms_role_id
              WHERE ur.cmms_user_id = u.id AND ur.is_active
                AND (lower(r.role_name) = 'storeman' OR r.can_edit_inventory = TRUE)
            )
          )
      );
$$;
CREATE TABLE IF NOT EXISTS public.cmms_business_groups (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(255) NOT NULL,
  base_currency VARCHAR(3)   NOT NULL DEFAULT 'UGX',
  created_by    UUID,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
ALTER TABLE public.cmms_company_profiles ADD COLUMN IF NOT EXISTS group_id        UUID REFERENCES public.cmms_business_groups(id) ON DELETE SET NULL;
ALTER TABLE public.cmms_company_profiles ADD COLUMN IF NOT EXISTS branch_name     VARCHAR(255);
ALTER TABLE public.cmms_company_profiles ADD COLUMN IF NOT EXISTS branch_code     VARCHAR(30);
ALTER TABLE public.cmms_company_profiles ADD COLUMN IF NOT EXISTS is_headquarters BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.cmms_company_profiles ADD COLUMN IF NOT EXISTS country         VARCHAR(100);
ALTER TABLE public.cmms_company_profiles ADD COLUMN IF NOT EXISTS currency        VARCHAR(3) NOT NULL DEFAULT 'UGX';
