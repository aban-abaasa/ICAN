-- ============================================================================
-- Rolls back 20261113100000_site_delivery.sql (delivery on the business website Market).
--
-- Takes the two lines out of guest_checkout_fulfil, removes every function the feature added, the on/off switches and the
-- site_managed marker. Nothing else is touched: no product, no store, no dropship listing, and no order that was already
-- placed (those are ordinary dropship orders). From now on the website offers store products for pickup / the Pay tab only.
-- Safe to run more than once.
-- ============================================================================

-- guest_checkout_fulfil first: it must stop calling the helpers before they go.
DO $unpatch$
DECLARE
  v_oid OID := to_regprocedure('public.guest_checkout_fulfil(text,text,numeric)');
  v_def TEXT;
BEGIN
  IF v_oid IS NULL THEN
    RETURN;
  END IF;
  v_def := replace(pg_get_functiondef(v_oid), E'\r\n', E'\n');
  IF position('_site_delivery_lend' IN v_def) = 0 THEN
    RETURN;
  END IF;
  v_def := regexp_replace(v_def, $re$PERFORM\s+public\._site_delivery_lend\(v_o\.reseller_business_profile_id,\s*v_o\.cart\);\s*$re$, '');
  v_def := regexp_replace(v_def, $re$PERFORM\s+public\._site_delivery_return\(v_o\.reseller_business_profile_id\);\s*$re$, '');
  IF position('_site_delivery_' IN v_def) > 0 THEN
    RAISE EXCEPTION 'guest_checkout_fulfil still mentions the delivery helpers after the clean-up - NOTHING was changed; remove them by hand, then run this again';
  END IF;
  EXECUTE v_def;
END $unpatch$;

DROP FUNCTION IF EXISTS public.site_guest_checkout_start(UUID, JSONB, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT[], BOOLEAN);
DROP FUNCTION IF EXISTS public.site_checkout_with_pin(TEXT, UUID, JSONB, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, UUID, TEXT[]);
DROP FUNCTION IF EXISTS public.site_find_delivery_riders(UUID, NUMERIC, NUMERIC, TEXT[], INTEGER);
DROP FUNCTION IF EXISTS public.get_site_delivery_storefront(UUID);
DROP FUNCTION IF EXISTS public.fn_set_cmms_site_delivery(UUID, BOOLEAN);
DROP FUNCTION IF EXISTS public.get_cmms_site_delivery(UUID);
DROP FUNCTION IF EXISTS public._site_delivery_manager(UUID, BOOLEAN);
DROP FUNCTION IF EXISTS public._site_delivery_return(UUID);
DROP FUNCTION IF EXISTS public._site_delivery_lend(UUID, JSONB);
DROP FUNCTION IF EXISTS public._site_delivery_ready(UUID);
DROP FUNCTION IF EXISTS public._site_delivery_state(public.products);
DROP FUNCTION IF EXISTS public._site_delivery_store(UUID);

-- A loaned listing never outlives its transaction, so there should be none; clear any stray one before dropping the marker.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'dropship_listings' AND column_name = 'site_managed') THEN
    EXECUTE 'DELETE FROM public.dropship_listings WHERE site_managed';
  END IF;
END $$;
ALTER TABLE public.dropship_listings DROP COLUMN IF EXISTS site_managed;
DROP TABLE IF EXISTS public.cmms_site_delivery;

NOTIFY pgrst, 'reload schema';

SELECT 'Delivery on the business website Market removed; products, stores and orders untouched' AS status;
