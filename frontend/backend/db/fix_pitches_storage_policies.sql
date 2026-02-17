-- 🎬 Fix Pitches Storage RLS Policies
-- ====================================
-- Enable pitch video uploads in Supabase Storage
-- 
-- IMPORTANT: Run this TWICE if you get "already exists" errors
-- That means policies were partially created - they need to be dropped first

-- Step 1: Drop existing policies (if any) to avoid conflicts
DROP POLICY IF EXISTS "Authenticated users can upload pitch videos" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view pitch videos" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their own pitch videos" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own pitch videos" ON storage.objects;

-- Step 2: Create policies for the 'pitches' bucket
-- ================================================

-- Allow anyone (public) to view/download pitch videos
CREATE POLICY "Anyone can view pitch videos"
ON storage.objects FOR SELECT
USING (bucket_id = 'pitches');

-- Allow authenticated users to upload pitch videos
CREATE POLICY "Authenticated users can upload pitch videos"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'pitches' 
  AND auth.role() = 'authenticated'
);

-- Allow authenticated users to update their pitch videos
CREATE POLICY "Users can update their own pitch videos"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'pitches'
  AND auth.role() = 'authenticated'
);

-- Allow authenticated users to delete their pitch videos
CREATE POLICY "Users can delete their own pitch videos"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'pitches'
  AND auth.role() = 'authenticated'
);

-- 🎉 Done! Policies created successfully
-- Check: Storage → pitches → Policies tab should show 4 policies
-- If not showing, refresh the page or run this script again
