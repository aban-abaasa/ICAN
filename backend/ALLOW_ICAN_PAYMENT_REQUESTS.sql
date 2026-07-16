-- ===========================================================================
-- ALLOW ICAN PAYMENT REQUESTS
-- Extends the shared payment_requests table (see CREATE_PAYMENT_REQUESTS_TABLE.sql)
-- so 'ICAN' is a valid currency — this lets any of the four apps create a
-- real, scannable QR "Receive" request denominated in icaneracoin, reusing
-- the same payment_requests infrastructure ICAN app already uses for local
-- currency requests.
-- Safe to run multiple times.
-- ===========================================================================

DO $$ BEGIN
  ALTER TABLE public.payment_requests DROP CONSTRAINT IF EXISTS valid_currency;
  ALTER TABLE public.payment_requests
    ADD CONSTRAINT valid_currency CHECK (currency IN ('USD', 'UGX', 'KES', 'TZS', 'RWF', 'ICAN'));
END $$;

-- A completed ICAN payment request should point at the real
-- ican_coin_transactions row that paid it, not the numeric-only
-- transaction_id column designed for the older integer transaction ids —
-- add a UUID column alongside it for that purpose.
ALTER TABLE public.payment_requests
  ADD COLUMN IF NOT EXISTS ican_tx_id UUID REFERENCES ican_coin_transactions(id);

NOTIFY pgrst, 'reload schema';

SELECT 'ICAN payment requests enabled' AS status, now() AS run_at;
