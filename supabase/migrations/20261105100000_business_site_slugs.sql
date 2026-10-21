-- ============================================================================
-- Business website addresses: icanera.space/<business-name>
--
-- A business's public website used to live at icanera.space/notices/<long-uuid>. It now has a real, readable address:
--
--     https://icanera.space/godmindera-organisation-u-ltd
--
-- HOW THE ADDRESS IS KEPT TRUE
--   * One address per business (public.cmms_company_profiles.site_slug), enforced by a UNIQUE index. Two businesses can share a
--     NAME (43 companies, 32 distinct names today), never an address: the oldest keeps the plain name, the next one becomes
--     "name-2", then "name-3" ... The platform's own fee business (GODMINDERA ORGANISATION (U) LTD) is always first in line.
--   * Reserved words (every app route such as /pricing, /shop, /notices, plus brand names) can never be an address, so a
--     business can neither shadow a page of the app nor pose as IcanEra, GODMINDERA, SupermartKera or BodaGoEra. Only the platform
--     operator (SQL editor / service role) may assign a brand name, e.g. icanera.space/icanera.
--   * The address is made ONCE and then stays put: renaming a business does not silently break links already printed on
--     receipts and QR codes. A company admin can pick another address (checked by the same rules); the old one is kept in
--     public.cmms_company_site_slug_history and keeps opening the same site, so no printed link ever dies.
--   * The old /notices/<uuid> links keep working exactly as before.
--
-- WHAT THIS ADDS
--   public.cmms_company_profiles.site_slug         the address (3-60 chars: a-z, 0-9, single hyphens)
--   public.cmms_company_site_slug_history          retired addresses (never readable by clients directly)
--   public.fn_site_slugify(text)                   "Café & Bar (U) Ltd" -> "cafe-and-bar-u-ltd"
--   public.fn_site_slug_is_reserved(text)          the reserved list: app routes + brand names (kept equal to frontend/src/utils/businessSiteUrl.js by a test)
--   public.fn_site_slug_is_brand(text)             the brand-name part of it
--   public.fn_allocate_company_site_slug(...)      next free address for a name (internal)
--   public.fn_check_site_slug(slug, company)       for the "choose your address" box: available? and why not
--   public.fn_resolve_public_site_slug(slug)       anon: address -> company (current or retired address)
--   public.fn_get_public_site_slugs(uuid[])        anon: company ids -> addresses, for building links in one call
--
-- Run after: the CMMS company profile schema. Safe to run more than once.
-- ============================================================================

DO $$ BEGIN
  IF to_regclass('public.cmms_company_profiles') IS NULL THEN
    RAISE EXCEPTION 'public.cmms_company_profiles does not exist: apply the CMMS company profile schema first.';
  END IF;
END $$;

ALTER TABLE public.cmms_company_profiles ADD COLUMN IF NOT EXISTS site_slug TEXT;

