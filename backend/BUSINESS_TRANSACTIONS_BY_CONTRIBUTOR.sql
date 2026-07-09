-- =====================================================
-- BUSINESS TRANSACTIONS BY CONTRIBUTOR
-- =====================================================
-- ican_transactions has RLS "USING (user_id = auth.uid())", so a business
-- owner (or shareholder) querying it directly only ever sees the entries
-- THEY personally recorded — entries recorded by a team member
-- (business_team_members) or a different co-owner for the same business are
-- invisible, even though fn_get_business_ican_financials (SECURITY DEFINER)
-- already sums them correctly into the share valuation.
--
-- These RPCs let anyone with a stake in the business — the owner or a
-- shareholder/co-owner (business_co_owners) — see the underlying entries
-- broken down by who recorded them. SECURITY DEFINER bypasses the per-row
-- RLS, so each function explicitly re-checks the caller is the owner or a
-- co-owner before returning anything — do not remove that check. Plain
-- transaction-access team members are intentionally excluded from this
-- view (they were granted entry access, not the business's financial
-- visibility that owners/shareholders have).
-- =====================================================

CREATE OR REPLACE FUNCTION fn_can_view_business_financials(p_business_profile_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM business_profiles
    WHERE id = p_business_profile_id AND user_id = auth.uid()
  ) OR EXISTS (
    SELECT 1 FROM business_co_owners
    WHERE business_profile_id = p_business_profile_id AND user_id = auth.uid()
  );
$$;

GRANT EXECUTE ON FUNCTION fn_can_view_business_financials(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION fn_get_business_transactions_by_contributor(p_business_profile_id UUID)
RETURNS TABLE (
  id UUID,
  contributor_user_id UUID,
  contributor_name TEXT,
  contributor_email TEXT,
  amount NUMERIC,
  reporting_bucket TEXT,
  description TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT fn_can_view_business_financials(p_business_profile_id) THEN
    RAISE EXCEPTION 'Not authorized to view this business''s transaction history';
  END IF;

  -- Every text-ish column is explicitly cast to TEXT: profiles.full_name /
  -- business_co_owners.owner_name etc. are VARCHAR(255), and Postgres treats
  -- that as a distinct type from the TEXT declared in RETURNS TABLE above —
  -- without the casts, RETURN QUERY fails with "structure of query does not
  -- match function result type".
  RETURN QUERY
  SELECT
    t.id,
    t.user_id AS contributor_user_id,
    COALESCE(p.full_name, btm.member_name, bco.owner_name, 'User ' || LEFT(t.user_id::TEXT, 8))::TEXT AS contributor_name,
    COALESCE(p.email, btm.member_email, bco.owner_email)::TEXT AS contributor_email,
    t.amount,
    (t.metadata->>'reporting_bucket')::TEXT AS reporting_bucket,
    t.description::TEXT,
    t.created_at
  FROM ican_transactions t
  LEFT JOIN profiles p
    ON p.id = t.user_id
  LEFT JOIN business_team_members btm
    ON btm.business_profile_id = t.business_profile_id AND btm.user_id = t.user_id
  LEFT JOIN business_co_owners bco
    ON bco.business_profile_id = t.business_profile_id AND bco.user_id = t.user_id
  WHERE t.business_profile_id = p_business_profile_id
    AND t.status = 'completed'
  ORDER BY t.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_get_business_transactions_by_contributor(UUID) TO authenticated;

-- =====================================================
-- Same RLS blind spot affects the plain entry COUNT shown in the "Manual
-- Transactions" header (pitchinValuationService.getManualTransactionsDetail)
-- — it silently undercounts once a team member/co-owner has contributed
-- entries. Cheap SECURITY DEFINER count so the header number is accurate
-- without pulling the full contributor list every time.
-- =====================================================

CREATE OR REPLACE FUNCTION fn_get_business_manual_transaction_count(p_business_profile_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  IF NOT fn_can_view_business_financials(p_business_profile_id) THEN
    RETURN 0;
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM ican_transactions
  WHERE business_profile_id = p_business_profile_id
    AND status = 'completed';

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_get_business_manual_transaction_count(UUID) TO authenticated;
