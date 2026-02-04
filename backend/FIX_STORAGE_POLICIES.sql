-- Fix Storage Bucket Policies for user-content
-- Run this in Supabase SQL Editor at: https://supabase.com/dashboard/project/hswxazpxcgtqbxeqcxxw/sql/new

-- Drop existing policies for user-content bucket
DROP POLICY IF EXISTS "Public read access" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload avatars" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete own avatars" ON storage.objects;

-- Create new policies for public read access
CREATE POLICY "Public read access"
ON storage.objects FOR SELECT
USING (bucket_id = 'user-content');

-- Allow authenticated users to upload
CREATE POLICY "Authenticated users can upload to avatars"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'user-content' 
  AND auth.role() = 'authenticated'
);

-- Allow users to delete their own files
CREATE POLICY "Users can delete own files"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'user-content'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Verify policies are created
SELECT policyname, permissive, roles
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects'
ORDER BY policyname;
