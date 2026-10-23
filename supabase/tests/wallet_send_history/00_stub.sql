-- Test stub. Not a migration: never run this against a real database.
-- Just enough Supabase (roles, auth.uid, default grants) and the five wallet tables for the REAL
-- backend/UNIVERSAL_TRANSACTION_PIN_APPROVAL.sql, backend/FIX_WALLET_TRANSACTIONS_FK.sql and the real
-- supabase/migrations/20261104090000_wallet_transactions_require_funds.sql + 20261116100000_wallet_send_history.sql
-- to run -- in that order, which is how the live process_transaction_with_pin() was built up.
\set ON_ERROR_STOP on

DO $$ BEGIN CREATE ROLE anon NOLOGIN;          EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS
  $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::UUID $$;
CREATE TABLE auth.users (id UUID PRIMARY KEY);

GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
-- Supabase's default: every new public table and FUNCTION is granted straight to the API roles.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES    TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;

-- ── the wallet tables, as they are live ──────────────────────────────────────
CREATE TABLE public.user_accounts (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id),
  account_holder_name TEXT,
  pin_hash TEXT,
  failed_pin_attempts INT DEFAULT 0
);
CREATE TABLE public.wallet_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  currency TEXT NOT NULL,
  balance NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE public.agent_floats (
  agent_id UUID, currency TEXT, current_balance NUMERIC DEFAULT 0, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE public.user_wallets (id UUID PRIMARY KEY DEFAULT gen_random_uuid());
-- the same foreign key the live table has, which is why the function writes wallet_id = NULL
CREATE TABLE public.wallet_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id UUID REFERENCES public.user_wallets(id) ON DELETE SET NULL,
  user_id UUID,
  transaction_type VARCHAR,
  amount NUMERIC,
  currency VARCHAR,
  status VARCHAR,
  description TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ican_transactions: the table the History tab reads. Row-level security is on, as live: a user may only
-- insert / read rows that are theirs, so the recipient's row can only be written by the SECURITY DEFINER function.
CREATE TABLE public.ican_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  transaction_type TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  currency TEXT,
  description TEXT,
  status TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  involves_two_accounts BOOLEAN NOT NULL DEFAULT false,
  entered_on_behalf BOOLEAN NOT NULL DEFAULT false,
  lock_reason TEXT
);
ALTER TABLE public.ican_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_insert ON public.ican_transactions FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY own_read   ON public.ican_transactions FOR SELECT USING (user_id = auth.uid());

-- live trigger fn_ican_tx_flag_two_accounts, reduced to the part a wallet transfer meets
CREATE FUNCTION public.fn_ican_tx_flag_two_accounts() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF COALESCE(NEW.transaction_type, '') IN ('top_up', 'transfer', 'card_payment', 'cash_payment', 'withdrawal') THEN
    NEW.lock_reason := 'wallet';
  END IF;
  NEW.involves_two_accounts := NEW.lock_reason IS NOT NULL;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_ican_tx_flag_two_accounts BEFORE INSERT ON public.ican_transactions
  FOR EACH ROW EXECUTE FUNCTION public.fn_ican_tx_flag_two_accounts();

-- live trigger trigger_auto_record_tithe (AFTER INSERT ... WHEN status = 'completed'). Its test is
--     v_should_tithe := transaction_type IN (income, ...) OR (metadata->>'transaction_type' IN (income, ...));
--     IF NOT v_should_tithe THEN RETURN NEW; END IF;
-- which is NULL, so it does NOT return, whenever metadata has no 'transaction_type' key -- and the tithe gets
-- recorded. fn_record_tithe_from_transaction is reduced to noting the call, and failing on a negative amount the
-- way the live payment_not_exceeds_tithe constraint does.
CREATE TABLE public.tithe_probe (source_transaction_id UUID);
CREATE FUNCTION public.fn_record_tithe_from_transaction(p_id UUID, p_type VARCHAR, p_pct NUMERIC, p_to VARCHAR)
RETURNS VOID LANGUAGE plpgsql AS $$ BEGIN
  IF (SELECT amount FROM public.ican_transactions WHERE id = p_id) < 0 THEN
    RAISE EXCEPTION 'violates check constraint "payment_not_exceeds_tithe"';
  END IF;
  INSERT INTO public.tithe_probe VALUES (p_id);
END $$;
CREATE FUNCTION public.trigger_record_tithe_on_transaction() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_should_tithe BOOLEAN;
BEGIN
  IF NEW.transaction_type = 'tithe' THEN RETURN NEW; END IF;
  v_should_tithe := NEW.transaction_type IN ('income', 'sale', 'gift', 'bonus', 'refund', 'return')
    OR (NEW.metadata->>'transaction_type' IN ('income', 'salary', 'bonus', 'gift', 'investment_return', 'business_sale'));
  IF NOT v_should_tithe THEN RETURN NEW; END IF;
  PERFORM public.fn_record_tithe_from_transaction(NEW.id, 'personal', 10.0, 'Church');
  RETURN NEW;
END $$;
CREATE TRIGGER trigger_auto_record_tithe AFTER INSERT ON public.ican_transactions
  FOR EACH ROW WHEN (NEW.status = 'completed') EXECUTE FUNCTION public.trigger_record_tithe_on_transaction();

-- ── test helpers ─────────────────────────────────────────────────────────────
CREATE SCHEMA t;
GRANT USAGE ON SCHEMA t TO PUBLIC;
CREATE FUNCTION t.u(n INT) RETURNS UUID LANGUAGE sql IMMUTABLE AS $$ SELECT ('00000000-0000-0000-0000-' || lpad(n::TEXT, 12, '0'))::UUID $$;
CREATE FUNCTION t.login(n INT) RETURNS VOID LANGUAGE plpgsql AS $$ BEGIN
  PERFORM set_config('request.jwt.claim.sub', t.u(n)::TEXT, false);
  EXECUTE 'RESET ROLE'; EXECUTE 'SET ROLE authenticated'; END $$;
CREATE FUNCTION t.as_admin() RETURNS VOID LANGUAGE plpgsql AS $$ BEGIN EXECUTE 'RESET ROLE'; END $$;
CREATE FUNCTION t.check(p_name TEXT, p_ok BOOLEAN, p_detail TEXT DEFAULT '') RETURNS VOID LANGUAGE plpgsql AS $$ BEGIN
  IF p_ok IS TRUE THEN RAISE INFO 'PASS %', p_name; ELSE RAISE EXCEPTION 'FAIL % %', p_name, p_detail; END IF; END $$;
CREATE FUNCTION t.raises(p_sql TEXT) RETURNS BOOLEAN LANGUAGE plpgsql AS $$ BEGIN EXECUTE p_sql; RETURN false; EXCEPTION WHEN OTHERS THEN RETURN true; END $$;
-- one wallet send through the real RPC; returns its single result row
CREATE FUNCTION t.send(p_from INT, p_to INT, p_amount NUMERIC, p_note TEXT DEFAULT NULL, p_pin TEXT DEFAULT 'pin')
RETURNS TABLE (success BOOLEAN, message TEXT, transaction_id UUID) LANGUAGE plpgsql AS $$ BEGIN
  RETURN QUERY SELECT r.success, r.message, r.transaction_id
    FROM public.process_transaction_with_pin('send', t.u(p_from), NULL, p_pin, 'UGX', p_amount,
           jsonb_build_object('recipient_id', t.u(p_to), 'sender_id', t.u(p_from), 'note', p_note)) r;
END $$;
