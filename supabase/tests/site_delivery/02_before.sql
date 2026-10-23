-- BEFORE the migration: the real guest_checkout_fulfil cannot place an order for a store product (no listing), and we remember
-- its exact text so the rollback can be compared with it.
\set ON_ERROR_STOP on

INSERT INTO t.keep (k, v) VALUES ('fulfil_md5', md5(pg_get_functiondef('public.guest_checkout_fulfil(text,text,numeric)'::regprocedure)));
INSERT INTO public.guest_checkout_config (key, value) VALUES ('payer_user_id', t.u(999)::TEXT);

INSERT INTO public.guest_checkout_orders
  (tx_ref, reseller_business_profile_id, cart, customer_name, customer_phone, delivery_lat, delivery_lng, max_delivery_hours, rider_id,
   items_ugx, delivery_fee_ugx, order_total_ugx, processing_fee_ugx, charge_ugx)
VALUES ('GCO-BEFORE', t.u(101), jsonb_build_array(jsonb_build_object('product_id', t.u(401), 'quantity', 1)), 'Guest', '0700000000',
        0.35, 32.62, 4, t.u(900), 10000, 3000, 13000, 500, 13500);

DO $$
DECLARE r JSONB;
BEGIN
  r := public.guest_checkout_fulfil('GCO-BEFORE', 'flw-1', 13500);
  PERFORM t.check('before: guest checkout cannot place an order for a store product (it has no listing)',
    (r ->> 'success')::BOOLEAN IS FALSE AND (r ->> 'status') = 'failed' AND (r ->> 'error') ILIKE '%not available from this reseller%', r::TEXT);
END $$;
