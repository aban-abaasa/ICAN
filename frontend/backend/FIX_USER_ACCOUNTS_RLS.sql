/**
 * 🔒 Fix user_accounts RLS Policies
 * Resolves 406 Not Acceptable errors on GET/SELECT queries
 * Issue: RLS policies blocking account lookups
 */

-- =====================================================
-- Enable RLS on user_accounts if not already enabled
-- =====================================================
ALTER TABLE public.user_accounts ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- Drop all existing policies to start fresh
-- =====================================================
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

-- =====================================================
-- Create proper RLS policies for user_accounts
-- =====================================================

-- SELECT: Users can view their own accounts
CREATE POLICY "Users can view their own accounts"
  ON public.user_accounts FOR SELECT
  USING (auth.uid()::text = user_id::text);

-- INSERT: Users can create accounts for themselves
CREATE POLICY "Users can create their own accounts"
  ON public.user_accounts FOR INSERT
  WITH CHECK (auth.uid()::text = user_id::text);

-- UPDATE: Users can update their own accounts
CREATE POLICY "Users can update their own accounts"
  ON public.user_accounts FOR UPDATE
  USING (auth.uid()::text = user_id::text)
  WITH CHECK (auth.uid()::text = user_id::text);

-- DELETE: Users can delete their own accounts
CREATE POLICY "Users can delete their own accounts"
  ON public.user_accounts FOR DELETE
  USING (auth.uid()::text = user_id::text);

-- =====================================================
-- Alternative: Service role query (admin/backend access)
-- =====================================================
-- If you need backend/admin access, service role bypasses RLS

-- =====================================================
-- Verification
-- =====================================================

SELECT 
  'user_accounts RLS policies:' as info;

SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  qual as "USING condition",
  with_check as "WITH CHECK condition"
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'user_accounts'
ORDER BY policyname;

-- Check table structure
SELECT 
  column_name, 
  data_type, 
  is_nullable
FROM information_schema.columns
WHERE table_name = 'user_accounts'
ORDER BY ordinal_position;

-- =====================================================
-- Troubleshooting Notes
-- =====================================================
/*
If you still get 406 errors:

1. Check Content-Type Header:
   - Add header: 'Content-Type: application/json'
   
2. Check Authorization Header:
   - Add header: 'Authorization: Bearer YOUR_SUPABASE_TOKEN'
   
3. Check PostgREST Configuration:
   - Supabase Dashboard → Project Settings → API
   - Verify PostgREST URL is correct
   
4. Test with Service Role Key (for admin queries):
   - Supabase allows service_role bypassing RLS
   - Use service_role key for backend/admin operations

5. Query Format:
   - Correct: SELECT user_id, account_holder_name FROM user_accounts?select=user_id,account_holder_name&account_number=eq.ICAN-8071026101388866
   - Check: Filter should use ?account_number=eq.VALUE format

6. RLS Policy Debug:
   - Try: SELECT * FROM user_accounts (with authenticated user)
   - Should return only your own records if RLS is working

7. For Public Queries (if needed):
   - Create policy: CREATE POLICY "Public read" ON user_accounts FOR SELECT USING (true);
   - Only use if data should be public!
*/
