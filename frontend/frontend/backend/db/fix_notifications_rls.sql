-- 🔔 Fix Notifications Table RLS Policies
-- ==========================================
-- Enable users to create and read their own notifications

-- Step 1: Drop existing policies to ensure clean slate
DROP POLICY IF EXISTS "Users can create notifications for themselves" ON public.notifications;
DROP POLICY IF EXISTS "Users can read their own notifications" ON public.notifications;
DROP POLICY IF EXISTS "Users can delete their own notifications" ON public.notifications;

-- Step 2: Enable RLS (if not already enabled)
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Step 3: Create policy allowing users to INSERT notifications for themselves
CREATE POLICY "Users can create notifications for themselves"
ON public.notifications FOR INSERT
WITH CHECK (
  auth.uid() = recipient_id
);

-- Step 4: Create policy allowing users to SELECT their own notifications
CREATE POLICY "Users can read their own notifications"
ON public.notifications FOR SELECT
USING (
  auth.uid() = recipient_id
);

-- Step 5: Create policy allowing users to DELETE their own notifications
CREATE POLICY "Users can delete their own notifications"
ON public.notifications FOR DELETE
USING (
  auth.uid() = recipient_id
);

-- Step 6: Optional - Allow authenticated users to read any notification (for viewing shared notifications)
CREATE POLICY "Authenticated users can read all notifications"
ON public.notifications FOR SELECT
USING (
  auth.role() = 'authenticated'
);

-- 🎉 All notification policies created!
--
-- VERIFICATION CHECKLIST:
-- 1. Go to Supabase Dashboard → SQL Editor
-- 2. Run this script
-- 3. Go to Supabase Dashboard → Database → notifications table
-- 4. Click on "RLS" (under Authentication section)
-- 5. You should see 4 policies:
--    ✓ Users can create notifications for themselves (INSERT)
--    ✓ Users can read their own notifications (SELECT)
--    ✓ Users can delete their own notifications (DELETE)
--    ✓ Authenticated users can read all notifications (SELECT)
--
-- TESTING:
-- 1. Create a pitch
-- 2. Try to sign it with another user
-- 3. Check browser console - notification should be created without errors
-- 4. Check the notifications table in Supabase - should show the new notification
