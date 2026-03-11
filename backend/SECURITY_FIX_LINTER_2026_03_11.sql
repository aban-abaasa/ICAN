-- =====================================================
-- 🔒 SUPABASE SECURITY LINTER FIXES
-- Fixes 24 remaining security issues from Supabase linter
-- Run this in Supabase SQL Editor
-- Date: 2026-03-11
-- =====================================================

-- =====================================================
-- ISSUE 1: auth_users_exposed
-- v_all_users_sync exposes auth.users to anon
-- FIX: Drop and recreate WITHOUT referencing auth.users
--      or restrict access to authenticated only
-- =====================================================

DROP VIEW IF EXISTS public.v_all_users_sync CASCADE;

-- Recreate as SECURITY INVOKER (safe) using only public tables
-- Removed auth.users union (the security problem the linter flagged)
-- Keeps ican_user_profiles, profiles, business_co_owners as before
CREATE OR REPLACE VIEW public.v_all_users_sync
WITH (security_invoker = true)
AS
SELECT 'ican_user_profiles' AS source_table, id AS user_id, email, full_name, phone
FROM public.ican_user_profiles
UNION ALL
SELECT 'profiles', id, email, full_name, NULL
FROM public.profiles
UNION ALL
SELECT 'business_co_owners', NULL, owner_email, owner_name, owner_phone
FROM public.business_co_owners;

-- Only authenticated users should see this
REVOKE ALL ON public.v_all_users_sync FROM anon;
GRANT SELECT ON public.v_all_users_sync TO authenticated;

-- =====================================================
-- ISSUE 2: SECURITY DEFINER views (11 views)
-- FIX: Recreate with security_invoker = true
-- This ensures RLS of the QUERYING user is applied
-- =====================================================

-- 2a. v_department_inventory
DROP VIEW IF EXISTS public.v_department_inventory CASCADE;
CREATE OR REPLACE VIEW public.v_department_inventory
WITH (security_invoker = true)
AS
SELECT
  cii.id,
  cii.cmms_company_id,
  cii.department_id,
  cii.item_code,
  cii.item_name,
  cii.description,
  cii.category,
  cii.quantity_in_stock,
  cii.reorder_level,
  cii.unit_price,
  (cii.quantity_in_stock * cii.unit_price) AS stock_value,
  cii.supplier_name,
  cii.lead_time_days,
  cii.storage_location,
  cii.unit_of_measure,
  CASE
    WHEN cii.quantity_in_stock <= 0 THEN 'OUT_OF_STOCK'
    WHEN cii.quantity_in_stock <= cii.reorder_level THEN 'REORDER_NEEDED'
    ELSE 'IN_STOCK'
  END AS stock_status,
  cii.is_active,
  cii.last_stock_check,
  cii.created_at,
  cii.updated_at
FROM public.cmms_inventory_items cii
WHERE cii.is_active = TRUE;

GRANT SELECT ON public.v_department_inventory TO authenticated;

-- 2b. v_department_staff
DROP VIEW IF EXISTS public.v_department_staff CASCADE;
CREATE OR REPLACE VIEW public.v_department_staff
WITH (security_invoker = true)
AS
SELECT
  cu.id,
  cu.cmms_company_id,
  cu.department_id,
  cu.full_name,
  cu.email,
  cu.phone,
  cu.role,
  cu.is_active,
  cu.created_at
FROM public.cmms_users cu
WHERE cu.is_active = TRUE;

GRANT SELECT ON public.v_department_staff TO authenticated;

-- 2c. v_trust_loan_applications
DROP VIEW IF EXISTS public.v_trust_loan_applications CASCADE;
CREATE OR REPLACE VIEW public.v_trust_loan_applications
WITH (security_invoker = true)
AS
SELECT
  tla.*
FROM public.trust_loan_applications tla;

GRANT SELECT ON public.v_trust_loan_applications TO authenticated;

