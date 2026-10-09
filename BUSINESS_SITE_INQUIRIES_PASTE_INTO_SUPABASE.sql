-- ============================================================
-- Business website chat: visitor inquiries (the "Ask us" bubble on /notices/<company>)
--
-- A visitor chats with the site's AI assistant (api/business-chat.js, nothing stored). When they
-- want a person, they leave a name and a phone/email and the conversation becomes a THREAD here:
--   * the visitor keeps a private access token (kept in their browser) to read replies and write back
--     -- no account needed, same "no login to enquire" idea as job applications;
--   * the company's staff (announcements tool: edit or manage_applications) read and reply from
--     CMMS > Posts & Jobs > Inquiries.
--
-- Everything goes through SECURITY DEFINER functions; the tables are not readable by anon/authenticated.
-- Requires: CMMS_ANNOUNCEMENTS_AND_JOBS.sql (cmms_has_tool_action, cmms_company_profiles).
-- Safe to run more than once.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.cmms_inquiry_threads (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cmms_company_id  UUID NOT NULL REFERENCES public.cmms_company_profiles(id) ON DELETE CASCADE,
  -- the visitor's secret: 64 random hex characters, only ever returned to the person who started the thread
  access_token     TEXT NOT NULL UNIQUE
                   DEFAULT replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  visitor_name     TEXT NOT NULL,
  visitor_contact  TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'answered', 'resolved')),
  staff_unread     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_message_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cmms_inquiry_threads_company_idx
  ON public.cmms_inquiry_threads (cmms_company_id, last_message_at DESC);

CREATE TABLE IF NOT EXISTS public.cmms_inquiry_messages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id     UUID NOT NULL REFERENCES public.cmms_inquiry_threads(id) ON DELETE CASCADE,
  sender        TEXT NOT NULL CHECK (sender IN ('visitor', 'assistant', 'staff')),
  body          TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  staff_user_id UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cmms_inquiry_messages_thread_idx
  ON public.cmms_inquiry_messages (thread_id, created_at);

ALTER TABLE public.cmms_inquiry_threads  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cmms_inquiry_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cmms_inquiry_threads  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.cmms_inquiry_messages FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- Who may handle a company's inquiries: whoever can edit its public board or manage its applications.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._cmms_can_handle_inquiries(p_company_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND (
    public.cmms_has_tool_action(p_company_id, 'announcements', 'edit')
    OR public.cmms_has_tool_action(p_company_id, 'announcements', 'manage_applications')
  );
$$;
REVOKE ALL ON FUNCTION public._cmms_can_handle_inquiries(UUID) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- Visitor side (anon + authenticated)
-- ------------------------------------------------------------

-- Start a thread: the visitor's details, the first question and (optionally) the chat they already had with
-- the assistant -- [{ "role": "user" | "assistant", "text": "..." }] -- so staff see the whole context.
CREATE OR REPLACE FUNCTION public.fn_public_inquiry_start(
  p_company_id UUID,
  p_name       TEXT,
  p_contact    TEXT,
  p_message    TEXT,
  p_transcript JSONB DEFAULT '[]'::jsonb
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_name    TEXT := btrim(COALESCE(p_name, ''));
  v_contact TEXT := btrim(COALESCE(p_contact, ''));
  v_message TEXT := btrim(COALESCE(p_message, ''));
  v_thread  public.cmms_inquiry_threads%ROWTYPE;
  v_turn    JSONB;
  v_text    TEXT;
  v_n       INT := 0;
BEGIN
  IF p_company_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.cmms_company_profiles WHERE id = p_company_id) THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'This business could not be found');
  END IF;
  IF char_length(v_name) < 2 OR char_length(v_name) > 80 THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Please enter your name');
  END IF;
  -- a phone number (7+ digits) or an email address, so the business can actually reach them
  IF char_length(v_contact) > 120
     OR NOT (v_contact ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' OR length(regexp_replace(v_contact, '\D', '', 'g')) >= 7) THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Enter a phone number or email address the business can reach you on');
  END IF;
  IF char_length(v_message) < 2 OR char_length(v_message) > 2000 THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Write your question (up to 2000 characters)');
  END IF;

  -- abuse limits: a flood of threads for one business, or from one contact
  IF (SELECT count(*) FROM public.cmms_inquiry_threads
       WHERE cmms_company_id = p_company_id AND created_at > now() - interval '1 hour') >= 60 THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'This business is getting a lot of messages right now. Please try again later or call them.');
  END IF;
  IF (SELECT count(*) FROM public.cmms_inquiry_threads
       WHERE cmms_company_id = p_company_id AND lower(visitor_contact) = lower(v_contact)
         AND created_at > now() - interval '1 day') >= 5 THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'You have already sent several messages today. The team will reply to you soon.');
  END IF;

  INSERT INTO public.cmms_inquiry_threads (cmms_company_id, visitor_name, visitor_contact)
  VALUES (p_company_id, left(v_name, 80), v_contact)
  RETURNING * INTO v_thread;

  IF p_transcript IS NOT NULL AND jsonb_typeof(p_transcript) = 'array' THEN
    FOR v_turn IN SELECT * FROM jsonb_array_elements(p_transcript) LOOP
      EXIT WHEN v_n >= 20;
      v_text := left(btrim(COALESCE(v_turn->>'text', '')), 1000);
      CONTINUE WHEN v_text = '' OR COALESCE(v_turn->>'role', '') NOT IN ('user', 'assistant');
      INSERT INTO public.cmms_inquiry_messages (thread_id, sender, body, created_at)
      VALUES (v_thread.id,
              CASE WHEN v_turn->>'role' = 'assistant' THEN 'assistant' ELSE 'visitor' END,
              v_text,
              v_thread.created_at - ((20 - v_n) * interval '1 second'));
      v_n := v_n + 1;
    END LOOP;
  END IF;

  INSERT INTO public.cmms_inquiry_messages (thread_id, sender, body) VALUES (v_thread.id, 'visitor', v_message);
  RETURN jsonb_build_object('success', TRUE, 'token', v_thread.access_token);
