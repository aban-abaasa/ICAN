-- ============================================================
-- CMMS CLINICAL CONSULTATION FORMS — business logo, QR codes and
-- photo / document attachments on EVERY form
-- ============================================================
-- Three things every consultation form can now carry. All three are ON by
-- default, and the business owner decides, per form, how each one behaves
-- (cmms_consultation_forms.settings, edited through
-- cmms_save_consultation_form_settings): logo on/off, QR codes on/off,
-- attachments on/off, whether patients MUST attach something, how many files,
-- which tags patients can pick from, and the heading the attachment block
-- carries. The server enforces them too - a public submission can't attach
-- files to a form whose owner turned attachments off, and can't skip a
-- required attachment by editing the page.
--
--   1. The business logo. cmms_get_public_consultation_form now returns
--      'businessLogo' (the clinic's Board logo — cmms_company_profiles
--      .logo_url, the raw "r2://<key>" marker or a plain URL — falling back
--      to the linked business profile's avatar_url, the same order the
--      public notice board header uses). The frontend resolves it and puts
--      it on the public form, the printouts, the PDFs and the QR flyer.
--
--   2. QR codes. Pure frontend (the share-link QR already existed): a
--      "scan to fill in online" QR on blank printouts / PDFs, and on a filled
--      record a QR of its short reference code (the first 8 hex characters of
--      its id, so nothing new is stored). The owner can switch them off per form.
--
--   3. Image / document attachments. A new `attachments` JSONB array on each
--      submission — [{ key, name, type, size, label, caption }] — where
--      `key` is the R2 object key (uploaded straight from the browser via a
--      presigned URL, see frontend/api/storage/[action].js). Patients attach
--      from the public link, staff attach while recording a walk-in, and
--      staff can add more to an existing record later (a lab result that
--      arrives after the visit). The array is cleaned server-side by
--      _cmms_clean_consultation_attachments: only the six known keys survive,
--      lengths are capped, at most 12 per call, and a key must live in the
--      consultation upload folders — so a public submitter can't point a
--      record at some other tenant's file.
--
-- cmms_record_consultation_submission and cmms_submit_public_consultation_form
-- gain a trailing p_attachments parameter (DEFAULT '[]'), so callers that
-- don't send it — including an older frontend deployed before this runs —
-- keep working unchanged.
--
-- Run after: CMMS_CLINICAL_CONSULTATION_FORMS.sql, CMMS_CONSULTATION_ADDRESS_DOB.sql.
-- Safe to run more than once.
-- ============================================================

ALTER TABLE public.cmms_consultation_submissions
  ADD COLUMN IF NOT EXISTS attachments JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Owner-controlled options for each form. camelCase keys, all optional - a form
-- with '{}' behaves as "everything on, attachments optional, up to 8 files":
--   showLogo, showQr, allowAttachments, attachmentsRequired : boolean
--   attachmentMax    : 1-12
--   attachmentLabels : array of tag names (absent/null = the built-in list, [] = no tags)
--   attachmentPrompt : heading shown above the attachment block
ALTER TABLE public.cmms_consultation_forms
  ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Keeps only the known keys, with sane types and bounds.
CREATE OR REPLACE FUNCTION public._cmms_clean_consultation_form_settings(p_settings JSONB)
RETURNS JSONB
LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE
  v_out JSONB := '{}'::jsonb;
  v_key TEXT;
  v_labels JSONB;
