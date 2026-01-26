-- Complete Storage Configuration Fix
-- Run this in Supabase SQL Editor to make images publicly accessible

-- 1. Ensure bucket is PUBLIC
UPDATE storage.buckets 
SET public = true, file_size_limit = 5242880, allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp']
WHERE name = 'user-content';

-- 2. Verify bucket update
SELECT id, name, public, file_size_limit, allowed_mime_types 
FROM storage.buckets 
WHERE name = 'user-content';

-- 3. Drop all existing storage policies
DROP POLICY IF EXISTS "Public read" ON storage.objects;
DROP POLICY IF EXISTS "Public read access" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated upload" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload to avatars" ON storage.objects;
DROP POLICY IF EXISTS "User delete own" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete own files" ON storage.objects;

-- 4. Create SIMPLE public read policy (no restrictions)
CREATE POLICY "Public read"
ON storage.objects FOR SELECT
USING (bucket_id = 'user-content');

-- 5. Create upload policy for authenticated users
CREATE POLICY "Authenticated upload"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'user-content' AND auth.role() = 'authenticated');

-- 6. Create delete policy
CREATE POLICY "User delete"
ON storage.objects FOR DELETE
USING (bucket_id = 'user-content' AND auth.role() = 'authenticated');

-- 7. List all current policies
SELECT policyname, permissive, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects'
ORDER BY policyname;
