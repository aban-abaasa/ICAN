-- A wallet Send must show up in History, for the sender and for the person who was paid.
--
-- process_transaction_with_pin() moves the money and writes ONE row, to wallet_transactions, for the sender
-- only, with nothing but the recipient's id in it. But the wallet's History tab reads ican_transactions (and
-- the IcanEra coin feed) and never wallet_transactions -- so the money moved and the transaction was
-- "not recorded": it did not appear for the sender, and the recipient got no entry at all. The note the
-- sender typed was dropped on the way too.
--
-- The fix: in the same transaction as the money, the send branch also writes the ican_transactions rows
-- the History tab already knows how to show -- the same shape walletTransactionService uses for transfers
-- (transaction_type 'transfer', negative amount out / positive amount in):
--
--     sender     "Sent to <name>[ - <note>]"        amount = -p_amount
--     recipient  "Received from <name>[ - <note>]"  amount = +p_amount
--
-- Both rows carry metadata.transaction_type = 'transfer' on purpose: the live tithe trigger on ican_transactions
-- (trigger_record_tithe_on_transaction) tests "transaction_type IN (income, ...) OR metadata->>'transaction_type' IN (...)",
-- which is NULL -- not false -- when that metadata key is missing, so it falls through and tries to record a tithe on
-- the row. On the negative sender row that breaks the send (payment_not_exceeds_tithe); on the recipient row it
-- would invent a tithe owed on money that was only transferred. Naming the type keeps transfers out of tithe.
--
-- Both rows point back at the wallet_transactions row (metadata.wallet_transaction_id). If a row cannot be
-- written the whole send rolls back, so the money and its record always go together.
--
-- How it is applied: this does NOT paste a copy of the function from another file. It reads the LIVE
-- definition (pg_get_functiondef), adds the two inserts right after the send branch's wallet_transactions
-- insert, and re-creates it, so anything already changed in the live function (the funds guard, the wallet_id
-- fix) stays exactly as it is. A function that already carries the marker below is skipped, so it is safe to
-- run again. Permissions and the SECURITY DEFINER / search_path settings are untouched.
--
-- Then it fills in the past: every earlier wallet send that has no History row yet gets one for each side,
-- dated when it happened. Only plain account-to-account sends (the ones this function wrote) are filled in;
-- card-payment sends have their own flow. Re-running adds nothing twice.
--
-- What this does NOT change: the receive / withdraw / deposit / cash-in / cash-out branches, and who is
-- allowed to call the function.

DO $$
DECLARE
  r         RECORD;
  def       TEXT;
  patched   TEXT;
  n_send    INT;
  found_any BOOLEAN := false;

  -- the send branch's own insert: wallet_transactions ... VALUES (v_transaction_id, <wallet id>, p_user_id, 'send', ...);
  send_pattern TEXT := '(INSERT\s+INTO\s+public\.wallet_transactions\s*\([^)]*\)\s*VALUES\s*\(\s*v_transaction_id\s*,\s*[^,]+,\s*p_user_id\s*,\s*''send''\s*,[^;]*;)';

  send_history TEXT := E'\\1\n\n' || $h$      -- history-ledger: send
      -- The History tab reads ican_transactions, not wallet_transactions: write both sides of the send there,
      -- in this same transaction, so the money and its record cannot come apart.
      DECLARE
        v_sender_name    text;
        v_recipient_name text;
        v_note           text := NULLIF(btrim(COALESCE(p_metadata->>'note', '')), '');
      BEGIN
        SELECT NULLIF(btrim(account_holder_name), '') INTO v_sender_name
          FROM public.user_accounts WHERE user_id = p_user_id LIMIT 1;
        SELECT NULLIF(btrim(account_holder_name), '') INTO v_recipient_name
          FROM public.user_accounts WHERE user_id = v_recipient_id LIMIT 1;
        v_sender_name    := COALESCE(v_sender_name, 'an IcanEra user');
        v_recipient_name := COALESCE(v_recipient_name, 'an IcanEra user');

        INSERT INTO public.ican_transactions (user_id, transaction_type, amount, currency, description, status, metadata)
        VALUES
          (p_user_id, 'transfer', -p_amount, p_currency,
           'Sent to ' || v_recipient_name || COALESCE(' - ' || v_note, ''), 'completed',
           jsonb_build_object('transaction_type', 'transfer', 'transactionType', 'send', 'source', 'icanera_wallet',
             'wallet_transaction_id', v_transaction_id::text,
             'counterparty_user_id', v_recipient_id::text, 'counterparty_name', v_recipient_name, 'note', v_note)),
          (v_recipient_id, 'transfer', p_amount, p_currency,
           'Received from ' || v_sender_name || COALESCE(' - ' || v_note, ''), 'completed',
           jsonb_build_object('transaction_type', 'transfer', 'transactionType', 'receive', 'source', 'icanera_wallet',
             'wallet_transaction_id', v_transaction_id::text,
             'counterparty_user_id', p_user_id::text, 'counterparty_name', v_sender_name, 'note', v_note));
      END;$h$;
