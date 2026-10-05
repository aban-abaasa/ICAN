#!/usr/bin/env bash
# Runs the franchise-layer database tests against a throwaway Postgres database.
#
#   supabase/tests/franchise/run.sh
#
# Needs a Postgres 14+ you can create databases and roles in, and psql on the PATH. Connection comes from the
# usual libpq variables (PGHOST, PGPORT, PGUSER, PGPASSWORD); nothing here touches your real Supabase project.
#   KEEP_DB=1   keep the database afterwards so you can look around
#   DB_NAME=x   use another database name (default ican_franchise_test)
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
DB="${DB_NAME:-ican_franchise_test}"
MIGRATION="$ROOT/supabase/migrations/20261004100000_franchise_layer.sql"
ROLLBACK="$ROOT/supabase/rollback/20261004_rollback_franchise_layer.sql"
WORK="$(mktemp -d)"
trap '[ "${KEEP_DB:-0}" = "1" ] || psql -X -q -d postgres -c "DROP DATABASE IF EXISTS \"$DB\"" >/dev/null 2>&1; rm -rf "$WORK"' EXIT

psql_db() { psql -X -q -v ON_ERROR_STOP=1 -d "$DB" "$@"; }

# 1. Pull the REAL fee functions out of the repo so the trigger is tested against the actual money code.
ROUTE="$ROOT/backend/ROUTE_PLATFORM_FEES_TO_IWOS_BUSINESS.sql"
FIX="$ROOT/backend/FIX_AND_BACKFILL_PLATFORM_FEE_ROUTING.sql"
a=$(grep -n "CREATE TABLE IF NOT EXISTS public.ican_platform_fee_recipient" "$ROUTE" | cut -d: -f1)
b=$(grep -n "^-- 3. sell_ican_coins()" "$ROUTE" | cut -d: -f1)
c=$(grep -n "^-- 1a. Reversal helper" "$FIX" | cut -d: -f1)
d=$(grep -n "fn_reverse_platform_fee_to_business(TEXT, TEXT, UUID, TEXT) FROM PUBLIC" "$FIX" | cut -d: -f1)
if [ -z "$a" ] || [ -z "$b" ] || [ -z "$c" ] || [ -z "$d" ]; then
  echo "Could not find the fee functions in backend/. Those files changed shape: update the markers in run.sh." >&2; exit 2
fi
sed -n "${a},$((b-2))p" "$ROUTE" > "$WORK/real_fee_credit.sql"
sed -n "$((c+1)),$((d+1))p" "$FIX" > "$WORK/real_fee_reverse.sql"
grep -q "fn_credit_platform_fee_to_business" "$WORK/real_fee_credit.sql" && grep -q "fn_reverse_platform_fee_to_business" "$WORK/real_fee_reverse.sql" \
  || { echo "Extracted fee functions look wrong." >&2; exit 2; }

# 2. Fresh database: stub, then the migration under test.
psql -X -q -d postgres -c "DROP DATABASE IF EXISTS \"$DB\"" -c "CREATE DATABASE \"$DB\"" >/dev/null
( cd "$WORK" && psql_db -f "$HERE/00_stub.sql" >/dev/null 2>"$WORK/stub.err" ) || { grep -v NOTICE "$WORK/stub.err" >&2; echo "stub failed" >&2; exit 2; }
psql_db -f "$MIGRATION" >/dev/null 2>"$WORK/mig.err" || { grep -v NOTICE "$WORK/mig.err" >&2; echo "migration failed" >&2; exit 2; }
echo "migration applied. re-applying to prove it is safe to run twice..."
psql_db -f "$MIGRATION" >/dev/null 2>&1 || { echo "re-applying the migration FAILED" >&2; exit 1; }

# 3. The tests (each file adds to one shared result table).
for f in "$HERE"/0[1-9]_*.sql; do
  echo "running $(basename "$f")"
  psql_db -f "$f" >/dev/null 2>"$WORK/test.err" || { grep -v NOTICE "$WORK/test.err" >&2; echo "$(basename "$f") aborted" >&2; exit 1; }
done

# 4. The rollback must leave nothing behind and fees must keep crediting without the layer.
psql_db -f "$ROLLBACK" >/dev/null 2>&1 || { echo "rollback FAILED" >&2; exit 1; }
left=$(psql_db -Atc "select (select count(*) from pg_proc where proname like 'ican_franchise_%') + (select count(*) from information_schema.tables where table_name like 'ican_franchise_%') + (select count(*) from pg_trigger where tgname like '%franchise%')")
[ "$left" = "0" ] || { echo "rollback left $left franchise object(s) behind" >&2; exit 1; }
psql_db -Atc "select fn_credit_platform_fee_to_business(1, 'ican', 'after-rollback', 'corporate_subscription', '00000000-0000-0000-0000-000000000011'::uuid, 'x') ->> 'credited'" | grep -q true \
  || { echo "fees stopped crediting after the rollback" >&2; exit 1; }
echo "rollback leaves nothing behind and fees still credit."

# 5. Report.
read -r passed failed total <<<"$(psql_db -At -F ' ' -c "select count(*) filter (where ok), count(*) filter (where not ok), count(*) from t.results" 2>/dev/null || echo '0 0 0')"
if [ "${failed:-0}" != "0" ] || [ "${total:-0}" = "0" ]; then
  psql_db -c "select name, left(info, 200) as detail from t.results where not ok order by n" 2>/dev/null || true
  echo "FAILED: $failed of $total checks" >&2; exit 1
fi
echo "OK: $passed of $total database checks passed."
