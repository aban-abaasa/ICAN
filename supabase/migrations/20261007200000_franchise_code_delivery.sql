-- ============================================================================
-- FRANCHISE CODE DELIVERY: the partner's code arrives in their IcanEra Support chat
--
-- Every franchise partner already has a partner_code (e.g. UG-AG-K7M2P). It is what customers type
-- under Franchise > My agency to join that agency, so a partner who never sees it cannot earn. This
-- delivers it, clearly, to the partner's own account:
--
--   AUTOMATIC  The moment HQ approves the partner (or adds an already-signed partner with an owner
--              account), the code is posted in the owner's Support chat as a message from the team,
--              and once more when the partner goes live. If the owner account is attached later, it
--              fires then. Never more than once per stage.
--   MESSAGE    ican_franchise_admin_message_partner(partner, text) lets support write to any partner
--              (applied, approved, live, suspended) from the franchise tab: same Support chat thread,
--              same notification; the partner's reply lands in the Messages inbox, tagged "franchise".
--   MANUAL     ican_franchise_admin_send_code(partner, note) re-sends it on demand with an optional
--              personal note from HQ (used for a lost message, a changed owner, or a partner who is
--              still "applied"). ican_franchise_admin_send_pending_codes() sends it to every
--              approved/active partner that has not received one yet (existing partners).
--
-- The message also carries the partner's SHARE LINK (https://icanera.space/?agency=<code>, which the app
-- already understands: it fills the code in under Franchise > My agency) and a FOLLOW-UP CODE to quote to
-- support. The partner is told in three places: the Support chat message itself (with the unread dot the chat
-- widget already shows), an entry in the shared wallet inbox (which the wallet-push relay delivers to
-- installed phones), and, from the Support chat, the code is copyable text.
--
-- Nothing here changes money, rates or who can earn. It only sends messages. It never blocks an
-- approval: if the chat or inbox is unavailable the approval still succeeds and the partner simply
-- shows "code not sent" in the developer panel, ready for the manual button.
--
-- Run after 20261004100000_franchise_layer.sql. Safe to run twice. Needs the support chat tables
-- (chat_conversations, chat_messages) for the chat message and the wallet inbox for the notification;
-- either one missing is tolerated, both missing means "not sent".
-- ============================================================================

-- 1. Remember what was sent ---------------------------------------------------------------
ALTER TABLE public.ican_franchise_partners
  ADD COLUMN IF NOT EXISTS code_sent_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS code_sent_mode  TEXT CHECK (code_sent_mode IS NULL OR code_sent_mode IN ('auto', 'manual')),
  ADD COLUMN IF NOT EXISTS code_sent_status TEXT,
  ADD COLUMN IF NOT EXISTS code_sent_count INTEGER NOT NULL DEFAULT 0;

-- 1b. Follow-up code: a short reference every partner / applicant quotes to support ("FU-K7M2P4"). It is
--     generated for every partner (existing ones included), cannot be edited from the panel, and is searchable
--     in the Partners tab. It is not a secret and gives no access to anything.
CREATE OR REPLACE FUNCTION public._franchise_make_follow_up_code()
RETURNS TEXT LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_alphabet CONSTANT TEXT := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';  -- no 0/O/1/I/L
  v_code TEXT; v_try INT := 0;
BEGIN
  LOOP
    v_code := 'FU-' || (SELECT string_agg(substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::INT, 1), '')
                          FROM generate_series(1, 6));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.ican_franchise_partners WHERE follow_up_code = v_code);
    v_try := v_try + 1;
    IF v_try > 25 THEN RAISE EXCEPTION 'Could not generate a unique follow-up code'; END IF;
  END LOOP;
  RETURN v_code;
END;
$$;
REVOKE ALL ON FUNCTION public._franchise_make_follow_up_code() FROM PUBLIC, anon, authenticated;

ALTER TABLE public.ican_franchise_partners ADD COLUMN IF NOT EXISTS follow_up_code TEXT;
DO $$
DECLARE r RECORD;
BEGIN
  -- one statement per row so each sees the codes already handed out
  FOR r IN SELECT id FROM public.ican_franchise_partners WHERE follow_up_code IS NULL LOOP
    UPDATE public.ican_franchise_partners SET follow_up_code = public._franchise_make_follow_up_code() WHERE id = r.id;
  END LOOP;
