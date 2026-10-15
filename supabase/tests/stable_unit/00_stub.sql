\set ON_ERROR_STOP on
-- The live currency table also has these two columns (the hourly feed's timestamp and the inflation anchor); the shared
-- icaneracoin test stub does not. Numbers mirror the live table.
ALTER TABLE public.ican_currency_rates ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE public.ican_currency_rates ADD COLUMN IF NOT EXISTS stability_anchor_at TIMESTAMPTZ;
UPDATE public.ican_currency_rates SET stability_anchor_at = '2026-01-01', updated_at = now(),
  local_inflation_pct = CASE currency_code WHEN 'UGX' THEN 3.58 WHEN 'USD' THEN 2.95 WHEN 'KES' THEN 4.07 ELSE 5 END;
UPDATE public.ican_currency_rates SET rate_to_ugx = 4022.802 WHERE currency_code = 'USD';

-- The platform's fee machinery, as the live database has it (backend/ROUTE_PLATFORM_FEES_TO_IWOS_BUSINESS.sql): the coin price in UGX and
-- the credit to the platform fee business (idempotent per source reference; never raises).
CREATE TABLE public.t_fee_credits (id SERIAL PRIMARY KEY, amount_ican NUMERIC, source_app TEXT, source_reference TEXT UNIQUE, fee_type TEXT, actor UUID);
CREATE TABLE public.t_fee_mode (id BOOLEAN PRIMARY KEY DEFAULT TRUE, mode TEXT NOT NULL DEFAULT 'ok', coin_price NUMERIC DEFAULT 5000);
INSERT INTO public.t_fee_mode (id) VALUES (TRUE);
CREATE FUNCTION public.ican_current_price_ugx(p_max_age_s NUMERIC DEFAULT 3) RETURNS NUMERIC LANGUAGE sql STABLE AS $$ SELECT coin_price FROM public.t_fee_mode $$;
CREATE FUNCTION public.fn_credit_platform_fee_to_business(p_amount_ican NUMERIC, p_source_app TEXT, p_source_reference TEXT, p_fee_type TEXT, p_actor_user_id UUID, p_note TEXT DEFAULT '', p_metadata JSONB DEFAULT '{}')
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE m TEXT; n INT;
BEGIN
  SELECT mode INTO m FROM public.t_fee_mode;
  IF m = 'fail' THEN RETURN jsonb_build_object('success', false, 'credited', false, 'error', 'Platform fee recipient business not configured'); END IF;
  IF m = 'raise' THEN RAISE EXCEPTION 'boom'; END IF;
  INSERT INTO public.t_fee_credits (amount_ican, source_app, source_reference, fee_type, actor) VALUES (p_amount_ican, p_source_app, p_source_reference, p_fee_type, p_actor_user_id)
  ON CONFLICT (source_reference) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN jsonb_build_object('success', true, 'credited', n = 1, 'status', CASE WHEN n = 1 THEN 'credited' ELSE 'already_settled' END);
END; $$;
