-- The text of every function the migration may touch, as deployed, so the rollback can be compared with it.
\set ON_ERROR_STOP on
INSERT INTO t.keep (k, v)
SELECT 'txt_' || k, t.fn_text(sig) FROM (VALUES
  ('drop',  'public.dropship_checkout(uuid,jsonb,text,text,text,text,numeric,numeric,numeric,uuid,text[])'),
  ('guest', 'public.guest_checkout_start(uuid,jsonb,text,text,text,numeric,numeric,numeric,text[],boolean)'),
  ('price', 'public._inst_price_cart(uuid,jsonb,boolean)'),
  ('sale',  'public._inst_record_sale(uuid,text,text)')
) AS x(k, sig) WHERE to_regprocedure(sig) IS NOT NULL;
