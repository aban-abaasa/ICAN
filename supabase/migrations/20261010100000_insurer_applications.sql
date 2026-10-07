-- ============================================================================
-- INSURER APPLICATIONS: insurance companies apply from the landing site and
-- ICAN support approves them.
--
-- Until now an insurer could only register from inside the app: sign in, own a
-- business profile, open Compliance > Insurance > Sell cover. That hides the
-- programme from the very companies it is for. This adds the front door.
--
--   1. The company needs an IcanEra account. Signed in, it fills in the landing
--      page "Insurance" form: licence number and expiry, regulator, country,
--      what it covers. It is written ONLY by ins_submit_application() (needs a
--      signed-in account with an email, validated, rate limited, honeypot).
--      The application belongs to that account and carries its email.
--   2. The company sees where it stands (ins_my_applications) and gets a
--      reference like INS-4F9A2C to quote to support.
--   3. Support (the dev panel, Insurance tab) sees the queue and approves or
--      rejects each one (ins_dev_list_applications / ins_dev_review_application).
--      Same gate as every other ins_dev_* function: ins_is_manager().
--   4. An approved company then creates its business profile and
--      registers it as an insurer exactly as before. A trigger on ins_insurers
--      recognises the approval (same account + same licence number + same
--      country) and creates the insurer already VERIFIED, so support makes
--      the decision once, not twice. Anyone else still lands as 'pending'.
--
-- Run after backend/ADD_INSURANCE_PLATFORM.sql and 20261009100000_secure_dev_access.sql.
-- Safe to run twice.
-- ============================================================================

DO $$
BEGIN
  IF to_regclass('public.ins_insurers') IS NULL THEN
    RAISE EXCEPTION 'Run backend/ADD_INSURANCE_PLATFORM.sql first: the insurance tables are not installed.';
  END IF;
END $$;

