-- After the migration: earlier sends are filled in, and a new send writes both sides of its History.
\set ON_ERROR_STOP on

-- ── the past was filled in ───────────────────────────────────────────────────
SELECT t.check('backfill: 2 plain sends x 2 sides = 4 rows, the card send is left alone',
  (SELECT count(*) FROM public.ican_transactions) = 4,
  (SELECT count(*)::text FROM public.ican_transactions));
SELECT t.check('backfill: sender sees "Sent to Bob Byaruhanga", negative',
  EXISTS (SELECT 1 FROM public.ican_transactions WHERE user_id = t.u(1) AND amount = -10000 AND description = 'Sent to Bob Byaruhanga' AND transaction_type = 'transfer'));
SELECT t.check('backfill: recipient sees "Received from Ann Akello", positive',
  EXISTS (SELECT 1 FROM public.ican_transactions WHERE user_id = t.u(2) AND amount = 10000 AND description = 'Received from Ann Akello'));
SELECT t.check('backfill: dated when the send happened, not now',
  (SELECT bool_and(h.created_at = w.created_at) FROM public.ican_transactions h
     JOIN public.wallet_transactions w ON w.id::text = h.metadata->>'wallet_transaction_id'));
SELECT t.check('backfill: nothing was written for the card-payment send',
  NOT EXISTS (SELECT 1 FROM public.ican_transactions WHERE amount IN (777, -777)));

-- ── a new send ───────────────────────────────────────────────────────────────
SELECT t.login(1);
CREATE TEMP TABLE r1 AS SELECT * FROM t.send(1, 2, 40000, 'school fees');
SELECT t.as_admin();
SELECT t.check('new send: succeeds', (SELECT success FROM r1));
SELECT t.check('new send: sender row is negative, named, with the note',
  EXISTS (SELECT 1 FROM public.ican_transactions WHERE user_id = t.u(1) AND amount = -40000 AND currency = 'UGX'
          AND description = 'Sent to Bob Byaruhanga - school fees' AND status = 'completed'));
SELECT t.check('new send: recipient row is positive, named, with the note',
  EXISTS (SELECT 1 FROM public.ican_transactions WHERE user_id = t.u(2) AND amount = 40000 AND currency = 'UGX'
          AND description = 'Received from Ann Akello - school fees' AND status = 'completed'));
SELECT t.check('new send: both rows point at the wallet_transactions row the RPC returned',
  (SELECT count(*) FROM public.ican_transactions WHERE metadata->>'wallet_transaction_id' = (SELECT transaction_id::text FROM r1)) = 2);
SELECT t.check('new send: History rows are marked wallet transfers (locked like other wallet rows)',
  (SELECT bool_and(lock_reason = 'wallet' AND involves_two_accounts) FROM public.ican_transactions WHERE metadata->>'wallet_transaction_id' = (SELECT transaction_id::text FROM r1)));
SELECT t.check('new send: the money moved',
  (SELECT balance FROM public.wallet_accounts WHERE user_id = t.u(1)) = 1000000 - 10000 - 2500 - 40000
  AND (SELECT balance FROM public.wallet_accounts WHERE user_id = t.u(2)) = 10000 + 2500 + 40000);

-- a transfer is not income: the tithe trigger must have recorded nothing for any of these rows
SELECT t.check('no tithe was recorded on any backfilled or new transfer row',
  (SELECT count(*) FROM public.tithe_probe) = 0, (SELECT count(*)::text FROM public.tithe_probe));

-- the people see only their own rows, as the History tab will
SELECT t.login(2);
SELECT t.check('recipient reads their own received row through row-level security',
  (SELECT count(*) FROM public.ican_transactions WHERE amount = 40000) = 1
  AND (SELECT count(*) FROM public.ican_transactions WHERE amount = -40000) = 0);
SELECT t.as_admin();

-- no note, and a recipient with no name on file
SELECT t.login(1);
CREATE TEMP TABLE r2 AS SELECT * FROM t.send(1, 3, 500);
SELECT t.as_admin();
SELECT t.check('no note: plain "Sent to ..." with a fallback for an unnamed recipient',
  EXISTS (SELECT 1 FROM public.ican_transactions WHERE user_id = t.u(1) AND amount = -500 AND description = 'Sent to an IcanEra user'));
SELECT t.check('no note: recipient side reads "Received from Ann Akello"',
  EXISTS (SELECT 1 FROM public.ican_transactions WHERE user_id = t.u(3) AND amount = 500 AND description = 'Received from Ann Akello'));

-- ── sends that fail leave no trace ───────────────────────────────────────────
CREATE TEMP TABLE counts AS SELECT
  (SELECT count(*) FROM public.ican_transactions) AS hist, (SELECT count(*) FROM public.wallet_transactions) AS wt,
  (SELECT balance FROM public.wallet_accounts WHERE user_id = t.u(1)) AS bal;

SELECT t.login(1);
SELECT t.check('too much: refused', NOT (SELECT success FROM t.send(1, 2, 999999999)));
SELECT t.check('wrong PIN: refused', NOT (SELECT success FROM t.send(1, 2, 100, NULL, 'nope')));
SELECT t.as_admin();
SELECT t.check('refused sends wrote no History and moved no money',
  (SELECT count(*) FROM public.ican_transactions) = (SELECT hist FROM counts)
  AND (SELECT count(*) FROM public.wallet_transactions) = (SELECT wt FROM counts)
  AND (SELECT balance FROM public.wallet_accounts WHERE user_id = t.u(1)) = (SELECT bal FROM counts));

-- the record is part of the send: if the History row cannot be written (here: the recipient is not a real
-- user, so the row cannot be filed under them), the function's own exception handler undoes the whole send
-- and answers success = false -- the money does not move
SELECT t.login(1);
CREATE TEMP TABLE r4 AS SELECT * FROM public.process_transaction_with_pin('send', t.u(1), NULL, 'pin', 'UGX', 100,
  jsonb_build_object('recipient_id', '99999999-9999-9999-9999-999999999999'));
SELECT t.as_admin();
SELECT t.check('unwritable History row: the send is refused', NOT (SELECT success FROM r4));
SELECT t.check('...and nothing was charged, credited or recorded',
  (SELECT balance FROM public.wallet_accounts WHERE user_id = t.u(1)) = (SELECT bal FROM counts)
  AND NOT EXISTS (SELECT 1 FROM public.wallet_accounts WHERE user_id = '99999999-9999-9999-9999-999999999999')
  AND (SELECT count(*) FROM public.wallet_transactions) = (SELECT wt FROM counts)
  AND (SELECT count(*) FROM public.ican_transactions) = (SELECT hist FROM counts));
