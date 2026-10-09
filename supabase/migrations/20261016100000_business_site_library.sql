-- ============================================================
-- Business website "Library" tab (/notices/<company>?tab=library)
--
-- One place on the company's public website that collects the public links the business has created
-- elsewhere in CMMS: shared reports, shared report exports, consultation forms, service-provider contracts,
-- plus any other link the team adds by hand (a Drive folder, a brochure, a form...).
--
-- Opt-in, never automatic: creating a share link somewhere in CMMS does NOT put it on the website. Staff with
-- edit access to the company's public board choose which links to list (CMMS > Posts & Jobs > Library).
--
-- Locked links stay locked. A listing never opens anything by itself:
--   * report / report export  -> the viewer page still asks for the share's password or an allowed email
--   * service-provider contract -> the contract page still asks for its PIN or allowed email
--   * manual link with a PIN  -> the address is NOT sent to the browser at all; it is only released by
--                                fn_public_site_link_unlock after the right PIN (5 wrong tries = 15 min lock)
-- So a visitor can see that a protected document exists, but must know the credential to read it.
--
-- Everything goes through SECURITY DEFINER functions; the table is not readable by anon/authenticated.
-- Requires: CMMS_ANNOUNCEMENTS_AND_JOBS.sql (cmms_has_tool_action, cmms_company_profiles).
-- The share sources are optional: a source whose table is not installed is simply skipped.
-- Safe to run more than once.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.cmms_site_links (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cmms_company_id UUID NOT NULL REFERENCES public.cmms_company_profiles(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind IN ('report', 'report_export', 'consultation_form', 'service_contract', 'custom')),
  -- the share / form / contract being listed; NULL for a manual ('custom') link
  source_id       UUID,
  -- optional overrides of what the source calls itself
  title           TEXT CHECK (title IS NULL OR char_length(title) BETWEEN 1 AND 120),
  description     TEXT CHECK (description IS NULL OR char_length(description) <= 300),
  -- manual links only
  custom_url      TEXT CHECK (custom_url IS NULL OR (char_length(custom_url) <= 1000 AND custom_url ~* '^https?://[^\s]+$')),
  pin_hash        TEXT,
  failed_attempts INT NOT NULL DEFAULT 0,
  locked_until    TIMESTAMPTZ,
  featured        BOOLEAN NOT NULL DEFAULT FALSE,
  created_by      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT cmms_site_links_shape_chk CHECK (
    (kind = 'custom'  AND source_id IS NULL AND custom_url IS NOT NULL AND title IS NOT NULL)
    OR (kind <> 'custom' AND source_id IS NOT NULL AND custom_url IS NULL AND pin_hash IS NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS cmms_site_links_source_uq
  ON public.cmms_site_links (cmms_company_id, kind, source_id) WHERE source_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS cmms_site_links_company_idx
  ON public.cmms_site_links (cmms_company_id, featured DESC, created_at DESC);

ALTER TABLE public.cmms_site_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cmms_site_links FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- Who may curate the Library: whoever can edit the company's public board.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._cmms_can_manage_site_links(p_company_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND public.cmms_has_tool_action(p_company_id, 'announcements', 'edit');
$$;
REVOKE ALL ON FUNCTION public._cmms_can_manage_site_links(UUID) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- Every shareable link this company currently has, from every module that can mint one.
-- is_live = false for revoked / expired / switched-off sources (so staff can see why a listing went dark).
-- lock_kind: none | password | email | pin
-- Internal: only the functions below call it.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._cmms_site_link_sources(p_company_id UUID)
RETURNS TABLE (
  kind          TEXT,
  source_id     UUID,
  default_title TEXT,
  default_desc  TEXT,
  lock_kind     TEXT,
  path          TEXT,
  expires_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ,
  is_live       BOOLEAN
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_profile UUID;
BEGIN
  SELECT business_profile_id INTO v_profile FROM public.cmms_company_profiles WHERE id = p_company_id;

  -- 1. Shared reports (/reports/<token>)
  IF to_regclass('public.cmms_report_shares') IS NOT NULL AND to_regclass('public.cmms_company_reports') IS NOT NULL THEN
    RETURN QUERY
    SELECT 'report'::TEXT, s.id, r.report_title::TEXT, NULL::TEXT,
           CASE s.visibility WHEN 'password' THEN 'password' WHEN 'restricted' THEN 'email' ELSE 'none' END,
           '/reports/' || s.token, s.expires_at, s.created_at,
           (s.revoked_at IS NULL AND (s.expires_at IS NULL OR s.expires_at > now()))
      FROM public.cmms_report_shares s
      JOIN public.cmms_company_reports r ON r.id = s.report_id
     WHERE s.cmms_company_id = p_company_id;
  END IF;

  -- 2. Shared report exports (/report-exports/<token>)
  IF to_regclass('public.cmms_report_export_shares') IS NOT NULL THEN
    RETURN QUERY
    SELECT 'report_export'::TEXT, s.id,
           ('Reports: ' || CASE s.department_filter
                             WHEN 'all' THEN 'all departments'
                             WHEN 'unassigned' THEN 'no department'
                             ELSE COALESCE((SELECT d.department_name FROM public.cmms_departments d
                                             WHERE d.id::TEXT = s.department_filter), 'one department')
                           END)::TEXT,
           NULL::TEXT,
           CASE s.visibility WHEN 'password' THEN 'password' WHEN 'restricted' THEN 'email' ELSE 'none' END,
           '/report-exports/' || s.token, s.expires_at, s.created_at,
           (s.revoked_at IS NULL AND (s.expires_at IS NULL OR s.expires_at > now()))
      FROM public.cmms_report_export_shares s
     WHERE s.cmms_company_id = p_company_id;
  END IF;

  -- 3. Consultation forms (/consultation-forms/<token>) -- belong to the company's linked business profile
  IF v_profile IS NOT NULL AND to_regclass('public.cmms_consultation_forms') IS NOT NULL THEN
    RETURN QUERY
    SELECT 'consultation_form'::TEXT, f.id, f.name::TEXT, f.description::TEXT, 'none'::TEXT,
           '/consultation-forms/' || f.share_token::TEXT, NULL::TIMESTAMPTZ, f.created_at,
           (f.share_enabled AND f.is_active)
      FROM public.cmms_consultation_forms f
     WHERE f.business_profile_id = v_profile;
  END IF;

  -- 4. Service-provider contracts (/service-provider-contract?token=...). Only the contract's title is
  --    ever shown -- never the contractor's name, contact or terms.
  IF to_regclass('public.cmms_service_provider_contracts') IS NOT NULL THEN
    RETURN QUERY
    SELECT 'service_contract'::TEXT, c.id, c.title::TEXT, NULL::TEXT,
           CASE c.access_mode WHEN 'pin' THEN 'pin' ELSE 'email' END,
           '/service-provider-contract?token=' || c.access_token, c.valid_until, c.created_at,
           (c.status = 'published' AND c.revoked_at IS NULL AND c.valid_until > now() AND c.valid_from <= now())
      FROM public.cmms_service_provider_contracts c
     WHERE c.cmms_company_id = p_company_id;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public._cmms_site_link_sources(UUID) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- Visitor side (anon + authenticated)
-- ------------------------------------------------------------

-- The listed, live links. Protected manual links come back WITHOUT their address.
CREATE OR REPLACE FUNCTION public.fn_public_site_links(p_company_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
  IF p_company_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.cmms_company_profiles WHERE id = p_company_id) THEN
    RETURN '[]'::jsonb;
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(item ORDER BY featured DESC, created_at DESC)
      FROM (
        SELECT l.featured, l.created_at,
               jsonb_build_object(
                 'id', l.id,
                 'kind', l.kind,
                 'title', COALESCE(l.title, s.default_title, 'Untitled'),
                 'description', COALESCE(l.description, s.default_desc),
                 'lock', CASE WHEN l.kind = 'custom' THEN CASE WHEN l.pin_hash IS NULL THEN 'none' ELSE 'pin' END
                              ELSE s.lock_kind END,
                 'path', s.path,
                 'url', CASE WHEN l.kind = 'custom' AND l.pin_hash IS NULL THEN l.custom_url END,
                 'expires_at', s.expires_at,
                 'featured', l.featured,
                 'listed_at', l.created_at
               ) AS item
          FROM public.cmms_site_links l
          LEFT JOIN public._cmms_site_link_sources(p_company_id) s
                 ON l.kind <> 'custom' AND s.kind = l.kind AND s.source_id = l.source_id
         WHERE l.cmms_company_id = p_company_id
           AND (l.kind = 'custom' OR COALESCE(s.is_live, FALSE))
         ORDER BY l.featured DESC, l.created_at DESC
         LIMIT 100
      ) x
  ), '[]'::jsonb);
END;
$$;

-- Release a PIN-protected manual link's address. Wrong PINs lock the link for 15 minutes after 5 tries.
CREATE OR REPLACE FUNCTION public.fn_public_site_link_unlock(p_company_id UUID, p_link_id UUID, p_pin TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_link public.cmms_site_links%ROWTYPE;
BEGIN
  SELECT * INTO v_link FROM public.cmms_site_links
   WHERE id = p_link_id AND cmms_company_id = p_company_id AND kind = 'custom';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'This link is no longer available');
  END IF;
  IF v_link.pin_hash IS NULL THEN
    RETURN jsonb_build_object('success', TRUE, 'url', v_link.custom_url);
  END IF;
  IF v_link.locked_until IS NOT NULL AND v_link.locked_until > now() THEN
    RETURN jsonb_build_object('success', FALSE, 'locked', TRUE,
      'error', 'Too many wrong PINs. Try again in a few minutes, or ask the business for help.');
  END IF;
  IF p_pin IS NULL OR char_length(p_pin) < 1 OR char_length(p_pin) > 100
     OR crypt(p_pin, v_link.pin_hash) <> v_link.pin_hash THEN
    UPDATE public.cmms_site_links
       SET failed_attempts = CASE WHEN failed_attempts + 1 >= 5 THEN 0 ELSE failed_attempts + 1 END,
           locked_until    = CASE WHEN failed_attempts + 1 >= 5 THEN now() + interval '15 minutes' ELSE locked_until END
     WHERE id = v_link.id;
    RETURN jsonb_build_object('success', FALSE,
      'error', CASE WHEN v_link.failed_attempts + 1 >= 5
                    THEN 'Too many wrong PINs. This link is locked for 15 minutes.'
                    ELSE 'That PIN is not right' END,
      'locked', v_link.failed_attempts + 1 >= 5);
  END IF;
  UPDATE public.cmms_site_links SET failed_attempts = 0, locked_until = NULL WHERE id = v_link.id;
  RETURN jsonb_build_object('success', TRUE, 'url', v_link.custom_url);
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_public_site_links(UUID)                  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_public_site_link_unlock(UUID, UUID, TEXT) TO anon, authenticated;

-- ------------------------------------------------------------
-- Staff side (signed in, with edit access to the company's announcements tool)
-- ------------------------------------------------------------

-- Everything the Library manager needs in one call:
--   listed    -> what the website shows now (with status: live | expired_or_revoked | missing)
--   available -> live links from other modules that are not on the website yet
CREATE OR REPLACE FUNCTION public.fn_cmms_site_links_overview(p_company_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
  IF NOT public._cmms_can_manage_site_links(p_company_id) THEN
    RAISE EXCEPTION 'You do not have permission to manage this company''s website library';
  END IF;
  RETURN jsonb_build_object(
    'listed', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', l.id,
               'kind', l.kind,
               'source_id', l.source_id,
               'title', l.title,
               'description', l.description,
               'default_title', s.default_title,
               'lock', CASE WHEN l.kind = 'custom' THEN CASE WHEN l.pin_hash IS NULL THEN 'none' ELSE 'pin' END
                            ELSE s.lock_kind END,
               'url', l.custom_url,
               'path', s.path,
               'expires_at', s.expires_at,
               'featured', l.featured,
               'created_at', l.created_at,
               'status', CASE WHEN l.kind = 'custom' THEN 'live'
                              WHEN s.kind IS NULL THEN 'missing'
                              WHEN s.is_live THEN 'live'
                              ELSE 'expired_or_revoked' END
             ) ORDER BY l.featured DESC, l.created_at DESC)
        FROM public.cmms_site_links l
        LEFT JOIN public._cmms_site_link_sources(p_company_id) s
               ON l.kind <> 'custom' AND s.kind = l.kind AND s.source_id = l.source_id
       WHERE l.cmms_company_id = p_company_id
    ), '[]'::jsonb),
    'available', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'kind', s.kind,
               'source_id', s.source_id,
               'default_title', s.default_title,
               'default_desc', s.default_desc,
               'lock', s.lock_kind,
               'expires_at', s.expires_at,
               'created_at', s.created_at
             ) ORDER BY s.created_at DESC)
        FROM public._cmms_site_link_sources(p_company_id) s
       WHERE s.is_live
         AND NOT EXISTS (SELECT 1 FROM public.cmms_site_links l
                          WHERE l.cmms_company_id = p_company_id AND l.kind = s.kind AND l.source_id = s.source_id)
    ), '[]'::jsonb)
  );
