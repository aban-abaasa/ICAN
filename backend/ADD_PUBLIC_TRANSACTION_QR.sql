-- ============================================================================
-- PUBLIC QR ON EVERY RECORDED TRANSACTION — scan to see the receipt, or to pay it
-- ============================================================================
-- "Record Every Transaction" writes each entry to ican_transactions. After this file:
--
--   1. EVERY entry has a public code (public_code, 20 random characters, unguessable). New
--      entries get one the moment they are inserted; older ones get theirs the first time
--      their receipt is opened (no mass rewrite of the table). The QR printed on the receipt
--      points at   https://icanera.space/r/<public_code>
--
--   2. Anyone who scans it — NO ACCOUNT NEEDED — sees the receipt (public_tx_receipt): amount,
--      what it was for, when, who issued it, and a link to the business website when the entry
--      belongs to a CMMS business. It never shows user ids, e-mail, phone numbers, the raw
--      text the owner typed, or the attached proof photo.
--
--   3. If the owner switches "Let the customer pay by scanning" ON for a money-in (income) entry
--      in UGX, the same page also lets the visitor PAY it:
--        * with Mobile Money / card / bank, no wallet (public_tx_pay_start -> Flutterwave ->
--          Edge Function public-tx-pay -> public_tx_fulfil). The visitor pays the amount plus the
--          payment-processing fee (the same gateway fee guest checkout uses, shown openly), the
--          owner receives the FULL amount;
--        * or with their IcanEra wallet when signed in (public_tx_pay_wallet) — no extra fee.
--      The money lands in the entry's BUSINESS wallet when the entry is tagged to a business,
--      otherwise in the recorder's personal wallet, priced at the LIVE icaneracoin value
--      (ican_live_ugx_price(), else ican_get_price_in_currency('UGX'); refuses rather than guesses).
--      One payment closes the entry ("paid"); a second payer is refunded.
--
--   4. The owner (the person who recorded it, the business owner or a co-owner) manages it from
--      the receipt: public_tx_get_link() and public_tx_set_pay().
--
-- The ledger entry itself is never duplicated: a paid entry just carries public_pay_status =
-- 'paid' and metadata.payment_method / payer_name, so it shows "Paid by …" on the owner's receipt.
--
--   5. QR PAY TAB (entry form): bill a customer by QR BEFORE the money arrives. public_tx_request_create
--      makes a QR bill (public_tx_requests) — deliberately NOT a ledger row, so reports never count
--      money that has not come in. The customer scans and pays with the IcanEra wallet, Mobile Money /
--      card / bank, or hands over CASH, which the owner confirms (public_tx_request_mark_cash). The
--      moment it is paid, the real income entry is written to ican_transactions (status 'completed',
--      the same row the entry form writes), so reports, the transactions list, tithe and valuation see
--      it, and the bill's QR keeps working as that entry's receipt. A bill can be cancelled while open.
--
--   6. APPROVAL (on by default per bill, switchable off). When a customer pays a QR bill, the money is
--      only CAPTURED: a cash claim ("I paid cash"), wallet coins debited, or a Mobile Money / card / bank
--      payment verified and held. Nothing is credited or recorded yet. The people who may approve — the
--      person who made the bill, the business owner and co-owners, finance team members (and anyone
--      pitchin_business_wallet_finance_access() allows) — get a message in the shared IcanEra wallet inbox
--      (ican_wallet_inbox_notifications, already pushed to phones by the wallet-push relay) and approve or
--      reject it with public_tx_request_decide(). Approve: recipient credited, income entry written.
--      Reject: wallet coins returned at once, a card / Mobile Money payment is refunded by the
--      public-tx-pay Edge Function, a cash claim is dropped; the bill reopens with the reason shown to the
--      customer. The inbox's "must tie to a coin transaction" CHECK is relaxed for qr_* messages.
--
--   7. STANDING PAY QR ("pay any amount"): one permanent QR per business (or person), printed once. The customer
--      scans it, lists what they are paying for with prices (or just types an amount), enters their name, and
--      public_tx_paycode_bill() turns that into a QR bill on the spot. From there it is exactly the flow above:
--      pay with cash / wallet / Mobile Money / card / bank, an authorised person approves, the income entry is
--      written, and the customer keeps a receipt that lists their items. Owner: public_tx_paycode_get_or_create /
--      public_tx_paycode_update (switch it off, set the biggest amount allowed, approval on/off).
--      The QR points at the business's OWN public website page (/notices/<company>?pay=1) when it has one:
--      its "Pay" tab shows the same form (public_tx_paycode_info_by_business tells the website whether
--      the business has an active standing QR). Businesses without a website page use /p/<code>.
--
-- SETUP: run this file, then deploy the Edge Function
--     supabase functions deploy public-tx-pay
-- (uses the FLUTTERWAVE_SECRET_KEY secret the other Flutterwave functions already use).
-- Optional: the processing fee is read from guest_checkout_config 'gateway_fee_pct' when
-- ADD_GUEST_CHECKOUT_MOBILE_MONEY.sql is installed, otherwise 3.5 %.
--
-- Safe to run more than once.
-- ============================================================================

-- The Supabase SQL editor runs a whole file as ONE transaction, so every lock taken below is held until the
-- very end. If the app is busy writing to a table this file needs to change, waiting forever can end in a
-- deadlock. Give up quickly and cleanly instead: if you ever see "canceling statement due to lock
-- timeout", nothing was changed — just run the file again a moment later. The two busy tables (the ledger
-- and the wallet inbox) are touched LAST, in section 10, so their locks are held as briefly as possible.
SET lock_timeout = '8s';

-- ----------------------------------------------------------------------------
-- 1. Public-code generator (the ledger columns come last, see section 10)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_new_public_tx_code()
RETURNS TEXT LANGUAGE sql VOLATILE AS $$
  SELECT substr(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 1, 20);
$$;



