-- Lets a business/company visiting someone's public /portfolio/<handle> page
-- request that person's academic certificate (result slip / transcript —
-- most people know these documents as "certificates", so that's the term
-- used throughout this feature), and lets the owner approve (attaching the
-- document, uploaded to R2 — reuses the existing 'portfolio-chat' folder
-- from backend/routes/storageRoutes.js rather than adding a new one, so no
-- backend redeploy is needed for uploads to work) or deny the request.
--
-- Modeled directly on CREATE_PORTFOLIO_DIRECT_MESSAGES.sql's
-- portfolio_conversations table: a visitor may be a signed-in ICAN user OR an
-- anonymous guest (the same localStorage guest_id from
-- frontend/src/utils/portfolioGuestId.js), and — for the same reason RLS
-- can't authenticate an anonymous guest_id the way it authenticates
-- auth.uid() — every write goes through the SECURITY DEFINER RPCs below,
-- never directly against the table. Authenticated participants (owner and
-- signed-in requester) get direct table SELECT for their own dashboard views.
--
-- Idempotent: safe to run more than once.

CREATE TABLE IF NOT EXISTS public.portfolio_certificate_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  requester_user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  guest_id TEXT,
  guest_name TEXT,
  requester_company_name TEXT NOT NULL,
  requester_email TEXT NOT NULL,
  requester_phone TEXT,
  message TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied')),
  certificate_url TEXT,
  certificate_path TEXT,
  response_note TEXT,
  responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT portfolio_certificate_requests_requester_identity CHECK (
    (requester_user_id IS NOT NULL AND guest_id IS NULL) OR
    (requester_user_id IS NULL AND guest_id IS NOT NULL)
  ),
  CONSTRAINT portfolio_certificate_requests_no_self_request CHECK (requester_user_id IS DISTINCT FROM owner_user_id)
);

CREATE INDEX IF NOT EXISTS idx_portfolio_certificate_requests_owner
  ON public.portfolio_certificate_requests(owner_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_portfolio_certificate_requests_requester
  ON public.portfolio_certificate_requests(requester_user_id) WHERE requester_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_portfolio_certificate_requests_guest
  ON public.portfolio_certificate_requests(owner_user_id, guest_id) WHERE guest_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.update_portfolio_certificate_requests_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_portfolio_certificate_requests_updated_at ON public.portfolio_certificate_requests;
CREATE TRIGGER trg_portfolio_certificate_requests_updated_at
  BEFORE UPDATE ON public.portfolio_certificate_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_portfolio_certificate_requests_updated_at();

-- ── RLS: authenticated participants get direct table SELECT (owner's
--       Portfolio-tab card + a signed-in requester checking their own sent
--       requests). No INSERT/UPDATE policy for anyone — every write goes
--       through the RPCs below. ────────────────────────────────────────────
ALTER TABLE public.portfolio_certificate_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "portfolio_certificate_requests_participant_read" ON public.portfolio_certificate_requests;
CREATE POLICY "portfolio_certificate_requests_participant_read" ON public.portfolio_certificate_requests
  FOR SELECT TO authenticated
  USING (auth.uid() = owner_user_id OR auth.uid() = requester_user_id);

-- ── RPCs (SECURITY DEFINER) — the only way any client writes here ─────────

-- A company (signed-in auth.uid(), or an anonymous guest identified by
-- p_guest_id) requests p_owner_user_id's certificate. Refuses a profile with
-- no public resume, and refuses a self-request.
CREATE OR REPLACE FUNCTION public.request_portfolio_certificate(
  p_owner_user_id UUID,
  p_requester_company_name TEXT,
  p_requester_email TEXT,
  p_requester_phone TEXT DEFAULT NULL,
  p_message TEXT DEFAULT NULL,
  p_guest_id TEXT DEFAULT NULL,
  p_guest_name TEXT DEFAULT NULL
)
RETURNS UUID
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_requester_id UUID := auth.uid();
  v_request_id UUID;
BEGIN
  IF p_owner_user_id IS NULL THEN
    RAISE EXCEPTION 'owner_user_id is required';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    JOIN public.user_portfolios up ON up.user_id = p.id
    WHERE p.id = p_owner_user_id AND p.handle IS NOT NULL AND up.is_public = true
  ) THEN
    RAISE EXCEPTION 'This profile is not accepting certificate requests';
  END IF;

  IF btrim(COALESCE(p_requester_company_name, '')) = '' THEN
    RAISE EXCEPTION 'Company/organization name is required';
  END IF;
  IF btrim(COALESCE(p_requester_email, '')) = '' THEN
    RAISE EXCEPTION 'A contact email is required';
  END IF;

  IF v_requester_id IS NOT NULL THEN
    IF v_requester_id = p_owner_user_id THEN
      RAISE EXCEPTION 'Cannot request your own certificate';
    END IF;
  ELSIF p_guest_id IS NULL OR btrim(p_guest_id) = '' THEN
    RAISE EXCEPTION 'guest_id is required for an anonymous requester';
  END IF;

  INSERT INTO public.portfolio_certificate_requests (
    owner_user_id, requester_user_id, guest_id, guest_name,
    requester_company_name, requester_email, requester_phone, message
  ) VALUES (
    p_owner_user_id, v_requester_id,
    CASE WHEN v_requester_id IS NULL THEN p_guest_id ELSE NULL END,
    CASE WHEN v_requester_id IS NULL THEN NULLIF(btrim(COALESCE(p_guest_name, '')), '') ELSE NULL END,
    btrim(p_requester_company_name), btrim(p_requester_email),
    NULLIF(btrim(COALESCE(p_requester_phone, '')), ''), NULLIF(btrim(COALESCE(p_message, '')), '')
  )
  RETURNING id INTO v_request_id;

  RETURN v_request_id;
