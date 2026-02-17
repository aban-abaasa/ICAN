-- ==========================================
-- CHECK IF BUSINESS DOCUMENTS EXIST
-- ==========================================

-- 1. Check if business_documents table exists
SELECT EXISTS (
  SELECT FROM information_schema.tables 
  WHERE table_schema = 'public' 
  AND table_name = 'business_documents'
) AS "Table Exists";

-- 2. Count all documents in the table
SELECT COUNT(*) as "Total Documents" FROM public.business_documents;

-- 3. Show all documents with their basic info
SELECT 
  id,
  business_profile_id,
  all_documents_completed,
  business_plan_completed,
  financial_projection_completed,
  value_proposition_completed,
  mou_completed,
  share_allocation_completed,
  created_at,
  updated_at
FROM public.business_documents
ORDER BY created_at DESC
LIMIT 10;

-- 4. Show documents with content preview
SELECT 
  id,
  business_profile_id,
  SUBSTRING(business_plan_content, 1, 50) as "Business Plan Preview",
  SUBSTRING(financial_projection_content, 1, 50) as "Financial Projection Preview",
  SUBSTRING(mou_content, 1, 50) as "MOU Preview",
  all_documents_completed,
  created_at
FROM public.business_documents
ORDER BY created_at DESC
LIMIT 10;

-- 5. Check documents by business profile (if you want to check specific profile)
-- Replace 'YOUR_PROFILE_ID_HERE' with actual UUID
-- SELECT * FROM public.business_documents 
-- WHERE business_profile_id = 'YOUR_PROFILE_ID_HERE';

-- 6. Check table structure
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' 
AND table_name = 'business_documents'
ORDER BY ordinal_position;

-- 7. Check if table has any RLS policies
SELECT schemaname, tablename, policyname, permissive, roles, qual, with_check
FROM pg_policies
WHERE tablename = 'business_documents';
