-- Check if user-content storage bucket exists
-- Run this in Supabase SQL Editor

SELECT id, name, owner, public, created_at
FROM storage.buckets
WHERE name = 'user-content';

-- If no results, the bucket doesn't exist and needs to be created
-- You'll need to create it manually in the Supabase dashboard:
-- 1. Go to Storage section
-- 2. Click "Create a new bucket"
-- 3. Name it: user-content
-- 4. Make it PUBLIC (toggle on)
-- 5. Click Create
