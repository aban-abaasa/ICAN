-- =============================================
-- VERIFY CMMS USER DATA
-- =============================================
-- Run this to verify user setup in Supabase

-- Check if user exists
SELECT 
    u.id,
    u.email,
    u.full_name,
    u.cmms_company_id,
    u.is_active,
    u.ican_verified
FROM public.cmms_users u
WHERE LOWER(u.email) = LOWER('abanabaasa2@gmail.com');

-- Check user roles
SELECT 
    ur.id,
    ur.cmms_user_id,
    ur.cmms_role_id,
    r.role_name,
    r.display_name,
    ur.is_active
FROM public.cmms_user_roles ur
LEFT JOIN public.cmms_roles r ON ur.cmms_role_id = r.id
WHERE ur.cmms_user_id IN (
    SELECT id FROM public.cmms_users 
    WHERE LOWER(email) = LOWER('abanabaasa2@gmail.com')
);

-- Check company details
SELECT 
    cp.id,
    cp.company_name,
    cp.created_by
FROM public.cmms_company_profiles cp
WHERE cp.id IN (
    SELECT cmms_company_id FROM public.cmms_users 
    WHERE LOWER(email) = LOWER('abanabaasa2@gmail.com')
);

-- Show all users for the company
SELECT 
    u.email,
    u.full_name,
    u.is_active,
    STRING_AGG(DISTINCT r.role_name, ', ') as roles
FROM public.cmms_users u
LEFT JOIN public.cmms_user_roles ur ON u.id = ur.cmms_user_id AND ur.is_active = TRUE
LEFT JOIN public.cmms_roles r ON ur.cmms_role_id = r.id
WHERE u.cmms_company_id IN (
    SELECT cmms_company_id FROM public.cmms_users 
    WHERE LOWER(email) = LOWER('abanabaasa2@gmail.com')
)
GROUP BY u.id, u.email, u.full_name, u.is_active
ORDER BY u.created_at DESC;
