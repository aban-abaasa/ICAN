#!/usr/bin/env bash
# Runs the business ratings / subscriptions / ranked-products database tests against a throwaway Postgres database.
#
#   supabase/tests/business_ratings_ranking/run.sh
#
# Needs a Postgres 14+ you can create databases and roles in, and psql on the PATH (libpq variables as usual).
# Uses the REAL migration under test; only the auth schema and the shop tables it reads are stubbed.
# Nothing touches a real Supabase project.
#   KEEP_DB=1   keep the database afterwards
#   DB_NAME=x   use another database name (default ican_ranking_test)
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
MIGRATION="$ROOT/supabase/migrations/20261118100000_business_ratings_subscriptions_ranking.sql"
ROLLBACK="$ROOT/supabase/rollback/20261118_rollback_business_ratings_subscriptions_ranking.sql"
PASTE="$ROOT/BUSINESS_RATINGS_RANKING_PASTE_INTO_SUPABASE.sql"
DB="${DB_NAME:-ican_ranking_test}"
trap '[ "${KEEP_DB:-0}" = "1" ] || psql -X -q -d postgres -c "DROP DATABASE IF EXISTS \"$DB\"" >/dev/null 2>&1' EXIT

psql -X -q -d postgres -c "DROP DATABASE IF EXISTS \"$DB\"" -c "CREATE DATABASE \"$DB\"" >/dev/null
for f in "$HERE/00_stub.sql" "$HERE/01_seed.sql" "$MIGRATION" "$HERE/02_tests.sql"; do
  out=$(psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$f" 2>&1) || { echo "$out" | grep -v NOTICE >&2; echo "FAILED: $f" >&2; exit 1; }
  echo "$out" | sed -n 's/^psql:[^ ]* INFO:  //p' | grep -E '^(PASS|FAIL)' || true
done

# The paste-into-Supabase copy must be the migration, byte for byte.
cmp -s "$MIGRATION" "$PASTE" && echo "PASS paste file equals the migration" || { echo "FAIL paste file differs from the migration"; exit 1; }

# Re-running must change nothing and must not error.
rows_before=$(psql -X -q -t -d "$DB" -c "SELECT (SELECT count(*) FROM public.business_site_ratings) || ',' || (SELECT count(*) FROM public.business_site_subscriptions)" | tr -d ' ')
psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$MIGRATION" >/dev/null 2>&1 || { echo "FAIL migration is idempotent (error on second run)"; exit 1; }
rows_after=$(psql -X -q -t -d "$DB" -c "SELECT (SELECT count(*) FROM public.business_site_ratings) || ',' || (SELECT count(*) FROM public.business_site_subscriptions)" | tr -d ' ')
[ "$rows_before" = "$rows_after" ] && echo "PASS migration is idempotent and keeps every rating and subscription" || { echo "FAIL migration changed data on a second run"; exit 1; }

# The rollback removes the feature and leaves the shop tables alone.
products=$(psql -X -q -t -d "$DB" -c "SELECT count(*) FROM public.products" | tr -d ' ')
psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$ROLLBACK" >/dev/null 2>&1 || { echo "FAIL rollback errored"; exit 1; }
left=$(psql -X -q -t -d "$DB" -c "SELECT (to_regclass('public.business_site_ratings') IS NULL)::text || ',' || (to_regclass('public.business_site_subscriptions') IS NULL)::text || ',' || (to_regprocedure('public.fn_ranked_products_page(uuid,uuid[],text,text,integer,integer)') IS NULL)::text || ',' || (SELECT count(*) FROM public.products)::text" | tr -d ' ')
[ "$left" = "true,true,true,$products" ] && echo "PASS rollback removes the feature and keeps every product" || { echo "FAIL rollback left: $left"; exit 1; }
echo "ALL BUSINESS RATING AND RANKING TESTS PASSED"
