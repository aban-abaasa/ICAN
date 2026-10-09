-- ============================================================================
-- INSURER LISTINGS: a proper public profile and directory for insurance companies.
--
-- An insurer can already sell plans. This lets it present itself properly, so customers can find
-- and trust it, and gives it the data to price smartly:
--
--   * A listing profile on ins_insurers: tagline, about, website, logo link, countries served,
--     languages, claims promise (decision days and hours), year founded, and an opt-out switch.
--     Written only by ins_update_listing() (owner or administrator of the insurer's business).
--   * ins_public_directory(): the public face. Anyone (no account) can browse VERIFIED insurers
--     with an unexpired licence and at least one plan on sale, filtered by country and cover type.
--     Contact details and claims phone are never in it. Respects the programme's on/off switch.
--   * ins_market_benchmark(): an anonymous price guide for the plan builder. It only answers when
--     at least 3 plans from at least 2 insurers match, and never says whose they are.
--   * Support can hide an insurer from the directory with a reason (ins_dev_set_listing); the
--     insurer sees the reason. Verification and selling are unaffected.
--
-- Run after the three insurer-applications migrations. Safe to run twice.
-- ============================================================================

DO $$
BEGIN
  IF to_regclass('public.ins_insurers') IS NULL OR to_regclass('public.ins_plans') IS NULL
     OR to_regprocedure('public.ins_amounts(numeric,numeric,numeric,integer)') IS NULL THEN
    RAISE EXCEPTION 'Run backend/ADD_INSURANCE_PLATFORM.sql first: the insurance tables are not installed.';
  END IF;
END $$;

-- 1. The listing profile -------------------------------------------------------------
ALTER TABLE public.ins_insurers
  ADD COLUMN IF NOT EXISTS tagline              TEXT,
  ADD COLUMN IF NOT EXISTS website              TEXT,
  ADD COLUMN IF NOT EXISTS logo_url             TEXT,
  ADD COLUMN IF NOT EXISTS service_countries    TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS languages            TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS claims_decision_days INT,
  ADD COLUMN IF NOT EXISTS claims_hours         TEXT,
  ADD COLUMN IF NOT EXISTS founded_year         INT,
  ADD COLUMN IF NOT EXISTS listed               BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS hidden_by_support    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS hidden_note          TEXT;

ALTER TABLE public.ins_insurers DROP CONSTRAINT IF EXISTS ins_insurers_listing_valid;
ALTER TABLE public.ins_insurers ADD CONSTRAINT ins_insurers_listing_valid CHECK (
  (tagline IS NULL OR char_length(tagline) <= 120)
  AND (website IS NULL OR (website ~* '^https://[^[:space:]]+$' AND char_length(website) <= 200))
  AND (logo_url IS NULL OR (logo_url ~* '^https://[^[:space:]]+$' AND char_length(logo_url) <= 300))
  AND cardinality(service_countries) <= 60
  AND cardinality(languages) <= 12
  AND (claims_decision_days IS NULL OR claims_decision_days BETWEEN 1 AND 90)
  AND (claims_hours IS NULL OR char_length(claims_hours) <= 120)
  AND (founded_year IS NULL OR founded_year BETWEEN 1800 AND 2100)
  AND (hidden_note IS NULL OR char_length(hidden_note) <= 500)
);

CREATE INDEX IF NOT EXISTS ins_insurers_directory_idx ON public.ins_insurers (country_code)
  WHERE status = 'verified' AND listed AND NOT hidden_by_support;

-- 2. Editing the listing (atomic; also covers contact details and the about text) ------------
CREATE OR REPLACE FUNCTION public.ins_update_listing(p_insurer_id UUID, p_payload JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_i     public.ins_insurers%ROWTYPE;
  v_tag   TEXT;
  v_web   TEXT;
  v_logo  TEXT;
  v_about TEXT;
  v_email TEXT;
  v_hours TEXT;
  v_countries TEXT[];
  v_langs     TEXT[];
  v_days  INT;
  v_year  INT;
BEGIN
  SELECT * INTO v_i FROM public.ins_insurers WHERE id = p_insurer_id;
  IF NOT FOUND OR NOT public.ican_business_admin(v_i.business_profile_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Insurer not found');
  END IF;
  IF v_i.status = 'rejected' THEN
    RETURN jsonb_build_object('success', false, 'error', 'This insurer was not approved, so it has no listing to edit');
  END IF;

  v_tag   := CASE WHEN p_payload ? 'tagline' THEN NULLIF(btrim(p_payload ->> 'tagline'), '') ELSE v_i.tagline END;
  v_web   := CASE WHEN p_payload ? 'website' THEN NULLIF(btrim(p_payload ->> 'website'), '') ELSE v_i.website END;
  v_logo  := CASE WHEN p_payload ? 'logo_url' THEN NULLIF(btrim(p_payload ->> 'logo_url'), '') ELSE v_i.logo_url END;
  v_about := CASE WHEN p_payload ? 'description' THEN NULLIF(btrim(p_payload ->> 'description'), '') ELSE v_i.description END;
  v_email := CASE WHEN p_payload ? 'contact_email' THEN NULLIF(btrim(p_payload ->> 'contact_email'), '') ELSE v_i.contact_email END;
  v_hours := CASE WHEN p_payload ? 'claims_hours' THEN NULLIF(btrim(p_payload ->> 'claims_hours'), '') ELSE v_i.claims_hours END;
  v_days  := CASE WHEN p_payload ? 'claims_decision_days' THEN NULLIF(p_payload ->> 'claims_decision_days', '')::INT ELSE v_i.claims_decision_days END;
  v_year  := CASE WHEN p_payload ? 'founded_year' THEN NULLIF(p_payload ->> 'founded_year', '')::INT ELSE v_i.founded_year END;
  v_countries := CASE WHEN p_payload ? 'service_countries'
                      THEN ARRAY(SELECT DISTINCT upper(btrim(x)) FROM jsonb_array_elements_text(COALESCE(p_payload -> 'service_countries', '[]'::JSONB)) x
                                  WHERE btrim(x) <> '' ORDER BY 1)
                      ELSE v_i.service_countries END;
  v_langs := CASE WHEN p_payload ? 'languages'
                  THEN ARRAY(SELECT DISTINCT btrim(x) FROM jsonb_array_elements_text(COALESCE(p_payload -> 'languages', '[]'::JSONB)) x
                              WHERE btrim(x) <> '' ORDER BY 1)
                  ELSE v_i.languages END;

  IF v_tag IS NOT NULL AND char_length(v_tag) > 120 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Keep the tagline to 120 characters');
  END IF;
  IF v_about IS NOT NULL AND char_length(v_about) > 500 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Keep the description to 500 characters');
  END IF;
  IF v_web IS NOT NULL AND (v_web !~* '^https://[A-Za-z0-9][A-Za-z0-9.-]*(:[0-9]+)?(/[^[:space:]]*)?$' OR char_length(v_web) > 200) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Use your website''s full https:// address');
  END IF;
  IF v_logo IS NOT NULL AND (v_logo !~* '^https://[A-Za-z0-9][A-Za-z0-9.-]*(:[0-9]+)?(/[^[:space:]]*)?$' OR char_length(v_logo) > 300) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Use the logo''s full https:// image address');
  END IF;
  IF v_email IS NOT NULL AND v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Enter a valid contact email');
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(v_countries) c WHERE c !~ '^[A-Z]{2}$') OR cardinality(v_countries) > 60 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Choose countries from the list');
  END IF;
  IF cardinality(v_langs) > 12 OR EXISTS (SELECT 1 FROM unnest(v_langs) l WHERE char_length(l) NOT BETWEEN 2 AND 30) THEN
    RETURN jsonb_build_object('success', false, 'error', 'List up to 12 languages');
  END IF;
  IF v_days IS NOT NULL AND v_days NOT BETWEEN 1 AND 90 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Claims decisions take 1 to 90 days');
  END IF;
  IF v_hours IS NOT NULL AND char_length(v_hours) > 120 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Keep the claims hours to 120 characters');
  END IF;
  IF v_year IS NOT NULL AND v_year NOT BETWEEN 1800 AND EXTRACT(YEAR FROM current_date)::INT THEN
    RETURN jsonb_build_object('success', false, 'error', 'Enter the year the company was founded');
  END IF;

  UPDATE public.ins_insurers SET
    tagline = v_tag, website = v_web, logo_url = v_logo, description = v_about, contact_email = v_email,
    contact_phone = CASE WHEN p_payload ? 'contact_phone' THEN NULLIF(btrim(p_payload ->> 'contact_phone'), '') ELSE contact_phone END,
    claims_phone  = CASE WHEN p_payload ? 'claims_phone'  THEN NULLIF(btrim(p_payload ->> 'claims_phone'), '')  ELSE claims_phone END,
    claims_hours = v_hours, claims_decision_days = v_days, founded_year = v_year,
    service_countries = v_countries, languages = v_langs,
    listed = COALESCE((p_payload ->> 'listed')::BOOLEAN, listed),
    updated_at = now()
  WHERE id = p_insurer_id;
  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR check_violation THEN
  RETURN jsonb_build_object('success', false, 'error', 'One of the values is not valid. Check the numbers and links.');
END;
$$;

-- 3. My insurers now carry the listing fields (the console reads them) -----------------------
CREATE OR REPLACE FUNCTION public.ins_my_insurers()
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'insurer_id',     i.id,
           'business_id',    i.business_profile_id,
           'business_name',  bp.business_name,
           'display_name',   i.display_name,
           'licence_number', i.licence_number,
           'licence_expiry', i.licence_expiry,
           'licence_state',  CASE WHEN i.licence_expiry < current_date THEN 'expired'
                                  WHEN i.licence_expiry <= current_date + 30 THEN 'expiring_soon'
                                  ELSE 'valid' END,
           'regulator',      i.regulator,
           'country_code',   i.country_code,
           'contact_email',  i.contact_email,
           'contact_phone',  i.contact_phone,
           'claims_phone',   i.claims_phone,
           'description',    i.description,
           'tagline',        i.tagline,
           'website',        i.website,
           'logo_url',       i.logo_url,
           'service_countries', to_jsonb(i.service_countries),
           'languages',      to_jsonb(i.languages),
           'claims_decision_days', i.claims_decision_days,
           'claims_hours',   i.claims_hours,
           'founded_year',   i.founded_year,
           'listed',         i.listed,
           'hidden_by_support', i.hidden_by_support,
           'hidden_note',    CASE WHEN i.hidden_by_support THEN i.hidden_note END,
           'status',         i.status,
           'review_note',    i.review_note,
           'is_admin',       public.ican_business_admin(i.business_profile_id)
         ) ORDER BY i.created_at), '[]'::JSONB)
    FROM public.ins_insurers i
    JOIN public.business_profiles bp ON bp.id = i.business_profile_id
   WHERE auth.uid() IS NOT NULL AND public.ican_business_member(i.business_profile_id);
