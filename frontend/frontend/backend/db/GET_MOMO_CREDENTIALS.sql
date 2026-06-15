-- =============================================
-- GET MTN MOMO API CREDENTIALS
-- Retrieve API User and API Key for authentication
-- =============================================

-- =============================================
-- QUERY 1: Get Active MOMO Credentials (Primary)
-- =============================================
SELECT 
    id,
    name,
    subscription_key as "PRIMARY_KEY",
    api_user_id as "API_USER",
    api_secret_key as "API_KEY",
    environment,
    base_url,
    is_active,
    is_primary,
    created_at,
    updated_at
FROM public.mtn_momo_config
WHERE is_active = true 
  AND is_primary = true
  AND environment = 'sandbox'
LIMIT 1;

-- =============================================
-- QUERY 2: Get All Active MOMO Configurations
-- =============================================
-- SELECT 
--     id,
--     name,
--     subscription_key as "PRIMARY_KEY",
--     api_user_id as "API_USER",
--     api_secret_key as "API_KEY",
--     environment,
--     base_url,
--     is_active,
--     is_primary,
--     created_at
-- FROM public.mtn_momo_config
-- WHERE is_active = true
-- ORDER BY is_primary DESC, created_at DESC;

-- =============================================
-- QUERY 3: Get Specific Credentials by Subscription Key
-- =============================================
-- SELECT 
--     subscription_key as "PRIMARY_KEY",
--     api_user_id as "API_USER",
--     api_secret_key as "API_KEY",
--     environment
-- FROM public.mtn_momo_config
-- WHERE subscription_key = 'bc94878b6776497da38d09c302c4380c'
--   AND is_active = true;

-- =============================================
-- QUERY 4: Verify Current Configuration
-- =============================================
-- SELECT 
--     'Primary Key (Subscription)' as credential_type,
--     subscription_key as value
-- FROM public.mtn_momo_config
-- WHERE is_primary = true AND is_active = true
-- UNION ALL
-- SELECT 
--     'API User ID',
--     api_user_id
-- FROM public.mtn_momo_config
-- WHERE is_primary = true AND is_active = true
-- UNION ALL
-- SELECT 
--     'API Secret Key',
--     api_secret_key
-- FROM public.mtn_momo_config
-- WHERE is_primary = true AND is_active = true;

-- =============================================
-- QUERY 5: Get Credentials with Descriptive Info
-- =============================================
-- SELECT 
--     name as "Configuration Name",
--     description as "Description",
--     subscription_key as "Primary Key (Subscription)",
--     api_user_id as "API User ID",
--     api_secret_key as "API Secret Key",
--     environment as "Environment",
--     base_url as "Base URL",
--     CASE WHEN is_active THEN '✅ Active' ELSE '❌ Inactive' END as "Status"
-- FROM public.mtn_momo_config
-- WHERE is_primary = true;

-- =============================================
-- QUERY 6: Export Credentials as JSON
-- =============================================
-- SELECT 
--     json_build_object(
--         'primary_key', subscription_key,
--         'api_user', api_user_id,
--         'api_secret_key', api_secret_key,
--         'environment', environment,
--         'base_url', base_url,
--         'name', name,
--         'is_active', is_active
--     ) as momo_credentials
-- FROM public.mtn_momo_config
-- WHERE is_primary = true AND is_active = true;

-- =============================================
-- NOTES
-- =============================================
-- Primary Key (Subscription Key): bc94878b6776497da38d09c302c4380c
-- API Secret Key: a1b60af7eae9463ab7524d4fb8549afb
-- 
-- Usage in Backend:
-- 1. Uncomment desired query above
-- 2. Execute in Supabase SQL Editor
-- 3. Use credentials for MTN MOMO API integration
-- 
-- These credentials are used by:
-- - mtnMomoService.js (Node.js backend)
-- - Environment variables (.env file)
-- - Collection Widget for receiving mobile money payments
