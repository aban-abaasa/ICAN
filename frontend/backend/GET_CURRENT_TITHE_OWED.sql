-- ============================================================
-- GET_CURRENT_TITHE_OWED.sql
-- Retrieves the current tithe owed for the user (from tracking table)
-- Replaces calculated tithe with actual tracked amount
-- ============================================================

-- ============================================================
-- FUNCTION: Get current tithe owed (from user_tithe_tracking)
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_get_current_tithe_owed()
RETURNS TABLE (
  personal_tithe_owed DECIMAL(15,2),
  business_tithe_owed DECIMAL(15,2),
  combined_tithe_owed DECIMAL(15,2),
  total_tithe_owed DECIMAL(15,2),
  last_payment_date TIMESTAMP,
  last_updated TIMESTAMP
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COALESCE(t.personal_tithe_accumulated, 0)::DECIMAL(15,2) as personal_tithe_owed,
    COALESCE(t.business_tithe_accumulated, 0)::DECIMAL(15,2) as business_tithe_owed,
    COALESCE(t.combined_tithe_accumulated, 0)::DECIMAL(15,2) as combined_tithe_owed,
    (COALESCE(t.personal_tithe_accumulated, 0) + 
     COALESCE(t.business_tithe_accumulated, 0) + 
     COALESCE(t.combined_tithe_accumulated, 0))::DECIMAL(15,2) as total_tithe_owed,
    t.last_payment_date,
    t.updated_at
  FROM public.user_tithe_tracking t
  WHERE t.user_id = auth.uid();
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_get_current_tithe_owed TO authenticated;

-- ============================================================
-- VERIFY
-- ============================================================
-- SELECT * FROM fn_get_current_tithe_owed();
