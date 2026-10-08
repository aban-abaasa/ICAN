-- ============================================================================
-- INSTALLMENT ORDERS — pay for a storefront / business-website product in
-- instalments, then collect it or have it delivered once it is paid in full.
-- ============================================================================
-- Works for every dropship / reseller storefront (the ICAN storefront, the
-- business website's Products & Services tab, mybodaguy and SupermartKera
-- customer pages): they all sit on the same dropship_listings, so one engine
-- serves them all.
--
--   1. installment_create()   prices the cart server-side, RESERVES the stock
--      (inventory.reserved_stock, so nobody else can buy it) and takes the
--      deposit. A plan needs an IcanEra account: the balance, the receipts
--      and the pickup code are then always the customer's own.
--   2. installment_pay_wallet() / installment_pay_start() + the
--      installment-pay Edge Function pay more at any time — from the IcanEra
--      wallet (no fee) or with Mobile Money / card / bank (Flutterwave, plus
--      the same processing fee guest checkout charges).
--   3. Money paid in is HELD INSIDE THE PLAN (debited from the customer's
--      wallet, credited to nobody) until the plan is complete. Nothing reaches
--      the store, the reseller or a rider before the goods are handed over.
--   4. Once the items are paid in full the customer chooses:
--        * COLLECT  - installment_choose_pickup(): a pickup receipt is issued
--          (the same QR seal-scan receipt delivery uses). The store confirms
--          handover with icanera_confirm_pickup(), and only then are the
--          store's wholesale leg and the reseller's margin released.
--        * DELIVERY - installment_choose_delivery(): the customer pays the
--          real BodaGoera fare (quoted from the nearest ranked rider), and as
--          soon as it is paid the held funds are released to the customer's
--          wallet and the existing dropship_checkout() runs AS the customer —
--          rider booking, escrow, delivery window and refund rights are
--          exactly those of any other delivery.
--
-- PROTECTIONS
--   * Price lock: while a plan is open its listing cannot be raised in price
--     or switched off (trigger below); a price DROP simply returns the
--     difference to the customer's wallet.
--   * Stock is reserved for the life of the plan.
--   * A plan that is not finished by its last due date + grace is lapsed by
--     installment_run_due(): the stock is released and what was paid comes
--     back to the wallet, less a small cancel fee that goes to the seller
--     (waived inside the cooling-off window, or when the seller cancels).
--   * No money is ever created or lost by the engine: the funds held by open
--     plans are visible as installment_escrow_ican().
--
-- NOT HANDLED HERE: cash. A cash instalment would have to be credited from the
-- seller's business wallet, and that transfer always waits for the owners'
-- approval (pitchin_business_wallet_transfer), so it cannot be applied
-- instantly without bypassing the wallet's PIN / approval controls.
--
-- Run after: ADD_DROPSHIP_SMART_TRANSPORT.sql, ADD_DELIVERY_RECEIPT_VERIFICATION.sql
-- (and its escrow / approval follow-ups), ADD_GUEST_CHECKOUT_MOBILE_MONEY.sql.
-- Safe to run more than once. Deploy the installment-pay Edge Function after.
-- ============================================================================

SET check_function_bodies = off;

DO $$
BEGIN
  IF to_regprocedure('public.dropship_checkout(uuid,jsonb,text,text,text,text,numeric,numeric,numeric,uuid,text[])') IS NULL
     OR to_regprocedure('public.dropship_ranked_riders(uuid,numeric,numeric,numeric,numeric,text[],integer)') IS NULL
     OR to_regprocedure('public.icanera_create_delivery_receipt(text,text,uuid,uuid,uuid,uuid,text,text,numeric,jsonb,jsonb,numeric)') IS NULL
     OR to_regprocedure('public.ican_live_price_in_currency(character varying)') IS NULL
     OR to_regprocedure('public.buy_ican_coins(uuid,numeric,text,text)') IS NULL
     OR to_regprocedure('public.ican_settle_business_wallet_income(uuid,numeric,text,text,text,text,jsonb)') IS NULL
     OR to_regclass('public.guest_checkout_config') IS NULL THEN
    RAISE EXCEPTION 'Run the dropship, delivery-receipt and guest-checkout SQL first (ADD_DROPSHIP_SMART_TRANSPORT, ADD_DELIVERY_RECEIPT_VERIFICATION, ADD_GUEST_CHECKOUT_MOBILE_MONEY).';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 1. Settings (service side only) — change any of them with a plain UPDATE.
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.installment_config (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  note  TEXT
);
ALTER TABLE public.installment_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.installment_config FROM PUBLIC, anon, authenticated;

INSERT INTO public.installment_config (key, value, note) VALUES
  ('min_order_ugx',      '20000', 'Smallest order that can be paid in instalments'),
  ('min_deposit_pct',    '20',    'Smallest first payment, as a percent of the items total'),
  ('min_payment_ugx',    '1000',  'Smallest single payment (the final balance may be smaller)'),
  ('max_installments',   '6',     'Most payments after the deposit'),
  ('max_plan_days',      '90',    'A plan must be paid in full within this many days'),
  ('grace_days',         '7',     'Days after the last due date before an unpaid plan lapses'),
  ('cancel_fee_pct',     '5',     'Percent of what was paid kept by the seller when the CUSTOMER abandons a plan or it lapses'),
  ('cooling_off_hours',  '24',    'The customer can cancel fee-free during this many hours after starting'),
  ('deposit_hold_hours', '2',     'An unpaid deposit releases the reserved stock after this many hours'),
  ('ship_deadline_days',   '14',   'Cross-border: a paid order the seller has not shipped by then is cancelled and refunded in full'),
  ('ship_auto_release_days','30',  'Cross-border: money is released to the seller this many days after it is marked shipped, unless the buyer confirmed earlier or reported a problem')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public._inst_cfg(p_key TEXT, p_default NUMERIC)
RETURNS NUMERIC LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT NULLIF(value, '')::NUMERIC FROM public.installment_config WHERE key = p_key), p_default);
$$;

-- ── Currency ────────────────────────────────────────────────────────────────
-- A plan is priced in its store's currency (supermarkets.price_currency, UGX when unset) and everything paid into it
-- is held as icaneracoin, converted at the coin's price in that currency AT THE MOMENT OF EACH PAYMENT (kept on the
-- payment row). UGX uses the fixed 1 coin = 5,000 UGX that dropship_checkout itself uses; every other currency uses
-- the platform's live coin price (ican_live_price_in_currency). Thresholds in the settings are written in UGX and are
-- converted to the plan's currency the same way.
CREATE OR REPLACE FUNCTION public._inst_price(p_currency TEXT)
RETURNS NUMERIC LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cur TEXT := upper(COALESCE(NULLIF(btrim(p_currency), ''), 'UGX'));
  v_price NUMERIC;
BEGIN
  IF v_cur = 'UGX' THEN
    RETURN 5000;
  END IF;
  v_price := public.ican_live_price_in_currency(v_cur::VARCHAR);   -- raises a clear message when it is unavailable
  IF v_price IS NULL OR v_price <= 0 THEN
    RAISE EXCEPTION 'The live icaneracoin price in % is not available right now — please try again in a moment', v_cur;
  END IF;
  RETURN v_price;
END;
$$;

-- Same, for display only: NULL instead of an error when the price can't be had.
CREATE OR REPLACE FUNCTION public._inst_price_safe(p_currency TEXT)
RETURNS NUMERIC LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN public._inst_price(p_currency);
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

-- amount in the plan's currency -> coins
CREATE OR REPLACE FUNCTION public._inst_ican(p_amount NUMERIC, p_price NUMERIC DEFAULT 5000)
RETURNS NUMERIC LANGUAGE sql IMMUTABLE AS $$
  SELECT GREATEST(ROUND(p_amount / p_price, 8), 0.00000001);
$$;

-- The step schedule amounts are rounded UP to: UGX 100; other currencies about a hundredth of one coin's price
-- (USD 0.01, KES 1, NGN 10). Fixed on the plan when it is created so a schedule never shifts with the market.
CREATE OR REPLACE FUNCTION public._inst_unit(p_currency TEXT, p_price NUMERIC)
RETURNS NUMERIC LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN upper(p_currency) = 'UGX' THEN 100::NUMERIC
              ELSE GREATEST(power(10::NUMERIC, floor(log(p_price)) - 2), 0.01) END;
$$;

-- a UGX threshold from the settings, in the plan's currency, rounded up to its unit
CREATE OR REPLACE FUNCTION public._inst_from_ugx(p_ugx NUMERIC, p_currency TEXT, p_price NUMERIC)
RETURNS NUMERIC LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN upper(p_currency) = 'UGX' THEN p_ugx
              ELSE CEIL(p_ugx / 5000 * p_price / public._inst_unit(p_currency, p_price)) * public._inst_unit(p_currency, p_price) END;
$$;