END;
$$;

-- Put a link from another module on the website (or edit the title/description of one already there).
CREATE OR REPLACE FUNCTION public.fn_cmms_site_link_list(
  p_company_id  UUID,
  p_kind        TEXT,
  p_source_id   UUID,
  p_title       TEXT DEFAULT NULL,
  p_description TEXT DEFAULT NULL,
  p_featured    BOOLEAN DEFAULT FALSE
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_title TEXT := NULLIF(btrim(COALESCE(p_title, '')), '');
  v_desc  TEXT := NULLIF(btrim(COALESCE(p_description, '')), '');
  v_id    UUID;
BEGIN
  IF NOT public._cmms_can_manage_site_links(p_company_id) THEN
    RAISE EXCEPTION 'You do not have permission to manage this company''s website library';
  END IF;
  IF p_kind NOT IN ('report', 'report_export', 'consultation_form', 'service_contract') THEN
    RAISE EXCEPTION 'Unknown link type';
  END IF;
  -- only a link that really belongs to THIS company can be listed on its website
  IF NOT EXISTS (SELECT 1 FROM public._cmms_site_link_sources(p_company_id) s
                  WHERE s.kind = p_kind AND s.source_id = p_source_id) THEN
    RAISE EXCEPTION 'That link could not be found';
  END IF;
  IF v_title IS NOT NULL AND char_length(v_title) > 120 THEN RAISE EXCEPTION 'Title is too long (120 characters max)'; END IF;
  IF v_desc  IS NOT NULL AND char_length(v_desc)  > 300 THEN RAISE EXCEPTION 'Description is too long (300 characters max)'; END IF;

  INSERT INTO public.cmms_site_links (cmms_company_id, kind, source_id, title, description, featured, created_by)
  VALUES (p_company_id, p_kind, p_source_id, v_title, v_desc, COALESCE(p_featured, FALSE), auth.uid())
  ON CONFLICT (cmms_company_id, kind, source_id) WHERE source_id IS NOT NULL
  DO UPDATE SET title = EXCLUDED.title, description = EXCLUDED.description, featured = EXCLUDED.featured
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- Add or edit a manual link. p_pin: NULL keeps the current PIN, '' removes it, anything else sets it.
CREATE OR REPLACE FUNCTION public.fn_cmms_site_link_save_custom(
  p_company_id  UUID,
  p_link_id     UUID,
  p_title       TEXT,
  p_description TEXT,
  p_url         TEXT,
  p_pin         TEXT DEFAULT NULL,
  p_featured    BOOLEAN DEFAULT FALSE
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_title TEXT := btrim(COALESCE(p_title, ''));
  v_desc  TEXT := NULLIF(btrim(COALESCE(p_description, '')), '');
  v_url   TEXT := btrim(COALESCE(p_url, ''));
  v_id    UUID;
BEGIN
  IF NOT public._cmms_can_manage_site_links(p_company_id) THEN
    RAISE EXCEPTION 'You do not have permission to manage this company''s website library';
  END IF;
  IF char_length(v_title) < 1 OR char_length(v_title) > 120 THEN RAISE EXCEPTION 'Give the link a title (120 characters max)'; END IF;
  IF v_desc IS NOT NULL AND char_length(v_desc) > 300 THEN RAISE EXCEPTION 'Description is too long (300 characters max)'; END IF;
  IF char_length(v_url) > 1000 OR v_url !~* '^https?://[^\s]+$' THEN
    RAISE EXCEPTION 'Enter a full web address starting with https://';
  END IF;
  IF p_pin IS NOT NULL AND p_pin <> '' AND (char_length(p_pin) < 4 OR char_length(p_pin) > 100) THEN
    RAISE EXCEPTION 'A PIN needs at least 4 characters';
  END IF;

  IF p_link_id IS NULL THEN
    IF (SELECT count(*) FROM public.cmms_site_links WHERE cmms_company_id = p_company_id) >= 200 THEN
      RAISE EXCEPTION 'The library is full (200 links). Remove some first.';
    END IF;
    INSERT INTO public.cmms_site_links
      (cmms_company_id, kind, title, description, custom_url, pin_hash, featured, created_by)
    VALUES
      (p_company_id, 'custom', v_title, v_desc, v_url,
       CASE WHEN p_pin IS NULL OR p_pin = '' THEN NULL ELSE crypt(p_pin, gen_salt('bf')) END,
       COALESCE(p_featured, FALSE), auth.uid())
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.cmms_site_links
       SET title = v_title, description = v_desc, custom_url = v_url, featured = COALESCE(p_featured, FALSE),
           pin_hash = CASE WHEN p_pin IS NULL THEN pin_hash
                           WHEN p_pin = '' THEN NULL
                           ELSE crypt(p_pin, gen_salt('bf')) END,
           failed_attempts = CASE WHEN p_pin IS NULL THEN failed_attempts ELSE 0 END,
           locked_until    = CASE WHEN p_pin IS NULL THEN locked_until ELSE NULL END
     WHERE id = p_link_id AND cmms_company_id = p_company_id AND kind = 'custom'
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'Link not found'; END IF;
  END IF;
  RETURN v_id;
END;
$$;

-- Take a link off the website (the underlying share link elsewhere in CMMS is untouched).
CREATE OR REPLACE FUNCTION public.fn_cmms_site_link_remove(p_link_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_company UUID;
BEGIN
  SELECT cmms_company_id INTO v_company FROM public.cmms_site_links WHERE id = p_link_id;
  IF v_company IS NULL OR NOT public._cmms_can_manage_site_links(v_company) THEN
    RAISE EXCEPTION 'Link not found';
  END IF;
  DELETE FROM public.cmms_site_links WHERE id = p_link_id;
  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_cmms_site_link_set_featured(p_link_id UUID, p_featured BOOLEAN)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_company UUID;
BEGIN
  SELECT cmms_company_id INTO v_company FROM public.cmms_site_links WHERE id = p_link_id;
  IF v_company IS NULL OR NOT public._cmms_can_manage_site_links(v_company) THEN
    RAISE EXCEPTION 'Link not found';
  END IF;
  UPDATE public.cmms_site_links SET featured = COALESCE(p_featured, FALSE) WHERE id = p_link_id;
  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_cmms_site_links_overview(UUID)                                   TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_cmms_site_link_list(UUID, TEXT, UUID, TEXT, TEXT, BOOLEAN)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_cmms_site_link_save_custom(UUID, UUID, TEXT, TEXT, TEXT, TEXT, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_cmms_site_link_remove(UUID)                                      TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_cmms_site_link_set_featured(UUID, BOOLEAN)                        TO authenticated;

NOTIFY pgrst, 'reload schema';

SELECT 'Business website Library ready (CMMS public links -> /notices/<company>?tab=library)' AS status;