END $$;
ALTER TABLE public.ican_franchise_partners ALTER COLUMN follow_up_code SET DEFAULT public._franchise_make_follow_up_code();
ALTER TABLE public.ican_franchise_partners ALTER COLUMN follow_up_code SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_ican_franchise_follow_up ON public.ican_franchise_partners (follow_up_code);

-- 2. The support chat needs a "kind" (the ICAN inbox filters on it). Already live on most servers. ---
DO $$
BEGIN
  IF to_regclass('public.chat_conversations') IS NOT NULL THEN
    ALTER TABLE public.chat_conversations ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'support';
  END IF;
END $$;

-- 3. The wallet inbox only accepted rows tied to a coin or business-wallet transaction (and QR
--    payment notices). A franchise notice is neither, so franchise_* messages are allowed too.
--    Skipped when the inbox is not installed. Same constraint name as ADD_PUBLIC_TRANSACTION_QR.sql
--    so the two files can run in either order.
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
       AND pg_get_constraintdef(oid) NOT LIKE '%franchise%'
  LOOP
    EXECUTE format('ALTER TABLE public.ican_wallet_inbox_notifications DROP CONSTRAINT %I', c.conname);
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.ican_wallet_inbox_notifications'::regclass
                    AND conname = 'ican_wallet_inbox_has_source_or_qr') THEN
    ALTER TABLE public.ican_wallet_inbox_notifications
      ADD CONSTRAINT ican_wallet_inbox_has_source_or_qr
      CHECK (coin_transaction_id IS NOT NULL OR business_wallet_transaction_id IS NOT NULL
             OR notification_type LIKE 'qr\_%' OR notification_type LIKE 'franchise\_%');
  END IF;
END $$;

-- 4. The message ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._franchise_code_message(p public.ican_franchise_partners, p_note TEXT)
RETURNS TEXT LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  v_type     TEXT := CASE p.partner_type WHEN 'country_master' THEN 'Country Master'
                                         WHEN 'agency' THEN 'Agency' ELSE 'Referral partner' END;
  v_products TEXT;
  v_todo     TEXT[] := ARRAY[]::TEXT[];
  v_head     TEXT;
  v_origin   CONSTANT TEXT := 'https://icanera.space';   -- the public app address the share link points at
  v_use      TEXT;
  v_live     TEXT;
BEGIN
  SELECT string_agg(CASE x WHEN 'icanera' THEN 'IcanEra' WHEN 'supermarketera' THEN 'SupermarketEra'
                           WHEN 'bodagoera' THEN 'BodaGoEra' ELSE x END, ', ' ORDER BY x)
    INTO v_products FROM unnest(p.products) AS x;

  IF p.company_status <> 'verified' THEN v_todo := array_append(v_todo, 'your company registration'); END IF;
  IF p.kyc_status <> 'verified' THEN v_todo := array_append(v_todo, 'your owners and directors (KYC)'); END IF;

  v_head := CASE p.status
    WHEN 'active'   THEN 'Your IcanEra franchise is live.'
    WHEN 'approved' THEN 'Your IcanEra franchise application is approved.'
    ELSE 'We have received your IcanEra franchise application.' END;

  v_use := CASE p.partner_type
    WHEN 'country_master' THEN
      'Quote this code whenever you contact HQ about your country, your agencies or your payouts.'
    ELSE
      'Give your customers this code or your link. With the link, the code is filled in for them; otherwise a customer opens the app menu, Franchise, My agency, enters the code and chooses your agency. '
      || 'From then on you earn your share of the platform fees on that customer''s activity, and the customer can leave at any time.'
  END;

  v_live := CASE
    WHEN p.status = 'active' THEN 'You are earning now. Open the app menu, Franchise, to see your customers, earnings and statements.'
    WHEN cardinality(v_todo) = 0 THEN
      'The code is reserved for you. We will switch you live shortly and tell you here. Earnings start from that moment.'
    ELSE
      'The code is reserved for you but does not earn yet. To go live we still need to verify '
      || array_to_string(v_todo, ' and ') || '. We will tell you here as soon as you are live.'
  END;

  RETURN v_head || E'\n\n'
      || 'YOUR FRANCHISE CODE: ' || p.partner_code || E'\n'
      || CASE WHEN p.partner_type <> 'country_master'
              THEN 'YOUR SHARE LINK: ' || v_origin || '/?agency=' || p.partner_code || E'\n' ELSE '' END
      || 'FOLLOW-UP CODE: ' || p.follow_up_code || ' (quote this when you contact us)' || E'\n'
      || 'Type: ' || v_type || ' | Country: ' || p.country_code
      || ' | Products: ' || COALESCE(v_products, 'IcanEra')
      || E'\n\n' || v_use || E'\n\n' || v_live
      || CASE WHEN NULLIF(btrim(COALESCE(p_note, '')), '') IS NOT NULL
              THEN E'\n\nMessage from IcanEra HQ: ' || btrim(p_note) ELSE '' END
      || E'\n\nReply here if you need anything.';
