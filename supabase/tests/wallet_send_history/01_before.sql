-- Before the migration: the live function as built from the repo files. Seeds two people, makes sends, and shows
-- the bug -- the money moves and wallet_transactions has the send, but the History table gets nothing.
\set ON_ERROR_STOP on

INSERT INTO auth.users (id) SELECT t.u(n) FROM generate_series(1, 3) n;
INSERT INTO public.user_accounts (user_id, account_holder_name, pin_hash) VALUES
  (t.u(1), 'Ann Akello', 'pin'), (t.u(2), 'Bob Byaruhanga', 'pin'), (t.u(3), NULL, 'pin');
INSERT INTO public.wallet_accounts (user_id, currency, balance) VALUES (t.u(1), 'UGX', 1000000), (t.u(2), 'UGX', 0);

SELECT t.login(1);
SELECT t.check('before: a send succeeds', (SELECT success FROM t.send(1, 2, 10000, 'old rent')));
SELECT t.check('before: another send succeeds', (SELECT success FROM t.send(1, 2, 2500)));
SELECT t.as_admin();

SELECT t.check('before: wallet_transactions has both sends', (SELECT count(*) FROM public.wallet_transactions WHERE transaction_type = 'send') = 2);
SELECT t.check('before: BUG - nothing reached the History table', (SELECT count(*) FROM public.ican_transactions) = 0);

-- a card-payment send, written by another flow (it carries metadata.source): the backfill must leave it alone
INSERT INTO public.wallet_transactions (user_id, transaction_type, amount, currency, status, metadata)
VALUES (t.u(1), 'send', 777, 'UGX', 'completed',
        jsonb_build_object('source', 'digital_card', 'channel', 'icanera', 'recipient_id', t.u(2)::text));
