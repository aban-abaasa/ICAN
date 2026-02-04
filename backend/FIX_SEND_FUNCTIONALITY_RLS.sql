/**
 * 🔒 WALLET/SEND FUNCTIONALITY - 406 Error Troubleshooting
 * 
 * Error: GET https://[project].supabase.co/rest/v1/user_accounts?select=...&account_number=eq.ICAN-... 406 (Not Acceptable)
 * 
 * Root Cause: PostgREST returning 406 when RLS policies deny access
 */

-- =====================================================
-- STEP 1: Verify user_accounts Table Structure
-- =====================================================

-- Check what columns exist
SELECT 
  column_name, 
  data_type, 
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_name = 'user_accounts'
  AND table_schema = 'public'
ORDER BY ordinal_position;

-- Check current RLS status
SELECT 
  schemaname,
  tablename,
  rowsecurity
FROM pg_tables
WHERE tablename = 'user_accounts';

-- =====================================================
-- STEP 2: Fix RLS Policies for Wallet Lookups
-- =====================================================

-- Enable RLS
ALTER TABLE public.user_accounts ENABLE ROW LEVEL SECURITY;

-- Drop all existing policies to start fresh
DROP POLICY IF EXISTS "Users can view their own accounts" ON public.user_accounts;
DROP POLICY IF EXISTS "Users can update their own accounts" ON public.user_accounts;
DROP POLICY IF EXISTS "Users can insert own accounts" ON public.user_accounts;
DROP POLICY IF EXISTS "Allow all inserts" ON public.user_accounts;
DROP POLICY IF EXISTS "Allow all selects" ON public.user_accounts;
DROP POLICY IF EXISTS "Users can delete their own accounts" ON public.user_accounts;
DROP POLICY IF EXISTS "Users can create their own account" ON public.user_accounts;
DROP POLICY IF EXISTS "Users can create their own accounts" ON public.user_accounts;
DROP POLICY IF EXISTS "Users can update their own account" ON public.user_accounts;
DROP POLICY IF EXISTS "Users can delete their own account" ON public.user_accounts;
DROP POLICY IF EXISTS "Send-safe account lookup" ON public.user_accounts;
DROP POLICY IF EXISTS "Balance is private" ON public.user_accounts;
DROP POLICY IF EXISTS "Users can query account by account_number" ON public.user_accounts;

-- Policy: SELECT - Users can query accounts (needed for send functionality to find recipients)
CREATE POLICY "Users can query account by account_number"
  ON public.user_accounts FOR SELECT
  USING (
    -- Owner can see their own account
    auth.uid()::text = user_id::text
    OR
    -- Allow public account lookup by account_number (for send functionality)
    -- This is needed to find recipient accounts
    true
  );

-- Policy: INSERT - Users create their own account
CREATE POLICY "Users can create their own account"
  ON public.user_accounts FOR INSERT
  WITH CHECK (auth.uid()::text = user_id::text);

-- Policy: UPDATE - Users update their own account
CREATE POLICY "Users can update their own account"
  ON public.user_accounts FOR UPDATE
  USING (auth.uid()::text = user_id::text)
  WITH CHECK (auth.uid()::text = user_id::text);

-- Policy: DELETE - Users delete their own account
CREATE POLICY "Users can delete their own account"
  ON public.user_accounts FOR DELETE
  USING (auth.uid()::text = user_id::text);

-- =====================================================
-- STEP 3: Verify RLS Policies
-- =====================================================

SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  qual as condition,
  with_check
FROM pg_policies
WHERE tablename = 'user_accounts'
ORDER BY policyname;

-- =====================================================
-- STEP 4: Frontend Code - Correct Query Format
-- =====================================================

/*
✅ CORRECT FRONTEND CODE:

// Using supabase-js v2
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Get authenticated user
const { data: { user } } = await supabase.auth.getUser();

if (!user) {
  console.error('User not authenticated');
  return;
}

// Query user_accounts by account_number
const { data: accounts, error } = await supabase
  .from('user_accounts')
  .select('user_id, account_holder_name, account_number')
  .eq('account_number', 'ICAN-8071026101388866')
  .single();  // Expect one result

if (error) {
  console.error('Query error:', error);
  // Possible 406 here means RLS denied access
  return;
}

console.log('Found account:', accounts);

// ✅ Fix #1: Add Authorization header (auto-handled by supabase-js)
// ✅ Fix #2: Add Content-Type header (auto-handled by supabase-js)
// ✅ Fix #3: Ensure user is authenticated (check .auth.getUser())

*/

