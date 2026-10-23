\set ON_ERROR_STOP on
SET client_min_messages = info;
-- A project without guest checkout or instalments: only dropship_checkout is patched, and nothing complains.
DO $t$
DECLARE d JSONB;
BEGIN
  PERFORM t.check('no guest checkout / instalments installed: nothing of them exists', to_regprocedure('public.guest_checkout_start(uuid,jsonb,text,text,text,numeric,numeric,numeric,text[],boolean)') IS NULL
    AND to_regprocedure('public._inst_price_cart(uuid,jsonb,boolean)') IS NULL);
  d := t.dropship(50, 12500);
  PERFORM t.check('... and dropship is tax-included all the same: 31,000', (d -> 'order' ->> 'customer_paid_amount')::NUMERIC = 31000 AND (d ->> 'debit')::NUMERIC = 6.2, d::TEXT);
END $t$;
