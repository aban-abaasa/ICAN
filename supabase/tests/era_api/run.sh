#!/usr/bin/env bash
# Runs the Era API database tests against a throwaway Postgres database.
#
#   supabase/tests/era_api/run.sh
#
# Needs a Postgres 14+ you can create databases and roles in, and psql on the PATH. Connection comes from the usual
# libpq variables (PGHOST, PGPORT, PGUSER, PGPASSWORD); nothing here touches your real Supabase project.
#   KEEP_DB=1   keep the database afterwards so you can look around
#   DB_NAME=x   use another database name (default ican_era_api_test)
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
DB="${DB_NAME:-ican_era_api_test}"
CORE="$ROOT/supabase/migrations/20261005100000_era_api.sql"
ENDPOINTS="$ROOT/supabase/migrations/20261005100100_era_api_endpoints.sql"
ROLLBACK="$ROOT/supabase/rollback/20261005_rollback_era_api.sql"
WORK="$(mktemp -d)"
trap '[ "${KEEP_DB:-0}" = "1" ] || psql -X -q -d postgres -c "DROP DATABASE IF EXISTS \"$DB\"" >/dev/null 2>&1; rm -rf "$WORK"' EXIT

psql_db() { psql -X -q -v ON_ERROR_STOP=1 -d "$DB" "$@"; }

psql -X -q -d postgres -c "DROP DATABASE IF EXISTS \"$DB\"" -c "CREATE DATABASE \"$DB\"" >/dev/null
psql_db -f "$HERE/00_stub.sql" >/dev/null 2>"$WORK/stub.err" || { grep -v NOTICE "$WORK/stub.err" >&2; echo "stub failed" >&2; exit 2; }

for f in "$CORE" "$ENDPOINTS"; do
  psql_db -f "$f" >/dev/null 2>"$WORK/mig.err" || { grep -v NOTICE "$WORK/mig.err" >&2; echo "$(basename "$f") failed" >&2; exit 2; }
done
echo "migrations applied. re-applying both to prove they are safe to run twice..."
for f in "$CORE" "$ENDPOINTS"; do
  psql_db -f "$f" >/dev/null 2>&1 || { echo "re-applying $(basename "$f") FAILED" >&2; exit 1; }
done

# The developer page ships a snapshot of the registry (its offline reference). It must match the database, or the page
# would document endpoints that do not exist. Regenerate with:  UPDATE_CATALOG=1 supabase/tests/era_api/run.sh
SNAPSHOT="$ROOT/frontend/public/developers/catalog.json"
psql_db -At -c "select jsonb_pretty(public.era_api_catalog())" > "$WORK/catalog.json"
if [ "${UPDATE_CATALOG:-0}" = "1" ]; then cp "$WORK/catalog.json" "$SNAPSHOT"; echo "catalog snapshot regenerated."; fi
if ! diff -q "$WORK/catalog.json" "$SNAPSHOT" >/dev/null 2>&1; then
  echo "frontend/public/developers/catalog.json is out of date with the endpoint registry." >&2
  echo "Regenerate it (UPDATE_CATALOG=1 supabase/tests/era_api/run.sh), then run: node scripts/sync-era-api.mjs" >&2
  exit 1
fi
echo "the developer page's catalogue snapshot matches the registry."

# an administrator's choices must survive a re-run of the endpoint file
psql_db -c "UPDATE public.era_api_endpoints SET enabled = FALSE, cache_seconds = 7 WHERE id = 'icanera.coin_price'" >/dev/null
psql_db -f "$ENDPOINTS" >/dev/null 2>&1
kept=$(psql_db -Atc "SELECT enabled::text || ',' || cache_seconds FROM public.era_api_endpoints WHERE id = 'icanera.coin_price'")
[ "$kept" = "false,7" ] || { echo "re-applying the endpoints file overwrote an administrator's setting ($kept)" >&2; exit 1; }
psql_db -c "UPDATE public.era_api_endpoints SET enabled = TRUE, cache_seconds = 30 WHERE id = 'icanera.coin_price'" >/dev/null
echo "an administrator's kill switch survives a re-run."

for f in "$HERE"/0[1-9]_*.sql; do
  echo "running $(basename "$f")"
  psql_db -f "$f" >/dev/null 2>"$WORK/test.err" || { grep -v NOTICE "$WORK/test.err" >&2; echo "$(basename "$f") aborted" >&2; exit 1; }
  read -r passed failed total <<<"$(psql_db -At -F ' ' -c "select count(*) filter (where ok), count(*) filter (where not ok), count(*) from t.results")"
  if [ "${failed:-0}" != "0" ] || [ "${total:-0}" = "0" ]; then
    psql_db -c "select name, left(info, 400) as detail from t.results where not ok order by n" || true
    echo "FAILED in $(basename "$f"): $failed of $total checks" >&2; exit 1
  fi
  echo "  $passed of $total checks passed"
  cp /dev/null "$WORK/x" 2>/dev/null || true
done

# The rollback must leave nothing behind.
psql_db -f "$ROLLBACK" >/dev/null 2>&1 || { echo "rollback FAILED" >&2; exit 1; }
left=$(psql_db -Atc "select (select count(*) from pg_proc where proname like 'era\_api\_%' or proname like 'era\_h\_%' or proname like 'era\_p\_%' or proname like 'era\_\_%') + (select count(*) from information_schema.tables where table_schema = 'public' and table_name like 'era\_api\_%')")
[ "$left" = "0" ] || { echo "rollback left $left Era API object(s) behind" >&2; exit 1; }
echo "rollback leaves nothing behind."
echo "OK: all Era API database checks passed."
