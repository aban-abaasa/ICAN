#!/usr/bin/env bash
# Runs the shop tax-included database tests against a throwaway Postgres database.
#
#   supabase/tests/shop_tax/run.sh
#
# Needs a Postgres 14+ you can create databases and roles in, and psql on the PATH (libpq variables as usual).
# Reuses the stand-in world of supabase/tests/sale_fees (roles, wallets, shop tables) and runs the REAL migrations:
#   A  the shop checkout deployed in the live project (sale_fees/fixtures/live_customer_self_checkout.sql: tax added ON TOP),
#      this migration first, then the sale-fee migration
#   B  the same, in the other order
#   C  the repo's own copy, which is tax-included already - the migration must leave it alone
#   KEEP_DB=1   keep the database afterwards
#   DB_NAME=x   use another database name (default ican_shoptax_test)
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
SF="$HERE/../sale_fees"
DB="${DB_NAME:-ican_shoptax_test}"
TAXMIG="$ROOT/supabase/migrations/20261108100000_shop_checkout_tax_included.sql"
TAXROLLBACK="$ROOT/supabase/rollback/20261108_rollback_shop_checkout_tax_included.sql"
FEEMIG="$ROOT/supabase/migrations/20261107100000_sale_platform_fees.sql"
FEEROLLBACK="$ROOT/supabase/rollback/20261107_rollback_sale_platform_fees.sql"
WORK="$(mktemp -d)"
trap '[ "${KEEP_DB:-0}" = "1" ] || psql -X -q -d postgres -c "DROP DATABASE IF EXISTS \"$DB\"" >/dev/null 2>&1; rm -rf "$WORK"' EXIT

cut_block() { awk -v start="$2" -v end="$3" '$0 ~ start { f = 1 } f { print } f && $0 == end { exit }' "$1"; }
cut_block "$ROOT/backend/ADD_DROPSHIP_SMART_TRANSPORT.sql" '^CREATE OR REPLACE FUNCTION public\.dropship_checkout\(' '$$;' > "$WORK/dropship_checkout.sql"
cut_block "$ROOT/backend/FIX_CUSTOMER_SELF_CHECKOUT_TAX_INCLUSIVE.sql" '^CREATE OR REPLACE FUNCTION public\.customer_self_checkout\(' '$function$;' > "$WORK/repo_shop_checkout.sql"
awk '/^-- ─── 1\. The rates/ { f = 1 } /^-- ─── 3\./ { f = 0 } f' "$ROOT/supabase/migrations/20261106100000_fee_rates.sql" > "$WORK/fee_rates_core.sql"
for f in dropship_checkout repo_shop_checkout fee_rates_core; do
  [ "$(wc -l < "$WORK/$f.sql")" -gt 20 ] || { echo "could not cut $f out of the backend files - did they move?" >&2; exit 1; }
done

step() {
  local out
  out=$(psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$1" 2>&1) || { echo "$out" | grep -v '^psql:.*NOTICE\|^NOTICE' >&2; echo "FAILED: $1" >&2; exit 1; }
  echo "$out" | sed -n 's/^psql:[^ ]* INFO:  //p' | grep -E '^(PASS|FAIL)' || true
  echo "$out" | sed -n 's/^psql:[^ ]* NOTICE:  /  (notice) /p' | grep -E 'already|now treats' || true
}
step_refused() { # step_refused <file> <text>: it MUST fail, and say why
  local out
  if out=$(psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$1" 2>&1); then echo "FAILED: $1 should have been refused" >&2; exit 1; fi
  echo "$out" | grep -q "$2" || { echo "$out" >&2; echo "FAILED: $1 was refused, but not for the expected reason ($2)" >&2; exit 1; }
  echo "PASS refused an unknown shop checkout: $(echo "$out" | sed -n 's/.*ERROR:  \(.*\) - this is not the version.*/\1/p' | head -1 | cut -c1-110)"
}
fresh() { # fresh <sql that creates the deployed shop checkout>: a new database with the stand-in world and that checkout
  psql -X -q -d postgres -c "DROP DATABASE IF EXISTS \"$DB\"" -c "CREATE DATABASE \"$DB\"" >/dev/null 2>&1
  step "$SF/00_stub.sql"; step "$WORK/fee_rates_core.sql"; step "$SF/01_world.sql"; step "$HERE/00_helpers.sql"
  step "$WORK/dropship_checkout.sql"; step "$1"; step "$HERE/09_save_text.sql"
}

echo "=== A. the live checkout: tax migration, then the sale-fee migration"
fresh "$SF/fixtures/live_customer_self_checkout.sql"
step "$HERE/10_before.sql"
step "$HERE/11_unknown_shape.sql"
step_refused "$TAXMIG" 'NOTHING was changed'
step "$HERE/12_after_refusal.sql"
step "$TAXMIG"
step "$HERE/13_after.sql"
step "$TAXMIG"                           # run twice
step "$HERE/14_after_rerun.sql"
step "$FEEMIG"
step "$HERE/15_after_both.sql"
step "$FEEROLLBACK"
step "$TAXROLLBACK"
step "$TAXROLLBACK"                      # safe to run twice
step "$HERE/16_after_rollback.sql"

echo "=== B. the live checkout: sale-fee migration, then the tax migration"
fresh "$SF/fixtures/live_customer_self_checkout.sql"
step "$FEEMIG"
step "$TAXMIG"
step "$HERE/15_after_both.sql"
step "$TAXROLLBACK"
step "$FEEROLLBACK"
step "$HERE/16_after_rollback.sql"

echo "=== C. the repo's own copy (tax-included already)"
fresh "$WORK/repo_shop_checkout.sql"
step "$TAXMIG"
step "$HERE/17_repo_copy_unchanged.sql"
echo "All shop tax-included database checks passed."
