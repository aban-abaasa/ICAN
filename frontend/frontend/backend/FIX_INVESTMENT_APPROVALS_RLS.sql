-- =====================================================
-- FIX: Add missing RLS policies for investment_approvals
-- =====================================================
-- The investment_approvals table had no INSERT policy, preventing 
-- investors from creating approval records

-- Step 1: Drop old policies if they exist
DROP POLICY IF EXISTS "Users can view approval records they're involved in" ON public.investment_approvals;
DROP POLICY IF EXISTS "Authenticated users can create approvals" ON public.investment_approvals;
DROP POLICY IF EXISTS "Users can update approval records" ON public.investment_approvals;

-- Step 2: Create new policies

-- Policy 1: SELECT - Investors and business owners can view approval records they're involved in
CREATE POLICY "Users can view investment approval records"
  ON public.investment_approvals FOR SELECT
  USING (
    auth.uid() = investor_id  -- Investor can view their own approvals
    OR auth.uid() IN (        -- Business owner can view approvals for their business
      SELECT user_id FROM public.business_profiles 
      WHERE id = business_profile_id
    )
  );

-- Policy 2: INSERT - Investors can create approval records (after signing)
CREATE POLICY "Investors can create investment approvals"
  ON public.investment_approvals FOR INSERT
  WITH CHECK (
    auth.uid() = investor_id  -- Must be the investor creating their own approval
  );

-- Policy 3: UPDATE - Both investors and business owners can update approvals
CREATE POLICY "Users can update investment approval records"
  ON public.investment_approvals FOR UPDATE
  USING (
    auth.uid() = investor_id  -- Investor can update their approval
    OR auth.uid() IN (        -- Business owner can update for their business
      SELECT user_id FROM public.business_profiles 
      WHERE id = business_profile_id
    )
  )
  WITH CHECK (
    auth.uid() = investor_id  -- New investor_id must match (prevent reassignment)
    OR auth.uid() IN (
      SELECT user_id FROM public.business_profiles 
      WHERE id = business_profile_id
    )
  );

-- Verification
SELECT 
  'RLS Policies Updated:' as status,
  (SELECT COUNT(*) FROM pg_policies WHERE tablename = 'investment_approvals') as total_policies;
