-- =====================================================
-- FIX RLS POLICY FOR shareholder_notifications
-- =====================================================
-- Allow investors to create notifications for shareholders
-- Allow shareholders to read their own notifications

-- Drop existing restrictive policies
DROP POLICY IF EXISTS "Enable read for shareholders" ON public.shareholder_notifications;
DROP POLICY IF EXISTS "Users can only insert notifications for themselves" ON public.shareholder_notifications;
DROP POLICY IF EXISTS "Users can update their own notifications" ON public.shareholder_notifications;
DROP POLICY IF EXISTS "Shareholders can read their notifications" ON public.shareholder_notifications;
DROP POLICY IF EXISTS "Investors can create shareholder notifications" ON public.shareholder_notifications;

-- NEW POLICIES:

-- 1. Shareholders can READ their own notifications
CREATE POLICY "Shareholders can read their notifications"
  ON public.shareholder_notifications
  FOR SELECT
  USING (shareholder_id = auth.uid());

-- 2. Investors can CREATE notifications for shareholders (when they initiate investment)
--    This checks if the investor has an investment_approvals record for this investment
CREATE POLICY "Investors can create shareholder notifications"
  ON public.shareholder_notifications
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.investment_approvals ia
      WHERE ia.investment_id = shareholder_notifications.investment_id
      AND ia.investor_id = auth.uid()
    )
  );

-- 3. Shareholders can UPDATE their own notification status (e.g., mark as read)
CREATE POLICY "Shareholders can update their notifications"
  ON public.shareholder_notifications
  FOR UPDATE
  USING (shareholder_id = auth.uid())
  WITH CHECK (shareholder_id = auth.uid());

-- 4. Service role can do anything (for backend operations)
-- (This is automatically allowed - no policy needed)

-- Verify policies are in place
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  qual,
  with_check
FROM pg_policies
WHERE tablename = 'shareholder_notifications'
ORDER BY policyname;
