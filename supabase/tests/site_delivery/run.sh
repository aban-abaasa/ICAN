#!/usr/bin/env bash
# Runs the "delivery on the business website Market" database tests against a throwaway Postgres database.
#
#   supabase/tests/site_delivery/run.sh
#
# Needs a Postgres 14+ you can create databases and roles in, and psql on the PATH (libpq variables as usual).
# The migration under test is the REAL one (supabase/migrations/20261113100000_site_delivery.sql) and so is guest_checkout_fulfil, cut
# straight out of backend/ADD_GUEST_CHECKOUT_MOBILE_MONEY.sql (the migration patches it in place). Only Supabase's roles, the CMMS
# permission checks, the store/product tables and dropship's own checkout / PIN wrapper / rider ranking are stand-ins (00_stub.sql): the
# stand-in checkout refuses any product the business has no active listing for, exactly like the real one.
# Nothing touches a real Supabase project.
#   KEEP_DB=1   keep the database afterwards
#   DB_NAME=x   use another database name (default ican_sitedelivery_test)
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
DB="${DB_NAME:-ican_sitedelivery_test}"
MIG="${MIG:-$ROOT/supabase/migrations/20261113100000_site_delivery.sql}"
ROLLBACK="$ROOT/supabase/rollback/20261113_rollback_site_delivery.sql"
PASTE="$ROOT/SITE_DELIVERY_PASTE_INTO_SUPABASE.sql"
GUEST="$ROOT/backend/ADD_GUEST_CHECKOUT_MOBILE_MONEY.sql"
WORK="$(mktemp -d)"
trap '[ "${KEEP_DB:-0}" = "1" ] || psql -X -q -d postgres -c "DROP DATABASE IF EXISTS \"$DB\"" >/dev/null 2>&1; rm -rf "$WORK"' EXIT

# the real guest tables and the real guest_checkout_fulfil
awk '/^CREATE TABLE IF NOT EXISTS public.guest_checkout_config/ { f = 1 } /^-- 1b\./ { f = 0 } f' "$GUEST" > "$WORK/guest_tables.sql"
awk '/^CREATE OR REPLACE FUNCTION public.guest_checkout_fulfil\(/ { f = 1 } f { print } f && /^\$\$;$/ { exit }' "$GUEST" > "$WORK/guest_fulfil.sql"
[ "$(wc -l < "$WORK/guest_tables.sql")" -gt 20 ] && [ "$(wc -l < "$WORK/guest_fulfil.sql")" -gt 60 ] \
  || { echo "could not cut the guest checkout tables / guest_checkout_fulfil out of ADD_GUEST_CHECKOUT_MOBILE_MONEY.sql - did it move?" >&2; exit 1; }
cat > "$WORK/guest_start_stub.sql" <<'SQL'
-- stand-in for guest_checkout_start: refuses a product without an active listing, stores the pending order like the real one
CREATE FUNCTION public.guest_checkout_start(
  p_reseller_business_profile_id UUID, p_cart JSONB, p_customer_name TEXT, p_customer_phone TEXT, p_delivery_address TEXT,
  p_delivery_lat NUMERIC, p_delivery_lng NUMERIC, p_max_delivery_hours NUMERIC, p_vehicle_types TEXT[] DEFAULT NULL, p_dry_run BOOLEAN DEFAULT FALSE
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_item JSONB; v_l public.dropship_listings%ROWTYPE; v_items NUMERIC := 0; v_ref TEXT;
BEGIN
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_cart) LOOP
    SELECT * INTO v_l FROM public.dropship_listings
     WHERE reseller_business_profile_id = p_reseller_business_profile_id AND product_id = (v_item ->> 'product_id')::UUID AND is_active;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'An item in your cart is no longer available'); END IF;
    v_items := v_items + v_l.listed_price * (v_item ->> 'quantity')::NUMERIC;
  END LOOP;
  IF NOT p_dry_run THEN
    v_ref := 'GCO-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
    INSERT INTO public.guest_checkout_orders (tx_ref, reseller_business_profile_id, cart, customer_name, customer_phone, delivery_address,
      delivery_lat, delivery_lng, max_delivery_hours, rider_id, vehicle_types, items_ugx, delivery_fee_ugx, order_total_ugx, processing_fee_ugx, charge_ugx)
    VALUES (v_ref, p_reseller_business_profile_id, p_cart, p_customer_name, p_customer_phone, p_delivery_address,
      p_delivery_lat, p_delivery_lng, p_max_delivery_hours, '00000000-0000-0000-0000-000000000900', p_vehicle_types,
      v_items, 3000, v_items + 3000, 500, v_items + 3500);
  END IF;
  RETURN jsonb_build_object('success', true, 'tx_ref', v_ref, 'items_ugx', v_items, 'delivery_fee_ugx', 3000,
    'order_total_ugx', v_items + 3000, 'charge_ugx', v_items + 3500);
END $$;
SQL

psql -X -q -d postgres -c "DROP DATABASE IF EXISTS \"$DB\"" -c "CREATE DATABASE \"$DB\"" >/dev/null

step() { # step <file>: run it, print its PASS lines, stop at the first error
  local out
  out=$(psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$1" 2>&1) || { echo "$out" | grep -v '^psql:.*NOTICE\|^NOTICE' >&2; echo "FAILED: $1" >&2; exit 1; }
  echo "$out" | sed -n 's/^psql:[^ ]* INFO:  //p' | grep -E '^(PASS|FAIL)' || true
  echo "$out" | sed -n 's/^psql:[^ ]* NOTICE:  /  (notice) /p' | grep -E 'guest_checkout_fulfil|Guest checkout' || true
  echo "$out" | sed -n 's/^psql:[^ ]* WARNING:  /  (warning) /p' | grep -E 'guest_checkout_fulfil' || true
}

step "$HERE/00_stub.sql"
step "$WORK/guest_tables.sql"
step "$WORK/guest_fulfil.sql"
step "$WORK/guest_start_stub.sql"
step "$HERE/01_world.sql"
step "$HERE/02_before.sql"
step "$MIG"
step "$HERE/03_tests.sql"

# The paste-into-Supabase copy must be the migration, byte for byte.
cmp -s "$MIG" "$PASTE" && echo "PASS paste file equals the migration" || { echo "FAIL paste file differs from the migration"; exit 1; }

# Safe to run twice.
step "$MIG"
step "$HERE/04_after_rerun.sql"

# A different guest_checkout_fulfil is left alone.
cp "$WORK/guest_fulfil.sql" "$WORK/guest_fulfil_real.sql"
step "$HERE/05_other_fulfil.sql"
step "$MIG"
step "$HERE/06_other_fulfil_after.sql"
step "$WORK/guest_fulfil_real.sql"   # put the real one back (an unpatched one, as it was deployed)

# Rollback: the feature goes, guest_checkout_fulfil is exactly as before, nothing else is disturbed. Twice is fine.
step "$MIG"                          # patch the real fulfil again so the rollback has something to undo
step "$ROLLBACK"
step "$ROLLBACK"
step "$HERE/07_after_rollback.sql"

# And back again.
step "$MIG"
step "$HERE/08_roundtrip.sql"
echo "ALL SITE DELIVERY TESTS PASSED"
