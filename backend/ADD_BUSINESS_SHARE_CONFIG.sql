-- ============================================================================
-- Lets a business owner set how many total shares their business has, so
-- PitchIn can compute a real "icaneracoin per share" instead of dividing the
-- whole business value by a hardcoded 1 share (which is why it showed an
-- absurd 1,337,403.71 icaneracoin per share before).
--
-- Lives directly on business_profiles rather than investment_agreements —
-- investment_agreements is a full signed-MOU/investor-signature workflow
-- table; total share count is just business configuration, not a legal
-- agreement, so it doesn't belong there.
--
-- declared_share_price_ugx is the baseline used for the "% vs declared
-- price" figure. It's set automatically the moment shares are first
-- configured (or reconfigured — changing share count is a split, not real
-- growth/decline, so the baseline resets then) by the app, not manually here.
--
-- Run once in Supabase SQL Editor.
-- ============================================================================

ALTER TABLE public.business_profiles
  ADD COLUMN IF NOT EXISTS total_shares INTEGER CHECK (total_shares IS NULL OR total_shares > 0),
  ADD COLUMN IF NOT EXISTS declared_share_price_ugx NUMERIC;

-- Owner or co-owner can update their business's share configuration
-- (matches the access pattern already used for pitchin_business_data_links
-- and pitchin_share_value_snapshots — idempotent, safe to run even if a
-- broader "owner can update own profile" policy already exists).
DROP POLICY IF EXISTS "owner_update_share_config" ON public.business_profiles;
CREATE POLICY "owner_update_share_config"
  ON public.business_profiles FOR UPDATE
  USING (
    user_id::TEXT = auth.uid()::TEXT
    OR id IN (SELECT business_profile_id FROM business_co_owners WHERE user_id::TEXT = auth.uid()::TEXT)
  )
  WITH CHECK (
    user_id::TEXT = auth.uid()::TEXT
    OR id IN (SELECT business_profile_id FROM business_co_owners WHERE user_id::TEXT = auth.uid()::TEXT)
  );

SELECT 'Business share configuration columns added' AS status;
