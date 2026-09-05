-- Direct 1:1 chat between a resume/portfolio owner and a visitor to their
-- public /portfolio/<handle> page — replaces the generic "Community Chat"
-- button there with a real conversation. A visitor may be a signed-in ICAN
-- user OR an anonymous guest (matching the existing guest-call pattern
-- already on that page, PublicPortfolioPage.jsx's getOrCreateGuestId()).
--
-- Guest access is mediated ENTIRELY through the SECURITY DEFINER RPCs below,
-- never directly against these tables — plain RLS can't authenticate an
-- anonymous guest_id the way auth.uid() authenticates a real session, so
-- every write (owner included, for one consistent code path) goes through
-- send_portfolio_message()/start_portfolio_conversation(). Authenticated
-- participants (the owner's dashboard inbox) still get direct table SELECT
-- for Realtime.
--
-- Attachments (images/files) are stored in R2, not Supabase Storage — see
-- backend/routes/storageRoutes.js's 'portfolio-chat' folder (authenticated
-- senders) and POST /presign-upload-chat (anonymous guests, rate-limited,
-- image/PDF only). Only the resulting r2:// key is stored here.
--
-- Idempotent: safe to run more than once.

CREATE TABLE IF NOT EXISTS public.portfolio_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  visitor_user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  visitor_name TEXT,
  guest_id TEXT,
  guest_name TEXT,
  last_message_at TIMESTAMPTZ DEFAULT NOW(),
  last_message_preview TEXT,
  unread_by_owner BOOLEAN NOT NULL DEFAULT true,
  unread_by_visitor BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT portfolio_conversations_visitor_identity CHECK (
    (visitor_user_id IS NOT NULL AND guest_id IS NULL) OR
    (visitor_user_id IS NULL AND guest_id IS NOT NULL)
  ),
  CONSTRAINT portfolio_conversations_no_self_chat CHECK (visitor_user_id IS DISTINCT FROM owner_user_id)
);

-- One conversation per (owner, signed-in visitor) and per (owner, guest) —
-- partial unique indexes since exactly one of visitor_user_id/guest_id is set.
CREATE UNIQUE INDEX IF NOT EXISTS idx_portfolio_conversations_owner_visitor
  ON public.portfolio_conversations(owner_user_id, visitor_user_id) WHERE visitor_user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_portfolio_conversations_owner_guest
  ON public.portfolio_conversations(owner_user_id, guest_id) WHERE guest_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_portfolio_conversations_owner
  ON public.portfolio_conversations(owner_user_id, last_message_at DESC);

CREATE TABLE IF NOT EXISTS public.portfolio_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.portfolio_conversations(id) ON DELETE CASCADE,
  sender_role VARCHAR(10) NOT NULL CHECK (sender_role IN ('owner', 'visitor')),
  sender_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  sender_name VARCHAR(200),
  body TEXT,
  attachment_url TEXT,
  attachment_type VARCHAR(10) CHECK (attachment_type IN ('image', 'file')),
  attachment_name VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT portfolio_messages_has_content CHECK (
    (body IS NOT NULL AND btrim(body) <> '') OR attachment_url IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_portfolio_messages_conversation ON public.portfolio_messages(conversation_id, created_at);

-- ── RLS: authenticated participants get direct table SELECT (dashboard
--       "Messages" inbox + Realtime). No INSERT policy for anyone — every
--       write, owner included, goes through the RPCs below. ────────────────
ALTER TABLE public.portfolio_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portfolio_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "portfolio_conversations_participant_read" ON public.portfolio_conversations;
CREATE POLICY "portfolio_conversations_participant_read" ON public.portfolio_conversations
  FOR SELECT TO authenticated
  USING (auth.uid() = owner_user_id OR auth.uid() = visitor_user_id);

DROP POLICY IF EXISTS "portfolio_conversations_participant_update" ON public.portfolio_conversations;
CREATE POLICY "portfolio_conversations_participant_update" ON public.portfolio_conversations
  FOR UPDATE TO authenticated
  USING (auth.uid() = owner_user_id OR auth.uid() = visitor_user_id)
  WITH CHECK (auth.uid() = owner_user_id OR auth.uid() = visitor_user_id);

DROP POLICY IF EXISTS "portfolio_messages_participant_read" ON public.portfolio_messages;
CREATE POLICY "portfolio_messages_participant_read" ON public.portfolio_messages
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.portfolio_conversations c
      WHERE c.id = conversation_id AND (c.owner_user_id = auth.uid() OR c.visitor_user_id = auth.uid())
    )
  );