-- Retired addresses. Clients never read this table; only the functions below do.
CREATE TABLE IF NOT EXISTS public.cmms_company_site_slug_history (
  slug       TEXT PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.cmms_company_profiles(id) ON DELETE CASCADE,
  retired_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cmms_company_site_slug_history_company ON public.cmms_company_site_slug_history (company_id);
ALTER TABLE public.cmms_company_site_slug_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cmms_company_site_slug_history FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Name -> address text
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_site_slugify(p_name TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT btrim(
    regexp_replace(
      replace(
        translate(
          replace(replace(replace(lower(COALESCE(p_name, '')), 'ß', 'ss'), 'æ', 'ae'), 'œ', 'oe'),
          'àáâãäåāăąçćčďđèéêëēėęěğìíîïīįıłńňñòóôõöøōőŕřśšşșťţțùúûüūůűųýÿźżž',
          'aaaaaaaaaccc' || 'dd' || 'eeeeeeee' || 'g' || 'iiiiiii' || 'l' || 'nnn' || 'oooooooo' || 'rr' || 'ssss' || 'ttt' || 'uuuuuuuu' || 'yy' || 'zzz'
        ),
        '&', ' and '
      ),
      '[^a-z0-9]+', '-', 'g'
    ),
    '-'
  );
$$;

-- Brand names. End users can never take them (nobody can pose as IcanEra, GODMINDERA or one of its apps), but the platform
-- operator can assign one from the SQL editor / service role (no signed-in user), e.g. icanera.space/icanera for the IcanEra company.
-- KEEP IN STEP with BRAND_SITE_SLUGS in frontend/src/utils/businessSiteUrl.js (frontend/tests/businessSiteUrl.test.js checks it).
CREATE OR REPLACE FUNCTION public.fn_site_slug_is_brand(p_slug TEXT)
RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE AS $$
  SELECT lower(btrim(COALESCE(p_slug, ''))) = ANY (ARRAY[
    'bodago','bodagoera','godmindera','ican','icanera','icanera-official','iwos','supermartkera'
  ]);
$$;

-- Words that can never be a business address: every top-level route the app or the host serves, plus the brand names above.
-- KEEP IN STEP with ROUTE_SITE_SLUGS in frontend/src/utils/businessSiteUrl.js (frontend/tests/businessSiteUrl.test.js checks it).
CREATE OR REPLACE FUNCTION public.fn_site_slug_is_reserved(p_slug TEXT)
RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE AS $$
  SELECT public.fn_site_slug_is_brand(p_slug)
      OR lower(btrim(COALESCE(p_slug, ''))) = ANY (ARRAY[
    'about','admin','api','app','assets','auth','billing','buy-ican','callback','candidate-document','candidate-interview',
    'candidate-test','card-pay','careers','checkout','confirm-delete-account','consultation-forms','contact','contract','dashboard','decoy-portal',
    'developers','dist','document','drive','edit','explore','favicon','file','forms','health','help','home','icaneracoin','icons',
    'images','index','invest','investments','invite','jobs','js','login','logout','manifest','new','notice','notices','notifications',
    'null','official','open','pay','pitch','pitchin','plan','plans','portfolio','presentation','pricing','privacy','public','register',
    'report-exports','reports','reset-password','reset-pin','robots','search','sell-ican','service-provider-contract','settings','share',
    'shop','sign-in','sign-up','signin','signup','sitemap','spreadsheets','staff','staff-attendance','stake-ican','static','status',
    'store','support','support-console','sw','team','terms','test-share','transfer-ican','undefined','verify-agreement','verify-document',
    'visitor-check-in','wallet','www'
  ]);
$$;

-- Is this address spoken for? A company may always take back an address that was once its own.
CREATE OR REPLACE FUNCTION public.fn_site_slug_taken(p_slug TEXT, p_except_company UUID DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
           SELECT 1 FROM public.cmms_company_profiles cp
           WHERE lower(cp.site_slug) = lower(p_slug) AND (p_except_company IS NULL OR cp.id <> p_except_company)
         )
      OR EXISTS (
           SELECT 1 FROM public.cmms_company_site_slug_history h
           WHERE h.slug = lower(p_slug) AND (p_except_company IS NULL OR h.company_id <> p_except_company)
         );
$$;
REVOKE ALL ON FUNCTION public.fn_site_slug_taken(TEXT, UUID) FROM PUBLIC, anon, authenticated;

-- The address a name would get: slugified, at most 60 characters, at least 3, never reserved.
CREATE OR REPLACE FUNCTION public.fn_site_slug_base(p_name TEXT)
RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v TEXT := left(public.fn_site_slugify(p_name), 60);
BEGIN
  v := btrim(v, '-');
  IF v = '' THEN v := 'business'; END IF;
  IF length(v) < 3 THEN v := v || '-business'; END IF;
  IF public.fn_site_slug_is_reserved(v) THEN v := left(v, 50) || '-business'; END IF;
  RETURN v;
END $$;

-- Next free address for a name: "name", then "name-2", "name-3" ... Serialised so two businesses created at the same moment can
-- never be handed the same one (the UNIQUE index below is the last line of defence).
CREATE OR REPLACE FUNCTION public.fn_allocate_company_site_slug(p_name TEXT, p_company_id UUID DEFAULT NULL)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_base TEXT := public.fn_site_slug_base(p_name);
  v_try  TEXT := v_base;
  v_n    INT  := 1;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('cmms_company_site_slug'));
  WHILE public.fn_site_slug_taken(v_try, p_company_id) OR public.fn_site_slug_is_reserved(v_try) LOOP
    v_n := v_n + 1;
    v_try := left(v_base, 60 - length(v_n::TEXT) - 1) || '-' || v_n;
  END LOOP;
  RETURN v_try;
END $$;
REVOKE ALL ON FUNCTION public.fn_allocate_company_site_slug(TEXT, UUID) FROM PUBLIC, anon, authenticated;

-- Why an address a person typed can or cannot be used. Returns NULL when it is fine.
CREATE OR REPLACE FUNCTION public.fn_site_slug_problem(p_slug TEXT, p_company_id UUID DEFAULT NULL)
RETURNS TEXT
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v TEXT := lower(btrim(COALESCE(p_slug, '')));
BEGIN
  IF length(v) < 3 OR length(v) > 60 THEN
    RETURN 'Use 3 to 60 characters.';
  END IF;
  IF v !~ '^[a-z0-9]+(-[a-z0-9]+)*$' THEN
    RETURN 'Use only letters, numbers and single hyphens (no spaces or symbols).';
  END IF;
  -- A brand name may be assigned by the platform operator (no signed-in user), never by a customer; app routes by nobody.
  IF public.fn_site_slug_is_reserved(v) AND NOT (auth.uid() IS NULL AND public.fn_site_slug_is_brand(v)) THEN
    RETURN 'That address is reserved. Please choose another.';
  END IF;
  IF public.fn_site_slug_taken(v, p_company_id) THEN
    RETURN 'That address is already used by another business.';
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.fn_site_slug_problem(TEXT, UUID) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Keep every row's address valid and unique
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.trg_cmms_company_site_slug()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_problem TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.site_slug IS NULL OR btrim(NEW.site_slug) = '' THEN
      NEW.site_slug := public.fn_allocate_company_site_slug(NEW.company_name, NEW.id);
      RETURN NEW;
    END IF;
  ELSIF NEW.site_slug IS NOT DISTINCT FROM OLD.site_slug THEN
    RETURN NEW;
  ELSIF NEW.site_slug IS NULL OR btrim(NEW.site_slug) = '' THEN
    -- A business always has an address; clearing the field (or a stale form that omits it) keeps the one it has.
    NEW.site_slug := COALESCE(OLD.site_slug, public.fn_allocate_company_site_slug(NEW.company_name, NEW.id));
    RETURN NEW;
  END IF;

  NEW.site_slug := lower(btrim(NEW.site_slug));
  PERFORM pg_advisory_xact_lock(hashtext('cmms_company_site_slug'));
  v_problem := public.fn_site_slug_problem(NEW.site_slug, NEW.id);
  IF v_problem IS NOT NULL THEN
    RAISE EXCEPTION '%', v_problem USING ERRCODE = '23505', HINT = 'site_slug';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.site_slug IS NOT NULL THEN
      -- The old address keeps opening this business's site.
      INSERT INTO public.cmms_company_site_slug_history (slug, company_id) VALUES (OLD.site_slug, NEW.id)
      ON CONFLICT (slug) DO UPDATE SET company_id = EXCLUDED.company_id, retired_at = now();
    END IF;
  END IF;
  -- Taking back an address that was once its own: it is current again, not retired.
  DELETE FROM public.cmms_company_site_slug_history WHERE slug = NEW.site_slug AND company_id = NEW.id;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS cmms_company_site_slug ON public.cmms_company_profiles;
CREATE TRIGGER cmms_company_site_slug
  BEFORE INSERT OR UPDATE OF site_slug ON public.cmms_company_profiles
  FOR EACH ROW EXECUTE FUNCTION public.trg_cmms_company_site_slug();

-- ---------------------------------------------------------------------------
-- Give every existing business its address. The platform's fee business (GODMINDERA ORGANISATION (U) LTD) goes first so it
-- always gets the plain name; after that the oldest business keeps the plain name when several share one.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_platform UUID;
  r RECORD;
BEGIN
  IF to_regprocedure('public.fn_get_platform_fee_business_id()') IS NOT NULL THEN
    EXECUTE 'SELECT public.fn_get_platform_fee_business_id()' INTO v_platform;
  END IF;

  FOR r IN
    SELECT cp.id, cp.company_name
    FROM public.cmms_company_profiles cp
    WHERE cp.site_slug IS NULL OR btrim(cp.site_slug) = ''
    ORDER BY COALESCE(v_platform IN (NULLIF(to_jsonb(cp)->>'business_profile_id', '')::UUID,
                                     NULLIF(to_jsonb(cp)->>'pichin_business_profile_id', '')::UUID), FALSE) DESC,
             cp.created_at NULLS LAST, cp.id
  LOOP
    UPDATE public.cmms_company_profiles SET site_slug = public.fn_allocate_company_site_slug(r.company_name, r.id) WHERE id = r.id;
  END LOOP;
END $$;

-- One business per address, whatever the capitalisation. Created after the backfill so it can never block it.
CREATE UNIQUE INDEX IF NOT EXISTS uq_cmms_company_site_slug ON public.cmms_company_profiles (lower(site_slug)) WHERE site_slug IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Public lookups (anon): the site page and every link builder use these
-- ---------------------------------------------------------------------------

-- address -> business. A retired address answers with the business's CURRENT one (is_current = false) so the page can move the
-- visitor to it.
CREATE OR REPLACE FUNCTION public.fn_resolve_public_site_slug(p_slug TEXT)
RETURNS TABLE (company_id UUID, site_slug TEXT, is_current BOOLEAN)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH q AS (SELECT lower(btrim(COALESCE(p_slug, ''))) AS s)
  SELECT cp.id, cp.site_slug, (lower(cp.site_slug) = q.s) AS is_current
  FROM q
  JOIN public.cmms_company_profiles cp ON lower(cp.site_slug) = q.s
  UNION ALL
  SELECT cp.id, cp.site_slug, FALSE
  FROM q
  JOIN public.cmms_company_site_slug_history h ON h.slug = q.s
  JOIN public.cmms_company_profiles cp ON cp.id = h.company_id
  WHERE cp.site_slug IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.cmms_company_profiles c2 WHERE lower(c2.site_slug) = q.s)
  LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public.fn_resolve_public_site_slug(TEXT) TO anon, authenticated;

