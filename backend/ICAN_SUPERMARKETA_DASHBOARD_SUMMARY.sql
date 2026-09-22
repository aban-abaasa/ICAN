-- ============================================================
-- Supermarketa (digital-city-era) summary for ICANera's home-screen
-- CMMS Activity widget -- sales, pending approvals, and a real day-
-- over-day trend for whichever Supermarketa store the logged-in
-- person owns or works at.
-- ============================================================
-- ICAN, digital-city-era (Supermarketa) and mybodaguy share ONE
-- Postgres database (see e.g. ICAN/backend/ADD_ICANERA_SUPERMARKETA_
-- PLATFORM_FEE.sql, which already reads mybodaguy's settings table
-- directly) -- so this function can live here and read digital-city-
-- era's own tables (public.users, public.supermarkets,
-- public.transactions, public.purchase_orders,
-- public.supplier_applications) directly, the same cross-app pattern
-- already established in this codebase.
--
-- Identity is resolved the same way digital-city-era's own frontend
-- already resolves it (ManagerPortal.jsx): a person is linked to a
-- store either as staff (public.users.auth_id = auth.uid(), giving
-- supermarket_id + role) or as its owner
-- (public.supermarkets.owner_user_id = auth.uid()). If neither
-- matches, the function returns NULL -- the ICAN widget shows nothing,
-- same silent-if-no-access behaviour as the CMMS summary.
--
-- "Progress" here is a REAL day-over-day sales comparison, not a
-- fabricated target -- digital-city-era's own "Strategic Goals"
-- widget uses hardcoded revenue targets (e.g. a flat 150,000,000 UGX
-- goal); this deliberately does not copy that, since a fake target
-- would misrepresent this business's actual progress.
--
-- Run anytime; safe to run more than once (CREATE OR REPLACE).
-- ============================================================

DROP FUNCTION IF EXISTS public.fn_get_supermarketa_dashboard_summary();
CREATE OR REPLACE FUNCTION public.fn_get_supermarketa_dashboard_summary()
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth_id UUID := auth.uid();
  v_supermarket_id UUID;
  v_role TEXT;
  v_result JSON;
BEGIN
  IF v_auth_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Owner first (a store's registered owner may not also have a staff row).
  SELECT id INTO v_supermarket_id
  FROM public.supermarkets
  WHERE owner_user_id = v_auth_id
  LIMIT 1;

  IF v_supermarket_id IS NOT NULL THEN
    v_role := 'owner';
  ELSE
    SELECT supermarket_id, role INTO v_supermarket_id, v_role
    FROM public.users
    WHERE auth_id = v_auth_id AND supermarket_id IS NOT NULL
    LIMIT 1;
  END IF;

  IF v_supermarket_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT json_build_object(
    'supermarket_id', v_supermarket_id,
    'supermarket_name', (SELECT name FROM public.supermarkets WHERE id = v_supermarket_id),
    'role', v_role,
    'today_sales_ugx', (
      SELECT COALESCE(SUM(total_amount), 0) FROM public.transactions
      WHERE supermarket_id = v_supermarket_id
        AND created_at >= date_trunc('day', now())
        AND COALESCE(status, 'completed') NOT IN ('voided', 'refunded', 'cancelled')
    ),
    'today_transactions_count', (
      SELECT COUNT(*) FROM public.transactions
      WHERE supermarket_id = v_supermarket_id
        AND created_at >= date_trunc('day', now())
        AND COALESCE(status, 'completed') NOT IN ('voided', 'refunded', 'cancelled')
    ),
    'yesterday_sales_ugx', (
      SELECT COALESCE(SUM(total_amount), 0) FROM public.transactions
      WHERE supermarket_id = v_supermarket_id
        AND created_at >= date_trunc('day', now()) - INTERVAL '1 day'
        AND created_at < date_trunc('day', now())
        AND COALESCE(status, 'completed') NOT IN ('voided', 'refunded', 'cancelled')
    ),
    'last7days_sales', (
      SELECT COALESCE(json_agg(d ORDER BY d.day), '[]'::json) FROM (
        SELECT
          date_trunc('day', gs)::date AS day,
          COALESCE(SUM(t.total_amount), 0) AS total
        FROM generate_series(date_trunc('day', now()) - INTERVAL '6 days', date_trunc('day', now()), INTERVAL '1 day') gs
        LEFT JOIN public.transactions t
          ON t.supermarket_id = v_supermarket_id
          AND date_trunc('day', t.created_at) = date_trunc('day', gs)
          AND COALESCE(t.status, 'completed') NOT IN ('voided', 'refunded', 'cancelled')
        GROUP BY gs
      ) d
    ),
    'pending_purchase_orders', (
      SELECT COUNT(*) FROM public.purchase_orders
      WHERE supermarket_id = v_supermarket_id
        AND status IN ('pending', 'pending_approval')
    ),
    'pending_supplier_applications', (
      SELECT COUNT(*) FROM public.supplier_applications
      WHERE supermarket_id = v_supermarket_id AND status = 'pending'
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_get_supermarketa_dashboard_summary() TO authenticated;

NOTIFY pgrst, 'reload schema';

SELECT 'Supermarketa dashboard summary RPC ready' AS status;