END;
$$;

-- Add a message to a thread the visitor already started.
CREATE OR REPLACE FUNCTION public.fn_public_inquiry_send(p_token TEXT, p_message TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_message TEXT := btrim(COALESCE(p_message, ''));
  v_thread  public.cmms_inquiry_threads%ROWTYPE;
BEGIN
  IF p_token IS NULL OR p_token !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'This conversation could not be found');
  END IF;
  SELECT * INTO v_thread FROM public.cmms_inquiry_threads WHERE access_token = p_token;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'This conversation could not be found');
  END IF;
  IF char_length(v_message) < 1 OR char_length(v_message) > 2000 THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Write a message (up to 2000 characters)');
  END IF;
  IF (SELECT count(*) FROM public.cmms_inquiry_messages WHERE thread_id = v_thread.id) >= 300
     OR (SELECT count(*) FROM public.cmms_inquiry_messages
          WHERE thread_id = v_thread.id AND sender = 'visitor' AND created_at > now() - interval '1 minute') >= 10 THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'You are sending messages too quickly. Please wait a moment.');
  END IF;

  INSERT INTO public.cmms_inquiry_messages (thread_id, sender, body) VALUES (v_thread.id, 'visitor', v_message);
  UPDATE public.cmms_inquiry_threads
     SET status = CASE WHEN status = 'resolved' THEN 'open' ELSE status END,
         staff_unread = TRUE, last_message_at = now()
   WHERE id = v_thread.id;
  RETURN jsonb_build_object('success', TRUE);
END;
$$;

