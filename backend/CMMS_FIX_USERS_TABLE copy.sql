-- ============================================
-- CMMS - DIAGNOSE & FIX USERS TABLE
-- ============================================

-- Step 1: Check if users table exists
SELECT EXISTS (
   SELECT FROM information_schema.tables 
   WHERE table_schema = 'public' 
   AND table_name = 'users'
) as users_table_exists;

-- Step 2: Check what columns currently exist in users table
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'users'
ORDER BY ordinal_position;

-- Step 3: If email column is missing, add it
ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS email VARCHAR(100) UNIQUE;

-- Step 4: Verify email column now exists
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'users' AND column_name = 'email';

-- Step 5: Check companies table
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'companies'
ORDER BY ordinal_position;

-- Step 6: Test - Try to insert a test company and user
INSERT INTO companies (company_name, company_registration, location, industry, phone, email, is_active)
VALUES (
    'Test Company',
    'TEST-001',
    'Test Location',
    'Manufacturing',
    '+256-700-000-000',
    'test@company.com',
    true
)
ON CONFLICT (company_registration) DO NOTHING;

-- Step 7: Test - Insert a test user
INSERT INTO users (company_id, email, user_name, phone, is_active)
VALUES (
    (SELECT id FROM companies WHERE company_registration = 'TEST-001' LIMIT 1),
    'admin@testcompany.com',
    'Test Admin',
    '+256-700-000-001',
    true
)
ON CONFLICT (email) DO NOTHING;

-- Step 8: Verify data was inserted
SELECT 'Companies' as table_name, COUNT(*) as count FROM companies
UNION ALL
SELECT 'Users', COUNT(*) FROM users;

-- Step 9: Show test data
SELECT id, company_name, email FROM companies WHERE company_registration = 'TEST-001';
SELECT id, email, user_name, company_id FROM users WHERE email LIKE '%test%';