BEGIN
  IF p_settings IS NULL OR jsonb_typeof(p_settings) <> 'object' THEN RETURN v_out; END IF;

  FOREACH v_key IN ARRAY ARRAY['showLogo', 'showQr', 'allowAttachments', 'attachmentsRequired'] LOOP
    IF jsonb_typeof(p_settings -> v_key) = 'boolean' THEN
      v_out := v_out || jsonb_build_object(v_key, p_settings -> v_key);
    END IF;
  END LOOP;

  IF jsonb_typeof(p_settings -> 'attachmentMax') = 'number' THEN
    v_out := v_out || jsonb_build_object('attachmentMax', GREATEST(1, LEAST(12, (p_settings ->> 'attachmentMax')::numeric::int)));
  END IF;

  IF jsonb_typeof(p_settings -> 'attachmentPrompt') = 'string' AND trim(p_settings ->> 'attachmentPrompt') <> '' THEN
    v_out := v_out || jsonb_build_object('attachmentPrompt', left(trim(p_settings ->> 'attachmentPrompt'), 80));
  END IF;

  IF jsonb_typeof(p_settings -> 'attachmentLabels') = 'array' THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(left(trim(t.v), 40)) ORDER BY t.n), '[]'::jsonb) INTO v_labels
    FROM (
      SELECT x.n, x.e #>> '{}' AS v
      FROM jsonb_array_elements(p_settings -> 'attachmentLabels') WITH ORDINALITY AS x(e, n)
      WHERE jsonb_typeof(x.e) = 'string' AND trim(x.e #>> '{}') <> ''
      LIMIT 12
    ) t;
    v_out := v_out || jsonb_build_object('attachmentLabels', v_labels);
  END IF;

  RETURN v_out;
END; $$;
REVOKE ALL ON FUNCTION public._cmms_clean_consultation_form_settings(JSONB) FROM PUBLIC;

-- Applies a form's attachment options to a submission's attachments: nothing if the owner
-- turned attachments off, otherwise the cleaned list capped to the owner's maximum.
CREATE OR REPLACE FUNCTION public._cmms_apply_form_attachment_settings(p_settings JSONB, p_attachments JSONB, p_public BOOLEAN)
RETURNS JSONB
LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE
  v_clean JSONB;
  v_max INT := LEAST(12, GREATEST(1, COALESCE(NULLIF(p_settings ->> 'attachmentMax', '')::numeric::int, 8)));
BEGIN
  IF COALESCE((p_settings ->> 'allowAttachments')::boolean, true) = false THEN RETURN '[]'::jsonb; END IF;
  v_clean := public._cmms_clean_consultation_attachments(p_attachments, p_public);
  IF jsonb_array_length(v_clean) > v_max THEN
    SELECT COALESCE(jsonb_agg(t.e ORDER BY t.n), '[]'::jsonb) INTO v_clean
    FROM jsonb_array_elements(v_clean) WITH ORDINALITY AS t(e, n) WHERE t.n <= v_max;
  END IF;
  RETURN v_clean;
END; $$;
REVOKE ALL ON FUNCTION public._cmms_apply_form_attachment_settings(JSONB, JSONB, BOOLEAN) FROM PUBLIC;

-- Owner saves a form's options.
CREATE OR REPLACE FUNCTION public.cmms_save_consultation_form_settings(p_form_id UUID, p_settings JSONB)
RETURNS public.cmms_consultation_forms
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_form public.cmms_consultation_forms;
  v_bp UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;
  SELECT business_profile_id INTO v_bp FROM public.cmms_consultation_forms WHERE id = p_form_id;
  IF v_bp IS NULL OR NOT public.unified_business_member(v_bp) THEN
    RAISE EXCEPTION 'Form not found or access denied';
  END IF;
  UPDATE public.cmms_consultation_forms
     SET settings = public._cmms_clean_consultation_form_settings(p_settings), updated_at = now()
   WHERE id = p_form_id
  RETURNING * INTO v_form;
  RETURN v_form;
END; $$;

-- ─────────────────────────────────────────────────────────────────────────
-- Internal helper — not exposed as an RPC.
-- p_public: anonymous patient uploads live only in cmms-consultation-guest/;
-- staff uploads live in cmms-consultation/<user id>/ (and staff may also
-- adopt a guest upload).
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._cmms_clean_consultation_attachments(p_attachments JSONB, p_public BOOLEAN DEFAULT false)
RETURNS JSONB
LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE
  v_clean JSONB;
BEGIN
  IF p_attachments IS NULL OR jsonb_typeof(p_attachments) <> 'array' THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT COALESCE(jsonb_agg(s.item ORDER BY s.n), '[]'::jsonb) INTO v_clean
  FROM (
    SELECT t.n,
           jsonb_strip_nulls(jsonb_build_object(
             'key', t.e->>'key',
             'name', left(COALESCE(NULLIF(trim(t.e->>'name'), ''), 'file'), 160),
             'type', left(COALESCE(t.e->>'type', ''), 100),
             'size', CASE WHEN (t.e->>'size') ~ '^[0-9]{1,10}$' THEN (t.e->>'size')::bigint END,
             'label', left(NULLIF(trim(t.e->>'label'), ''), 60),
             'caption', left(NULLIF(trim(t.e->>'caption'), ''), 300)
           )) AS item
    FROM jsonb_array_elements(p_attachments) WITH ORDINALITY AS t(e, n)
    WHERE jsonb_typeof(t.e) = 'object'
      AND (t.e->>'key') ~ '^[A-Za-z0-9._/-]{3,250}$'
      AND (t.e->>'key') NOT LIKE '%..%'
      AND (
        (t.e->>'key') LIKE 'cmms-consultation-guest/%'
        OR (NOT p_public AND (t.e->>'key') LIKE 'cmms-consultation/%')
      )
    ORDER BY t.n
    LIMIT 12
  ) s;

  RETURN v_clean;
END; $$;
REVOKE ALL ON FUNCTION public._cmms_clean_consultation_attachments(JSONB, BOOLEAN) FROM PUBLIC;

-- ─────────────────────────────────────────────────────────────────────────
-- Staff: record a walk-in submission (now with attachments)
-- ─────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.cmms_record_consultation_submission(UUID, TEXT, TEXT, TEXT, TEXT, DATE, JSONB);

CREATE OR REPLACE FUNCTION public.cmms_record_consultation_submission(
  p_form_id UUID,
  p_patient_name TEXT,
  p_patient_phone TEXT DEFAULT NULL,
  p_patient_email TEXT DEFAULT NULL,
  p_patient_address TEXT DEFAULT NULL,
  p_patient_dob DATE DEFAULT NULL,
  p_responses JSONB DEFAULT '{}'::jsonb,
  p_attachments JSONB DEFAULT '[]'::jsonb
) RETURNS public.cmms_consultation_submissions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sub public.cmms_consultation_submissions;
  v_bp UUID;
  v_name TEXT;
  v_settings JSONB;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;
  SELECT business_profile_id, name, settings INTO v_bp, v_name, v_settings FROM public.cmms_consultation_forms WHERE id = p_form_id;
  IF v_bp IS NULL OR NOT public.unified_business_member(v_bp) THEN
    RAISE EXCEPTION 'Form not found or access denied';
  END IF;
  IF p_patient_name IS NULL OR trim(p_patient_name) = '' THEN RAISE EXCEPTION 'Patient name is required'; END IF;

  INSERT INTO public.cmms_consultation_submissions
    (form_id, business_profile_id, form_name_snapshot, patient_name, patient_phone, patient_email, patient_address, patient_dob, responses, attachments, submitted_via, created_by)
  VALUES
    (p_form_id, v_bp, v_name, trim(p_patient_name), NULLIF(trim(p_patient_phone), ''), NULLIF(trim(p_patient_email), ''),
     NULLIF(trim(p_patient_address), ''), p_patient_dob,
     COALESCE(p_responses, '{}'::jsonb), public._cmms_apply_form_attachment_settings(v_settings, p_attachments, false), 'staff', auth.uid())
  RETURNING * INTO v_sub;
  RETURN v_sub;
END; $$;

-- ─────────────────────────────────────────────────────────────────────────
-- Public: a patient submits through the share link (now with attachments)
-- ─────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.cmms_submit_public_consultation_form(UUID, TEXT, TEXT, TEXT, TEXT, DATE, JSONB);

CREATE OR REPLACE FUNCTION public.cmms_submit_public_consultation_form(
  p_share_token UUID,
  p_patient_name TEXT,
  p_patient_phone TEXT DEFAULT NULL,
  p_patient_email TEXT DEFAULT NULL,
  p_patient_address TEXT DEFAULT NULL,
  p_patient_dob DATE DEFAULT NULL,
  p_responses JSONB DEFAULT '{}'::jsonb,
  p_attachments JSONB DEFAULT '[]'::jsonb
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_form public.cmms_consultation_forms;
  v_sub public.cmms_consultation_submissions;
  v_attachments JSONB;
BEGIN
  SELECT * INTO v_form FROM public.cmms_consultation_forms
   WHERE share_token = p_share_token AND share_enabled = true AND is_active = true;
  IF v_form.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'This form link is no longer available');
  END IF;
  IF p_patient_name IS NULL OR trim(p_patient_name) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Name is required');
  END IF;

  -- The owner's attachment options: off = nothing is stored; required = at least one file.
  v_attachments := public._cmms_apply_form_attachment_settings(v_form.settings, p_attachments, true);
  IF COALESCE((v_form.settings ->> 'allowAttachments')::boolean, true)
     AND COALESCE((v_form.settings ->> 'attachmentsRequired')::boolean, false)
     AND jsonb_array_length(v_attachments) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Please attach at least one photo or document.');
  END IF;

  INSERT INTO public.cmms_consultation_submissions
    (form_id, business_profile_id, form_name_snapshot, patient_name, patient_phone, patient_email, patient_address, patient_dob, responses, attachments, submitted_via, created_by)
  VALUES
    (v_form.id, v_form.business_profile_id, v_form.name, trim(p_patient_name),
     NULLIF(trim(p_patient_phone), ''), NULLIF(trim(p_patient_email), ''),
     NULLIF(trim(p_patient_address), ''), p_patient_dob,
     COALESCE(p_responses, '{}'::jsonb), v_attachments, 'public_link', NULL)
  RETURNING * INTO v_sub;

  RETURN jsonb_build_object('success', true, 'submissionId', v_sub.id);
END; $$;

-- ─────────────────────────────────────────────────────────────────────────
-- Staff: add / remove attachments on an existing record
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cmms_add_consultation_attachments(p_submission_id UUID, p_attachments JSONB)
RETURNS public.cmms_consultation_submissions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sub public.cmms_consultation_submissions;
  v_new JSONB;
  v_settings JSONB;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;
  SELECT * INTO v_sub FROM public.cmms_consultation_submissions WHERE id = p_submission_id;
  IF v_sub.id IS NULL OR NOT public.unified_business_member(v_sub.business_profile_id) THEN
    RAISE EXCEPTION 'Record not found or access denied';
  END IF;

  -- A form whose owner turned attachments off takes no new ones (a deleted form has no options: defaults).
  SELECT settings INTO v_settings FROM public.cmms_consultation_forms WHERE id = v_sub.form_id;
  IF COALESCE((v_settings ->> 'allowAttachments')::boolean, true) = false THEN
    RAISE EXCEPTION 'Attachments are turned off for this form';
  END IF;

  v_new := public._cmms_clean_consultation_attachments(p_attachments, false);
  IF jsonb_array_length(v_sub.attachments) + jsonb_array_length(v_new) > 40 THEN
    RAISE EXCEPTION 'A record can hold at most 40 attachments';
  END IF;

  UPDATE public.cmms_consultation_submissions
     SET attachments = attachments || v_new
   WHERE id = p_submission_id
  RETURNING * INTO v_sub;
  RETURN v_sub;
END; $$;

CREATE OR REPLACE FUNCTION public.cmms_remove_consultation_attachment(p_submission_id UUID, p_key TEXT)
RETURNS public.cmms_consultation_submissions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sub public.cmms_consultation_submissions;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;
  SELECT * INTO v_sub FROM public.cmms_consultation_submissions WHERE id = p_submission_id;
  IF v_sub.id IS NULL OR NOT public.unified_business_member(v_sub.business_profile_id) THEN
    RAISE EXCEPTION 'Record not found or access denied';
  END IF;

  UPDATE public.cmms_consultation_submissions
     SET attachments = COALESCE((
           SELECT jsonb_agg(a ORDER BY n)
           FROM jsonb_array_elements(attachments) WITH ORDINALITY AS t(a, n)
           WHERE a->>'key' IS DISTINCT FROM p_key
         ), '[]'::jsonb)
   WHERE id = p_submission_id
  RETURNING * INTO v_sub;
  RETURN v_sub;
END; $$;

-- ─────────────────────────────────────────────────────────────────────────
-- Public form payload: now also carries the business logo
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cmms_get_public_consultation_form(p_share_token UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_form public.cmms_consultation_forms;
  v_business_name TEXT;
  v_avatar TEXT;
  v_board_logo TEXT;
  v_fields JSONB;
BEGIN
  SELECT * INTO v_form FROM public.cmms_consultation_forms
   WHERE share_token = p_share_token AND share_enabled = true AND is_active = true;
  IF v_form.id IS NULL THEN RETURN NULL; END IF;

  SELECT business_name, avatar_url INTO v_business_name, v_avatar
    FROM public.business_profiles WHERE id = v_form.business_profile_id;

  -- The CMMS Board logo wins over the business profile's avatar, matching
  -- fn_get_public_cmms_company_header. A business with no CMMS company
  -- profile yet simply has no board logo.
  SELECT NULLIF(trim(cp.logo_url), '') INTO v_board_logo
    FROM public.cmms_company_profiles cp
   WHERE cp.pichin_business_profile_id = v_form.business_profile_id
   LIMIT 1;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', id, 'label', label, 'fieldKey', field_key, 'fieldType', field_type,
    'options', options, 'isRequired', is_required
  ) ORDER BY sort_order, created_at), '[]'::jsonb)
  INTO v_fields
  FROM public.cmms_consultation_form_fields
  WHERE form_id = v_form.id;

  RETURN jsonb_build_object(
    'formId', v_form.id,
    'formName', v_form.name,
    'formDescription', v_form.description,
    'businessName', v_business_name,
    'businessLogo', COALESCE(v_board_logo, NULLIF(trim(v_avatar), '')),
    'settings', COALESCE(v_form.settings, '{}'::jsonb),
    'fields', v_fields
  );
END; $$;

REVOKE ALL ON FUNCTION public.cmms_record_consultation_submission(UUID, TEXT, TEXT, TEXT, TEXT, DATE, JSONB, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cmms_submit_public_consultation_form(UUID, TEXT, TEXT, TEXT, TEXT, DATE, JSONB, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cmms_save_consultation_form_settings(UUID, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cmms_add_consultation_attachments(UUID, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cmms_remove_consultation_attachment(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cmms_get_public_consultation_form(UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.cmms_record_consultation_submission(UUID, TEXT, TEXT, TEXT, TEXT, DATE, JSONB, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cmms_submit_public_consultation_form(UUID, TEXT, TEXT, TEXT, TEXT, DATE, JSONB, JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cmms_save_consultation_form_settings(UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cmms_add_consultation_attachments(UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cmms_remove_consultation_attachment(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cmms_get_public_consultation_form(UUID) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

SELECT 'CMMS consultation forms: business logo, QR codes and attachments installed.' AS status;
