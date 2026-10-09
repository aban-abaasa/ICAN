-- Removes the installment-orders layer (20261011100000_installment_orders.sql).
--
-- It REFUSES to run while any plan still holds customers' money or reserved stock — cancel those plans first
-- (installment_seller_cancel, or let installment_run_due lapse them), otherwise their payments would be lost.
-- Finished, cancelled and lapsed plans are history and are dropped with the tables.
DO $$
BEGIN
  IF to_regclass('public.installment_plans') IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.installment_plans WHERE status IN ('awaiting_deposit', 'active', 'ready') OR held_ican > 0) THEN
    RAISE EXCEPTION 'Open installment plans still hold customers'' money or stock. Cancel them first, then roll back.';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN PERFORM cron.unschedule('installment-run-due'); EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_installment_price_lock ON public.dropship_listings;
DROP FUNCTION IF EXISTS public.fn_installment_price_lock();

DO $$
DECLARE
  fn RECORD;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND (p.proname LIKE 'installment\_%' OR p.proname LIKE '\_inst\_%' OR p.proname LIKE 'business\_site\_%')
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS %s CASCADE', fn.sig);
  END LOOP;
END $$;

DROP TABLE IF EXISTS public.installment_events, public.installment_payments, public.installment_plans, public.installment_config CASCADE;
DROP TABLE IF EXISTS public.business_site_customers, public.business_site_settings CASCADE;