-- 1. Helpers ------------------------------------------------------------------
-- "UG/INS/0042" and "ug ins 0042" are the same licence.
CREATE OR REPLACE FUNCTION public.ins_norm_licence(p_text TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT upper(regexp_replace(COALESCE(p_text, ''), '[^A-Za-z0-9]', '', 'g'));
$$;

-- 2. Table ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ins_insurer_applications (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference            TEXT NOT NULL UNIQUE,
  contact_name         TEXT NOT NULL CHECK (char_length(btrim(contact_name)) BETWEEN 2 AND 120),
  email                TEXT NOT NULL CHECK (char_length(email) <= 254 AND email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone                TEXT CHECK (phone IS NULL OR char_length(phone) <= 40),
  company_name         TEXT NOT NULL CHECK (char_length(btrim(company_name)) BETWEEN 2 AND 160),
  licence_number       TEXT NOT NULL CHECK (char_length(licence_number) BETWEEN 3 AND 60),
  licence_expiry       DATE NOT NULL,
  regulator            TEXT NOT NULL CHECK (char_length(regulator) BETWEEN 2 AND 60),
  country_code         VARCHAR(2) NOT NULL CHECK (country_code ~ '^[A-Z]{2}$'),
  cover_types          TEXT[] NOT NULL,
  description          TEXT CHECK (description IS NULL OR char_length(description) <= 1000),
  user_id              UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status               TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'approved', 'rejected', 'onboarded')),
  review_note          TEXT CHECK (review_note IS NULL OR char_length(review_note) <= 1000),
  reviewed_by          UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at          TIMESTAMPTZ,
  -- Deferred: the trigger in section 7 sets it while the insurer row is still being inserted.
  onboarded_insurer_id UUID REFERENCES public.ins_insurers(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ins_app_cover_types_valid CHECK (
    cardinality(cover_types) BETWEEN 1 AND 9
    AND cover_types <@ ARRAY['accident', 'third_party', 'comprehensive', 'medical', 'life',
                             'goods_in_transit', 'property', 'liability', 'fleet']::TEXT[])
);
CREATE INDEX IF NOT EXISTS ins_app_status_idx  ON public.ins_insurer_applications (status, created_at DESC);
CREATE INDEX IF NOT EXISTS ins_app_user_idx    ON public.ins_insurer_applications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ins_app_licence_idx ON public.ins_insurer_applications (public.ins_norm_licence(licence_number), country_code);

ALTER TABLE public.ins_insurer_applications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ins_insurer_applications FROM PUBLIC, anon, authenticated;

-- 3. The landing page form -----------------------------------------------------
-- Signed-in accounts only: the company must have an IcanEra account, which is who support approves
-- and who is set up as the insurer afterwards. The contact email is the account's own email, never
-- typed in, so it cannot be someone else's. p_website is a honeypot: real people never see it.
CREATE OR REPLACE FUNCTION public.ins_submit_application(
  p_contact_name   TEXT,
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
  v_uid     UUID := auth.uid();
  v_email   TEXT;
  v_company TEXT := btrim(COALESCE(p_company_name, ''));
  v_lic     TEXT := btrim(COALESCE(p_licence_number, ''));
  v_reg     TEXT := btrim(COALESCE(p_regulator, ''));
  v_cc      TEXT := upper(btrim(COALESCE(p_country_code, '')));
  v_types   TEXT[] := ARRAY(SELECT DISTINCT btrim(x) FROM unnest(COALESCE(p_cover_types, ARRAY[]::TEXT[])) x ORDER BY 1);
  v_ref     TEXT;
  v_try     INT := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Please sign in or create an IcanEra account for your company first';
  END IF;
  IF NULLIF(btrim(COALESCE(p_website, '')), '') IS NOT NULL THEN
    RETURN jsonb_build_object('success', true);
  END IF;
  SELECT lower(btrim(u.email)) INTO v_email FROM auth.users u WHERE u.id = v_uid;
  IF v_email IS NULL OR v_email = '' THEN
    RAISE EXCEPTION 'Your account has no email address. Add one to your account, then apply';
  END IF;
  IF char_length(btrim(COALESCE(p_contact_name, ''))) NOT BETWEEN 2 AND 120 THEN
    RAISE EXCEPTION 'Please enter your name';
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
    RAISE EXCEPTION 'This licence is already registered on IcanEra. Open Compliance > Insurance to manage your company.';
  END IF;

  -- Flood control: a global ceiling per hour, a few per account per day.
  IF (SELECT count(*) FROM public.ins_insurer_applications WHERE created_at > now() - interval '1 hour') >= 100 THEN
    RAISE EXCEPTION 'We are getting a lot of applications right now. Please try again a little later.';
  END IF;
  -- The same company asking again is acknowledged, never piled up.
  IF EXISTS (SELECT 1 FROM public.ins_insurer_applications
              WHERE user_id = v_uid AND status IN ('new', 'approved')
                AND public.ins_norm_licence(licence_number) = public.ins_norm_licence(v_lic) AND country_code = v_cc) THEN
    RETURN jsonb_build_object('success', true, 'duplicate', true);
  END IF;
  IF (SELECT count(*) FROM public.ins_insurer_applications
       WHERE user_id = v_uid AND created_at > now() - interval '24 hours') >= 3 THEN
    RAISE EXCEPTION 'You have already sent a few applications today. We will be in touch.';
  END IF;

  LOOP
    v_ref := 'INS-' || upper(substr(md5(random()::TEXT || clock_timestamp()::TEXT || v_uid::TEXT), 1, 6));
    BEGIN
      INSERT INTO public.ins_insurer_applications
        (reference, contact_name, email, phone, company_name, licence_number, licence_expiry, regulator,
         country_code, cover_types, description, user_id)
      VALUES
        (v_ref, btrim(p_contact_name), v_email, NULLIF(btrim(COALESCE(p_phone, '')), ''), v_company, v_lic,
         p_licence_expiry, v_reg, v_cc, v_types, NULLIF(btrim(COALESCE(p_description, '')), ''), v_uid);
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      v_try := v_try + 1;
      IF v_try >= 5 THEN RAISE EXCEPTION 'Please try again'; END IF;
    END;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'reference', v_ref);
END;
$$;

-- 4. My applications ------------------------------------------------------------
-- The signed-in company's own applications, with support's note when one was turned down. Also
-- used to prefill Compliance > Insurance > Sell cover once approved.
CREATE OR REPLACE FUNCTION public.ins_my_applications()
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', a.id, 'reference', a.reference, 'company_name', a.company_name, 'status', a.status,
           'review_note', CASE WHEN a.status = 'rejected' THEN a.review_note END,
           'licence_number', a.licence_number, 'licence_expiry', a.licence_expiry, 'regulator', a.regulator,
           'country_code', a.country_code, 'contact_email', a.email, 'contact_phone', a.phone,
           'description', a.description, 'created_at', a.created_at, 'reviewed_at', a.reviewed_at
         ) ORDER BY a.created_at DESC), '[]'::JSONB)
    FROM public.ins_insurer_applications a
   WHERE auth.uid() IS NOT NULL AND a.user_id = auth.uid();
$$;