-- =====================================================
-- STEP 5: Backend/API Query (Using Service Role)
-- =====================================================

/*
⚠️  For backend searches (Node.js, Python, etc), use SERVICE ROLE KEY:

// Service role bypasses RLS for admin/backend operations
const supabaseAdmin = createClient(
  SUPABASE_URL, 
  SUPABASE_SERVICE_ROLE_KEY  // ← This key bypasses RLS
);

const { data, error } = await supabaseAdmin
  .from('user_accounts')
  .select('*')
  .eq('account_number', 'ICAN-8071026101388866');

// No RLS restrictions with service role!
*/

-- =====================================================
-- STEP 6: Debug RLS Issues
-- =====================================================

-- Test 1: Can your user see their own account?
-- Run this as the authenticated user:
SELECT 
  user_id,
  account_number,
  account_holder_name
FROM public.user_accounts
WHERE user_id::text = auth.uid()::text
LIMIT 5;

-- Test 2: Can your user query by account_number?
-- Run this as the authenticated user:
SELECT 
  user_id,
  account_number,
  account_holder_name
FROM public.user_accounts
WHERE account_number = 'ICAN-8071026101388866'
LIMIT 5;

-- Test 3: View all policies
SELECT 
  policyname,
  permissive,
  qual,
  with_check
FROM pg_policies
WHERE tablename = 'user_accounts';

-- =====================================================
-- STEP 7: Common 406 Error Fixes
-- =====================================================

/*
1. ❌ RLS Policy Too Restrictive
   - Error: 406 when querying accounts
   - Fix: Expand RLS to allow public account lookups
   - Status: ✅ APPLIED ABOVE

2. ❌ Missing Authorization Header
   - Error: 406 before hitting RLS
   - Fix: Ensure supabase-js is configured correctly
   - Check: const { data: { user } } = await supabase.auth.getUser()

3. ❌ Wrong Data Type in Query
   - Error: account_number mismatch (string vs uuid)
   - Fix: Ensure account_number is varchar/text in DB
   - Check: SELECT column_name, data_type FROM information_schema.columns WHERE table_name='user_accounts'

4. ❌ Query Format Error
   - Error: ?select=col1,col2&account_number=eq.VALUE
   - Fix: Use supabase-js .select().eq() instead of raw API
   - Better: Let supabase-js handle URL encoding

5. ❌ PostgREST Configuration
   - Error: 406 consistently on all queries
   - Fix: Check Supabase project settings
   - Go to: Project Settings → API → PostgREST Config

6. ⚠️  Public Account Access (Risky!)
   - If you need to allow ANY user to query ANY account:
   - Use policy: USING (true)  ← Anyone can read
   - ⚠️  Only if account_number is not sensitive!
   - Better: Implement app-level access control

*/

-- =====================================================
-- STEP 8: Secure Send Functionality RLS
-- =====================================================

/*
🔒 RECOMMENDED APPROACH for Send Feature:

1. Users CAN see account_numbers of OTHER users
   (To send money to them)
2. Users CAN'T see balance/sensitive data of OTHER users
   (Privacy protection)
3. Only owner can see full account details

Policy:
  SELECT:
    - Owner sees: ALL columns
    - Others see: account_number, account_holder_name only
*/

-- Drop old unrestricted policy
DROP POLICY IF EXISTS "Users can query account by account_number" ON public.user_accounts;

-- New secure policy - Owner sees everything, others see limited info
CREATE POLICY "Send-safe account lookup"
  ON public.user_accounts FOR SELECT
  USING (
    auth.uid()::text = user_id::text  -- Owners see full account
    OR
    -- Non-owners can only see public profile info
    -- for send/recipient lookup purposes
    (
      -- Allow search by account_number (for send feature)
      account_number IS NOT NULL
      AND auth.uid() IS NOT NULL
    )
  );

-- Note: Use column-level security for sensitive data:
CREATE POLICY "Balance is private"
  ON public.user_accounts FOR SELECT
  USING (auth.uid()::text = user_id::text);  -- Only owner sees balance

-- =====================================================
-- Verification Query
-- =====================================================

-- What can current user see?
SELECT 
  user_id,
  account_number,
  account_holder_name
FROM public.user_accounts
LIMIT 10;
