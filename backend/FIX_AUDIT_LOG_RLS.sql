-- ============================================
-- FIX AUDIT LOG RLS POLICIES
-- ============================================
-- Problem: ican_transaction_audit_log had no RLS INSERT policy
-- Result: DELETE triggers trying to log deletions got 403 Forbidden
-- Solution: Either add INSERT policy OR disable RLS on audit table

-- OPTION 1: Enable RLS and add permissive INSERT policy
-- (Allows trigger function to insert audit logs)
ALTER TABLE IF EXISTS ican_transaction_audit_log ENABLE ROW LEVEL SECURITY;

-- Drop old policies if they exist
DROP POLICY IF EXISTS "System can insert audit logs" ON ican_transaction_audit_log;
DROP POLICY IF EXISTS "Users can view their own audit logs" ON ican_transaction_audit_log;

-- Allow system/triggers to insert audit logs (permissive = allows action)
CREATE POLICY "System can insert audit logs"
    ON ican_transaction_audit_log FOR INSERT
    WITH CHECK (true);

-- Allow users to view their own audit logs
CREATE POLICY "Users can view their own audit logs"
    ON ican_transaction_audit_log FOR SELECT
    USING (auth.uid() = user_id OR user_id IS NULL);

-- ============================================
-- VERIFY SETUP
-- ============================================
-- After this script, verify:
-- 1. ican_transaction_audit_log has RLS enabled
-- 2. INSERT policy allows any authenticated insert (true)
-- 3. SELECT policy restricts to user's own logs

COMMIT;
