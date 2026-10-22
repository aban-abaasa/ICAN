#!/usr/bin/env bash
# Runs the restricted-zone database tests against a throwaway Postgres database.
#
#   supabase/tests/zone_access/run.sh
#
# Needs a Postgres 14+ you can create databases and roles in, and psql on the PATH (libpq variables as usual).
# The migration under test is the REAL one (supabase/migrations/20261110100000_restricted_zone_access.sql). The fee-rate table +
# ican_fee_rate() are cut straight out of 20261106100000_fee_rates.sql. Only Supabase's roles, CMMS, the wallets and BodaGoEra's
# riders and cards are stand-ins (00_stub.sql). Nothing touches a real Supabase project.
#   KEEP_DB=1   keep the database afterwards
#   DB_NAME=x   use another database name (default ican_zone_test)
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
DB="${DB_NAME:-ican_zone_test}"
MIG="${MIG:-$ROOT/supabase/migrations/20261110100000_restricted_zone_access.sql}"
ROLLBACK="$ROOT/supabase/rollback/20261110_rollback_restricted_zone_access.sql"
WORK="$(mktemp -d)"
trap '[ "${KEEP_DB:-0}" = "1" ] || psql -X -q -d postgres -c "DROP DATABASE IF EXISTS \"$DB\"" >/dev/null 2>&1; rm -rf "$WORK"' EXIT

# the rates table and ican_fee_rate(), exactly as shipped
awk '/^-- ─── 1\. The rates/ { f = 1 } /^-- ─── 3\./ { f = 0 } f' "$ROOT/supabase/migrations/20261106100000_fee_rates.sql" > "$WORK/fee_rates_core.sql"
[ "$(wc -l < "$WORK/fee_rates_core.sql")" -gt 20 ] || { echo "could not cut the fee rates out of 20261106100000_fee_rates.sql - did it move?" >&2; exit 1; }

psql -X -q -d postgres -c "DROP DATABASE IF EXISTS \"$DB\"" -c "CREATE DATABASE \"$DB\"" >/dev/null

step() { # step <file>: run it, print its PASS lines, stop at the first error
  local out
  out=$(psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$1" 2>&1) || { echo "$out" | grep -v '^psql:.*NOTICE\|^NOTICE' >&2; echo "FAILED: $1" >&2; exit 1; }
  echo "$out" | sed -n 's/^psql:[^ ]* INFO:  //p' | grep -E '^(PASS|FAIL)' || true
  echo "$out" | sed -n 's/^psql:[^ ]* NOTICE:  /  (notice) /p' | grep -E 'Restricted zones ready|already|left as it is' || true
}

step "$HERE/00_stub.sql"
step "$WORK/fee_rates_core.sql"
step "$HERE/01_world.sql"
step "$MIG"
step "$HERE/02_tests.sql"
step "$HERE/02b_dev_changes_rate.sql"
step "$MIG"                                  # a second run changes nothing and keeps the rate a developer set
step "$HERE/03_after_rerun.sql"
if [ -f "$ROLLBACK" ]; then
  step "$ROLLBACK"
  step "$ROLLBACK"                           # the rollback is safe to run twice
  step "$HERE/04_after_rollback.sql"
  step "$MIG"                                # and the migration works again after a rollback
  step "$HERE/05_after_roundtrip.sql"
fi
echo "All restricted-zone database checks passed."
