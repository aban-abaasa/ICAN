#!/usr/bin/env bash
# Runs the "dropship prices are tax-included" database tests against a throwaway Postgres database.
#
#   supabase/tests/dropship_tax/run.sh
#
# Needs a Postgres 14+ you can create databases and roles in, and psql on the PATH (libpq variables as usual).
# The functions under test are the REAL ones, their text cut straight out of
#   backend/ADD_DROPSHIP_SMART_TRANSPORT.sql              dropship_checkout (the 11-argument one every dropship path ends in)
#   backend/ADD_GUEST_CHECKOUT_MOBILE_MONEY.sql           guest_checkout_start (the Mobile Money / card / bank quote)
#   supabase/migrations/20261011100000_installment_orders.sql   _inst_price_cart and _inst_record_sale
# and run in the stand-in world of supabase/tests/sale_fees (roles, wallets, shop tables, BodaGoera) plus 00_extra.sql. The sale-fee
# migration is applied in BOTH orders against the tax migration, and the shop checkout deployed live is the one from sale_fees/fixtures.
#   KEEP_DB=1   keep the database afterwards
#   DB_NAME=x   use another database name (default ican_droptax_test)
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
SF="$HERE/../sale_fees"
DB="${DB_NAME:-ican_droptax_test}"
MIG="${MIG:-$ROOT/supabase/migrations/20261114100000_dropship_tax_included.sql}"
ROLLBACK="$ROOT/supabase/rollback/20261114_rollback_dropship_tax_included.sql"
FEEMIG="$ROOT/supabase/migrations/20261107100000_sale_platform_fees.sql"
FEEROLLBACK="$ROOT/supabase/rollback/20261107_rollback_sale_platform_fees.sql"
WORK="$(mktemp -d)"
trap '[ "${KEEP_DB:-0}" = "1" ] || psql -X -q -d postgres -c "DROP DATABASE IF EXISTS \"$DB\"" >/dev/null 2>&1; rm -rf "$WORK"' EXIT

cut_block() { awk -v start="$2" -v end="$3" '$0 ~ start { f = 1 } f { print } f && $0 == end { exit }' "$1"; }
cut_block "$ROOT/backend/ADD_DROPSHIP_SMART_TRANSPORT.sql"  '^CREATE OR REPLACE FUNCTION public\.dropship_checkout\(' '$$;' > "$WORK/dropship_checkout.sql"
cut_block "$ROOT/backend/ADD_GUEST_CHECKOUT_MOBILE_MONEY.sql" '^CREATE OR REPLACE FUNCTION public\.guest_checkout_start\(' '$$;' > "$WORK/guest_start.sql"
cut_block "$ROOT/supabase/migrations/20261011100000_installment_orders.sql" '^CREATE OR REPLACE FUNCTION public\._inst_price_cart\(' '$$;' > "$WORK/inst_price.sql"
cut_block "$ROOT/supabase/migrations/20261011100000_installment_orders.sql" '^CREATE OR REPLACE FUNCTION public\._inst_record_sale\(' '$$;' > "$WORK/inst_sale.sql"
awk '/^-- ─── 1\. The rates/ { f = 1 } /^-- ─── 3\./ { f = 0 } f' "$ROOT/supabase/migrations/20261106100000_fee_rates.sql" > "$WORK/fee_rates_core.sql"
for f in dropship_checkout guest_start inst_price inst_sale fee_rates_core; do
  [ "$(wc -l < "$WORK/$f.sql")" -gt 20 ] || { echo "could not cut $f out of the backend / migration files - did they move?" >&2; exit 1; }
done

step() { # step <file>: run it, print its PASS lines, stop at the first error
  local out
  out=$(psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$1" 2>&1) || { echo "$out" | grep -v '^psql:.*NOTICE\|^NOTICE' >&2; echo "FAILED: $1" >&2; exit 1; }
  echo "$out" | sed -n 's/^psql:[^ ]* INFO:  //p' | grep -E '^(PASS|FAIL)' || true
  echo "$out" | sed -n 's/^psql:[^ ]* NOTICE:  /  (notice) /p' | grep -E 'already|not installed|now treats' || true
}
step_refused() { # step_refused <file> <text the refusal must contain>: it MUST fail, and say why
  local out why
  if out=$(psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$1" 2>&1); then echo "FAILED: $1 should have been refused" >&2; exit 1; fi
  echo "$out" | grep -q "$2" || { echo "$out" >&2; echo "FAILED: $1 was refused, but not for the expected reason ($2)" >&2; exit 1; }
  why=$(echo "$out" | sed -n 's/.*ERROR:  \(.*\) - this is not the version.*/\1/p' | head -1 | cut -c1-110)
  echo "PASS refused: ${why:-$2}"
}
fresh() { # fresh <1|0>: a new database with the stand-in world and the deployed functions (1 = with guest checkout and instalments)
  psql -X -q -d postgres -c "DROP DATABASE IF EXISTS \"$DB\"" -c "CREATE DATABASE \"$DB\"" >/dev/null 2>&1
  step "$SF/00_stub.sql"; step "$WORK/fee_rates_core.sql"; step "$SF/01_world.sql"; step "$HERE/00_extra.sql"
  step "$WORK/dropship_checkout.sql"
  if [ "$1" = "1" ]; then step "$WORK/guest_start.sql"; step "$WORK/inst_price.sql"; step "$WORK/inst_sale.sql"; fi
  step "$SF/fixtures/live_customer_self_checkout.sql"
  step "$HERE/09_save_text.sql"
}

# The paste-into-Supabase copy must be the migration, byte for byte.
cmp -s "$MIG" "$ROOT/DROPSHIP_TAX_INCLUDED_PASTE_INTO_SUPABASE.sql" && echo "PASS paste file equals the migration" || { echo "FAIL paste file differs from the migration" >&2; exit 1; }

echo "=== A. the tax migration, then the sale-fee migration"
fresh 1
step "$HERE/10_before.sql"
step "$HERE/11_unknown_shape.sql"
step_refused "$MIG" 'NOTHING was changed'
step "$HERE/12_after_refusal.sql"
step "$WORK/inst_price.sql"              # put the real instalment pricing back
step "$MIG"
step "$HERE/13_after.sql"
step "$MIG"                              # run twice
step "$HERE/14_after_rerun.sql"
step "$FEEMIG"
step "$HERE/15_after_both.sql"
step "$FEEROLLBACK"
step_refused "$ROLLBACK" 'still open'    # a plan started under the new maths is open: the rollback must not touch anything
step "$HERE/15b_close_plans.sql"
step "$ROLLBACK"
step "$ROLLBACK"                         # safe to run twice
step "$HERE/16_after_rollback.sql"
step "$MIG"                              # and the migration works again after a rollback
step "$HERE/14_after_rerun.sql"

echo "=== B. the sale-fee migration, then the tax migration"
fresh 1
step "$FEEMIG"
step "$MIG"
step "$HERE/15_after_both.sql"
step "$ROLLBACK"
step "$FEEROLLBACK"
step "$HERE/16_after_rollback.sql"

echo "=== C. a project without guest checkout or instalments"
fresh 0
step "$MIG"
step "$HERE/17_optional_missing.sql"
step "$ROLLBACK"
step "$HERE/16_after_rollback_c.sql"
echo "ALL DROPSHIP TAX TESTS PASSED"