END;
$$;

-- 5a. Post one message to a partner: into their Support chat thread + the wallet inbox ----------------
-- Shared by the code delivery below and by "Message partner" (support writing to a partner from the
-- franchise tab). Each channel is best effort and independent. Returns {chat, notified, conversation_id}.
CREATE OR REPLACE FUNCTION public._franchise_post_to_partner(
  p public.ican_franchise_partners, p_body TEXT, p_notif_type TEXT, p_title TEXT, p_notif_message TEXT, p_meta JSONB
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE
  v_conv   UUID;
  v_name   TEXT;
  v_email  TEXT;
  v_pname  TEXT;
  v_pemail TEXT;
  v_chat   BOOLEAN := FALSE;
  v_notif  BOOLEAN := FALSE;
BEGIN
  -- Who they are, for a thread the team can recognise in the inbox.
  SELECT u.email INTO v_email FROM auth.users u WHERE u.id = p.owner_user_id;
  BEGIN
    SELECT NULLIF(btrim(pr.full_name), ''), NULLIF(btrim(pr.email), '')
      INTO v_pname, v_pemail FROM public.profiles pr WHERE pr.id = p.owner_user_id;
    v_name := v_pname;
    v_email := COALESCE(v_pemail, v_email);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  -- Support chat: the owner's existing support thread if there is one (so the message lands where they
  -- already talk to us), otherwise a new one tagged "franchise" in the support inbox. The chat trigger
  -- raises their "unread" dot; the team sees the thread, and any reply, in the Messages inbox.
  BEGIN
    SELECT c.id INTO v_conv
      FROM public.chat_conversations c
     WHERE c.user_id = p.owner_user_id AND c.origin_app = 'ican' AND c.kind = 'support'
     ORDER BY c.last_message_at DESC NULLS LAST LIMIT 1;
    IF v_conv IS NULL THEN
      INSERT INTO public.chat_conversations
        (guest_name, guest_email, user_id, role, portal, origin_app, kind, subject, unread_by_dev)
      VALUES (COALESCE(v_name, p.display_name), v_email, p.owner_user_id, 'user', 'franchise', 'ican', 'support',
              'Franchise partner', FALSE)
      RETURNING id INTO v_conv;
    END IF;
    INSERT INTO public.chat_messages (conversation_id, sender_role, sender_name, body)
    VALUES (v_conv, 'dev', 'IcanEra Franchise Team', p_body);
    v_chat := TRUE;
  EXCEPTION WHEN OTHERS THEN
    v_conv := NULL;
    RAISE WARNING 'franchise chat message failed for partner %: %', p.id, SQLERRM;
  END;

  -- Notification: the shared wallet inbox (also pushed to installed phones by the wallet-push relay).
  BEGIN
    INSERT INTO public.ican_wallet_inbox_notifications
      (recipient_user_id, source_app, notification_type, title, message, business_profile_id, reference_id, metadata)
    VALUES (p.owner_user_id, 'ican', p_notif_type, left(p_title, 200), left(p_notif_message, 500),
            p.business_profile_id, p.id::TEXT,
            COALESCE(p_meta, '{}'::JSONB) || jsonb_build_object('partner_id', p.id, 'partner_code', p.partner_code));
    v_notif := TRUE;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'franchise notification failed for partner %: %', p.id, SQLERRM;
  END;

  RETURN jsonb_build_object('chat', v_chat, 'notified', v_notif, 'conversation_id', v_conv);
END;
$$;