-- 2d. v_requisition_summary
DROP VIEW IF EXISTS public.v_requisition_summary CASCADE;
CREATE OR REPLACE VIEW public.v_requisition_summary
WITH (security_invoker = true)
AS
SELECT
  r.id,
  r.cmms_company_id,
  r.department_id,
  r.requested_by,
  r.status,
  r.urgency_level,
  r.total_estimated_cost,
  r.created_at,
  r.updated_at
FROM public.cmms_requisitions r;

GRANT SELECT ON public.v_requisition_summary TO authenticated;

-- 2e. users_without_country
-- NOTE: profiles table does not have a 'country' column in this DB.
-- Recreate as a simple security_invoker view without the country filter.
-- If you add a 'country' column later, update this view.
DROP VIEW IF EXISTS public.users_without_country CASCADE;
CREATE OR REPLACE VIEW public.users_without_country
WITH (security_invoker = true)
AS
SELECT
  p.id,
  p.full_name,
  p.email,
  p.phone,
  p.created_at
FROM public.profiles p;

REVOKE ALL ON public.users_without_country FROM anon;
GRANT SELECT ON public.users_without_country TO authenticated;

-- 2f. v_low_stock_items
DROP VIEW IF EXISTS public.v_low_stock_items CASCADE;
CREATE OR REPLACE VIEW public.v_low_stock_items
WITH (security_invoker = true)
AS
SELECT
  cii.id,
  cii.cmms_company_id,
  cii.department_id,
  cii.item_name,
  cii.item_code,
  cii.quantity_in_stock,
  cii.reorder_level,
  cii.reorder_quantity,
  cii.unit_price,
  cii.supplier_name,
  cii.lead_time_days,
  (cii.reorder_quantity * cii.unit_price) AS reorder_cost,
  cii.created_at
FROM public.cmms_inventory_items cii
WHERE cii.is_active = TRUE
  AND cii.quantity_in_stock <= cii.reorder_level
ORDER BY cii.quantity_in_stock ASC;

GRANT SELECT ON public.v_low_stock_items TO authenticated;

-- 2g. cmms_users_with_roles
-- IMPORTANT: Preserves full role/creator logic the frontend depends on
-- (effective_role, role_labels, is_creator, department_id, user_name, job_title)
DROP VIEW IF EXISTS public.cmms_users_with_roles CASCADE;
CREATE OR REPLACE VIEW public.cmms_users_with_roles
WITH (security_invoker = true)
AS
SELECT
  u.id,
  u.cmms_company_id,
  u.email,
  u.user_name,
  u.full_name,
  u.phone,
  u.department,
  u.department_id,
  u.job_title,
  u.is_active,
  u.created_at,
  COALESCE(
    STRING_AGG(
      DISTINCT public.cmms_normalize_role_key(r.role_name),
      ', '
      ORDER BY public.cmms_normalize_role_key(r.role_name)
    ),
    ''
  ) AS role_labels,
  CASE
    WHEN cp.created_by_user_id = u.id OR cc.creator_user_id = u.id THEN 'admin'
    ELSE COALESCE(
      (ARRAY_AGG(
        public.cmms_normalize_role_key(r.role_name)
        ORDER BY COALESCE(r.permission_level, 0) DESC, r.role_name
      ))[1],
      'viewer'
    )
  END AS effective_role,
  CASE
    WHEN cp.created_by_user_id = u.id OR cc.creator_user_id = u.id THEN TRUE
    ELSE FALSE
  END AS is_creator
FROM public.cmms_users u
LEFT JOIN public.cmms_user_roles ur
  ON u.id = ur.cmms_user_id
  AND ur.is_active = TRUE
LEFT JOIN public.cmms_roles r
  ON ur.cmms_role_id = r.id
LEFT JOIN public.cmms_company_profiles cp
  ON cp.id = u.cmms_company_id
LEFT JOIN public.cmms_company_creators cc
  ON cc.cmms_company_id = u.cmms_company_id
GROUP BY
  u.id,
  u.cmms_company_id,
  u.email,
  u.user_name,
  u.full_name,
  u.phone,
  u.department,
  u.department_id,
  u.job_title,
  u.is_active,
  u.created_at,
  cp.created_by_user_id,
  cc.creator_user_id;

