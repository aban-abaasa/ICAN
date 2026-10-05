#!/usr/bin/env bash
# Runs the business-digital-card database tests against a throwaway Postgres database.
#
#   supabase/tests/business_digital_cards/run.sh
#
# Needs a Postgres 14+ you can create databases and roles in, and psql on the PATH (libpq variables as usual).
# Uses the REAL backend/ICAN_DIGITAL_CARD_QR.sql, backend/BUSINESS_WALLET_PIN_VERIFY.sql and the migration under
# test; only the business-access helpers and the auth schema are stubbed. Nothing touches a real Supabase project.
#   KEEP_DB=1   keep the database afterwards
#   DB_NAME=x   use another database name (default ican_bizcard_test)
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
DB="${DB_NAME:-ican_bizcard_test}"
trap '[ "${KEEP_DB:-0}" = "1" ] || psql -X -q -d postgres -c "DROP DATABASE IF EXISTS \"$DB\"" >/dev/null 2>&1' EXIT

psql -X -q -d postgres -c "DROP DATABASE IF EXISTS \"$DB\"" -c "CREATE DATABASE \"$DB\"" >/dev/null
run() { psql -X -q -v ON_ERROR_STOP=1 -d "$DB" "$@" 2>&1 | grep -v '^NOTICE\|^psql:.*NOTICE' || true; }
fail=0
for f in "$HERE/00_stub.sql" "$ROOT/backend/ICAN_DIGITAL_CARD_QR.sql" "$ROOT/backend/BUSINESS_WALLET_PIN_VERIFY.sql" \
         "$ROOT/supabase/migrations/20261008100000_business_digital_cards.sql" "$HERE/01_tests.sql"; do
  out=$(psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$f" 2>&1) || { echo "$out" | grep -v NOTICE >&2; echo "FAILED: $f" >&2; exit 1; }
  echo "$out" | sed -n 's/^psql:[^ ]* INFO:  //p' | grep -E '^(PASS|FAIL)' || true
done
# The migration must be re-runnable, and the rollback must leave the personal scan RPCs working.
psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$ROOT/supabase/migrations/20261008100000_business_digital_cards.sql" >/dev/null 2>&1 && echo "PASS migration is idempotent" || { echo "FAIL migration is idempotent"; exit 1; }
psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$ROOT/supabase/rollback/20261008_rollback_business_digital_cards.sql" >/dev/null 2>&1 \
  && psql -X -q -t -d "$DB" -c "SELECT count(*) FROM public.get_card_qr_info('x')" >/dev/null 2>&1 \
  && [ "$(psql -X -q -t -d "$DB" -c "SELECT to_regclass('public.ican_business_digital_cards') IS NULL")" = " t" ] \
  && echo "PASS rollback removes business cards and keeps personal scan RPCs" || { echo "FAIL rollback"; exit 1; }
