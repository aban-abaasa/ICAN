-- Enable Supabase Realtime for ican_price_ohlc so the trading chart can
-- receive live INSERT/UPDATE events instead of relying on polling.
-- Safe to re-run: guards against the table already being in the publication.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'ican_price_ohlc'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE ican_price_ohlc;
  END IF;
END $$;
