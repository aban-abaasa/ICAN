#!/usr/bin/env bash
# Runs the national-ID ownership database tests against a throwaway Postgres database.
#
#   supabase/tests/national_id_ownership/run.sh
#
# Needs a Postgres 14+ you can create databases and roles in, and psql on the PATH (libpq variables as usual).
# The SQL under test is the REAL backend/NATIONAL_ID_PER_COUNTRY.sql and backend/NATIONAL_ID_OWNERSHIP.sql.
# Only Supabase's roles/auth schema, the wallet table and the dev secret are stand-ins (00_stub.sql).
# Nothing touches a real Supabase project.
#   KEEP_DB=1   keep the database afterwards
#   DB_NAME=x   use another database name (default ican_nid_owner_test)
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
DB="${DB_NAME:-ican_nid_owner_test}"
BASE="$ROOT/backend/NATIONAL_ID_PER_COUNTRY.sql"
OWN="$ROOT/backend/NATIONAL_ID_OWNERSHIP.sql"
trap '[ "${KEEP_DB:-0}" = "1" ] || psql -X -q -d postgres -c "DROP DATABASE IF EXISTS \"$DB\"" >/dev/null 2>&1' EXIT

psql -X -q -d postgres -c "DROP DATABASE IF EXISTS \"$DB\"" -c "CREATE DATABASE \"$DB\"" >/dev/null

step() { # step <file>: run it, print its PASS lines, stop at the first error
  local out
  out=$(psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$1" 2>&1) || { echo "$out" | grep -v '^psql:.*NOTICE\|^NOTICE' >&2; echo "FAILED: $1" >&2; exit 1; }
  echo "$out" | sed -n 's/^psql:[^ ]* INFO:  //p' | grep -E '^(PASS|FAIL)' || true
}

step "$HERE/00_stub.sql"
# the ownership file refuses to run on a database that lacks its prerequisite
if psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$OWN" >/dev/null 2>&1; then echo "FAIL ownership file ran without the base file" >&2; exit 1; fi
echo "PASS the ownership file refuses to run before the base file"
step "$BASE"
step "$OWN"
step "$BASE"                      # a second run of each changes nothing...
step "$OWN"
step "$HERE/01_tests.sql"
step "$OWN"                       # ...and re-running after real use keeps the data
step "$BASE"
step "$HERE/02_after_rerun.sql"
echo "All national-ID ownership database checks passed."
