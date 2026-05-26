-- ============================================================================
-- TRANSACTION DATA CLEANUP QUERIES
-- ============================================================================
-- Purpose: Support data cleanup and deletion operations for the ICAN app
-- Security: All queries respect RLS (Row Level Security) - user_id = auth.uid()
-- Note: Use with caution - data deletion is permanent
-- ============================================================================

-- ============================================================================
-- 1. DELETE ALL TRANSACTIONS FOR A USER
-- ============================================================================
-- Use Case: User wants to completely clear their transaction history
-- RLS Protection: Only users can delete their own transactions
-- Returns: Count of deleted transactions

-- CORRECT APPROACH: Use CTE to count before deletion
WITH deleted_rows AS (
  DELETE FROM ican_transactions
  WHERE user_id = auth.uid()
  RETURNING id
)
SELECT COUNT(*) as deleted_count FROM deleted_rows;

-- ============================================================================
-- 2. DELETE TRANSACTIONS BY DATE RANGE
-- ============================================================================
-- Use Case: Clean up old data within a specific period
-- Parameters: Replace dates with ISO format (YYYY-MM-DD)
-- Example below deletes transactions from Jan 1 to Dec 31, 2024

WITH deleted_rows AS (
  DELETE FROM ican_transactions
  WHERE user_id = auth.uid()
    AND created_at >= '2024-01-01'::timestamp
    AND created_at <= '2024-12-31'::timestamp
  RETURNING id
)
SELECT COUNT(*) as deleted_count FROM deleted_rows;

-- FOR OTHER DATE RANGES: Replace the dates above with your desired range
-- Examples:
-- AND created_at >= '2025-01-01'::timestamp AND created_at <= '2025-03-31'::timestamp  -- Q1 2025
-- AND created_at >= '2024-01-01'::timestamp AND created_at <= '2024-06-30'::timestamp  -- H1 2024

-- ============================================================================
-- 3. DELETE TRANSACTIONS BY TYPE
-- ============================================================================
-- Use Case: Delete specific transaction types (expense, income, transfer, loan)
-- Parameters: Replace 'expense' with: 'income', 'transfer', 'loan', etc.

WITH deleted_rows AS (
  DELETE FROM ican_transactions
  WHERE user_id = auth.uid()
    AND transaction_type = 'expense'
  RETURNING id
)
SELECT COUNT(*) as deleted_count FROM deleted_rows;

-- FOR OTHER TYPES: Replace 'expense' with:
-- 'income' - Delete all income transactions
-- 'transfer' - Delete all transfers
-- 'loan' - Delete all loan transactions

-- ============================================================================
-- 4. DELETE TRANSACTIONS BY CATEGORY
-- ============================================================================
-- Use Case: Clean up transactions in a specific category
-- Parameters: Replace 'Food' with your actual category from metadata
-- Note: Category is stored in the metadata JSON field

WITH deleted_rows AS (
  DELETE FROM ican_transactions
  WHERE user_id = auth.uid()
    AND metadata->>'category' = 'Food'
  RETURNING id
)
SELECT COUNT(*) as deleted_count FROM deleted_rows;

-- FOR OTHER CATEGORIES: Replace 'Food' with:
-- 'Groceries', 'Transport', 'Entertainment', 'Utilities', 'Healthcare', etc.

-- ============================================================================
-- 5. DELETE TRANSACTIONS OLDER THAN X DAYS
-- ============================================================================
-- Use Case: Auto-cleanup of old transactions (e.g., older than 90 days)
-- Parameters: Replace '90' with number of days to keep

WITH deleted_rows AS (
  DELETE FROM ican_transactions
  WHERE user_id = auth.uid()
    AND created_at < NOW() - INTERVAL '90 days'
  RETURNING id
)
SELECT COUNT(*) as deleted_count FROM deleted_rows;

-- ============================================================================
-- 6. DELETE OFFLINE-SYNCED TRANSACTIONS
-- ============================================================================
-- Use Case: Clean up temporary offline sync test data
-- Note: Targets transactions created via offline sync feature

WITH deleted_rows AS (
  DELETE FROM ican_transactions
  WHERE user_id = auth.uid()
    AND (metadata->>'synced_from_offline' = 'true'
         OR metadata->>'source' = 'offline_sync')
  RETURNING id
)
SELECT COUNT(*) as deleted_count FROM deleted_rows;

-- ============================================================================
-- 7. DELETE DUPLICATE TRANSACTIONS
-- ============================================================================
-- Use Case: Clean up accidental duplicate entries within same second
-- Note: Keeps the oldest one, deletes newer duplicates

