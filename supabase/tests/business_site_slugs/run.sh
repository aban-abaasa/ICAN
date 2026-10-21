#!/usr/bin/env bash
# Runs the business-site-address (icanera.space/<business-name>) database tests against a throwaway Postgres database.
#
#   supabase/tests/business_site_slugs/run.sh
#
# Needs a Postgres 14+ you can create databases and roles in, and psql on the PATH (libpq variables as usual).
# Uses the REAL migration under test; only the auth schema, the company profile table and the platform-fee lookup are stubbed.
# Nothing touches a real Supabase project.
#   KEEP_DB=1   keep the database afterwards
#   DB_NAME=x   use another database name (default ican_siteslug_test)
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
MIGRATION="$ROOT/supabase/migrations/20261105100000_business_site_slugs.sql"
ROLLBACK="$ROOT/supabase/rollback/20261105_rollback_business_site_slugs.sql"
PASTE="$ROOT/BUSINESS_SITE_SLUGS_PASTE_INTO_SUPABASE.sql"
DB="${DB_NAME:-ican_siteslug_test}"
trap '[ "${KEEP_DB:-0}" = "1" ] || psql -X -q -d postgres -c "DROP DATABASE IF EXISTS \"$DB\"" >/dev/null 2>&1' EXIT

psql -X -q -d postgres -c "DROP DATABASE IF EXISTS \"$DB\"" -c "CREATE DATABASE \"$DB\"" >/dev/null
for f in "$HERE/00_stub.sql" "$HERE/01_seed.sql" "$MIGRATION" "$HERE/02_tests.sql"; do
  out=$(psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$f" 2>&1) || { echo "$out" | grep -v NOTICE >&2; echo "FAILED: $f" >&2; exit 1; }
  echo "$out" | sed -n 's/^psql:[^ ]* INFO:  //p' | grep -E '^(PASS|FAIL)' || true
done

# The paste-into-Supabase copy must be the migration, byte for byte.
cmp -s "$MIGRATION" "$PASTE" && echo "PASS paste file equals the migration" || { echo "FAIL paste file differs from the migration"; exit 1; }

# Re-running must change nothing: same addresses, no errors.
before=$(psql -X -q -t -d "$DB" -c "SELECT string_agg(id::text || '=' || site_slug, ',' ORDER BY id) FROM public.cmms_company_profiles")
psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$MIGRATION" >/dev/null 2>&1 || { echo "FAIL migration is idempotent (error on second run)"; exit 1; }
after=$(psql -X -q -t -d "$DB" -c "SELECT string_agg(id::text || '=' || site_slug, ',' ORDER BY id) FROM public.cmms_company_profiles")
[ "$before" = "$after" ] && echo "PASS migration is idempotent" || { echo "FAIL migration changed addresses on a second run"; exit 1; }

# The rollback removes the feature and leaves the companies.
companies=$(psql -X -q -t -d "$DB" -c "SELECT count(*) FROM public.cmms_company_profiles" | tr -d ' ')
psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$ROLLBACK" >/dev/null 2>&1 || { echo "FAIL rollback errored"; exit 1; }
left=$(psql -X -q -t -d "$DB" -c "SELECT (to_regclass('public.cmms_company_site_slug_history') IS NULL)::text || ',' || (to_regprocedure('public.fn_resolve_public_site_slug(text)') IS NULL)::text || ',' || (SELECT count(*) FROM information_schema.columns WHERE table_name='cmms_company_profiles' AND column_name='site_slug')::text || ',' || (SELECT count(*) FROM public.cmms_company_profiles)::text" | tr -d ' ')
[ "$left" = "true,true,0,$companies" ] && echo "PASS rollback removes the feature and keeps every company" || { echo "FAIL rollback left: $left"; exit 1; }
echo "ALL BUSINESS SITE SLUG TESTS PASSED"
