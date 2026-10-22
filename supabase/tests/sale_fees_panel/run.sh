#!/usr/bin/env bash
# Runs the developer-panel sale-fee database tests against a throwaway Postgres database.
#
#   supabase/tests/sale_fees_panel/run.sh
#
# Needs a Postgres 14+ you can create databases and roles in, and psql on the PATH (libpq variables as usual).
# Reuses the stand-in world of supabase/tests/sale_fees and runs the REAL code for: the sale-fee migration, the developer allowlist
# and secret (cut out of 20261009100000_secure_dev_access.sql), the real dropship_checkout and the shop checkout as deployed live.
# So "a change made from the panel reaches the checkouts" is checked on the real checkouts. Nothing touches a real Supabase project.
#   KEEP_DB=1   keep the database afterwards
#   DB_NAME=x   use another database name (default ican_feepanel_test)
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
SF="$HERE/../sale_fees"
DB="${DB_NAME:-ican_feepanel_test}"
MIG="$ROOT/supabase/migrations/20261109100000_sale_fees_dev_panel.sql"
ROLLBACK="$ROOT/supabase/rollback/20261109_rollback_sale_fees_dev_panel.sql"
FEEMIG="$ROOT/supabase/migrations/20261107100000_sale_platform_fees.sql"
WORK="$(mktemp -d)"
trap '[ "${KEEP_DB:-0}" = "1" ] || psql -X -q -d postgres -c "DROP DATABASE IF EXISTS \"$DB\"" >/dev/null 2>&1; rm -rf "$WORK"' EXIT

cut_block() { awk -v start="$2" -v end="$3" '$0 ~ start { f = 1 } f { print } f && $0 == end { exit }' "$1"; }
cut_block "$ROOT/backend/ADD_DROPSHIP_SMART_TRANSPORT.sql" '^CREATE OR REPLACE FUNCTION public\.dropship_checkout\(' '$$;' > "$WORK/dropship_checkout.sql"
awk '/^-- ─── 1\. The rates/ { f = 1 } /^-- ─── 3\./ { f = 0 } f' "$ROOT/supabase/migrations/20261106100000_fee_rates.sql" > "$WORK/fee_rates_core.sql"
awk '/^-- 1\. Allowlist/ { f = 1 } /^-- 4\. Rewrite every function/ { f = 0 } f' "$ROOT/supabase/migrations/20261009100000_secure_dev_access.sql" > "$WORK/dev_access.sql"
for f in dropship_checkout fee_rates_core dev_access; do
  [ "$(wc -l < "$WORK/$f.sql")" -gt 20 ] || { echo "could not cut $f out of the repo files - did they move?" >&2; exit 1; }
done

step() {
  local out
  out=$(psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$1" 2>&1) || { echo "$out" | grep -v '^psql:.*NOTICE\|^NOTICE' >&2; echo "FAILED: $1" >&2; exit 1; }
  echo "$out" | sed -n 's/^psql:[^ ]* INFO:  //p' | grep -E '^(PASS|FAIL)' || true
}

psql -X -q -d postgres -c "DROP DATABASE IF EXISTS \"$DB\"" -c "CREATE DATABASE \"$DB\"" >/dev/null 2>&1
step "$SF/00_stub.sql"
step "$HERE/00_dev_stub.sql"
step "$WORK/fee_rates_core.sql"
step "$SF/01_world.sql"
step "$WORK/dev_access.sql"
step "$WORK/dropship_checkout.sql"
step "$SF/fixtures/live_customer_self_checkout.sql"
step "$FEEMIG"                       # the rates this panel changes
step "$MIG"
step "$HERE/01_after.sql"
step "$MIG"                          # run twice
step "$HERE/02_after_rerun.sql"
step "$ROLLBACK"
step "$ROLLBACK"                     # safe to run twice
step "$HERE/03_after_rollback.sql"
step "$MIG"                          # and works again after a rollback
step "$HERE/04_after_roundtrip.sql"
echo "All developer-panel sale-fee database checks passed."
