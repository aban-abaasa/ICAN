-- After running the migration a second time: nothing doubled, and sending still records once per side.
\set ON_ERROR_STOP on

SELECT t.check('rerun: the function carries the History write exactly once',
  (SELECT (length(d) - length(replace(d, 'history-ledger: send', ''))) / length('history-ledger: send')
     FROM (SELECT pg_get_functiondef(p.oid) AS d FROM pg_proc p WHERE p.proname = 'process_transaction_with_pin') x) = 1);
SELECT t.check('rerun: the funds guard from the earlier migration is still there',
  (SELECT pg_get_functiondef(p.oid) LIKE '%Insufficient balance. Nothing was moved.%' FROM pg_proc p WHERE p.proname = 'process_transaction_with_pin'));
SELECT t.check('rerun: still SECURITY DEFINER',
  (SELECT p.prosecdef FROM pg_proc p WHERE p.proname = 'process_transaction_with_pin'));
SELECT t.check('rerun: the backfill did not add a second copy of anything',
  (SELECT max(c) FROM (SELECT count(*) c FROM public.ican_transactions GROUP BY user_id, metadata->>'wallet_transaction_id') s) = 1);

SELECT t.login(1);
CREATE TEMP TABLE r3 AS SELECT * FROM t.send(1, 2, 1234, 'again');
SELECT t.as_admin();
SELECT t.check('rerun: a send afterwards still writes exactly one row per side',
  (SELECT count(*) FROM public.ican_transactions WHERE metadata->>'wallet_transaction_id' = (SELECT transaction_id::text FROM r3)) = 2);
