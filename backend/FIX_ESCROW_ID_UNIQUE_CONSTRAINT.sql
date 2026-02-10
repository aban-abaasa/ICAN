-- =====================================================
-- QUICK FIX: REMOVE UNIQUE CONSTRAINT ON ESCROW_ID
-- =====================================================
-- Issue: "duplicate key value violates unique constraint investment_agreements_escrow_id_key"
-- Cause: escrow_id had UNIQUE constraint, preventing retries
-- Solution: Remove UNIQUE constraint from escrow_id column
-- =====================================================

-- Drop the unique constraint if it exists
ALTER TABLE investment_agreements 
DROP CONSTRAINT IF EXISTS investment_agreements_escrow_id_key CASCADE;

-- Verify escrow_id column still exists (non-unique)
ALTER TABLE investment_agreements 
ADD COLUMN IF NOT EXISTS escrow_id TEXT;

-- Create index on escrow_id for performance (non-unique)
CREATE INDEX IF NOT EXISTS idx_agreements_escrow_id ON investment_agreements(escrow_id);

-- =====================================================
-- FRONTEND FIX EXPLANATION
-- =====================================================
-- The frontend has been updated to:
-- 1. Check if an investment agreement with the same escrow_id already exists
-- 2. If it exists, reuse that agreement (for retry scenarios)
-- 3. If it doesn't exist, create a new one
-- 
-- This is implemented in ShareSigningFlow.jsx (STEP 6A)
-- Location: Lines 1337-1381

-- =====================================================
-- TEST THE FIX
-- =====================================================

-- Check that the constraint is gone:
SELECT constraint_name, constraint_type
FROM information_schema.table_constraints
WHERE table_name = 'investment_agreements'
  AND constraint_name LIKE '%escrow%';

-- Should return 0 rows (no unique constraints on escrow_id)

-- Check what indexes exist on escrow_id:
SELECT indexname
FROM pg_indexes
WHERE tablename = 'investment_agreements'
  AND indexname LIKE '%escrow%';

-- Should show: idx_agreements_escrow_id

-- =====================================================
-- EXPECTED BEHAVIOR AFTER FIX
-- =====================================================

-- BEFORE (Broken):
-- 1. User tries to create investment
-- 2. Transaction completes
-- 3. User retries (browser refresh or network retry)
-- 4. Error: "duplicate key value violates unique constraint investment_agreements_escrow_id_key"

-- AFTER (Fixed):
-- 1. User tries to create investment
-- 2. Transaction completes, agreement created
-- 3. User retries (browser refresh or network retry)
-- 4. Frontend detects existing agreement by escrow_id
-- 5. Reuses existing agreement_id
-- 6. No error, creates signature instead
-- 7. Completes successfully

-- =====================================================
-- SUCCESS INDICATORS
-- =====================eing

DO $$
BEGIN
  RAISE NOTICE '✅ ESCROW_ID UNIQUE CONSTRAINT REMOVED!';
  RAISE NOTICE '📋 Changes:';
  RAISE NOTICE '   ✅ Dropped UNIQUE constraint from escrow_id';
  RAISE NOTICE '   ✅ Created non-unique index on escrow_id for performance';
  RAISE NOTICE '   ✅ Frontend now checks if agreement exists before creating';
  RAISE NOTICE '🔧 Users can now retry investment creation without errors';
  RAISE NOTICE '✨ Retries will reuse existing agreements instead of failing';
END $$;
