-- ===========================================================================
-- ICAN DIGITAL CARD + SCAN-TO-REQUEST QR
--
-- Every wallet owner gets one digital card (shown in Wallet -> Cards) with a
-- QR code. Anyone can scan that QR -- no account needed -- and ask the card
-- owner to send them money to their mobile money number. NOTHING MOVES until
-- the owner opens the request in their wallet and confirms with their
-- transaction PIN; the payout itself then goes through the existing
-- flutterwave-momo-send Edge Function (wallet debit + refund-on-failure stay
-- exactly where they already live).
--
-- The card number here is an ICAN-issued number for the app. It is NOT a
-- card-network (Visa) number and cannot be used at card terminals.
--
-- Safe to run multiple times.
-- ===========================================================================

-- ─── 1. Cards ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.ican_digital_cards (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  card_number  TEXT NOT NULL UNIQUE CHECK (card_number ~ '^[0-9]{16}$'),
  holder_name  TEXT NOT NULL,
  expiry_month INT  NOT NULL CHECK (expiry_month BETWEEN 1 AND 12),
  expiry_year  INT  NOT NULL,
  qr_token     TEXT NOT NULL UNIQUE,
  qr_enabled   BOOLEAN NOT NULL DEFAULT true,
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'frozen')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.ican_digital_cards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "digital_card_owner_read" ON public.ican_digital_cards;
CREATE POLICY "digital_card_owner_read" ON public.ican_digital_cards
  FOR SELECT USING (user_id = auth.uid());
-- No client INSERT/UPDATE/DELETE: everything goes through the RPCs below.

-- ─── 2. QR requests ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.ican_card_qr_requests (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id          UUID NOT NULL REFERENCES public.ican_digital_cards(id) ON DELETE CASCADE,
  owner_user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  requester_name   TEXT NOT NULL,
  recipient_phone  TEXT NOT NULL,
  recipient_network TEXT NOT NULL CHECK (recipient_network IN ('MTN', 'AIRTEL')),
  amount           NUMERIC(15, 2) NOT NULL CHECK (amount > 0),
  currency         TEXT NOT NULL DEFAULT 'UGX',
  note             TEXT,
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN
                     ('pending', 'processing', 'completed', 'declined', 'failed', 'expired')),
  fiat_reference   TEXT,
  failure_reason   TEXT,
  expires_at       TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '24 hours'),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_card_qr_req_owner ON public.ican_card_qr_requests(owner_user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_card_qr_req_card  ON public.ican_card_qr_requests(card_id, status);

ALTER TABLE public.ican_card_qr_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "card_qr_req_owner_read" ON public.ican_card_qr_requests;
CREATE POLICY "card_qr_req_owner_read" ON public.ican_card_qr_requests
  FOR SELECT USING (owner_user_id = auth.uid());

-- ─── 3. Owner RPCs ─────────────────────────────────────────────────────────

-- Returns the caller's card, creating it on first use.
CREATE OR REPLACE FUNCTION public.get_or_create_my_digital_card()
RETURNS public.ican_digital_cards
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid  UUID := auth.uid();
  v_card public.ican_digital_cards;
  v_name TEXT;
  v_num  TEXT;
  v_try  INT := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;

  SELECT * INTO v_card FROM public.ican_digital_cards WHERE user_id = v_uid;
  IF FOUND THEN RETURN v_card; END IF;

  SELECT upper(coalesce(raw_user_meta_data->>'full_name', raw_user_meta_data->>'name', split_part(email, '@', 1), 'ICAN MEMBER'))
    INTO v_name FROM auth.users WHERE id = v_uid;

  LOOP
    v_try := v_try + 1;
    -- 16 digits starting with 9 (outside every Visa/Mastercard range).
    v_num := '9' ||lpad((floor(random() * 1e15))::bigint::text, 15, '0');
    BEGIN
      INSERT INTO public.ican_digital_cards (user_id, card_number, holder_name, expiry_month, expiry_year, qr_token)
      VALUES (v_uid, v_num, left(coalesce(v_name, 'ICAN MEMBER'), 26),
              extract(month from now())::int, extract(year from now())::int + 4,
              replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))
      RETURNING * INTO v_card;
      RETURN v_card;
    EXCEPTION WHEN unique_violation THEN
      -- A concurrent call may have created this user's card.
      SELECT * INTO v_card FROM public.ican_digital_cards WHERE user_id = v_uid;
      IF FOUND THEN RETURN v_card; END IF;
      IF v_try >= 5 THEN RAISE; END IF;
    END;
  END LOOP;
END $$;

-- New QR token: old printed/shared QR codes stop working immediately.
CREATE OR REPLACE FUNCTION public.rotate_my_card_qr()
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_tok TEXT := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
BEGIN
  UPDATE public.ican_digital_cards SET qr_token = v_tok WHERE user_id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'No card'; END IF;
  UPDATE public.ican_card_qr_requests SET status = 'expired', resolved_at = now()
   WHERE owner_user_id = auth.uid() AND status = 'pending';
  RETURN v_tok;
