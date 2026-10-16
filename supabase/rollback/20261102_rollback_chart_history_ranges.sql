DROP FUNCTION IF EXISTS public.ican_get_public_candle_range(TIMESTAMPTZ, TIMESTAMPTZ, INT);
DROP FUNCTION IF EXISTS public.ican_get_public_candle_bounds();
DROP FUNCTION IF EXISTS public.ican_stable_history_range(TIMESTAMPTZ, TIMESTAMPTZ, INT);
DROP FUNCTION IF EXISTS public.ican_stable_history_bounds();
NOTIFY pgrst, 'reload schema';