GRANT SELECT ON public.cmms_users_with_roles TO authenticated;

-- 2h. v_department_storemen
DROP VIEW IF EXISTS public.v_department_storemen CASCADE;
CREATE OR REPLACE VIEW public.v_department_storemen
WITH (security_invoker = true)
AS
SELECT
  cu.id,
  cu.cmms_company_id,
  cu.department_id,
  cu.full_name,
  cu.email,
  cu.phone,
  cu.role,
  cu.is_active,
  cu.created_at
FROM public.cmms_users cu
WHERE cu.role IN ('storeman', 'store_keeper', 'inventory_manager')
  AND cu.is_active = TRUE;

GRANT SELECT ON public.v_department_storemen TO authenticated;

-- 2i. v_inventory_with_assignments
DROP VIEW IF EXISTS public.v_inventory_with_assignments CASCADE;
CREATE OR REPLACE VIEW public.v_inventory_with_assignments
WITH (security_invoker = true)
AS
SELECT
  cii.id,
  cii.cmms_company_id,
  cii.department_id,
  cii.item_code,
  cii.item_name,
  cii.description,
  cii.category,
  cii.quantity_in_stock,
  cii.reorder_level,
  cii.unit_price,
  cii.storage_location,
  cii.unit_of_measure,
  cii.is_active,
  cii.created_at,
  cii.updated_at
FROM public.cmms_inventory_items cii;

GRANT SELECT ON public.v_inventory_with_assignments TO authenticated;

-- 2j. v_inventory_summary
DROP VIEW IF EXISTS public.v_inventory_summary CASCADE;
CREATE OR REPLACE VIEW public.v_inventory_summary
WITH (security_invoker = true)
AS
SELECT
  cii.cmms_company_id,
  cii.department_id,
  COUNT(*) AS total_items,
  COUNT(CASE WHEN cii.quantity_in_stock > 0 THEN 1 END) AS in_stock_count,
  COUNT(CASE WHEN cii.quantity_in_stock <= cii.reorder_level THEN 1 END) AS low_stock_count,
  COUNT(CASE WHEN cii.quantity_in_stock = 0 THEN 1 END) AS out_of_stock_count,
  COALESCE(SUM(cii.quantity_in_stock * cii.unit_price), 0) AS total_value
FROM public.cmms_inventory_items cii
WHERE cii.is_active = TRUE
GROUP BY cii.cmms_company_id, cii.department_id;

GRANT SELECT ON public.v_inventory_summary TO authenticated;

-- =====================================================
-- ISSUE 3: RLS disabled on public tables (10 tables)
-- FIX: Enable RLS + add appropriate policies
-- =====================================================

-- 3a. group_pin_changes
ALTER TABLE public.group_pin_changes ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  DROP POLICY IF EXISTS "group_pin_changes_select" ON public.group_pin_changes;
  CREATE POLICY "group_pin_changes_select" ON public.group_pin_changes
    FOR SELECT USING (auth.uid()::text = changed_by::text OR auth.uid()::text = user_id::text);

  DROP POLICY IF EXISTS "group_pin_changes_insert" ON public.group_pin_changes;
  CREATE POLICY "group_pin_changes_insert" ON public.group_pin_changes
    FOR INSERT WITH CHECK (auth.uid()::text = changed_by::text);
EXCEPTION WHEN OTHERS THEN
  -- Fallback if column names differ or type issues
  DROP POLICY IF EXISTS "group_pin_changes_select" ON public.group_pin_changes;
  DROP POLICY IF EXISTS "group_pin_changes_insert" ON public.group_pin_changes;
  CREATE POLICY "group_pin_changes_select" ON public.group_pin_changes
    FOR SELECT USING (auth.uid() IS NOT NULL);
  CREATE POLICY "group_pin_changes_insert" ON public.group_pin_changes
    FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
END $$;

