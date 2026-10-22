\set ON_ERROR_STOP on
SET client_min_messages = info;
-- the repo's own FIX_CUSTOMER_SELF_CHECKOUT_TAX_INCLUSIVE.sql copy is tax-included already: the migration must leave it alone
DO $t$
BEGIN
  PERFORM t.check('N1 already tax-included: the function is exactly as it was',
    t.fn_text('public.customer_self_checkout(jsonb,text,boolean,text)') = (SELECT v FROM t.keep WHERE k = 'orig_shop_text'));
END $t$;