-- "UGX 30,000" / "USD 12.50"
CREATE OR REPLACE FUNCTION public._inst_money(p_amount NUMERIC, p_currency TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT upper(COALESCE(p_currency, 'UGX')) || ' ' || regexp_replace(to_char(COALESCE(p_amount, 0), 'FM999,999,999,990.00'), '\.00$', '');
$$;

-- ----------------------------------------------------------------------------
-- 2. Tables
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.installment_plans (
  id                           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                         TEXT NOT NULL UNIQUE,
  customer_user_id             UUID NOT NULL,
  customer_name                TEXT,
  customer_phone               TEXT,
  reseller_business_profile_id UUID NOT NULL,
  supermarket_id               UUID NOT NULL,
  currency                     TEXT NOT NULL DEFAULT 'UGX',   -- the store's price currency; every amount below is in it
  unit                         NUMERIC NOT NULL DEFAULT 100,  -- schedule amounts round up to this
  cart                         JSONB NOT NULL,           -- [{product_id, quantity}]
  items                        JSONB NOT NULL,           -- priced snapshot, price-locked
  items_amount                    NUMERIC NOT NULL CHECK (items_amount > 0),
  store_amount                    NUMERIC NOT NULL,         -- wholesale + tax owed to the store
  margin_amount                   NUMERIC NOT NULL,         -- reseller's markup
  deposit_amount                  NUMERIC NOT NULL CHECK (deposit_amount > 0),
  n_installments               INTEGER NOT NULL CHECK (n_installments >= 0),   -- 0 = paid in full up front
  frequency_days               INTEGER NOT NULL CHECK (frequency_days >= 1),
  final_due_at                 TIMESTAMPTZ NOT NULL,
  paid_amount                     NUMERIC NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  held_ican                    NUMERIC NOT NULL DEFAULT 0 CHECK (held_ican >= 0),
  delivery_fee_amount             NUMERIC NOT NULL DEFAULT 0 CHECK (delivery_fee_amount >= 0),
  status                       TEXT NOT NULL DEFAULT 'awaiting_deposit'
                               CHECK (status IN ('awaiting_deposit','active','ready','pickup_ready','dispatched','shipping_pending','shipped','disputed','completed','cancelled','lapsed')),
  fulfilment                   TEXT CHECK (fulfilment IN ('pickup','delivery','ship')),
  delivery                     JSONB,
  cross_border                 BOOLEAN NOT NULL DEFAULT FALSE,   -- the store prices in another currency than the buyer's: it ships, nobody collects
  buyer_currency               TEXT,
  shipping                     JSONB,                            -- the buyer's address (cross-border)
  shipment                     JSONB,                            -- carrier, tracking number, link, eta (set by the seller)
  problem                      JSONB,                            -- what the buyer reported (status 'disputed')
  shipped_at                   TIMESTAMPTZ,
  shipping_chosen_at           TIMESTAMPTZ,
  dropship_order_id            UUID,
  receipt_code                 TEXT,
  cancel_reason                TEXT,
  refunded_amount                 NUMERIC NOT NULL DEFAULT 0,
  cancel_fee_amount               NUMERIC NOT NULL DEFAULT 0,
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at                    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS installment_plans_customer_idx ON public.installment_plans(customer_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS installment_plans_seller_idx   ON public.installment_plans(reseller_business_profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS installment_plans_open_idx     ON public.installment_plans(status) WHERE status IN ('awaiting_deposit','active','ready');

CREATE TABLE IF NOT EXISTS public.installment_payments (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id            UUID NOT NULL REFERENCES public.installment_plans(id) ON DELETE CASCADE,
  customer_user_id   UUID NOT NULL,
  kind               TEXT NOT NULL DEFAULT 'installment' CHECK (kind IN ('installment','delivery_fee')),
  method             TEXT NOT NULL CHECK (method IN ('wallet','flutterwave')),
  amount         NUMERIC NOT NULL CHECK (amount > 0),   -- credited to the plan
  processing_fee_amount NUMERIC NOT NULL DEFAULT 0,
  charge_amount         NUMERIC NOT NULL,                          -- what the customer actually pays
  currency           TEXT NOT NULL DEFAULT 'UGX',
  coin_price         NUMERIC NOT NULL DEFAULT 5000,              -- coin price in `currency` when this payment was priced
  ican_amount        NUMERIC,                                    -- the coins this payment buys / holds
  tx_ref             TEXT UNIQUE,
  status             TEXT NOT NULL DEFAULT 'paid' CHECK (status IN ('awaiting_payment','paid','failed','refunded')),
  flw_transaction_id TEXT,
  paid_amount           NUMERIC,
  error              TEXT,
  refund_note        TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at            TIMESTAMPTZ
);
ALTER TABLE public.installment_plans    ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'UGX';
ALTER TABLE public.installment_plans    ADD COLUMN IF NOT EXISTS cross_border BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.installment_plans    ADD COLUMN IF NOT EXISTS buyer_currency TEXT;
ALTER TABLE public.installment_plans    ADD COLUMN IF NOT EXISTS shipping JSONB;
ALTER TABLE public.installment_plans    ADD COLUMN IF NOT EXISTS shipment JSONB;
ALTER TABLE public.installment_plans    ADD COLUMN IF NOT EXISTS problem JSONB;
ALTER TABLE public.installment_plans    ADD COLUMN IF NOT EXISTS shipped_at TIMESTAMPTZ;
ALTER TABLE public.installment_plans    ADD COLUMN IF NOT EXISTS shipping_chosen_at TIMESTAMPTZ;
ALTER TABLE public.installment_plans    DROP CONSTRAINT IF EXISTS installment_plans_status_check;
ALTER TABLE public.installment_plans    ADD CONSTRAINT installment_plans_status_check CHECK (status IN ('awaiting_deposit','active','ready','pickup_ready','dispatched','shipping_pending','shipped','disputed','completed','cancelled','lapsed'));
ALTER TABLE public.installment_plans    DROP CONSTRAINT IF EXISTS installment_plans_fulfilment_check;
ALTER TABLE public.installment_plans    ADD CONSTRAINT installment_plans_fulfilment_check CHECK (fulfilment IN ('pickup','delivery','ship'));
ALTER TABLE public.installment_plans    DROP CONSTRAINT IF EXISTS installment_plans_n_installments_check;
ALTER TABLE public.installment_plans    ADD CONSTRAINT installment_plans_n_installments_check CHECK (n_installments >= 0);
ALTER TABLE public.installment_plans    ADD COLUMN IF NOT EXISTS unit NUMERIC NOT NULL DEFAULT 100;
ALTER TABLE public.installment_payments ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'UGX';
ALTER TABLE public.installment_payments ADD COLUMN IF NOT EXISTS coin_price NUMERIC NOT NULL DEFAULT 5000;

CREATE INDEX IF NOT EXISTS installment_payments_plan_idx ON public.installment_payments(plan_id, created_at);

CREATE TABLE IF NOT EXISTS public.installment_events (
  id         BIGSERIAL PRIMARY KEY,
  plan_id    UUID NOT NULL REFERENCES public.installment_plans(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  amount NUMERIC,
  note       TEXT,
  at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS installment_events_plan_idx ON public.installment_events(plan_id, at);

ALTER TABLE public.installment_plans    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.installment_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.installment_events   ENABLE ROW LEVEL SECURITY;

-- Customers read their own rows; every write goes through the functions below.
DROP POLICY IF EXISTS installment_plans_own ON public.installment_plans;
CREATE POLICY installment_plans_own ON public.installment_plans FOR SELECT TO authenticated
  USING (customer_user_id = auth.uid() OR public.unified_business_member(reseller_business_profile_id));
DROP POLICY IF EXISTS installment_payments_own ON public.installment_payments;
CREATE POLICY installment_payments_own ON public.installment_payments FOR SELECT TO authenticated
  USING (customer_user_id = auth.uid());
DROP POLICY IF EXISTS installment_events_own ON public.installment_events;
CREATE POLICY installment_events_own ON public.installment_events FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.installment_plans p WHERE p.id = plan_id AND p.customer_user_id = auth.uid()));

REVOKE ALL ON public.installment_plans, public.installment_payments, public.installment_events FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE ON public.installment_plans, public.installment_payments, public.installment_events FROM authenticated;
GRANT SELECT ON public.installment_plans, public.installment_payments, public.installment_events TO authenticated;

-- ----------------------------------------------------------------------------
-- 3. Internal helpers (not callable from the API)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._inst_event(p_plan UUID, p_kind TEXT, p_amount NUMERIC DEFAULT NULL, p_note TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.installment_events (plan_id, kind, amount, note) VALUES (p_plan, p_kind, p_amount, p_note);
$$;

CREATE OR REPLACE FUNCTION public._inst_new_code()
RETURNS TEXT LANGUAGE plpgsql VOLATILE SET search_path = public AS $$
DECLARE
  v_alphabet CONSTANT TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code TEXT;
  i INT;
BEGIN
  LOOP
    v_code := '';
    FOR i IN 1..8 LOOP
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::INT, 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.installment_plans WHERE code = v_code);
  END LOOP;
  RETURN v_code;
END;
$$;

-- Prices a cart exactly the way dropship_checkout does (same tax and margin
-- maths, same listing rules). p_lock = true also locks the inventory rows.
CREATE OR REPLACE FUNCTION public._inst_price_cart(p_reseller UUID, p_cart JSONB, p_lock BOOLEAN DEFAULT FALSE)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_item JSONB;
  v_listing RECORD;
  v_qty NUMERIC;
  v_tax_line NUMERIC;
  v_line NUMERIC;
  v_items_total NUMERIC := 0;
  v_store_total NUMERIC := 0;
  v_margin_total NUMERIC := 0;
  v_lines JSONB := '[]'::JSONB;
  v_supermarket UUID;
  v_available NUMERIC;
  v_seen UUID[] := ARRAY[]::UUID[];
  v_pid UUID;
  v_currency TEXT;
BEGIN
  IF p_cart IS NULL OR jsonb_typeof(p_cart) <> 'array' OR jsonb_array_length(p_cart) = 0 THEN
    RAISE EXCEPTION 'Your cart is empty';
  END IF;
  IF jsonb_array_length(p_cart) > 40 THEN
    RAISE EXCEPTION 'Too many different items in one order';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_cart) LOOP
    BEGIN
      v_qty := (v_item ->> 'quantity')::NUMERIC;
      v_pid := (v_item ->> 'product_id')::UUID;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Invalid item in your cart';
    END;
    IF v_qty IS NULL OR v_qty <= 0 OR v_qty > 1000 OR v_qty <> trunc(v_qty) THEN
      RAISE EXCEPTION 'Invalid quantity in your cart';
    END IF;
    IF v_pid = ANY (v_seen) THEN
      RAISE EXCEPTION 'The same item appears twice in your cart';
    END IF;
    v_seen := v_seen || v_pid;

    SELECT dl.listed_price, p.selling_price, p.tax_rate, p.supermarket_id, p.name AS product_name, p.sku AS product_sku
      INTO v_listing
      FROM public.dropship_listings dl
      JOIN public.products p ON p.id = dl.product_id
     WHERE dl.reseller_business_profile_id = p_reseller
       AND dl.product_id = v_pid
       AND dl.is_active = TRUE
       AND (p.is_active IS NULL OR p.is_active = TRUE)
       AND p.is_dropship_excluded = FALSE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'An item in your cart is no longer available';
    END IF;
    IF v_listing.tax_rate IS NULL OR v_listing.listed_price < v_listing.selling_price THEN
      RAISE EXCEPTION '"%" can''t be ordered right now', v_listing.product_name;
    END IF;

    IF v_supermarket IS NULL THEN
      v_supermarket := v_listing.supermarket_id;
    ELSIF v_supermarket IS DISTINCT FROM v_listing.supermarket_id THEN
      RAISE EXCEPTION 'All items in one order must come from the same store — order each store separately';
    END IF;

    IF p_lock THEN
      SELECT GREATEST(COALESCE(inv.current_stock, 0) - COALESCE(inv.reserved_stock, 0), 0) INTO v_available
        FROM public.inventory inv
       WHERE inv.product_id = v_pid AND inv.supermarket_id = v_supermarket
       FOR UPDATE;
    ELSE
      SELECT GREATEST(COALESCE(inv.current_stock, 0) - COALESCE(inv.reserved_stock, 0), 0) INTO v_available
        FROM public.inventory inv
       WHERE inv.product_id = v_pid AND inv.supermarket_id = v_supermarket;
    END IF;
    IF v_available IS NULL OR v_available < v_qty THEN
      RAISE EXCEPTION 'Not enough stock for "%"', v_listing.product_name;
    END IF;

    v_tax_line      := ROUND(v_listing.listed_price * v_qty * (v_listing.tax_rate / 100), 2);
    v_line          := ROUND(v_listing.listed_price * v_qty + v_tax_line, 2);
    v_items_total   := v_items_total + v_line;
    v_store_total   := v_store_total + ROUND(v_listing.selling_price * v_qty, 2) + v_tax_line;
    v_margin_total  := v_margin_total + ROUND((v_listing.listed_price - v_listing.selling_price) * v_qty, 2);
    v_lines := v_lines || jsonb_build_object(
      'product_id', v_pid, 'name', v_listing.product_name, 'sku', v_listing.product_sku, 'quantity', v_qty,
      'unit_price', v_listing.listed_price, 'tax_rate', v_listing.tax_rate, 'line_total', v_line,
      'wholesale_price', v_listing.selling_price, 'tax_amount', v_tax_line
    );
  END LOOP;

  -- The store's own price currency (UGX when it never set one): every figure above is in it.
  SELECT upper(COALESCE(NULLIF(btrim(price_currency), ''), 'UGX')) INTO v_currency FROM public.supermarkets WHERE id = v_supermarket;

  RETURN jsonb_build_object(
    'lines', v_lines, 'items_amount', v_items_total, 'store_amount', v_store_total,
    'margin_amount', v_margin_total, 'supermarket_id', v_supermarket, 'currency', COALESCE(v_currency, 'UGX')
  );
END;
$$;

-- Deposit first, then n equal parts (rounded up to the plan's unit, the last one takes
-- the remainder), one per frequency_days.
CREATE OR REPLACE FUNCTION public._inst_schedule(p public.installment_plans)
RETURNS JSONB LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  v_rest NUMERIC := p.items_amount - p.deposit_amount;
  v_per NUMERIC;
  v_out JSONB := '[]'::JSONB;
  v_cum NUMERIC := 0;
  v_amt NUMERIC;
  v_paid_in NUMERIC;
  k INT;
BEGIN
  v_per := CASE WHEN p.n_installments = 0 THEN 0 ELSE CEIL(v_rest / p.n_installments / p.unit) * p.unit END;
  FOR k IN 0..p.n_installments LOOP
    v_amt := CASE WHEN k = 0 THEN p.deposit_amount
                  WHEN k = p.n_installments THEN v_rest - v_per * (p.n_installments - 1)
                  ELSE v_per END;
    v_cum := v_cum + v_amt;
    v_paid_in := GREATEST(LEAST(p.paid_amount - (v_cum - v_amt), v_amt), 0);
    v_out := v_out || jsonb_build_object(
      'n', k, 'due_at', p.created_at + (k * p.frequency_days || ' days')::INTERVAL,
      'amount', v_amt, 'paid_amount', v_paid_in, 'cumulative_amount', v_cum,
      'status', CASE WHEN v_paid_in >= v_amt THEN 'paid'
                     WHEN p.created_at + (k * p.frequency_days || ' days')::INTERVAL < now() THEN 'overdue'
                     ELSE 'upcoming' END);
  END LOOP;
  RETURN v_out;
END;
$$;

-- Take p_amount from the customer's IcanEra wallet INTO the plan (held, credited
-- to nobody). Raises if the wallet cannot cover it, rolling the caller back.
CREATE OR REPLACE FUNCTION public._inst_hold(p_plan UUID, p_amount NUMERIC, p_method TEXT, p_payment UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_plan public.installment_plans%ROWTYPE;
  v_ican NUMERIC;
  v_balance NUMERIC;
BEGIN
  SELECT * INTO v_plan FROM public.installment_plans WHERE id = p_plan FOR UPDATE;
  -- The coins were fixed when the payment was priced (at that moment's coin price).
  SELECT ican_amount INTO v_ican FROM public.installment_payments WHERE id = p_payment;
  IF v_ican IS NULL OR v_ican <= 0 THEN
    RAISE EXCEPTION 'This payment has no coin amount';
  END IF;

  SELECT ican_balance INTO v_balance FROM public.ican_user_wallets WHERE user_id = v_plan.customer_user_id FOR UPDATE;
  -- A brand-new account (e.g. just created with Google) has no wallet row yet: that is simply an empty wallet.
  IF COALESCE(v_balance, 0) < v_ican THEN
    RAISE EXCEPTION 'Not enough in your IcanEra wallet for this payment — top it up, or pay with Mobile Money, card or bank';
  END IF;

  UPDATE public.ican_user_wallets
     SET ican_balance = ican_balance - v_ican, total_spent = COALESCE(total_spent, 0) + v_ican
   WHERE user_id = v_plan.customer_user_id;

  INSERT INTO public.ican_coin_transactions
    (sender_user_id, ican_amount, type, transaction_type, status, local_amount, local_currency,
     merchant_name, counterparty_type, expense_classification, source_app, reference_id, note)
  VALUES
    (v_plan.customer_user_id, v_ican, 'transfer_out', 'transfer_out', 'completed', p_amount, v_plan.currency,
     'Installment plan ' || v_plan.code, 'business', 'personal_expense', 'digital-city-era',
     'INSPAY-' || p_payment::TEXT,
     format('Installment payment held for plan %s (released to the seller only when you collect or it is delivered)', v_plan.code));

  UPDATE public.installment_plans
     SET paid_amount = paid_amount + p_amount, held_ican = held_ican + v_ican, updated_at = now(),
         status = CASE
                    WHEN paid_amount + p_amount >= items_amount AND fulfilment IS NULL THEN 'ready'
                    WHEN status = 'awaiting_deposit' THEN 'active'
                    ELSE status END
   WHERE id = p_plan;

  PERFORM public._inst_event(p_plan, 'payment', p_amount,
    CASE p_method WHEN 'wallet' THEN 'Paid from IcanEra wallet' ELSE 'Paid with Mobile Money, card or bank' END);
END;
$$;

-- Hand p_ican back to the customer's wallet (refund, price drop, release).
CREATE OR REPLACE FUNCTION public._inst_return_to_wallet(p_plan UUID, p_ican NUMERIC, p_note TEXT, p_ref TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user UUID;
  v_code TEXT;
  v_cur TEXT;
  v_price NUMERIC;
BEGIN
  IF p_ican IS NULL OR p_ican <= 0 THEN
    RETURN;
  END IF;
  SELECT customer_user_id, code, currency INTO v_user, v_code, v_cur FROM public.installment_plans WHERE id = p_plan;
  v_price := public._inst_price_safe(v_cur);
  PERFORM public.get_or_create_ican_wallet(v_user);
  UPDATE public.ican_user_wallets
     SET ican_balance = ican_balance + p_ican, total_spent = GREATEST(COALESCE(total_spent, 0) - p_ican, 0)
   WHERE user_id = v_user;
  INSERT INTO public.ican_coin_transactions
    (recipient_user_id, ican_amount, type, transaction_type, status, local_amount, local_currency,
     merchant_name, counterparty_type, expense_classification, source_app, reference_id, note)
  VALUES
    (v_user, p_ican, 'refund', 'refund', 'completed', CASE WHEN v_price IS NULL THEN NULL ELSE ROUND(p_ican * v_price, 2) END, v_cur,
     'Installment plan ' || v_code, 'business', 'refund', 'digital-city-era', p_ref, p_note);
END;
$$;

-- Give back the stock a plan has been holding.
CREATE OR REPLACE FUNCTION public._inst_unreserve(p_plan UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_plan public.installment_plans%ROWTYPE;
  v_line JSONB;
BEGIN
  SELECT * INTO v_plan FROM public.installment_plans WHERE id = p_plan;
  FOR v_line IN SELECT * FROM jsonb_array_elements(v_plan.items) LOOP
    UPDATE public.inventory
       SET reserved_stock = GREATEST(COALESCE(reserved_stock, 0) - (v_line ->> 'quantity')::NUMERIC, 0), updated_at = now()
     WHERE product_id = (v_line ->> 'product_id')::UUID AND supermarket_id = v_plan.supermarket_id;
  END LOOP;
END;
$$;

-- Close a plan that will not be fulfilled: stock back, money back (less the
-- cancel fee when p_fee_pct > 0 — that fee goes to the seller's business wallet).
CREATE OR REPLACE FUNCTION public._inst_close(p_plan UUID, p_status TEXT, p_reason TEXT, p_fee_pct NUMERIC)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_plan public.installment_plans%ROWTYPE;
  v_fee_amount NUMERIC := 0;
  v_fee_ican NUMERIC := 0;
  v_back_ican NUMERIC;
BEGIN
  SELECT * INTO v_plan FROM public.installment_plans WHERE id = p_plan FOR UPDATE;
  IF v_plan.status NOT IN ('awaiting_deposit','active','ready','shipping_pending') THEN
    RAISE EXCEPTION 'This plan can no longer be cancelled';
  END IF;

  PERFORM public._inst_unreserve(p_plan);

  IF p_fee_pct > 0 AND v_plan.held_ican > 0 THEN
    v_fee_ican := LEAST(ROUND(v_plan.held_ican * p_fee_pct / 100, 8), v_plan.held_ican);
    -- shown in the plan's currency as the same share of what was PAID (the coins themselves are what moves)
    v_fee_amount  := ROUND(v_plan.paid_amount * v_fee_ican / v_plan.held_ican, 2);
    IF v_fee_ican > 0 THEN
      PERFORM public.ican_settle_business_wallet_income(
        v_plan.reseller_business_profile_id, v_fee_ican, 'digital-city-era', 'INSFEE-' || v_plan.code,
        'other_income', format('Cancel fee — installment plan %s', v_plan.code),
        jsonb_build_object('plan_code', v_plan.code, 'reason', p_reason));
    END IF;
  END IF;

  v_back_ican := v_plan.held_ican - v_fee_ican;
  PERFORM public._inst_return_to_wallet(p_plan, v_back_ican,
    format('Installment plan %s %s — your payments returned', v_plan.code, p_status), 'INSREF-' || v_plan.code);

  UPDATE public.installment_plans
     SET status = p_status, cancel_reason = p_reason, held_ican = 0,
         refunded_amount = v_plan.paid_amount - v_fee_amount, cancel_fee_amount = v_fee_amount,
         updated_at = now(), closed_at = now()
   WHERE id = p_plan;
  PERFORM public._inst_event(p_plan, p_status, v_plan.paid_amount - v_fee_amount,
    CASE WHEN v_fee_amount > 0 THEN format('Returned to your wallet as icaneracoin, after a cancel fee of %s', public._inst_money(v_fee_amount, v_plan.currency)) ELSE 'Returned to your wallet as icaneracoin, in full' END);

  RETURN jsonb_build_object('success', true, 'status', p_status,
    'refunded_amount', v_plan.paid_amount - v_fee_amount, 'cancel_fee_amount', v_fee_amount, 'refunded_ican', v_back_ican, 'currency', v_plan.currency);
END;
$$;

-- Switch auth.uid() to the plan's customer for the rest of the transaction
-- (the Edge Function runs as service_role; dropship_checkout needs a user).
CREATE OR REPLACE FUNCTION public._inst_act_as(p_user UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_user::TEXT, TRUE);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', p_user::TEXT, 'role', 'authenticated')::TEXT, TRUE);
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. Terms and quote (open to everyone: prices are already public)
-- ----------------------------------------------------------------------------

-- The terms for a currency: thresholds from the settings (written in UGX) converted to it at the coin's price,
-- the coin price itself, the rounding unit and whether delivery is offered (see _inst_delivery_quote).
DROP FUNCTION IF EXISTS public.installment_terms();
CREATE OR REPLACE FUNCTION public.installment_terms(p_currency TEXT DEFAULT 'UGX')
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cur TEXT := upper(COALESCE(NULLIF(btrim(p_currency), ''), 'UGX'));
  v_price NUMERIC := public._inst_price(v_cur);
BEGIN
  RETURN jsonb_build_object(
    'currency', v_cur,
    'coin_price', v_price,
    'unit', public._inst_unit(v_cur, v_price),
    'delivery_available', v_cur = 'UGX',
    'min_order_amount', public._inst_from_ugx(public._inst_cfg('min_order_ugx', 20000), v_cur, v_price),
    'min_payment_amount', public._inst_from_ugx(public._inst_cfg('min_payment_ugx', 1000), v_cur, v_price),
    'min_deposit_pct', public._inst_cfg('min_deposit_pct', 20),
    'max_installments', public._inst_cfg('max_installments', 6),
    'max_plan_days', public._inst_cfg('max_plan_days', 90),
    'grace_days', public._inst_cfg('grace_days', 7),
    'cancel_fee_pct', public._inst_cfg('cancel_fee_pct', 5),
    'cooling_off_hours', public._inst_cfg('cooling_off_hours', 24),
    'frequencies_days', jsonb_build_array(7, 14, 30),
    'gateway_fee_pct', COALESCE((SELECT LEAST(GREATEST(NULLIF(value, '')::NUMERIC, 0), 20) FROM public.guest_checkout_config WHERE key = 'gateway_fee_pct'), 3.5)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.installment_quote(p_reseller_business_profile_id UUID, p_cart JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_priced JSONB;
  v_terms JSONB;
  v_items NUMERIC;
  v_min_dep NUMERIC;
BEGIN
  v_priced := public._inst_price_cart(p_reseller_business_profile_id, p_cart, FALSE);
  v_terms := public.installment_terms(v_priced ->> 'currency');
  v_items := (v_priced ->> 'items_amount')::NUMERIC;
  v_min_dep := CEIL(v_items * (v_terms ->> 'min_deposit_pct')::NUMERIC / 100 / (v_terms ->> 'unit')::NUMERIC) * (v_terms ->> 'unit')::NUMERIC;
  RETURN jsonb_build_object(
    'success', true,
    'eligible', v_items >= (v_terms ->> 'min_order_amount')::NUMERIC,
    'currency', v_terms ->> 'currency',
    'coin_price', (v_terms ->> 'coin_price')::NUMERIC,
    'items_amount', v_items,
    'min_deposit_amount', v_min_dep,
    'lines', v_priced -> 'lines',
    'terms', v_terms,
    -- a shop priced in another currency than the signed-in buyer's own is "abroad": it ships to them (unknown while signed out)
    'cross_border', CASE WHEN auth.uid() IS NULL THEN NULL ELSE upper(public.ican_user_currency(auth.uid())) <> (v_terms ->> 'currency') END,
    'buyer_currency', CASE WHEN auth.uid() IS NULL THEN NULL ELSE upper(public.ican_user_currency(auth.uid())) END
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. Start a plan (needs an account) — reserves stock and takes the deposit
--    from the IcanEra wallet, or leaves it awaiting a Mobile Money deposit.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.installment_create(
  p_reseller_business_profile_id UUID,
  p_cart            JSONB,
  p_installments    INTEGER,
  p_frequency_days  INTEGER,
  p_deposit_amount     NUMERIC,
  p_pay_with        TEXT DEFAULT 'wallet',     -- 'wallet' | 'flutterwave'
  p_customer_name   TEXT DEFAULT NULL,
  p_customer_phone  TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_terms JSONB;
  v_priced JSONB;
  v_items NUMERIC;
  v_min_dep NUMERIC;
  v_min_pay NUMERIC;
  v_cur TEXT;
  v_price NUMERIC;
  v_unit NUMERIC;
  v_buyer_cur TEXT;
  v_max_n INTEGER := public._inst_cfg('max_installments', 6)::INTEGER;
  v_max_days INTEGER := public._inst_cfg('max_plan_days', 90)::INTEGER;
  v_supermarket UUID;
  v_store RECORD;
  v_plan public.installment_plans%ROWTYPE;
  v_line JSONB;
  v_pay UUID;
  v_name TEXT;
  v_phone TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Create a free IcanEra account or sign in to pay in instalments';
  END IF;
  IF p_pay_with NOT IN ('wallet', 'flutterwave') THEN
    RAISE EXCEPTION 'Choose how to pay the deposit';
  END IF;
  IF p_installments IS NULL OR p_installments < 0 OR p_installments > v_max_n THEN
    RAISE EXCEPTION 'Choose between 1 and % payments after the deposit, or pay in full', v_max_n;
  END IF;
  IF p_frequency_days IS NULL OR p_frequency_days NOT IN (7, 14, 30) THEN
    RAISE EXCEPTION 'Payments can be weekly, every two weeks or monthly';
  END IF;
  IF p_installments * p_frequency_days > v_max_days THEN
    RAISE EXCEPTION 'A plan must be paid in full within % days — choose fewer or more frequent payments', v_max_days;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.business_profiles WHERE id = p_reseller_business_profile_id) THEN
    RAISE EXCEPTION 'Storefront not found';
  END IF;
  IF NOT public._inst_accounts_enabled(p_reseller_business_profile_id) THEN
    RAISE EXCEPTION 'This business is not offering instalments right now';
  END IF;

  v_priced := public._inst_price_cart(p_reseller_business_profile_id, p_cart, TRUE);
  v_items := (v_priced ->> 'items_amount')::NUMERIC;
  v_supermarket := (v_priced ->> 'supermarket_id')::UUID;
  v_cur := v_priced ->> 'currency';
  v_terms := public.installment_terms(v_cur);     -- raises a clear message if that currency's coin price is unavailable
  v_price := (v_terms ->> 'coin_price')::NUMERIC;
  v_unit := (v_terms ->> 'unit')::NUMERIC;
  v_min_pay := (v_terms ->> 'min_payment_amount')::NUMERIC;

  IF v_items < (v_terms ->> 'min_order_amount')::NUMERIC THEN
    RAISE EXCEPTION 'Instalments start from % — pay this order in full instead', public._inst_money((v_terms ->> 'min_order_amount')::NUMERIC, v_cur);
  END IF;

  v_min_dep := CEIL(v_items * (v_terms ->> 'min_deposit_pct')::NUMERIC / 100 / v_unit) * v_unit;
  IF p_deposit_amount IS NULL OR p_deposit_amount < v_min_dep THEN
    RAISE EXCEPTION 'The deposit must be at least %', public._inst_money(v_min_dep, v_cur);
  END IF;
  IF p_installments = 0 AND p_deposit_amount <> v_items THEN
    RAISE EXCEPTION 'To pay in full, the payment is the whole amount: %', public._inst_money(v_items, v_cur);
  END IF;
  IF (v_items - p_deposit_amount) < p_installments * v_min_pay THEN
    RAISE EXCEPTION 'The deposit is too large for % further payments — choose fewer payments or a smaller deposit', p_installments;
  END IF;

  SELECT s.owner_user_id, s.pichin_business_profile_id INTO v_store FROM public.supermarkets s WHERE s.id = v_supermarket;
  IF v_store.owner_user_id IS NULL OR v_store.pichin_business_profile_id IS NULL THEN
    RAISE EXCEPTION 'This store can''t take orders yet';
  END IF;

  -- A store pricing in another currency than the buyer's is abroad for them: it ships (see installment_choose_shipping).
  v_buyer_cur := upper(COALESCE(public.ican_user_currency(v_uid), 'USD'));

  SELECT full_name, phone INTO v_name, v_phone FROM public.users WHERE id = v_uid LIMIT 1;
  v_name  := COALESCE(NULLIF(btrim(p_customer_name), ''), v_name);
  v_phone := COALESCE(NULLIF(btrim(p_customer_phone), ''), v_phone);

  INSERT INTO public.installment_plans (
    code, customer_user_id, customer_name, customer_phone, reseller_business_profile_id, supermarket_id, currency, unit, cross_border, buyer_currency,
    cart, items, items_amount, store_amount, margin_amount, deposit_amount, n_installments, frequency_days, final_due_at
  ) VALUES (
    public._inst_new_code(), v_uid, v_name, v_phone, p_reseller_business_profile_id, v_supermarket, v_cur, v_unit, v_cur <> v_buyer_cur, v_buyer_cur,
    (SELECT jsonb_agg(jsonb_build_object('product_id', l ->> 'product_id', 'quantity', (l ->> 'quantity')::NUMERIC))
       FROM jsonb_array_elements(v_priced -> 'lines') l),
    v_priced -> 'lines', v_items, (v_priced ->> 'store_amount')::NUMERIC, (v_priced ->> 'margin_amount')::NUMERIC,
    p_deposit_amount, p_installments, p_frequency_days, now() + (GREATEST(p_installments, 1) * p_frequency_days || ' days')::INTERVAL
  ) RETURNING * INTO v_plan;

  -- Reserve the stock for the life of the plan.
  FOR v_line IN SELECT * FROM jsonb_array_elements(v_plan.items) LOOP
    UPDATE public.inventory
       SET reserved_stock = COALESCE(reserved_stock, 0) + (v_line ->> 'quantity')::NUMERIC, updated_at = now()
     WHERE product_id = (v_line ->> 'product_id')::UUID AND supermarket_id = v_supermarket;
  END LOOP;

  -- Paying a business in instalments makes the buyer one of its tracked customers.
  PERFORM public.business_site_join(p_reseller_business_profile_id, 'installment');

  PERFORM public._inst_event(v_plan.id, 'created', v_items,
    format('Deposit of %s, then %s payment%s', public._inst_money(p_deposit_amount, v_cur), p_installments, CASE WHEN p_installments = 1 THEN '' ELSE 's' END));

  IF p_pay_with = 'wallet' THEN
    INSERT INTO public.installment_payments (plan_id, customer_user_id, kind, method, amount, currency, coin_price, ican_amount, charge_amount, status, paid_amount, paid_at)
    VALUES (v_plan.id, v_uid, 'installment', 'wallet', p_deposit_amount, v_cur, v_price, public._inst_ican(p_deposit_amount, v_price), p_deposit_amount, 'paid', p_deposit_amount, now())
    RETURNING id INTO v_pay;
    PERFORM public._inst_hold(v_plan.id, p_deposit_amount, 'wallet', v_pay);
  END IF;

  RETURN jsonb_build_object('success', true, 'code', v_plan.code, 'plan_id', v_plan.id,
    'deposit_pending', p_pay_with <> 'wallet', 'deposit_amount', p_deposit_amount, 'items_amount', v_items, 'currency', v_cur, 'cross_border', v_cur <> v_buyer_cur);
END;
$$;

-- ----------------------------------------------------------------------------
-- 6. Paying more
-- ----------------------------------------------------------------------------

-- Validates an amount against the plan and says which kind of payment it is.
CREATE OR REPLACE FUNCTION public._inst_check_amount(p public.installment_plans, p_amount NUMERIC, p_price NUMERIC DEFAULT NULL)
RETURNS TEXT LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_balance NUMERIC := (p.items_amount + p.delivery_fee_amount) - p.paid_amount;
  v_min NUMERIC;
BEGIN
  v_min := LEAST(public._inst_from_ugx(public._inst_cfg('min_payment_ugx', 1000), p.currency, COALESCE(p_price, public._inst_price(p.currency))), v_balance);
  IF p.status NOT IN ('awaiting_deposit', 'active') THEN
    RAISE EXCEPTION 'This plan is not taking payments';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Enter an amount to pay';
  END IF;
  IF p_amount > v_balance THEN
    RAISE EXCEPTION 'That is more than the remaining balance of %', public._inst_money(v_balance, p.currency);
  END IF;
  IF p.fulfilment = 'delivery' AND p.paid_amount >= p.items_amount THEN
    IF p_amount <> v_balance THEN
      RAISE EXCEPTION 'Pay the delivery fee of % in one go', public._inst_money(v_balance, p.currency);
    END IF;
    RETURN 'delivery_fee';
  END IF;
  IF p.status = 'awaiting_deposit' AND p_amount < p.deposit_amount THEN
    RAISE EXCEPTION 'The deposit is %', public._inst_money(p.deposit_amount, p.currency);
  END IF;
  IF p_amount < v_min THEN
    RAISE EXCEPTION 'The smallest payment is %', public._inst_money(v_min, p.currency);
  END IF;
  RETURN 'installment';
END;
$$;

-- After money lands: a delivery plan with nothing left to pay goes out now.
CREATE OR REPLACE FUNCTION public._inst_after_payment(p_plan UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_plan public.installment_plans%ROWTYPE;
BEGIN
  SELECT * INTO v_plan FROM public.installment_plans WHERE id = p_plan FOR UPDATE;
  IF v_plan.fulfilment = 'delivery' AND v_plan.status = 'active' AND v_plan.paid_amount >= v_plan.items_amount + v_plan.delivery_fee_amount THEN
    RETURN public._inst_dispatch(p_plan);
  END IF;
  RETURN jsonb_build_object('status', v_plan.status);
END;
$$;

CREATE OR REPLACE FUNCTION public.installment_pay_wallet(p_code TEXT, p_amount NUMERIC)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_plan public.installment_plans%ROWTYPE;
  v_kind TEXT;
  v_pay UUID;
  v_after JSONB;
  v_price NUMERIC;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Sign in to pay'; END IF;
  SELECT * INTO v_plan FROM public.installment_plans WHERE code = upper(btrim(p_code)) AND customer_user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Plan not found'; END IF;

  v_price := public._inst_price(v_plan.currency);       -- the coin's price in the plan's currency, right now
  v_kind := public._inst_check_amount(v_plan, p_amount, v_price);
  INSERT INTO public.installment_payments (plan_id, customer_user_id, kind, method, amount, currency, coin_price, ican_amount, charge_amount, status, paid_amount, paid_at)
  VALUES (v_plan.id, v_uid, v_kind, 'wallet', p_amount, v_plan.currency, v_price, public._inst_ican(p_amount, v_price), p_amount, 'paid', p_amount, now())
  RETURNING id INTO v_pay;
  PERFORM public._inst_hold(v_plan.id, p_amount, 'wallet', v_pay);
  v_after := public._inst_after_payment(v_plan.id);
  RETURN jsonb_build_object('success', true, 'paid_amount', p_amount) || COALESCE(v_after, '{}'::JSONB);
END;
$$;

-- Mobile Money / card / bank, step 1: price the payment and remember it.
CREATE OR REPLACE FUNCTION public.installment_pay_start(p_code TEXT, p_amount NUMERIC, p_dry_run BOOLEAN DEFAULT FALSE)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_plan public.installment_plans%ROWTYPE;
  v_kind TEXT;
  v_fee_pct NUMERIC;
  v_charge NUMERIC;
  v_ref TEXT;
  v_price NUMERIC;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Sign in to pay'; END IF;
  SELECT * INTO v_plan FROM public.installment_plans WHERE code = upper(btrim(p_code)) AND customer_user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Plan not found'; END IF;
  v_price := public._inst_price(v_plan.currency);
  v_kind := public._inst_check_amount(v_plan, p_amount, v_price);

  SELECT LEAST(GREATEST(COALESCE(NULLIF(value, '')::NUMERIC, 0), 0), 20) INTO v_fee_pct FROM public.guest_checkout_config WHERE key = 'gateway_fee_pct';
  v_fee_pct := COALESCE(v_fee_pct, 3.5);
  v_charge  := CEIL((p_amount / (1 - v_fee_pct / 100)) / v_plan.unit) * v_plan.unit;

  IF NOT p_dry_run THEN
    v_ref := 'INS-' || upper(substr(replace(gen_random_uuid()::TEXT, '-', ''), 1, 20));
    INSERT INTO public.installment_payments (plan_id, customer_user_id, kind, method, amount, currency, coin_price, ican_amount, processing_fee_amount, charge_amount, tx_ref, status)
    VALUES (v_plan.id, v_uid, v_kind, 'flutterwave', p_amount, v_plan.currency, v_price, public._inst_ican(p_amount, v_price), v_charge - p_amount, v_charge, v_ref, 'awaiting_payment');
  END IF;

  RETURN jsonb_build_object('success', true, 'tx_ref', v_ref, 'kind', v_kind, 'amount', p_amount, 'currency', v_plan.currency,
    'coin_price', v_price, 'ican_amount', public._inst_ican(p_amount, v_price),
    'processing_fee_amount', v_charge - p_amount, 'processing_fee_pct', v_fee_pct, 'charge_amount', v_charge);
END;
$$;

-- Step 2 (service_role only, called by the installment-pay Edge Function once
-- Flutterwave has confirmed the payment): turn the verified money into wallet
-- coins and apply them to the plan. All-or-nothing: on any failure nothing is
-- kept and the function says the payment must be refunded.
CREATE OR REPLACE FUNCTION public.installment_fulfil_payment(p_tx_ref TEXT, p_flw_transaction_id TEXT, p_paid_amount NUMERIC)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pay public.installment_payments%ROWTYPE;
  v_plan public.installment_plans%ROWTYPE;
  v_buy JSONB;
  v_after JSONB;
  v_err TEXT;
  v_kind TEXT;
BEGIN
  SELECT * INTO v_pay FROM public.installment_payments WHERE tx_ref = p_tx_ref FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Payment not found');
  END IF;
  IF v_pay.status = 'paid' THEN
    RETURN jsonb_build_object('success', true, 'already_processed', true, 'code', (SELECT code FROM public.installment_plans WHERE id = v_pay.plan_id));
  END IF;
  IF v_pay.status IN ('failed', 'refunded') THEN
    RETURN jsonb_build_object('success', false, 'status', v_pay.status, 'error', COALESCE(v_pay.error, 'This payment could not be completed'));
  END IF;
  IF p_paid_amount IS NULL OR p_paid_amount < v_pay.charge_amount - (CASE WHEN upper(v_pay.currency) = 'UGX' THEN 1 ELSE 0.005 END) THEN
    RETURN jsonb_build_object('success', false, 'error', 'The amount paid is less than the amount due');
  END IF;

  BEGIN
    SELECT * INTO v_plan FROM public.installment_plans WHERE id = v_pay.plan_id FOR UPDATE;
    -- Re-check against the plan as it is now (it may have been cancelled, or
    -- paid up some other way, while the customer was on the payment page).
    v_kind := public._inst_check_amount(v_plan, v_pay.amount, v_pay.coin_price);

    -- The coins were priced when the customer started paying: mint exactly those.
    v_buy := public.buy_ican_coins(v_pay.customer_user_id, v_pay.ican_amount, 'digital-city-era', 'INS-' || p_tx_ref);
    IF NOT COALESCE((v_buy ->> 'success')::BOOLEAN, FALSE) THEN
      RAISE EXCEPTION '%', COALESCE(v_buy ->> 'error', 'Could not credit the payment');
    END IF;

    PERFORM public._inst_hold(v_plan.id, v_pay.amount, 'flutterwave', v_pay.id);
    UPDATE public.installment_payments
       SET kind = v_kind, status = 'paid', flw_transaction_id = p_flw_transaction_id, paid_amount = p_paid_amount,
           paid_at = now(), error = NULL
     WHERE id = v_pay.id;

    PERFORM public._inst_act_as(v_pay.customer_user_id);
    v_after := public._inst_after_payment(v_plan.id);
    PERFORM set_config('request.jwt.claim.sub', '', TRUE);
    PERFORM set_config('request.jwt.claims', '', TRUE);
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
    UPDATE public.installment_payments
       SET status = 'failed', error = v_err, flw_transaction_id = p_flw_transaction_id, paid_amount = p_paid_amount
     WHERE id = v_pay.id;
    RETURN jsonb_build_object('success', false, 'status', 'failed', 'error', v_err, 'refund_required', TRUE);
  END;

  RETURN jsonb_build_object('success', true, 'code', v_plan.code, 'paid_amount', v_pay.amount,
    'processing_fee_amount', v_pay.processing_fee_amount, 'charged_amount', p_paid_amount) || COALESCE(v_after, '{}'::JSONB);
END;
$$;

CREATE OR REPLACE FUNCTION public.installment_mark_refunded(p_tx_ref TEXT, p_note TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.installment_payments
     SET status = 'refunded', refund_note = p_note
   WHERE tx_ref = p_tx_ref AND status IN ('failed', 'awaiting_payment');
$$;

-- ----------------------------------------------------------------------------
-- 7. Collect: a pickup receipt the store scans, releasing the money
-- ----------------------------------------------------------------------------

-- The sale becomes real: the reservation turns into stock leaving the shelf, recorded the way dropship_checkout
-- records it (register_number 'DROPSHIP' keeps the shared inventory trigger from deducting stock twice).
-- Returns what the callers need: the dropship order, the receipt numbers and the store.
CREATE OR REPLACE FUNCTION public._inst_record_sale(p_plan UUID, p_transport TEXT, p_delivery_address TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_plan public.installment_plans%ROWTYPE;
  v_store RECORD;
  v_reseller_name TEXT;
  v_line JSONB;
  v_tx_record TEXT;
  v_cust_rcpt TEXT;
  v_store_rcpt TEXT;
  v_tx_id UUID;
  v_order_id UUID;
  v_snapshot JSONB := '[]'::JSONB;
  v_store_snapshot JSONB := '[]'::JSONB;
  v_tax_total NUMERIC := 0;
  v_wholesale NUMERIC := 0;
BEGIN
  SELECT * INTO v_plan FROM public.installment_plans WHERE id = p_plan;
  SELECT s.owner_user_id, COALESCE(NULLIF(s.name, ''), NULLIF(s.location, ''), 'Store') AS store_name,
         COALESCE(NULLIF(s.address, ''), NULLIF(s.location, '')) AS store_address, s.pichin_business_profile_id AS store_business
    INTO v_store FROM public.supermarkets s WHERE s.id = v_plan.supermarket_id;
  SELECT business_name INTO v_reseller_name FROM public.business_profiles WHERE id = v_plan.reseller_business_profile_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(v_plan.items) LOOP
    UPDATE public.inventory
       SET current_stock = current_stock - (v_line ->> 'quantity')::NUMERIC,
           reserved_stock = GREATEST(COALESCE(reserved_stock, 0) - (v_line ->> 'quantity')::NUMERIC, 0), updated_at = now()
     WHERE product_id = (v_line ->> 'product_id')::UUID AND supermarket_id = v_plan.supermarket_id;
    v_tax_total := v_tax_total + (v_line ->> 'tax_amount')::NUMERIC;
    v_wholesale := v_wholesale + ROUND((v_line ->> 'wholesale_price')::NUMERIC * (v_line ->> 'quantity')::NUMERIC, 2);
    v_snapshot := v_snapshot || jsonb_build_object(
      'product_id', v_line ->> 'product_id', 'product_name', v_line ->> 'name', 'product_sku', v_line ->> 'sku',
      'quantity', (v_line ->> 'quantity')::NUMERIC, 'unit_price', (v_line ->> 'unit_price')::NUMERIC,
      'tax_rate', (v_line ->> 'tax_rate')::NUMERIC, 'line_total', (v_line ->> 'line_total')::NUMERIC);
    v_store_snapshot := v_store_snapshot || jsonb_build_object(
      'product_id', v_line ->> 'product_id', 'product_name', v_line ->> 'name', 'product_sku', v_line ->> 'sku',
      'quantity', (v_line ->> 'quantity')::NUMERIC, 'unit_price', (v_line ->> 'wholesale_price')::NUMERIC,
      'tax_rate', (v_line ->> 'tax_rate')::NUMERIC,
      'line_total', ROUND((v_line ->> 'wholesale_price')::NUMERIC * (v_line ->> 'quantity')::NUMERIC, 2) + (v_line ->> 'tax_amount')::NUMERIC);
  END LOOP;

  v_tx_record  := 'DROPSHIP_' || extract(epoch FROM now())::BIGINT::TEXT || '_' || upper(substr(md5(gen_random_uuid()::TEXT), 1, 6));
  v_cust_rcpt  := 'RCP-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substr(md5(gen_random_uuid()::TEXT), 1, 8));
  v_store_rcpt := 'RCP-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substr(md5(gen_random_uuid()::TEXT), 1, 8));

  INSERT INTO public.transactions (
    transaction_id, receipt_number, cashier_id, cashier_name, register_number, store_location, supermarket_id,
    subtotal, tax_amount, tax_rate, total_amount, payment_method, customer_name, customer_phone,
    customer_user_id, items_count, items, status, created_at
  ) VALUES (
    v_tx_record, v_cust_rcpt, v_plan.customer_user_id, COALESCE(v_plan.customer_name, 'Dropship Customer'), 'DROPSHIP',
    COALESCE(v_reseller_name, 'Dropship'), v_plan.supermarket_id,
    v_plan.items_amount - v_tax_total, v_tax_total,
    CASE WHEN v_plan.items_amount > v_tax_total THEN ROUND((v_tax_total / (v_plan.items_amount - v_tax_total)) * 100, 2) ELSE NULL END,
    v_plan.items_amount, 'ican', COALESCE(v_plan.customer_name, 'Dropship Customer'), v_plan.customer_phone,
    v_plan.customer_user_id, jsonb_array_length(v_plan.items), v_snapshot, 'completed', now()
  ) RETURNING id INTO v_tx_id;

  INSERT INTO public.sales_transaction_items (
    transaction_id, product_id, product_name, product_sku, product_barcode,
    unit_price, quantity, line_total, tax_included, tax_amount
  )
  SELECT v_tx_id, (item ->> 'product_id')::UUID, p.name, p.sku, p.barcode,
         (item ->> 'unit_price')::DECIMAL, (item ->> 'quantity')::DECIMAL, (item ->> 'line_total')::DECIMAL,
         TRUE, (item ->> 'tax_rate')::DECIMAL / 100 * (item ->> 'unit_price')::DECIMAL * (item ->> 'quantity')::DECIMAL
    FROM jsonb_array_elements(v_snapshot) item
    JOIN public.products p ON p.id = (item ->> 'product_id')::UUID;

  INSERT INTO public.receipts (
    receipt_number, transaction_id, cashier_id, cashier_name, customer_name, subtotal, tax_amount, total_amount,
    amount_paid, payment_method, items_json, status, register_id, store_location, created_at
  ) VALUES (
    v_cust_rcpt, v_tx_record, (SELECT user_id FROM public.business_profiles WHERE id = v_plan.reseller_business_profile_id),
    COALESCE(v_reseller_name, 'Reseller'), COALESCE(v_plan.customer_name, 'Dropship Customer'),
    v_plan.items_amount - v_tax_total, v_tax_total, v_plan.items_amount, v_plan.items_amount, 'ican', v_snapshot,
    'completed', 'DROPSHIP', COALESCE(v_reseller_name, 'Dropship'), now()
  );
  INSERT INTO public.receipts (
    receipt_number, transaction_id, cashier_id, cashier_name, customer_name, subtotal, tax_amount, total_amount,
    amount_paid, payment_method, items_json, status, register_id, store_location, created_at
  ) VALUES (
    v_store_rcpt, v_tx_record, v_store.owner_user_id, v_store.store_name,
    format('Dropship via %s', COALESCE(v_reseller_name, 'reseller')),
    v_wholesale, v_tax_total, v_plan.store_amount, v_plan.store_amount, 'ican', v_store_snapshot,
    'completed', 'DROPSHIP', v_store.store_name, now()
  );

  INSERT INTO public.dropship_orders (
    transaction_id, reseller_business_profile_id, supermarket_id, wholesale_amount, reseller_margin_amount,
    customer_paid_amount, customer_receipt_number, store_receipt_number, transport_provider, transport_status,
    pickup_address, delivery_address, delivery_fee_amount, status
  ) VALUES (
    v_tx_record, v_plan.reseller_business_profile_id, v_plan.supermarket_id, v_plan.store_amount, v_plan.margin_amount,
    v_plan.items_amount, v_cust_rcpt, v_store_rcpt, p_transport, 'not_requested',
    COALESCE(v_store.store_address, v_store.store_name), p_delivery_address, 0, 'pending_dispatch'
  ) RETURNING id INTO v_order_id;

  RETURN jsonb_build_object('order_id', v_order_id, 'customer_receipt', v_cust_rcpt, 'store_receipt', v_store_rcpt,
    'store_owner', v_store.owner_user_id, 'store_name', v_store.store_name, 'store_address', v_store.store_address,
    'store_business', v_store.store_business, 'reseller_name', v_reseller_name);
END;
$$;

-- The held coins, split between the store (its wholesale + tax) and the reseller (their margin) in the proportion
-- of the price. Proportional, so nothing is ever left over or short whatever currency the plan was in.
CREATE OR REPLACE FUNCTION public._inst_split(p_plan public.installment_plans)
RETURNS JSONB LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'store_ican',  CASE WHEN p_plan.margin_amount > 0 THEN ROUND(p_plan.held_ican * p_plan.store_amount / p_plan.items_amount, 8) ELSE p_plan.held_ican END,
    'margin_ican', CASE WHEN p_plan.margin_amount > 0 THEN p_plan.held_ican - ROUND(p_plan.held_ican * p_plan.store_amount / p_plan.items_amount, 8) ELSE 0 END);
$$;

CREATE OR REPLACE FUNCTION public.installment_choose_pickup(p_code TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_plan public.installment_plans%ROWTYPE;
  v_sale JSONB;
  v_split JSONB;
  v_legs JSONB;
  v_receipt JSONB;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Sign in first'; END IF;
  SELECT * INTO v_plan FROM public.installment_plans WHERE code = upper(btrim(p_code)) AND customer_user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Plan not found'; END IF;
  IF v_plan.status <> 'ready' THEN
    RAISE EXCEPTION '%', CASE WHEN v_plan.status IN ('awaiting_deposit', 'active') THEN 'Finish paying for your items first' ELSE 'This plan is already arranged' END;
  END IF;
  IF v_plan.cross_border THEN
    RAISE EXCEPTION 'This store is in another country, so it ships to you — choose shipping instead of collecting';
  END IF;

  v_sale := public._inst_record_sale(v_plan.id, 'pickup', NULL);
  v_split := public._inst_split(v_plan);

  -- The legs the store's seal scan will release: coins the plan holds, never more.
  v_legs := jsonb_build_array(jsonb_build_object(
    'payee_type', 'business', 'payee_id', v_sale ->> 'store_business', 'ican_amount', (v_split ->> 'store_ican')::NUMERIC,
    'local_amount', v_plan.store_amount, 'currency', v_plan.currency,
    'note', format('Installment sale via %s | receipt %s', COALESCE(v_sale ->> 'reseller_name', 'reseller'), v_sale ->> 'store_receipt')));
  IF (v_split ->> 'margin_ican')::NUMERIC > 0 THEN
    v_legs := v_legs || jsonb_build_array(jsonb_build_object(
      'payee_type', 'business', 'payee_id', v_plan.reseller_business_profile_id, 'ican_amount', (v_split ->> 'margin_ican')::NUMERIC,
      'local_amount', v_plan.margin_amount, 'currency', v_plan.currency,
      'note', format('Installment commission | %s | receipt %s', v_sale ->> 'store_name', v_sale ->> 'customer_receipt')));
  END IF;

  v_receipt := public.icanera_create_delivery_receipt(
    'digital-city-era', 'dropship_order', (v_sale ->> 'order_id')::UUID, v_uid, (v_sale ->> 'store_owner')::UUID, NULL,
    v_sale ->> 'store_name', format('%s item(s) via %s — collect at the store', jsonb_array_length(v_plan.items), COALESCE(v_sale ->> 'reseller_name', 'reseller')),
    v_plan.held_ican, NULL, v_legs, NULL);

  UPDATE public.installment_plans
     SET status = 'pickup_ready', fulfilment = 'pickup', dropship_order_id = (v_sale ->> 'order_id')::UUID,
         receipt_code = v_receipt ->> 'verification_code', held_ican = 0, updated_at = now()
   WHERE id = v_plan.id;
  PERFORM public._inst_event(v_plan.id, 'pickup_ready', NULL, 'Show your pickup code at ' || (v_sale ->> 'store_name'));

  RETURN jsonb_build_object('success', true, 'status', 'pickup_ready', 'pickup_code', v_receipt ->> 'verification_code',
    'verify_url', v_receipt ->> 'verify_url', 'store_name', v_sale ->> 'store_name', 'store_address', v_sale ->> 'store_address');
END;
$$;

-- ----------------------------------------------------------------------------
-- 7b. Shipping from abroad. A store in another country can't be collected from and no local rider can bring the
--     goods, so once the items are paid in full the buyer gives a shipping address and the SELLER ships (carrier +
--     tracking number). The money stays held in the plan until the buyer confirms it arrived; if they never answer
--     it is released ship_auto_release_days after shipping, and if they report a problem it stays held until the
--     seller refunds or support decides. A paid order the seller never ships is refunded in full after
--     ship_deadline_days.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.installment_choose_shipping(p_code TEXT, p_address JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_plan public.installment_plans%ROWTYPE;
  v_addr JSONB;
  v_key TEXT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Sign in first'; END IF;
  SELECT * INTO v_plan FROM public.installment_plans WHERE code = upper(btrim(p_code)) AND customer_user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Plan not found'; END IF;
  IF NOT v_plan.cross_border THEN
    RAISE EXCEPTION 'This store is in your own country — collect from it or have it delivered';
  END IF;
  IF v_plan.status <> 'ready' THEN
    RAISE EXCEPTION '%', CASE WHEN v_plan.status IN ('awaiting_deposit', 'active') THEN 'Finish paying for your items first' ELSE 'This plan is already arranged' END;
  END IF;
  IF p_address IS NULL OR jsonb_typeof(p_address) <> 'object' THEN
    RAISE EXCEPTION 'Enter your shipping address';
  END IF;
  -- Keep only the known fields, trimmed and bounded: this is shown to the seller and printed on a parcel.
  v_addr := '{}'::JSONB;
  FOREACH v_key IN ARRAY ARRAY['name', 'phone', 'line1', 'line2', 'city', 'region', 'postal_code', 'country', 'note'] LOOP
    IF NULLIF(btrim(COALESCE(p_address ->> v_key, '')), '') IS NOT NULL THEN
      v_addr := v_addr || jsonb_build_object(v_key, left(btrim(p_address ->> v_key), CASE WHEN v_key = 'note' THEN 300 ELSE 160 END));
    END IF;
  END LOOP;
  FOREACH v_key IN ARRAY ARRAY['name', 'phone', 'line1', 'city', 'country'] LOOP
    IF NOT (v_addr ? v_key) THEN
      RAISE EXCEPTION 'Your shipping address needs your %', CASE v_key WHEN 'line1' THEN 'street address' WHEN 'name' THEN 'full name' ELSE v_key END;
    END IF;
  END LOOP;

  UPDATE public.installment_plans
     SET fulfilment = 'ship', shipping = v_addr, status = 'shipping_pending', shipping_chosen_at = now(), updated_at = now()
   WHERE id = v_plan.id;
  PERFORM public._inst_event(v_plan.id, 'shipping_chosen', NULL, 'Shipping to ' || (v_addr ->> 'city') || ', ' || (v_addr ->> 'country'));
  RETURN jsonb_build_object('success', true, 'status', 'shipping_pending');
END;
$$;

-- Seller side: the parcel has gone. Stock leaves the shelf, the buyer gets the tracking details.
CREATE OR REPLACE FUNCTION public.installment_seller_ship(p_code TEXT, p_carrier TEXT, p_tracking_no TEXT, p_tracking_url TEXT DEFAULT NULL, p_eta_days INTEGER DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_plan public.installment_plans%ROWTYPE;
  v_sale JSONB;
  v_url TEXT := NULLIF(btrim(COALESCE(p_tracking_url, '')), '');
BEGIN
  SELECT * INTO v_plan FROM public.installment_plans WHERE code = upper(btrim(p_code)) FOR UPDATE;
  IF NOT FOUND OR NOT public.unified_business_member(v_plan.reseller_business_profile_id) THEN
    RAISE EXCEPTION 'Plan not found';
  END IF;
  IF v_plan.status <> 'shipping_pending' THEN
    RAISE EXCEPTION 'This order is not waiting to be shipped';
  END IF;
  IF NULLIF(btrim(COALESCE(p_carrier, '')), '') IS NULL OR NULLIF(btrim(COALESCE(p_tracking_no, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Enter the carrier and the tracking number';
  END IF;
  IF v_url IS NOT NULL AND v_url !~* '^https?://' THEN
    RAISE EXCEPTION 'The tracking link must start with http:// or https://';
  END IF;

  v_sale := public._inst_record_sale(v_plan.id, 'international_shipping', concat_ws(', ', v_plan.shipping ->> 'line1', v_plan.shipping ->> 'city', v_plan.shipping ->> 'country'));
  UPDATE public.installment_plans
     SET status = 'shipped', shipped_at = now(), dropship_order_id = (v_sale ->> 'order_id')::UUID, updated_at = now(),
         shipment = jsonb_strip_nulls(jsonb_build_object('carrier', left(btrim(p_carrier), 80), 'tracking_no', left(btrim(p_tracking_no), 120),
                    'tracking_url', v_url, 'eta_days', p_eta_days, 'shipped_at', now()))
   WHERE id = v_plan.id;
  PERFORM public._inst_event(v_plan.id, 'shipped', NULL, format('Shipped with %s — tracking %s', left(btrim(p_carrier), 80), left(btrim(p_tracking_no), 120)));
  RETURN jsonb_build_object('success', true, 'status', 'shipped');
END;
$$;

-- The held coins go to the store and the reseller (their business wallets), and the plan is done.
CREATE OR REPLACE FUNCTION public._inst_release_to_sellers(p_plan UUID, p_note TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_plan public.installment_plans%ROWTYPE;
  v_split JSONB;
  v_store_business UUID;
BEGIN
  SELECT * INTO v_plan FROM public.installment_plans WHERE id = p_plan FOR UPDATE;
  SELECT pichin_business_profile_id INTO v_store_business FROM public.supermarkets WHERE id = v_plan.supermarket_id;
  v_split := public._inst_split(v_plan);
  IF (v_split ->> 'store_ican')::NUMERIC > 0 THEN
    PERFORM public.ican_settle_business_wallet_income(v_store_business, (v_split ->> 'store_ican')::NUMERIC, 'digital-city-era',
      'INSREL-S-' || v_plan.code, 'pos_sale', format('Installment sale %s — %s', v_plan.code, p_note), jsonb_build_object('plan_code', v_plan.code));
  END IF;
  IF (v_split ->> 'margin_ican')::NUMERIC > 0 THEN
    PERFORM public.ican_settle_business_wallet_income(v_plan.reseller_business_profile_id, (v_split ->> 'margin_ican')::NUMERIC, 'digital-city-era',
      'INSREL-R-' || v_plan.code, 'pos_sale', format('Installment commission %s — %s', v_plan.code, p_note), jsonb_build_object('plan_code', v_plan.code));
  END IF;
  UPDATE public.installment_plans SET held_ican = 0, status = 'completed', closed_at = now(), updated_at = now() WHERE id = p_plan;
  UPDATE public.dropship_orders SET status = 'completed' WHERE id = v_plan.dropship_order_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.installment_confirm_received(p_code TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_plan public.installment_plans%ROWTYPE;
BEGIN
  SELECT * INTO v_plan FROM public.installment_plans WHERE code = upper(btrim(p_code)) AND customer_user_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Plan not found'; END IF;
  IF v_plan.status NOT IN ('shipped', 'disputed') OR v_plan.shipped_at IS NULL THEN
    RAISE EXCEPTION 'There is nothing to confirm yet — the seller has not shipped this order';
  END IF;
  PERFORM public._inst_release_to_sellers(v_plan.id, 'received by the buyer');
  PERFORM public._inst_event(v_plan.id, 'completed', NULL, 'You confirmed it arrived — the seller has been paid');
  RETURN jsonb_build_object('success', true, 'status', 'completed');
END;
$$;

CREATE OR REPLACE FUNCTION public.installment_report_problem(p_code TEXT, p_note TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_plan public.installment_plans%ROWTYPE;
  v_note TEXT := NULLIF(btrim(COALESCE(p_note, '')), '');
BEGIN
  SELECT * INTO v_plan FROM public.installment_plans WHERE code = upper(btrim(p_code)) AND customer_user_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Plan not found'; END IF;
  IF v_plan.status <> 'shipped' THEN
    RAISE EXCEPTION 'You can report a problem once the seller has shipped the order';
  END IF;
  IF v_note IS NULL OR char_length(v_note) < 10 THEN
    RAISE EXCEPTION 'Tell us what went wrong (a sentence or two)';
  END IF;
  UPDATE public.installment_plans
     SET status = 'disputed', problem = jsonb_build_object('note', left(v_note, 1000), 'at', now()), updated_at = now()
   WHERE id = v_plan.id;
  PERFORM public._inst_event(v_plan.id, 'disputed', NULL, 'You reported a problem — your money stays held while it is sorted out');
  RETURN jsonb_build_object('success', true, 'status', 'disputed');
END;
$$;

-- A shipped order the seller agrees to refund (or support decides to): the buyer gets the held coins back in full.
-- The stock already left the shelf, so it is not restocked automatically.
CREATE OR REPLACE FUNCTION public._inst_refund_shipped(p_plan UUID, p_reason TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_plan public.installment_plans%ROWTYPE;
BEGIN
  SELECT * INTO v_plan FROM public.installment_plans WHERE id = p_plan FOR UPDATE;
  PERFORM public._inst_return_to_wallet(p_plan, v_plan.held_ican,
    format('Installment plan %s refunded — your payments returned', v_plan.code), 'INSREF-' || v_plan.code);
  UPDATE public.installment_plans
     SET status = 'cancelled', cancel_reason = p_reason, refunded_amount = v_plan.paid_amount, cancel_fee_amount = 0,
         held_ican = 0, updated_at = now(), closed_at = now()
   WHERE id = p_plan;
  UPDATE public.dropship_orders SET status = 'refunded' WHERE id = v_plan.dropship_order_id;
  PERFORM public._inst_event(p_plan, 'cancelled', v_plan.paid_amount, 'Refunded to your wallet as icaneracoin, in full');
  RETURN jsonb_build_object('success', true, 'status', 'cancelled', 'refunded_amount', v_plan.paid_amount, 'refunded_ican', v_plan.held_ican, 'currency', v_plan.currency);
END;
$$;

-- Support's decision on a disputed order (service role only): 'refund' the buyer or 'release' the seller.
CREATE OR REPLACE FUNCTION public.installment_admin_resolve(p_code TEXT, p_decision TEXT, p_note TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_plan public.installment_plans%ROWTYPE;
BEGIN
  SELECT * INTO v_plan FROM public.installment_plans WHERE code = upper(btrim(p_code)) FOR UPDATE;
  IF NOT FOUND OR v_plan.status <> 'disputed' THEN RAISE EXCEPTION 'No disputed order with that code'; END IF;
  IF p_decision = 'refund' THEN
    RETURN public._inst_refund_shipped(v_plan.id, COALESCE(NULLIF(btrim(p_note), ''), 'Refunded after review'));
  ELSIF p_decision = 'release' THEN
    PERFORM public._inst_release_to_sellers(v_plan.id, 'released after review');
    PERFORM public._inst_event(v_plan.id, 'completed', NULL, 'Reviewed — the seller has been paid');
    RETURN jsonb_build_object('success', true, 'status', 'completed');
  END IF;
  RAISE EXCEPTION 'Decision must be refund or release';
END;
$$;

-- ----------------------------------------------------------------------------
-- 8. Delivery: quote the real fare, pay it, and the order goes out
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._inst_delivery_quote(
  p_plan public.installment_plans, p_lat NUMERIC, p_lng NUMERIC, p_vehicle_types TEXT[]
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_store RECORD;
  v_rider RECORD;
  v_all_free BOOLEAN := TRUE;
  v_min_cap NUMERIC;
  v_cap NUMERIC;
  v_subsidy NUMERIC;
  v_listing RECORD;
  v_line JSONB;
BEGIN
  -- BodaGoera delivery runs through dropship_checkout, which prices everything in UGX, and a local rider can't cross a border.
  IF p_plan.cross_border THEN
    RAISE EXCEPTION 'This store is in another country — choose shipping instead';
  END IF;
  IF p_plan.currency <> 'UGX' THEN
    RAISE EXCEPTION 'Rider delivery is only available for stores priced in UGX so far — collect from the store instead';
  END IF;
  IF p_lat IS NULL OR p_lng IS NULL THEN
    RAISE EXCEPTION 'Share your delivery location so a rider can be assigned';
  END IF;
  SELECT s.latitude, s.longitude, s.pichin_business_profile_id AS store_business INTO v_store FROM public.supermarkets s WHERE s.id = p_plan.supermarket_id;
  IF v_store.latitude IS NULL OR v_store.longitude IS NULL THEN
    RAISE EXCEPTION 'This store has no pickup location yet, so a rider can''t be routed to it — collect instead';
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_plan.items) LOOP
    SELECT dl.free_delivery, dl.max_delivery_subsidy INTO v_listing FROM public.dropship_listings dl
     WHERE dl.reseller_business_profile_id = p_plan.reseller_business_profile_id AND dl.product_id = (v_line ->> 'product_id')::UUID;
    IF NOT COALESCE(v_listing.free_delivery, FALSE) THEN v_all_free := FALSE; END IF;
    v_min_cap := CASE WHEN v_min_cap IS NULL THEN COALESCE(v_listing.max_delivery_subsidy, 0)
                      ELSE LEAST(v_min_cap, COALESCE(v_listing.max_delivery_subsidy, 0)) END;
  END LOOP;

  SELECT rider_id, full_name, estimated_arrival_min, fare INTO v_rider
    FROM public.dropship_ranked_riders(v_store.store_business, v_store.latitude, v_store.longitude, p_lat, p_lng, p_vehicle_types, 1);
  IF NOT FOUND OR v_rider.rider_id IS NULL THEN
    RAISE EXCEPTION 'No delivery riders are available right now — try again shortly';
  END IF;

  v_cap := CASE WHEN v_all_free THEN v_rider.fare ELSE COALESCE(v_min_cap, 0) END;
  v_subsidy := LEAST(v_cap, v_rider.fare, p_plan.margin_amount);
  RETURN jsonb_build_object('rider_id', v_rider.rider_id, 'rider_name', v_rider.full_name, 'rider_eta_min', v_rider.estimated_arrival_min,
    'real_fare_amount', v_rider.fare, 'subsidy_amount', v_subsidy, 'delivery_fee_amount', v_rider.fare - v_subsidy);
END;
$$;

CREATE OR REPLACE FUNCTION public.installment_delivery_quote(p_code TEXT, p_lat NUMERIC, p_lng NUMERIC, p_vehicle_types TEXT[] DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_plan public.installment_plans%ROWTYPE;
BEGIN
  SELECT * INTO v_plan FROM public.installment_plans WHERE code = upper(btrim(p_code)) AND customer_user_id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'Plan not found'; END IF;
  RETURN jsonb_build_object('success', true) || public._inst_delivery_quote(v_plan, p_lat, p_lng, p_vehicle_types);
END;
$$;

-- Lock in delivery. A free delivery goes out at once; otherwise the plan waits
-- for the fare (one payment of exactly that amount) and goes out the moment it lands.
CREATE OR REPLACE FUNCTION public.installment_choose_delivery(
  p_code TEXT, p_address TEXT, p_lat NUMERIC, p_lng NUMERIC, p_max_hours NUMERIC, p_vehicle_types TEXT[] DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_plan public.installment_plans%ROWTYPE;
  v_quote JSONB;
  v_min_h NUMERIC := public.mbg_get_setting_numeric('delivery.min_deadline_hours', 1);
  v_max_h NUMERIC := public.mbg_get_setting_numeric('delivery.max_deadline_hours', 48);
  v_after JSONB;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Sign in first'; END IF;
  SELECT * INTO v_plan FROM public.installment_plans WHERE code = upper(btrim(p_code)) AND customer_user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Plan not found'; END IF;
  -- Allowed while the items are paid up and no fare has been paid yet (so it can be changed).
  IF NOT (v_plan.status = 'ready' OR (v_plan.status = 'active' AND v_plan.fulfilment IS NOT DISTINCT FROM 'delivery' AND v_plan.paid_amount <= v_plan.items_amount)) THEN
    RAISE EXCEPTION '%', CASE WHEN v_plan.status IN ('awaiting_deposit', 'active') THEN 'Finish paying for your items first' ELSE 'This plan is already arranged' END;
  END IF;
  IF p_max_hours IS NULL OR p_max_hours < v_min_h OR p_max_hours > v_max_h THEN
    RAISE EXCEPTION 'Delivery window must be between % and % hours', v_min_h, v_max_h;
  END IF;

  v_quote := public._inst_delivery_quote(v_plan, p_lat, p_lng, p_vehicle_types);
  UPDATE public.installment_plans
     SET fulfilment = 'delivery', delivery_fee_amount = (v_quote ->> 'delivery_fee_amount')::NUMERIC,
         delivery = jsonb_build_object('address', NULLIF(btrim(p_address), ''), 'lat', p_lat, 'lng', p_lng, 'max_hours', p_max_hours,
                                       'vehicle_types', p_vehicle_types, 'rider_id', v_quote ->> 'rider_id',
                                       'real_fare_amount', (v_quote ->> 'real_fare_amount')::NUMERIC),
         status = 'active',   -- a free delivery is dispatched just below; otherwise it waits for the fare
         updated_at = now()
   WHERE id = v_plan.id;
  PERFORM public._inst_event(v_plan.id, 'delivery_chosen', (v_quote ->> 'delivery_fee_amount')::NUMERIC, 'Delivery chosen');

  IF (v_quote ->> 'delivery_fee_amount')::NUMERIC = 0 THEN
    v_after := public._inst_dispatch(v_plan.id);
  END IF;
  RETURN jsonb_build_object('success', true) || v_quote || COALESCE(v_after, '{}'::JSONB);
END;
$$;

-- Back to "ready" (to collect instead, or to pick another place) before any fare is paid.
CREATE OR REPLACE FUNCTION public.installment_clear_delivery(p_code TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_plan public.installment_plans%ROWTYPE;
BEGIN
  SELECT * INTO v_plan FROM public.installment_plans WHERE code = upper(btrim(p_code)) AND customer_user_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Plan not found'; END IF;
  IF v_plan.fulfilment IS DISTINCT FROM 'delivery' OR v_plan.status <> 'active' OR v_plan.paid_amount > v_plan.items_amount THEN
    RAISE EXCEPTION 'Nothing to change';
  END IF;
  UPDATE public.installment_plans SET fulfilment = NULL, delivery = NULL, delivery_fee_amount = 0, status = 'ready', updated_at = now() WHERE id = v_plan.id;
  RETURN jsonb_build_object('success', true, 'status', 'ready');
END;
$$;

-- Everything is paid: release the held funds to the customer's wallet and run
-- the normal dropship_checkout as the customer. Atomic — if it fails for any
-- reason (no rider, stock, a price the store changed) nothing moves.
CREATE OR REPLACE FUNCTION public._inst_dispatch(p_plan UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_plan public.installment_plans%ROWTYPE;
  v_prev_sub TEXT := current_setting('request.jwt.claim.sub', TRUE);
  v_prev_claims TEXT := current_setting('request.jwt.claims', TRUE);
  v_d JSONB;
  v_res JSONB;
  v_line JSONB;
  v_cushion NUMERIC := 0.000001;
  v_buy JSONB;
BEGIN
  SELECT * INTO v_plan FROM public.installment_plans WHERE id = p_plan FOR UPDATE;
  IF v_plan.status <> 'active' OR v_plan.fulfilment <> 'delivery' THEN
    RETURN jsonb_build_object('status', v_plan.status);
  END IF;
  v_d := v_plan.delivery;

  -- The reservation becomes the real sale inside dropship_checkout.
  PERFORM public._inst_unreserve(p_plan);

  -- Held funds back to the wallet (+ a one-millionth-ICAN rounding cushion,
  -- as guest checkout does) so dropship_checkout can debit them as the customer.
  PERFORM public._inst_return_to_wallet(p_plan, v_plan.held_ican,
    format('Installment plan %s paid in full — releasing to pay your order', v_plan.code), 'INSREL-' || v_plan.code);
  v_buy := public.buy_ican_coins(v_plan.customer_user_id, v_cushion, 'digital-city-era', 'INSCUSH-' || v_plan.code);

  PERFORM public._inst_act_as(v_plan.customer_user_id);
  BEGIN
    v_res := public.dropship_checkout(
      v_plan.reseller_business_profile_id, v_plan.cart, v_plan.customer_name, v_plan.customer_phone,
      v_d ->> 'address', NULL, (v_d ->> 'lat')::NUMERIC, (v_d ->> 'lng')::NUMERIC, (v_d ->> 'max_hours')::NUMERIC,
      NULLIF(v_d ->> 'rider_id', '')::UUID,
      CASE WHEN v_d -> 'vehicle_types' IS NULL OR jsonb_typeof(v_d -> 'vehicle_types') <> 'array' THEN NULL
           ELSE ARRAY(SELECT jsonb_array_elements_text(v_d -> 'vehicle_types')) END);
  EXCEPTION WHEN OTHERS THEN
    -- The quoted rider may have gone: let the server pick the nearest instead.
    IF SQLERRM ILIKE '%no longer available%' THEN
      v_res := public.dropship_checkout(
        v_plan.reseller_business_profile_id, v_plan.cart, v_plan.customer_name, v_plan.customer_phone,
        v_d ->> 'address', NULL, (v_d ->> 'lat')::NUMERIC, (v_d ->> 'lng')::NUMERIC, (v_d ->> 'max_hours')::NUMERIC,
        NULL,
        CASE WHEN v_d -> 'vehicle_types' IS NULL OR jsonb_typeof(v_d -> 'vehicle_types') <> 'array' THEN NULL
             ELSE ARRAY(SELECT jsonb_array_elements_text(v_d -> 'vehicle_types')) END);
    ELSE
      RAISE;
    END IF;
  END;
  PERFORM set_config('request.jwt.claim.sub', COALESCE(v_prev_sub, ''), TRUE);
  PERFORM set_config('request.jwt.claims', COALESCE(v_prev_claims, ''), TRUE);

  IF NOT COALESCE((v_res ->> 'success')::BOOLEAN, FALSE) THEN
    RAISE EXCEPTION '%', COALESCE(v_res ->> 'error', 'The order could not be placed');
  END IF;
  IF (v_res ->> 'customer_paid_total')::NUMERIC > v_plan.paid_amount + 1 THEN
    RAISE EXCEPTION 'The delivery price changed since it was quoted — choose delivery again to see the new fare. You have not been charged.';
  END IF;

  UPDATE public.installment_plans
     SET status = 'dispatched', held_ican = 0, dropship_order_id = (v_res ->> 'dropship_order_id')::UUID,
         receipt_code = v_res ->> 'verification_code', updated_at = now(),
         delivery = v_plan.delivery || jsonb_build_object('final_fee_amount', (v_res ->> 'delivery_fee')::NUMERIC, 'verify_url', v_res ->> 'verify_url')
   WHERE id = p_plan;
  PERFORM public._inst_event(p_plan, 'dispatched', (v_res ->> 'customer_paid_total')::NUMERIC, 'A rider has been booked');

  RETURN jsonb_build_object('status', 'dispatched', 'receipt_code', v_res ->> 'verification_code',
    'verify_url', v_res ->> 'verify_url', 'customer_receipt_number', v_res ->> 'customer_receipt_number');
END;
$$;

-- ----------------------------------------------------------------------------
-- 9. Cancel (customer or seller) and the nightly sweep
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.installment_cancel(p_code TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_plan public.installment_plans%ROWTYPE;
  v_pct NUMERIC;
BEGIN
  SELECT * INTO v_plan FROM public.installment_plans WHERE code = upper(btrim(p_code)) AND customer_user_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Plan not found'; END IF;
  -- Fee-free inside the cooling-off window, and when nothing was ever paid.
  v_pct := CASE WHEN now() <= v_plan.created_at + (public._inst_cfg('cooling_off_hours', 24) || ' hours')::INTERVAL THEN 0
                ELSE public._inst_cfg('cancel_fee_pct', 5) END;
  RETURN public._inst_close(v_plan.id, 'cancelled', 'Cancelled by the customer', v_pct);
END;
$$;

-- The seller can always cancel (out of stock, can't supply) — fee-free.
CREATE OR REPLACE FUNCTION public.installment_seller_cancel(p_code TEXT, p_reason TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_plan public.installment_plans%ROWTYPE;
BEGIN
  SELECT * INTO v_plan FROM public.installment_plans WHERE code = upper(btrim(p_code)) FOR UPDATE;
  IF NOT FOUND OR NOT public.unified_business_member(v_plan.reseller_business_profile_id) THEN
    RAISE EXCEPTION 'Plan not found';
  END IF;
  IF v_plan.status IN ('shipped', 'disputed') THEN
    RETURN public._inst_refund_shipped(v_plan.id, COALESCE(NULLIF(btrim(p_reason), ''), 'Refunded by the seller'));
  END IF;
  RETURN public._inst_close(v_plan.id, 'cancelled', COALESCE(NULLIF(btrim(p_reason), ''), 'Cancelled by the seller'), 0);
END;
$$;

-- service_role / pg_cron: free unpaid deposits and lapse plans that ran out of time.
CREATE OR REPLACE FUNCTION public.installment_run_due()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r RECORD;
  v_released INT := 0;
  v_lapsed INT := 0;
  v_unshipped INT := 0;
  v_auto INT := 0;
BEGIN
  FOR r IN
    SELECT id FROM public.installment_plans
     WHERE status = 'awaiting_deposit'
       AND created_at < now() - (public._inst_cfg('deposit_hold_hours', 2) || ' hours')::INTERVAL
       -- a Mobile Money payment may still be in flight for a few minutes
       AND NOT EXISTS (SELECT 1 FROM public.installment_payments pm WHERE pm.plan_id = installment_plans.id AND pm.status = 'awaiting_payment' AND pm.created_at > now() - interval '30 minutes')
  LOOP
    PERFORM public._inst_close(r.id, 'cancelled', 'The deposit was not paid in time', 0);
    v_released := v_released + 1;
  END LOOP;

  FOR r IN
    SELECT id FROM public.installment_plans
     WHERE status IN ('active', 'ready')
       AND final_due_at + (public._inst_cfg('grace_days', 7) || ' days')::INTERVAL < now()
       -- A plan that is fully paid and waiting for the customer to choose is not lapsed for dithering;
       -- it just sits (the stock stays reserved) until they decide or the seller cancels.
       AND NOT (status = 'ready' OR (fulfilment = 'delivery' AND paid_amount >= items_amount))
  LOOP
    PERFORM public._inst_close(r.id, 'lapsed', 'Not paid in full by the last due date', public._inst_cfg('cancel_fee_pct', 5));
    v_lapsed := v_lapsed + 1;
  END LOOP;

  -- Cross-border: a paid order the seller never shipped is refunded in full ...
  FOR r IN
    SELECT id FROM public.installment_plans
     WHERE status = 'shipping_pending'
       AND shipping_chosen_at + (public._inst_cfg('ship_deadline_days', 14) || ' days')::INTERVAL < now()
  LOOP
    PERFORM public._inst_close(r.id, 'cancelled', 'The seller did not ship in time — you have been refunded in full', 0);
    v_unshipped := v_unshipped + 1;
  END LOOP;

  -- ... and a shipped order nobody confirmed or disputed pays the seller after the protection period.
  FOR r IN
    SELECT id FROM public.installment_plans
     WHERE status = 'shipped'
       AND shipped_at + (public._inst_cfg('ship_auto_release_days', 30) || ' days')::INTERVAL < now()
  LOOP
    PERFORM public._inst_release_to_sellers(r.id, 'released automatically after the protection period');
    PERFORM public._inst_event(r.id, 'completed', NULL, 'No problem was reported — the seller has been paid');
    v_auto := v_auto + 1;
  END LOOP;

  RETURN jsonb_build_object('released_deposits', v_released, 'lapsed', v_lapsed, 'unshipped_refunded', v_unshipped, 'auto_released', v_auto);
END;
$$;

-- ----------------------------------------------------------------------------
-- 10. Reading plans
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._inst_json(p public.installment_plans, p_with_detail BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_store RECORD;
  v_seller TEXT;
  v_balance NUMERIC := (p.items_amount + p.delivery_fee_amount) - p.paid_amount;
  v_rcpt_status TEXT;
  v_out JSONB;
  v_cooling BOOLEAN := now() <= p.created_at + (public._inst_cfg('cooling_off_hours', 24) || ' hours')::INTERVAL;
  v_fee_pct NUMERIC := CASE WHEN now() <= p.created_at + (public._inst_cfg('cooling_off_hours', 24) || ' hours')::INTERVAL THEN 0 ELSE public._inst_cfg('cancel_fee_pct', 5) END;
BEGIN
  SELECT COALESCE(NULLIF(s.name, ''), NULLIF(s.location, ''), 'Store') AS name, COALESCE(NULLIF(s.address, ''), NULLIF(s.location, '')) AS address,
         s.latitude, s.longitude INTO v_store FROM public.supermarkets s WHERE s.id = p.supermarket_id;
  SELECT business_name INTO v_seller FROM public.business_profiles WHERE id = p.reseller_business_profile_id;
  IF p.receipt_code IS NOT NULL THEN
    SELECT status INTO v_rcpt_status FROM public.icanera_delivery_receipts WHERE verification_code = p.receipt_code;
  END IF;

  v_out := jsonb_build_object(
    'id', p.id, 'code', p.code, 'status', p.status, 'fulfilment', p.fulfilment,
    'items', p.items, 'items_amount', p.items_amount, 'delivery_fee_amount', p.delivery_fee_amount,
    'total_amount', p.items_amount + p.delivery_fee_amount, 'paid_amount', p.paid_amount, 'balance_amount', GREATEST(v_balance, 0),
    'deposit_amount', p.deposit_amount, 'n_installments', p.n_installments, 'frequency_days', p.frequency_days,
    'final_due_at', p.final_due_at, 'created_at', p.created_at, 'closed_at', p.closed_at,
    'seller_id', p.reseller_business_profile_id, 'seller_name', v_seller,
    'store_name', v_store.name, 'store_address', v_store.address,
    'customer_name', p.customer_name, 'customer_phone', p.customer_phone,
    'pickup_code', CASE WHEN p.fulfilment = 'pickup' THEN p.receipt_code END,
    'receipt_code', p.receipt_code, 'receipt_status', v_rcpt_status,
    'verify_url', CASE WHEN p.receipt_code IS NOT NULL THEN 'https://bodagoera.icanera.space/verify/' || p.receipt_code END,
    'delivery', p.delivery, 'cancel_reason', p.cancel_reason, 'refunded_amount', p.refunded_amount, 'cancel_fee_amount', p.cancel_fee_amount,
    'currency', p.currency, 'unit', p.unit, 'coin_price', public._inst_price_safe(p.currency), 'held_ican', p.held_ican,
    'cross_border', p.cross_border, 'buyer_currency', p.buyer_currency,
    'pickup_available', NOT p.cross_border, 'delivery_available', (NOT p.cross_border AND p.currency = 'UGX'), 'ship_available', p.cross_border,
    'shipping', p.shipping, 'shipment', p.shipment, 'problem', p.problem, 'shipped_at', p.shipped_at,
    'auto_release_at', CASE WHEN p.status = 'shipped' THEN p.shipped_at + (public._inst_cfg('ship_auto_release_days', 30) || ' days')::INTERVAL END,
    'ship_deadline_at', CASE WHEN p.status = 'shipping_pending' THEN p.shipping_chosen_at + (public._inst_cfg('ship_deadline_days', 14) || ' days')::INTERVAL END,
    'schedule', public._inst_schedule(p),
    'can_cancel', p.status IN ('awaiting_deposit', 'active', 'ready', 'shipping_pending'),
    'cancel_fee_pct_now', v_fee_pct, 'in_cooling_off', v_cooling,
    'cancel_fee_amount_now', ROUND(p.paid_amount * v_fee_pct / 100, 2)
  );
  IF p_with_detail THEN
    v_out := v_out || jsonb_build_object(
      'payments', COALESCE((SELECT jsonb_agg(jsonb_build_object('amount', amount, 'kind', kind, 'method', method,
                    'processing_fee_amount', processing_fee_amount, 'at', paid_at) ORDER BY paid_at)
                    FROM public.installment_payments WHERE plan_id = p.id AND status = 'paid'), '[]'::JSONB),
      'events', COALESCE((SELECT jsonb_agg(jsonb_build_object('kind', kind, 'amount', amount, 'note', note, 'at', at) ORDER BY at, id)
                    FROM public.installment_events WHERE plan_id = p.id), '[]'::JSONB));
  END IF;
  RETURN v_out;
END;
$$;

-- Once the store has scanned the pickup (or the delivery is done), reflect it.
CREATE OR REPLACE FUNCTION public._inst_sync(p_plan UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_plan public.installment_plans%ROWTYPE;
  v_status TEXT;
BEGIN
  SELECT * INTO v_plan FROM public.installment_plans WHERE id = p_plan FOR UPDATE;
  IF v_plan.receipt_code IS NULL OR v_plan.status NOT IN ('pickup_ready', 'dispatched') THEN RETURN; END IF;
  SELECT status INTO v_status FROM public.icanera_delivery_receipts WHERE verification_code = v_plan.receipt_code;
  IF v_plan.status = 'pickup_ready' AND v_status IN ('picked_up', 'delivered') THEN
    UPDATE public.installment_plans SET status = 'completed', closed_at = now(), updated_at = now() WHERE id = p_plan;
    UPDATE public.dropship_orders SET status = 'completed' WHERE id = v_plan.dropship_order_id;
    PERFORM public._inst_event(p_plan, 'completed', NULL, 'Collected');
  ELSIF v_plan.status = 'dispatched' AND v_status = 'delivered' THEN
    UPDATE public.installment_plans SET status = 'completed', closed_at = now(), updated_at = now() WHERE id = p_plan;
    PERFORM public._inst_event(p_plan, 'completed', NULL, 'Delivered');
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.installment_get(p_code TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_plan public.installment_plans%ROWTYPE;
BEGIN
  SELECT * INTO v_plan FROM public.installment_plans WHERE code = upper(btrim(p_code))
     AND (customer_user_id = auth.uid() OR public.unified_business_member(reseller_business_profile_id));
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Plan not found');
  END IF;
  PERFORM public._inst_sync(v_plan.id);
  SELECT * INTO v_plan FROM public.installment_plans WHERE id = v_plan.id;
  RETURN jsonb_build_object('success', true, 'plan', public._inst_json(v_plan, TRUE), 'terms', public.installment_terms(v_plan.currency));
END;
$$;

CREATE OR REPLACE FUNCTION public.installment_my_plans()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r public.installment_plans%ROWTYPE;
  v_out JSONB := '[]'::JSONB;
BEGIN
  IF auth.uid() IS NULL THEN RETURN '[]'::JSONB; END IF;
  FOR r IN SELECT * FROM public.installment_plans WHERE customer_user_id = auth.uid() AND status IN ('pickup_ready', 'dispatched') LOOP
    PERFORM public._inst_sync(r.id);
  END LOOP;
  FOR r IN SELECT * FROM public.installment_plans WHERE customer_user_id = auth.uid() ORDER BY created_at DESC LIMIT 100 LOOP
    v_out := v_out || jsonb_build_array(public._inst_json(r, FALSE));
  END LOOP;
  RETURN v_out;
END;
$$;

-- Seller dashboard: who owes what, and who is waiting to collect.
CREATE OR REPLACE FUNCTION public.installment_seller_plans(p_business_profile_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r public.installment_plans%ROWTYPE;
  v_out JSONB := '[]'::JSONB;
BEGIN
  IF NOT public.unified_business_member(p_business_profile_id) THEN
    RAISE EXCEPTION 'Business access required';
  END IF;
  FOR r IN SELECT * FROM public.installment_plans WHERE reseller_business_profile_id = p_business_profile_id AND status IN ('pickup_ready', 'dispatched') LOOP
    PERFORM public._inst_sync(r.id);
  END LOOP;
  FOR r IN SELECT * FROM public.installment_plans WHERE reseller_business_profile_id = p_business_profile_id ORDER BY created_at DESC LIMIT 200 LOOP
    v_out := v_out || jsonb_build_array(public._inst_json(r, FALSE));
  END LOOP;
  RETURN v_out;
END;
$$;

-- Admin / audit: the value the open plans are holding.
CREATE OR REPLACE FUNCTION public.installment_escrow_ican()
RETURNS NUMERIC LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(SUM(held_ican), 0) FROM public.installment_plans WHERE status IN ('awaiting_deposit', 'active', 'ready', 'pickup_ready', 'shipping_pending', 'shipped', 'disputed');
$$;

-- ----------------------------------------------------------------------------
-- 11. Price lock: a listing with an open plan can't go up in price or be switched off.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_installment_price_lock()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (NEW.listed_price > OLD.listed_price OR (OLD.is_active AND NOT NEW.is_active))
     AND EXISTS (
       SELECT 1 FROM public.installment_plans p, jsonb_array_elements(p.cart) c
        WHERE p.reseller_business_profile_id = NEW.reseller_business_profile_id
          AND p.status IN ('awaiting_deposit', 'active', 'ready', 'shipping_pending')
          AND (c ->> 'product_id')::UUID = NEW.product_id) THEN
    RAISE EXCEPTION 'Customers are paying for this item in instalments — its price can''t be raised or the listing switched off until their plans are finished or cancelled';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_installment_price_lock ON public.dropship_listings;
CREATE TRIGGER trg_installment_price_lock BEFORE UPDATE ON public.dropship_listings
  FOR EACH ROW EXECUTE FUNCTION public.fn_installment_price_lock();

-- ----------------------------------------------------------------------------
-- 11c. Finding things to pay for — like get_dropship_browsable_products / get_dropship_product_offers /
--      get_dropship_storefront, but every row says which currency it is priced in and whether it would have to be
--      shipped from abroad for the person looking. (Those older functions return bare numbers.)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.installment_browse_products(p_query TEXT DEFAULT '', p_limit INTEGER DEFAULT 40)
RETURNS TABLE (
  product_id UUID, name TEXT, images JSONB, currency TEXT, store_country TEXT, cross_border BOOLEAN,
  min_price NUMERIC, reseller_count BIGINT, any_free_delivery BOOLEAN, any_in_stock BOOLEAN
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH me AS (SELECT CASE WHEN auth.uid() IS NULL THEN NULL ELSE upper(public.ican_user_currency(auth.uid())) END AS cur)
  SELECT p.id, p.name::TEXT, p.images,
         upper(COALESCE(NULLIF(btrim(s.price_currency), ''), 'UGX')) AS currency,
         NULLIF(btrim(s.country), '') AS store_country,
         CASE WHEN (SELECT cur FROM me) IS NULL THEN NULL
              ELSE upper(COALESCE(NULLIF(btrim(s.price_currency), ''), 'UGX')) <> (SELECT cur FROM me) END AS cross_border,
         MIN(dl.listed_price), COUNT(*), BOOL_OR(dl.free_delivery),
         BOOL_OR(GREATEST(COALESCE(inv.current_stock - COALESCE(inv.reserved_stock, 0), 0), 0) > 0)
    FROM public.dropship_listings dl
    JOIN public.products p ON p.id = dl.product_id
    JOIN public.supermarkets s ON s.id = dl.supermarket_id
    LEFT JOIN public.inventory inv ON inv.product_id = p.id AND inv.supermarket_id = dl.supermarket_id
   WHERE dl.is_active = TRUE AND (p.is_active IS NULL OR p.is_active = TRUE) AND p.is_dropship_excluded = FALSE
     AND (COALESCE(p_query, '') = '' OR p.name ILIKE '%' || p_query || '%' OR p.sku ILIKE '%' || p_query || '%' OR p.brand ILIKE '%' || p_query || '%')
   GROUP BY p.id, p.name, p.images, s.price_currency, s.country
   ORDER BY p.name
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 40), 1), 100);
$$;

CREATE OR REPLACE FUNCTION public.installment_product_offers(p_product_id UUID)
RETURNS TABLE (
  listing_id UUID, reseller_business_profile_id UUID, reseller_name TEXT, listed_price NUMERIC, currency TEXT,
  free_delivery BOOLEAN, in_stock BOOLEAN
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT dl.id, dl.reseller_business_profile_id, bp.business_name::TEXT, dl.listed_price,
         upper(COALESCE(NULLIF(btrim(s.price_currency), ''), 'UGX')), dl.free_delivery,
         GREATEST(COALESCE(inv.current_stock - COALESCE(inv.reserved_stock, 0), 0), 0) > 0
    FROM public.dropship_listings dl
    JOIN public.products p ON p.id = dl.product_id
    JOIN public.supermarkets s ON s.id = dl.supermarket_id
    JOIN public.business_profiles bp ON bp.id = dl.reseller_business_profile_id
    LEFT JOIN public.inventory inv ON inv.product_id = p.id AND inv.supermarket_id = dl.supermarket_id
   WHERE dl.product_id = p_product_id AND dl.is_active = TRUE AND (p.is_active IS NULL OR p.is_active = TRUE) AND p.is_dropship_excluded = FALSE
   ORDER BY dl.listed_price;
$$;

CREATE OR REPLACE FUNCTION public.installment_shelf(p_reseller_business_profile_id UUID)
RETURNS TABLE (
  listing_id UUID, product_id UUID, name TEXT, images JSONB, listed_price NUMERIC, tax_rate NUMERIC, currency TEXT,
  store_country TEXT, cross_border BOOLEAN, available_stock NUMERIC, in_stock BOOLEAN, reseller_name TEXT, free_delivery BOOLEAN
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH me AS (SELECT CASE WHEN auth.uid() IS NULL THEN NULL ELSE upper(public.ican_user_currency(auth.uid())) END AS cur)
  SELECT dl.id, p.id, p.name::TEXT, p.images, dl.listed_price, p.tax_rate,
         upper(COALESCE(NULLIF(btrim(s.price_currency), ''), 'UGX')), NULLIF(btrim(s.country), ''),
         CASE WHEN (SELECT cur FROM me) IS NULL THEN NULL
              ELSE upper(COALESCE(NULLIF(btrim(s.price_currency), ''), 'UGX')) <> (SELECT cur FROM me) END,
         GREATEST(COALESCE(inv.current_stock - COALESCE(inv.reserved_stock, 0), 0), 0),
         GREATEST(COALESCE(inv.current_stock - COALESCE(inv.reserved_stock, 0), 0), 0) > 0,
         bp.business_name::TEXT, dl.free_delivery
    FROM public.dropship_listings dl
    JOIN public.products p ON p.id = dl.product_id
    JOIN public.supermarkets s ON s.id = dl.supermarket_id
    JOIN public.business_profiles bp ON bp.id = dl.reseller_business_profile_id
    LEFT JOIN public.inventory inv ON inv.product_id = p.id AND inv.supermarket_id = dl.supermarket_id
   WHERE dl.reseller_business_profile_id = p_reseller_business_profile_id AND dl.is_active = TRUE
     AND (p.is_active IS NULL OR p.is_active = TRUE) AND p.is_dropship_excluded = FALSE
   ORDER BY p.name;
$$;

-- ----------------------------------------------------------------------------
-- 11b. Customer accounts on business websites
--
-- A business can let visitors create an account on its website (the same free
-- IcanEra account, so the same sign-in works on every site). Registering links
-- the account to THAT business as one of its customers, so
--   * the customer sees every plan and payment they have with it, and
--   * the business sees who its customers are and what each owes / has paid.
-- Switched on by default; the business can turn it off (installments are then
-- not offered on its site, since a plan needs an account to be tracked).
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.business_site_settings (
  business_profile_id UUID PRIMARY KEY REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  accounts_enabled    BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.business_site_customers (
  business_profile_id UUID NOT NULL REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  user_id             UUID NOT NULL,
  full_name           TEXT,
  phone               TEXT,
  source              TEXT NOT NULL DEFAULT 'website',
  joined_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (business_profile_id, user_id)
);
CREATE INDEX IF NOT EXISTS business_site_customers_user_idx ON public.business_site_customers(user_id);

ALTER TABLE public.business_site_settings  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_site_customers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS business_site_customers_read ON public.business_site_customers;
CREATE POLICY business_site_customers_read ON public.business_site_customers FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.unified_business_member(business_profile_id));
REVOKE ALL ON public.business_site_settings, public.business_site_customers FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE ON public.business_site_settings, public.business_site_customers FROM authenticated;
GRANT SELECT ON public.business_site_customers TO authenticated;

CREATE OR REPLACE FUNCTION public._inst_accounts_enabled(p_business UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT accounts_enabled FROM public.business_site_settings WHERE business_profile_id = p_business), TRUE);
$$;

-- Does this business invite sign-ups on its site? (open: the site needs it before anyone is signed in)
CREATE OR REPLACE FUNCTION public.business_site_info(p_business_profile_id UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'found', EXISTS (SELECT 1 FROM public.business_profiles WHERE id = p_business_profile_id),
    'accounts_enabled', public._inst_accounts_enabled(p_business_profile_id),
    'business_name', (SELECT business_name FROM public.business_profiles WHERE id = p_business_profile_id));
$$;

-- Business side: switch customer accounts on or off.
CREATE OR REPLACE FUNCTION public.business_site_set_accounts(p_business_profile_id UUID, p_enabled BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.unified_business_member(p_business_profile_id) THEN
    RAISE EXCEPTION 'Business access required';
  END IF;
  INSERT INTO public.business_site_settings (business_profile_id, accounts_enabled) VALUES (p_business_profile_id, COALESCE(p_enabled, TRUE))
  ON CONFLICT (business_profile_id) DO UPDATE SET accounts_enabled = EXCLUDED.accounts_enabled, updated_at = now();
  RETURN jsonb_build_object('success', true, 'accounts_enabled', COALESCE(p_enabled, TRUE));
END;
$$;

-- Customer side: register as this business's customer (idempotent; called when
-- someone signs up or signs in on the website, and automatically on a plan).
CREATE OR REPLACE FUNCTION public.business_site_join(p_business_profile_id UUID, p_source TEXT DEFAULT 'website')
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_name TEXT;
  v_phone TEXT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Sign in first'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.business_profiles WHERE id = p_business_profile_id) THEN
    RAISE EXCEPTION 'Business not found';
  END IF;
  IF NOT public._inst_accounts_enabled(p_business_profile_id) THEN
    RAISE EXCEPTION 'This business is not taking customer accounts on its website right now';
  END IF;
  SELECT full_name, phone INTO v_name, v_phone FROM public.users WHERE id = v_uid LIMIT 1;
  INSERT INTO public.business_site_customers (business_profile_id, user_id, full_name, phone, source)
  VALUES (p_business_profile_id, v_uid, v_name, v_phone, COALESCE(NULLIF(left(btrim(p_source), 30), ''), 'website'))
  ON CONFLICT (business_profile_id, user_id) DO UPDATE
    SET last_seen_at = now(), full_name = COALESCE(EXCLUDED.full_name, public.business_site_customers.full_name),
        phone = COALESCE(EXCLUDED.phone, public.business_site_customers.phone);
  RETURN jsonb_build_object('success', true);
END;
$$;

-- What a customer has paid / still owes a business, per currency (amounts in different currencies are never added together).
CREATE OR REPLACE FUNCTION public._inst_totals(p_user UUID, p_business UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('currency', t.currency, 'paid_amount', t.paid, 'balance_amount', t.balance) ORDER BY t.currency), '[]'::JSONB)
  FROM (
    SELECT p.currency,
           COALESCE(SUM(p.paid_amount) FILTER (WHERE p.status NOT IN ('cancelled', 'lapsed')), 0) AS paid,
           COALESCE(SUM(GREATEST(p.items_amount + p.delivery_fee_amount - p.paid_amount, 0)) FILTER (WHERE p.status IN ('awaiting_deposit', 'active', 'ready')), 0) AS balance
      FROM public.installment_plans p
     WHERE p.customer_user_id = p_user AND p.reseller_business_profile_id = p_business
     GROUP BY p.currency
  ) t;
$$;

-- Customer side: the businesses I have an account with, and what I owe / have paid each.
CREATE OR REPLACE FUNCTION public.business_site_my_accounts()
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'business_profile_id', c.business_profile_id, 'business_name', bp.business_name, 'joined_at', c.joined_at,
    'plans', (SELECT COUNT(*) FROM public.installment_plans p WHERE p.customer_user_id = c.user_id AND p.reseller_business_profile_id = c.business_profile_id),
    'open_plans', (SELECT COUNT(*) FROM public.installment_plans p WHERE p.customer_user_id = c.user_id AND p.reseller_business_profile_id = c.business_profile_id AND p.status IN ('awaiting_deposit','active','ready','pickup_ready','dispatched','shipping_pending','shipped','disputed')),
    'totals', public._inst_totals(c.user_id, c.business_profile_id)
  ) ORDER BY c.last_seen_at DESC), '[]'::JSONB)
  FROM public.business_site_customers c JOIN public.business_profiles bp ON bp.id = c.business_profile_id
  WHERE c.user_id = auth.uid();
$$;

-- Business side: my customers, with what each has paid and still owes.
CREATE OR REPLACE FUNCTION public.business_site_customers_list(p_business_profile_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.unified_business_member(p_business_profile_id) THEN
    RAISE EXCEPTION 'Business access required';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'user_id', c.user_id, 'full_name', c.full_name, 'phone', c.phone, 'joined_at', c.joined_at, 'last_seen_at', c.last_seen_at,
      'plans', (SELECT COUNT(*) FROM public.installment_plans p WHERE p.customer_user_id = c.user_id AND p.reseller_business_profile_id = c.business_profile_id),
      'open_plans', (SELECT COUNT(*) FROM public.installment_plans p WHERE p.customer_user_id = c.user_id AND p.reseller_business_profile_id = c.business_profile_id AND p.status IN ('awaiting_deposit','active','ready','pickup_ready','dispatched','shipping_pending','shipped','disputed')),
      'totals', public._inst_totals(c.user_id, c.business_profile_id)
    ) ORDER BY c.joined_at DESC)
    FROM public.business_site_customers c WHERE c.business_profile_id = p_business_profile_id), '[]'::JSONB);
END;
$$;

-- ----------------------------------------------------------------------------
-- 12. Grants
-- ----------------------------------------------------------------------------

DO $$
DECLARE
  fn TEXT;
BEGIN
  -- Internal helpers: nobody calls these from the API.
  FOREACH fn IN ARRAY ARRAY[
    '_inst_cfg(text,numeric)', '_inst_ican(numeric,numeric)', '_inst_price(text)', '_inst_price_safe(text)', '_inst_unit(text,numeric)',
    '_inst_from_ugx(numeric,text,numeric)', '_inst_money(numeric,text)', '_inst_record_sale(uuid,text,text)', '_inst_split(public.installment_plans)',
    '_inst_release_to_sellers(uuid,text)', '_inst_refund_shipped(uuid,text)', '_inst_totals(uuid,uuid)', '_inst_event(uuid,text,numeric,text)', '_inst_new_code()',
    '_inst_price_cart(uuid,jsonb,boolean)', '_inst_schedule(public.installment_plans)', '_inst_hold(uuid,numeric,text,uuid)',
    '_inst_return_to_wallet(uuid,numeric,text,text)', '_inst_unreserve(uuid)', '_inst_close(uuid,text,text,numeric)',
    '_inst_act_as(uuid)', '_inst_check_amount(public.installment_plans,numeric,numeric)', '_inst_after_payment(uuid)',
    '_inst_delivery_quote(public.installment_plans,numeric,numeric,text[])', '_inst_dispatch(uuid)',
    '_inst_json(public.installment_plans,boolean)', '_inst_sync(uuid)', 'fn_installment_price_lock()', '_inst_accounts_enabled(uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', fn);
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.installment_terms(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.installment_quote(UUID, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.installment_browse_products(TEXT, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.installment_product_offers(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.installment_shelf(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.installment_terms(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.installment_quote(UUID, JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.installment_browse_products(TEXT, INTEGER) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.installment_product_offers(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.installment_shelf(UUID) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.installment_choose_shipping(TEXT, JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.installment_seller_ship(TEXT, TEXT, TEXT, TEXT, INTEGER) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.installment_confirm_received(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.installment_report_problem(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.installment_choose_shipping(TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.installment_seller_ship(TEXT, TEXT, TEXT, TEXT, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.installment_confirm_received(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.installment_report_problem(TEXT, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.installment_create(UUID, JSONB, INTEGER, INTEGER, NUMERIC, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.installment_pay_wallet(TEXT, NUMERIC) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.installment_pay_start(TEXT, NUMERIC, BOOLEAN) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.installment_choose_pickup(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.installment_delivery_quote(TEXT, NUMERIC, NUMERIC, TEXT[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.installment_choose_delivery(TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.installment_clear_delivery(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.installment_cancel(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.installment_seller_cancel(TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.business_site_info(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.business_site_set_accounts(UUID, BOOLEAN) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.business_site_join(UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.business_site_my_accounts() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.business_site_customers_list(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.business_site_info(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.business_site_set_accounts(UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.business_site_join(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.business_site_my_accounts() TO authenticated;
GRANT EXECUTE ON FUNCTION public.business_site_customers_list(UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.installment_get(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.installment_my_plans() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.installment_seller_plans(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.installment_create(UUID, JSONB, INTEGER, INTEGER, NUMERIC, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.installment_pay_wallet(TEXT, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION public.installment_pay_start(TEXT, NUMERIC, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.installment_choose_pickup(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.installment_delivery_quote(TEXT, NUMERIC, NUMERIC, TEXT[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.installment_choose_delivery(TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.installment_clear_delivery(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.installment_cancel(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.installment_seller_cancel(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.installment_get(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.installment_my_plans() TO authenticated;
GRANT EXECUTE ON FUNCTION public.installment_seller_plans(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.installment_fulfil_payment(TEXT, TEXT, NUMERIC) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.installment_mark_refunded(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.installment_run_due() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.installment_escrow_ican() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.installment_admin_resolve(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.installment_fulfil_payment(TEXT, TEXT, NUMERIC) TO service_role;
GRANT EXECUTE ON FUNCTION public.installment_mark_refunded(TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.installment_run_due() TO service_role;
GRANT EXECUTE ON FUNCTION public.installment_escrow_ican() TO service_role;
GRANT EXECUTE ON FUNCTION public.installment_admin_resolve(TEXT, TEXT, TEXT) TO service_role;

-- ----------------------------------------------------------------------------
-- 13. Hourly sweep (frees unpaid deposits, lapses overdue plans)
-- ----------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule('installment-run-due');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    PERFORM cron.schedule('installment-run-due', '17 * * * *', 'SELECT public.installment_run_due();');
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '✅ Installment orders installed. Last step: deploy the installment-pay Edge Function (supabase functions deploy installment-pay).';
END $$;
