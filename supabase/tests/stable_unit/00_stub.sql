\set ON_ERROR_STOP on
-- The live currency table also has these two columns (the hourly feed's timestamp and the inflation anchor); the shared
-- icaneracoin test stub does not. Numbers mirror the live table.
ALTER TABLE public.ican_currency_rates ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE public.ican_currency_rates ADD COLUMN IF NOT EXISTS stability_anchor_at TIMESTAMPTZ;
UPDATE public.ican_currency_rates SET stability_anchor_at = '2026-01-01', updated_at = now(),
  local_inflation_pct = CASE currency_code WHEN 'UGX' THEN 3.58 WHEN 'USD' THEN 2.95 WHEN 'KES' THEN 4.07 ELSE 5 END;
UPDATE public.ican_currency_rates SET rate_to_ugx = 4022.802 WHERE currency_code = 'USD';
