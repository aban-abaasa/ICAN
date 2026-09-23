-- Diagnostic only -- run in the Supabase SQL editor and share the output.
-- Goal: find why cmms_get_my_pichin_business_access() throws
--   invalid input syntax for type uuid: "(cd789612-928...&g_ep=...)"
-- (code 22P02) even though it takes no arguments.

-- 1) Does the LIVE function match CMMS_PICHIN_PROFILE_ACCESS_BY_TYPE.sql?
--    (paste this back so we can diff it against the file)
SELECT pg_get_functiondef('public.cmms_get_my_pichin_business_access()'::regprocedure);
SELECT pg_get_functiondef('public.cmms_ensure_pichin_business_access(uuid)'::regprocedure);

-- 2) Are there other overloads of either name? (should be exactly one row each)
SELECT p.oid::regprocedure AS signature
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('cmms_get_my_pichin_business_access', 'cmms_ensure_pichin_business_access');

-- 3) Confirm the actual column types in the join chain -- looking for any
--    column that SHOULD be uuid but is text/varchar instead.
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (
    (table_name = 'business_co_owners' AND column_name IN ('business_profile_id', 'user_id', 'owner_email'))
    OR (table_name = 'business_profiles' AND column_name IN ('id', 'user_id'))
    OR (table_name = 'cmms_users' AND column_name IN ('id', 'cmms_company_id'))
    OR (table_name = 'cmms_company_profiles' AND column_name IN ('id', 'pichin_business_profile_id', 'created_by', 'created_by_user_id'))
  )
ORDER BY table_name, column_name;

-- 4) Hunt for the exact garbage value (or anything URL-shaped) sitting in a
--    column near this join chain. Adjust/add tables if step 3 turns up a
--    text/varchar column you didn't expect.
SELECT 'business_co_owners' AS tbl, id, business_profile_id::text, user_id::text, owner_email
FROM public.business_co_owners
WHERE user_id::text ILIKE '%g_ep%' OR owner_email ILIKE '%g_ep%'
UNION ALL
SELECT 'business_profiles', id, id::text, user_id::text, NULL
FROM public.business_profiles
WHERE user_id::text ILIKE '%g_ep%';
