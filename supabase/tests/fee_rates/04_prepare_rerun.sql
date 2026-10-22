\set ON_ERROR_STOP on
-- Before the migration is run a SECOND time: a developer has changed a rate, and the database holds functions the migration
-- does not recognise.
UPDATE public.ican_fee_rates SET rate = 0.02 WHERE key = 'send_bank';
UPDATE public.ican_fee_rates SET rate = 0.015 WHERE key = 'coin_cash_out';

-- an overload whose only 0.03 is not one of the three known statements
CREATE FUNCTION public.resolve_ican_payout(p_odd INT) RETURNS NUMERIC LANGUAGE sql AS $$ SELECT ROUND(5 * 0.03, 2) $$;
-- an overload that MIXES a known statement with an unknown one: must be left whole, not half-changed
CREATE FUNCTION public.sell_ican_coins(p_mixed TEXT) RETURNS NUMERIC LANGUAGE plpgsql AS $$
DECLARE v_ugx_gross NUMERIC := 10;
BEGIN RETURN ROUND(v_ugx_gross * 0.03, 2) + (v_ugx_gross * 0.03); END $$;
