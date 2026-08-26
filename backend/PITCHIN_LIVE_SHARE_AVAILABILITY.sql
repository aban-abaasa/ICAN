-- =====================================================
-- PITCHIN LIVE SHARE AVAILABILITY
-- =====================================================
-- The PitchIn invest flow prices and sizes every investment from live data
-- only: business_profiles.total_shares for the share count, the live valuation
-- for the price, and the investor_shares ownership ledger for what is still
-- unsold. The static pitches.share_price / pitches.total_shares /
-- pitches.shares_available columns (ADD_SHARE_COLUMNS.sql,
-- POPULATE_PITCH_SHARES.sql) are seeded once and never recomputed, so nothing
-- in the flow reads them any more.
--
-- investor_shares has RLS "USING (investor_id = auth.uid())" (see
-- COMPLETE_INVESTMENT_SETUP.sql), so a prospective investor querying the table
-- directly only ever sees THEIR OWN rows. Counting issued shares that way
-- would report almost every business as fully unsold and let the same shares
-- be sold over and over.
--
-- This SECURITY DEFINER function returns only an aggregate count — no investor
-- identities, amounts or prices — which is exactly what a buyer needs to see
-- before committing, so it is readable by any authenticated user.
--
-- pending_approval is counted alongside approved/active on purpose: those
-- shares are spoken for while their signatures are being collected, and
-- excluding them would let a second investor buy the same shares during the
-- 24-hour signing window.
--
-- Run once in the Supabase SQL Editor.
-- =====================================================

CREATE OR REPLACE FUNCTION fn_get_business_issued_shares(p_business_profile_id UUID)
RETURNS INTEGER
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT COALESCE(SUM(shares_owned), 0)::INTEGER
  FROM investor_shares
  WHERE business_profile_id = p_business_profile_id
    AND status IN ('pending_approval', 'approved', 'active');
$$;

GRANT EXECUTE ON FUNCTION fn_get_business_issued_shares(UUID) TO authenticated;

-- The invest flow now writes a 'pending_approval' investor_shares row the
-- moment payment is authorised (reserving the shares against the live count)
-- and flips that same row to 'approved' once 60% of shareholders sign.
-- COMPLETE_INVESTMENT_SETUP.sql enabled RLS on this table with SELECT and
-- INSERT policies but no UPDATE policy, so that second step would be silently
-- denied and the row would sit reserved-but-never-approved forever.
--
-- This grants no privilege the investor did not already have: the existing
-- INSERT policy already lets them write a row for themselves with any status.
DROP POLICY IF EXISTS "Investors can update their own shares" ON public.investor_shares;
CREATE POLICY "Investors can update their own shares"
    ON public.investor_shares FOR UPDATE
    USING (investor_id = auth.uid())
    WITH CHECK (investor_id = auth.uid());

SELECT 'fn_get_business_issued_shares + investor_shares UPDATE policy created' AS status;
