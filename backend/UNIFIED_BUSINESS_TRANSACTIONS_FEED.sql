-- =====================================================
-- UNIFIED BUSINESS TRANSACTIONS FEED
-- =====================================================
-- Extends the "who can see what" fix from BUSINESS_TRANSACTIONS_BY_CONTRIBUTOR.sql
-- (which only powered the Pitchin "By contributor" drill-down) to the MAIN
-- dashboard transaction feed itself (VelocityEngine.loadTransactions /
-- loadAllTransactions) — the list behind "Record Every Transaction", the
-- today/week/month view, net worth, ROI and tithe calculations.
--
-- Before this, that feed was `SELECT * FROM ican_transactions WHERE user_id
-- = <viewer>` — an owner or shareholder would never see entries a team
-- member or co-owner recorded for their shared business.
--
-- RETURNS SETOF ican_transactions (not RETURNS TABLE with an explicit
-- column list) specifically to avoid the VARCHAR/TEXT column-type mismatch
-- that broke fn_get_business_transactions_by_contributor earlier — SETOF
-- the real table always matches its own row type exactly.
--
-- Uses auth.uid() directly (no parameter) — the caller can only ever see
-- their own view, never someone else's, regardless of what a client passes.
-- =====================================================

CREATE OR REPLACE FUNCTION fn_get_visible_ican_transactions()
RETURNS SETOF ican_transactions
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT t.*
  FROM ican_transactions t
  WHERE t.user_id = auth.uid()
     OR t.business_profile_id IN (
          SELECT id FROM business_profiles WHERE user_id = auth.uid()
          UNION
          SELECT business_profile_id FROM business_co_owners WHERE user_id = auth.uid()
        )
  ORDER BY t.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION fn_get_visible_ican_transactions() TO authenticated;

-- =====================================================
-- fn_get_visible_ican_transactions() returns SETOF ican_transactions — real
-- table columns only, so no contributor name/email attached to each row.
-- The dashboard needs those to group the feed "by who recorded it" (see
-- MobileView.jsx expBizByContributor). This resolves a batch of user_ids to
-- display names in one round trip instead of one query per row.
--
-- Every text column is explicitly cast to TEXT — profiles.full_name /
-- business_co_owners.owner_name etc. are VARCHAR(255), and mixing that with
-- TEXT in a RETURNS TABLE is exactly what broke
-- fn_get_business_transactions_by_contributor earlier.
-- =====================================================

CREATE OR REPLACE FUNCTION fn_get_contributor_names(p_user_ids UUID[])
RETURNS TABLE (
  user_id UUID,
  contributor_name TEXT,
  contributor_email TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT
    u.id AS user_id,
    COALESCE(
      p.full_name,
      (SELECT btm.member_name FROM business_team_members btm WHERE btm.user_id = u.id LIMIT 1),
      (SELECT bco.owner_name FROM business_co_owners bco WHERE bco.user_id = u.id LIMIT 1),
      'User ' || LEFT(u.id::TEXT, 8)
    )::TEXT AS contributor_name,
    COALESCE(
      p.email,
      (SELECT btm.member_email FROM business_team_members btm WHERE btm.user_id = u.id LIMIT 1),
      (SELECT bco.owner_email FROM business_co_owners bco WHERE bco.user_id = u.id LIMIT 1)
    )::TEXT AS contributor_email
  FROM unnest(p_user_ids) AS u(id)
  LEFT JOIN profiles p ON p.id = u.id;
$$;

GRANT EXECUTE ON FUNCTION fn_get_contributor_names(UUID[]) TO authenticated;
