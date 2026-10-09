-- ============================================================
-- CHURCH / BUSINESS TITHE GIVING — paste this whole file into the Supabase SQL editor and Run.
-- It is the three migrations below, in order. Safe to run more than once.
--   1. 20261014100000_church_tithe_giving.sql
--   2. 20261014110000_church_tithe_business_wallet.sql
--   3. 20261014120000_church_tithe_business_payer.sql
-- ============================================================

-- ########################################################
-- PART: 20261014100000_church_tithe_giving
-- ########################################################
-- ============================================================
-- Give tithe to a registered church (wallet, mobile money / card, or cash)
-- ============================================================
-- Until now a tithe only named a recipient *type* ("church"): the money left the
-- giver's wallet (or was just noted as cash) and went nowhere in particular.
-- This lets a giver search the businesses registered on IcanEra, pick the church
-- they belong to, and give to it three ways:
--
--   wallet        giver's IcanEra wallet (UGX) -> church owner's IcanEra wallet. The app asks
--                 for the wallet PIN first. Debit + credit + tithe record are one transaction.
--   flutterwave   mobile money / card / bank through Flutterwave checkout. Only the
--                 verify-tithe-payment Edge Function (which re-checks the charge with
--                 Flutterwave using the secret key) can settle it, via the service-role-only
--                 fn_settle_church_tithe_flutterwave below. The giver's wallet is untouched.
--   cash          given by hand. Recorded for the giver; the church owner confirms receipt.
--
-- Additive and safe to re-run: no existing column is dropped, and the one CHECK that
-- changes (payment_method) only gains a value.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Columns on ican_tithe_records
-- ------------------------------------------------------------
ALTER TABLE public.ican_tithe_records
  ADD COLUMN IF NOT EXISTS recipient_business_id UUID,
  ADD COLUMN IF NOT EXISTS recipient_name        TEXT,
  ADD COLUMN IF NOT EXISTS payment_reference     TEXT,
  ADD COLUMN IF NOT EXISTS giver_message         TEXT,
  ADD COLUMN IF NOT EXISTS church_confirmed_at   TIMESTAMPTZ,
  -- TitheManager already writes these two when it settles a tithe; make sure they exist.
  ADD COLUMN IF NOT EXISTS payment_status        TEXT,
  ADD COLUMN IF NOT EXISTS settled_date          TIMESTAMPTZ;

COMMENT ON COLUMN public.ican_tithe_records.recipient_business_id IS
  'The registered church (business_profiles.id) this tithe was given to. NULL for tithes with only a recipient type.';
COMMENT ON COLUMN public.ican_tithe_records.payment_reference IS
  'Flutterwave tx_ref for flutterwave payments. Unique, so one charge can never settle two tithes.';
COMMENT ON COLUMN public.ican_tithe_records.church_confirmed_at IS
  'When the church owner confirmed a CASH tithe was received. Wallet / flutterwave tithes are confirmed by the money itself.';

