-- ============================================================================
-- INSURER APPLICATIONS, PART 3: one company, more than one licence.
--
-- A company can hold several insurance licences (a general insurer and a life insurer, or one
-- per country) and offers several kinds of cover under each. This lets it:
--
--   * send more than one application (the form stays available after the first one, and also once
--     the company is approved or registered; up to ten a day per email),
--   * register the SAME business as an insurer more than once, one registration per licence and
--     country. Before, ins_insurers allowed one insurer per business, so a second approved licence
--     had to be hung on a second business profile.
--
-- Each registration is its own insurer (own licence, own approval, own plans). Premiums still go
-- to the business wallet. Everything in the insurance backend keys off the insurer, so nothing
-- else changes. An approved application is applied to the registration with the matching licence
-- and country, as before.
--
-- Run after 20261010200000_insurer_applications_public.sql. Safe to run twice.
-- ============================================================================

DO $$
BEGIN
  IF to_regclass('public.ins_insurer_applications') IS NULL OR to_regprocedure('public.ins_norm_licence(text)') IS NULL THEN
    RAISE EXCEPTION 'Run 20261010100000 and 20261010200000 (insurer applications) first.';
  END IF;
END $$;

-- 1. One insurer per business -> one insurer per business, licence and country ----------------
DO $$
DECLARE
  c RECORD;
