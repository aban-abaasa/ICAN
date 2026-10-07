-- ============================================================================
-- INSURER APPLICATIONS, PART 2: apply first, create the account after (like franchise).
--
-- 20261010100000 made an IcanEra account a condition of applying. This relaxes it the
-- same way the franchise form works: an insurance company sends its application with no
-- account, support approves it, and the company then needs an account with THE SAME EMAIL
-- to be set up.
--
--   * ins_submit_application() is open to visitors again (validated, rate limited,
--     honeypot) and takes the contact email. A signed-in caller is linked automatically.
--   * ins_application_status(reference, email) lets an applicant with no account check
--     where the application stands. A wrong guess and a missing application look the same.
--   * The approval carries through to registration by the new account's CONFIRMED email
--     (or by account, if they applied signed in), plus the same licence number and country,
--     so nobody can claim someone else's approval.
--   * ins_my_applications() also finds applications sent before the account existed.
--
-- Run after 20261010100000_insurer_applications.sql. Safe to run twice.
-- ============================================================================

DO $$
BEGIN
  IF to_regclass('public.ins_insurer_applications') IS NULL THEN
    RAISE EXCEPTION 'Run 20261010100000_insurer_applications.sql first.';
  END IF;
END $$;

-- 1. An application may now come from someone with no account yet ------------------
ALTER TABLE public.ins_insurer_applications ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.ins_insurer_applications DROP CONSTRAINT IF EXISTS ins_insurer_applications_user_id_fkey;
ALTER TABLE public.ins_insurer_applications
  ADD CONSTRAINT ins_insurer_applications_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS ins_app_email_idx ON public.ins_insurer_applications (lower(email), created_at DESC);

-- 2. The form: no account needed ---------------------------------------------------
DROP FUNCTION IF EXISTS public.ins_submit_application(TEXT, TEXT, TEXT, DATE, TEXT, TEXT, TEXT[], TEXT, TEXT, TEXT);

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

  -- Flood control: a global ceiling per hour, a few per email per day.
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
       WHERE lower(email) = v_email AND created_at > now() - interval '24 hours') >= 3 THEN
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

-- 3. Where is my application? (no account needed) -----------------------------------
-- The reference AND the email it was sent with are both needed.
CREATE OR REPLACE FUNCTION public.ins_application_status(p_reference TEXT, p_email TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a public.ins_insurer_applications%ROWTYPE;
BEGIN
  SELECT * INTO a FROM public.ins_insurer_applications
   WHERE reference = upper(btrim(COALESCE(p_reference, ''))) AND lower(email) = lower(btrim(COALESCE(p_email, '')));
  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false);
  END IF;
  RETURN jsonb_build_object(
    'found', true, 'reference', a.reference, 'company_name', a.company_name, 'status', a.status,
    'review_note', CASE WHEN a.status = 'rejected' THEN a.review_note END,
    'submitted_at', a.created_at, 'reviewed_at', a.reviewed_at);
END;
$$;

-- 4. My applications: by account, or by the confirmed email they were sent with ----------
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
   WHERE auth.uid() IS NOT NULL
     AND (a.user_id = auth.uid()
          OR EXISTS (SELECT 1 FROM auth.users u
                      WHERE u.id = auth.uid() AND u.email_confirmed_at IS NOT NULL AND lower(u.email) = lower(a.email)));
$$;

-- 5. Support: the queue (now says whether the company has made its account yet) -------
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
             'has_account', EXISTS (SELECT 1 FROM auth.users u WHERE lower(u.email) = lower(a.email)),
             -- Another application, or an insurer, already using this licence: worth a second look.
             'licence_clash', (
               EXISTS (SELECT 1 FROM public.ins_insurer_applications o
                        WHERE o.id <> a.id AND o.country_code = a.country_code
                          AND public.ins_norm_licence(o.licence_number) = public.ins_norm_licence(a.licence_number)
                          AND lower(o.email) <> lower(a.email) AND o.status <> 'rejected')
               OR EXISTS (SELECT 1 FROM public.ins_insurers i
                           WHERE i.country_code = a.country_code AND i.status <> 'rejected'
                             AND public.ins_norm_licence(i.licence_number) = public.ins_norm_licence(a.licence_number))))
           ORDER BY (a.status = 'new') DESC, a.created_at DESC)
      FROM public.ins_insurer_applications a
     WHERE p_status IS NULL OR a.status = p_status
  ), '[]'::JSONB);
END;
$$;

-- 6. Approval carries through to registration ----------------------------------------
-- The registering account must be the applying account, or own the CONFIRMED email the
-- application was sent with; the licence number and country must match.
CREATE OR REPLACE FUNCTION public.ins_apply_approved_application()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_email TEXT;
  a       public.ins_insurer_applications%ROWTYPE;
BEGIN
  IF NEW.status <> 'pending' OR NEW.created_by IS NULL OR NEW.licence_expiry < current_date THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM 'rejected' THEN
    RETURN NEW;
  END IF;
  SELECT lower(u.email) INTO v_email FROM auth.users u
   WHERE u.id = NEW.created_by AND u.email_confirmed_at IS NOT NULL;
  SELECT * INTO a FROM public.ins_insurer_applications x
   WHERE x.status = 'approved' AND x.country_code = NEW.country_code
     AND public.ins_norm_licence(x.licence_number) = public.ins_norm_licence(NEW.licence_number)
     AND (x.user_id = NEW.created_by OR (v_email IS NOT NULL AND lower(x.email) = v_email))
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

-- 7. Grants --------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.ins_apply_approved_application() FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.ins_submit_application(TEXT, TEXT, TEXT, TEXT, DATE, TEXT, TEXT, TEXT[], TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ins_application_status(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ins_submit_application(TEXT, TEXT, TEXT, TEXT, DATE, TEXT, TEXT, TEXT[], TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ins_application_status(TEXT, TEXT) TO anon, authenticated;
