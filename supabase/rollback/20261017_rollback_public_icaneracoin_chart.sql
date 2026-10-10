-- Undo 20261017100000_public_icaneracoin_chart.sql: the public chart page falls back to its "could not be
-- loaded" state for signed-out visitors; signed-in wallet charts are unaffected (they read the table directly).
DROP FUNCTION IF EXISTS public.ican_get_public_candles(INT);
NOTIFY pgrst, 'reload schema';
