-- ============================================================
-- "Ask us" answer memory: the assistant on a business website learns from the questions it has already answered.
--
-- When a visitor asks a question the AI answers from the business's public facts, the answer is stored here. The next
-- visitor who asks (nearly) the same thing gets the stored answer at once: faster, free of AI cost, and identical.
--   * Only the server (api/business-chat.js, with the service-role key) reads or writes learned answers, so nobody can
--     plant an answer through the public anon key. The staff functions below are for signed-in company staff.
--   * A learned answer is tied to a hash of the business's public facts: when the business changes its hours, prices,
--     jobs or news the old answers stop being served and are re-learned (and they expire after 14 days anyway).
--   * Visitors can mark an answer unhelpful; two such votes (more than helpful ones) mute it.
--   * Staff review everything in CMMS > Posts & Jobs > Inquiries > Learned answers: edit or pin an answer (their words
--     are then always served, never expire and can't be muted by votes), mute it, delete it, or teach a new one.
--
-- Matching is two-stage: pg_trgm similarity here finds candidates by question key (src/utils/chatQuestionKey.js folds
-- synonyms, filler and word order), then the server confirms them by word overlap and number equality.
-- Requires: CMMS_ANNOUNCEMENTS_AND_JOBS.sql and business_site_inquiries.sql (_cmms_can_handle_inquiries).
-- Safe to run more than once.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.business_chat_memory (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cmms_company_id  UUID NOT NULL REFERENCES public.cmms_company_profiles(id) ON DELETE CASCADE,
  question         TEXT NOT NULL CHECK (char_length(question) BETWEEN 2 AND 300),
  question_key     TEXT NOT NULL CHECK (char_length(question_key) BETWEEN 2 AND 300),
  reply            TEXT NOT NULL CHECK (char_length(reply) BETWEEN 1 AND 1200),
  actions          JSONB NOT NULL DEFAULT '[]'::jsonb,
  suggestions      JSONB NOT NULL DEFAULT '[]'::jsonb,
  status           TEXT NOT NULL DEFAULT 'learned' CHECK (status IN ('learned', 'pinned', 'muted')),
  facts_hash       TEXT,
  hits             INTEGER NOT NULL DEFAULT 0,
  helpful          INTEGER NOT NULL DEFAULT 0,
  unhelpful        INTEGER NOT NULL DEFAULT 0,
  last_hit_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (cmms_company_id, question_key)
);

-- pg_trgm may live in `extensions` (Supabase) or `public`: make the operator class resolvable either way.
DO $$
BEGIN
  PERFORM set_config('search_path', 'public, extensions', true);
  EXECUTE 'CREATE INDEX IF NOT EXISTS business_chat_memory_key_trgm ON public.business_chat_memory USING gin (question_key gin_trgm_ops)';
END $$;
CREATE INDEX IF NOT EXISTS business_chat_memory_company_idx
  ON public.business_chat_memory (cmms_company_id, status, hits DESC);

ALTER TABLE public.business_chat_memory ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.business_chat_memory FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- Server side (service role only)
-- ------------------------------------------------------------

-- Up to three candidate answers for a question key. Pinned (staff) answers always qualify and come first; learned ones must
-- match the business's current facts and be fresher than p_ttl_days.
CREATE OR REPLACE FUNCTION public.fn_chat_memory_lookup(
  p_company_id UUID, p_key TEXT, p_facts_hash TEXT, p_min_similarity REAL DEFAULT 0.45, p_ttl_days INTEGER DEFAULT 14
) RETURNS TABLE (id UUID, question_key TEXT, reply TEXT, actions JSONB, suggestions JSONB, status TEXT, similarity REAL)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
  SELECT m.id, m.question_key, m.reply, m.actions, m.suggestions, m.status, similarity(m.question_key, p_key)::REAL AS similarity
  FROM public.business_chat_memory m
  WHERE m.cmms_company_id = p_company_id
    AND (
      m.status = 'pinned'
      OR (m.status = 'learned' AND m.facts_hash IS NOT DISTINCT FROM p_facts_hash AND m.updated_at > now() - make_interval(days => p_ttl_days))
    )
    AND similarity(m.question_key, p_key) >= p_min_similarity
  ORDER BY (m.status = 'pinned') DESC, similarity(m.question_key, p_key) DESC
  LIMIT 3;
$$;

CREATE OR REPLACE FUNCTION public.fn_chat_memory_hit(p_id UUID) RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.business_chat_memory SET hits = hits + 1, last_hit_at = now() WHERE id = p_id;
$$;

-- Remember (or refresh) an answer. Staff-pinned answers are never overwritten; a muted answer is only replaced once the
-- business's facts have changed since it was muted.
CREATE OR REPLACE FUNCTION public.fn_chat_memory_store(
  p_company_id UUID, p_question TEXT, p_key TEXT, p_reply TEXT, p_actions JSONB, p_suggestions JSONB, p_facts_hash TEXT
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO public.business_chat_memory AS m (cmms_company_id, question, question_key, reply, actions, suggestions, facts_hash)
  VALUES (p_company_id, left(p_question, 300), left(p_key, 300), left(p_reply, 1200),
          COALESCE(p_actions, '[]'::jsonb), COALESCE(p_suggestions, '[]'::jsonb), p_facts_hash)
  ON CONFLICT (cmms_company_id, question_key) DO UPDATE
    SET reply = EXCLUDED.reply, actions = EXCLUDED.actions, suggestions = EXCLUDED.suggestions,
        facts_hash = EXCLUDED.facts_hash, status = 'learned', helpful = 0, unhelpful = 0, updated_at = now()
    WHERE m.status = 'learned' OR (m.status = 'muted' AND m.facts_hash IS DISTINCT FROM EXCLUDED.facts_hash)
  RETURNING m.id INTO v_id;

  -- a company's memory stays small: keep its 300 most-used learned answers (staff-pinned ones are never pruned)
  DELETE FROM public.business_chat_memory d
  WHERE d.id IN (
    SELECT x.id FROM public.business_chat_memory x
    WHERE x.cmms_company_id = p_company_id AND x.status <> 'pinned'
    ORDER BY x.hits DESC, x.updated_at DESC
    OFFSET 300
  );
  RETURN v_id;
END;
$$;

-- A visitor's thumbs up / down on an answer they were shown.
CREATE OR REPLACE FUNCTION public.fn_chat_memory_feedback(p_company_id UUID, p_id UUID, p_helpful BOOLEAN) RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.business_chat_memory m
  SET helpful   = m.helpful   + CASE WHEN p_helpful THEN 1 ELSE 0 END,
      unhelpful = m.unhelpful + CASE WHEN p_helpful THEN 0 ELSE 1 END,
      status    = CASE
                    WHEN m.status = 'learned' AND NOT p_helpful AND m.unhelpful + 1 >= 2 AND m.unhelpful + 1 > m.helpful THEN 'muted'
                    ELSE m.status
                  END
  WHERE m.id = p_id AND m.cmms_company_id = p_company_id;
$$;

REVOKE ALL ON FUNCTION public.fn_chat_memory_lookup(UUID, TEXT, TEXT, REAL, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_chat_memory_hit(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_chat_memory_store(UUID, TEXT, TEXT, TEXT, JSONB, JSONB, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_chat_memory_feedback(UUID, UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_chat_memory_lookup(UUID, TEXT, TEXT, REAL, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_chat_memory_hit(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_chat_memory_store(UUID, TEXT, TEXT, TEXT, JSONB, JSONB, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_chat_memory_feedback(UUID, UUID, BOOLEAN) TO service_role;

-- ------------------------------------------------------------
-- Staff side (signed in, same rule as the Inquiries tab)
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_cmms_chat_memory_list(p_company_id UUID)
RETURNS TABLE (id UUID, question TEXT, reply TEXT, status TEXT, hits INTEGER, helpful INTEGER, unhelpful INTEGER, last_hit_at TIMESTAMPTZ, updated_at TIMESTAMPTZ)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public._cmms_can_handle_inquiries(p_company_id) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  RETURN QUERY
    SELECT m.id, m.question, m.reply, m.status, m.hits, m.helpful, m.unhelpful, m.last_hit_at, m.updated_at
    FROM public.business_chat_memory m
    WHERE m.cmms_company_id = p_company_id
    ORDER BY (m.status = 'pinned') DESC, m.hits DESC, m.updated_at DESC
    LIMIT 300;
END;
$$;

-- Edit an answer and/or change its status. Editing the words pins the answer (the team's version is served from then on).
CREATE OR REPLACE FUNCTION public.fn_cmms_chat_memory_update(p_id UUID, p_reply TEXT DEFAULT NULL, p_status TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_company UUID;
BEGIN
  SELECT cmms_company_id INTO v_company FROM public.business_chat_memory WHERE business_chat_memory.id = p_id;
  IF v_company IS NULL THEN RAISE EXCEPTION 'That answer no longer exists'; END IF;
  IF NOT public._cmms_can_handle_inquiries(v_company) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF p_status IS NOT NULL AND p_status NOT IN ('learned', 'pinned', 'muted') THEN RAISE EXCEPTION 'Unknown status'; END IF;
  IF p_reply IS NOT NULL AND char_length(btrim(p_reply)) NOT BETWEEN 1 AND 1200 THEN RAISE EXCEPTION 'The answer must be 1 to 1200 characters'; END IF;
  UPDATE public.business_chat_memory m
  SET reply = COALESCE(btrim(p_reply), m.reply),
      status = COALESCE(p_status, CASE WHEN p_reply IS NOT NULL THEN 'pinned' ELSE m.status END),
      -- a re-learned or re-enabled answer starts with a clean vote count
      helpful = CASE WHEN p_status = 'learned' THEN 0 ELSE m.helpful END,
      unhelpful = CASE WHEN p_status = 'learned' THEN 0 ELSE m.unhelpful END,
      updated_at = now()
  WHERE m.id = p_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_cmms_chat_memory_delete(p_id UUID) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_company UUID;
BEGIN
  SELECT cmms_company_id INTO v_company FROM public.business_chat_memory WHERE business_chat_memory.id = p_id;
  IF v_company IS NULL THEN RETURN; END IF;
  IF NOT public._cmms_can_handle_inquiries(v_company) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  DELETE FROM public.business_chat_memory WHERE business_chat_memory.id = p_id;
END;
$$;

-- Teach the assistant a question and the answer to give. The key is computed in the app (src/utils/chatQuestionKey.js).
CREATE OR REPLACE FUNCTION public.fn_cmms_chat_memory_teach(p_company_id UUID, p_question TEXT, p_key TEXT, p_reply TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id UUID;
BEGIN
  IF NOT public._cmms_can_handle_inquiries(p_company_id) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF char_length(btrim(COALESCE(p_question, ''))) NOT BETWEEN 3 AND 300 THEN RAISE EXCEPTION 'The question must be 3 to 300 characters'; END IF;
  IF char_length(btrim(COALESCE(p_reply, ''))) NOT BETWEEN 1 AND 1200 THEN RAISE EXCEPTION 'The answer must be 1 to 1200 characters'; END IF;
  IF char_length(COALESCE(p_key, '')) < 2 THEN RAISE EXCEPTION 'Write the question with a few more words'; END IF;
  INSERT INTO public.business_chat_memory AS m (cmms_company_id, question, question_key, reply, status, facts_hash)
  VALUES (p_company_id, btrim(p_question), left(p_key, 300), btrim(p_reply), 'pinned', NULL)
  ON CONFLICT (cmms_company_id, question_key) DO UPDATE
    SET question = EXCLUDED.question, reply = EXCLUDED.reply, status = 'pinned', facts_hash = NULL,
        helpful = 0, unhelpful = 0, updated_at = now()
  RETURNING m.id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_cmms_chat_memory_list(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_cmms_chat_memory_update(UUID, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_cmms_chat_memory_delete(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_cmms_chat_memory_teach(UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_cmms_chat_memory_list(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_cmms_chat_memory_update(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_cmms_chat_memory_delete(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_cmms_chat_memory_teach(UUID, TEXT, TEXT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
