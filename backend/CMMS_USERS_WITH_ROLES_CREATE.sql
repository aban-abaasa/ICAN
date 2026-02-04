-- Create cmms_users_with_roles view
-- This view joins users with their assigned roles in CMMS
-- Also identifies company creators as admins

CREATE OR REPLACE VIEW public.cmms_users_with_roles AS
SELECT 
  cu.id,
  cu.cmms_company_id,
  cu.email,
  cu.user_name,
  cu.full_name,
  cu.phone,
  cu.department,
  cu.job_title,
  cu.is_active,
  cu.created_at,
  STRING_AGG(cr.display_name, ', ') as role_labels,
  -- Check if user is the company creator
  CASE 
    WHEN cp.created_by = cu.id THEN 'admin'
    WHEN STRING_AGG(cr.display_name, ', ') IS NOT NULL THEN 'assigned'
    ELSE 'viewer'
  END as effective_role
FROM 
  public.cmms_users cu
LEFT JOIN 
  public.cmms_user_roles cur ON cu.id = cur.cmms_user_id AND cur.is_active = TRUE
LEFT JOIN 
  public.cmms_roles cr ON cur.cmms_role_id = cr.id
LEFT JOIN
  public.cmms_company_profiles cp ON cu.cmms_company_id = cp.id
GROUP BY 
  cu.id, 
  cu.cmms_company_id, 
  cu.email,
  cu.user_name,
  cu.full_name, 
  cu.phone, 
  cu.department,
  cu.job_title,
  cu.is_active, 
  cu.created_at,
  cp.created_by;

-- Enable RLS on the view
ALTER VIEW public.cmms_users_with_roles OWNER TO postgres;

-- Grant access
GRANT SELECT ON public.cmms_users_with_roles TO anon, authenticated;