-- 5b. The code delivery (internal: used by the trigger and by the two admin functions) ---------------
-- Returns {sent: true, chat: bool, notified: bool, conversation_id} or {sent: false, reason}.
CREATE OR REPLACE FUNCTION public._franchise_deliver_code(p_partner_id UUID, p_mode TEXT, p_note TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE
  p        public.ican_franchise_partners;
  v_res    JSONB;
BEGIN
  SELECT * INTO p FROM public.ican_franchise_partners WHERE id = p_partner_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('sent', false, 'reason', 'not_found'); END IF;
  IF p.owner_user_id IS NULL THEN RETURN jsonb_build_object('sent', false, 'reason', 'no_owner'); END IF;
  IF p.status NOT IN ('applied', 'approved', 'active') THEN
    RETURN jsonb_build_object('sent', false, 'reason', 'status');
  END IF;

  v_res := public._franchise_post_to_partner(
    p, public._franchise_code_message(p, p_note), 'franchise_code', 'Your franchise code is ready',
    'Your franchise code is ' || p.partner_code || ' and your follow-up code is ' || p.follow_up_code
      || '. Open Support chat for your share link and how to use it.',
    jsonb_build_object('mode', p_mode));

  IF NOT COALESCE((v_res ->> 'chat')::BOOLEAN, FALSE) AND NOT COALESCE((v_res ->> 'notified')::BOOLEAN, FALSE) THEN
    RETURN jsonb_build_object('sent', false, 'reason', 'no_channel');
  END IF;

  UPDATE public.ican_franchise_partners
     SET code_sent_at = now(), code_sent_mode = p_mode, code_sent_status = p.status, code_sent_count = code_sent_count + 1
   WHERE id = p.id;

  PERFORM public.ican_franchise_audit('code_sent', 'partner', p.id::TEXT,
    jsonb_build_object('mode', p_mode, 'chat', v_res -> 'chat', 'notified', v_res -> 'notified',
                       'with_note', NULLIF(btrim(COALESCE(p_note, '')), '') IS NOT NULL));

  RETURN jsonb_build_object('sent', true) || v_res;
END;
$$;

REVOKE ALL ON FUNCTION public._franchise_deliver_code(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._franchise_post_to_partner(public.ican_franchise_partners, TEXT, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._franchise_code_message(public.ican_franchise_partners, TEXT) FROM PUBLIC, anon, authenticated;

-- 6. Automatic: when a partner with an owner account becomes approved or active, and once more when an
--    approved partner goes live (so "we will tell you here when you are live" is true) ---------------
CREATE OR REPLACE FUNCTION public.ican_franchise_auto_send_code()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  BEGIN
    PERFORM public._franchise_deliver_code(NEW.id, 'auto');
  EXCEPTION WHEN OTHERS THEN
    -- Never block an approval because a message could not be posted.
    RAISE WARNING 'franchise code auto-send failed for partner %: %', NEW.id, SQLERRM;
  END;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.ican_franchise_auto_send_code() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_ican_franchise_auto_send_code ON public.ican_franchise_partners;
CREATE TRIGGER trg_ican_franchise_auto_send_code
  AFTER INSERT OR UPDATE OF status, owner_user_id ON public.ican_franchise_partners
  FOR EACH ROW
  WHEN (NEW.status IN ('approved', 'active') AND NEW.owner_user_id IS NOT NULL
        AND (NEW.code_sent_at IS NULL OR (NEW.status = 'active' AND NEW.code_sent_status IS DISTINCT FROM 'active')))
  EXECUTE FUNCTION public.ican_franchise_auto_send_code();

-- 7. Manual: HQ re-sends one partner's code, with an optional personal note ------------------------
CREATE OR REPLACE FUNCTION public.ican_franchise_admin_send_code(p_partner_id UUID, p_note TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  p public.ican_franchise_partners; v_res JSONB;
BEGIN
  PERFORM public.ican_franchise_require_admin();
  IF p_note IS NOT NULL AND length(p_note) > 500 THEN RAISE EXCEPTION 'The note can be at most 500 characters'; END IF;

  SELECT * INTO p FROM public.ican_franchise_partners WHERE id = p_partner_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Partner not found'; END IF;
  IF p.owner_user_id IS NULL THEN
    RAISE EXCEPTION 'This partner has no owner account yet. Add the owner account email first, then send the code.';
  END IF;
  IF p.status NOT IN ('applied', 'approved', 'active') THEN
    RAISE EXCEPTION 'A % partner cannot be sent a code', p.status;
  END IF;
  IF p.code_sent_at IS NOT NULL AND p.code_sent_at > now() - INTERVAL '1 minute' THEN
    RAISE EXCEPTION 'The code was just sent. Wait a minute before sending it again.';
  END IF;

  v_res := public._franchise_deliver_code(p_partner_id, 'manual', p_note);
  IF NOT COALESCE((v_res ->> 'sent')::BOOLEAN, FALSE) THEN
    RAISE EXCEPTION 'The code could not be delivered (support chat and notifications are both unavailable).';
  END IF;
  RETURN v_res;
END;
$$;

-- 8. Manual, in bulk: every approved/active partner that has not been sent a code -----------------
CREATE OR REPLACE FUNCTION public.ican_franchise_admin_send_pending_codes()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r RECORD; v_res JSONB; v_sent INT := 0; v_failed INT := 0; v_no_owner INT;
BEGIN
  PERFORM public.ican_franchise_require_admin();
  FOR r IN
    SELECT id FROM public.ican_franchise_partners
     WHERE status IN ('approved', 'active') AND owner_user_id IS NOT NULL AND code_sent_at IS NULL
     ORDER BY created_at
  LOOP
    BEGIN
      v_res := public._franchise_deliver_code(r.id, 'manual');
      IF COALESCE((v_res ->> 'sent')::BOOLEAN, FALSE) THEN v_sent := v_sent + 1; ELSE v_failed := v_failed + 1; END IF;
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
    END;
  END LOOP;
  SELECT COUNT(*) INTO v_no_owner FROM public.ican_franchise_partners
   WHERE status IN ('approved', 'active') AND owner_user_id IS NULL AND code_sent_at IS NULL;
  RETURN jsonb_build_object('sent', v_sent, 'failed', v_failed, 'no_owner_account', v_no_owner);
END;
$$;

-- 9. Support writes to a partner (any status but terminated, application stage included) -------------
-- The message goes into the partner's Support chat thread, with a notification; their reply comes back
-- to the Messages inbox (thread tagged "franchise") and shows in the partner's card in the franchise tab.
CREATE OR REPLACE FUNCTION public.ican_franchise_admin_message_partner(p_partner_id UUID, p_body TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  p public.ican_franchise_partners; v_body TEXT := btrim(COALESCE(p_body, '')); v_res JSONB;
BEGIN
  PERFORM public.ican_franchise_require_admin();
  IF v_body = '' THEN RAISE EXCEPTION 'Write a message first'; END IF;
  IF length(v_body) > 2000 THEN RAISE EXCEPTION 'The message can be at most 2000 characters'; END IF;

  SELECT * INTO p FROM public.ican_franchise_partners WHERE id = p_partner_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Partner not found'; END IF;
  IF p.owner_user_id IS NULL THEN
    RAISE EXCEPTION 'This partner has no owner account yet. Add the owner account email first, then message them.';
  END IF;
  IF p.status = 'terminated' THEN RAISE EXCEPTION 'A terminated partner cannot be messaged'; END IF;

  v_res := public._franchise_post_to_partner(
    p, v_body, 'franchise_message', 'Message from IcanEra Franchise Team', v_body, jsonb_build_object('kind', 'message'));
  IF NOT COALESCE((v_res ->> 'chat')::BOOLEAN, FALSE) AND NOT COALESCE((v_res ->> 'notified')::BOOLEAN, FALSE) THEN
    RAISE EXCEPTION 'The message could not be delivered (support chat and notifications are both unavailable).';
  END IF;
  PERFORM public.ican_franchise_audit('partner_messaged', 'partner', p.id::TEXT, jsonb_build_object('length', length(v_body)));
  RETURN v_res;
END;
$$;

REVOKE ALL ON FUNCTION public.ican_franchise_admin_send_code(UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ican_franchise_admin_send_pending_codes() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ican_franchise_admin_message_partner(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ican_franchise_admin_message_partner(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ican_franchise_admin_send_code(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ican_franchise_admin_send_pending_codes() TO authenticated;

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE 'Franchise codes are now delivered through the Support chat (automatic on approval, manual from the developer panel) with a notification.';
END $$;
