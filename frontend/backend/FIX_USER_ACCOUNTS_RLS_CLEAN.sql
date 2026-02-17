-- =====================================================
-- USER_ACCOUNTS RLS POLICIES - RECIPIENT LOOKUP FIX
-- =====================================================

-- Enable RLS
ALTER TABLE public.user_accounts ENABLE ROW LEVEL SECURITY;

-- Drop ALL existing policies
DROP POLICY IF EXISTS "Users can view their own account" ON public.user_accounts;
DROP POLICY IF EXISTS "Balance is private" ON public.user_accounts;
DROP POLICY IF EXISTS "Send-safe account lookup" ON public.user_accounts;
DROP POLICY IF EXISTS "Users can create their own account" ON public.user_accounts;
DROP POLICY IF EXISTS "Users can update their own account" ON public.user_accounts;
DROP POLICY IF EXISTS "Users can delete their own account" ON public.user_accounts;
DROP POLICY IF EXISTS "Service role can manage user accounts" ON public.user_accounts;
DROP POLICY IF EXISTS "Authenticated users can view user accounts for transfers" ON public.user_accounts;

-- CREATE NEW POLICIES

-- Policy 1: SELECT - Authenticated users can view all user accounts (for lookups)
CREATE POLICY "Authenticated users can view user accounts"
  ON public.user_accounts FOR SELECT
  USING (auth.role() = 'authenticated');

-- Policy 2: INSERT - Only users can create their own account
CREATE POLICY "Users can insert their own account"
  ON public.user_accounts FOR INSERT
  WITH CHECK (auth.uid()::text = user_id::text);

-- Policy 3: UPDATE - Only account owner can update
CREATE POLICY "Users can update their own account"
  ON public.user_accounts FOR UPDATE
  USING (auth.uid()::text = user_id::text)
  WITH CHECK (auth.uid()::text = user_id::text);

-- Policy 4: DELETE - Only account owner can delete
CREATE POLICY "Users can delete their own account"
  ON public.user_accounts FOR DELETE
  USING (auth.uid()::text = user_id::text);

-- Policy 5: Service role can manage accounts
CREATE POLICY "Service role can manage user accounts"
  ON public.user_accounts FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Verify policies were created
SELECT 
  policyname,
  permissive,
  roles,
  qual
FROM pg_policies
WHERE tablename = 'user_accounts'
ORDER BY policyname;
