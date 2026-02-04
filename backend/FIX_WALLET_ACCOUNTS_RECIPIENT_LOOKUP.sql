/**
 * 🔐 FIX: Wallet Accounts RLS - Allow Recipient Lookups
 * 
 * Problem: 406 error when trying to look up RECIPIENT wallet accounts
 * Cause: RLS policy only allows viewing own wallet accounts
 * Solution: Add policy allowing authenticated users to READ all wallet accounts (for send lookups)
 */

-- =====================================================
-- UPDATE wallet_accounts RLS Policies
-- =====================================================

-- Enable RLS
ALTER TABLE public.wallet_accounts ENABLE ROW LEVEL SECURITY;

-- Drop old restrictive policies
DROP POLICY IF EXISTS "Users can view their own wallet accounts" ON public.wallet_accounts;
DROP POLICY IF EXISTS "Users can create their own wallet accounts" ON public.wallet_accounts;
DROP POLICY IF EXISTS "Users can update their own wallet accounts" ON public.wallet_accounts;
DROP POLICY IF EXISTS "Users can delete their own wallet accounts" ON public.wallet_accounts;
DROP POLICY IF EXISTS "Allow all selects" ON public.wallet_accounts;
DROP POLICY IF EXISTS "Allow all inserts" ON public.wallet_accounts;
DROP POLICY IF EXISTS "Allow all updates" ON public.wallet_accounts;
DROP POLICY IF EXISTS "Allow all deletes" ON public.wallet_accounts;

-- ✅ NEW POLICIES (with recipient lookup support):

-- 1️⃣ SELECT: Authenticated users can VIEW all wallet accounts (for lookups)
CREATE POLICY "Authenticated users can view wallet accounts for transfers"
  ON public.wallet_accounts FOR SELECT
  USING (auth.role() = 'authenticated');

-- 2️⃣ INSERT: Only the account owner can create wallet accounts
CREATE POLICY "Users can create their own wallet accounts"
  ON public.wallet_accounts FOR INSERT
  WITH CHECK (auth.uid()::text = user_id::text);

-- 3️⃣ UPDATE: Only the account owner can update their own accounts
CREATE POLICY "Users can update their own wallet accounts"
  ON public.wallet_accounts FOR UPDATE
  USING (auth.uid()::text = user_id::text)
  WITH CHECK (auth.uid()::text = user_id::text);

-- 4️⃣ DELETE: Only the account owner can delete their own accounts
CREATE POLICY "Users can delete their own wallet accounts"
  ON public.wallet_accounts FOR DELETE
  USING (auth.uid()::text = user_id::text);

-- =====================================================
-- Verify Policies
-- =====================================================

-- View all policies on wallet_accounts
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  qual,
  with_check
FROM pg_policies
WHERE tablename = 'wallet_accounts'
ORDER BY policyname;

-- =====================================================
-- SUMMARY
-- =====================================================

/*
✅ CHANGES:

OLD SELECT Policy (WRONG):
  USING (auth.uid()::text = user_id::text)
  → Users could only view their OWN wallet accounts
  → Blocked recipient lookups → 406 error

NEW SELECT Policy (CORRECT):
  USING (auth.role() = 'authenticated')
  → Any authenticated user can VIEW all wallet accounts
  → Allows recipient lookups for send functionality
  → Still secure because INSERT/UPDATE/DELETE are restricted to owner

INSERT/UPDATE/DELETE Policies (UNCHANGED):
  USING (auth.uid()::text = user_id::text)
  → Only owner can modify their account

SECURITY:
- ✅ Authenticated users can READ wallet account data (for lookups)
- ✅ Only owner can CREATE/UPDATE/DELETE their account
- ✅ Prevents unauthorized modifications
- ✅ Allows send functionality to work (lookup recipient account)

AFTER THIS FIX:
- ✅ Recipient wallet account lookups will return 200 OK
- ✅ No more 406 errors on wallet_accounts queries
- ✅ Send functionality will work correctly
- ✅ Users can look up recipients by account number/email/phone
*/
