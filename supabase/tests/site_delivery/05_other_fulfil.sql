-- A guest_checkout_fulfil that is NOT the version the migration was written for must be left alone (and the storefront must then
-- say guest payment is not on offer), never half-patched.
\set ON_ERROR_STOP on
CREATE OR REPLACE FUNCTION public.guest_checkout_fulfil(p_tx_ref TEXT, p_flw_transaction_id TEXT, p_paid_ugx NUMERIC)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN public.some_other_checkout(p_tx_ref);   -- a different shape: no `v_res := public.dropship_checkout(` here
END $$;
INSERT INTO t.keep (k, v) VALUES ('other_fulfil_md5', md5(pg_get_functiondef('public.guest_checkout_fulfil(text,text,numeric)'::regprocedure)));
