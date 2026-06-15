-- Disable RLS temporarily to see hidden departments
SET session "row_security" = OFF;

SELECT id, cmms_company_id, department_name, created_at 
FROM public.cmms_departments 
ORDER BY created_at DESC;

-- Check which company your user is in
SELECT id, cmms_company_id, email 
FROM public.cmms_users 
WHERE id = auth.uid();