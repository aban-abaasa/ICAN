-- Make user-content bucket functional
-- Run this in Supabase SQL Editor

-- 1. Update the bucket to be PUBLIC
UPDATE storage.buckets 
SET public = true 
WHERE name = 'user-content';

-- 2. Enable RLS on storage.objects
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- 3. Drop existing policies if any
DROP POLICY IF EXISTS "Public read access" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated upload" ON storage.objects;
DROP POLICY IF EXISTS "User delete own" ON storage.objects;

-- 4. Create new policies
-- Allow anyone to read public files
CREATE POLICY "Public read access"
ON storage.objects FOR SELECT
USING (bucket_id = 'user-content');

-- Allow authenticated users to upload
CREATE POLICY "Authenticated upload"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'user-content' AND auth.role() = 'authenticated');

-- Allow users to delete their own files
CREATE POLICY "User delete own"
ON storage.objects FOR DELETE
USING (bucket_id = 'user-content' AND auth.role() = 'authenticated');

-- 5. Verify the bucket is now public
SELECT id, name, public, created_at
FROM storage.buckets
WHERE name = 'user-content';
