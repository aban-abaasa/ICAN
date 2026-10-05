-- Rollback for supabase/migrations/20261008100000_business_digital_cards.sql
-- Removes business cards and their requests (the data is lost) and puts the two public
-- scan RPCs back to their personal-card-only versions from backend/ICAN_DIGITAL_CARD_QR.sql.

CREATE OR REPLACE FUNCTION public.get_card_qr_info(p_token TEXT)
RETURNS TABLE (holder_first_name TEXT, last4 TEXT, pin_pay_enabled BOOLEAN)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT initcap(split_part(holder_name, ' ', 1)), right(card_number, 4), pin_pay_enabled
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

DROP FUNCTION IF EXISTS public.get_or_create_business_digital_card(UUID);
DROP FUNCTION IF EXISTS public.rotate_business_card_qr(UUID);
DROP FUNCTION IF EXISTS public.set_business_card_qr_enabled(UUID, BOOLEAN);
DROP FUNCTION IF EXISTS public.approve_business_card_qr_request(UUID, TEXT);
DROP FUNCTION IF EXISTS public.decline_business_card_qr_request(UUID);
DROP TABLE IF EXISTS public.ican_business_card_qr_requests;
DROP TABLE IF EXISTS public.ican_business_digital_cards;

NOTIFY pgrst, 'reload schema';