-- ── RPCs (SECURITY DEFINER) — the only way any client writes here ─────────

-- Finds-or-creates the one conversation between p_owner_user_id and the
-- caller (a signed-in auth.uid(), or an anonymous guest identified by
-- p_guest_id — the same localStorage id PublicPortfolioPage.jsx already
-- uses for guest calls). Refuses a profile with no public resume, and
-- refuses self-chat.
CREATE OR REPLACE FUNCTION public.start_portfolio_conversation(
  p_owner_user_id UUID,
  p_guest_id TEXT DEFAULT NULL,
  p_guest_name TEXT DEFAULT NULL
)
RETURNS UUID
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_visitor_id UUID := auth.uid();
  v_visitor_name TEXT;
  v_conversation_id UUID;
BEGIN
  IF p_owner_user_id IS NULL THEN
    RAISE EXCEPTION 'owner_user_id is required';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    JOIN public.user_portfolios up ON up.user_id = p.id
    WHERE p.id = p_owner_user_id AND p.handle IS NOT NULL AND up.is_public = true
  ) THEN
    RAISE EXCEPTION 'This profile is not accepting messages';
  END IF;

  IF v_visitor_id IS NOT NULL THEN
    IF v_visitor_id = p_owner_user_id THEN
      RAISE EXCEPTION 'Cannot start a conversation with yourself';
    END IF;

    SELECT full_name INTO v_visitor_name FROM public.profiles WHERE id = v_visitor_id;

    SELECT id INTO v_conversation_id
    FROM public.portfolio_conversations
    WHERE owner_user_id = p_owner_user_id AND visitor_user_id = v_visitor_id;

    IF v_conversation_id IS NULL THEN
      INSERT INTO public.portfolio_conversations (owner_user_id, visitor_user_id, visitor_name)
      VALUES (p_owner_user_id, v_visitor_id, v_visitor_name)
      RETURNING id INTO v_conversation_id;
    ELSE
      UPDATE public.portfolio_conversations SET visitor_name = v_visitor_name WHERE id = v_conversation_id;
    END IF;
  ELSE
    IF p_guest_id IS NULL OR btrim(p_guest_id) = '' THEN
      RAISE EXCEPTION 'guest_id is required for an anonymous visitor';
    END IF;

    SELECT id INTO v_conversation_id
    FROM public.portfolio_conversations
    WHERE owner_user_id = p_owner_user_id AND guest_id = p_guest_id;

    IF v_conversation_id IS NULL THEN
      INSERT INTO public.portfolio_conversations (owner_user_id, guest_id, guest_name)
      VALUES (p_owner_user_id, p_guest_id, NULLIF(btrim(COALESCE(p_guest_name, '')), ''))
      RETURNING id INTO v_conversation_id;
    ELSIF p_guest_name IS NOT NULL AND btrim(p_guest_name) <> '' THEN
      UPDATE public.portfolio_conversations SET guest_name = btrim(p_guest_name) WHERE id = v_conversation_id;
    END IF;
  END IF;

  RETURN v_conversation_id;
END;
$$;

-- True if the caller (auth.uid(), or an anonymous guest presenting
-- p_guest_id) is a participant of the conversation.
CREATE OR REPLACE FUNCTION public.can_access_portfolio_conversation(p_conversation_id UUID, p_guest_id TEXT)
RETURNS BOOLEAN
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.portfolio_conversations c
    WHERE c.id = p_conversation_id
      AND (
        (v_uid IS NOT NULL AND (c.owner_user_id = v_uid OR c.visitor_user_id = v_uid))
        OR (v_uid IS NULL AND p_guest_id IS NOT NULL AND c.guest_id = p_guest_id)
      )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_portfolio_conversation_messages(
  p_conversation_id UUID,
  p_guest_id TEXT DEFAULT NULL
)
RETURNS SETOF public.portfolio_messages
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT public.can_access_portfolio_conversation(p_conversation_id, p_guest_id) THEN
    RAISE EXCEPTION 'Not authorized to view this conversation';
  END IF;

  RETURN QUERY
  SELECT * FROM public.portfolio_messages
  WHERE conversation_id = p_conversation_id
  ORDER BY created_at ASC;
END;
$$;