END;
$$;

-- Owner approves (optionally attaching the certificate file, already uploaded
-- to R2's 'portfolio-chat' folder by the caller) or denies a request.
CREATE OR REPLACE FUNCTION public.respond_portfolio_certificate_request(
  p_request_id UUID,
  p_action TEXT,
  p_certificate_url TEXT DEFAULT NULL,
  p_certificate_path TEXT DEFAULT NULL,
  p_note TEXT DEFAULT NULL
)
RETURNS public.portfolio_certificate_requests
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_status VARCHAR(20);
  v_result public.portfolio_certificate_requests;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Must be signed in';
  END IF;

  IF p_action NOT IN ('approve', 'deny') THEN
    RAISE EXCEPTION 'action must be approve or deny';
  END IF;
  v_status := CASE WHEN p_action = 'approve' THEN 'approved' ELSE 'denied' END;

  UPDATE public.portfolio_certificate_requests
  SET status = v_status,
      certificate_url = CASE WHEN p_action = 'approve' THEN COALESCE(p_certificate_url, certificate_url) ELSE certificate_url END,
      certificate_path = CASE WHEN p_action = 'approve' THEN COALESCE(p_certificate_path, certificate_path) ELSE certificate_path END,
      response_note = NULLIF(btrim(COALESCE(p_note, '')), ''),
      responded_at = NOW()
  WHERE id = p_request_id AND owner_user_id = v_uid
  RETURNING * INTO v_result;

  IF v_result IS NULL THEN
    RAISE EXCEPTION 'Request not found or not authorized';
  END IF;

  RETURN v_result;
END;
$$;

-- Owner's incoming list (Portfolio-tab "Certificate Requests" card).
CREATE OR REPLACE FUNCTION public.get_my_certificate_requests()
RETURNS SETOF public.portfolio_certificate_requests
SECURITY DEFINER
SET search_path = public
LANGUAGE sql
STABLE
AS $$
  SELECT * FROM public.portfolio_certificate_requests
  WHERE owner_user_id = auth.uid()
  ORDER BY created_at DESC;
$$;

-- Requester's own sent-requests list (signed-in via auth.uid(), or an
-- anonymous guest presenting the same guest_id they requested with).
CREATE OR REPLACE FUNCTION public.get_sent_certificate_requests(p_guest_id TEXT DEFAULT NULL)
RETURNS SETOF public.portfolio_certificate_requests
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NOT NULL THEN
    RETURN QUERY
    SELECT * FROM public.portfolio_certificate_requests
    WHERE requester_user_id = v_uid
    ORDER BY created_at DESC;
  ELSIF p_guest_id IS NOT NULL AND btrim(p_guest_id) <> '' THEN
    RETURN QUERY
    SELECT * FROM public.portfolio_certificate_requests
    WHERE guest_id = p_guest_id
    ORDER BY created_at DESC;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.request_portfolio_certificate(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.respond_portfolio_certificate_request(UUID, TEXT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_certificate_requests() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_sent_certificate_requests(TEXT) TO anon, authenticated;

-- Realtime for the owner's dashboard card — authenticated RLS above already
-- restricts postgres_changes payloads to rows the subscriber can SELECT.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'portfolio_certificate_requests'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.portfolio_certificate_requests;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

SELECT 'Portfolio certificate requests table and RPCs created' AS status;
