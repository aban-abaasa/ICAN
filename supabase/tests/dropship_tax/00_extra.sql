-- Added to the sale_fees stand-in world (roles, wallets, shop/dropship tables, BodaGoera, the REAL dropship_checkout is loaded by run.sh):
-- what the guest quote and the instalment functions need. Not a migration.
\set ON_ERROR_STOP on

-- guest checkout: its config table (the quote reads the processing-fee rate from it) and the rider ranking it asks for
CREATE TABLE public.guest_checkout_config (key TEXT PRIMARY KEY, value TEXT NOT NULL, note TEXT);
CREATE FUNCTION public.dropship_ranked_riders(
  p_store_business_profile_id UUID, p_pickup_lat NUMERIC, p_pickup_lng NUMERIC, p_dropoff_lat NUMERIC, p_dropoff_lng NUMERIC,
  p_vehicle_types TEXT[] DEFAULT NULL, p_limit INT DEFAULT 8
) RETURNS TABLE (rider_id UUID, full_name TEXT, rating NUMERIC, vehicle_type TEXT, distance_to_pickup_km NUMERIC,
                 estimated_arrival_min INTEGER, fare NUMERIC, is_store_rider BOOLEAN)
LANGUAGE sql STABLE AS $$ SELECT t.u(141), 'Rider'::TEXT, 4.8::NUMERIC, 'motorcycle'::TEXT, 1.0::NUMERIC, 6, 6000::NUMERIC, TRUE $$;

-- instalments: the plan row _inst_record_sale reads, and the one dropship_orders column it fills that the world does not have
CREATE TABLE public.installment_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), customer_user_id UUID, customer_name TEXT, customer_phone TEXT,
  reseller_business_profile_id UUID, supermarket_id UUID, items JSONB, items_amount NUMERIC, store_amount NUMERIC, margin_amount NUMERIC,
  dropship_order_id UUID, status TEXT DEFAULT 'active');
ALTER TABLE public.dropship_orders ADD COLUMN transport_provider TEXT;

-- the cart every check below buys: 2 x Rice 5kg (shelf price 10,000, 18% VAT), listed at 12,500 by the reseller
CREATE FUNCTION t.cart(p_qty INT DEFAULT 2) RETURNS JSONB LANGUAGE sql AS
  $$ SELECT jsonb_build_array(jsonb_build_object('product_id', t.u(201), 'quantity', p_qty)) $$;
-- what the guest quote says for that cart
CREATE FUNCTION t.guest_quote(p_qty INT DEFAULT 2) RETURNS JSONB LANGUAGE plpgsql AS
  $$ BEGIN RETURN public.guest_checkout_start(t.u(120), t.cart(p_qty), 'Cust', '0700000000', 'Addr', 0.35, 32.58, 24, NULL, TRUE); END $$;
-- a sale's receipts and sale items, by the order's receipt numbers
CREATE FUNCTION t.rec(p_number TEXT) RETURNS public.receipts LANGUAGE sql AS $$ SELECT r FROM public.receipts r WHERE receipt_number = p_number $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA t TO PUBLIC;