CREATE OR REPLACE FUNCTION public.send_portfolio_message(
  p_conversation_id UUID,
  p_body TEXT DEFAULT NULL,
  p_attachment_url TEXT DEFAULT NULL,
  p_attachment_type TEXT DEFAULT NULL,
  p_attachment_name TEXT DEFAULT NULL,
  p_guest_id TEXT DEFAULT NULL,
  p_guest_name TEXT DEFAULT NULL
)
RETURNS public.portfolio_messages
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_conversation public.portfolio_conversations;
  v_role VARCHAR(10);
  v_sender_name VARCHAR(200);
  v_result public.portfolio_messages;
BEGIN
  IF (p_body IS NULL OR btrim(p_body) = '') AND p_attachment_url IS NULL THEN
    RAISE EXCEPTION 'Message must have text or an attachment';
  END IF;

  SELECT * INTO v_conversation FROM public.portfolio_conversations WHERE id = p_conversation_id;
  IF v_conversation IS NULL THEN
    RAISE EXCEPTION 'Conversation not found';
  END IF;

  IF v_uid IS NOT NULL THEN
    IF v_uid = v_conversation.owner_user_id THEN
      v_role := 'owner';
    ELSIF v_uid = v_conversation.visitor_user_id THEN
      v_role := 'visitor';
    ELSE
      RAISE EXCEPTION 'Not authorized to post in this conversation';
    END IF;
    SELECT full_name INTO v_sender_name FROM public.profiles WHERE id = v_uid;
  ELSE
    IF p_guest_id IS NULL OR v_conversation.guest_id IS DISTINCT FROM p_guest_id THEN
      RAISE EXCEPTION 'Not authorized to post in this conversation';
    END IF;
    v_role := 'visitor';
    v_sender_name := COALESCE(NULLIF(btrim(COALESCE(p_guest_name, '')), ''), v_conversation.guest_name, 'Guest');
  END IF;

  INSERT INTO public.portfolio_messages (
    conversation_id, sender_role, sender_user_id, sender_name, body,
    attachment_url, attachment_type, attachment_name
  ) VALUES (
    p_conversation_id, v_role, v_uid, v_sender_name, NULLIF(btrim(COALESCE(p_body, '')), ''),
    p_attachment_url, p_attachment_type, p_attachment_name
  )
  RETURNING * INTO v_result;

  UPDATE public.portfolio_conversations
  SET last_message_at = NOW(),
      last_message_preview = LEFT(
        COALESCE(NULLIF(btrim(COALESCE(p_body, '')), ''), CASE WHEN p_attachment_type = 'image' THEN '📷 Photo' ELSE '📎 File' END),
        140
      ),
      unread_by_owner = CASE WHEN v_role = 'visitor' THEN true ELSE unread_by_owner END,
      unread_by_visitor = CASE WHEN v_role = 'owner' THEN true ELSE unread_by_visitor END
  WHERE id = p_conversation_id;

  RETURN v_result;
END;
$$;

-- Owner marks a conversation read from the dashboard inbox; a signed-in
-- visitor marks it read the same way. Guests have nothing persistent to
-- mark (unread_by_visitor only matters for a returning signed-in/dashboard
-- view), so this is authenticated-only, unlike the RPCs above.
CREATE OR REPLACE FUNCTION public.mark_portfolio_conversation_read(p_conversation_id UUID)
RETURNS VOID
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Must be signed in';
  END IF;

  UPDATE public.portfolio_conversations
  SET unread_by_owner = CASE WHEN owner_user_id = v_uid THEN false ELSE unread_by_owner END,
      unread_by_visitor = CASE WHEN visitor_user_id = v_uid THEN false ELSE unread_by_visitor END
  WHERE id = p_conversation_id AND (owner_user_id = v_uid OR visitor_user_id = v_uid);
END;
$$;

GRANT EXECUTE ON FUNCTION public.start_portfolio_conversation(UUID, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_portfolio_conversation(UUID, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_portfolio_conversation_messages(UUID, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.send_portfolio_message(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_portfolio_conversation_read(UUID) TO authenticated;

-- Realtime for the owner's dashboard inbox — authenticated RLS above already
-- restricts postgres_changes payloads to rows the subscriber can SELECT.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'portfolio_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.portfolio_messages;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'portfolio_conversations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.portfolio_conversations;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

SELECT 'Portfolio direct-message conversations, messages, and RPCs created' AS status;