-- ----------------------------------------------------------------------------
-- 2. QR payment requests and the payments taken through a QR
--    (service side only: RLS on, no policies — everything goes through the functions below)
--
--    A REQUEST is a QR bill made BEFORE the money arrives ("QR Pay" tab of the entry form). It is
--    deliberately NOT a ledger row: reports and transactions must not count money that has not
--    come in. The moment it is paid — cash confirmed by the owner, IcanEra wallet, or Mobile
--    Money / card / bank — the real income entry is written to ican_transactions with the
--    request's own code, so the same QR keeps working as the receipt.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.public_tx_requests (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                TEXT NOT NULL UNIQUE DEFAULT public.fn_new_public_tx_code(),
  user_id             UUID NOT NULL,
  business_profile_id UUID,
  amount_ugx          NUMERIC NOT NULL CHECK (amount_ugx >= 100 AND amount_ugx <= 50000000),
  description         TEXT NOT NULL,
  -- Whitelisted bookkeeping fields from the entry form (category, accounting type, item, quantity...)
  meta                JSONB NOT NULL DEFAULT '{}'::JSONB,
  -- open -> (customer pays) -> pending_approval -> (approver approves) -> paid
  --                                              \-> (approver rejects) -> back to open, money returned
  status              TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'pending_approval', 'paid', 'cancelled')),
  -- TRUE: every payment waits for an authorised person to approve it from a notification.
  -- FALSE: payments are recorded the moment they arrive (the owner picked "no approval").
  approval_required   BOOLEAN NOT NULL DEFAULT TRUE,
  transaction_id      UUID,
  paid_via            TEXT CHECK (paid_via IN ('cash', 'wallet', 'guest')),
  payer_name          TEXT,
  payer_phone         TEXT,
  paid_at             TIMESTAMPTZ,
  -- The payment currently waiting for approval
  pending_via         TEXT CHECK (pending_via IN ('cash', 'wallet', 'guest')),
  pending_payer_name  TEXT,
  pending_payer_phone TEXT,
  pending_at          TIMESTAMPTZ,
  -- The last decision (an approver's reject note is shown to the customer)
  decided_by          UUID,
  decided_at          TIMESTAMPTZ,
  last_reject_note    TEXT,
  -- A bill a CUSTOMER made from a standing pay QR: what they listed, and who they said they were.
  items               JSONB,
  from_paycode        UUID,
  customer_name       TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- An earlier version of this file may already have created these tables (CREATE TABLE IF NOT EXISTS
-- skips an existing table), so bring an older one up to date column by column.
ALTER TABLE public.public_tx_requests
  ADD COLUMN IF NOT EXISTS approval_required   BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS pending_via         TEXT,
  ADD COLUMN IF NOT EXISTS pending_payer_name  TEXT,
  ADD COLUMN IF NOT EXISTS pending_payer_phone TEXT,
  ADD COLUMN IF NOT EXISTS pending_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS decided_by          UUID,
  ADD COLUMN IF NOT EXISTS decided_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_reject_note    TEXT,
  ADD COLUMN IF NOT EXISTS items               JSONB,
  ADD COLUMN IF NOT EXISTS from_paycode        UUID,
  ADD COLUMN IF NOT EXISTS customer_name       TEXT;

DO $$
DECLARE
  c RECORD;
BEGIN
  -- the old status check did not know 'pending_approval'
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.public_tx_requests'::regclass AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%status%' AND pg_get_constraintdef(oid) NOT LIKE '%pending_approval%'
  LOOP
    EXECUTE format('ALTER TABLE public.public_tx_requests DROP CONSTRAINT %I', c.conname);
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.public_tx_requests'::regclass
                    AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%pending_approval%'
                    AND pg_get_constraintdef(oid) LIKE '%status%') THEN
    ALTER TABLE public.public_tx_requests
      ADD CONSTRAINT public_tx_requests_status_check
      CHECK (status IN ('open', 'pending_approval', 'paid', 'cancelled'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.public_tx_requests'::regclass
                    AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%pending_via%') THEN
    ALTER TABLE public.public_tx_requests
      ADD CONSTRAINT public_tx_requests_pending_via_check
      CHECK (pending_via IS NULL OR pending_via IN ('cash', 'wallet', 'guest'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS public_tx_requests_user_idx ON public.public_tx_requests (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS public_tx_requests_biz_idx  ON public.public_tx_requests (business_profile_id, created_at DESC);
ALTER TABLE public.public_tx_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.public_tx_requests FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.public_tx_payments (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tx_ref                TEXT NOT NULL UNIQUE,
  -- Exactly one of these says what was paid. Plain uuids (no foreign keys): deleting a ledger
  -- entry must never erase the record of real money.
  transaction_id        UUID,
  request_id            UUID,
  payer_name            TEXT NOT NULL,
  payer_phone           TEXT,
  payer_user_id         UUID,
  recipient_user_id     UUID NOT NULL,
  recipient_business_id UUID,
  amount_ugx            NUMERIC NOT NULL,
  processing_fee_ugx    NUMERIC NOT NULL DEFAULT 0,
  charge_ugx            NUMERIC NOT NULL,
  ican_amount           NUMERIC(18, 8),
  paid_via              TEXT NOT NULL DEFAULT 'guest' CHECK (paid_via IN ('guest', 'wallet')),
  -- held = the money is captured (gateway verified / wallet debited) but waiting for an approver
  status                TEXT NOT NULL DEFAULT 'awaiting_payment'
                        CHECK (status IN ('awaiting_payment', 'held', 'paid', 'failed', 'refunded')),
  flw_transaction_id    TEXT,
  paid_ugx              NUMERIC,
  error                 TEXT,
  refund_note           TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at               TIMESTAMPTZ,
  CHECK (transaction_id IS NOT NULL OR request_id IS NOT NULL)
);
-- Older table (from an earlier run): add what the QR bills need.
ALTER TABLE public.public_tx_payments ADD COLUMN IF NOT EXISTS request_id UUID;
ALTER TABLE public.public_tx_payments ALTER COLUMN transaction_id DROP NOT NULL;

DO $$
DECLARE
  c RECORD;
BEGIN
  -- the old status check did not know 'held'
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.public_tx_payments'::regclass AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%status%' AND pg_get_constraintdef(oid) NOT LIKE '%held%'
  LOOP
    EXECUTE format('ALTER TABLE public.public_tx_payments DROP CONSTRAINT %I', c.conname);
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.public_tx_payments'::regclass
                    AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%held%') THEN
    ALTER TABLE public.public_tx_payments
      ADD CONSTRAINT public_tx_payments_status_check
      CHECK (status IN ('awaiting_payment', 'held', 'paid', 'failed', 'refunded'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.public_tx_payments'::regclass
                    AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%request_id%') THEN
    ALTER TABLE public.public_tx_payments
      ADD CONSTRAINT public_tx_payments_target_check
      CHECK (transaction_id IS NOT NULL OR request_id IS NOT NULL);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS public_tx_payments_tx_idx  ON public.public_tx_payments (transaction_id, status);
CREATE INDEX IF NOT EXISTS public_tx_payments_req_idx ON public.public_tx_payments (request_id, status);
ALTER TABLE public.public_tx_payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.public_tx_payments FROM PUBLIC, anon, authenticated;

-- A STANDING pay QR: printed once, customers enter any amount (see section 9b). One per business, or one
-- personal one per person.
CREATE TABLE IF NOT EXISTS public.public_tx_paycodes (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                TEXT NOT NULL UNIQUE DEFAULT public.fn_new_public_tx_code(),
  user_id             UUID NOT NULL,
  business_profile_id UUID,
  title               TEXT,
  active              BOOLEAN NOT NULL DEFAULT TRUE,
  approval_required   BOOLEAN NOT NULL DEFAULT TRUE,
  max_amount_ugx      NUMERIC NOT NULL DEFAULT 5000000 CHECK (max_amount_ugx >= 100 AND max_amount_ugx <= 50000000),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS public_tx_paycodes_biz_key
  ON public.public_tx_paycodes (business_profile_id) WHERE business_profile_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS public_tx_paycodes_personal_key
  ON public.public_tx_paycodes (user_id) WHERE business_profile_id IS NULL;
CREATE INDEX IF NOT EXISTS public_tx_requests_paycode_idx ON public.public_tx_requests (from_paycode, created_at DESC)
  WHERE from_paycode IS NOT NULL;
ALTER TABLE public.public_tx_paycodes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.public_tx_paycodes FROM PUBLIC, anon, authenticated;



-- ----------------------------------------------------------------------------
-- 3. Small helpers (internal — nothing here is callable from the browser)
-- ----------------------------------------------------------------------------

-- Live UGX value of one icaneracoin. Refuses rather than guesses.
CREATE OR REPLACE FUNCTION public.public_tx_ican_price_ugx()
RETURNS NUMERIC LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v NUMERIC;
BEGIN
  IF to_regprocedure('public.ican_live_ugx_price()') IS NOT NULL THEN
    EXECUTE 'SELECT public.ican_live_ugx_price()' INTO v;
  ELSE
    BEGIN
      SELECT price_local INTO v FROM public.ican_get_price_in_currency('UGX'::VARCHAR) LIMIT 1;
    EXCEPTION WHEN OTHERS THEN
      v := NULL;
    END;
  END IF;
  IF v IS NULL OR v <= 0 THEN
    RAISE EXCEPTION 'The live icaneracoin price is not available right now — please try again in a moment';
  END IF;
  RETURN v;
END;
$$;

-- Payment-processing fee (percent) a visitor without a wallet pays on top.
CREATE OR REPLACE FUNCTION public.public_tx_fee_pct()
RETURNS NUMERIC LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v NUMERIC;
BEGIN
  BEGIN
    EXECUTE $q$SELECT NULLIF(value, '')::NUMERIC FROM public.guest_checkout_config WHERE key = 'gateway_fee_pct'$q$ INTO v;
  EXCEPTION WHEN OTHERS THEN
    v := NULL;
  END;
  RETURN LEAST(GREATEST(COALESCE(v, 3.5), 0), 20);
END;
$$;

-- Who is paid: the entry's business (its owner's business wallet) when it is tagged to one,
-- otherwise the person who recorded it.
CREATE OR REPLACE FUNCTION public._public_tx_recipient(p_business UUID, p_user UUID)
RETURNS TABLE (recipient_user_id UUID, recipient_business_id UUID)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(bp.user_id, p_user), bp.id
    FROM (SELECT 1) s
    LEFT JOIN public.business_profiles bp ON bp.id = p_business;
$$;

-- Who issued the receipt, for display: the business name (and its CMMS website) or the person.
CREATE OR REPLACE FUNCTION public._public_tx_issuer(p_business UUID, p_user UUID)
RETURNS TABLE (issuer_name TEXT, issuer_kind TEXT, company_id UUID)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_name TEXT;
  v_kind TEXT := 'person';
  v_company UUID;
BEGIN
  IF p_business IS NOT NULL THEN
    SELECT bp.business_name INTO v_name FROM public.business_profiles bp WHERE bp.id = p_business;
    IF v_name IS NOT NULL THEN
      v_kind := 'business';
      BEGIN
        SELECT c.id INTO v_company FROM public.cmms_company_profiles c
         WHERE c.pichin_business_profile_id = p_business LIMIT 1;
      EXCEPTION WHEN undefined_table OR undefined_column THEN
        v_company := NULL;
      END;
    END IF;
  END IF;
  IF v_name IS NULL THEN
    SELECT p.full_name INTO v_name FROM public.profiles p WHERE p.id = p_user;
  END IF;
  RETURN QUERY SELECT COALESCE(v_name, 'IcanEra member'), v_kind, v_company;
END;
$$;

-- Same number the app shows (utils/transactionReceipt.js makeReceiptNumber): RCT-YYYYMMDD-XXXXXXXX
CREATE OR REPLACE FUNCTION public._public_tx_receipt_no(p_created TIMESTAMPTZ, p_id UUID, p_meta JSONB)
RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(p_meta ->> 'receipt_number', ''),
           'RCT-' || to_char(p_created AT TIME ZONE 'UTC', 'YYYYMMDD')
           || '-' || upper(left(replace(p_id::text, '-', ''), 8)));
$$;

-- Why this entry cannot take a payment (NULL = it can).
CREATE OR REPLACE FUNCTION public._public_tx_pay_blocker(r public.ican_transactions)
RETURNS TEXT LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF to_jsonb(r) ->> 'deleted_at' IS NOT NULL THEN
    RETURN 'This entry was deleted';
  END IF;
  IF r.transaction_type IS DISTINCT FROM 'income' THEN
    RETURN 'Only money-in (income) entries can be paid through the QR';
  END IF;
  IF upper(COALESCE(r.currency, 'UGX')) <> 'UGX' THEN
    RETURN 'Online payment works for entries recorded in UGX';
  END IF;
  IF COALESCE(r.amount, 0) < 500 THEN
    RETURN 'The amount is too small for Mobile Money (minimum UGX 500)';
  END IF;
  RETURN NULL;
END;
$$;

-- May this signed-in user manage the entry's QR? The person who recorded it, the owner of the
-- business it is tagged to, or a co-owner of that business.
CREATE OR REPLACE FUNCTION public._public_tx_can_manage(r public.ican_transactions)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND (
    r.user_id = auth.uid()
    OR (r.business_profile_id IS NOT NULL AND (
         EXISTS (SELECT 1 FROM public.business_profiles bp
                  WHERE bp.id = r.business_profile_id AND bp.user_id = auth.uid())
      OR EXISTS (SELECT 1 FROM public.business_co_owners bco
                  WHERE bco.business_profile_id = r.business_profile_id AND bco.user_id = auth.uid())
    ))
  );
$$;

-- Who may manage AND approve a QR payment request: the person who made it, the owner or a
-- co-owner of the business it belongs to, and anyone the business has given finance access
-- (pitchin_business_wallet_finance_access: finance role, finance permission, store manager...).
CREATE OR REPLACE FUNCTION public._public_tx_request_can_manage(q public.public_tx_requests)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ok BOOLEAN := FALSE;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN FALSE;
  END IF;
  IF q.user_id = auth.uid() THEN
    RETURN TRUE;
  END IF;
  IF q.business_profile_id IS NULL THEN
    RETURN FALSE;
  END IF;
  IF EXISTS (SELECT 1 FROM public.business_profiles bp WHERE bp.id = q.business_profile_id AND bp.user_id = auth.uid())
     OR EXISTS (SELECT 1 FROM public.business_co_owners bco WHERE bco.business_profile_id = q.business_profile_id AND bco.user_id = auth.uid()) THEN
    RETURN TRUE;
  END IF;
  IF to_regprocedure('public.pitchin_business_wallet_finance_access(uuid)') IS NOT NULL THEN
    BEGIN
      EXECUTE 'SELECT public.pitchin_business_wallet_finance_access($1)' INTO v_ok USING q.business_profile_id;
    EXCEPTION WHEN OTHERS THEN
      v_ok := FALSE;
    END;
  END IF;
  RETURN COALESCE(v_ok, FALSE);
END;
$$;

-- Everyone who should be told (and pushed to their phone) when a payment needs approval:
-- the person who made the bill, the business owner, co-owners, and finance team members.
CREATE OR REPLACE FUNCTION public._public_tx_approver_ids(p_business UUID, p_creator UUID)
RETURNS UUID[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ids UUID[] := ARRAY[p_creator];
  v_more UUID[];
BEGIN
  IF p_business IS NOT NULL THEN
    SELECT COALESCE(array_agg(x.id), ARRAY[]::UUID[]) INTO v_more FROM (
      SELECT bp.user_id AS id FROM public.business_profiles bp WHERE bp.id = p_business
      UNION SELECT bco.user_id FROM public.business_co_owners bco WHERE bco.business_profile_id = p_business
    ) x WHERE x.id IS NOT NULL;
    v_ids := v_ids || v_more;
    BEGIN
      SELECT COALESCE(array_agg(tm.user_id), ARRAY[]::UUID[]) INTO v_more
        FROM public.business_team_members tm
       WHERE tm.business_profile_id = p_business AND tm.status = 'active'
         AND tm.business_wallet_role = 'finance' AND tm.user_id IS NOT NULL;
      v_ids := v_ids || v_more;
    EXCEPTION WHEN undefined_table OR undefined_column THEN NULL;
    END;
    BEGIN
      SELECT COALESCE(array_agg(bm.auth_user_id), ARRAY[]::UUID[]) INTO v_more
        FROM public.business_account_members bm
       WHERE bm.business_profile_id = p_business AND bm.employment_status = 'active' AND bm.auth_user_id IS NOT NULL
         AND (COALESCE((bm.permissions ->> 'business_wallet_finance')::BOOLEAN, FALSE)
              OR COALESCE((bm.permissions ->> 'finances')::BOOLEAN, FALSE));
      v_ids := v_ids || v_more;
    EXCEPTION WHEN undefined_table OR undefined_column THEN NULL;
    END;
  END IF;
  RETURN ARRAY(SELECT DISTINCT i FROM unnest(v_ids) i WHERE i IS NOT NULL);
END;
$$;

-- Puts a message in the shared IcanEra wallet inbox (which the push relay already delivers to
-- installed phones). Best effort: a missing inbox must never block a payment.
CREATE OR REPLACE FUNCTION public._public_tx_notify(
  p_user UUID, p_type TEXT, p_title TEXT, p_message TEXT, p_business UUID, p_request UUID
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_user IS NULL THEN RETURN; END IF;
  BEGIN
    INSERT INTO public.ican_wallet_inbox_notifications
      (recipient_user_id, source_app, notification_type, title, message, business_profile_id, reference_id, metadata)
    VALUES
      (p_user, 'ican', p_type, left(p_title, 200), left(p_message, 500), p_business, p_request::TEXT,
       jsonb_build_object('qr_request_id', p_request));
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public._public_tx_notify_approvers(p_request public.public_tx_requests, p_title TEXT, p_message TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id UUID;
BEGIN
  FOREACH v_id IN ARRAY public._public_tx_approver_ids(p_request.business_profile_id, p_request.user_id) LOOP
    PERFORM public._public_tx_notify(v_id, 'qr_payment_approval', p_title, p_message, p_request.business_profile_id, p_request.id);
  END LOOP;
END;
$$;

-- Direct credit of coins to a personal wallet (coins that were already taken from a payer, or a refund).
CREATE OR REPLACE FUNCTION public._public_tx_credit_user(
  p_user UUID, p_ican NUMERIC, p_local_ugx NUMERIC, p_ref TEXT, p_note TEXT, p_business UUID DEFAULT NULL
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.get_or_create_ican_wallet(p_user);
  UPDATE public.ican_user_wallets
     SET ican_balance = ican_balance + p_ican, total_earned = total_earned + p_ican
   WHERE user_id = p_user;
  INSERT INTO public.ican_coin_transactions
    (recipient_user_id, ican_amount, type, transaction_type, status, local_amount, local_currency,
     source_app, reference_id, note, business_profile_id)
  VALUES
    (p_user, p_ican, 'transfer_in', 'transfer_in', 'completed', p_local_ugx, 'UGX',
     'ican', p_ref, p_note, p_business);
END;
$$;

CREATE OR REPLACE FUNCTION public._public_tx_request_json(q public.public_tx_requests)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'id', q.id, 'code', q.code, 'amount_ugx', q.amount_ugx, 'description', q.description,
    'status', q.status, 'approval_required', q.approval_required,
    'paid_via', q.paid_via, 'payer_name', q.payer_name, 'payer_phone', q.payer_phone,
    'paid_at', q.paid_at, 'created_at', q.created_at, 'transaction_id', q.transaction_id,
    'pending_via', q.pending_via, 'pending_payer_name', q.pending_payer_name,
    'pending_payer_phone', q.pending_payer_phone, 'pending_at', q.pending_at,
    'last_reject_note', q.last_reject_note,
    'items', q.items, 'from_paycode', q.from_paycode IS NOT NULL, 'customer_name', q.customer_name,
    'business_profile_id', q.business_profile_id,
    'receipt_number', public._public_tx_receipt_no(q.created_at, q.id, NULL));
$$;

-- Marks a ledger entry paid and stamps the payer on it, so the owner's own receipt says "Paid by …".
CREATE OR REPLACE FUNCTION public._public_tx_mark_paid(
  p_tx_id UUID, p_payer_name TEXT, p_payer_phone TEXT, p_via TEXT, p_paid_ugx NUMERIC
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM set_config('app.public_tx_write', 'on', TRUE);
  UPDATE public.ican_transactions
     SET public_pay_status = 'paid',
         public_paid_at    = now(),
         metadata = jsonb_build_object(
                      'payment_method', CASE WHEN p_via = 'wallet' THEN 'IcanEra wallet (QR)'
                                             ELSE 'Mobile Money / card / bank (QR)' END,
                      'payer_name', p_payer_name
                    )
                    || COALESCE(metadata, '{}'::JSONB)
                    || jsonb_build_object('public_payment', jsonb_build_object(
                         'via', p_via, 'payer_name', p_payer_name, 'payer_phone', p_payer_phone,
                         'paid_ugx', p_paid_ugx, 'paid_at', now()))
   WHERE id = p_tx_id;
  PERFORM set_config('app.public_tx_write', 'off', TRUE);
END;
$$;

-- A QR request has been paid (any way): write the REAL income entry to the ledger — the same row
-- the entry form writes — so reports, the transactions list, tithe and valuation all see it from
-- this moment. The request's code moves onto that row, so the QR keeps working as its receipt.
CREATE OR REPLACE FUNCTION public._public_tx_request_settle(
  p_req_id UUID, p_via TEXT, p_payer_name TEXT, p_payer_phone TEXT, p_paid_ugx NUMERIC
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  q    public.public_tx_requests%ROWTYPE;
  v_tx UUID;
  v_no TEXT;
BEGIN
  SELECT * INTO q FROM public.public_tx_requests WHERE id = p_req_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment request not found';
  END IF;
  IF q.status NOT IN ('open', 'pending_approval') THEN
    RAISE EXCEPTION '%', CASE WHEN q.status = 'paid' THEN 'This request was already paid'
                              ELSE 'This payment request was cancelled' END;
  END IF;
  v_no := public._public_tx_receipt_no(q.created_at, q.id, NULL);

  INSERT INTO public.ican_transactions (
    user_id, transaction_type, amount, currency, description, status, business_profile_id,
    created_at, metadata, public_code, public_pay_status, public_paid_at
  ) VALUES (
    q.user_id, 'income', q.amount_ugx, 'UGX', q.description, 'completed', q.business_profile_id,
    now(),
    jsonb_build_object('source', 'qr_payment',
                       'record_category', CASE WHEN q.business_profile_id IS NOT NULL THEN 'business' ELSE 'personal' END)
    || q.meta
    || CASE WHEN q.items IS NOT NULL THEN jsonb_build_object('items', q.items) ELSE '{}'::JSONB END
    || jsonb_build_object(
         'receipt_number', v_no,
         'payment_method', CASE p_via WHEN 'cash'   THEN 'Cash (QR)'
                                      WHEN 'wallet' THEN 'IcanEra wallet (QR)'
                                      ELSE 'Mobile Money / card / bank (QR)' END,
         'payer_name', p_payer_name,
         'public_payment', jsonb_build_object('via', p_via, 'payer_name', p_payer_name,
                                              'payer_phone', p_payer_phone, 'paid_ugx', p_paid_ugx, 'paid_at', now())),
    q.code, 'paid', now()
  ) RETURNING id INTO v_tx;

  UPDATE public.public_tx_requests
     SET status = 'paid', transaction_id = v_tx, paid_via = p_via,
         payer_name = p_payer_name, payer_phone = p_payer_phone, paid_at = now(),
         pending_via = NULL, pending_payer_name = NULL, pending_payer_phone = NULL, pending_at = NULL
   WHERE id = q.id;
  RETURN v_tx;
END;
$$;

REVOKE ALL ON FUNCTION public.public_tx_ican_price_ugx()                              FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.public_tx_fee_pct()                                     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._public_tx_recipient(UUID, UUID)                        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._public_tx_issuer(UUID, UUID)                           FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._public_tx_receipt_no(TIMESTAMPTZ, UUID, JSONB)         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._public_tx_pay_blocker(public.ican_transactions)        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._public_tx_can_manage(public.ican_transactions)         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._public_tx_request_can_manage(public.public_tx_requests) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._public_tx_request_json(public.public_tx_requests)      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._public_tx_approver_ids(UUID, UUID)                     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._public_tx_notify(UUID, TEXT, TEXT, TEXT, UUID, UUID)   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._public_tx_notify_approvers(public.public_tx_requests, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._public_tx_credit_user(UUID, NUMERIC, NUMERIC, TEXT, TEXT, UUID)   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._public_tx_mark_paid(UUID, TEXT, TEXT, TEXT, NUMERIC)   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._public_tx_request_settle(UUID, TEXT, TEXT, TEXT, NUMERIC) FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4. The public receipt — what a scan shows (anon). Works for a recorded entry and for an
--    open QR payment request.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.public_tx_receipt(p_code TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r         public.ican_transactions%ROWTYPE;
  q         public.public_tx_requests%ROWTYPE;
  v_iss     RECORD;
  v_pay     RECORD;
  v_blocker TEXT;
  v_payable BOOLEAN;
  v_pct     NUMERIC;
  v_amount  NUMERIC;
  v_charge  NUMERIC;
  v_meta    JSONB;
BEGIN
  IF p_code IS NULL OR p_code !~ '^[a-z0-9]{16,40}$' THEN
    RETURN jsonb_build_object('found', FALSE);
  END IF;
  v_pct := public.public_tx_fee_pct();

  SELECT * INTO r FROM public.ican_transactions WHERE public_code = p_code;
  IF NOT FOUND THEN
    -- Not a recorded entry (yet): is it an open QR payment request?
    SELECT * INTO q FROM public.public_tx_requests WHERE code = p_code;
    IF NOT FOUND OR q.status = 'paid' THEN
      RETURN jsonb_build_object('found', FALSE);
    END IF;
    SELECT * INTO v_iss FROM public._public_tx_issuer(q.business_profile_id, q.user_id);
    v_meta   := COALESCE(q.meta, '{}'::JSONB);
    v_amount := CEIL(q.amount_ugx);
    v_charge := CEIL((v_amount / (1 - v_pct / 100)) / 100) * 100;
    RETURN jsonb_build_object(
      'found', TRUE,
      'request', TRUE,
      'cancelled', q.status = 'cancelled',
      'receipt_number', public._public_tx_receipt_no(q.created_at, q.id, NULL),
      'direction', 'income',
      'amount', q.amount_ugx,
      'currency', 'UGX',
      'description', q.description,
      'category', COALESCE(NULLIF(v_meta ->> 'categoryName', ''), NULLIF(v_meta ->> 'category', '')),
      'item', NULLIF(v_meta ->> 'product_name', ''),
      'quantity', v_meta -> 'quantity',
      'unit_price', v_meta -> 'unit_price',
      'items', q.items,
      'customer_name', q.customer_name,
      'receipt_ref', NULLIF(v_meta ->> 'receipt_ref', ''),
      'recorded_at', q.created_at,
      'issuer_name', v_iss.issuer_name,
      'issuer_kind', v_iss.issuer_kind,
      'company_id', v_iss.company_id,
      'pay_status', CASE WHEN q.status IN ('open', 'pending_approval') THEN q.status ELSE 'closed' END,
      'payable', q.status = 'open',
      -- A payment is in and an approver has been notified: the page waits for their decision.
      'pending_approval', q.status = 'pending_approval',
      'pending_via', CASE WHEN q.status = 'pending_approval' THEN q.pending_via END,
      'approval_required', q.approval_required,
      -- With approval on, a customer may say "I paid cash" and the approver confirms it;
      -- with approval off, cash is only ever confirmed by the owner at the counter.
      'cash_allowed', q.status = 'open',
      'cash_claim_allowed', q.status = 'open' AND q.approval_required,
      'last_reject_note', CASE WHEN q.status = 'open' THEN q.last_reject_note END,
      'guest_ok', v_amount >= 500,
      'fee_pct', v_pct,
      'amount_ugx', CASE WHEN q.status = 'open' THEN v_amount END,
      'charge_ugx', CASE WHEN q.status = 'open' THEN v_charge END,
      'processing_fee_ugx', CASE WHEN q.status = 'open' THEN v_charge - v_amount END,
      'paid', FALSE
    );
  END IF;

  IF to_jsonb(r) ->> 'deleted_at' IS NOT NULL THEN
    RETURN jsonb_build_object('found', FALSE);
  END IF;
  v_meta := COALESCE(r.metadata, '{}'::JSONB);
  SELECT * INTO v_iss FROM public._public_tx_issuer(r.business_profile_id, r.user_id);

  SELECT pp.paid_via, pp.paid_at, pp.payer_name INTO v_pay
    FROM public.public_tx_payments pp
   WHERE (pp.transaction_id = r.id
          OR pp.request_id IN (SELECT rq.id FROM public.public_tx_requests rq WHERE rq.transaction_id = r.id))
     AND pp.status = 'paid'
   ORDER BY pp.paid_at DESC NULLS LAST LIMIT 1;

  v_blocker := public._public_tx_pay_blocker(r);
  v_payable := r.public_pay_status = 'open' AND v_blocker IS NULL;
  v_amount  := CEIL(COALESCE(r.amount, 0));
  v_charge  := CASE WHEN v_payable
                    THEN CEIL((v_amount / (1 - v_pct / 100)) / 100) * 100 END;

  RETURN jsonb_build_object(
    'found',          TRUE,
    'receipt_number', public._public_tx_receipt_no(r.created_at, r.id, v_meta),
    'direction',      r.transaction_type,
    'amount',         r.amount,
    'currency',       COALESCE(r.currency, 'UGX'),
    'description',    r.description,
    'category',       COALESCE(NULLIF(v_meta ->> 'categoryName', ''), NULLIF(v_meta ->> 'category', '')),
    'item',           NULLIF(v_meta ->> 'product_name', ''),
    'quantity',       v_meta -> 'quantity',
    'unit_price',     v_meta -> 'unit_price',
    'items',          v_meta -> 'items',
    'receipt_ref',    NULLIF(v_meta ->> 'receipt_ref', ''),
    'recorded_at',    r.created_at,
    'issuer_name',    v_iss.issuer_name,
    'issuer_kind',    v_iss.issuer_kind,
    'company_id',     v_iss.company_id,
    'pay_status',     r.public_pay_status,
    'payable',        v_payable,
    'cash_allowed',   FALSE,
    'guest_ok',       TRUE,
    'pay_blocker',    CASE WHEN r.public_pay_status = 'open' THEN v_blocker END,
    'fee_pct',        v_pct,
    'amount_ugx',     CASE WHEN v_payable THEN v_amount END,
    'charge_ugx',     v_charge,
    'processing_fee_ugx', CASE WHEN v_payable THEN v_charge - v_amount END,
    'paid',           r.public_pay_status = 'paid',
    'paid_at',        r.public_paid_at,
    -- a request settled by cash leaves a payment note on the entry, not a payments row
    'paid_via',       COALESCE(v_pay.paid_via, v_meta -> 'public_payment' ->> 'via'),
    -- first name only: enough for "thanks, Sarah", nothing a stranger could use
    'payer_first_name', NULLIF(split_part(COALESCE(v_pay.payer_name, v_meta -> 'public_payment' ->> 'payer_name', ''), ' ', 1), '')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.public_tx_receipt(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_tx_receipt(TEXT) TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- 5. The owner's side for an EXISTING ledger entry — get the link, switch payment on / off
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.public_tx_get_link(p_tx_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r         public.ican_transactions%ROWTYPE;
  v_blocker TEXT;
  v_pay     RECORD;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Please sign in');
  END IF;
  SELECT * INTO r FROM public.ican_transactions WHERE id = p_tx_id;
  IF NOT FOUND OR NOT public._public_tx_can_manage(r) THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Transaction not found');
  END IF;

  -- Entries recorded before this file existed get their code now.
  IF r.public_code IS NULL THEN
    PERFORM set_config('app.public_tx_write', 'on', TRUE);
    UPDATE public.ican_transactions SET public_code = public.fn_new_public_tx_code()
     WHERE id = r.id AND public_code IS NULL
     RETURNING public_code INTO r.public_code;
    PERFORM set_config('app.public_tx_write', 'off', TRUE);
    IF r.public_code IS NULL THEN
      SELECT public_code INTO r.public_code FROM public.ican_transactions WHERE id = r.id;
    END IF;
  END IF;

  v_blocker := public._public_tx_pay_blocker(r);

  SELECT pp.payer_name, pp.payer_phone, pp.paid_via, pp.paid_at, pp.amount_ugx INTO v_pay
    FROM public.public_tx_payments pp
   WHERE (pp.transaction_id = r.id
          OR pp.request_id IN (SELECT rq.id FROM public.public_tx_requests rq WHERE rq.transaction_id = r.id))
     AND pp.status = 'paid'
   ORDER BY pp.paid_at DESC NULLS LAST LIMIT 1;

  RETURN jsonb_build_object(
    'success',    TRUE,
    'code',       r.public_code,
    'pay_status', r.public_pay_status,
    'can_enable', v_blocker IS NULL AND r.public_pay_status IN ('off', 'closed'),
    'blocker',    v_blocker,
    'fee_pct',    public.public_tx_fee_pct(),
    'paid', CASE WHEN r.public_pay_status = 'paid' THEN jsonb_build_object(
               'payer_name', COALESCE(v_pay.payer_name, r.metadata -> 'public_payment' ->> 'payer_name'),
               'payer_phone', COALESCE(v_pay.payer_phone, r.metadata -> 'public_payment' ->> 'payer_phone'),
               'via', COALESCE(v_pay.paid_via, r.metadata -> 'public_payment' ->> 'via'),
               'paid_at', COALESCE(v_pay.paid_at, r.public_paid_at),
               'amount_ugx', COALESCE(v_pay.amount_ugx, r.amount)) END
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.public_tx_set_pay(p_tx_id UUID, p_enable BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r         public.ican_transactions%ROWTYPE;
  v_blocker TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Please sign in');
  END IF;
  SELECT * INTO r FROM public.ican_transactions WHERE id = p_tx_id FOR UPDATE;
  IF NOT FOUND OR NOT public._public_tx_can_manage(r) THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Transaction not found');
  END IF;
  IF r.public_pay_status = 'paid' THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'This has already been paid');
  END IF;

  IF p_enable THEN
    v_blocker := public._public_tx_pay_blocker(r);
    IF v_blocker IS NOT NULL THEN
      RETURN jsonb_build_object('success', FALSE, 'error', v_blocker);
    END IF;
  END IF;

  PERFORM set_config('app.public_tx_write', 'on', TRUE);
  UPDATE public.ican_transactions
     SET public_pay_status = CASE WHEN p_enable THEN 'open' ELSE 'closed' END,
         public_code = COALESCE(public_code, public.fn_new_public_tx_code())
   WHERE id = r.id;
  PERFORM set_config('app.public_tx_write', 'off', TRUE);

  RETURN public.public_tx_get_link(p_tx_id);
END;
$$;

REVOKE ALL ON FUNCTION public.public_tx_get_link(UUID)          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.public_tx_set_pay(UUID, BOOLEAN)  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.public_tx_get_link(UUID)         TO authenticated;
GRANT EXECUTE ON FUNCTION public.public_tx_set_pay(UUID, BOOLEAN) TO authenticated;

-- ----------------------------------------------------------------------------
-- 6. Pay with Mobile Money / card / bank — no account (anon)
--    p_dry_run = TRUE only prices it. Otherwise a pending payment is stored and
--    its tx_ref goes to Flutterwave.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.public_tx_pay_start(
  p_code        TEXT,
  p_payer_name  TEXT,
  p_payer_phone TEXT,
  p_dry_run     BOOLEAN DEFAULT FALSE
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r         public.ican_transactions%ROWTYPE;
  q         public.public_tx_requests%ROWTYPE;
  v_blocker TEXT;
  v_name    TEXT := NULLIF(btrim(COALESCE(p_payer_name, '')), '');
  v_phone   TEXT := regexp_replace(COALESCE(p_payer_phone, ''), '[^0-9+]', '', 'g');
  v_pct     NUMERIC;
  v_amount  NUMERIC;
  v_charge  NUMERIC;
  v_tx      UUID;
  v_req     UUID;
  v_biz_in  UUID;
  v_user_in UUID;
  v_user    UUID;
  v_biz     UUID;
  v_ref     TEXT;
BEGIN
  IF p_code IS NULL OR p_code !~ '^[a-z0-9]{16,40}$' THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'This receipt link is not valid');
  END IF;
  IF NOT p_dry_run THEN
    IF v_name IS NULL OR char_length(v_name) < 2 OR char_length(v_name) > 80 THEN
      RETURN jsonb_build_object('success', FALSE, 'error', 'Enter your name');
    END IF;
    IF char_length(v_phone) < 9 OR char_length(v_phone) > 16 THEN
      RETURN jsonb_build_object('success', FALSE, 'error', 'Enter the phone number you will pay with');
    END IF;
  END IF;

  SELECT * INTO r FROM public.ican_transactions WHERE public_code = p_code;
  IF FOUND THEN
    IF r.public_pay_status = 'paid' THEN
      RETURN jsonb_build_object('success', FALSE, 'error', 'This has already been paid — thank you');
    END IF;
    IF r.public_pay_status <> 'open' THEN
      RETURN jsonb_build_object('success', FALSE, 'error', 'Payment is not switched on for this receipt');
    END IF;
    v_blocker := public._public_tx_pay_blocker(r);
    IF v_blocker IS NOT NULL THEN
      RETURN jsonb_build_object('success', FALSE, 'error', v_blocker);
    END IF;
    v_amount := CEIL(r.amount); v_tx := r.id; v_biz_in := r.business_profile_id; v_user_in := r.user_id;
  ELSE
    SELECT * INTO q FROM public.public_tx_requests WHERE code = p_code;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', FALSE, 'error', 'This receipt link is not valid');
    END IF;
    IF q.status = 'paid' THEN
      RETURN jsonb_build_object('success', FALSE, 'error', 'This has already been paid — thank you');
    END IF;
    IF q.status = 'pending_approval' THEN
      RETURN jsonb_build_object('success', FALSE, 'error', 'A payment on this bill is already waiting for approval');
    END IF;
    IF q.status <> 'open' THEN
      RETURN jsonb_build_object('success', FALSE, 'error', 'This payment request was cancelled');
    END IF;
    v_amount := CEIL(q.amount_ugx);
    IF v_amount < 500 THEN
      RETURN jsonb_build_object('success', FALSE, 'error',
        'Mobile Money needs at least UGX 500 — pay with your IcanEra wallet or in cash instead');
    END IF;
    v_req := q.id; v_biz_in := q.business_profile_id; v_user_in := q.user_id;
  END IF;

  -- Refuse up front (before anyone is charged) if the live coin price can't be read.
  BEGIN
    PERFORM public.public_tx_ican_price_ugx();
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', FALSE, 'error', SQLERRM);
  END;

  v_pct := public.public_tx_fee_pct();
  -- The visitor pays the amount grossed up for the gateway's cut, rounded up to the next 100 UGX,
  -- so the owner receives the full amount (same maths as guest checkout).
  v_charge := CEIL((v_amount / (1 - v_pct / 100)) / 100) * 100;

  IF NOT p_dry_run THEN
    -- Tidy abandoned attempts, and don't let one link be hammered with pending rows.
    DELETE FROM public.public_tx_payments
     WHERE COALESCE(transaction_id, request_id) = COALESCE(v_tx, v_req)
       AND status = 'awaiting_payment' AND created_at < now() - INTERVAL '7 days';
    IF (SELECT count(*) FROM public.public_tx_payments
         WHERE COALESCE(transaction_id, request_id) = COALESCE(v_tx, v_req)
           AND status = 'awaiting_payment'
           AND created_at > now() - INTERVAL '1 hour') >= 10 THEN
      RETURN jsonb_build_object('success', FALSE, 'error', 'Too many attempts on this receipt — please wait a few minutes and try again');
    END IF;

    SELECT rc.recipient_user_id, rc.recipient_business_id INTO v_user, v_biz
      FROM public._public_tx_recipient(v_biz_in, v_user_in) rc;

    v_ref := 'PTX-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 20));
    INSERT INTO public.public_tx_payments (
      tx_ref, transaction_id, request_id, payer_name, payer_phone, recipient_user_id, recipient_business_id,
      amount_ugx, processing_fee_ugx, charge_ugx, paid_via
    ) VALUES (v_ref, v_tx, v_req, v_name, v_phone, v_user, v_biz, v_amount, v_charge - v_amount, v_charge, 'guest');
  END IF;

  RETURN jsonb_build_object(
    'success', TRUE,
    'tx_ref', v_ref,
    'amount_ugx', v_amount,
    'processing_fee_pct', v_pct,
    'processing_fee_ugx', v_charge - v_amount,
    'charge_ugx', v_charge
  );
END;
$$;

REVOKE ALL ON FUNCTION public.public_tx_pay_start(TEXT, TEXT, TEXT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_tx_pay_start(TEXT, TEXT, TEXT, BOOLEAN) TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- 7. Fulfil — called ONLY by the public-tx-pay Edge Function, after Flutterwave itself has
--    confirmed the money. Credits the owner and closes the entry / writes the income entry.
--    On any failure everything in the inner block rolls back and the function refunds the visitor.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.public_tx_fulfil(
  p_tx_ref TEXT, p_flw_transaction_id TEXT, p_paid_ugx NUMERIC
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  p         public.public_tx_payments%ROWTYPE;
  r         public.ican_transactions%ROWTYPE;
  q         public.public_tx_requests%ROWTYPE;
  v_state   TEXT;   -- open | paid | closed (NULL = the thing paid for no longer exists)
  v_code    TEXT;
  v_desc    TEXT;
  v_receipt TEXT;
  v_price   NUMERIC;
  v_ican    NUMERIC;
  v_note    TEXT;
  v_res     JSONB;
  v_err     TEXT;
  v_txid    UUID;
  v_held    BOOLEAN := FALSE;
BEGIN
  SELECT * INTO p FROM public.public_tx_payments WHERE tx_ref = p_tx_ref FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Payment not found');
  END IF;

  IF p.request_id IS NOT NULL THEN
    SELECT * INTO q FROM public.public_tx_requests WHERE id = p.request_id FOR UPDATE;
    IF q.id IS NOT NULL THEN
      v_state := q.status; v_code := q.code; v_desc := q.description;
      v_receipt := public._public_tx_receipt_no(q.created_at, q.id, NULL);
    END IF;
  ELSE
    SELECT * INTO r FROM public.ican_transactions WHERE id = p.transaction_id FOR UPDATE;
    IF r.id IS NOT NULL THEN
      v_state := CASE r.public_pay_status WHEN 'open' THEN 'open' WHEN 'paid' THEN 'paid' ELSE 'closed' END;
      v_code := r.public_code; v_desc := r.description;
      v_receipt := public._public_tx_receipt_no(r.created_at, r.id, r.metadata);
    END IF;
  END IF;

  IF p.status IN ('paid', 'held') THEN
    RETURN jsonb_build_object('success', TRUE, 'already_processed', TRUE, 'code', v_code,
      'pending_approval', p.status = 'held',
      'receipt_number', v_receipt, 'amount_ugx', p.amount_ugx, 'processing_fee_ugx', p.processing_fee_ugx,
      'charged_ugx', p.paid_ugx);
  END IF;
  IF p.status IN ('failed', 'refunded') THEN
    RETURN jsonb_build_object('success', FALSE, 'status', p.status,
      'error', COALESCE(p.error, 'This payment could not be completed'));
  END IF;
  IF p_paid_ugx IS NULL OR p_paid_ugx < p.charge_ugx - 1 THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'The amount paid is less than the amount due');
  END IF;

  BEGIN
    IF v_state IS NULL THEN
      RAISE EXCEPTION 'The receipt this payment was for no longer exists';
    END IF;
    -- Someone else paid it first, or the owner closed / cancelled it while this was in flight.
    IF v_state <> 'open' THEN
      RAISE EXCEPTION '%', CASE WHEN v_state = 'paid'
                                THEN 'This receipt was already paid by someone else'
                                ELSE 'The owner has closed payment on this receipt' END;
    END IF;

    IF p.request_id IS NOT NULL AND q.approval_required THEN
      -- The money is captured (Flutterwave confirmed it) but NOT credited or recorded yet: the bill
      -- waits for an authorised person to approve it from their notification.
      v_held := TRUE;
      UPDATE public.public_tx_requests
         SET status = 'pending_approval', pending_via = 'guest', pending_payer_name = p.payer_name,
             pending_payer_phone = p.payer_phone, pending_at = now()
       WHERE id = q.id;
      PERFORM public._public_tx_notify_approvers(q,
        'Approve payment: UGX ' || to_char(q.amount_ugx, 'FM999,999,999,990'),
        p.payer_name || ' paid by Mobile Money / card / bank for "' || left(q.description, 80) || '". Tap to approve or reject.');
    ELSE
    v_price := public.public_tx_ican_price_ugx();
    v_ican  := GREATEST(ROUND(p.amount_ugx / v_price, 8), 0.00000001);
    v_note  := format('Paid by QR — %s | receipt %s | %s', p.payer_name, v_receipt,
                      COALESCE(NULLIF(v_desc, ''), 'Payment'));

    IF p.recipient_business_id IS NOT NULL THEN
      -- A sale: the full value goes to the business wallet (no person-to-business tithe).
      PERFORM public.ican_settle_business_wallet_income(
        p.recipient_business_id, v_ican, 'ican', 'PUBTX-' || p.tx_ref, 'pos_sale', v_note,
        jsonb_build_object('receipt_number', v_receipt, 'paid_via', 'guest'));
    ELSE
      v_res := public.buy_ican_coins(p.recipient_user_id, v_ican, 'ican', 'PUBTX-' || p.tx_ref);
      IF NOT COALESCE((v_res ->> 'success')::BOOLEAN, FALSE) THEN
        RAISE EXCEPTION '%', COALESCE(v_res ->> 'error', 'Could not credit the wallet');
      END IF;
    END IF;

    IF p.request_id IS NOT NULL THEN
      v_txid := public._public_tx_request_settle(p.request_id, 'guest', p.payer_name, p.payer_phone, p_paid_ugx);
    ELSE
      v_txid := r.id;
      PERFORM public._public_tx_mark_paid(r.id, p.payer_name, p.payer_phone, 'guest', p_paid_ugx);
    END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
    UPDATE public.public_tx_payments
       SET status = 'failed', error = v_err, flw_transaction_id = p_flw_transaction_id,
           paid_ugx = p_paid_ugx, updated_at = now()
     WHERE id = p.id;
    RETURN jsonb_build_object('success', FALSE, 'status', 'failed', 'error', v_err, 'refund_required', TRUE);
  END;

  UPDATE public.public_tx_payments
     SET status = CASE WHEN v_held THEN 'held' ELSE 'paid' END,
         flw_transaction_id = p_flw_transaction_id, paid_ugx = p_paid_ugx,
         transaction_id = COALESCE(transaction_id, v_txid),
         ican_amount = v_ican, error = NULL,
         paid_at = CASE WHEN v_held THEN NULL ELSE now() END, updated_at = now()
   WHERE id = p.id;

  RETURN jsonb_build_object(
    'success', TRUE, 'pending_approval', v_held, 'code', v_code, 'receipt_number', v_receipt,
    'amount_ugx', p.amount_ugx, 'processing_fee_ugx', p.processing_fee_ugx, 'charged_ugx', p_paid_ugx);
END;
$$;

CREATE OR REPLACE FUNCTION public.public_tx_mark_refunded(p_tx_ref TEXT, p_note TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.public_tx_payments
     SET status = 'refunded', refund_note = p_note, updated_at = now()
   WHERE tx_ref = p_tx_ref AND status IN ('failed', 'awaiting_payment');
$$;

REVOKE ALL ON FUNCTION public.public_tx_fulfil(TEXT, TEXT, NUMERIC)  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.public_tx_mark_refunded(TEXT, TEXT)    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_tx_fulfil(TEXT, TEXT, NUMERIC) TO service_role;
GRANT EXECUTE ON FUNCTION public.public_tx_mark_refunded(TEXT, TEXT)   TO service_role;

-- ----------------------------------------------------------------------------
-- 8. Pay with the IcanEra wallet (signed in) — no processing fee
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.public_tx_pay_wallet(p_code TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid     UUID := auth.uid();
  r         public.ican_transactions%ROWTYPE;
  q         public.public_tx_requests%ROWTYPE;
  v_blocker TEXT;
  v_biz_in  UUID;
  v_user_in UUID;
  v_desc    TEXT;
  v_user    UUID;
  v_biz     UUID;
  v_amount  NUMERIC;
  v_price   NUMERIC;
  v_ican    NUMERIC;
  v_balance NUMERIC;
  v_name    TEXT;
  v_issuer  TEXT;
  v_note    TEXT;
  v_ref     TEXT;
  v_receipt TEXT;
  v_res     JSONB;
  v_txid    UUID;
  v_held    BOOLEAN := FALSE;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Sign in to pay with your IcanEra wallet');
  END IF;
  IF p_code IS NULL OR p_code !~ '^[a-z0-9]{16,40}$' THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'This receipt link is not valid');
  END IF;

  SELECT * INTO r FROM public.ican_transactions WHERE public_code = p_code FOR UPDATE;
  IF FOUND THEN
    IF r.public_pay_status = 'paid' THEN
      RETURN jsonb_build_object('success', FALSE, 'error', 'This has already been paid — thank you');
    END IF;
    IF r.public_pay_status <> 'open' THEN
      RETURN jsonb_build_object('success', FALSE, 'error', 'Payment is not switched on for this receipt');
    END IF;
    v_blocker := public._public_tx_pay_blocker(r);
    IF v_blocker IS NOT NULL THEN
      RETURN jsonb_build_object('success', FALSE, 'error', v_blocker);
    END IF;
    v_amount := CEIL(r.amount); v_biz_in := r.business_profile_id; v_user_in := r.user_id; v_desc := r.description;
    v_receipt := public._public_tx_receipt_no(r.created_at, r.id, r.metadata);
    v_ref := 'PUBTX-W-' || r.id::text;
  ELSE
    SELECT * INTO q FROM public.public_tx_requests WHERE code = p_code FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', FALSE, 'error', 'This receipt link is not valid');
    END IF;
    IF q.status = 'paid' THEN
      RETURN jsonb_build_object('success', FALSE, 'error', 'This has already been paid — thank you');
    END IF;
    IF q.status = 'pending_approval' THEN
      RETURN jsonb_build_object('success', FALSE, 'error', 'A payment on this bill is already waiting for approval');
    END IF;
    IF q.status <> 'open' THEN
      RETURN jsonb_build_object('success', FALSE, 'error', 'This payment request was cancelled');
    END IF;
    v_amount := CEIL(q.amount_ugx); v_biz_in := q.business_profile_id; v_user_in := q.user_id; v_desc := q.description;
    v_receipt := public._public_tx_receipt_no(q.created_at, q.id, NULL);
    v_ref := 'PUBTX-W-' || q.id::text;
  END IF;

  SELECT rc.recipient_user_id, rc.recipient_business_id INTO v_user, v_biz
    FROM public._public_tx_recipient(v_biz_in, v_user_in) rc;
  IF v_user = v_uid THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'You cannot pay your own receipt');
  END IF;

  SELECT COALESCE(NULLIF(btrim(p.full_name), ''), 'IcanEra member') INTO v_name
    FROM public.profiles p WHERE p.id = v_uid;
  v_name := COALESCE(v_name, 'IcanEra member');
  IF v_biz IS NOT NULL THEN
    SELECT business_name INTO v_issuer FROM public.business_profiles WHERE id = v_biz;
  END IF;
  v_note := format('Paid by QR — %s | receipt %s | %s', v_name, v_receipt, COALESCE(NULLIF(v_desc, ''), 'Payment'));

  BEGIN
    v_price := public.public_tx_ican_price_ugx();
    v_ican  := GREATEST(ROUND(v_amount / v_price, 8), 0.00000001);

    IF q.id IS NOT NULL AND r.id IS NULL AND q.approval_required THEN
      -- Take the coins from the payer NOW, but credit nobody and record nothing until an authorised
      -- person approves (a reject gives the coins straight back).
      v_held := TRUE;
      SELECT ican_balance INTO v_balance FROM public.ican_user_wallets WHERE user_id = v_uid FOR UPDATE;
      IF v_balance IS NULL THEN
        RAISE EXCEPTION 'Your IcanEra wallet was not found';
      END IF;
      IF v_balance < v_ican THEN
        RAISE EXCEPTION 'Insufficient ICAN balance for this payment';
      END IF;
      UPDATE public.ican_user_wallets
         SET ican_balance = ican_balance - v_ican, total_spent = total_spent + v_ican
       WHERE user_id = v_uid;
      INSERT INTO public.ican_coin_transactions
        (sender_user_id, ican_amount, type, transaction_type, status, local_amount, local_currency,
         merchant_name, counterparty_type, expense_classification, source_app, reference_id, note, business_profile_id)
      VALUES
        (v_uid, v_ican, 'transfer_out', 'transfer_out', 'completed', v_amount, 'UGX',
         v_issuer, CASE WHEN v_biz IS NULL THEN 'person' ELSE 'business' END,
         CASE WHEN v_biz IS NULL THEN 'person_transfer' ELSE 'business_expense' END,
         'ican', v_ref, v_note || ' (held until approved)', v_biz);
      INSERT INTO public.public_tx_payments (
        tx_ref, request_id, payer_name, payer_user_id, recipient_user_id, recipient_business_id,
        amount_ugx, processing_fee_ugx, charge_ugx, ican_amount, paid_via, status, paid_ugx
      ) VALUES (
        'PTW-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 20)), q.id, v_name, v_uid,
        v_user, v_biz, v_amount, 0, v_amount, v_ican, 'wallet', 'held', v_amount);
      UPDATE public.public_tx_requests
         SET status = 'pending_approval', pending_via = 'wallet', pending_payer_name = v_name, pending_at = now()
       WHERE id = q.id;
      PERFORM public._public_tx_notify_approvers(q,
        'Approve payment: UGX ' || to_char(q.amount_ugx, 'FM999,999,999,990'),
        v_name || ' paid with their IcanEra wallet for "' || left(q.description, 80) || '". Tap to approve or reject.');
    ELSIF v_biz IS NULL THEN
      v_res := public.transfer_ican(v_uid, v_user, v_ican, v_note, 'ican', v_ref,
                                    v_amount, 'UGX', NULL, 'person', 'person_transfer', NULL);
      IF NOT COALESCE((v_res ->> 'success')::BOOLEAN, FALSE) THEN
        RAISE EXCEPTION '%', COALESCE(v_res ->> 'error', 'The transfer failed');
      END IF;
    ELSE
      SELECT ican_balance INTO v_balance FROM public.ican_user_wallets WHERE user_id = v_uid FOR UPDATE;
      IF v_balance IS NULL THEN
        RAISE EXCEPTION 'Your IcanEra wallet was not found';
      END IF;
      IF v_balance < v_ican THEN
        RAISE EXCEPTION 'Insufficient ICAN balance for this payment';
      END IF;
      UPDATE public.ican_user_wallets
         SET ican_balance = ican_balance - v_ican, total_spent = total_spent + v_ican
       WHERE user_id = v_uid;
      INSERT INTO public.ican_coin_transactions
        (sender_user_id, ican_amount, type, transaction_type, status, local_amount, local_currency,
         merchant_name, counterparty_type, expense_classification, source_app, reference_id, note, business_profile_id)
      VALUES
        (v_uid, v_ican, 'transfer_out', 'transfer_out', 'completed', v_amount, 'UGX',
         v_issuer, 'business', 'business_expense', 'ican', v_ref, v_note, v_biz);
      PERFORM public.ican_settle_business_wallet_income(
        v_biz, v_ican, 'ican', v_ref, 'pos_sale', v_note,
        jsonb_build_object('receipt_number', v_receipt, 'paid_via', 'wallet'));
    END IF;

    IF NOT v_held THEN
      IF q.id IS NOT NULL AND r.id IS NULL THEN
        v_txid := public._public_tx_request_settle(q.id, 'wallet', v_name, NULL, v_amount);
      ELSE
        v_txid := r.id;
        PERFORM public._public_tx_mark_paid(r.id, v_name, NULL, 'wallet', v_amount);
      END IF;

      INSERT INTO public.public_tx_payments (
        tx_ref, transaction_id, request_id, payer_name, payer_user_id, recipient_user_id, recipient_business_id,
        amount_ugx, processing_fee_ugx, charge_ugx, ican_amount, paid_via, status, paid_ugx, paid_at
      ) VALUES (
        'PTW-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 20)), v_txid, q.id, v_name, v_uid,
        v_user, v_biz, v_amount, 0, v_amount, v_ican, 'wallet', 'paid', v_amount, now());
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', FALSE, 'error', SQLERRM);
  END;

  RETURN jsonb_build_object('success', TRUE, 'pending_approval', v_held, 'receipt_number', v_receipt,
                            'amount_ugx', v_amount, 'ican_paid', v_ican);
END;
$$;

REVOKE ALL ON FUNCTION public.public_tx_pay_wallet(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.public_tx_pay_wallet(TEXT) TO authenticated;


-- ----------------------------------------------------------------------------
-- 9. QR PAY tab (owner / cashier, signed in) — make a QR bill, watch it, approve, cancel
-- ----------------------------------------------------------------------------

-- Owner, co-owner or anyone given finance access to the business (the people who may bill for it).
CREATE OR REPLACE FUNCTION public._public_tx_business_access(p_business UUID)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ok BOOLEAN := FALSE;
BEGIN
  IF auth.uid() IS NULL OR p_business IS NULL THEN
    RETURN FALSE;
  END IF;
  IF EXISTS (SELECT 1 FROM public.business_profiles bp WHERE bp.id = p_business AND bp.user_id = auth.uid())
     OR EXISTS (SELECT 1 FROM public.business_co_owners bco WHERE bco.business_profile_id = p_business AND bco.user_id = auth.uid()) THEN
    RETURN TRUE;
  END IF;
  IF to_regprocedure('public.pitchin_business_wallet_finance_access(uuid)') IS NOT NULL THEN
    BEGIN
      EXECUTE 'SELECT public.pitchin_business_wallet_finance_access($1)' INTO v_ok USING p_business;
    EXCEPTION WHEN OTHERS THEN
      v_ok := FALSE;
    END;
  END IF;
  RETURN COALESCE(v_ok, FALSE);
END;
$$;
REVOKE ALL ON FUNCTION public._public_tx_business_access(UUID) FROM PUBLIC, anon, authenticated;

-- The first version took four arguments; leaving it would make calls ambiguous.
DROP FUNCTION IF EXISTS public.public_tx_request_create(NUMERIC, TEXT, UUID, JSONB);

-- Creates the bill. Nothing is written to the ledger until it is paid AND (when approval is on)
-- approved. p_require_approval: every payment waits for an authorised person to approve it from a
-- notification (default); FALSE records payments the moment they arrive.
CREATE OR REPLACE FUNCTION public.public_tx_request_create(
  p_amount      NUMERIC,
  p_description TEXT,
  p_business_profile_id UUID DEFAULT NULL,
  p_meta        JSONB DEFAULT '{}'::JSONB,
  p_require_approval BOOLEAN DEFAULT TRUE
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid    UUID := auth.uid();
  v_amount NUMERIC := CEIL(COALESCE(p_amount, 0));
  v_desc   TEXT := left(NULLIF(btrim(COALESCE(p_description, '')), ''), 200);
  v_meta   JSONB;
  q        public.public_tx_requests%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Please sign in');
  END IF;
  IF v_amount < 100 OR v_amount > 50000000 THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'The amount must be between UGX 100 and UGX 50,000,000');
  END IF;
  IF v_desc IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Say what the payment is for');
  END IF;
  IF p_business_profile_id IS NOT NULL AND NOT public._public_tx_business_access(p_business_profile_id) THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'You cannot bill for that business');
  END IF;
  IF (SELECT count(*) FROM public.public_tx_requests
       WHERE user_id = v_uid AND status IN ('open', 'pending_approval') AND from_paycode IS NULL) >= 200 THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'You have 200 unpaid QR bills — cancel some before making more');
  END IF;

  -- Only plain bookkeeping fields are kept; nothing else the browser sends can reach the ledger row.
  SELECT COALESCE(jsonb_object_agg(e.key, e.value), '{}'::JSONB) INTO v_meta
    FROM jsonb_each(COALESCE(p_meta, '{}'::JSONB)) AS e(key, value)
   WHERE e.key = ANY (ARRAY['category', 'categoryName', 'accounting_type', 'reporting_bucket', 'product_name',
                            'product_action', 'ledger_side', 'raw_entry_text', 'entry_mode', 'quantity',
                            'unit_price', 'receipt_ref', 'record_category'])
     AND jsonb_typeof(e.value) IN ('string', 'number')
     AND length(e.value::TEXT) <= 300;

  INSERT INTO public.public_tx_requests (user_id, business_profile_id, amount_ugx, description, meta, approval_required)
  VALUES (v_uid, p_business_profile_id, v_amount, v_desc, v_meta, COALESCE(p_require_approval, TRUE))
  RETURNING * INTO q;

  RETURN jsonb_build_object('success', TRUE, 'request', public._public_tx_request_json(q));
END;
$$;

CREATE OR REPLACE FUNCTION public.public_tx_request_get(p_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  q public.public_tx_requests%ROWTYPE;
BEGIN
  SELECT * INTO q FROM public.public_tx_requests WHERE id = p_id;
  IF NOT FOUND OR NOT public._public_tx_request_can_manage(q) THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Request not found');
  END IF;
  RETURN jsonb_build_object('success', TRUE, 'request', public._public_tx_request_json(q),
    'business_name', (SELECT bp.business_name FROM public.business_profiles bp WHERE bp.id = q.business_profile_id));
END;
$$;

-- The caller's recent QR bills (their own, those of businesses they own or co-own, and any bill
-- waiting for an approval they are allowed to give).
CREATE OR REPLACE FUNCTION public.public_tx_request_list(p_limit INT DEFAULT 20)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(public._public_tx_request_json(x) ORDER BY x.created_at DESC), '[]'::JSONB)
    FROM (
      SELECT q.* FROM public.public_tx_requests q
       WHERE auth.uid() IS NOT NULL
         AND NOT (q.from_paycode IS NOT NULL AND q.status = 'open')
         AND (q.user_id = auth.uid()
              OR q.business_profile_id IN (
                   SELECT bp.id FROM public.business_profiles bp WHERE bp.user_id = auth.uid()
                   UNION
                   SELECT bco.business_profile_id FROM public.business_co_owners bco WHERE bco.user_id = auth.uid())
              OR (q.status = 'pending_approval' AND public._public_tx_request_can_manage(q)))
       ORDER BY q.created_at DESC
       LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100)
    ) x;
$$;

-- The customer handed over cash and the owner is there to take it: record the sale now. (If the
-- customer already claimed cash from their phone, this is the same as approving that claim.)
CREATE OR REPLACE FUNCTION public.public_tx_request_mark_cash(p_id UUID, p_payer_name TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  q public.public_tx_requests%ROWTYPE;
BEGIN
  SELECT * INTO q FROM public.public_tx_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR NOT public._public_tx_request_can_manage(q) THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Request not found');
  END IF;
  IF q.status = 'paid' THEN
    RETURN jsonb_build_object('success', TRUE, 'request', public._public_tx_request_json(q));
  END IF;
  IF q.status = 'pending_approval' THEN
    IF q.pending_via = 'cash' THEN
      RETURN public.public_tx_request_decide(p_id, TRUE, NULL);
    END IF;
    RETURN jsonb_build_object('success', FALSE, 'error', 'A payment is waiting for approval — approve or reject it');
  END IF;
  IF q.status <> 'open' THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'This QR bill was cancelled');
  END IF;
  PERFORM public._public_tx_request_settle(
    q.id, 'cash', COALESCE(NULLIF(btrim(p_payer_name), ''), 'Cash customer'), NULL, q.amount_ugx);
  UPDATE public.public_tx_requests SET decided_by = auth.uid(), decided_at = now() WHERE id = q.id;
  SELECT * INTO q FROM public.public_tx_requests WHERE id = p_id;
  RETURN jsonb_build_object('success', TRUE, 'request', public._public_tx_request_json(q));
END;
$$;

-- The customer says "I paid cash" from the public page (anon). Nothing is recorded: an authorised
-- person is notified, checks they really got the cash, and approves or rejects.
CREATE OR REPLACE FUNCTION public.public_tx_request_claim_cash(
  p_code TEXT, p_payer_name TEXT, p_payer_phone TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  q       public.public_tx_requests%ROWTYPE;
  v_name  TEXT := NULLIF(btrim(COALESCE(p_payer_name, '')), '');
  v_phone TEXT := NULLIF(regexp_replace(COALESCE(p_payer_phone, ''), '[^0-9+]', '', 'g'), '');
BEGIN
  IF p_code IS NULL OR p_code !~ '^[a-z0-9]{16,40}$' THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'This link is not valid');
  END IF;
  IF v_name IS NULL OR char_length(v_name) < 2 OR char_length(v_name) > 80 THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Enter your name');
  END IF;
  IF v_phone IS NOT NULL AND char_length(v_phone) > 16 THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'That phone number is not valid');
  END IF;
  SELECT * INTO q FROM public.public_tx_requests WHERE code = p_code FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'This link is not valid');
  END IF;
  IF q.status = 'paid' THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'This has already been paid — thank you');
  END IF;
  IF q.status = 'pending_approval' THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'A payment on this bill is already waiting for approval');
  END IF;
  IF q.status <> 'open' THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'This payment request was cancelled');
  END IF;
  IF NOT q.approval_required THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Hand the cash to the seller — they will record it');
  END IF;

  UPDATE public.public_tx_requests
     SET status = 'pending_approval', pending_via = 'cash', pending_payer_name = v_name,
         pending_payer_phone = v_phone, pending_at = now()
   WHERE id = q.id;
  PERFORM public._public_tx_notify_approvers(q,
    'Approve payment: UGX ' || to_char(q.amount_ugx, 'FM999,999,999,990'),
    v_name || ' says they paid CASH for "' || left(q.description, 80) || '". Confirm you received it, then approve.');
  RETURN jsonb_build_object('success', TRUE, 'pending_approval', TRUE);
END;
$$;

-- An authorised person approves or rejects the payment waiting on a bill.
--   approve: the money reaches the recipient and the real income entry is written (reports, transactions…).
--   reject : wallet payers get their coins straight back; Mobile Money / card / bank payers are flagged
--            for a Flutterwave refund (refund_required — the public-tx-pay function does it); a cash
--            claim just goes away. The bill reopens, with the reason shown to the customer.
CREATE OR REPLACE FUNCTION public.public_tx_request_decide(p_id UUID, p_approve BOOLEAN, p_note TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid    UUID := auth.uid();
  q        public.public_tx_requests%ROWTYPE;
  p        public.public_tx_payments%ROWTYPE;
  v_price  NUMERIC;
  v_ican   NUMERIC;
  v_note   TEXT;
  v_res    JSONB;
  v_reason TEXT := left(NULLIF(btrim(COALESCE(p_note, '')), ''), 200);
  v_refund BOOLEAN := FALSE;
  v_receipt TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Please sign in');
  END IF;
  SELECT * INTO q FROM public.public_tx_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR NOT public._public_tx_request_can_manage(q) THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Request not found');
  END IF;
  IF q.status = 'paid' AND p_approve THEN
    RETURN jsonb_build_object('success', TRUE, 'request', public._public_tx_request_json(q));
  END IF;
  IF q.status <> 'pending_approval' THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'No payment is waiting for approval on this bill');
  END IF;
  v_receipt := public._public_tx_receipt_no(q.created_at, q.id, NULL);

  IF q.pending_via IN ('wallet', 'guest') THEN
    SELECT * INTO p FROM public.public_tx_payments
     WHERE request_id = q.id AND status = 'held' ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', FALSE, 'error', 'The held payment could not be found — contact support');
    END IF;
  END IF;

  IF p_approve THEN
    BEGIN
      IF q.pending_via = 'cash' THEN
        PERFORM public._public_tx_request_settle(q.id, 'cash', COALESCE(q.pending_payer_name, 'Cash customer'),
                                                 q.pending_payer_phone, q.amount_ugx);
      ELSE
        v_price := public.public_tx_ican_price_ugx();
        -- wallet: the coins were already taken from the payer; guest: real money is being held.
        v_ican  := CASE WHEN q.pending_via = 'wallet' THEN p.ican_amount
                        ELSE GREATEST(ROUND(p.amount_ugx / v_price, 8), 0.00000001) END;
        v_note  := format('Paid by QR — %s | receipt %s | %s', p.payer_name, v_receipt, COALESCE(NULLIF(q.description, ''), 'Payment'));
        IF p.recipient_business_id IS NOT NULL THEN
          PERFORM public.ican_settle_business_wallet_income(
            p.recipient_business_id, v_ican, 'ican', 'PUBTX-' || p.tx_ref, 'pos_sale', v_note,
            jsonb_build_object('receipt_number', v_receipt, 'paid_via', q.pending_via));
        ELSIF q.pending_via = 'wallet' THEN
          PERFORM public._public_tx_credit_user(p.recipient_user_id, v_ican, p.amount_ugx, 'PUBTX-' || p.tx_ref, v_note);
        ELSE
          v_res := public.buy_ican_coins(p.recipient_user_id, v_ican, 'ican', 'PUBTX-' || p.tx_ref);
          IF NOT COALESCE((v_res ->> 'success')::BOOLEAN, FALSE) THEN
            RAISE EXCEPTION '%', COALESCE(v_res ->> 'error', 'Could not credit the wallet');
          END IF;
        END IF;
        PERFORM public._public_tx_request_settle(q.id, q.pending_via, p.payer_name, p.payer_phone, COALESCE(p.paid_ugx, p.amount_ugx));
        UPDATE public.public_tx_payments
           SET status = 'paid', ican_amount = v_ican, paid_at = now(), updated_at = now()
         WHERE id = p.id;
      END IF;
      UPDATE public.public_tx_requests SET decided_by = v_uid, decided_at = now(), last_reject_note = NULL WHERE id = q.id;
    EXCEPTION WHEN OTHERS THEN
      RETURN jsonb_build_object('success', FALSE, 'error', SQLERRM);
    END;
    IF q.pending_via = 'wallet' THEN
      PERFORM public._public_tx_notify(p.payer_user_id, 'qr_payment_decided', 'Payment approved',
        'Your payment of UGX ' || to_char(q.amount_ugx, 'FM999,999,999,990') || ' was approved. Thank you!', NULL, q.id);
    END IF;
    IF q.user_id <> v_uid THEN
      PERFORM public._public_tx_notify(q.user_id, 'qr_payment_decided', 'Payment approved',
        'UGX ' || to_char(q.amount_ugx, 'FM999,999,999,990') || ' for "' || left(q.description, 60) || '" was approved and recorded.', q.business_profile_id, q.id);
    END IF;
  ELSE
    BEGIN
      IF q.pending_via = 'wallet' THEN
        PERFORM public._public_tx_credit_user(p.payer_user_id, p.ican_amount, p.amount_ugx,
                                              'PUBTX-R-' || p.tx_ref, 'Refund — QR payment was not approved');
        UPDATE public.public_tx_payments
           SET status = 'refunded', error = COALESCE(v_reason, 'Not approved'), refund_note = 'Coins returned to the payer', updated_at = now()
         WHERE id = p.id;
      ELSIF q.pending_via = 'guest' THEN
        UPDATE public.public_tx_payments
           SET status = 'failed', error = 'Not approved: ' || COALESCE(v_reason, 'the seller could not confirm this payment'), updated_at = now()
         WHERE id = p.id;
        v_refund := TRUE;
      END IF;
      UPDATE public.public_tx_requests
         SET status = 'open', pending_via = NULL, pending_payer_name = NULL, pending_payer_phone = NULL, pending_at = NULL,
             decided_by = v_uid, decided_at = now(),
             last_reject_note = COALESCE(v_reason, 'The seller could not confirm this payment')
       WHERE id = q.id;
    EXCEPTION WHEN OTHERS THEN
      RETURN jsonb_build_object('success', FALSE, 'error', SQLERRM);
    END;
    IF q.pending_via = 'wallet' THEN
      PERFORM public._public_tx_notify(p.payer_user_id, 'qr_payment_decided', 'Payment not approved',
        'Your payment of UGX ' || to_char(q.amount_ugx, 'FM999,999,999,990') || ' was not approved and your coins were returned.'
        || COALESCE(' Reason: ' || v_reason, ''), NULL, q.id);
    END IF;
  END IF;

  SELECT * INTO q FROM public.public_tx_requests WHERE id = p_id;
  RETURN jsonb_build_object('success', TRUE, 'approved', p_approve, 'refund_required', v_refund,
                            'request', public._public_tx_request_json(q));
END;
$$;

CREATE OR REPLACE FUNCTION public.public_tx_request_cancel(p_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  q public.public_tx_requests%ROWTYPE;
BEGIN
  SELECT * INTO q FROM public.public_tx_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR NOT public._public_tx_request_can_manage(q) THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Request not found');
  END IF;
  IF q.status = 'paid' THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'This has already been paid');
  END IF;
  IF q.status = 'pending_approval' THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'A payment is waiting for approval — approve or reject it first');
  END IF;
  UPDATE public.public_tx_requests SET status = 'cancelled' WHERE id = q.id AND status = 'open';
  SELECT * INTO q FROM public.public_tx_requests WHERE id = p_id;
  RETURN jsonb_build_object('success', TRUE, 'request', public._public_tx_request_json(q));
END;
$$;

REVOKE ALL ON FUNCTION public.public_tx_request_create(NUMERIC, TEXT, UUID, JSONB, BOOLEAN) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.public_tx_request_get(UUID)                          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.public_tx_request_list(INT)                          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.public_tx_request_mark_cash(UUID, TEXT)              FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.public_tx_request_decide(UUID, BOOLEAN, TEXT)        FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.public_tx_request_cancel(UUID)                       FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.public_tx_request_claim_cash(TEXT, TEXT, TEXT)       FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_tx_request_create(NUMERIC, TEXT, UUID, JSONB, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.public_tx_request_get(UUID)                          TO authenticated;
GRANT EXECUTE ON FUNCTION public.public_tx_request_list(INT)                          TO authenticated;
GRANT EXECUTE ON FUNCTION public.public_tx_request_mark_cash(UUID, TEXT)              TO authenticated;
GRANT EXECUTE ON FUNCTION public.public_tx_request_decide(UUID, BOOLEAN, TEXT)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.public_tx_request_cancel(UUID)                       TO authenticated;
GRANT EXECUTE ON FUNCTION public.public_tx_request_claim_cash(TEXT, TEXT, TEXT)       TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- 9b. STANDING PAY QR — the customer enters any amount and lists what they are paying for
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._public_tx_paycode_json(c public.public_tx_paycodes)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'id', c.id, 'code', c.code, 'title', c.title, 'active', c.active,
    'approval_required', c.approval_required, 'max_amount_ugx', c.max_amount_ugx,
    'business_profile_id', c.business_profile_id,
    -- the business's public website page (CMMS company), when it has one: the QR opens THAT page's Pay tab
    'company_id', (SELECT i.company_id FROM public._public_tx_issuer(c.business_profile_id, c.user_id) i));
$$;
REVOKE ALL ON FUNCTION public._public_tx_paycode_json(public.public_tx_paycodes) FROM PUBLIC, anon, authenticated;

-- Owner / cashier: the standing QR of a business (or the personal one when p_business is NULL).
-- Made on first use, the same one afterwards.
CREATE OR REPLACE FUNCTION public.public_tx_paycode_get_or_create(p_business UUID DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid UUID := auth.uid();
  c     public.public_tx_paycodes%ROWTYPE;
  v_title TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Please sign in');
  END IF;
  IF p_business IS NOT NULL AND NOT public._public_tx_business_access(p_business) THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'You cannot make a pay QR for that business');
  END IF;

  IF p_business IS NOT NULL THEN
    SELECT * INTO c FROM public.public_tx_paycodes WHERE business_profile_id = p_business;
  ELSE
    SELECT * INTO c FROM public.public_tx_paycodes WHERE user_id = v_uid AND business_profile_id IS NULL;
  END IF;

  IF c.id IS NULL THEN
    SELECT issuer_name INTO v_title FROM public._public_tx_issuer(p_business, v_uid);
    INSERT INTO public.public_tx_paycodes (user_id, business_profile_id, title)
    VALUES (v_uid, p_business, left(COALESCE(v_title, 'Pay here'), 80))
    ON CONFLICT DO NOTHING
    RETURNING * INTO c;
    IF c.id IS NULL THEN
      IF p_business IS NOT NULL THEN
        SELECT * INTO c FROM public.public_tx_paycodes WHERE business_profile_id = p_business;
      ELSE
        SELECT * INTO c FROM public.public_tx_paycodes WHERE user_id = v_uid AND business_profile_id IS NULL;
      END IF;
    END IF;
  END IF;
  RETURN jsonb_build_object('success', TRUE, 'paycode', public._public_tx_paycode_json(c));
END;
$$;

-- Owner / cashier: switch it off or on, approval on/off, rename, the biggest amount a customer may enter.
CREATE OR REPLACE FUNCTION public.public_tx_paycode_update(
  p_id UUID, p_active BOOLEAN DEFAULT NULL, p_approval BOOLEAN DEFAULT NULL,
  p_title TEXT DEFAULT NULL, p_max NUMERIC DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c public.public_tx_paycodes%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Please sign in');
  END IF;
  SELECT * INTO c FROM public.public_tx_paycodes WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR NOT (c.user_id = auth.uid() OR public._public_tx_business_access(c.business_profile_id)) THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Pay QR not found');
  END IF;
  IF p_max IS NOT NULL AND (p_max < 100 OR p_max > 50000000) THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'The biggest amount must be between UGX 100 and UGX 50,000,000');
  END IF;
  UPDATE public.public_tx_paycodes
     SET active = COALESCE(p_active, active),
         approval_required = COALESCE(p_approval, approval_required),
         title = COALESCE(left(NULLIF(btrim(p_title), ''), 80), title),
         max_amount_ugx = COALESCE(CEIL(p_max), max_amount_ugx),
         updated_at = now()
   WHERE id = c.id
   RETURNING * INTO c;
  RETURN jsonb_build_object('success', TRUE, 'paycode', public._public_tx_paycode_json(c));
END;
$$;

-- Anyone: what the standing QR says before the customer types anything.
CREATE OR REPLACE FUNCTION public.public_tx_paycode_info(p_code TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c     public.public_tx_paycodes%ROWTYPE;
  v_iss RECORD;
BEGIN
  IF p_code IS NULL OR p_code !~ '^[a-z0-9]{16,40}$' THEN
    RETURN jsonb_build_object('found', FALSE);
  END IF;
  SELECT * INTO c FROM public.public_tx_paycodes WHERE code = p_code;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', FALSE);
  END IF;
  SELECT * INTO v_iss FROM public._public_tx_issuer(c.business_profile_id, c.user_id);
  RETURN jsonb_build_object(
    'found', TRUE, 'active', c.active, 'title', c.title, 'code', c.code,
    'issuer_name', v_iss.issuer_name, 'issuer_kind', v_iss.issuer_kind, 'company_id', v_iss.company_id,
    'approval_required', c.approval_required, 'max_amount_ugx', c.max_amount_ugx);
END;
$$;

-- Anyone: does this business take "pay any amount" payments? The business website (/notices/<company>)
-- asks this to decide whether to show its Pay tab. Same answer as public_tx_paycode_info, found by business.
CREATE OR REPLACE FUNCTION public.public_tx_paycode_info_by_business(p_business UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_code TEXT;
BEGIN
  IF p_business IS NULL THEN
    RETURN jsonb_build_object('found', FALSE);
  END IF;
  SELECT code INTO v_code FROM public.public_tx_paycodes WHERE business_profile_id = p_business;
  IF v_code IS NULL THEN
    RETURN jsonb_build_object('found', FALSE);
  END IF;
  RETURN public.public_tx_paycode_info(v_code);
END;
$$;

-- Anyone: the customer lists what they are paying for ([{name, price, qty}]) and gets a QR bill back.
-- The bill is then paid on /r/<code> — wallet, Mobile Money / card / bank, or cash — and approved by
-- an authorised person like any other QR bill. The price is whatever the customer says it is; the
-- seller still confirms every payment, which is the check.
CREATE OR REPLACE FUNCTION public.public_tx_paycode_bill(p_code TEXT, p_items JSONB, p_name TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c        public.public_tx_paycodes%ROWTYPE;
  v_name   TEXT := NULLIF(btrim(COALESCE(p_name, '')), '');
  v_item   JSONB;
  v_ord    BIGINT;
  v_n      TEXT;
  v_price  NUMERIC;
  v_qty    NUMERIC;
  v_total  NUMERIC := 0;
  v_clean  JSONB := '[]'::JSONB;
  v_parts  TEXT[] := ARRAY[]::TEXT[];
  v_desc   TEXT;
  v_meta   JSONB;
  v_count  INT;
  q        public.public_tx_requests%ROWTYPE;
BEGIN
  IF p_code IS NULL OR p_code !~ '^[a-z0-9]{16,40}$' THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'This pay link is not valid');
  END IF;
  SELECT * INTO c FROM public.public_tx_paycodes WHERE code = p_code;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'This pay link is not valid');
  END IF;
  IF NOT c.active THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'This pay QR has been switched off by its owner');
  END IF;
  IF v_name IS NULL OR char_length(v_name) < 2 OR char_length(v_name) > 80 THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Enter your name');
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Add what you are paying for and its price');
  END IF;
  IF jsonb_array_length(p_items) > 20 THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Please list at most 20 items');
  END IF;

  FOR v_item, v_ord IN SELECT value, ordinality FROM jsonb_array_elements(p_items) WITH ORDINALITY LOOP
    v_n := left(btrim(COALESCE(v_item ->> 'name', '')), 80);
    BEGIN
      v_price := (v_item ->> 'price')::NUMERIC;
      v_qty   := COALESCE(NULLIF(v_item ->> 'qty', '')::NUMERIC, 1);
    EXCEPTION WHEN OTHERS THEN
      RETURN jsonb_build_object('success', FALSE, 'error', format('Check the price of item %s', v_ord));
    END;
    IF v_price IS NULL OR v_price <= 0 OR v_price > 50000000 THEN
      RETURN jsonb_build_object('success', FALSE, 'error', format('Enter a price for item %s', v_ord));
    END IF;
    IF v_qty < 1 OR v_qty > 10000 OR v_qty <> trunc(v_qty) THEN
      RETURN jsonb_build_object('success', FALSE, 'error', format('Check the quantity of item %s', v_ord));
    END IF;
    IF v_n = '' THEN
      v_n := CASE WHEN jsonb_array_length(p_items) = 1 THEN 'Payment' ELSE 'Item ' || v_ord END;
    END IF;
    v_total := v_total + v_price * v_qty;
    v_clean := v_clean || jsonb_build_array(jsonb_build_object('name', v_n, 'price', v_price, 'qty', v_qty));
    v_parts := v_parts || (v_n || CASE WHEN v_qty > 1 THEN ' ×' || v_qty::INT::TEXT ELSE '' END);
  END LOOP;

  v_total := CEIL(v_total);
  IF v_total < 100 THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'The total must be at least UGX 100');
  END IF;
  IF v_total > c.max_amount_ugx THEN
    RETURN jsonb_build_object('success', FALSE, 'error',
      'The most this QR accepts is UGX ' || to_char(c.max_amount_ugx, 'FM999,999,999,990'));
  END IF;

  -- Stop one QR being flooded with drafts, and tidy up drafts nobody paid.
  DELETE FROM public.public_tx_requests rq
   WHERE rq.from_paycode = c.id AND rq.status = 'open' AND rq.created_at < now() - INTERVAL '3 days'
     AND NOT EXISTS (SELECT 1 FROM public.public_tx_payments pp WHERE pp.request_id = rq.id);
  SELECT count(*) INTO v_count FROM public.public_tx_requests
   WHERE from_paycode = c.id AND created_at > now() - INTERVAL '1 hour';
  IF v_count >= 60 THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Too many payments started on this QR just now — please try again in a few minutes');
  END IF;

  v_desc := left(array_to_string(v_parts, ', '), 200);
  -- What the sale is, for the books: a sale (business) the same way the entry form's "Sold" tab records it.
  v_meta := jsonb_build_object('category', 'sales', 'categoryName', 'Sales',
                               'raw_entry_text', v_desc, 'entry_mode', 'qr_paycode',
                               'record_category', CASE WHEN c.business_profile_id IS NOT NULL THEN 'business' ELSE 'personal' END);
  IF c.business_profile_id IS NOT NULL THEN
    v_meta := v_meta || jsonb_build_object('accounting_type', 'revenue');
  END IF;

  INSERT INTO public.public_tx_requests
    (user_id, business_profile_id, amount_ugx, description, meta, approval_required, items, from_paycode, customer_name)
  VALUES
    (c.user_id, c.business_profile_id, v_total, v_desc, v_meta, c.approval_required, v_clean, c.id, v_name)
  RETURNING * INTO q;

  RETURN jsonb_build_object('success', TRUE, 'code', q.code, 'amount_ugx', v_total);
END;
$$;

REVOKE ALL ON FUNCTION public.public_tx_paycode_get_or_create(UUID)                            FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.public_tx_paycode_update(UUID, BOOLEAN, BOOLEAN, TEXT, NUMERIC) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.public_tx_paycode_info(TEXT)                                     FROM PUBLIC;
REVOKE ALL ON FUNCTION public.public_tx_paycode_info_by_business(UUID)                         FROM PUBLIC;
REVOKE ALL ON FUNCTION public.public_tx_paycode_bill(TEXT, JSONB, TEXT)                        FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_tx_paycode_get_or_create(UUID)                            TO authenticated;
GRANT EXECUTE ON FUNCTION public.public_tx_paycode_update(UUID, BOOLEAN, BOOLEAN, TEXT, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION public.public_tx_paycode_info(TEXT)                                     TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_tx_paycode_info_by_business(UUID)                         TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_tx_paycode_bill(TEXT, JSONB, TEXT)                        TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- 10. Changes to the two BUSY tables — done last so their locks are held for the shortest time
-- ----------------------------------------------------------------------------
-- The ledger: the public code, the payment status, and the guard that stops a direct UPDATE changing them.
ALTER TABLE public.ican_transactions
  ADD COLUMN IF NOT EXISTS public_code       TEXT,
  ADD COLUMN IF NOT EXISTS public_pay_status TEXT NOT NULL DEFAULT 'off',
  ADD COLUMN IF NOT EXISTS public_paid_at    TIMESTAMPTZ;

-- Every NEW entry gets its code at insert time (existing rows are filled in lazily).
ALTER TABLE public.ican_transactions
  ALTER COLUMN public_code SET DEFAULT public.fn_new_public_tx_code();

CREATE UNIQUE INDEX IF NOT EXISTS ican_transactions_public_code_key
  ON public.ican_transactions (public_code);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ican_transactions_public_pay_status_check') THEN
    ALTER TABLE public.ican_transactions
      ADD CONSTRAINT ican_transactions_public_pay_status_check
      CHECK (public_pay_status IN ('off', 'open', 'paid', 'closed'));
  END IF;
END $$;

-- The ledger's own RLS lets an owner UPDATE their rows. These three columns decide where money
-- goes and whether something counts as paid, so a direct UPDATE may not touch them: only the
-- functions below (which raise app.public_tx_write for the duration of their own statement) can.
CREATE OR REPLACE FUNCTION public.fn_guard_public_tx_fields()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('app.public_tx_write', TRUE) = 'on' THEN
    RETURN NEW;
  END IF;
  NEW.public_code       := OLD.public_code;
  NEW.public_pay_status := OLD.public_pay_status;
  NEW.public_paid_at    := OLD.public_paid_at;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_public_tx_fields ON public.ican_transactions;
CREATE TRIGGER trg_guard_public_tx_fields
  BEFORE UPDATE ON public.ican_transactions
  FOR EACH ROW EXECUTE FUNCTION public.fn_guard_public_tx_fields();

-- The shared wallet inbox (ICAN_CROSS_APP_WALLET_NOTIFICATIONS.sql, already pushed to phones by the
-- wallet-push relay) only accepted rows tied to a coin / business-wallet transaction. "A QR payment
-- needs your approval" is not tied to one yet, so qr_* messages are allowed too. Skipped when the
-- inbox is not installed.
DO $$
DECLARE
  c RECORD;
BEGIN
  IF to_regclass('public.ican_wallet_inbox_notifications') IS NULL THEN
    RETURN;
  END IF;
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.ican_wallet_inbox_notifications'::regclass AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%coin_transaction_id IS NOT NULL%'
       AND pg_get_constraintdef(oid) NOT LIKE '%qr\_%'
  LOOP
    EXECUTE format('ALTER TABLE public.ican_wallet_inbox_notifications DROP CONSTRAINT %I', c.conname);
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ican_wallet_inbox_has_source_or_qr') THEN
    ALTER TABLE public.ican_wallet_inbox_notifications
      ADD CONSTRAINT ican_wallet_inbox_has_source_or_qr
      CHECK (coin_transaction_id IS NOT NULL OR business_wallet_transaction_id IS NOT NULL
             OR notification_type LIKE 'qr\_%' OR notification_type LIKE 'franchise\_%');
  END IF;
END $$;

RESET lock_timeout;

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '✅ Every recorded transaction has a public QR (/r/<code>). The QR Pay tab bills by QR: customers pay with cash, IcanEra wallet, Mobile Money, card or bank, and an authorised person approves each payment from a notification. Last step: deploy the public-tx-pay Edge Function.';
END $$;
