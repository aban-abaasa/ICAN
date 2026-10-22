-- Rolls back 20261110100000_restricted_zone_access.sql
--
--   * every restricted-zone function is dropped (the staff API, the gate desk, the rider's pass / pay functions and the card-page
--     gate of 20261111100000_zone_gate_from_card_page.sql), so nothing
--     can check a vehicle in or charge a fee any more
--   * the 'zone_access_fee' rate row is removed and ican_fee_rate() loses its fallback
--
-- It deliberately KEEPS the tables (mbg_access_zones, mbg_access_zone_fees, mbg_access_zone_members, mbg_access_visits,
-- mbg_ride_zone_notices, and mbg_access_incidents if 20261112100000_zone_forced_entry_record.sql was run):
-- they are the record of who was let in and which fees were paid, and the fees already moved to the business wallets and to
-- ICANera stay where they are. Running the migration again picks them up exactly as they were. They are closed to the API
-- (no policies, no grants), so leaving them is harmless. To delete them as well, run the DROP TABLE lines at the bottom.
-- Safe to run twice.

DO $drop$
DECLARE
  v_fn RECORD;
BEGIN
  FOR v_fn IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND (p.proname LIKE 'mbg\_zone\_%' OR p.proname IN ('mbg_my_gate_passes', 'mbg_my_gate_zones', 'mbg_rider_gate_record', 'mbg_rider_pay_gate_fee', 'mbg_rider_decline_gate_fee', 'mbg_ack_ride_zone_charges', 'mbg_ride_zone_charges'))
  LOOP
    EXECUTE format('DROP FUNCTION %s', v_fn.sig);
  END LOOP;
END $drop$;

DELETE FROM public.ican_fee_rates WHERE key = 'zone_access_fee';

-- ican_fee_rate() as 20261107100000_sale_platform_fees.sql left it
CREATE OR REPLACE FUNCTION public.ican_fee_rate(p_key TEXT) RETURNS NUMERIC
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT r.rate FROM public.ican_fee_rates r WHERE r.key = p_key),
    -- a deleted row must not turn a charge into "free" by accident
    CASE p_key
      WHEN 'send_mobile_money' THEN 0.03
      WHEN 'send_bank'         THEN 0.03
      WHEN 'withdraw_wallet'   THEN 0.03
      WHEN 'coin_cash_out'     THEN 0.03
      WHEN 'dropship_sale'     THEN 0.02
      WHEN 'store_sale'        THEN 0.01
      ELSE 0
    END)
$$;

NOTIFY pgrst, 'reload schema';

-- Only if you also want the history gone (this cannot be undone):
-- DROP TABLE IF EXISTS public.mbg_access_incidents, public.mbg_ride_zone_notices, public.mbg_access_visits, public.mbg_access_zone_members, public.mbg_access_zone_fees, public.mbg_access_zones;
