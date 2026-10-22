\set ON_ERROR_STOP on
-- A developer has changed both rates; the checkouts are patched. Running the migration again must change none of that.
UPDATE public.ican_fee_rates SET rate = 0.025 WHERE key = 'dropship_sale';
UPDATE public.ican_fee_rates SET rate = 0.015 WHERE key = 'store_sale';
INSERT INTO t.keep VALUES
  ('patched_drop', t.fn_text('public.dropship_checkout(uuid,jsonb,text,text,text,text,numeric,numeric,numeric,uuid,text[])')),
  ('patched_store', t.fn_text('public.customer_self_checkout(jsonb,text,boolean,text)'));
