\set ON_ERROR_STOP on
-- the deployed shop checkout as it is now (layout ignored): what a rollback must give back, or what must not change
INSERT INTO t.keep VALUES ('orig_shop_text', t.fn_text('public.customer_self_checkout(jsonb,text,boolean,text)'));
