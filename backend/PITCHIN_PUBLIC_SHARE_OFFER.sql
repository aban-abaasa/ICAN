-- ============================================================
-- Public pitch page: show the share price to visitors who aren't the owner
-- ============================================================
-- The "The offer" box on the public board / pitch page said "This business's
-- share price isn't available right now" even though the business has shares
-- set up and a real price. Cause: the live price is computed from the owner's
-- own records (ican_transactions etc., row-level-secured to the owner), and the
-- stored daily snapshots are readable by signed-in users only. A signed-out
-- visitor -- or any investor who isn't the owner -- therefore computed a price
-- of 0 and was told it was unavailable.
--
-- Fix: a SECURITY DEFINER read that returns only the latest recorded non-zero
-- price (the one the owner's own live calculation last saved), the share count
-- and the shares already issued. No transactions or other private data leave
-- the database. Safe to run more than once.
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_get_public_share_offer(p_business_profile_id UUID)
RETURNS TABLE (
  share_price_ugx NUMERIC,
  total_shares BIGINT,
  business_value_ugx NUMERIC,
  snapshot_date DATE,
  shares_issued BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    s.share_price_ugx::numeric,
    COALESCE(bp.total_shares, s.total_shares)::bigint,
    s.business_value_ugx::numeric,
    s.snapshot_date::date,
    public.fn_get_business_issued_shares(p_business_profile_id)::bigint
  FROM public.pitchin_share_value_snapshots s
  JOIN public.business_profiles bp ON bp.id = s.business_profile_id
  WHERE s.business_profile_id = p_business_profile_id
    AND s.share_price_ugx > 0
  ORDER BY s.snapshot_date DESC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.fn_get_public_share_offer(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_get_public_share_offer(UUID) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

SELECT 'Public share offer available (fn_get_public_share_offer)' AS status;