WITH deleted_rows AS (
  DELETE FROM ican_transactions
  WHERE user_id = auth.uid()
    AND id NOT IN (
      SELECT DISTINCT ON (amount, transaction_type, created_at::date) id
      FROM ican_transactions
      WHERE user_id = auth.uid()
      ORDER BY amount, transaction_type, created_at::date, created_at ASC
    )
  RETURNING id
)
SELECT COUNT(*) as deleted_count FROM deleted_rows;

-- ============================================================================
-- 8. DELETE LOW-CONFIDENCE TRANSACTIONS
-- ============================================================================
-- Use Case: Clean up AI-parsed transactions with low confidence scores
-- Parameters: Replace '0.5' with confidence threshold (0-1)
-- Note: Confidence is stored in the metadata JSON field

WITH deleted_rows AS (
  DELETE FROM ican_transactions
  WHERE user_id = auth.uid()
    AND (metadata->>'confidence')::float < 0.5
    AND metadata->>'confidence' IS NOT NULL
  RETURNING id
)
SELECT COUNT(*) as deleted_count FROM deleted_rows;

-- ============================================================================
-- 9. SOFT DELETE - MARK TRANSACTIONS AS DELETED
-- ============================================================================
-- Use Case: Archive transactions without permanent deletion (reversible)
-- SETUP REQUIRED: Run this ALTER TABLE first to add the deleted_at column

-- Step 1: Add the deleted_at column (run once)
ALTER TABLE ican_transactions ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;

-- Step 2: Mark transactions as deleted (instead of permanently deleting)
WITH updated_rows AS (
  UPDATE ican_transactions
  SET deleted_at = NOW()
  WHERE user_id = auth.uid()
    AND deleted_at IS NULL
  RETURNING id
)
SELECT COUNT(*) as marked_deleted FROM updated_rows;

-- Step 3: Then filter out deleted transactions in all future queries:
-- SELECT * FROM ican_transactions
-- WHERE user_id = auth.uid()
--   AND deleted_at IS NULL;

-- ============================================================================
-- 10. GET TRANSACTION DELETION STATS BEFORE CLEANUP
-- ============================================================================
-- Use Case: Preview what will be deleted before executing deletion
-- Run this first to confirm counts

-- Count all transactions
SELECT COUNT(*) as total_transactions
FROM ican_transactions
WHERE user_id = auth.uid();

-- Count by type
SELECT transaction_type, COUNT(*) as count
FROM ican_transactions
WHERE user_id = auth.uid()
GROUP BY transaction_type;

-- Count by age
SELECT 
  'Last 7 days' as period, COUNT(*) as count
  FROM ican_transactions
  WHERE user_id = auth.uid()
    AND created_at >= NOW() - INTERVAL '7 days'
UNION ALL
SELECT 
  'Last 30 days', COUNT(*)
  FROM ican_transactions
  WHERE user_id = auth.uid()
    AND created_at >= NOW() - INTERVAL '30 days'
UNION ALL
SELECT 
  'Last 90 days', COUNT(*)
  FROM ican_transactions
  WHERE user_id = auth.uid()
    AND created_at >= NOW() - INTERVAL '90 days'
UNION ALL
SELECT 
  'Older than 90 days', COUNT(*)
  FROM ican_transactions
  WHERE user_id = auth.uid()
    AND created_at < NOW() - INTERVAL '90 days';

-- Count by confidence
SELECT 
  CASE 
    WHEN (metadata->>'confidence')::float >= 0.9 THEN 'High (90-100%)'
    WHEN (metadata->>'confidence')::float >= 0.7 THEN 'Medium (70-89%)'
    WHEN (metadata->>'confidence')::float >= 0.5 THEN 'Low (50-69%)'
    ELSE 'Very Low (<50%)'
  END as confidence_level,
  COUNT(*) as count
FROM ican_transactions
WHERE user_id = auth.uid()
  AND metadata->>'confidence' IS NOT NULL
GROUP BY confidence_level;

-- ============================================================================
-- 11. CLEANUP FUNCTION (PostgreSQL)
-- ============================================================================
-- Purpose: Reusable function for safe transaction cleanup
-- Usage: SELECT cleanup_user_transactions('all');
--        SELECT cleanup_user_transactions('old', 90);
--        SELECT cleanup_user_transactions('type', 'expense');

CREATE OR REPLACE FUNCTION cleanup_user_transactions(
  cleanup_type TEXT DEFAULT 'all',
  param INT DEFAULT NULL,
  param_text TEXT DEFAULT NULL
)
RETURNS TABLE (deleted_count INT, message TEXT) AS $$
DECLARE
  _deleted INT;
