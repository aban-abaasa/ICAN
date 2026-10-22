-- ============================================================================
-- Developer panel: change ICANera's sale fees (dropship 2%, store 1%) without SQL
--
--   public.ican_dev_get_sale_fees(dev_token)              the two fees as they are charged right now + the last changes
--   public.ican_dev_set_sale_fee(dev_token, key, rate)    change one (rate is a fraction: 0.02 = 2%)
--   public.ican_fee_rate_changes                          who changed what, from what to what, when (nobody can edit it)
--
-- Only these two fees can be changed from here: dropship_sale and store_sale (the rows added by 20261107100000_sale_platform_fees.sql).
-- The wallet fees (sending money out, cashing out) stay a SQL-editor change, as FEE_RATES_DEPLOY.md describes.
--
-- WHO MAY CALL: both functions need the panel's dev token like every other ican_dev_* function, AND a signed-in session whose email is
-- on the ican_dev_operators allowlist. The second part matters for a money setting: a support-console link hands its visitor the same
-- dev token (so they can read messages), and the token alone must not be enough to change what ICANera charges. The dev panel always
-- has the operator's own session, so nothing changes for it.
--
-- A change takes effect on the next sale (both checkouts read ican_fee_rates). A rate is a fraction from 0 up to (not including) 1,
-- to six decimal places (the table's own limit); anything else is refused here with a message and by the table as a backstop.
-- Safe to run twice. Roll back with supabase/rollback/20261109_rollback_sale_fees_dev_panel.sql.
-- ============================================================================

DO $guard$
BEGIN
  IF to_regclass('public.ican_fee_rates') IS NULL OR to_regprocedure('public.ican_fee_rate(text)') IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.ican_fee_rates WHERE key = 'dropship_sale')
     OR NOT EXISTS (SELECT 1 FROM public.ican_fee_rates WHERE key = 'store_sale') THEN
    RAISE EXCEPTION 'Run SALE_PLATFORM_FEES_PASTE_INTO_SUPABASE.sql first - it adds the dropship_sale and store_sale rates this panel changes.';
  END IF;
  IF to_regprocedure('public.ican_dev_secret()') IS NULL OR to_regprocedure('public.ican_is_dev_operator()') IS NULL THEN
    RAISE EXCEPTION 'Run supabase/migrations/20261009100000_secure_dev_access.sql first - it sets up the developer allowlist.';
  END IF;
END $guard$;


-- ─── the record of changes ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.ican_fee_rate_changes (
  id         BIGSERIAL PRIMARY KEY,
  key        TEXT NOT NULL,
  old_rate   NUMERIC NOT NULL,
  new_rate   NUMERIC NOT NULL,
  changed_by TEXT,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- no policies and no grants: only the functions below (running as their owner) and the SQL editor can read or write it
ALTER TABLE public.ican_fee_rate_changes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ican_fee_rate_changes FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.ican_fee_rate_changes_id_seq FROM PUBLIC, anon, authenticated;


-- ─── read ────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.ican_dev_get_sale_fees(dev_token TEXT) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF dev_token IS DISTINCT FROM public.ican_dev_secret() OR NOT public.ican_is_dev_operator() THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;
  RETURN jsonb_build_object(
    -- the rate a sale would be charged right now (a deleted row shows its default, which is what the checkouts fall back to)
    'fees', (
      SELECT jsonb_agg(jsonb_build_object(
               'key', d.key, 'rate', public.ican_fee_rate(d.key), 'default_rate', d.default_rate,
               'in_table', r.key IS NOT NULL, 'updated_at', r.updated_at) ORDER BY d.ord)
        FROM (VALUES ('dropship_sale', 0.02::NUMERIC, 1), ('store_sale', 0.01::NUMERIC, 2)) AS d(key, default_rate, ord)
        LEFT JOIN public.ican_fee_rates r ON r.key = d.key),
    'changes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('key', c.key, 'old_rate', c.old_rate, 'new_rate', c.new_rate,
                                          'changed_by', c.changed_by, 'changed_at', c.changed_at) ORDER BY c.id DESC)
        FROM (SELECT * FROM public.ican_fee_rate_changes ORDER BY id DESC LIMIT 10) c), '[]'::JSONB)
  );
END $$;


-- ─── change ──────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.ican_dev_set_sale_fee(dev_token TEXT, p_key TEXT, p_rate NUMERIC) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_old   NUMERIC;
  v_rate  NUMERIC;
  v_label TEXT;
BEGIN
  IF dev_token IS DISTINCT FROM public.ican_dev_secret() OR NOT public.ican_is_dev_operator() THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;
  IF p_key IS NULL OR p_key NOT IN ('dropship_sale', 'store_sale') THEN
    RETURN jsonb_build_object('success', false, 'error', 'That fee cannot be changed here');
  END IF;
  IF p_rate IS NULL OR p_rate < 0 OR p_rate >= 1 THEN
    RETURN jsonb_build_object('success', false, 'error', 'A fee is a share from 0% up to (not including) 100%');
  END IF;

  v_rate := ROUND(p_rate, 6);   -- the table keeps six decimals
  v_old  := public.ican_fee_rate(p_key);
  IF v_rate = v_old AND EXISTS (SELECT 1 FROM public.ican_fee_rates WHERE key = p_key) THEN
    RETURN jsonb_build_object('success', true, 'changed', false, 'key', p_key, 'rate', v_rate);
  END IF;

  v_label := CASE p_key
    WHEN 'dropship_sale' THEN 'ICANera''s cut of every dropship sale - paid by the business, never added to the customer''s total'
    ELSE 'ICANera''s cut of every Digital City Era store sale paid from an IcanEra wallet - paid by the store, never added to the customer''s total'
  END;
  -- upsert: a row someone deleted comes back with the rate chosen here
  INSERT INTO public.ican_fee_rates (key, rate, label) VALUES (p_key, v_rate, v_label)
    ON CONFLICT (key) DO UPDATE SET rate = EXCLUDED.rate;
  INSERT INTO public.ican_fee_rate_changes (key, old_rate, new_rate, changed_by)
    VALUES (p_key, v_old, v_rate, COALESCE(auth.jwt() ->> 'email', 'unknown'));

  RETURN jsonb_build_object('success', true, 'changed', true, 'key', p_key, 'old_rate', v_old, 'rate', v_rate);
END $$;


-- ─── who may call ────────────────────────────────────────────────────────────
-- Supabase grants new functions straight to the API roles and REVOKE ... FROM PUBLIC does not take that back, so anon is revoked by name.
REVOKE ALL ON FUNCTION public.ican_dev_get_sale_fees(TEXT)               FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ican_dev_set_sale_fee(TEXT, TEXT, NUMERIC) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ican_dev_get_sale_fees(TEXT)               TO authenticated;
GRANT EXECUTE ON FUNCTION public.ican_dev_set_sale_fee(TEXT, TEXT, NUMERIC) TO authenticated;

NOTIFY pgrst, 'reload schema';
