-- ============================================================================
-- icaneracoin BOOKING (LIMIT ORDER) SYSTEM
-- Run in Supabase SQL Editor any time after ICAN_PRICE_ENGINE.sql and
-- ICAN_REAL_CANDLESTICK_ENGINE.sql.
--
-- WHAT THIS ADDS:
--   A "book" order — a buy or sell the user queues at a target price instead
--   of executing immediately. It sits as an open row here until the live
--   fair price (ican_compute_fair_price) crosses the target, at which point
--   the frontend fills it using the SAME buyIcanCoins/sellIcanCoins code
--   path as a normal manual trade (real wallet debit/credit, real
--   ican_coin_transactions row) — see icanOrderService.js / the order-fill
--   check wired into ICANWallet.jsx and IcanPortfolio.jsx.
--
-- IMPORTANT — HONEST LIMITATION:
--   There is no server-side matching engine here. An open order only gets
--   checked (and filled) while the owning user has the wallet/chart open in
--   their browser, the same way this app's live candle feed already only
--   updates client-side while a session is connected. This table exists so
--   a booked order is durable (survives refresh/reopen) and so the chart
--   can draw it as a real, persisted line — not to promise it fires the
--   instant the price crosses while the user is fully offline.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.ican_coin_orders (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  order_type             TEXT NOT NULL CHECK (order_type IN ('buy', 'sell')),
  ican_amount            NUMERIC NOT NULL CHECK (ican_amount > 0),
  target_price_ugx       NUMERIC NOT NULL CHECK (target_price_ugx > 0),
  country_code           TEXT NOT NULL DEFAULT 'UG',
  status                 TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'filled', 'cancelled')),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  filled_at              TIMESTAMPTZ,
  filled_price_ugx       NUMERIC,
  filled_transaction_id  UUID,
  cancelled_at           TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ican_coin_orders_user_status
  ON public.ican_coin_orders(user_id, status);

ALTER TABLE public.ican_coin_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own booked orders" ON public.ican_coin_orders;
CREATE POLICY "Users view own booked orders"
  ON public.ican_coin_orders FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users book their own orders" ON public.ican_coin_orders;
CREATE POLICY "Users book their own orders"
  ON public.ican_coin_orders FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users update own booked orders" ON public.ican_coin_orders;
CREATE POLICY "Users update own booked orders"
  ON public.ican_coin_orders FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE ON public.ican_coin_orders TO authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- VERIFY
-- ─────────────────────────────────────────────────────────────────────────
SELECT 'icaneracoin booking (limit order) table installed' AS status;
