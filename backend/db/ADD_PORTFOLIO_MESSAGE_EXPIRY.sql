-- Adds WhatsApp-style 24h disappearing messages to the portfolio direct
-- chat (public.portfolio_messages) — same ephemeral-by-default idea as
-- public.ican_statuses (24h TTL, query-time filtering is the real UX
-- enforcement, a sweep is just storage hygiene), applied per MESSAGE rather
-- than per conversation so the owner can keep individual messages (e.g. a
-- client's contact details) while the rest of the thread still fades.
--
-- Builds on CREATE_PORTFOLIO_DIRECT_MESSAGES.sql — run this after it.
-- Idempotent: safe to run more than once.

ALTER TABLE public.portfolio_messages
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
  ADD COLUMN IF NOT EXISTS kept_by_owner BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_portfolio_messages_expiry
  ON public.portfolio_messages(expires_at) WHERE kept_by_owner = false;

-- Re-reads a conversation's messages for a participant (owner, signed-in
-- visitor, or anonymous guest presenting p_guest_id — see
-- CREATE_PORTFOLIO_DIRECT_MESSAGES.sql for why guests only ever go through
-- this RPC). Opportunistically sweeps this one conversation's expired,
-- not-kept messages first, so "disappears after 24h" is enforced exactly
-- (to the second) for anyone actively viewing a thread, not just whenever
-- the periodic cron below next runs.
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

  DELETE FROM public.portfolio_messages
  WHERE conversation_id = p_conversation_id
    AND kept_by_owner = false
    AND expires_at <= NOW();

  RETURN QUERY
  SELECT * FROM public.portfolio_messages
  WHERE conversation_id = p_conversation_id
  ORDER BY created_at ASC;
END;
$$;

-- Owner-only: exempt one message from the 24h sweep (or put it back on the
-- clock). Checked against the message's conversation, not a stored
-- sender_user_id, since the owner should be able to keep a message the
-- VISITOR sent too (e.g. contact details worth holding onto).
CREATE OR REPLACE FUNCTION public.keep_portfolio_message(p_message_id UUID, p_keep BOOLEAN)
RETURNS public.portfolio_messages
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_result public.portfolio_messages;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Must be signed in';
  END IF;

  UPDATE public.portfolio_messages m
  SET kept_by_owner = p_keep
  FROM public.portfolio_conversations c
  WHERE m.id = p_message_id
    AND c.id = m.conversation_id
    AND c.owner_user_id = v_uid
  RETURNING m.* INTO v_result;

  IF v_result IS NULL THEN
    RAISE EXCEPTION 'Not authorized to manage this message';
  END IF;

  RETURN v_result;
END;
$$;

-- Bulk sweep for messages nobody reopened before expiry — no scheduled
-- caller wired up (dropped the Vercel cron that would have called this to
-- stay under the account's serverless-function limit; see git history for
-- frontend/api/cron/cleanup-portfolio-messages.js). The RPC in
-- get_portfolio_conversation_messages() already handles the common case of
-- an actively-viewed thread, so this is a genuinely optional backstop —
-- call it manually/via the Supabase SQL editor occasionally, or wire up an
-- external scheduler (e.g. cron-job.org hitting a PostgREST RPC endpoint)
-- if unclaimed old messages piling up ever actually matters.
CREATE OR REPLACE FUNCTION public.cleanup_expired_portfolio_messages()
RETURNS TABLE(deleted_count INTEGER)
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  DELETE FROM public.portfolio_messages
  WHERE kept_by_owner = false AND expires_at <= NOW();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN QUERY SELECT v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.keep_portfolio_message(UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_portfolio_messages() TO service_role;

NOTIFY pgrst, 'reload schema';

SELECT 'Portfolio messages now expire after 24h unless kept by the owner' AS status;