BEGIN
  FOR c IN
    SELECT con.conname
      FROM pg_constraint con
     WHERE con.conrelid = 'public.ins_insurers'::regclass AND con.contype = 'u'
       AND (SELECT array_agg(att.attname::TEXT) FROM pg_attribute att
             WHERE att.attrelid = con.conrelid AND att.attnum = ANY (con.conkey)) = ARRAY['business_profile_id']
  LOOP
    EXECUTE format('ALTER TABLE public.ins_insurers DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ins_insurers_business_licence_uq
  ON public.ins_insurers (business_profile_id, public.ins_norm_licence(licence_number), country_code);
CREATE INDEX IF NOT EXISTS ins_insurers_business_idx ON public.ins_insurers (business_profile_id);

-- 2. Registering: the check is now per licence and country, not per business -------------------
CREATE OR REPLACE FUNCTION public.ins_register_insurer(
  p_business_id    UUID,
  p_display_name   TEXT,
  p_licence_number TEXT,
  p_licence_expiry DATE,
  p_regulator      TEXT DEFAULT 'IRA',
  p_country_code   TEXT DEFAULT 'UG',
  p_contact_email  TEXT DEFAULT NULL,
  p_contact_phone  TEXT DEFAULT NULL,
  p_claims_phone   TEXT DEFAULT NULL,
  p_description    TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_name  TEXT := NULLIF(btrim(p_display_name), '');
  v_lic   TEXT := NULLIF(btrim(p_licence_number), '');
  v_reg   TEXT := COALESCE(NULLIF(btrim(p_regulator), ''), 'IRA');
  v_cc    TEXT := upper(COALESCE(NULLIF(btrim(p_country_code), ''), 'UG'));
  v_email TEXT := NULLIF(btrim(p_contact_email), '');
  v_existing public.ins_insurers%ROWTYPE;
  v_id    UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Please sign in');
  END IF;
  IF NOT public.ican_business_admin(p_business_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only an owner or administrator of the business can register it as an insurer');
  END IF;
  IF v_name IS NULL OR char_length(v_name) NOT BETWEEN 2 AND 80 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Enter the company name (2 to 80 characters)');
  END IF;
  IF v_lic IS NULL OR char_length(v_lic) NOT BETWEEN 3 AND 60 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Enter your insurance licence number');
  END IF;
  IF p_licence_expiry IS NULL OR p_licence_expiry < current_date OR p_licence_expiry > current_date + 3660 THEN
    RETURN jsonb_build_object('success', false, 'error', 'The licence expiry must be a future date. An expired licence cannot be registered');
  END IF;
  IF v_cc !~ '^[A-Z]{2}$' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Use a two-letter country code, for example UG');
  END IF;
  IF v_email IS NOT NULL AND v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Enter a valid contact email');
  END IF;

  -- One business can hold several insurer registrations: one per licence and country.
  SELECT * INTO v_existing FROM public.ins_insurers
   WHERE business_profile_id = p_business_id
     AND public.ins_norm_licence(licence_number) = public.ins_norm_licence(v_lic)
     AND country_code = v_cc;
  IF FOUND THEN
    IF v_existing.status <> 'rejected' THEN
      RETURN jsonb_build_object('success', false, 'error', 'This licence is already registered for this business');
    END IF;
    UPDATE public.ins_insurers
       SET display_name = v_name, licence_number = v_lic, licence_expiry = p_licence_expiry,
           regulator = v_reg, country_code = v_cc, contact_email = v_email,
           contact_phone = NULLIF(btrim(p_contact_phone), ''), claims_phone = NULLIF(btrim(p_claims_phone), ''),
           description = NULLIF(btrim(p_description), ''),
           status = 'pending', review_note = NULL, reviewed_at = NULL, updated_at = now()
     WHERE id = v_existing.id
     RETURNING id INTO v_id;
  ELSE
    INSERT INTO public.ins_insurers
      (business_profile_id, display_name, licence_number, licence_expiry, regulator, country_code,
       contact_email, contact_phone, claims_phone, description, created_by)
    VALUES
      (p_business_id, v_name, v_lic, p_licence_expiry, v_reg, v_cc, v_email,
       NULLIF(btrim(p_contact_phone), ''), NULLIF(btrim(p_claims_phone), ''),
       NULLIF(btrim(p_description), ''), auth.uid())
    RETURNING id INTO v_id;
  END IF;
  RETURN jsonb_build_object('success', true, 'insurer_id', v_id, 'status', 'pending');
END;
$$;

-- 3. Applying: ten a day per email instead of three ---------------------------------------------
CREATE OR REPLACE FUNCTION public.ins_submit_application(
  p_contact_name   TEXT,
  p_email          TEXT,
  p_company_name   TEXT,
  p_licence_number TEXT,
  p_licence_expiry DATE,
  p_country_code   TEXT,
  p_regulator      TEXT,
  p_cover_types    TEXT[],
  p_phone          TEXT DEFAULT NULL,
  p_description    TEXT DEFAULT NULL,
  p_website        TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_email   TEXT := lower(btrim(COALESCE(p_email, '')));
  v_company TEXT := btrim(COALESCE(p_company_name, ''));
  v_lic     TEXT := btrim(COALESCE(p_licence_number, ''));
  v_reg     TEXT := btrim(COALESCE(p_regulator, ''));
  v_cc      TEXT := upper(btrim(COALESCE(p_country_code, '')));
  v_types   TEXT[] := ARRAY(SELECT DISTINCT btrim(x) FROM unnest(COALESCE(p_cover_types, ARRAY[]::TEXT[])) x ORDER BY 1);
  v_ref     TEXT;
  v_try     INT := 0;
BEGIN
  IF NULLIF(btrim(COALESCE(p_website, '')), '') IS NOT NULL THEN
    RETURN jsonb_build_object('success', true);          -- a bot: look successful, store nothing
  END IF;
  IF char_length(btrim(COALESCE(p_contact_name, ''))) NOT BETWEEN 2 AND 120 THEN
    RAISE EXCEPTION 'Please enter your name';
  END IF;
  IF char_length(v_email) > 254 OR v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'Please enter a valid email address';
  END IF;
  IF char_length(v_company) NOT BETWEEN 2 AND 160 THEN
    RAISE EXCEPTION 'Please enter the registered name of your insurance company';
  END IF;
  IF char_length(v_lic) NOT BETWEEN 3 AND 60 OR public.ins_norm_licence(v_lic) = '' THEN
    RAISE EXCEPTION 'Please enter your insurance licence number';
  END IF;
  IF p_licence_expiry IS NULL OR p_licence_expiry < current_date OR p_licence_expiry > current_date + 3660 THEN
    RAISE EXCEPTION 'The licence expiry must be a future date. An expired licence cannot be approved';
  END IF;
  IF v_cc !~ '^[A-Z]{2}$' THEN
    RAISE EXCEPTION 'Please choose the country you are licensed in';
  END IF;
  IF char_length(v_reg) NOT BETWEEN 2 AND 60 THEN
    RAISE EXCEPTION 'Please enter the regulator that licensed you';
  END IF;
  IF cardinality(v_types) < 1
     OR NOT (v_types <@ ARRAY['accident', 'third_party', 'comprehensive', 'medical', 'life',
                              'goods_in_transit', 'property', 'liability', 'fleet']::TEXT[]) THEN
    RAISE EXCEPTION 'Please choose at least one kind of cover you offer';
  END IF;
  IF char_length(COALESCE(p_phone, '')) > 40 OR char_length(COALESCE(p_description, '')) > 1000 THEN
    RAISE EXCEPTION 'One of the fields is too long';
  END IF;

  -- A licence that already belongs to a registered insurer is not applied for again.
  IF EXISTS (SELECT 1 FROM public.ins_insurers i
              WHERE public.ins_norm_licence(i.licence_number) = public.ins_norm_licence(v_lic)
                AND i.country_code = v_cc AND i.status <> 'rejected') THEN
    RAISE EXCEPTION 'This licence is already registered on IcanEra. Sign in to manage your insurance company.';
  END IF;

  -- Flood control: a global ceiling per hour, ten per email per day (a company may hold several licences).
  IF (SELECT count(*) FROM public.ins_insurer_applications WHERE created_at > now() - interval '1 hour') >= 100 THEN
    RAISE EXCEPTION 'We are getting a lot of applications right now. Please try again a little later.';
  END IF;
  -- The same company asking again is acknowledged, never piled up.
  IF EXISTS (SELECT 1 FROM public.ins_insurer_applications
              WHERE lower(email) = v_email AND status IN ('new', 'approved')
                AND public.ins_norm_licence(licence_number) = public.ins_norm_licence(v_lic) AND country_code = v_cc) THEN
    RETURN jsonb_build_object('success', true, 'duplicate', true);
  END IF;
  IF (SELECT count(*) FROM public.ins_insurer_applications
       WHERE lower(email) = v_email AND created_at > now() - interval '24 hours') >= 10 THEN
    RAISE EXCEPTION 'You have already sent a few applications today. We will be in touch.';
  END IF;

  LOOP
    v_ref := 'INS-' || upper(substr(md5(random()::TEXT || clock_timestamp()::TEXT || v_email), 1, 6));
    BEGIN
      INSERT INTO public.ins_insurer_applications
        (reference, contact_name, email, phone, company_name, licence_number, licence_expiry, regulator,
         country_code, cover_types, description, user_id)
      VALUES
        (v_ref, btrim(p_contact_name), v_email, NULLIF(btrim(COALESCE(p_phone, '')), ''), v_company, v_lic,
         p_licence_expiry, v_reg, v_cc, v_types, NULLIF(btrim(COALESCE(p_description, '')), ''), auth.uid());
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      v_try := v_try + 1;
      IF v_try >= 5 THEN RAISE EXCEPTION 'Please try again'; END IF;
    END;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'reference', v_ref);
END;
$$;

-- 4. Grants (CREATE OR REPLACE keeps them; stated so a fresh run is explicit) --------------------
REVOKE ALL ON FUNCTION public.ins_register_insurer(UUID, TEXT, TEXT, DATE, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ins_register_insurer(UUID, TEXT, TEXT, DATE, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.ins_submit_application(TEXT, TEXT, TEXT, TEXT, DATE, TEXT, TEXT, TEXT[], TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ins_submit_application(TEXT, TEXT, TEXT, TEXT, DATE, TEXT, TEXT, TEXT[], TEXT, TEXT, TEXT) TO anon, authenticated;