BEGIN
  FOR r IN
    SELECT p.oid, p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = 'process_transaction_with_pin' AND n.nspname = 'public'
  LOOP
    found_any := true;
    def := pg_get_functiondef(r.oid);

    IF position('history-ledger: send' IN def) > 0 THEN
      RAISE NOTICE 'Send already writes History rows, skipping: %', r.sig;
      CONTINUE;
    END IF;

    SELECT count(*) INTO n_send FROM regexp_matches(def, send_pattern, 'gi');
    IF n_send <> 1 THEN
      RAISE EXCEPTION 'Expected exactly 1 send-branch wallet_transactions insert in %, found % -- inspect the function by hand.', r.sig, n_send;
    END IF;

    patched := regexp_replace(def, send_pattern, send_history, 'gi');
    IF patched = def THEN
      RAISE EXCEPTION 'Could not patch the send branch of % -- inspect the function by hand.', r.sig;
    END IF;

    EXECUTE patched;
    RAISE NOTICE 'Send now writes a History row for the sender and the recipient: %', r.sig;
  END LOOP;

  IF NOT found_any THEN
    RAISE EXCEPTION 'public.process_transaction_with_pin does not exist -- nothing to patch.';
  END IF;
END $$;

-- Earlier sends: one History row per side, dated when the send happened, skipping any already written.
INSERT INTO public.ican_transactions (user_id, transaction_type, amount, currency, description, status, metadata, created_at)
SELECT s.uid, 'transfer', s.amount, w.currency, s.description, 'completed',
       jsonb_build_object('transaction_type', 'transfer', 'transactionType', s.kind, 'source', 'icanera_wallet',
         'wallet_transaction_id', w.id::text,
         'counterparty_user_id', s.other_uid::text, 'counterparty_name', s.other_name, 'backfilled', true),
       w.created_at
FROM public.wallet_transactions w
LEFT JOIN public.user_accounts sa ON sa.user_id = w.user_id
LEFT JOIN public.user_accounts ra ON ra.user_id = (w.metadata->>'recipient_id')::uuid
CROSS JOIN LATERAL (VALUES
  ('send',    w.user_id,                              -w.amount, (w.metadata->>'recipient_id')::uuid, COALESCE(NULLIF(btrim(ra.account_holder_name), ''), 'an IcanEra user'),
              'Sent to '       || COALESCE(NULLIF(btrim(ra.account_holder_name), ''), 'an IcanEra user')),
  ('receive', (w.metadata->>'recipient_id')::uuid,     w.amount, w.user_id,                           COALESCE(NULLIF(btrim(sa.account_holder_name), ''), 'an IcanEra user'),
              'Received from ' || COALESCE(NULLIF(btrim(sa.account_holder_name), ''), 'an IcanEra user'))
) AS s(kind, uid, amount, other_uid, other_name, description)
WHERE w.transaction_type = 'send'
  AND w.status = 'completed'
  AND w.metadata ? 'pin_verified'
  AND NOT (w.metadata ? 'source')
  AND w.metadata->>'recipient_id' IS NOT NULL
  AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = s.uid)
  AND NOT EXISTS (
    SELECT 1 FROM public.ican_transactions h
    WHERE h.user_id = s.uid AND h.metadata->>'wallet_transaction_id' = w.id::text
  );

NOTIFY pgrst, 'reload schema';
