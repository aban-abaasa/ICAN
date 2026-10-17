-- A wallet send, receive, withdraw or deposit must FAIL when the payer cannot cover it.
--
-- process_transaction_with_pin() takes the payer's money with
--     UPDATE ... SET balance = balance - p_amount ... WHERE ... AND balance >= p_amount;
-- which quietly updates NOTHING when the balance is too low -- and then carries straight on and
-- credits the other side anyway. Four branches do this:
--
--   send      sender's wallet debit unchecked      -> recipient still credited
--   receive   sender's wallet debit unchecked      -> receiver still credited
--   withdraw  user's wallet debit unchecked        -> agent float still credited
--   deposit   agent float debit unchecked          -> user wallet still credited
--
-- So a request for more than the payer holds creates money. (cashin and cashout already check
-- ROW_COUNT with "IF NOT FOUND" and are left alone.)
--
-- The fix is the same one cashin already uses: right after the debit, if no row was debited,
-- return a failure and stop -- nothing is credited, nothing is recorded.
--
-- How it is applied: this does NOT paste a copy of the function from another file. It reads
-- the LIVE definition (pg_get_functiondef), adds the check after each unguarded debit, and
-- re-creates it, so anything already changed in the live function stays exactly as it is.
-- A debit that is already followed by "IF NOT FOUND" is skipped, so it is safe to run again.
-- Permissions and the SECURITY DEFINER / search_path settings are untouched.
--
-- What this does NOT change: who is allowed to call the function. See the note in the
-- pull request about checking that the caller is the person being debited.

DO $$
DECLARE
  r              RECORD;
  def            TEXT;
  patched        TEXT;
  n_wallet       INT;
  n_float        INT;
  found_any      BOOLEAN := false;

  -- a payer-wallet debit that carries an amount guard but is not followed by IF NOT FOUND
  wallet_pattern TEXT := '(UPDATE\s+public\.wallet_accounts\s+SET\s+balance\s*=\s*balance\s*-\s*p_amount,\s*updated_at\s*=\s*now\(\)\s+WHERE[^;]*>=\s*p_amount;)(?!\s*(?:--[^\n]*\n\s*)*IF\s+NOT\s+FOUND)';
  -- the same for an agent float debit
  float_pattern  TEXT := '(UPDATE\s+public\.agent_floats\s+SET\s+current_balance\s*=\s*current_balance\s*-\s*p_amount,\s*updated_at\s*=\s*now\(\)\s+WHERE[^;]*>=\s*p_amount;)(?!\s*(?:--[^\n]*\n\s*)*IF\s+NOT\s+FOUND)';

  wallet_guard   TEXT := E'\\1\n\n' || $g$      IF NOT FOUND THEN
        RETURN QUERY SELECT false, '❌ Insufficient balance. Nothing was moved.'::text, NULL::uuid, 0::numeric, 0::numeric, 0::numeric;
        RETURN;
      END IF;$g$;
  float_guard    TEXT := E'\\1\n\n' || $g$      IF NOT FOUND THEN
        RETURN QUERY SELECT false, '❌ Insufficient agent float. Nothing was moved.'::text, NULL::uuid, 0::numeric, 0::numeric, 0::numeric;
        RETURN;
      END IF;$g$;
BEGIN
  FOR r IN
    SELECT p.oid, p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = 'process_transaction_with_pin' AND n.nspname = 'public'
  LOOP
    found_any := true;
    def := pg_get_functiondef(r.oid);

    SELECT count(*) INTO n_wallet FROM regexp_matches(def, wallet_pattern, 'gi');
    SELECT count(*) INTO n_float  FROM regexp_matches(def, float_pattern,  'gi');

    IF n_wallet + n_float = 0 THEN
      RAISE NOTICE 'Already checks every payer debit, skipping: %', r.sig;
      CONTINUE;
    END IF;

    patched := regexp_replace(def,     wallet_pattern, wallet_guard, 'gi');
    patched := regexp_replace(patched, float_pattern,  float_guard,  'gi');
    IF patched = def THEN
      RAISE EXCEPTION 'Found % unguarded debit(s) in % but could not patch them -- inspect the function by hand.', n_wallet + n_float, r.sig;
    END IF;

    EXECUTE patched;
    RAISE NOTICE 'Now fails when the payer cannot cover it (% wallet debit(s), % agent-float debit(s) guarded): %', n_wallet, n_float, r.sig;
  END LOOP;

  IF NOT found_any THEN
    RAISE EXCEPTION 'public.process_transaction_with_pin does not exist -- nothing to patch.';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
