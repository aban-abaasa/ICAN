-- ============================================================
-- CMMS Activity Dashboard -- company-wide activity feed + a single
-- summary RPC for the home-screen "CMMS Activity" widget
-- ============================================================
-- cmms_notifications (see CMMS_NOTIFICATIONS_TABLE.sql) is scoped to a
-- single recipient (RLS: cmms_user_id = caller), so it can't power a
-- company-wide "everything happening in the CMMS" feed. This file adds
-- a real company-wide activity_log table plus one RPC that returns the
-- whole home-screen widget's data (departments/users/inventory health,
-- pending & urgent requisitions, recent activity) in a single round
-- trip, which matters on the Supabase Free Plan.
--
-- Run after: CMMS_RLS_POLICIES.sql (reuses its helper functions),
-- CMMS_DEPARTMENT_INVENTORY_REQUISITIONS.sql, CMMS_INVENTORY_COMPLETE_SCHEMA.sql.
-- Safe to run more than once.
-- ============================================================

-- ============================================================
-- 1. TABLE: cmms_activity_log
-- ============================================================
CREATE TABLE IF NOT EXISTS public.cmms_activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cmms_company_id UUID NOT NULL REFERENCES public.cmms_company_profiles(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES public.cmms_users(id) ON DELETE SET NULL,
  actor_name VARCHAR(255),
  activity_type VARCHAR(50) NOT NULL,
  description TEXT NOT NULL,
  icon VARCHAR(10) DEFAULT '📋',
  entity_type VARCHAR(50),
  entity_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cmms_activity_log_company_created
  ON public.cmms_activity_log(cmms_company_id, created_at DESC);

ALTER TABLE public.cmms_activity_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow_view_company_activity" ON public.cmms_activity_log;
CREATE POLICY "allow_view_company_activity" ON public.cmms_activity_log
  FOR SELECT
  USING (
    auth.role() = 'authenticated' AND
    public.cmms_current_user_id_for_company(cmms_company_id) IS NOT NULL
  );

DROP POLICY IF EXISTS "allow_log_company_activity" ON public.cmms_activity_log;
CREATE POLICY "allow_log_company_activity" ON public.cmms_activity_log
  FOR INSERT
  WITH CHECK (
    auth.role() = 'authenticated' AND
    public.cmms_current_user_id_for_company(cmms_company_id) IS NOT NULL
  );

GRANT SELECT, INSERT ON public.cmms_activity_log TO authenticated;

-- ============================================================
-- 2. RPC: fn_get_cmms_dashboard_summary
-- One call, everything the home-screen widget needs.
-- ============================================================
DROP FUNCTION IF EXISTS public.fn_get_cmms_dashboard_summary(UUID);
CREATE OR REPLACE FUNCTION public.fn_get_cmms_dashboard_summary(p_company_id UUID)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSON;
BEGIN
  -- Only a member of this CMMS company may read its dashboard.
  IF public.cmms_current_user_id_for_company(p_company_id) IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT json_build_object(
    'company_name', (SELECT company_name FROM public.cmms_company_profiles WHERE id = p_company_id),
    'total_departments', (
      SELECT COUNT(*) FROM public.cmms_departments
      WHERE cmms_company_id = p_company_id AND is_active = TRUE
    ),
    'total_users', (
      SELECT COUNT(*) FROM public.cmms_users
      WHERE cmms_company_id = p_company_id AND is_active = TRUE
    ),
    'total_inventory_items', (
      SELECT COUNT(*) FROM public.cmms_inventory_items
      WHERE cmms_company_id = p_company_id AND is_active = TRUE
    ),
    'total_inventory_value', (
      SELECT COALESCE(SUM(quantity_in_stock * unit_price), 0) FROM public.cmms_inventory_items
      WHERE cmms_company_id = p_company_id AND is_active = TRUE
    ),
    'low_stock_items', (
      SELECT COUNT(*) FROM public.cmms_inventory_items
      WHERE cmms_company_id = p_company_id AND is_active = TRUE
        AND quantity_in_stock <= reorder_level AND quantity_in_stock > 0
    ),
    'out_of_stock_items', (
      SELECT COUNT(*) FROM public.cmms_inventory_items
      WHERE cmms_company_id = p_company_id AND is_active = TRUE AND quantity_in_stock = 0
    ),
    'pending_requisitions', (
      SELECT COUNT(*) FROM public.cmms_requisitions
      WHERE cmms_company_id = p_company_id AND status LIKE 'pending%'
    ),
    'urgent_requisitions', (
      SELECT COUNT(*) FROM public.cmms_requisitions
      WHERE cmms_company_id = p_company_id AND status LIKE 'pending%' AND urgency_level = 'urgent'
    ),
    'recent_activity', (
      SELECT COALESCE(json_agg(a), '[]'::json) FROM (
        SELECT actor_name, activity_type, description, icon, created_at
        FROM public.cmms_activity_log
        WHERE cmms_company_id = p_company_id
        ORDER BY created_at DESC
        LIMIT 8
      ) a
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_get_cmms_dashboard_summary(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';

SELECT 'CMMS activity log + dashboard summary RPC ready' AS status;
