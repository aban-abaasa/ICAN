/**
 * 🔒 Force Apply RLS to Remaining Tables
 * Drops existing policies and re-applies from scratch
 */

-- =====================================================
-- PART 1: Drop Existing Policies
-- =====================================================

DROP POLICY IF EXISTS "Users can view own Firebase synced transactions" ON public.firebase_transactions_sync;

DROP POLICY IF EXISTS "Users can view own profile" ON public.cmms_users;

DROP POLICY IF EXISTS "Users can view own role" ON public.cmms_user_roles;

DROP POLICY IF EXISTS "Users can view own audit logs" ON public.cmms_user_audit_log;
DROP POLICY IF EXISTS "Admins can view audit logs for their company" ON public.cmms_user_audit_log;

DROP POLICY IF EXISTS "Users can view own notifications" ON public.cmms_notification_audit;

-- =====================================================
-- PART 2: Disable and Re-enable RLS with Fresh Policies
-- =====================================================

-- firebase_transactions_sync
ALTER TABLE IF EXISTS public.firebase_transactions_sync DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.firebase_transactions_sync ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own Firebase synced transactions"
  ON public.firebase_transactions_sync
  FOR SELECT
  USING (auth.uid()::text = user_id);

-- cmms_users
ALTER TABLE IF EXISTS public.cmms_users DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.cmms_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile"
  ON public.cmms_users
  FOR SELECT
  USING (auth.uid()::text = user_id);

-- cmms_user_roles
ALTER TABLE IF EXISTS public.cmms_user_roles DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.cmms_user_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own role"
  ON public.cmms_user_roles
  FOR SELECT
  USING (user_id = auth.uid()::text);

-- cmms_user_audit_log
ALTER TABLE IF EXISTS public.cmms_user_audit_log DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.cmms_user_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own audit logs"
  ON public.cmms_user_audit_log
  FOR SELECT
  USING (user_id = auth.uid()::text);

-- cmms_notification_audit
ALTER TABLE IF EXISTS public.cmms_notification_audit DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.cmms_notification_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own notifications"
  ON public.cmms_notification_audit
  FOR SELECT
  USING (user_id = auth.uid()::text);

-- =====================================================
-- PART 3: Verify RLS Status
-- =====================================================

SELECT 
  schemaname,
  tablename,
  rowsecurity as "RLS Enabled"
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'firebase_transactions_sync',
    'cmms_users',
    'cmms_user_roles',
    'cmms_user_audit_log',
    'cmms_notification_audit'
  )
ORDER BY tablename;

-- =====================================================
-- PART 4: Verify Policies Created
-- =====================================================

SELECT 
  schemaname,
  tablename,
  policyname,
  qual as policy_expression
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'firebase_transactions_sync',
    'cmms_users',
    'cmms_user_roles',
    'cmms_user_audit_log',
    'cmms_notification_audit'
  )
ORDER BY tablename, policyname;