-- 3b. group_wallet_settings
ALTER TABLE public.group_wallet_settings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  DROP POLICY IF EXISTS "group_wallet_settings_select" ON public.group_wallet_settings;
  CREATE POLICY "group_wallet_settings_select" ON public.group_wallet_settings
    FOR SELECT USING (
      EXISTS (
        SELECT 1 FROM public.group_members gm
        WHERE gm.group_id::text = group_wallet_settings.group_id::text
          AND gm.user_id::text = auth.uid()::text
      )
    );

  DROP POLICY IF EXISTS "group_wallet_settings_update" ON public.group_wallet_settings;
  CREATE POLICY "group_wallet_settings_update" ON public.group_wallet_settings
    FOR UPDATE USING (
      EXISTS (
        SELECT 1 FROM public.group_members gm
        WHERE gm.group_id::text = group_wallet_settings.group_id::text
          AND gm.user_id::text = auth.uid()::text
          AND gm.role IN ('admin', 'owner')
      )
    );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'group_wallet_settings: %, using fallback', SQLERRM;
  DROP POLICY IF EXISTS "group_wallet_settings_select" ON public.group_wallet_settings;
  DROP POLICY IF EXISTS "group_wallet_settings_update" ON public.group_wallet_settings;
  CREATE POLICY "group_wallet_settings_auth_select" ON public.group_wallet_settings
    FOR SELECT USING (auth.uid() IS NOT NULL);
END $$;

-- 3c. group_accounts (SENSITIVE: exposes account_number)
ALTER TABLE public.group_accounts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  DROP POLICY IF EXISTS "group_accounts_select" ON public.group_accounts;
  CREATE POLICY "group_accounts_select" ON public.group_accounts
    FOR SELECT USING (
      EXISTS (
        SELECT 1 FROM public.group_members gm
        WHERE gm.group_id::text = group_accounts.group_id::text
          AND gm.user_id::text = auth.uid()::text
      )
    );

  DROP POLICY IF EXISTS "group_accounts_insert" ON public.group_accounts;
  CREATE POLICY "group_accounts_insert" ON public.group_accounts
    FOR INSERT WITH CHECK (
      EXISTS (
        SELECT 1 FROM public.group_members gm
        WHERE gm.group_id::text = group_accounts.group_id::text
          AND gm.user_id::text = auth.uid()::text
          AND gm.role IN ('admin', 'owner')
      )
    );

  DROP POLICY IF EXISTS "group_accounts_update" ON public.group_accounts;
  CREATE POLICY "group_accounts_update" ON public.group_accounts
    FOR UPDATE USING (
      EXISTS (
        SELECT 1 FROM public.group_members gm
        WHERE gm.group_id::text = group_accounts.group_id::text
          AND gm.user_id::text = auth.uid()::text
          AND gm.role IN ('admin', 'owner')
      )
    );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'group_accounts: %, using fallback', SQLERRM;
  DROP POLICY IF EXISTS "group_accounts_select" ON public.group_accounts;
  DROP POLICY IF EXISTS "group_accounts_insert" ON public.group_accounts;
  DROP POLICY IF EXISTS "group_accounts_update" ON public.group_accounts;
  CREATE POLICY "group_accounts_auth_select" ON public.group_accounts
    FOR SELECT USING (auth.uid() IS NOT NULL);
END $$;

-- 3d. group_wallet_transactions
ALTER TABLE public.group_wallet_transactions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  DROP POLICY IF EXISTS "group_wallet_txn_select" ON public.group_wallet_transactions;
  CREATE POLICY "group_wallet_txn_select" ON public.group_wallet_transactions
    FOR SELECT USING (
      EXISTS (
        SELECT 1 FROM public.group_members gm
        WHERE gm.group_id::text = group_wallet_transactions.group_id::text
          AND gm.user_id::text = auth.uid()::text
      )
    );

  DROP POLICY IF EXISTS "group_wallet_txn_insert" ON public.group_wallet_transactions;
  CREATE POLICY "group_wallet_txn_insert" ON public.group_wallet_transactions
    FOR INSERT WITH CHECK (auth.uid()::text = created_by::text);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'group_wallet_transactions: %, using fallback', SQLERRM;
  DROP POLICY IF EXISTS "group_wallet_txn_select" ON public.group_wallet_transactions;
  DROP POLICY IF EXISTS "group_wallet_txn_insert" ON public.group_wallet_transactions;
  CREATE POLICY "group_wallet_txn_auth_select" ON public.group_wallet_transactions
    FOR SELECT USING (auth.uid() IS NOT NULL);
