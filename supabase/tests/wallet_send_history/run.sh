#!/usr/bin/env bash
# Runs the wallet-send-history database tests against a throwaway Postgres database.
#
#   supabase/tests/wallet_send_history/run.sh
#
# Needs a Postgres 14+ you can create databases and roles in, and psql on the PATH (libpq variables as usual).
# The SQL under test is the REAL process_transaction_with_pin() built up the way the live one was --
# backend/UNIVERSAL_TRANSACTION_PIN_APPROVAL.sql, then backend/FIX_WALLET_TRANSACTIONS_FK.sql, then the
# 20261104090000 funds-guard migration -- and then the REAL 20261116100000_wallet_send_history.sql on top.
# Only Supabase's roles/auth schema and the wallet tables are stand-ins (00_stub.sql).
# Nothing touches a real Supabase project.
#   KEEP_DB=1   keep the database afterwards
#   DB_NAME=x   use another database name (default ican_send_history_test)
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
DB="${DB_NAME:-ican_send_history_test}"
BASE="$ROOT/backend/UNIVERSAL_TRANSACTION_PIN_APPROVAL.sql"
FK="$ROOT/backend/FIX_WALLET_TRANSACTIONS_FK.sql"
FUNDS="$ROOT/supabase/migrations/20261104090000_wallet_transactions_require_funds.sql"
MIG="$ROOT/supabase/migrations/20261116100000_wallet_send_history.sql"
trap '[ "${KEEP_DB:-0}" = "1" ] || psql -X -q -d postgres -c "DROP DATABASE IF EXISTS \"$DB\"" >/dev/null 2>&1' EXIT

psql -X -q -d postgres -c "DROP DATABASE IF EXISTS \"$DB\"" -c "CREATE DATABASE \"$DB\"" >/dev/null

step() { # step <file>: run it, print its PASS lines, stop at the first error
  local out
  out=$(psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$1" 2>&1) || { echo "$out" | grep -v '^psql:.*NOTICE\|^NOTICE' >&2; echo "FAILED: $1" >&2; exit 1; }
  echo "$out" | sed -n 's/^psql:[^ ]* INFO:  //p' | grep -E '^(PASS|FAIL)' || true
}

step "$HERE/00_stub.sql"
step "$BASE"
step "$FK"
step "$FUNDS"
step "$HERE/01_before.sql"        # the bug: sends are made, History stays empty
step "$MIG"
step "$HERE/02_after.sql"
step "$MIG"                       # a second run changes nothing...
step "$HERE/03_after_rerun.sql"