-- payment_method gains 'flutterwave'. The inline CHECK from TITHE_CASH_WALLET_AND_NO_DOUBLE_TITHE.sql
-- got Postgres' default name; drop whatever CHECK mentions payment_method, then add the wider one.
DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.ican_tithe_records'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%payment_method%'
  LOOP
    EXECUTE format('ALTER TABLE public.ican_tithe_records DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE public.ican_tithe_records
  ADD CONSTRAINT ican_tithe_records_payment_method_check
  CHECK (payment_method IN ('wallet', 'cash', 'flutterwave'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_tithe_payment_reference
  ON public.ican_tithe_records (payment_reference) WHERE payment_reference IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tithe_recipient_business
  ON public.ican_tithe_records (recipient_business_id, giving_date DESC) WHERE recipient_business_id IS NOT NULL;

-- ------------------------------------------------------------
-- 2. Which businesses count as a church
-- ------------------------------------------------------------
-- A business is a church when its type names one, or its owner switched on
-- metadata.accepts_tithe. Anything else only shows up when the giver asks for
-- "all registered businesses" (the optional load in the app).
CREATE OR REPLACE FUNCTION public.fn_business_is_church(p_type TEXT, p_name TEXT, p_metadata JSONB)
RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE
AS $$
  SELECT COALESCE((p_metadata ->> 'accepts_tithe')::BOOLEAN, FALSE)
      OR COALESCE(p_type, '') ~* '(church|ministr|parish|cathedral|chapel|fellowship|assembl|congregation|temple|mosque|synagogue|faith|worship|gospel|pentecost|revival)'
      OR COALESCE(p_name, '') ~* '(church|ministr|parish|cathedral|chapel|fellowship|assembly|congregation|temple|mosque|synagogue|pentecost|revival)';
$$;

-- ------------------------------------------------------------
-- 3. Search registered churches
-- ------------------------------------------------------------
-- Returns only what a giver needs to pick the right place: no owner identity,
-- no contact details. Churches first, then alphabetical.
CREATE OR REPLACE FUNCTION public.fn_search_tithe_recipients(
  p_query       TEXT    DEFAULT NULL,
  p_include_all BOOLEAN DEFAULT FALSE,
  p_limit       INTEGER DEFAULT 30
)
RETURNS TABLE (
  business_id   UUID,
  business_name TEXT,
  business_type TEXT,
  country       TEXT,
  is_church     BOOLEAN,
  is_mine       BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_q TEXT := NULLIF(btrim(COALESCE(p_query, '')), '');
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT bp.id,
         bp.business_name::TEXT,
         bp.business_type::TEXT,
         bp.country::TEXT,
         public.fn_business_is_church(bp.business_type::TEXT, bp.business_name::TEXT, bp.metadata) AS is_church,
         (bp.user_id = auth.uid()) AS is_mine
  FROM public.business_profiles bp
  WHERE COALESCE(bp.status, 'active') = 'active'
    AND NULLIF(btrim(bp.business_name::TEXT), '') IS NOT NULL
    AND (p_include_all OR public.fn_business_is_church(bp.business_type::TEXT, bp.business_name::TEXT, bp.metadata))
    AND (v_q IS NULL OR bp.business_name ILIKE '%' || replace(replace(v_q, '%', ''), '_', '') || '%')
  ORDER BY public.fn_business_is_church(bp.business_type::TEXT, bp.business_name::TEXT, bp.metadata) DESC,
           bp.business_name
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 30), 1), 100);
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_search_tithe_recipients(TEXT, BOOLEAN, INTEGER) TO authenticated;

-- ------------------------------------------------------------
-- 4. Credit a church owner's wallet (internal helper, not callable from the app)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_credit_wallet_ugx(p_user_id UUID, p_amount DECIMAL)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.wallet_accounts
     SET balance = COALESCE(balance, 0) + p_amount, updated_at = NOW()
   WHERE user_id = p_user_id AND currency = 'UGX';
  IF NOT FOUND THEN
    INSERT INTO public.wallet_accounts (user_id, currency, balance, created_at, updated_at)
    VALUES (p_user_id, 'UGX', p_amount, NOW(), NOW());
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_credit_wallet_ugx(UUID, DECIMAL) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 5. Give by wallet or cash
-- ------------------------------------------------------------
-- The wallet PIN is checked by the app before this is called (same as every other wallet
-- spend in the app). Everything the database can enforce, it does: the recipient must be an
-- active business that is not the giver's own, the amount must be positive, the giver's wallet
-- row is locked while it is debited, and debit + credit + record succeed or fail together.
-- Self-contained on purpose (it writes the same tithe / report / audit rows fn_add_tithe does)
-- so a church tithe does not depend on that function's current body.
CREATE OR REPLACE FUNCTION public.fn_give_tithe_to_church(
  p_business_id    UUID,
  p_amount         DECIMAL,
  p_giving_type    VARCHAR DEFAULT 'tithe',
  p_payment_method TEXT    DEFAULT 'wallet',
  p_is_anonymous   BOOLEAN DEFAULT FALSE,
  p_message        TEXT    DEFAULT NULL,
  p_tithe_type     TEXT    DEFAULT 'personal',
  p_giving_date    DATE    DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  success            BOOLEAN,
  tithe_record_id    UUID,
  new_wallet_balance DECIMAL,
  church_name        TEXT,
  message            TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id  UUID := auth.uid();
  v_owner_id UUID;
  v_church   TEXT;
  v_status   TEXT;
  v_balance  DECIMAL;
  v_new_bal  DECIMAL;
  v_tithe_id UUID;
  v_txn_id   UUID;
  v_hash     VARCHAR;
  v_prev     VARCHAR;
  v_type     TEXT := CASE WHEN p_tithe_type = 'business' THEN 'business' ELSE 'personal' END;
  v_date     DATE := COALESCE(p_giving_date, CURRENT_DATE);
  v_msg      TEXT := NULLIF(left(btrim(COALESCE(p_message, '')), 500), '');
BEGIN
  IF v_user_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::DECIMAL, NULL::TEXT, 'Not authenticated'::TEXT;
    RETURN;
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::DECIMAL, NULL::TEXT, 'Enter an amount greater than 0'::TEXT;
    RETURN;
  END IF;
  IF p_payment_method NOT IN ('wallet', 'cash') THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::DECIMAL, NULL::TEXT,
      'Use the Flutterwave checkout to give by mobile money or card'::TEXT;
    RETURN;
  END IF;
  IF p_giving_type NOT IN ('tithe', 'offering', 'charity', 'mission', 'building_fund', 'alms', 'other') THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::DECIMAL, NULL::TEXT, 'Unknown type of giving'::TEXT;
    RETURN;
  END IF;

  SELECT bp.user_id, bp.business_name::TEXT, COALESCE(bp.status, 'active')
    INTO v_owner_id, v_church, v_status
  FROM public.business_profiles bp
  WHERE bp.id = p_business_id;

  IF v_owner_id IS NULL OR v_status <> 'active' THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::DECIMAL, NULL::TEXT, 'That church is not available to receive tithe'::TEXT;
    RETURN;
  END IF;
  IF v_owner_id = v_user_id THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::DECIMAL, v_church,
      'You own this church, so there is nowhere to send it. Use the normal tithe tabs to record your own giving.'::TEXT;
    RETURN;
  END IF;

  -- Wallet: lock the giver's row, then check and debit.
  SELECT COALESCE(wa.balance, 0) INTO v_balance
  FROM public.wallet_accounts wa
  WHERE wa.user_id = v_user_id AND wa.currency = 'UGX'
  ORDER BY wa.created_at
  LIMIT 1
  FOR UPDATE;
  v_balance := COALESCE(v_balance, 0);
  v_new_bal := v_balance;

  IF p_payment_method = 'wallet' THEN
    IF v_balance < p_amount THEN
      RETURN QUERY SELECT FALSE, NULL::UUID, v_balance, v_church,
        ('Insufficient wallet balance. You have ' || v_balance::TEXT || ' UGX but need ' || p_amount::TEXT || '. Choose mobile money or cash instead.')::TEXT;
      RETURN;
    END IF;
    v_new_bal := v_balance - p_amount;
    UPDATE public.wallet_accounts wa SET balance = v_new_bal, updated_at = NOW()
     WHERE wa.user_id = v_user_id AND wa.currency = 'UGX';
  END IF;

  INSERT INTO public.ican_tithe_records (
    user_id, giving_type, amount, currency, recipient_type, recipient_name_encrypted,
    tithe_percentage, giving_date, notes_encrypted, is_anonymous, blockchain_status,
    payment_method, tithe_type, recipient_business_id, recipient_name, giver_message
  ) VALUES (
    v_user_id, p_giving_type, p_amount, 'UGX', 'church', v_church,
    10.0, v_date, 'CHURCH:' || p_business_id::TEXT || '|' || v_church, COALESCE(p_is_anonymous, FALSE), 'local',
    p_payment_method, v_type, p_business_id, v_church, v_msg
  ) RETURNING id INTO v_tithe_id;

  INSERT INTO public.ican_financial_transactions (
    user_id, transaction_type, amount, currency, category, sub_category, description,
    source, transaction_date, status, data_hash, metadata
  ) VALUES (
    v_user_id, 'tithe', p_amount, 'UGX', 'giving', p_giving_type,
    'Tithe/Charitable Giving - church (' || v_church || ')',
    'manual', v_date, 'completed',
    md5(p_amount::TEXT || v_user_id::TEXT || NOW()::TEXT),
    jsonb_build_object('tithe_record_id', v_tithe_id::TEXT, 'recipient_business_id', p_business_id::TEXT,
      'payment_method', p_payment_method, 'tithe_type', v_type, 'is_anonymous', COALESCE(p_is_anonymous, FALSE))
  ) RETURNING id INTO v_txn_id;

  UPDATE public.ican_tithe_records tr SET transaction_id = v_txn_id WHERE tr.id = v_tithe_id;

  SELECT al.action_hash INTO v_prev FROM public.tithe_audit_log al WHERE al.user_id = v_user_id ORDER BY al.created_at DESC LIMIT 1;
  v_hash := md5('tithe_added' || v_user_id::TEXT || v_tithe_id::TEXT || p_amount::TEXT || COALESCE(v_prev, '') || NOW()::TEXT);
  INSERT INTO public.tithe_audit_log (
    user_id, tithe_record_id, transaction_id, action_type, amount, currency,
    wallet_deducted, previous_balance, new_balance, action_hash, previous_hash, action_details
  ) VALUES (
    v_user_id, v_tithe_id, v_txn_id, 'tithe_added', p_amount, 'UGX',
    (p_payment_method = 'wallet'), v_balance, v_new_bal, v_hash, v_prev,
    jsonb_build_object('action', 'tithe_payment_recorded', 'status', 'confirmed', 'payment_method', p_payment_method,
      'tithe_type', v_type, 'recipient_business_id', p_business_id::TEXT)
  );

  IF p_payment_method = 'wallet' THEN
    PERFORM public.fn_credit_wallet_ugx(v_owner_id, p_amount);
  END IF;

  RETURN QUERY SELECT TRUE, v_tithe_id, v_new_bal, v_church,
    CASE WHEN p_payment_method = 'wallet'
      THEN 'Tithe sent to ' || v_church || ' from your IcanEra wallet.'
      ELSE 'Tithe recorded as cash given to ' || v_church || '. They will confirm when it reaches them.'
    END::TEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_give_tithe_to_church(UUID, DECIMAL, VARCHAR, TEXT, BOOLEAN, TEXT, TEXT, DATE) TO authenticated;

-- ------------------------------------------------------------
-- 6. Settle a verified Flutterwave payment (service role only)
-- ------------------------------------------------------------
-- Called only by the verify-tithe-payment Edge Function AFTER it has confirmed with
-- Flutterwave that the charge succeeded, in UGX, for at least p_amount. Idempotent on
-- p_tx_ref: replaying the same charge returns the original record instead of paying twice.
CREATE OR REPLACE FUNCTION public.fn_settle_church_tithe_flutterwave(
  p_user_id       UUID,
  p_business_id   UUID,
  p_amount        DECIMAL,
  p_giving_type   TEXT,
  p_is_anonymous  BOOLEAN,
  p_message       TEXT,
  p_tithe_type    TEXT,
  p_tx_ref        TEXT,
  p_flw_transaction_id TEXT
)
RETURNS TABLE (success BOOLEAN, tithe_record_id UUID, church_name TEXT, already_processed BOOLEAN, message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner_id UUID;
  v_church   TEXT;
  v_status   TEXT;
  v_existing UUID;
  v_tithe_id UUID;
  v_txn_id   UUID;
  v_hash     VARCHAR;
  v_prev     VARCHAR;
  v_type     TEXT := CASE WHEN p_tithe_type = 'business' THEN 'business' ELSE 'personal' END;
BEGIN
  IF p_user_id IS NULL OR p_tx_ref IS NULL OR p_amount IS NULL OR p_amount <= 0 THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::TEXT, FALSE, 'Missing payment details'::TEXT;
    RETURN;
  END IF;

  SELECT tr.id INTO v_existing FROM public.ican_tithe_records tr WHERE tr.payment_reference = p_tx_ref;
  IF v_existing IS NOT NULL THEN
    RETURN QUERY SELECT TRUE, v_existing, NULL::TEXT, TRUE, 'This payment was already settled'::TEXT;
    RETURN;
  END IF;

  SELECT bp.user_id, bp.business_name::TEXT, COALESCE(bp.status, 'active')
    INTO v_owner_id, v_church, v_status
  FROM public.business_profiles bp WHERE bp.id = p_business_id;

  IF v_owner_id IS NULL OR v_status <> 'active' THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::TEXT, FALSE, 'That church is not available to receive tithe'::TEXT;
    RETURN;
  END IF;

  INSERT INTO public.ican_tithe_records (
    user_id, giving_type, amount, currency, recipient_type, recipient_name_encrypted,
    tithe_percentage, giving_date, notes_encrypted, is_anonymous, blockchain_status,
    payment_method, tithe_type, recipient_business_id, recipient_name, payment_reference, giver_message
  ) VALUES (
    p_user_id, COALESCE(NULLIF(p_giving_type, ''), 'tithe'), p_amount, 'UGX', 'church', v_church,
    10.0, CURRENT_DATE, 'CHURCH:' || p_business_id::TEXT || '|' || v_church || '|FLW:' || COALESCE(p_flw_transaction_id, ''),
    COALESCE(p_is_anonymous, FALSE), 'local',
    'flutterwave', v_type, p_business_id, v_church, p_tx_ref, NULLIF(left(btrim(COALESCE(p_message, '')), 500), '')
  ) RETURNING id INTO v_tithe_id;

  INSERT INTO public.ican_financial_transactions (
    user_id, transaction_type, amount, currency, category, sub_category, description,
    source, transaction_date, status, data_hash, metadata
  ) VALUES (
    p_user_id, 'tithe', p_amount, 'UGX', 'giving', COALESCE(NULLIF(p_giving_type, ''), 'tithe'),
    'Tithe/Charitable Giving - church (' || v_church || ')',
    'flutterwave', CURRENT_DATE, 'completed',
    md5(p_amount::TEXT || p_user_id::TEXT || p_tx_ref),
    jsonb_build_object('tithe_record_id', v_tithe_id::TEXT, 'recipient_business_id', p_business_id::TEXT,
      'payment_method', 'flutterwave', 'tx_ref', p_tx_ref, 'flutterwave_transaction_id', p_flw_transaction_id,
      'tithe_type', v_type, 'is_anonymous', COALESCE(p_is_anonymous, FALSE))
  ) RETURNING id INTO v_txn_id;

  UPDATE public.ican_tithe_records SET transaction_id = v_txn_id, payment_status = 'paid', settled_date = NOW()
   WHERE id = v_tithe_id;

  SELECT al.action_hash INTO v_prev FROM public.tithe_audit_log al WHERE al.user_id = p_user_id ORDER BY al.created_at DESC LIMIT 1;
  v_hash := md5('tithe_added' || p_user_id::TEXT || v_tithe_id::TEXT || p_amount::TEXT || COALESCE(v_prev, '') || NOW()::TEXT);
  INSERT INTO public.tithe_audit_log (
    user_id, tithe_record_id, transaction_id, action_type, amount, currency,
    wallet_deducted, action_hash, previous_hash, action_details
  ) VALUES (
    p_user_id, v_tithe_id, v_txn_id, 'tithe_added', p_amount, 'UGX', FALSE, v_hash, v_prev,
    jsonb_build_object('action', 'tithe_payment_recorded', 'status', 'confirmed', 'payment_method', 'flutterwave',
      'recipient_business_id', p_business_id::TEXT, 'tx_ref', p_tx_ref)
  );

  PERFORM public.fn_credit_wallet_ugx(v_owner_id, p_amount);

  RETURN QUERY SELECT TRUE, v_tithe_id, v_church, FALSE, ('Tithe sent to ' || v_church)::TEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_settle_church_tithe_flutterwave(UUID, UUID, DECIMAL, TEXT, BOOLEAN, TEXT, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_settle_church_tithe_flutterwave(UUID, UUID, DECIMAL, TEXT, BOOLEAN, TEXT, TEXT, TEXT, TEXT)
  TO service_role;

-- ------------------------------------------------------------
-- 7. What a church has received (owner only)
-- ------------------------------------------------------------
-- Anonymous givers stay anonymous: the church sees the gift, not the name.
CREATE OR REPLACE FUNCTION public.fn_church_received_tithes(p_business_id UUID, p_limit INTEGER DEFAULT 50)
RETURNS TABLE (
  tithe_id       UUID,
  giving_date    DATE,
  amount         DECIMAL,
  giving_type    TEXT,
  payment_method TEXT,
  giver_name     TEXT,
  giver_message  TEXT,
  confirmed      BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.business_profiles bp WHERE bp.id = p_business_id AND bp.user_id = auth.uid()) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT tr.id,
         tr.giving_date::DATE,
         tr.amount::DECIMAL,
         tr.giving_type::TEXT,
         tr.payment_method::TEXT,
         CASE WHEN tr.is_anonymous THEN 'Anonymous'
              ELSE COALESCE(NULLIF(btrim(COALESCE(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name', '')), ''),
                            split_part(COALESCE(u.email, 'A member'), '@', 1))
         END::TEXT,
         tr.giver_message,
         (tr.payment_method <> 'cash' OR tr.church_confirmed_at IS NOT NULL)
  FROM public.ican_tithe_records tr
  LEFT JOIN auth.users u ON u.id = tr.user_id
  WHERE tr.recipient_business_id = p_business_id
    AND tr.blockchain_status <> 'removed'
  ORDER BY tr.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_church_received_tithes(UUID, INTEGER) TO authenticated;

-- The church owner confirms a cash tithe actually reached the church.
CREATE OR REPLACE FUNCTION public.fn_confirm_church_cash_tithe(p_tithe_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.ican_tithe_records tr
     SET church_confirmed_at = NOW()
   WHERE tr.id = p_tithe_id
     AND tr.payment_method = 'cash'
     AND tr.church_confirmed_at IS NULL
     AND EXISTS (SELECT 1 FROM public.business_profiles bp
                 WHERE bp.id = tr.recipient_business_id AND bp.user_id = auth.uid());
  RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_confirm_church_cash_tithe(UUID) TO authenticated;

-- ------------------------------------------------------------
-- 8. Let a church switch itself on (even if its type does not say "church")
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_set_business_accepts_tithe(p_business_id UUID, p_accepts BOOLEAN)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.business_profiles bp
     SET metadata = COALESCE(bp.metadata, '{}'::JSONB) || jsonb_build_object('accepts_tithe', COALESCE(p_accepts, FALSE))
   WHERE bp.id = p_business_id AND bp.user_id = auth.uid();
  RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_set_business_accepts_tithe(UUID, BOOLEAN) TO authenticated;

-- ########################################################
-- PART: 20261014110000_church_tithe_business_wallet
-- ########################################################
-- ============================================================
-- Pay a business into its own business wallet account
-- ============================================================
-- Follow-up to 20261014100000_church_tithe_giving.sql. When the person you pay is a business,
-- the money now lands in that business's wallet account (user_accounts: account_type = 'business',
-- business_id = the business, ugx_balance) instead of the owner's personal wallet. A business
-- that has no active wallet account yet falls back to its owner's wallet so the payment is never
-- lost, and the record notes where it went (ican_tithe_records.credited_to).
-- Safe to re-run. Run 20261014100000_church_tithe_giving.sql first.
-- ============================================================

ALTER TABLE public.ican_tithe_records ADD COLUMN IF NOT EXISTS credited_to TEXT;
COMMENT ON COLUMN public.ican_tithe_records.credited_to IS
  'Where a wallet / flutterwave payment landed: business_wallet (the business''s own wallet account) or owner_wallet (fallback when the business has none).';

-- Credit the business wallet account if it has one, else the owner's wallet. Returns where it went.
CREATE OR REPLACE FUNCTION public.fn_credit_business_wallet_ugx(p_business_id UUID, p_owner_id UUID, p_amount DECIMAL)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id UUID;
BEGIN
  SELECT ua.id INTO v_account_id
  FROM public.user_accounts ua
  WHERE ua.business_id = p_business_id
    AND ua.account_type = 'business'
    AND COALESCE(ua.status, 'active') = 'active'
  ORDER BY ua.created_at
  LIMIT 1
  FOR UPDATE;

  IF v_account_id IS NOT NULL THEN
    UPDATE public.user_accounts ua
       SET ugx_balance = COALESCE(ua.ugx_balance, 0) + p_amount,
           last_transaction_at = NOW(), updated_at = NOW()
     WHERE ua.id = v_account_id;
    RETURN 'business_wallet';
  END IF;

  PERFORM public.fn_credit_wallet_ugx(p_owner_id, p_amount);
  RETURN 'owner_wallet';
END;
$$;

REVOKE ALL ON FUNCTION public.fn_credit_business_wallet_ugx(UUID, UUID, DECIMAL) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 5. Give by wallet or cash
-- ------------------------------------------------------------
-- The wallet PIN is checked by the app before this is called (same as every other wallet
-- spend in the app). Everything the database can enforce, it does: the recipient must be an
-- active business that is not the giver's own, the amount must be positive, the giver's wallet
-- row is locked while it is debited, and debit + credit + record succeed or fail together.
-- Self-contained on purpose (it writes the same tithe / report / audit rows fn_add_tithe does)
-- so a church tithe does not depend on that function's current body.
CREATE OR REPLACE FUNCTION public.fn_give_tithe_to_church(
  p_business_id    UUID,
  p_amount         DECIMAL,
  p_giving_type    VARCHAR DEFAULT 'tithe',
  p_payment_method TEXT    DEFAULT 'wallet',
  p_is_anonymous   BOOLEAN DEFAULT FALSE,
  p_message        TEXT    DEFAULT NULL,
  p_tithe_type     TEXT    DEFAULT 'personal',
  p_giving_date    DATE    DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  success            BOOLEAN,
  tithe_record_id    UUID,
  new_wallet_balance DECIMAL,
  church_name        TEXT,
  message            TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id  UUID := auth.uid();
  v_owner_id UUID;
  v_church   TEXT;
  v_status   TEXT;
  v_balance  DECIMAL;
  v_new_bal  DECIMAL;
  v_tithe_id UUID;
  v_txn_id   UUID;
  v_hash     VARCHAR;
  v_prev     VARCHAR;
  v_credited TEXT;
  v_type     TEXT := CASE WHEN p_tithe_type = 'business' THEN 'business' ELSE 'personal' END;
  v_date     DATE := COALESCE(p_giving_date, CURRENT_DATE);
  v_msg      TEXT := NULLIF(left(btrim(COALESCE(p_message, '')), 500), '');
BEGIN
  IF v_user_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::DECIMAL, NULL::TEXT, 'Not authenticated'::TEXT;
    RETURN;
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::DECIMAL, NULL::TEXT, 'Enter an amount greater than 0'::TEXT;
    RETURN;
  END IF;
  IF p_payment_method NOT IN ('wallet', 'cash') THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::DECIMAL, NULL::TEXT,
      'Use the Flutterwave checkout to give by mobile money or card'::TEXT;
    RETURN;
  END IF;
  IF p_giving_type NOT IN ('tithe', 'offering', 'charity', 'mission', 'building_fund', 'alms', 'other') THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::DECIMAL, NULL::TEXT, 'Unknown type of giving'::TEXT;
    RETURN;
  END IF;

  SELECT bp.user_id, bp.business_name::TEXT, COALESCE(bp.status, 'active')
    INTO v_owner_id, v_church, v_status
  FROM public.business_profiles bp
  WHERE bp.id = p_business_id;

  IF v_owner_id IS NULL OR v_status <> 'active' THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::DECIMAL, NULL::TEXT, 'That church is not available to receive tithe'::TEXT;
    RETURN;
  END IF;
  IF v_owner_id = v_user_id THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::DECIMAL, v_church,
      'You own this church, so there is nowhere to send it. Use the normal tithe tabs to record your own giving.'::TEXT;
    RETURN;
  END IF;

  -- Wallet: lock the giver's row, then check and debit.
  SELECT COALESCE(wa.balance, 0) INTO v_balance
  FROM public.wallet_accounts wa
  WHERE wa.user_id = v_user_id AND wa.currency = 'UGX'
  ORDER BY wa.created_at
  LIMIT 1
  FOR UPDATE;
  v_balance := COALESCE(v_balance, 0);
  v_new_bal := v_balance;

  IF p_payment_method = 'wallet' THEN
    IF v_balance < p_amount THEN
      RETURN QUERY SELECT FALSE, NULL::UUID, v_balance, v_church,
        ('Insufficient wallet balance. You have ' || v_balance::TEXT || ' UGX but need ' || p_amount::TEXT || '. Choose mobile money or cash instead.')::TEXT;
      RETURN;
    END IF;
    v_new_bal := v_balance - p_amount;
    UPDATE public.wallet_accounts wa SET balance = v_new_bal, updated_at = NOW()
     WHERE wa.user_id = v_user_id AND wa.currency = 'UGX';
  END IF;

  INSERT INTO public.ican_tithe_records (
    user_id, giving_type, amount, currency, recipient_type, recipient_name_encrypted,
    tithe_percentage, giving_date, notes_encrypted, is_anonymous, blockchain_status,
    payment_method, tithe_type, recipient_business_id, recipient_name, giver_message
  ) VALUES (
    v_user_id, p_giving_type, p_amount, 'UGX', 'church', v_church,
    10.0, v_date, 'CHURCH:' || p_business_id::TEXT || '|' || v_church, COALESCE(p_is_anonymous, FALSE), 'local',
    p_payment_method, v_type, p_business_id, v_church, v_msg
  ) RETURNING id INTO v_tithe_id;

  INSERT INTO public.ican_financial_transactions (
    user_id, transaction_type, amount, currency, category, sub_category, description,
    source, transaction_date, status, data_hash, metadata
  ) VALUES (
    v_user_id, 'tithe', p_amount, 'UGX', 'giving', p_giving_type,
    'Tithe/Charitable Giving - church (' || v_church || ')',
    'manual', v_date, 'completed',
    md5(p_amount::TEXT || v_user_id::TEXT || NOW()::TEXT),
    jsonb_build_object('tithe_record_id', v_tithe_id::TEXT, 'recipient_business_id', p_business_id::TEXT,
      'payment_method', p_payment_method, 'tithe_type', v_type, 'is_anonymous', COALESCE(p_is_anonymous, FALSE))
  ) RETURNING id INTO v_txn_id;

  UPDATE public.ican_tithe_records tr SET transaction_id = v_txn_id WHERE tr.id = v_tithe_id;

  SELECT al.action_hash INTO v_prev FROM public.tithe_audit_log al WHERE al.user_id = v_user_id ORDER BY al.created_at DESC LIMIT 1;
  v_hash := md5('tithe_added' || v_user_id::TEXT || v_tithe_id::TEXT || p_amount::TEXT || COALESCE(v_prev, '') || NOW()::TEXT);
  INSERT INTO public.tithe_audit_log (
    user_id, tithe_record_id, transaction_id, action_type, amount, currency,
    wallet_deducted, previous_balance, new_balance, action_hash, previous_hash, action_details
  ) VALUES (
    v_user_id, v_tithe_id, v_txn_id, 'tithe_added', p_amount, 'UGX',
    (p_payment_method = 'wallet'), v_balance, v_new_bal, v_hash, v_prev,
    jsonb_build_object('action', 'tithe_payment_recorded', 'status', 'confirmed', 'payment_method', p_payment_method,
      'tithe_type', v_type, 'recipient_business_id', p_business_id::TEXT)
  );

  IF p_payment_method = 'wallet' THEN
    v_credited := public.fn_credit_business_wallet_ugx(p_business_id, v_owner_id, p_amount);
    UPDATE public.ican_tithe_records tr SET credited_to = v_credited WHERE tr.id = v_tithe_id;
  END IF;

  RETURN QUERY SELECT TRUE, v_tithe_id, v_new_bal, v_church,
    CASE WHEN p_payment_method = 'wallet'
      THEN 'Sent to ' || v_church || CASE WHEN v_credited = 'business_wallet' THEN '''s business wallet' ELSE ' (credited to the owner''s wallet — it has no business wallet yet)' END || ' from your IcanEra wallet.'
      ELSE 'Tithe recorded as cash given to ' || v_church || '. They will confirm when it reaches them.'
    END::TEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_give_tithe_to_church(UUID, DECIMAL, VARCHAR, TEXT, BOOLEAN, TEXT, TEXT, DATE) TO authenticated;

-- ------------------------------------------------------------
-- 6. Settle a verified Flutterwave payment (service role only)
-- ------------------------------------------------------------
-- Called only by the verify-tithe-payment Edge Function AFTER it has confirmed with
-- Flutterwave that the charge succeeded, in UGX, for at least p_amount. Idempotent on
-- p_tx_ref: replaying the same charge returns the original record instead of paying twice.
CREATE OR REPLACE FUNCTION public.fn_settle_church_tithe_flutterwave(
  p_user_id       UUID,
  p_business_id   UUID,
  p_amount        DECIMAL,
  p_giving_type   TEXT,
  p_is_anonymous  BOOLEAN,
  p_message       TEXT,
  p_tithe_type    TEXT,
  p_tx_ref        TEXT,
  p_flw_transaction_id TEXT
)
RETURNS TABLE (success BOOLEAN, tithe_record_id UUID, church_name TEXT, already_processed BOOLEAN, message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner_id UUID;
  v_church   TEXT;
  v_status   TEXT;
  v_existing UUID;
  v_tithe_id UUID;
  v_txn_id   UUID;
  v_hash     VARCHAR;
  v_prev     VARCHAR;
  v_credited TEXT;
  v_type     TEXT := CASE WHEN p_tithe_type = 'business' THEN 'business' ELSE 'personal' END;
BEGIN
  IF p_user_id IS NULL OR p_tx_ref IS NULL OR p_amount IS NULL OR p_amount <= 0 THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::TEXT, FALSE, 'Missing payment details'::TEXT;
    RETURN;
  END IF;

  SELECT tr.id INTO v_existing FROM public.ican_tithe_records tr WHERE tr.payment_reference = p_tx_ref;
  IF v_existing IS NOT NULL THEN
    RETURN QUERY SELECT TRUE, v_existing, NULL::TEXT, TRUE, 'This payment was already settled'::TEXT;
    RETURN;
  END IF;

  SELECT bp.user_id, bp.business_name::TEXT, COALESCE(bp.status, 'active')
    INTO v_owner_id, v_church, v_status
  FROM public.business_profiles bp WHERE bp.id = p_business_id;

  IF v_owner_id IS NULL OR v_status <> 'active' THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::TEXT, FALSE, 'That church is not available to receive tithe'::TEXT;
    RETURN;
  END IF;

  INSERT INTO public.ican_tithe_records (
    user_id, giving_type, amount, currency, recipient_type, recipient_name_encrypted,
    tithe_percentage, giving_date, notes_encrypted, is_anonymous, blockchain_status,
    payment_method, tithe_type, recipient_business_id, recipient_name, payment_reference, giver_message
  ) VALUES (
    p_user_id, COALESCE(NULLIF(p_giving_type, ''), 'tithe'), p_amount, 'UGX', 'church', v_church,
    10.0, CURRENT_DATE, 'CHURCH:' || p_business_id::TEXT || '|' || v_church || '|FLW:' || COALESCE(p_flw_transaction_id, ''),
    COALESCE(p_is_anonymous, FALSE), 'local',
    'flutterwave', v_type, p_business_id, v_church, p_tx_ref, NULLIF(left(btrim(COALESCE(p_message, '')), 500), '')
  ) RETURNING id INTO v_tithe_id;

  INSERT INTO public.ican_financial_transactions (
    user_id, transaction_type, amount, currency, category, sub_category, description,
    source, transaction_date, status, data_hash, metadata
  ) VALUES (
    p_user_id, 'tithe', p_amount, 'UGX', 'giving', COALESCE(NULLIF(p_giving_type, ''), 'tithe'),
    'Tithe/Charitable Giving - church (' || v_church || ')',
    'flutterwave', CURRENT_DATE, 'completed',
    md5(p_amount::TEXT || p_user_id::TEXT || p_tx_ref),
    jsonb_build_object('tithe_record_id', v_tithe_id::TEXT, 'recipient_business_id', p_business_id::TEXT,
      'payment_method', 'flutterwave', 'tx_ref', p_tx_ref, 'flutterwave_transaction_id', p_flw_transaction_id,
      'tithe_type', v_type, 'is_anonymous', COALESCE(p_is_anonymous, FALSE))
  ) RETURNING id INTO v_txn_id;

  UPDATE public.ican_tithe_records SET transaction_id = v_txn_id, payment_status = 'paid', settled_date = NOW()
   WHERE id = v_tithe_id;

  SELECT al.action_hash INTO v_prev FROM public.tithe_audit_log al WHERE al.user_id = p_user_id ORDER BY al.created_at DESC LIMIT 1;
  v_hash := md5('tithe_added' || p_user_id::TEXT || v_tithe_id::TEXT || p_amount::TEXT || COALESCE(v_prev, '') || NOW()::TEXT);
  INSERT INTO public.tithe_audit_log (
    user_id, tithe_record_id, transaction_id, action_type, amount, currency,
    wallet_deducted, action_hash, previous_hash, action_details
  ) VALUES (
    p_user_id, v_tithe_id, v_txn_id, 'tithe_added', p_amount, 'UGX', FALSE, v_hash, v_prev,
    jsonb_build_object('action', 'tithe_payment_recorded', 'status', 'confirmed', 'payment_method', 'flutterwave',
      'recipient_business_id', p_business_id::TEXT, 'tx_ref', p_tx_ref)
  );

  v_credited := public.fn_credit_business_wallet_ugx(p_business_id, v_owner_id, p_amount);
  UPDATE public.ican_tithe_records tr SET credited_to = v_credited WHERE tr.id = v_tithe_id;

  RETURN QUERY SELECT TRUE, v_tithe_id, v_church, FALSE,
    ('Sent to ' || v_church || CASE WHEN v_credited = 'business_wallet' THEN '''s business wallet' ELSE ' (credited to the owner''s wallet)' END)::TEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_settle_church_tithe_flutterwave(UUID, UUID, DECIMAL, TEXT, BOOLEAN, TEXT, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_settle_church_tithe_flutterwave(UUID, UUID, DECIMAL, TEXT, BOOLEAN, TEXT, TEXT, TEXT, TEXT)
  TO service_role;


-- ########################################################
-- PART: 20261014120000_church_tithe_business_payer
-- ########################################################
-- ============================================================
-- A business tithe is paid BY the business (its own wallet account)
-- ============================================================
-- Follow-up to 20261014110000_church_tithe_business_wallet.sql. When a tithe is for a business,
-- the giver picks which business they own is paying and the money leaves THAT business's wallet
-- account (user_accounts: account_type = 'business', ugx_balance) instead of their personal wallet.
-- The business wallet's own PIN is checked in the app first. Rules the database enforces: the
-- caller must own the paying business, it must have an active wallet account with enough balance,
-- and a business cannot pay itself. Personal tithes are unchanged.
-- Safe to re-run. Run the two earlier church_tithe migrations first.
-- ============================================================

ALTER TABLE public.ican_tithe_records ADD COLUMN IF NOT EXISTS payer_business_id UUID;
COMMENT ON COLUMN public.ican_tithe_records.payer_business_id IS
  'For a business tithe paid from a business wallet: the business that paid (business_profiles.id).';

-- A new trailing parameter would leave the old 8-argument version as a second overload; drop it so
-- there is exactly one fn_give_tithe_to_church.
DROP FUNCTION IF EXISTS public.fn_give_tithe_to_church(UUID, DECIMAL, VARCHAR, TEXT, BOOLEAN, TEXT, TEXT, DATE);

CREATE OR REPLACE FUNCTION public.fn_give_tithe_to_church(
  p_business_id    UUID,
  p_amount         DECIMAL,
  p_giving_type    VARCHAR DEFAULT 'tithe',
  p_payment_method TEXT    DEFAULT 'wallet',
  p_is_anonymous   BOOLEAN DEFAULT FALSE,
  p_message        TEXT    DEFAULT NULL,
  p_tithe_type     TEXT    DEFAULT 'personal',
  p_giving_date    DATE    DEFAULT CURRENT_DATE,
  p_payer_business_id UUID DEFAULT NULL
)
RETURNS TABLE (
  success            BOOLEAN,
  tithe_record_id    UUID,
  new_wallet_balance DECIMAL,
  church_name        TEXT,
  message            TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id  UUID := auth.uid();
  v_owner_id UUID;
  v_church   TEXT;
  v_status   TEXT;
  v_balance  DECIMAL;
  v_new_bal  DECIMAL;
  v_tithe_id UUID;
  v_txn_id   UUID;
  v_hash     VARCHAR;
  v_prev     VARCHAR;
  v_credited TEXT;
  v_payer_name TEXT;
  v_payer_acct UUID;
  v_type     TEXT := CASE WHEN p_tithe_type = 'business' OR p_payer_business_id IS NOT NULL THEN 'business' ELSE 'personal' END;
  v_date     DATE := COALESCE(p_giving_date, CURRENT_DATE);
  v_msg      TEXT := NULLIF(left(btrim(COALESCE(p_message, '')), 500), '');
BEGIN
  IF v_user_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::DECIMAL, NULL::TEXT, 'Not authenticated'::TEXT;
    RETURN;
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::DECIMAL, NULL::TEXT, 'Enter an amount greater than 0'::TEXT;
    RETURN;
  END IF;
  IF p_payment_method NOT IN ('wallet', 'cash') THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::DECIMAL, NULL::TEXT,
      'Use the Flutterwave checkout to give by mobile money or card'::TEXT;
    RETURN;
  END IF;
  IF p_giving_type NOT IN ('tithe', 'offering', 'charity', 'mission', 'building_fund', 'alms', 'other') THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::DECIMAL, NULL::TEXT, 'Unknown type of giving'::TEXT;
    RETURN;
  END IF;

  SELECT bp.user_id, bp.business_name::TEXT, COALESCE(bp.status, 'active')
    INTO v_owner_id, v_church, v_status
  FROM public.business_profiles bp
  WHERE bp.id = p_business_id;

  IF v_owner_id IS NULL OR v_status <> 'active' THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::DECIMAL, NULL::TEXT, 'That church is not available to receive tithe'::TEXT;
    RETURN;
  END IF;
  IF v_owner_id = v_user_id AND p_payer_business_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::DECIMAL, v_church,
      'You own this church, so there is nowhere to send it. Use the normal tithe tabs to record your own giving.'::TEXT;
    RETURN;
  END IF;

  -- A business tithe is paid BY the business: it must be one the caller owns, and it cannot pay itself.
  IF p_payer_business_id IS NOT NULL THEN
    SELECT bp.business_name::TEXT INTO v_payer_name
    FROM public.business_profiles bp
    WHERE bp.id = p_payer_business_id AND bp.user_id = v_user_id AND COALESCE(bp.status, 'active') = 'active';
    IF v_payer_name IS NULL THEN
      RETURN QUERY SELECT FALSE, NULL::UUID, NULL::DECIMAL, v_church, 'You can only pay from a business you own'::TEXT;
      RETURN;
    END IF;
    IF p_payer_business_id = p_business_id THEN
      RETURN QUERY SELECT FALSE, NULL::UUID, NULL::DECIMAL, v_church, 'A business cannot pay itself'::TEXT;
      RETURN;
    END IF;
  END IF;

  IF p_payer_business_id IS NOT NULL AND p_payment_method = 'wallet' THEN
    -- Business pays: lock ITS wallet account, then check and debit.
    SELECT ua.id, COALESCE(ua.ugx_balance, 0) INTO v_payer_acct, v_balance
    FROM public.user_accounts ua
    WHERE ua.business_id = p_payer_business_id
      AND ua.account_type = 'business'
      AND COALESCE(ua.status, 'active') = 'active'
    ORDER BY ua.created_at
    LIMIT 1
    FOR UPDATE;
    IF v_payer_acct IS NULL THEN
      RETURN QUERY SELECT FALSE, NULL::UUID, NULL::DECIMAL, v_church,
        (v_payer_name || ' has no business wallet account yet. Create one, or pay by mobile money / cash.')::TEXT;
      RETURN;
    END IF;
    IF v_balance < p_amount THEN
      RETURN QUERY SELECT FALSE, NULL::UUID, v_balance, v_church,
        ('Insufficient business wallet balance. ' || v_payer_name || ' has ' || v_balance::TEXT || ' UGX but needs ' || p_amount::TEXT || '.')::TEXT;
      RETURN;
    END IF;
    v_new_bal := v_balance - p_amount;
    UPDATE public.user_accounts ua
       SET ugx_balance = v_new_bal, last_transaction_at = NOW(), updated_at = NOW()
     WHERE ua.id = v_payer_acct;
  ELSE
    -- Wallet: lock the giver's row, then check and debit.
    SELECT COALESCE(wa.balance, 0) INTO v_balance
    FROM public.wallet_accounts wa
    WHERE wa.user_id = v_user_id AND wa.currency = 'UGX'
    ORDER BY wa.created_at
    LIMIT 1
    FOR UPDATE;
    v_balance := COALESCE(v_balance, 0);
    v_new_bal := v_balance;

    IF p_payment_method = 'wallet' THEN
      IF v_balance < p_amount THEN
        RETURN QUERY SELECT FALSE, NULL::UUID, v_balance, v_church,
          ('Insufficient wallet balance. You have ' || v_balance::TEXT || ' UGX but need ' || p_amount::TEXT || '. Choose mobile money or cash instead.')::TEXT;
        RETURN;
      END IF;
      v_new_bal := v_balance - p_amount;
      UPDATE public.wallet_accounts wa SET balance = v_new_bal, updated_at = NOW()
       WHERE wa.user_id = v_user_id AND wa.currency = 'UGX';
    END IF;
  END IF;

  INSERT INTO public.ican_tithe_records (
    user_id, giving_type, amount, currency, recipient_type, recipient_name_encrypted,
    tithe_percentage, giving_date, notes_encrypted, is_anonymous, blockchain_status,
    payment_method, tithe_type, recipient_business_id, recipient_name, giver_message, payer_business_id
  ) VALUES (
    v_user_id, p_giving_type, p_amount, 'UGX', 'church', v_church,
    10.0, v_date, 'CHURCH:' || p_business_id::TEXT || '|' || v_church, COALESCE(p_is_anonymous, FALSE), 'local',
    p_payment_method, v_type, p_business_id, v_church, v_msg, p_payer_business_id
  ) RETURNING id INTO v_tithe_id;

  INSERT INTO public.ican_financial_transactions (
    user_id, transaction_type, amount, currency, category, sub_category, description,
    source, transaction_date, status, data_hash, metadata
  ) VALUES (
    v_user_id, 'tithe', p_amount, 'UGX', 'giving', p_giving_type,
    'Tithe/Charitable Giving - church (' || v_church || ')',
    'manual', v_date, 'completed',
    md5(p_amount::TEXT || v_user_id::TEXT || NOW()::TEXT),
    jsonb_build_object('tithe_record_id', v_tithe_id::TEXT, 'recipient_business_id', p_business_id::TEXT,
      'payment_method', p_payment_method, 'tithe_type', v_type, 'is_anonymous', COALESCE(p_is_anonymous, FALSE))
  ) RETURNING id INTO v_txn_id;

  UPDATE public.ican_tithe_records tr SET transaction_id = v_txn_id WHERE tr.id = v_tithe_id;

  SELECT al.action_hash INTO v_prev FROM public.tithe_audit_log al WHERE al.user_id = v_user_id ORDER BY al.created_at DESC LIMIT 1;
  v_hash := md5('tithe_added' || v_user_id::TEXT || v_tithe_id::TEXT || p_amount::TEXT || COALESCE(v_prev, '') || NOW()::TEXT);
  INSERT INTO public.tithe_audit_log (
    user_id, tithe_record_id, transaction_id, action_type, amount, currency,
    wallet_deducted, previous_balance, new_balance, action_hash, previous_hash, action_details
  ) VALUES (
    v_user_id, v_tithe_id, v_txn_id, 'tithe_added', p_amount, 'UGX',
    (p_payment_method = 'wallet'), v_balance, v_new_bal, v_hash, v_prev,
    jsonb_build_object('action', 'tithe_payment_recorded', 'status', 'confirmed', 'payment_method', p_payment_method,
      'tithe_type', v_type, 'recipient_business_id', p_business_id::TEXT)
  );

  IF p_payment_method = 'wallet' THEN
    v_credited := public.fn_credit_business_wallet_ugx(p_business_id, v_owner_id, p_amount);
    UPDATE public.ican_tithe_records tr SET credited_to = v_credited WHERE tr.id = v_tithe_id;
  END IF;

  RETURN QUERY SELECT TRUE, v_tithe_id, v_new_bal, v_church,
    CASE WHEN p_payment_method = 'wallet'
      THEN 'Sent to ' || v_church || CASE WHEN v_credited = 'business_wallet' THEN '''s business wallet' ELSE ' (credited to the owner''s wallet — it has no business wallet yet)' END || ' from ' || COALESCE(v_payer_name || '''s business wallet', 'your IcanEra wallet') || '.'
      ELSE 'Tithe recorded as cash given to ' || v_church || '. They will confirm when it reaches them.'
    END::TEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_give_tithe_to_church(UUID, DECIMAL, VARCHAR, TEXT, BOOLEAN, TEXT, TEXT, DATE, UUID) TO authenticated;

