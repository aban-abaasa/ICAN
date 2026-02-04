-- =============================================
-- Fix RLS Policies for Status Storage in ICAN
-- Run this in Supabase SQL Editor
-- =============================================

-- Drop existing conflicting policies
DROP POLICY IF EXISTS "Anyone can view statuses" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload statuses" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their own statuses" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own statuses" ON storage.objects;

-- =============================================
-- STATUS STORAGE POLICIES (PERMISSIVE)
-- =============================================

-- Anyone can view statuses
CREATE POLICY "Anyone can view statuses"
ON storage.objects FOR SELECT
USING (bucket_id = 'user-content');

-- Authenticated users can upload to statuses folder
CREATE POLICY "Authenticated users can upload statuses"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'user-content' AND 
  auth.role() = 'authenticated'
);

-- Authenticated users can update files
CREATE POLICY "Users can update their own statuses"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'user-content' AND 
  auth.role() = 'authenticated'
);

-- Authenticated users can delete files
CREATE POLICY "Users can delete their own statuses"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'user-content' AND 
  auth.role() = 'authenticated'
);

-- Notify PostgREST to reload schema
NOTIFY pgrst, 'reload schema';

-- Verify policies were created
SELECT tablename, policyname FROM pg_policies 
WHERE schemaname = 'storage' AND tablename = 'objects'
ORDER BY policyname;
