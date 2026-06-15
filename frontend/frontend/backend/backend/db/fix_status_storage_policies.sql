-- Fix RLS Policies for Status Storage in ICAN
-- This script adds storage policies for the statuses folder

-- =============================================
-- STATUS STORAGE POLICIES
-- =============================================

-- Anyone can view statuses
CREATE POLICY IF NOT EXISTS "Anyone can view statuses"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'user-content' AND 
  (storage.foldername(name))[1] = 'statuses'
);

-- Authenticated users can upload statuses
CREATE POLICY IF NOT EXISTS "Authenticated users can upload statuses"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'user-content' AND 
  (storage.foldername(name))[1] = 'statuses' AND
  auth.role() = 'authenticated'
);

-- Authenticated users can update their own statuses
CREATE POLICY IF NOT EXISTS "Users can update their own statuses"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'user-content' AND 
  (storage.foldername(name))[1] = 'statuses' AND
  auth.role() = 'authenticated'
);

-- Authenticated users can delete their own statuses
CREATE POLICY IF NOT EXISTS "Users can delete their own statuses"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'user-content' AND 
  (storage.foldername(name))[1] = 'statuses' AND
  auth.role() = 'authenticated'
);

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