-- business ids -> addresses, in one call (up to 200 ids). Ids without an address are simply left out.
CREATE OR REPLACE FUNCTION public.fn_get_public_site_slugs(p_company_ids UUID[])
RETURNS TABLE (company_id UUID, site_slug TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT cp.id, cp.site_slug
  FROM public.cmms_company_profiles cp
  WHERE cp.id = ANY (COALESCE(p_company_ids[1:200], ARRAY[]::UUID[]))
    AND cp.site_slug IS NOT NULL;
$$;
GRANT EXECUTE ON FUNCTION public.fn_get_public_site_slugs(UUID[]) TO anon, authenticated;

-- "Choose your address" box: is it free, and if not, why not. Also offers what the business would get from its name.
CREATE OR REPLACE FUNCTION public.fn_check_site_slug(p_slug TEXT, p_company_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v        TEXT := lower(btrim(COALESCE(p_slug, '')));
  v_problem TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('available', FALSE, 'slug', v, 'reason', 'Sign in to choose an address.');
  END IF;
  v_problem := public.fn_site_slug_problem(v, p_company_id);
  RETURN jsonb_build_object('available', v_problem IS NULL, 'slug', v, 'reason', v_problem);
END $$;
GRANT EXECUTE ON FUNCTION public.fn_check_site_slug(TEXT, UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';

SELECT count(*) AS businesses_with_an_address, count(*) FILTER (WHERE site_slug IS NULL) AS still_missing
FROM public.cmms_company_profiles;
