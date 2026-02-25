-- ================================================================
-- FIX: Add department_id to cmms_users_with_roles VIEW
-- ================================================================
-- Problem: View was missing department_id column, causing department 
-- assignments to not persist after page refresh

DROP VIEW IF EXISTS public.cmms_users_with_roles CASCADE;

CREATE VIEW public.cmms_users_with_roles AS
SELECT 
  u.id,
  u.email,
  u.user_name,
  u.full_name,
  u.phone,
  u.department,
  u.department_id,
  u.cmms_company_id,
  u.is_active,
  u.created_at,
  -- Check if this user is the company creator
  CASE 
    WHEN cc.creator_user_id = u.id THEN 'admin'
    WHEN ur.cmms_role_id IS NOT NULL THEN r.role_name
    ELSE 'viewer'
  END AS effective_role,
  -- Collect all roles for this user
  STRING_AGG(r.role_name, ', ' ORDER BY r.role_name) AS role_labels,
  -- Mark if user is creator
  CASE WHEN cc.creator_user_id = u.id THEN TRUE ELSE FALSE END AS is_creator
FROM public.cmms_users u
LEFT JOIN public.cmms_user_roles ur ON u.id = ur.cmms_user_id AND ur.is_active = TRUE
LEFT JOIN public.cmms_roles r ON ur.cmms_role_id = r.id
LEFT JOIN public.cmms_company_creators cc ON u.cmms_company_id = cc.cmms_company_id AND u.id = cc.creator_user_id
WHERE u.is_active = TRUE
GROUP BY u.id, u.email, u.user_name, u.full_name, u.phone, u.department, u.department_id, u.cmms_company_id, u.is_active, u.created_at, cc.creator_user_id, ur.cmms_role_id, r.role_name, cc.creator_user_id;

-- Grant access to view
GRANT SELECT ON public.cmms_users_with_roles TO authenticated, anon;

-- ================================================================
-- VERIFICATION
-- ================================================================
SELECT 'cmms_users_with_roles view fixed! Now includes department_id.' as status;

-- Verify the view has all required columns
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'cmms_users_with_roles'
ORDER BY ordinal_position;