END $$;

CREATE OR REPLACE FUNCTION public.set_my_card_qr_enabled(p_enabled BOOLEAN)
RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.ican_digital_cards SET qr_enabled = p_enabled WHERE user_id = auth.uid();
$$;

-- Claim a pending request for payout (pending -> processing), atomically, so
-- a double tap / two devices can never pay it twice.
CREATE OR REPLACE FUNCTION public.claim_card_qr_request(p_request_id UUID)
RETURNS public.ican_card_qr_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row public.ican_card_qr_requests;
BEGIN
  UPDATE public.ican_card_qr_requests
     SET status = 'processing'
   WHERE id = p_request_id AND owner_user_id = auth.uid()
     AND status = 'pending' AND expires_at > now()
  RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'This request is no longer available'; END IF;
  RETURN v_row;
END $$;

-- After the payout attempt: ok => completed, otherwise failed (nothing was
-- debited when the Edge Function call itself failed).
CREATE OR REPLACE FUNCTION public.finish_card_qr_request(p_request_id UUID, p_ok BOOLEAN, p_reference TEXT, p_reason TEXT)
RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.ican_card_qr_requests
     SET status = CASE WHEN p_ok THEN 'completed' ELSE 'failed' END,
         fiat_reference = p_reference, failure_reason = left(p_reason, 300), resolved_at = now()
   WHERE id = p_request_id AND owner_user_id = auth.uid() AND status = 'processing';
$$;

CREATE OR REPLACE FUNCTION public.decline_card_qr_request(p_request_id UUID)
RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.ican_card_qr_requests SET status = 'declined', resolved_at = now()
   WHERE id = p_request_id AND owner_user_id = auth.uid() AND status = 'pending';
$$;

-- ─── 4. Public (scanner) RPCs -- callable without an account ───────────────

-- What the scan page may show: first name + last 4 only.
CREATE OR REPLACE FUNCTION public.get_card_qr_info(p_token TEXT)
RETURNS TABLE (holder_first_name TEXT, last4 TEXT)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT initcap(split_part(holder_name, ' ', 1)), right(card_number, 4)
    FROM public.ican_digital_cards
   WHERE qr_token = p_token AND qr_enabled AND status = 'active';
$$;

CREATE OR REPLACE FUNCTION public.submit_card_qr_request(
  p_token TEXT, p_name TEXT, p_phone TEXT, p_network TEXT, p_amount NUMERIC, p_note TEXT
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_card public.ican_digital_cards;
  v_phone TEXT := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  v_id UUID;
BEGIN
  SELECT * INTO v_card FROM public.ican_digital_cards
   WHERE qr_token = p_token AND qr_enabled AND status = 'active';
  IF NOT FOUND THEN RAISE EXCEPTION 'This QR code is not active'; END IF;

  IF length(trim(coalesce(p_name, ''))) < 2 THEN RAISE EXCEPTION 'Enter your name'; END IF;
  IF p_network NOT IN ('MTN', 'AIRTEL') THEN RAISE EXCEPTION 'Choose MTN or Airtel'; END IF;
  IF v_phone !~ '^(256[0-9]{9}|0[0-9]{9})$' THEN RAISE EXCEPTION 'Enter a valid Uganda mobile number'; END IF;
  IF p_amount IS NULL OR p_amount < 1000 OR p_amount > 5000000 THEN
    RAISE EXCEPTION 'Amount must be between 1,000 and 5,000,000 UGX';
  END IF;

  -- Stops the owner's inbox being flooded by anonymous scanners.
  IF (SELECT count(*) FROM public.ican_card_qr_requests
       WHERE card_id = v_card.id AND status = 'pending' AND expires_at > now()) >= 10 THEN
    RAISE EXCEPTION 'This card has too many open requests. Try again later.';
  END IF;

  INSERT INTO public.ican_card_qr_requests
    (card_id, owner_user_id, requester_name, recipient_phone, recipient_network, amount, note)
  VALUES (v_card.id, v_card.user_id, left(trim(p_name), 60), v_phone, p_network, p_amount, left(p_note, 140))
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- ─── 5. Grants ─────────────────────────────────────────────────────────────

REVOKE ALL ON FUNCTION public.get_or_create_my_digital_card() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rotate_my_card_qr() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_my_card_qr_enabled(BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_card_qr_request(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finish_card_qr_request(UUID, BOOLEAN, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.decline_card_qr_request(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_or_create_my_digital_card() TO authenticated;
GRANT EXECUTE ON FUNCTION public.rotate_my_card_qr() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_my_card_qr_enabled(BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_card_qr_request(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finish_card_qr_request(UUID, BOOLEAN, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.decline_card_qr_request(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_card_qr_info(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_card_qr_request(TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT) TO anon, authenticated;