-- The visitor reads their thread (and the team's replies) with their token.
CREATE OR REPLACE FUNCTION public.fn_public_inquiry_get(p_token TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_thread public.cmms_inquiry_threads%ROWTYPE;
BEGIN
  IF p_token IS NULL OR p_token !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'This conversation could not be found');
  END IF;
  SELECT * INTO v_thread FROM public.cmms_inquiry_threads WHERE access_token = p_token;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'This conversation could not be found');
  END IF;
  RETURN jsonb_build_object(
    'success', TRUE,
    'status', v_thread.status,
    'visitor_name', v_thread.visitor_name,
    'visitor_contact', v_thread.visitor_contact,
    'messages', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', m.id, 'sender', m.sender, 'body', m.body, 'created_at', m.created_at)
                       ORDER BY m.created_at, m.id)
        FROM public.cmms_inquiry_messages m WHERE m.thread_id = v_thread.id), '[]'::jsonb));
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_public_inquiry_start(UUID, TEXT, TEXT, TEXT, JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_public_inquiry_send(TEXT, TEXT)                     TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_public_inquiry_get(TEXT)                            TO anon, authenticated;

-- ------------------------------------------------------------
-- Staff side (signed in, with access to the company's announcements tool)
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_cmms_inquiry_list(p_company_id UUID)
RETURNS TABLE (
  thread_id        UUID,
  visitor_name     TEXT,
  visitor_contact  TEXT,
  status           TEXT,
  staff_unread     BOOLEAN,
  created_at       TIMESTAMPTZ,
  last_message_at  TIMESTAMPTZ,
  last_message     TEXT,
  last_sender      TEXT,
  message_count    BIGINT
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public._cmms_can_handle_inquiries(p_company_id) THEN
    RAISE EXCEPTION 'You do not have permission to view this company''s inquiries';
  END IF;
  RETURN QUERY
  SELECT t.id, t.visitor_name, t.visitor_contact, t.status, t.staff_unread, t.created_at, t.last_message_at,
         lm.body, lm.sender, (SELECT count(*) FROM public.cmms_inquiry_messages x WHERE x.thread_id = t.id)
    FROM public.cmms_inquiry_threads t
    LEFT JOIN LATERAL (
      SELECT m.body, m.sender FROM public.cmms_inquiry_messages m
       WHERE m.thread_id = t.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1
    ) lm ON TRUE
   WHERE t.cmms_company_id = p_company_id
   ORDER BY t.last_message_at DESC
   LIMIT 200;
END;
$$;

-- Open one thread: its messages. Marks it read for staff.
CREATE OR REPLACE FUNCTION public.fn_cmms_inquiry_thread(p_thread_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_thread public.cmms_inquiry_threads%ROWTYPE;
BEGIN
  SELECT * INTO v_thread FROM public.cmms_inquiry_threads WHERE id = p_thread_id;
  IF NOT FOUND OR NOT public._cmms_can_handle_inquiries(v_thread.cmms_company_id) THEN
    RAISE EXCEPTION 'Inquiry not found';
  END IF;
  UPDATE public.cmms_inquiry_threads SET staff_unread = FALSE WHERE id = v_thread.id AND staff_unread;
  RETURN jsonb_build_object(
    'thread_id', v_thread.id,
    'visitor_name', v_thread.visitor_name,
    'visitor_contact', v_thread.visitor_contact,
    'status', v_thread.status,
    'messages', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', m.id, 'sender', m.sender, 'body', m.body, 'created_at', m.created_at)
                       ORDER BY m.created_at, m.id)
        FROM public.cmms_inquiry_messages m WHERE m.thread_id = v_thread.id), '[]'::jsonb));
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_cmms_inquiry_reply(p_thread_id UUID, p_body TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_thread public.cmms_inquiry_threads%ROWTYPE;
  v_body   TEXT := btrim(COALESCE(p_body, ''));
BEGIN
  SELECT * INTO v_thread FROM public.cmms_inquiry_threads WHERE id = p_thread_id;
  IF NOT FOUND OR NOT public._cmms_can_handle_inquiries(v_thread.cmms_company_id) THEN
    RAISE EXCEPTION 'Inquiry not found';
  END IF;
  IF char_length(v_body) < 1 OR char_length(v_body) > 2000 THEN
    RAISE EXCEPTION 'Write a reply (up to 2000 characters)';
  END IF;
  INSERT INTO public.cmms_inquiry_messages (thread_id, sender, body, staff_user_id)
  VALUES (v_thread.id, 'staff', v_body, auth.uid());
  UPDATE public.cmms_inquiry_threads
     SET status = 'answered', staff_unread = FALSE, last_message_at = now()
   WHERE id = v_thread.id;
  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_cmms_inquiry_set_status(p_thread_id UUID, p_status TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_company UUID;
BEGIN
  IF p_status NOT IN ('open', 'answered', 'resolved') THEN
    RAISE EXCEPTION 'Unknown status';
  END IF;
  SELECT cmms_company_id INTO v_company FROM public.cmms_inquiry_threads WHERE id = p_thread_id;
  IF v_company IS NULL OR NOT public._cmms_can_handle_inquiries(v_company) THEN
    RAISE EXCEPTION 'Inquiry not found';
  END IF;
  UPDATE public.cmms_inquiry_threads SET status = p_status WHERE id = p_thread_id;
  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_cmms_inquiry_list(UUID)              TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_cmms_inquiry_thread(UUID)            TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_cmms_inquiry_reply(UUID, TEXT)       TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_cmms_inquiry_set_status(UUID, TEXT)  TO authenticated;

NOTIFY pgrst, 'reload schema';

SELECT 'Business website inquiries ready (visitor chat -> CMMS Inquiries inbox)' AS status;
