-- ============================================================================
-- Enables live push updates for the PitchIn Live Share Value card.
--
-- The numbers it shows (Sales income, Capital assets, etc.) are already
-- computed live from ican_transactions on every load — that part was never
-- hardcoded. What was missing: Supabase tables aren't part of the realtime
-- publication by default, so the postgres_changes subscription added in
-- PitchinLiveShareValue.jsx silently never fires until this is run — you'd
-- only see fresh numbers after tapping the manual refresh icon.
--
-- Run once in Supabase SQL Editor.
-- ============================================================================

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.ican_transactions;
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'ican_transactions is already in the realtime publication — nothing to do';
END $$;

SELECT 'ican_transactions is now in the realtime publication' AS status;
