#!/usr/bin/env bash
# Runs the sale-fee database tests against a throwaway Postgres database.
#
#   supabase/tests/sale_fees/run.sh
#
# Needs a Postgres 14+ you can create databases and roles in, and psql on the PATH (libpq variables as usual).
# The two functions under test are the REAL ones: their text is cut straight out of
#   backend/ADD_DROPSHIP_SMART_TRANSPORT.sql         (dropship_checkout, the 11-argument one every dropship path ends in)
#   backend/FIX_CUSTOMER_SELF_CHECKOUT_TAX_INCLUSIVE.sql   (customer_self_checkout, the shop checkout)
# and the rates table + ican_fee_rate() are cut out of supabase/migrations/20261106100000_fee_rates.sql. Only Supabase's roles,
# the wallets, the shop tables and BodaGoera's riders are stand-ins (00_stub.sql). Nothing touches a real Supabase project.
#   KEEP_DB=1   keep the database afterwards
#   DB_NAME=x   use another database name (default ican_salefees_test)
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
DB="${DB_NAME:-ican_salefees_test}"
MIG="${MIG:-$ROOT/supabase/migrations/20261107100000_sale_platform_fees.sql}"
ROLLBACK="$ROOT/supabase/rollback/20261107_rollback_sale_platform_fees.sql"
WORK="$(mktemp -d)"
trap '[ "${KEEP_DB:-0}" = "1" ] || psql -X -q -d postgres -c "DROP DATABASE IF EXISTS \"$DB\"" >/dev/null 2>&1; rm -rf "$WORK"' EXIT

# cut <file> <first line (regex)> <last line (exact)>: the lines from the first match through the first exact match of the last
cut_block() {
  awk -v start="$2" -v end="$3" '$0 ~ start { f = 1 } f { print } f && $0 == end { exit }' "$1"
}
cut_block "$ROOT/backend/ADD_DROPSHIP_SMART_TRANSPORT.sql" '^CREATE OR REPLACE FUNCTION public\.dropship_checkout\(' '$$;' > "$WORK/dropship_checkout.sql"
cut_block "$ROOT/backend/FIX_CUSTOMER_SELF_CHECKOUT_TAX_INCLUSIVE.sql" '^CREATE OR REPLACE FUNCTION public\.customer_self_checkout\(' '$function$;' > "$WORK/customer_self_checkout.sql"
awk '/^-- ─── 1\. The rates/ { f = 1 } /^-- ─── 3\./ { f = 0 } f' "$ROOT/supabase/migrations/20261106100000_fee_rates.sql" > "$WORK/fee_rates_core.sql"
for f in dropship_checkout customer_self_checkout fee_rates_core; do
  [ "$(wc -l < "$WORK/$f.sql")" -gt 20 ] || { echo "could not cut $f out of the backend files - did they move?" >&2; exit 1; }
done

psql -X -q -d postgres -c "DROP DATABASE IF EXISTS \"$DB\"" -c "CREATE DATABASE \"$DB\"" >/dev/null

step() { # step <file>: run it, print its PASS lines, stop at the first error
  local out
  out=$(psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$1" 2>&1) || { echo "$out" | grep -v '^psql:.*NOTICE\|^NOTICE' >&2; echo "FAILED: $1" >&2; exit 1; }
  echo "$out" | sed -n 's/^psql:[^ ]* INFO:  //p' | grep -E '^(PASS|FAIL)' || true
  echo "$out" | sed -n 's/^psql:[^ ]* NOTICE:  /  (notice) /p' | grep -E 'left as it is|already|ICANera now takes' || true
}
step_refused() { # step_refused <file> <text the refusal must contain>: it MUST fail, and say why
  local out
  if out=$(psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$1" 2>&1); then echo "FAILED: $1 should have been refused" >&2; exit 1; fi
  echo "$out" | grep -q "$2" || { echo "$out" >&2; echo "FAILED: $1 was refused, but not for the expected reason ($2)" >&2; exit 1; }
  echo "PASS the migration refused an unknown shop checkout: $(echo "$out" | sed -n 's/.*ERROR:  \(.*\) - this is not the version.*/\1/p' | head -1 | cut -c1-150)"
}

run_suite() { # run_suite <label> <sql file that creates the deployed customer_self_checkout>
  echo "=== shop checkout shape: $1"
  psql -X -q -d postgres -c "DROP DATABASE IF EXISTS \"$DB\"" -c "CREATE DATABASE \"$DB\"" >/dev/null
  step "$HERE/00_stub.sql"
  step "$WORK/fee_rates_core.sql"
  step "$HERE/01_world.sql"
  step "$WORK/dropship_checkout.sql"
  step "$2"
  step "$HERE/02_before.sql"
  step "$HERE/04_unknown_shape.sql"
  step_refused "$MIG" 'NOTHING was changed'
  step "$HERE/05_after_refusal.sql"
  step "$MIG"
  step "$HERE/03_after.sql"
  step "$HERE/06_prepare_rerun.sql"
  step "$MIG"                          # a second run: no second patch, keeps the rates a developer set
  step "$HERE/07_after_rerun.sql"
  step "$ROLLBACK"
  step "$ROLLBACK"                     # the rollback is safe to run twice
  step "$HERE/08_after_rollback.sql"
  step "$MIG"                          # and the migration works again after a rollback
  step "$HERE/09_after_roundtrip.sql"
}

run_suite "the repo's copy (FIX_CUSTOMER_SELF_CHECKOUT_TAX_INCLUSIVE.sql)" "$WORK/customer_self_checkout.sql"
run_suite "the one deployed live (older: 'UGX' and 5000 written in, CRLF line endings)" "$HERE/fixtures/live_customer_self_checkout.sql"
echo "All sale-fee database checks passed."