BEGIN
  -- Clean all transactions
  IF cleanup_type = 'all' THEN
    DELETE FROM ican_transactions WHERE user_id = auth.uid();
    GET DIAGNOSTICS _deleted = ROW_COUNT;
    RETURN QUERY SELECT _deleted, 'All transactions deleted';
  
  -- Clean old transactions
  ELSIF cleanup_type = 'old' THEN
    DELETE FROM ican_transactions
    WHERE user_id = auth.uid()
      AND created_at < NOW() - (param || ' days')::INTERVAL;
    GET DIAGNOSTICS _deleted = ROW_COUNT;
    RETURN QUERY SELECT _deleted, 'Transactions older than ' || param || ' days deleted';
  
  -- Clean by type
  ELSIF cleanup_type = 'type' THEN
    DELETE FROM ican_transactions
    WHERE user_id = auth.uid()
      AND transaction_type = param_text;
    GET DIAGNOSTICS _deleted = ROW_COUNT;
    RETURN QUERY SELECT _deleted, 'All ' || param_text || ' transactions deleted';
  
  -- Clean offline synced
  ELSIF cleanup_type = 'offline' THEN
    DELETE FROM ican_transactions
    WHERE user_id = auth.uid()
      AND metadata->>'synced_from_offline' = 'true';
    GET DIAGNOSTICS _deleted = ROW_COUNT;
    RETURN QUERY SELECT _deleted, 'Offline synced transactions deleted';
  
  -- Low confidence
  ELSIF cleanup_type = 'low_confidence' THEN
    DELETE FROM ican_transactions
    WHERE user_id = auth.uid()
      AND (metadata->>'confidence')::float < (param::FLOAT / 100);
    GET DIAGNOSTICS _deleted = ROW_COUNT;
    RETURN QUERY SELECT _deleted, 'Transactions with <' || param || '% confidence deleted';
  
  ELSE
    RETURN QUERY SELECT 0, 'Unknown cleanup type: ' || cleanup_type;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 12. AUDIT LOG - TRACK DELETIONS
-- ============================================================================
-- Purpose: Create audit log of all transaction deletions
-- Setup: Create this table once

CREATE TABLE IF NOT EXISTS ican_transaction_audit_log (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id),
  action TEXT NOT NULL, -- 'delete', 'soft_delete', 'restore'
  transaction_ids JSONB, -- Array of deleted transaction IDs
  deleted_count INT,
  cleanup_type TEXT, -- 'all', 'old', 'type', etc.
  reason TEXT,
  deleted_at TIMESTAMP DEFAULT NOW(),
  restored_at TIMESTAMP
);

-- Log deletions trigger
CREATE OR REPLACE FUNCTION log_transaction_deletion()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO ican_transaction_audit_log 
    (user_id, action, deleted_count, deleted_at)
  VALUES 
    (OLD.user_id, 'delete', 1, NOW());
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ican_transaction_delete_log
AFTER DELETE ON ican_transactions
FOR EACH ROW
EXECUTE FUNCTION log_transaction_deletion();

-- ============================================================================
-- USAGE EXAMPLES
-- ============================================================================

-- Example 1: Delete all transactions (CAUTION!)
-- DELETE FROM ican_transactions WHERE user_id = auth.uid();

-- Example 2: Delete only expense transactions
-- DELETE FROM ican_transactions 
-- WHERE user_id = auth.uid() 
--   AND transaction_type = 'expense';

-- Example 3: Delete transactions older than 6 months
-- DELETE FROM ican_transactions
-- WHERE user_id = auth.uid()
--   AND created_at < NOW() - INTERVAL '6 months';

-- Example 4: Delete low-confidence AI parsed transactions
-- WITH deleted_rows AS (
--   DELETE FROM ican_transactions
--   WHERE user_id = auth.uid()
--     AND (metadata->>'confidence')::float < 0.5
--   RETURNING id
-- )
-- SELECT COUNT(*) as deleted_count FROM deleted_rows;

-- Example 5: Check what will be deleted before cleanup
-- SELECT COUNT(*), transaction_type, DATE(created_at)
-- FROM ican_transactions
-- WHERE user_id = auth.uid()
--   AND created_at < NOW() - INTERVAL '90 days'
-- GROUP BY transaction_type, DATE(created_at);

-- ============================================================================
-- SECURITY NOTES
-- ============================================================================
-- ✅ All queries use auth.uid() - RLS ensures users only delete their own data
-- ✅ Queries respect Supabase RLS policies automatically
-- ✅ RETURNING clause shows affected row count for confirmation
-- ✅ Always run COUNT/preview query first before deletion
-- ✅ Consider soft deletes (timestamp) before hard deletes for recoverability
-- ⚠️  Data deletion is permanent - backups recommended
-- ⚠️  Large batch deletes may take time - consider pagination
-- ============================================================================