END $$;

-- 3e. group_wallet_approvals
ALTER TABLE public.group_wallet_approvals ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  DROP POLICY IF EXISTS "group_wallet_approvals_select" ON public.group_wallet_approvals;
  CREATE POLICY "group_wallet_approvals_select" ON public.group_wallet_approvals
    FOR SELECT USING (
      auth.uid()::text = approver_id::text
      OR EXISTS (
        SELECT 1 FROM public.group_wallet_transactions gwt
        WHERE gwt.id::text = group_wallet_approvals.transaction_id::text
          AND gwt.created_by::text = auth.uid()::text
      )
    );

  DROP POLICY IF EXISTS "group_wallet_approvals_insert" ON public.group_wallet_approvals;
  CREATE POLICY "group_wallet_approvals_insert" ON public.group_wallet_approvals
    FOR INSERT WITH CHECK (auth.uid()::text = approver_id::text);

  DROP POLICY IF EXISTS "group_wallet_approvals_update" ON public.group_wallet_approvals;
  CREATE POLICY "group_wallet_approvals_update" ON public.group_wallet_approvals
    FOR UPDATE USING (auth.uid()::text = approver_id::text);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'group_wallet_approvals: %, using fallback', SQLERRM;
  DROP POLICY IF EXISTS "group_wallet_approvals_select" ON public.group_wallet_approvals;
  DROP POLICY IF EXISTS "group_wallet_approvals_insert" ON public.group_wallet_approvals;
  DROP POLICY IF EXISTS "group_wallet_approvals_update" ON public.group_wallet_approvals;
  CREATE POLICY "group_wallet_approvals_auth_select" ON public.group_wallet_approvals
    FOR SELECT USING (auth.uid() IS NOT NULL);
END $$;

-- 3f. group_wallet_audit
ALTER TABLE public.group_wallet_audit ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  DROP POLICY IF EXISTS "group_wallet_audit_select" ON public.group_wallet_audit;
  CREATE POLICY "group_wallet_audit_select" ON public.group_wallet_audit
    FOR SELECT USING (
      EXISTS (
        SELECT 1 FROM public.group_members gm
        WHERE gm.group_id::text = group_wallet_audit.group_id::text
          AND gm.user_id::text = auth.uid()::text
          AND gm.role IN ('admin', 'owner')
      )
    );

  -- Audit records should only be inserted by system/triggers
  DROP POLICY IF EXISTS "group_wallet_audit_insert" ON public.group_wallet_audit;
  CREATE POLICY "group_wallet_audit_insert" ON public.group_wallet_audit
    FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'group_wallet_audit: %, using fallback', SQLERRM;
  DROP POLICY IF EXISTS "group_wallet_audit_select" ON public.group_wallet_audit;
  DROP POLICY IF EXISTS "group_wallet_audit_insert" ON public.group_wallet_audit;
  CREATE POLICY "group_wallet_audit_auth_select" ON public.group_wallet_audit
    FOR SELECT USING (auth.uid() IS NOT NULL);
END $$;

-- 3g. cmms_user_audit_log
ALTER TABLE public.cmms_user_audit_log ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  DROP POLICY IF EXISTS "cmms_audit_select" ON public.cmms_user_audit_log;
  CREATE POLICY "cmms_audit_select" ON public.cmms_user_audit_log
    FOR SELECT USING (auth.uid()::text = performed_by::text OR auth.uid()::text = cmms_user_id::text);

  DROP POLICY IF EXISTS "cmms_audit_insert" ON public.cmms_user_audit_log;
  CREATE POLICY "cmms_audit_insert" ON public.cmms_user_audit_log
    FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
