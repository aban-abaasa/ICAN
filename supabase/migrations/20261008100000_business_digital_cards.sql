-- ============================================================================
-- BUSINESS DIGITAL CARDS: every business profile gets the same IcanEra digital
-- card a personal wallet has (card face, scan-to-request QR, print, QR on/off,
-- new QR) and an inbox of the requests scanners leave on it.
--
-- Needs: backend/ICAN_DIGITAL_CARD_QR.sql, backend/PITCHIN_BUSINESS_PROFILE_ICAN_WALLET.sql,
--        backend/ICAN_BUSINESS_WALLET_TRANSFERS.sql, backend/UNIFIED_BUSINESS_WALLET_OPERATIONS.sql
--        and backend/BUSINESS_WALLET_PIN_VERIFY.sql. Additive; safe to run twice.
--
-- What a business card does NOT do (on purpose):
--   * It is not a Visa/Mastercard network card, same as the personal card.
--   * Nothing is paid out. A business's money is ICAN coin governed by the business-wallet
--     PIN and the shareholder approval threshold, so there is no PIN-at-scan payout here.
--     "Approving" a request only records that an authorised member accepted it; settling it
--     stays a normal, governed business-wallet transfer.
--   * Business cards live in their OWN tables. The personal tables, the personal RPCs and the
--     card-pay-with-pin Edge Function never see them: a business QR token simply is not found
--     there, so it can never debit anyone's personal wallet.
--
-- Rollback: supabase/rollback/20261008_rollback_business_digital_cards.sql
-- ============================================================================

DO $$ BEGIN
  IF to_regclass('public.ican_digital_cards') IS NULL OR to_regclass('public.ican_card_qr_requests') IS NULL THEN
    RAISE EXCEPTION 'Apply backend/ICAN_DIGITAL_CARD_QR.sql first.';
  END IF;
  IF to_regprocedure('public.ican_business_operation_access(uuid)') IS NULL
     OR to_regprocedure('public.pitchin_business_shareholder_access(uuid)') IS NULL
     OR to_regprocedure('public.verify_pitchin_business_wallet_pin(uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'Apply the business-wallet SQL (see the header of this file) first.';
  END IF;
END $$;

-- ─── 1. Cards ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.ican_business_digital_cards (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_profile_id UUID NOT NULL UNIQUE REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  card_number         TEXT NOT NULL UNIQUE CHECK (card_number ~ '^[0-9]{16}$'),
  holder_name         TEXT NOT NULL,
  expiry_month        INT  NOT NULL CHECK (expiry_month BETWEEN 1 AND 12),
  expiry_year         INT  NOT NULL,
  qr_token            TEXT NOT NULL UNIQUE,
  qr_enabled          BOOLEAN NOT NULL DEFAULT true,
  status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'frozen')),
  created_by          UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.ican_business_digital_cards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "business_card_member_read" ON public.ican_business_digital_cards;
CREATE POLICY "business_card_member_read" ON public.ican_business_digital_cards
  FOR SELECT USING (public.ican_business_operation_access(business_profile_id));
-- No client INSERT/UPDATE/DELETE: everything goes through the RPCs below.