-- 6. Support: the queue and the decision ----------------------------------------
CREATE OR REPLACE FUNCTION public.ins_dev_list_applications(p_status TEXT DEFAULT NULL, p_dev_token TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.ins_is_manager(p_dev_token) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'id', a.id, 'reference', a.reference, 'contact_name', a.contact_name, 'email', a.email, 'phone', a.phone,
             'company_name', a.company_name, 'licence_number', a.licence_number, 'licence_expiry', a.licence_expiry,
             'licence_expired', (a.licence_expiry < current_date), 'regulator', a.regulator,
             'country_code', a.country_code, 'cover_types', a.cover_types, 'description', a.description,
             'status', a.status, 'review_note', a.review_note, 'created_at', a.created_at, 'reviewed_at', a.reviewed_at,
             -- Another application, or an insurer, already using this licence: worth a second look.
             'licence_clash', (
               EXISTS (SELECT 1 FROM public.ins_insurer_applications o
                        WHERE o.id <> a.id AND o.country_code = a.country_code
                          AND public.ins_norm_licence(o.licence_number) = public.ins_norm_licence(a.licence_number)
                          AND o.user_id <> a.user_id AND o.status <> 'rejected')
               OR EXISTS (SELECT 1 FROM public.ins_insurers i
                           WHERE i.country_code = a.country_code AND i.status <> 'rejected'
                             AND public.ins_norm_licence(i.licence_number) = public.ins_norm_licence(a.licence_number))))
           ORDER BY (a.status = 'new') DESC, a.created_at DESC)
      FROM public.ins_insurer_applications a
     WHERE p_status IS NULL OR a.status = p_status
  ), '[]'::JSONB);
END;
$$;

CREATE OR REPLACE FUNCTION public.ins_dev_review_application(
  p_application_id UUID, p_decision TEXT, p_note TEXT DEFAULT NULL, p_dev_token TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a      public.ins_insurer_applications%ROWTYPE;
  v_note TEXT := NULLIF(btrim(p_note), '');
BEGIN
  IF NOT public.ins_is_manager(p_dev_token) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;
  IF p_decision NOT IN ('approve', 'reject') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unknown decision');
  END IF;
  SELECT * INTO a FROM public.ins_insurer_applications WHERE id = p_application_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Application not found');
  END IF;
  IF a.status = 'onboarded' THEN
    RETURN jsonb_build_object('success', false, 'error', 'This company is already registered. Manage it from the insurer list.');
  END IF;
  IF p_decision = 'reject' AND v_note IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Give a reason; the applicant will see it');
  END IF;
  IF p_decision = 'approve' AND a.licence_expiry < current_date THEN
    RETURN jsonb_build_object('success', false, 'error', 'The licence has expired. Ask the company to apply again with its renewed licence.');
  END IF;

  UPDATE public.ins_insurer_applications
     SET status = CASE p_decision WHEN 'approve' THEN 'approved' ELSE 'rejected' END,
         review_note = v_note, reviewed_by = auth.uid(), reviewed_at = now()
   WHERE id = a.id;
  RETURN jsonb_build_object('success', true, 'status', CASE p_decision WHEN 'approve' THEN 'approved' ELSE 'rejected' END);
END;
$$;

-- 7. Approval carries through to registration -------------------------------------
-- When the approved company registers its business as an insurer, support's decision is applied
-- instead of asking for it a second time. Matches on the same account, licence number and country,
-- so nobody can claim someone else's approval.
CREATE OR REPLACE FUNCTION public.ins_apply_approved_application()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a public.ins_insurer_applications%ROWTYPE;
BEGIN
  IF NEW.status <> 'pending' OR NEW.created_by IS NULL OR NEW.licence_expiry < current_date THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM 'rejected' THEN
    RETURN NEW;
  END IF;
  SELECT * INTO a FROM public.ins_insurer_applications x
   WHERE x.status = 'approved' AND x.user_id = NEW.created_by AND x.country_code = NEW.country_code
     AND public.ins_norm_licence(x.licence_number) = public.ins_norm_licence(NEW.licence_number)
   ORDER BY x.reviewed_at DESC NULLS LAST LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  NEW.status := 'verified';
  NEW.review_note := 'Approved by support from application ' || a.reference;
  NEW.reviewed_at := now();
  UPDATE public.ins_insurer_applications SET status = 'onboarded', onboarded_insurer_id = NEW.id WHERE id = a.id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ins_insurers_apply_application ON public.ins_insurers;
CREATE TRIGGER ins_insurers_apply_application
  BEFORE INSERT OR UPDATE OF status ON public.ins_insurers
  FOR EACH ROW EXECUTE FUNCTION public.ins_apply_approved_application();

-- 8. Grants --------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.ins_norm_licence(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ins_apply_approved_application() FROM PUBLIC, anon, authenticated;

-- Signed-in accounts only: a company without an account cannot apply.
REVOKE ALL ON FUNCTION public.ins_submit_application(TEXT, TEXT, TEXT, DATE, TEXT, TEXT, TEXT[], TEXT, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ins_my_applications() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ins_submit_application(TEXT, TEXT, TEXT, DATE, TEXT, TEXT, TEXT[], TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ins_my_applications() TO authenticated;

-- Dev panel: the function itself is the gate (same convention as the other ins_dev_* functions).
REVOKE ALL ON FUNCTION public.ins_dev_list_applications(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ins_dev_review_application(UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ins_dev_list_applications(TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ins_dev_review_application(UUID, TEXT, TEXT, TEXT) TO anon, authenticated;
