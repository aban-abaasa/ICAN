-- Check member_approvals table structure

-- Step 1: List all columns in member_approvals
SELECT 
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns 
WHERE table_name = 'member_approvals'
ORDER BY ordinal_position;

-- Step 2: Check if approval_status column exists
SELECT 
  COUNT(*) as column_exists
FROM information_schema.columns 
WHERE table_name = 'member_approvals' 
AND column_name = 'approval_status';

-- Step 3: Add missing approval_status column if it doesn't exist
ALTER TABLE member_approvals
ADD COLUMN IF NOT EXISTS approval_status VARCHAR(50) DEFAULT 'pending';

-- Step 4: Verify column was added
SELECT 
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns 
WHERE table_name = 'member_approvals'
ORDER BY ordinal_position;

-- Step 5: Check data in member_approvals
SELECT COUNT(*) as total_records FROM member_approvals;