-- ─── 2. QR requests ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.ican_business_card_qr_requests (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id             UUID NOT NULL REFERENCES public.ican_business_digital_cards(id) ON DELETE CASCADE,
  business_profile_id UUID NOT NULL REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  requester_name      TEXT NOT NULL,
  recipient_phone     TEXT NOT NULL,
  recipient_network   TEXT NOT NULL CHECK (recipient_network IN ('MTN', 'AIRTEL')),
  amount              NUMERIC(15, 2) NOT NULL CHECK (amount > 0),
  currency            TEXT NOT NULL DEFAULT 'UGX',
  note                TEXT,
  status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined', 'expired')),
  resolved_by         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  expires_at          TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '24 hours'),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_biz_card_qr_req_business ON public.ican_business_card_qr_requests(business_profile_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_biz_card_qr_req_card     ON public.ican_business_card_qr_requests(card_id, status);

ALTER TABLE public.ican_business_card_qr_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "business_card_req_member_read" ON public.ican_business_card_qr_requests;
CREATE POLICY "business_card_req_member_read" ON public.ican_business_card_qr_requests
  FOR SELECT USING (public.ican_business_operation_access(business_profile_id));

-- ─── 3. Member RPCs ────────────────────────────────────────────────────────

-- Returns the business's card, creating it on first use.
CREATE OR REPLACE FUNCTION public.get_or_create_business_digital_card(p_business_profile_id UUID)
RETURNS public.ican_business_digital_cards
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid  UUID := auth.uid();
  v_card public.ican_business_digital_cards;
  v_name TEXT;
  v_num  TEXT;
  v_try  INT := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF NOT public.ican_business_operation_access(p_business_profile_id) THEN
    RAISE EXCEPTION 'Business access required';
  END IF;

  SELECT * INTO v_card FROM public.ican_business_digital_cards WHERE business_profile_id = p_business_profile_id;
  IF FOUND THEN RETURN v_card; END IF;

  SELECT upper(coalesce(nullif(trim(business_name), ''), 'ICAN BUSINESS'))
    INTO v_name FROM public.business_profiles WHERE id = p_business_profile_id;

  LOOP
    v_try := v_try + 1;
    -- 16 digits starting with 8: outside every Visa/Mastercard range and apart from personal cards (9...).
    v_num := '8' || lpad((floor(random() * 1e15))::bigint::text, 15, '0');
    BEGIN
      INSERT INTO public.ican_business_digital_cards
        (business_profile_id, card_number, holder_name, expiry_month, expiry_year, qr_token, created_by)
      VALUES (p_business_profile_id, v_num, left(coalesce(v_name, 'ICAN BUSINESS'), 26),
              extract(month from now())::int, extract(year from now())::int + 4,
              replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
              v_uid)
      RETURNING * INTO v_card;
      RETURN v_card;
    EXCEPTION WHEN unique_violation THEN
      -- A concurrent call may have created this business's card.
      SELECT * INTO v_card FROM public.ican_business_digital_cards WHERE business_profile_id = p_business_profile_id;
      IF FOUND THEN RETURN v_card; END IF;
      IF v_try >= 5 THEN RAISE; END IF;
    END;
  END LOOP;
END $$;

-- New QR token: old printed/shared QR codes stop working immediately.
CREATE OR REPLACE FUNCTION public.rotate_business_card_qr(p_business_profile_id UUID)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_tok TEXT := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
BEGIN
  IF NOT public.ican_business_operation_access(p_business_profile_id) THEN
    RAISE EXCEPTION 'Business access required';
  END IF;
  UPDATE public.ican_business_digital_cards SET qr_token = v_tok WHERE business_profile_id = p_business_profile_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'No card'; END IF;
  UPDATE public.ican_business_card_qr_requests SET status = 'expired', resolved_at = now()
   WHERE business_profile_id = p_business_profile_id AND status = 'pending';
  RETURN v_tok;
END $$;

CREATE OR REPLACE FUNCTION public.set_business_card_qr_enabled(p_business_profile_id UUID, p_enabled BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.ican_business_operation_access(p_business_profile_id) THEN
    RAISE EXCEPTION 'Business access required';
  END IF;
  UPDATE public.ican_business_digital_cards SET qr_enabled = p_enabled WHERE business_profile_id = p_business_profile_id;
END $$;

-- Approve a request. Owners / co-owners only, and only with the business-wallet PIN, which
-- is checked here by the same function (and the same 5-tries / 15-minute lock) the wallet
-- uses everywhere. Wrong PINs come back as JSON, not an exception, so the failed attempt
-- is still counted. Nothing is paid out: this records the decision.
CREATE OR REPLACE FUNCTION public.approve_business_card_qr_request(p_request_id UUID, p_pin TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_req public.ican_business_card_qr_requests;
  v_pin JSONB;
BEGIN
  SELECT * INTO v_req FROM public.ican_business_card_qr_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND OR NOT public.pitchin_business_shareholder_access(v_req.business_profile_id) THEN
    RETURN jsonb_build_object('success', false, 'message', 'You cannot approve this request.');
  END IF;
  IF v_req.status <> 'pending' OR v_req.expires_at <= now() THEN
    RETURN jsonb_build_object('success', false, 'message', 'This request is no longer available.');
  END IF;

  v_pin := public.verify_pitchin_business_wallet_pin(v_req.business_profile_id, p_pin);
  IF NOT coalesce((v_pin->>'success')::boolean, false) THEN
    RETURN jsonb_build_object('success', false, 'message', coalesce(v_pin->>'message', 'Incorrect PIN'));
  END IF;

  UPDATE public.ican_business_card_qr_requests
     SET status = 'approved', resolved_by = auth.uid(), resolved_at = now()
   WHERE id = p_request_id;
  RETURN jsonb_build_object('success', true, 'message', 'Request approved.');
END $$;

CREATE OR REPLACE FUNCTION public.decline_business_card_qr_request(p_request_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_biz UUID;
BEGIN
  SELECT business_profile_id INTO v_biz FROM public.ican_business_card_qr_requests WHERE id = p_request_id;
  IF v_biz IS NULL OR NOT public.ican_business_operation_access(v_biz) THEN
    RAISE EXCEPTION 'Business access required';
  END IF;
  UPDATE public.ican_business_card_qr_requests
     SET status = 'declined', resolved_by = auth.uid(), resolved_at = now()
   WHERE id = p_request_id AND status = 'pending';
END $$;

-- ─── 4. Public (scanner) RPCs: now answer for business cards too ───────────

-- A personal token is looked up first and behaves exactly as before. A business token
-- shows the business name and ALWAYS reports pin_pay_enabled = false, so the scan page
-- only offers "send a request".
CREATE OR REPLACE FUNCTION public.get_card_qr_info(p_token TEXT)
RETURNS TABLE (holder_first_name TEXT, last4 TEXT, pin_pay_enabled BOOLEAN)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT initcap(split_part(holder_name, ' ', 1)), right(card_number, 4), pin_pay_enabled
    FROM public.ican_digital_cards
   WHERE qr_token = p_token AND qr_enabled AND status = 'active'
  UNION ALL
  SELECT initcap(holder_name), right(card_number, 4), false
    FROM public.ican_business_digital_cards
   WHERE qr_token = p_token AND qr_enabled AND status = 'active';
$$;

CREATE OR REPLACE FUNCTION public.submit_card_qr_request(
  p_token TEXT, p_name TEXT, p_phone TEXT, p_network TEXT, p_amount NUMERIC, p_note TEXT
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_card  public.ican_digital_cards;
  v_bcard public.ican_business_digital_cards;
  v_phone TEXT := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  v_id UUID;
BEGIN
  SELECT * INTO v_card FROM public.ican_digital_cards
   WHERE qr_token = p_token AND qr_enabled AND status = 'active';
  IF NOT FOUND THEN
    SELECT * INTO v_bcard FROM public.ican_business_digital_cards
     WHERE qr_token = p_token AND qr_enabled AND status = 'active';
    IF NOT FOUND THEN RAISE EXCEPTION 'This QR code is not active'; END IF;
  END IF;

  IF length(trim(coalesce(p_name, ''))) < 2 THEN RAISE EXCEPTION 'Enter your name'; END IF;
  IF p_network NOT IN ('MTN', 'AIRTEL') THEN RAISE EXCEPTION 'Choose MTN or Airtel'; END IF;
  IF v_phone !~ '^(256[0-9]{9}|0[0-9]{9})$' THEN RAISE EXCEPTION 'Enter a valid Uganda mobile number'; END IF;
  IF p_amount IS NULL OR p_amount < 1000 OR p_amount > 5000000 THEN
    RAISE EXCEPTION 'Amount must be between 1,000 and 5,000,000 UGX';
  END IF;

  IF v_card.id IS NOT NULL THEN
    -- Stops the owner's inbox being flooded by anonymous scanners.
    IF (SELECT count(*) FROM public.ican_card_qr_requests
         WHERE card_id = v_card.id AND status = 'pending' AND expires_at > now()) >= 10 THEN
      RAISE EXCEPTION 'This card has too many open requests. Try again later.';
    END IF;
    INSERT INTO public.ican_card_qr_requests
      (card_id, owner_user_id, requester_name, recipient_phone, recipient_network, amount, note)
    VALUES (v_card.id, v_card.user_id, left(trim(p_name), 60), v_phone, p_network, p_amount, left(p_note, 140))
    RETURNING id INTO v_id;
  ELSE
    IF (SELECT count(*) FROM public.ican_business_card_qr_requests
         WHERE card_id = v_bcard.id AND status = 'pending' AND expires_at > now()) >= 10 THEN
      RAISE EXCEPTION 'This card has too many open requests. Try again later.';
    END IF;
    INSERT INTO public.ican_business_card_qr_requests
      (card_id, business_profile_id, requester_name, recipient_phone, recipient_network, amount, note)
    VALUES (v_bcard.id, v_bcard.business_profile_id, left(trim(p_name), 60), v_phone, p_network, p_amount, left(p_note, 140))
    RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END $$;

-- ─── 5. Grants ─────────────────────────────────────────────────────────────
-- Supabase grants new functions to anon explicitly, so FROM PUBLIC alone would leave the member RPCs open.

REVOKE ALL ON FUNCTION public.get_or_create_business_digital_card(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rotate_business_card_qr(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_business_card_qr_enabled(UUID, BOOLEAN) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.approve_business_card_qr_request(UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.decline_business_card_qr_request(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_or_create_business_digital_card(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rotate_business_card_qr(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_business_card_qr_enabled(UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_business_card_qr_request(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.decline_business_card_qr_request(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_card_qr_info(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_card_qr_request(TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
