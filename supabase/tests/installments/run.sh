#!/usr/bin/env bash
# Runs the installment-orders database tests against a throwaway Postgres database.
#
#   supabase/tests/installments/run.sh
#
# Needs a Postgres 14+ you can create databases and roles in, and psql on the PATH. Connection comes from the
# usual libpq variables (PGHOST, PGPORT, PGUSER, PGPASSWORD); nothing here touches your real Supabase project.
#   KEEP_DB=1   keep the database afterwards so you can look around
#   DB_NAME=x   use another database name (default ican_installments_test)
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
DB="${DB_NAME:-ican_installments_test}"
MIGRATION="$ROOT/supabase/migrations/20261011100000_installment_orders.sql"
WORK="$(mktemp -d)"
trap '[ "${KEEP_DB:-0}" = "1" ] || psql -X -q -d postgres -c "DROP DATABASE IF EXISTS \"$DB\"" >/dev/null 2>&1; rm -rf "$WORK"' EXIT

psql_db() { psql -X -q -v ON_ERROR_STOP=1 -d "$DB" "$@"; }

psql -X -q -d postgres -c "DROP DATABASE IF EXISTS \"$DB\"" -c "CREATE DATABASE \"$DB\"" >/dev/null
psql_db -f "$HERE/00_stub.sql" >/dev/null 2>"$WORK/stub.err" || { grep -v NOTICE "$WORK/stub.err" >&2; echo "stub failed" >&2; exit 2; }
psql_db -f "$MIGRATION" >/dev/null 2>"$WORK/mig.err" || { grep -v NOTICE "$WORK/mig.err" >&2; echo "migration failed" >&2; exit 2; }
echo "migration applied. re-applying to prove it is safe to run twice..."
psql_db -f "$MIGRATION" >/dev/null 2>&1 || { echo "re-applying the migration FAILED" >&2; exit 1; }

for f in "$HERE"/0[1-9]_*.sql; do
  echo "running $(basename "$f")"
  psql_db -f "$f" >/dev/null 2>"$WORK/test.err" || { grep -v NOTICE "$WORK/test.err" >&2; echo "$(basename "$f") aborted" >&2; exit 1; }
done

# An administrator's settings must survive a re-run of the migration.
psql_db -c "UPDATE public.installment_config SET value = '35' WHERE key = 'min_deposit_pct'" >/dev/null
psql_db -f "$MIGRATION" >/dev/null 2>&1
kept=$(psql_db -Atc "SELECT value FROM public.installment_config WHERE key = 'min_deposit_pct'")
[ "$kept" = "35" ] || { echo "re-applying the migration overwrote an administrator's setting ($kept)" >&2; exit 1; }
psql_db -c "UPDATE public.installment_config SET value = '20' WHERE key = 'min_deposit_pct'" >/dev/null
echo "an administrator's settings survive a re-run."

# The rollback must refuse while plans hold money, and leave nothing behind once they are closed.
ROLLBACK="$ROOT/supabase/rollback/20261011_rollback_installment_orders.sql"
psql_db -c "UPDATE public.installment_plans SET status = 'active', held_ican = 1 WHERE code = (SELECT code FROM public.installment_plans WHERE status = 'completed' LIMIT 1)" >/dev/null
if psql_db -f "$ROLLBACK" >/dev/null 2>&1; then echo "rollback ran while a plan still held money" >&2; exit 1; fi
echo "rollback refuses while a plan holds money."
psql_db -c "UPDATE public.installment_plans SET status = 'completed', held_ican = 0" >/dev/null
psql_db -c "UPDATE public.installment_plans SET status = 'completed', held_ican = 0 WHERE status IN ('active','ready','awaiting_deposit')" >/dev/null
psql_db -f "$ROLLBACK" >/dev/null 2>"$WORK/rb.err" || { grep -v NOTICE "$WORK/rb.err" >&2; echo "rollback FAILED" >&2; exit 1; }
left=$(psql_db -Atc "select (select count(*) from pg_proc where proname like 'installment\_%' or proname like '\_inst\_%' or proname like 'business\_site\_%') + (select count(*) from information_schema.tables where table_name like 'installment\_%' or table_name like 'business\_site\_%') + (select count(*) from pg_trigger where tgname like '%installment%')")
[ "$left" = "0" ] || { echo "rollback left $left installment object(s) behind" >&2; exit 1; }
echo "rollback leaves nothing behind."

read -r passed failed total <<<"$(psql_db -At -F ' ' -c "select count(*) filter (where ok), count(*) filter (where not ok), count(*) from t.results" 2>/dev/null || echo '0 0 0')"
if [ "${failed:-0}" != "0" ] || [ "${total:-0}" = "0" ]; then
  psql_db -c "select name, left(info, 300) as detail from t.results where not ok order by n" 2>/dev/null || true
  echo "FAILED: $failed of $total checks" >&2; exit 1
fi
echo "OK: $passed of $total database checks passed."