$$;

-- 4. The public directory (no account needed) ----------------------------------------------------
-- Only insurers a customer could actually buy from: verified, licence in date, listed, not hidden
-- by support, with at least one plan on sale. Prices are the customer price (the insurer's
-- take-home plus the programme commission), the same number the app shows.
CREATE OR REPLACE FUNCTION public.ins_public_directory(
  p_country TEXT DEFAULT NULL, p_cover_type TEXT DEFAULT NULL, p_search TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cfg    public.ins_settings := public.ins_cfg();
  v_cc     TEXT := upper(NULLIF(btrim(COALESCE(p_country, '')), ''));
  v_type   TEXT := NULLIF(btrim(COALESCE(p_cover_type, '')), '');
  v_search TEXT := NULLIF(left(btrim(COALESCE(p_search, '')), 60), '');
BEGIN
  IF NOT v_cfg.enabled THEN
    RETURN '[]'::JSONB;
  END IF;
  IF v_cc IS NOT NULL AND v_cc !~ '^[A-Z]{2}$' THEN
    RETURN '[]'::JSONB;
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(d.row_json ORDER BY d.plan_count DESC, d.name)
      FROM (
        SELECT i.display_name AS name, c.plan_count,
               jsonb_build_object(
                 'insurer_id', i.id, 'name', i.display_name, 'tagline', i.tagline, 'about', i.description,
                 'regulator', i.regulator, 'licence_number', i.licence_number, 'country', i.country_code,
                 'service_countries', to_jsonb(i.service_countries), 'website', i.website, 'logo_url', i.logo_url,
                 'languages', to_jsonb(i.languages), 'claims_decision_days', i.claims_decision_days,
                 'claims_hours', i.claims_hours, 'founded_year', i.founded_year,
                 'plan_count', c.plan_count, 'cover_types', to_jsonb(c.cover_types), 'audiences', to_jsonb(c.audiences),
                 'from_price_ican', c.from_price, 'plans', c.plans
               ) AS row_json
          FROM public.ins_insurers i
          CROSS JOIN LATERAL (
            SELECT count(*)::INT AS plan_count,
                   array_agg(DISTINCT pl.cover_type ORDER BY pl.cover_type) AS cover_types,
                   (SELECT array_agg(DISTINCT aud ORDER BY aud) FROM public.ins_plans p2, unnest(p2.audience) aud
                     WHERE p2.insurer_id = i.id AND p2.active) AS audiences,
                   min(a.total_ican) AS from_price,
                   (SELECT jsonb_agg(x.plan_json ORDER BY x.price)
                      FROM (SELECT a3.total_ican AS price,
                                   jsonb_build_object('name', p3.name, 'summary', p3.summary, 'cover_type', p3.cover_type,
                                                      'audience', to_jsonb(p3.audience), 'period_days', p3.period_days,
                                                      'price_ican', a3.total_ican, 'cover_limit_ican', p3.cover_limit_ican,
                                                      'waiting_days', p3.waiting_days) AS plan_json
                              FROM public.ins_plans p3
                              CROSS JOIN LATERAL public.ins_amounts(p3.premium_ican, 0, 0, 1) a3
                             WHERE p3.insurer_id = i.id AND p3.active AND (v_type IS NULL OR p3.cover_type = v_type)
                             ORDER BY a3.total_ican LIMIT 6) x) AS plans
              FROM public.ins_plans pl
              CROSS JOIN LATERAL public.ins_amounts(pl.premium_ican, 0, 0, 1) a
             WHERE pl.insurer_id = i.id AND pl.active AND (v_type IS NULL OR pl.cover_type = v_type)
          ) c
         WHERE i.status = 'verified' AND i.licence_expiry >= current_date AND i.listed AND NOT i.hidden_by_support
           AND c.plan_count > 0
           AND (v_cc IS NULL OR i.country_code = v_cc OR v_cc = ANY (i.service_countries))
           AND (v_search IS NULL OR i.display_name ILIKE '%' || replace(replace(replace(v_search, '\', '\\'), '%', '\%'), '_', '\_') || '%')
         ORDER BY c.plan_count DESC, i.display_name
         LIMIT 100
      ) d
  ), '[]'::JSONB);
END;
$$;

-- 5. Anonymous price guide for the plan builder -----------------------------------------------
-- What other insurers take home for the same kind of cover over the same period. It only answers
-- when at least 3 plans from at least 2 insurers match, so no one's price can be read off it.
CREATE OR REPLACE FUNCTION public.ins_market_benchmark(
  p_cover_type TEXT, p_audience TEXT DEFAULT NULL, p_period_days INT DEFAULT 30, p_exclude_insurer UUID DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_plans INT;
  v_insurers INT;
  v_min NUMERIC;
  v_med NUMERIC;
  v_max NUMERIC;
  v_lmed NUMERIC;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Please sign in';
  END IF;
  SELECT count(*), count(DISTINCT pl.insurer_id), min(pl.premium_ican),
         percentile_cont(0.5) WITHIN GROUP (ORDER BY pl.premium_ican), max(pl.premium_ican),
         percentile_cont(0.5) WITHIN GROUP (ORDER BY pl.cover_limit_ican)
    INTO v_plans, v_insurers, v_min, v_med, v_max, v_lmed
    FROM public.ins_plans pl
    JOIN public.ins_insurers i ON i.id = pl.insurer_id
   WHERE pl.active AND i.status = 'verified' AND i.licence_expiry >= current_date
     AND pl.cover_type = p_cover_type AND pl.period_days = p_period_days
     AND (p_audience IS NULL OR p_audience = ANY (pl.audience))
     AND (p_exclude_insurer IS NULL OR pl.insurer_id <> p_exclude_insurer);
  IF v_plans < 3 OR v_insurers < 2 THEN
    RETURN jsonb_build_object('available', false);
  END IF;
  RETURN jsonb_build_object('available', true, 'plans', v_plans, 'insurers', v_insurers,
    'premium_min_ican', ROUND(v_min, 4), 'premium_median_ican', ROUND(v_med, 4), 'premium_max_ican', ROUND(v_max, 4),
    'cover_limit_median_ican', ROUND(v_lmed, 4));
END;
$$;

-- 6. Support: hide an insurer from the directory (with a reason it can read) ---------------------
CREATE OR REPLACE FUNCTION public.ins_dev_set_listing(
  p_insurer_id UUID, p_hidden BOOLEAN, p_note TEXT DEFAULT NULL, p_dev_token TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_note TEXT := NULLIF(btrim(p_note), '');
BEGIN
  IF NOT public.ins_is_manager(p_dev_token) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;
  IF p_hidden AND v_note IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Give a reason; the insurer will see it');
  END IF;
  IF v_note IS NOT NULL AND char_length(v_note) > 500 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Keep the reason to 500 characters');
  END IF;
  UPDATE public.ins_insurers
     SET hidden_by_support = p_hidden, hidden_note = CASE WHEN p_hidden THEN v_note END, updated_at = now()
   WHERE id = p_insurer_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Insurer not found');
  END IF;
  RETURN jsonb_build_object('success', true, 'hidden', p_hidden);
END;
$$;

-- 7. The support list now shows the listing state ----------------------------------------------
CREATE OR REPLACE FUNCTION public.ins_dev_list_insurers(p_status TEXT DEFAULT NULL, p_dev_token TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.ins_is_manager(p_dev_token) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'insurer_id', i.id, 'display_name', i.display_name, 'business_name', bp.business_name,
             'owner_email', u.email, 'licence_number', i.licence_number, 'licence_expiry', i.licence_expiry,
             'licence_expired', (i.licence_expiry < current_date), 'regulator', i.regulator,
             'country_code', i.country_code, 'contact_email', i.contact_email, 'contact_phone', i.contact_phone,
             'description', i.description, 'status', i.status, 'review_note', i.review_note,
             'tagline', i.tagline, 'website', i.website, 'listed', i.listed,
             'hidden_by_support', i.hidden_by_support, 'hidden_note', i.hidden_note,
             'created_at', i.created_at, 'reviewed_at', i.reviewed_at,
             'plans', (SELECT count(*) FROM public.ins_plans pl WHERE pl.insurer_id = i.id AND pl.active),
             'policies', (SELECT count(*) FROM public.ins_policies p WHERE p.insurer_id = i.id AND p.status = 'active'
                            AND p.ends_at >= now()),
             'claims_open', (SELECT count(*) FROM public.ins_claims c WHERE c.insurer_id = i.id
                              AND c.status IN ('submitted', 'in_review', 'info_needed', 'approved')))
           ORDER BY (i.status = 'pending') DESC, i.created_at DESC)
      FROM public.ins_insurers i
      JOIN public.business_profiles bp ON bp.id = i.business_profile_id
      LEFT JOIN auth.users u ON u.id = bp.user_id
     WHERE p_status IS NULL OR i.status = p_status
  ), '[]'::JSONB);
END;
$$;

-- 8. Grants -----------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.ins_update_listing(UUID, JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ins_market_benchmark(TEXT, TEXT, INT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ins_update_listing(UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ins_market_benchmark(TEXT, TEXT, INT, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.ins_public_directory(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ins_public_directory(TEXT, TEXT, TEXT) TO anon, authenticated;

-- Dev panel: the function itself is the gate (same convention as the other ins_dev_* functions).
REVOKE ALL ON FUNCTION public.ins_dev_set_listing(UUID, BOOLEAN, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ins_dev_set_listing(UUID, BOOLEAN, TEXT, TEXT) TO anon, authenticated;
