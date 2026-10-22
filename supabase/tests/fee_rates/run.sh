#!/usr/bin/env bash
# Runs the fee-rates database tests against a throwaway Postgres database.
#
#   supabase/tests/fee_rates/run.sh
#
# Needs a Postgres 14+ you can create databases and roles in, and psql on the PATH (libpq variables as usual).
# Uses the REAL backend/ICAN_FIAT_MOBILE_MONEY_SEND_MIGRATION.sql and the migration + rollback under test. Only Supabase's
# roles/auth schema and the two coin functions are stand-ins (01_legacy.sql says which statements are copied verbatim).
# Nothing touches a real Supabase project.
#   KEEP_DB=1   keep the database afterwards
#   DB_NAME=x   use another database name (default ican_feerates_test)
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
DB="${DB_NAME:-ican_feerates_test}"
MIG="${MIG:-$ROOT/supabase/migrations/20261106100000_fee_rates.sql}"
ROLLBACK="$ROOT/supabase/rollback/20261106_rollback_fee_rates.sql"
trap '[ "${KEEP_DB:-0}" = "1" ] || psql -X -q -d postgres -c "DROP DATABASE IF EXISTS \"$DB\"" >/dev/null 2>&1' EXIT

psql -X -q -d postgres -c "DROP DATABASE IF EXISTS \"$DB\"" -c "CREATE DATABASE \"$DB\"" >/dev/null

step() { # step <file>: run it, print its PASS lines, stop at the first error
  local out
  out=$(psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$1" 2>&1) || { echo "$out" | grep -v '^psql:.*NOTICE\|^NOTICE' >&2; echo "FAILED: $1" >&2; exit 1; }
  echo "$out" | sed -n 's/^psql:[^ ]* INFO:  //p' | grep -E '^(PASS|FAIL)' || true
  echo "$out" | sed -n 's/^psql:[^ ]* WARNING:  //p' | sed 's/^/  (warning, expected) /' || true
}

step "$HERE/00_stub.sql"
step "$ROOT/backend/ICAN_FIAT_MOBILE_MONEY_SEND_MIGRATION.sql"
step "$HERE/01_legacy.sql"
step "$HERE/02_before.sql"
step "$MIG"
step "$HERE/03_after.sql"
step "$HERE/04_prepare_rerun.sql"
step "$MIG"                          # a second run: idempotent, keeps changed rates, skips what it does not recognise
step "$HERE/05_after_rerun.sql"
step "$ROLLBACK"
step "$ROLLBACK"                     # the rollback is safe to run twice
step "$HERE/06_after_rollback.sql"
step "$MIG"                          # and the migration works again after a rollback
step "$HERE/07_after_roundtrip.sql"
echo "All fee-rate database checks passed."
