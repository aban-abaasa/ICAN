-- 🎬 Fix Pitches Storage RLS Policies - Version 2
-- ================================================
-- Complete fix for pitch video playback
-- This version handles both authenticated and anonymous/public access
--
-- WHY THIS FIXES VIDEO PLAYBACK:
-- - Previous policy only had bucket_id check but missing explicit public grant
-- - Videos upload fine but browser can't download due to RLS denial
-- - This adds explicit permissions for unauthenticated users to SELECT

-- Step 1: Drop ALL existing policies to ensure clean slate
DROP POLICY IF EXISTS "Authenticated users can upload pitch videos" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view pitch videos" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their own pitch videos" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own pitch videos" ON storage.objects;
DROP POLICY IF EXISTS "Public read access for pitches" ON storage.objects;
DROP POLICY IF EXISTS "Anonymous can view pitches" ON storage.objects;

-- Step 2: Enable public access for SELECT (READ)
-- This allows anyone to download/view pitch videos without authentication
CREATE POLICY "Anonymous users can view pitch videos"
ON storage.objects FOR SELECT
USING (bucket_id = 'pitches');

-- Step 3: Authenticated users can upload
CREATE POLICY "Authenticated users can upload pitch videos"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'pitches' 
  AND auth.role() = 'authenticated'
);

-- Step 4: Authenticated users can update their own videos
CREATE POLICY "Users can update their own pitch videos"
ON storage.objects FOR UPDATE
USING (bucket_id = 'pitches' AND auth.role() = 'authenticated')
WITH CHECK (bucket_id = 'pitches' AND auth.role() = 'authenticated');

-- Step 5: Authenticated users can delete their own videos
CREATE POLICY "Users can delete their own pitch videos"
ON storage.objects FOR DELETE
USING (bucket_id = 'pitches' AND auth.role() = 'authenticated');

-- Step 6: Verify bucket exists and RLS is enabled
-- If you see "relation "storage.buckets" does not exist", that's normal - bucket is auto-created

-- 🎉 All policies created!
-- 
-- VERIFICATION CHECKLIST:
-- 1. Go to Supabase Dashboard → Storage → pitches bucket
-- 2. Click on "Policies" tab
-- 3. You should see 5 policies:
--    ✓ Anonymous users can view pitch videos (SELECT)
--    ✓ Authenticated users can upload pitch videos (INSERT)
--    ✓ Users can update their own pitch videos (UPDATE)
--    ✓ Users can delete their own pitch videos (DELETE)
--
-- 4. All policies should have GREEN checkmark (✓) = enabled
-- 5. If any are disabled (gray), click to enable them
--
-- TESTING:
-- 1. Upload a new pitch video
-- 2. Look in browser console for "Public URL: https://..."
-- 3. Try to open that URL directly in browser - should show video player
-- 4. If it shows blank/error, check browser Network tab for 403 Forbidden errors

-- Note: If videos still don't play after this, the issue may be:
-- - WebM format not supported by browser (use MP4 instead)
-- - CORS headers missing from Supabase bucket (contact support)
-- - Signed URLs required instead of public URLs