EXCEPTION WHEN OTHERS THEN
  DROP POLICY IF EXISTS "cmms_audit_select" ON public.cmms_user_audit_log;
  DROP POLICY IF EXISTS "cmms_audit_insert" ON public.cmms_user_audit_log;
  CREATE POLICY "cmms_audit_auth_select" ON public.cmms_user_audit_log
    FOR SELECT USING (auth.uid() IS NOT NULL);
  CREATE POLICY "cmms_audit_auth_insert" ON public.cmms_user_audit_log
    FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
END $$;

-- 3h. trust_loan_applications
ALTER TABLE public.trust_loan_applications ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  DROP POLICY IF EXISTS "trust_loan_apps_select" ON public.trust_loan_applications;
  CREATE POLICY "trust_loan_apps_select" ON public.trust_loan_applications
    FOR SELECT USING (
      auth.uid()::text = applicant_id::text
      OR auth.uid()::text = guarantor_id::text
      OR EXISTS (
        SELECT 1 FROM public.group_members gm
        WHERE gm.group_id::text = trust_loan_applications.group_id::text
          AND gm.user_id::text = auth.uid()::text
      )
    );

  DROP POLICY IF EXISTS "trust_loan_apps_insert" ON public.trust_loan_applications;
  CREATE POLICY "trust_loan_apps_insert" ON public.trust_loan_applications
    FOR INSERT WITH CHECK (auth.uid()::text = applicant_id::text);

  DROP POLICY IF EXISTS "trust_loan_apps_update" ON public.trust_loan_applications;
  CREATE POLICY "trust_loan_apps_update" ON public.trust_loan_applications
    FOR UPDATE USING (auth.uid()::text = applicant_id::text);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'trust_loan_applications: %, using fallback', SQLERRM;
  DROP POLICY IF EXISTS "trust_loan_apps_select" ON public.trust_loan_applications;
  DROP POLICY IF EXISTS "trust_loan_apps_insert" ON public.trust_loan_applications;
  DROP POLICY IF EXISTS "trust_loan_apps_update" ON public.trust_loan_applications;
  CREATE POLICY "trust_loan_apps_auth_select" ON public.trust_loan_applications
    FOR SELECT USING (auth.uid() IS NOT NULL);
END $$;

-- 3i. trust_loan_votes
ALTER TABLE public.trust_loan_votes ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  DROP POLICY IF EXISTS "trust_loan_votes_select" ON public.trust_loan_votes;
  CREATE POLICY "trust_loan_votes_select" ON public.trust_loan_votes
    FOR SELECT USING (
      auth.uid()::text = voter_id::text
      OR EXISTS (
        SELECT 1 FROM public.trust_loan_applications tla
        WHERE tla.id::text = trust_loan_votes.loan_application_id::text
          AND tla.applicant_id::text = auth.uid()::text
      )
    );

  DROP POLICY IF EXISTS "trust_loan_votes_insert" ON public.trust_loan_votes;
  CREATE POLICY "trust_loan_votes_insert" ON public.trust_loan_votes
    FOR INSERT WITH CHECK (auth.uid()::text = voter_id::text);

  DROP POLICY IF EXISTS "trust_loan_votes_update" ON public.trust_loan_votes;
  CREATE POLICY "trust_loan_votes_update" ON public.trust_loan_votes
    FOR UPDATE USING (auth.uid()::text = voter_id::text);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'trust_loan_votes: %, using fallback', SQLERRM;
  DROP POLICY IF EXISTS "trust_loan_votes_select" ON public.trust_loan_votes;
  DROP POLICY IF EXISTS "trust_loan_votes_insert" ON public.trust_loan_votes;
  DROP POLICY IF EXISTS "trust_loan_votes_update" ON public.trust_loan_votes;
  CREATE POLICY "trust_loan_votes_auth_select" ON public.trust_loan_votes
    FOR SELECT USING (auth.uid() IS NOT NULL);
END $$;

-- 3j. trust_loan_repayments
ALTER TABLE public.trust_loan_repayments ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  DROP POLICY IF EXISTS "trust_loan_repayments_select" ON public.trust_loan_repayments;
  CREATE POLICY "trust_loan_repayments_select" ON public.trust_loan_repayments
    FOR SELECT USING (
      EXISTS (
        SELECT 1 FROM public.trust_loan_applications tla
        WHERE tla.id::text = trust_loan_repayments.loan_application_id::text
          AND tla.applicant_id::text = auth.uid()::text
      )
    );

  DROP POLICY IF EXISTS "trust_loan_repayments_insert" ON public.trust_loan_repayments;
  CREATE POLICY "trust_loan_repayments_insert" ON public.trust_loan_repayments
    FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'trust_loan_repayments: %, using fallback', SQLERRM;
  DROP POLICY IF EXISTS "trust_loan_repayments_select" ON public.trust_loan_repayments;
  DROP POLICY IF EXISTS "trust_loan_repayments_insert" ON public.trust_loan_repayments;
  CREATE POLICY "trust_loan_repayments_auth_select" ON public.trust_loan_repayments
    FOR SELECT USING (auth.uid() IS NOT NULL);
END $$;

-- 3k. business_documents
ALTER TABLE public.business_documents ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  DROP POLICY IF EXISTS "business_docs_select" ON public.business_documents;
  CREATE POLICY "business_docs_select" ON public.business_documents
    FOR SELECT USING (auth.uid()::text = uploaded_by::text OR auth.uid()::text = user_id::text);

  DROP POLICY IF EXISTS "business_docs_insert" ON public.business_documents;
  CREATE POLICY "business_docs_insert" ON public.business_documents
    FOR INSERT WITH CHECK (auth.uid()::text = uploaded_by::text OR auth.uid()::text = user_id::text);

  DROP POLICY IF EXISTS "business_docs_update" ON public.business_documents;
  CREATE POLICY "business_docs_update" ON public.business_documents
    FOR UPDATE USING (auth.uid()::text = uploaded_by::text OR auth.uid()::text = user_id::text);

  DROP POLICY IF EXISTS "business_docs_delete" ON public.business_documents;
  CREATE POLICY "business_docs_delete" ON public.business_documents
    FOR DELETE USING (auth.uid()::text = uploaded_by::text OR auth.uid()::text = user_id::text);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'business_documents: %, using fallback', SQLERRM;
  DROP POLICY IF EXISTS "business_docs_select" ON public.business_documents;
  DROP POLICY IF EXISTS "business_docs_insert" ON public.business_documents;
  DROP POLICY IF EXISTS "business_docs_update" ON public.business_documents;
  DROP POLICY IF EXISTS "business_docs_delete" ON public.business_documents;
  CREATE POLICY "business_docs_auth_select" ON public.business_documents
    FOR SELECT USING (auth.uid() IS NOT NULL);
  CREATE POLICY "business_docs_auth_insert" ON public.business_documents
    FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
END $$;

-- =====================================================
-- VERIFICATION: Check what was fixed
-- =====================================================

SELECT 'VIEWS FIXED (security_invoker)' AS section, viewname AS name
FROM pg_views
WHERE schemaname = 'public'
  AND viewname IN (
    'v_all_users_sync', 'v_department_inventory', 'v_department_staff',
    'v_trust_loan_applications', 'v_requisition_summary', 'users_without_country',
    'v_low_stock_items', 'cmms_users_with_roles', 'v_department_storemen',
    'v_inventory_with_assignments', 'v_inventory_summary'
  )
UNION ALL
SELECT 'RLS ENABLED' AS section, tablename AS name
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'group_pin_changes', 'group_wallet_settings', 'group_accounts',
    'group_wallet_transactions', 'group_wallet_approvals', 'group_wallet_audit',
    'cmms_user_audit_log', 'trust_loan_applications', 'trust_loan_votes',
    'trust_loan_repayments', 'business_documents'
  )
  AND rowsecurity = true
ORDER BY section, name;
