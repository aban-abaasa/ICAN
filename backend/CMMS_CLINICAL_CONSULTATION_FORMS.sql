-- ============================================================
-- CMMS CLINICAL OPERATIONS — customizable consultation forms
-- ============================================================
-- "Clinical Operations" (CMMSOperationsPanel.jsx, mode='clinical') today is
-- only a generic activity log (handovers, incidents, equipment checks) —
-- there is no patient consultation/intake form anywhere in CMMS. This adds
-- one, as a second sub-tab alongside that activity log (see
-- CMMSClinicalOperationsPanel.jsx), scoped to the SAME business_profile_id
-- every other CMMS specialist module already uses (see
-- CMMS_SPECIALIST_OPERATIONS.sql) — a clinic's business_profiles row is
-- already single-tenant (created via the Pichin business-onboarding flow),
-- so no cross-repo business bridge is needed here.
--
-- Three tables:
--   cmms_consultation_forms        — one form definition per clinic
--     (e.g. "General Consultation"), carries its own public share_token.
--   cmms_consultation_form_fields  — the customizable questions on a form.
--     A handful of common clinical fields (bio, medical history, allergies,
--     current medications, injuries, surgical history, next of kin) can be
--     one-click-added via cmms_add_common_clinical_fields(), but a clinic
--     can add ANY custom field on top of or instead of those — nothing is
--     hardcoded beyond the field_type vocabulary.
--   cmms_consultation_submissions  — filled-out patient responses, either
--     recorded by staff in person/by phone, or submitted by a patient
--     through the public share link (cmms_submit_public_consultation_form).
--     form_id is ON DELETE SET NULL (not CASCADE) and form_name_snapshot is
--     captured at submit time, so a patient's clinical record survives even
--     if the form template is later edited or deleted — this is meant to be
--     a real record, not a disposable one.
--
-- Same shape as CMMS_SPECIALIST_OPERATIONS.sql throughout: RLS exposes only
-- a SELECT policy scoped by unified_business_member(); every write goes
-- through a SECURITY DEFINER RPC (which also re-checks membership and, for
-- creating a form, that the 'clinical' module is enabled for the business).
-- The two public RPCs (anon-callable) are the only exception, gated by
-- share_token + share_enabled instead of membership.
--
-- Run after: CMMS_SPECIALIST_OPERATIONS.sql.
-- Safe to run more than once.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.cmms_consultation_forms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_profile_id UUID NOT NULL REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  -- A form is always minted a token at creation (so enabling sharing later
  -- never needs a migration step of its own) — share_enabled is the actual
  -- on/off switch a public visitor's access is gated by.
  share_enabled BOOLEAN NOT NULL DEFAULT false,
  share_token UUID NOT NULL DEFAULT gen_random_uuid(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cmms_consultation_forms_share_token ON public.cmms_consultation_forms(share_token);
CREATE INDEX IF NOT EXISTS idx_cmms_consultation_forms_business ON public.cmms_consultation_forms(business_profile_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.cmms_consultation_form_fields (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id UUID NOT NULL REFERENCES public.cmms_consultation_forms(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  -- Stable identifier a submission's `responses` JSONB is keyed by — derived
  -- from the label once at creation (see _cmms_slugify_field_key below) and
  -- never changed afterward, even if the label is later edited, so past
  -- answers never get silently orphaned by a rename.
  field_key TEXT NOT NULL,
  field_type TEXT NOT NULL CHECK (field_type IN ('text', 'textarea', 'date', 'number', 'select', 'multiselect', 'checkbox')),
  options JSONB,
  is_required BOOLEAN NOT NULL DEFAULT false,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(form_id, field_key)
);
CREATE INDEX IF NOT EXISTS idx_cmms_consultation_form_fields_form ON public.cmms_consultation_form_fields(form_id, sort_order);

CREATE TABLE IF NOT EXISTS public.cmms_consultation_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id UUID REFERENCES public.cmms_consultation_forms(id) ON DELETE SET NULL,
  business_profile_id UUID NOT NULL REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  form_name_snapshot TEXT,
  patient_name TEXT NOT NULL,
  patient_phone TEXT,
  patient_email TEXT,
  responses JSONB NOT NULL DEFAULT '{}'::jsonb,
  submitted_via TEXT NOT NULL DEFAULT 'staff' CHECK (submitted_via IN ('staff', 'public_link')),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cmms_consultation_submissions_business ON public.cmms_consultation_submissions(business_profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cmms_consultation_submissions_form ON public.cmms_consultation_submissions(form_id, created_at DESC);

ALTER TABLE public.cmms_consultation_forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cmms_consultation_form_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cmms_consultation_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cmms_consultation_forms_read ON public.cmms_consultation_forms;
CREATE POLICY cmms_consultation_forms_read ON public.cmms_consultation_forms
  FOR SELECT TO authenticated
  USING (public.unified_business_member(business_profile_id));

DROP POLICY IF EXISTS cmms_consultation_form_fields_read ON public.cmms_consultation_form_fields;
CREATE POLICY cmms_consultation_form_fields_read ON public.cmms_consultation_form_fields
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.cmms_consultation_forms f
    WHERE f.id = form_id AND public.unified_business_member(f.business_profile_id)
  ));

DROP POLICY IF EXISTS cmms_consultation_submissions_read ON public.cmms_consultation_submissions;
CREATE POLICY cmms_consultation_submissions_read ON public.cmms_consultation_submissions
  FOR SELECT TO authenticated
  USING (public.unified_business_member(business_profile_id));

GRANT SELECT ON TABLE public.cmms_consultation_forms TO authenticated;
GRANT SELECT ON TABLE public.cmms_consultation_form_fields TO authenticated;
GRANT SELECT ON TABLE public.cmms_consultation_submissions TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- Internal helper — not exposed as an RPC, just used by
-- cmms_save_consultation_field below.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._cmms_slugify_field_key(p_form_id UUID, p_label TEXT)
RETURNS TEXT
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_base TEXT;
  v_key TEXT;
  v_n INT := 1;
BEGIN
  v_base := trim(both '_' from regexp_replace(lower(trim(p_label)), '[^a-z0-9]+', '_', 'g'));
  IF v_base = '' THEN v_base := 'field'; END IF;
  v_key := v_base;
  WHILE EXISTS (
    SELECT 1 FROM public.cmms_consultation_form_fields WHERE form_id = p_form_id AND field_key = v_key
  ) LOOP
    v_n := v_n + 1;
    v_key := v_base || '_' || v_n;
  END LOOP;
  RETURN v_key;
END; $$;
REVOKE ALL ON FUNCTION public._cmms_slugify_field_key(UUID, TEXT) FROM PUBLIC;

-- ─────────────────────────────────────────────────────────────────────────
-- STAFF RPCs (authenticated, membership-checked)
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.cmms_save_consultation_form(
  p_id UUID DEFAULT NULL,
  p_business_profile_id UUID DEFAULT NULL,
  p_name TEXT DEFAULT NULL,
  p_description TEXT DEFAULT NULL,
  p_is_active BOOLEAN DEFAULT true
) RETURNS public.cmms_consultation_forms
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_form public.cmms_consultation_forms;
  v_bp UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;

  IF p_id IS NOT NULL THEN
    SELECT business_profile_id INTO v_bp FROM public.cmms_consultation_forms WHERE id = p_id;
    IF v_bp IS NULL OR NOT public.unified_business_member(v_bp) THEN
      RAISE EXCEPTION 'Form not found or access denied';
    END IF;
    UPDATE public.cmms_consultation_forms
       SET name = COALESCE(NULLIF(trim(p_name), ''), name),
           description = p_description,
           is_active = COALESCE(p_is_active, is_active),
           updated_at = now()
     WHERE id = p_id
    RETURNING * INTO v_form;
    RETURN v_form;
  END IF;

  IF p_business_profile_id IS NULL OR NOT public.unified_business_member(p_business_profile_id) THEN
    RAISE EXCEPTION 'Business membership required';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.business_profile_modules
    WHERE business_profile_id = p_business_profile_id AND module_key = 'clinical' AND enabled
  ) THEN RAISE EXCEPTION 'Clinical Operations module is not enabled for this business'; END IF;
  IF p_name IS NULL OR trim(p_name) = '' THEN RAISE EXCEPTION 'Form name is required'; END IF;

  INSERT INTO public.cmms_consultation_forms (business_profile_id, name, description, is_active, created_by)
  VALUES (p_business_profile_id, trim(p_name), NULLIF(trim(p_description), ''), COALESCE(p_is_active, true), auth.uid())
  RETURNING * INTO v_form;
  RETURN v_form;
END; $$;

CREATE OR REPLACE FUNCTION public.cmms_delete_consultation_form(p_form_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_bp UUID;
BEGIN
  SELECT business_profile_id INTO v_bp FROM public.cmms_consultation_forms WHERE id = p_form_id;
  IF v_bp IS NULL OR NOT public.unified_business_member(v_bp) THEN
    RAISE EXCEPTION 'Form not found or access denied';
  END IF;
  DELETE FROM public.cmms_consultation_forms WHERE id = p_form_id;
  RETURN true;
END; $$;

CREATE OR REPLACE FUNCTION public.cmms_set_consultation_form_share(p_form_id UUID, p_enabled BOOLEAN)
RETURNS public.cmms_consultation_forms
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_form public.cmms_consultation_forms;
  v_bp UUID;
BEGIN
  SELECT business_profile_id INTO v_bp FROM public.cmms_consultation_forms WHERE id = p_form_id;
  IF v_bp IS NULL OR NOT public.unified_business_member(v_bp) THEN
    RAISE EXCEPTION 'Form not found or access denied';
  END IF;
  UPDATE public.cmms_consultation_forms
     SET share_enabled = COALESCE(p_enabled, false), updated_at = now()
   WHERE id = p_form_id
  RETURNING * INTO v_form;
  RETURN v_form;
END; $$;

CREATE OR REPLACE FUNCTION public.cmms_save_consultation_field(
  p_id UUID DEFAULT NULL,
  p_form_id UUID DEFAULT NULL,
  p_label TEXT DEFAULT NULL,
  p_field_type TEXT DEFAULT 'text',
  p_options JSONB DEFAULT NULL,
  p_is_required BOOLEAN DEFAULT false,
  p_sort_order INT DEFAULT 0
) RETURNS public.cmms_consultation_form_fields
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_field public.cmms_consultation_form_fields;
  v_bp UUID;
  v_key TEXT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;
  IF lower(trim(p_field_type)) NOT IN ('text', 'textarea', 'date', 'number', 'select', 'multiselect', 'checkbox') THEN
    RAISE EXCEPTION 'Unsupported field type';
  END IF;

  IF p_id IS NOT NULL THEN
    SELECT f.business_profile_id INTO v_bp
    FROM public.cmms_consultation_form_fields ff
    JOIN public.cmms_consultation_forms f ON f.id = ff.form_id
    WHERE ff.id = p_id;
    IF v_bp IS NULL OR NOT public.unified_business_member(v_bp) THEN
      RAISE EXCEPTION 'Field not found or access denied';
    END IF;
    UPDATE public.cmms_consultation_form_fields
       SET label = COALESCE(NULLIF(trim(p_label), ''), label),
           field_type = lower(trim(p_field_type)),
           options = p_options,
           is_required = COALESCE(p_is_required, false),
           sort_order = COALESCE(p_sort_order, sort_order)
     WHERE id = p_id
    RETURNING * INTO v_field;
    RETURN v_field;
  END IF;

  IF p_form_id IS NULL OR p_label IS NULL OR trim(p_label) = '' THEN
    RAISE EXCEPTION 'Form and label are required';
  END IF;
  SELECT business_profile_id INTO v_bp FROM public.cmms_consultation_forms WHERE id = p_form_id;
  IF v_bp IS NULL OR NOT public.unified_business_member(v_bp) THEN
    RAISE EXCEPTION 'Form not found or access denied';
  END IF;

  v_key := public._cmms_slugify_field_key(p_form_id, p_label);
  INSERT INTO public.cmms_consultation_form_fields
    (form_id, label, field_key, field_type, options, is_required, sort_order)
  VALUES
    (p_form_id, trim(p_label), v_key, lower(trim(p_field_type)), p_options, COALESCE(p_is_required, false), COALESCE(p_sort_order, 0))
  RETURNING * INTO v_field;
  RETURN v_field;
END; $$;

CREATE OR REPLACE FUNCTION public.cmms_delete_consultation_field(p_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_bp UUID;
BEGIN
  SELECT f.business_profile_id INTO v_bp
  FROM public.cmms_consultation_form_fields ff
  JOIN public.cmms_consultation_forms f ON f.id = ff.form_id
  WHERE ff.id = p_id;
  IF v_bp IS NULL OR NOT public.unified_business_member(v_bp) THEN
    RAISE EXCEPTION 'Field not found or access denied';
  END IF;
  DELETE FROM public.cmms_consultation_form_fields WHERE id = p_id;
  RETURN true;
END; $$;

-- One-click starter set matching the fields explicitly asked for (bio,
-- medical history, injuries, surgical history, next of kin) plus the two
-- fields any real intake form needs alongside "medical history" (allergies,
-- current medications). Purely a convenience seed — every field it adds is
-- an ordinary row afterward, editable and deletable like any custom one,
-- and it never duplicates a field_key that's already on the form.
CREATE OR REPLACE FUNCTION public.cmms_add_common_clinical_fields(p_form_id UUID)
RETURNS SETOF public.cmms_consultation_form_fields
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_bp UUID;
  v_next_sort INT;
  v_preset RECORD;
BEGIN
  SELECT business_profile_id INTO v_bp FROM public.cmms_consultation_forms WHERE id = p_form_id;
  IF v_bp IS NULL OR NOT public.unified_business_member(v_bp) THEN
    RAISE EXCEPTION 'Form not found or access denied';
  END IF;
  SELECT COALESCE(MAX(sort_order), -1) + 1 INTO v_next_sort FROM public.cmms_consultation_form_fields WHERE form_id = p_form_id;

  FOR v_preset IN
    SELECT * FROM (VALUES
      ('bio', 'Bio', 'textarea'),
      ('medical_history', 'Medical history', 'textarea'),
      ('allergies', 'Allergies', 'textarea'),
      ('current_medications', 'Current medications', 'textarea'),
      ('injuries', 'Injuries', 'textarea'),
      ('surgical_history', 'Surgical history', 'textarea'),
      ('next_of_kin_name', 'Next of kin — name', 'text'),
      ('next_of_kin_phone', 'Next of kin — phone', 'text'),
      ('next_of_kin_relationship', 'Next of kin — relationship', 'text')
    ) AS presets(key, label, ftype)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM public.cmms_consultation_form_fields WHERE form_id = p_form_id AND field_key = v_preset.key) THEN
      INSERT INTO public.cmms_consultation_form_fields (form_id, label, field_key, field_type, is_required, sort_order)
      VALUES (p_form_id, v_preset.label, v_preset.key, v_preset.ftype, false, v_next_sort);
      v_next_sort := v_next_sort + 1;
    END IF;
  END LOOP;

  RETURN QUERY SELECT * FROM public.cmms_consultation_form_fields WHERE form_id = p_form_id ORDER BY sort_order;
END; $$;

CREATE OR REPLACE FUNCTION public.cmms_record_consultation_submission(
  p_form_id UUID,
  p_patient_name TEXT,
  p_patient_phone TEXT DEFAULT NULL,
  p_patient_email TEXT DEFAULT NULL,
  p_responses JSONB DEFAULT '{}'::jsonb
) RETURNS public.cmms_consultation_submissions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sub public.cmms_consultation_submissions;
  v_bp UUID;
  v_name TEXT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;
  SELECT business_profile_id, name INTO v_bp, v_name FROM public.cmms_consultation_forms WHERE id = p_form_id;
  IF v_bp IS NULL OR NOT public.unified_business_member(v_bp) THEN
    RAISE EXCEPTION 'Form not found or access denied';
  END IF;
  IF p_patient_name IS NULL OR trim(p_patient_name) = '' THEN RAISE EXCEPTION 'Patient name is required'; END IF;

  INSERT INTO public.cmms_consultation_submissions
    (form_id, business_profile_id, form_name_snapshot, patient_name, patient_phone, patient_email, responses, submitted_via, created_by)
  VALUES
    (p_form_id, v_bp, v_name, trim(p_patient_name), NULLIF(trim(p_patient_phone), ''), NULLIF(trim(p_patient_email), ''),
     COALESCE(p_responses, '{}'::jsonb), 'staff', auth.uid())
  RETURNING * INTO v_sub;
  RETURN v_sub;
END; $$;

-- ─────────────────────────────────────────────────────────────────────────
-- PUBLIC RPCs (anon — gated by share_token + share_enabled, not membership)
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.cmms_get_public_consultation_form(p_share_token UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_form public.cmms_consultation_forms;
  v_business_name TEXT;
  v_fields JSONB;
BEGIN
  SELECT * INTO v_form FROM public.cmms_consultation_forms
   WHERE share_token = p_share_token AND share_enabled = true AND is_active = true;
  IF v_form.id IS NULL THEN RETURN NULL; END IF;

  SELECT business_name INTO v_business_name FROM public.business_profiles WHERE id = v_form.business_profile_id;

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
    'fields', v_fields
  );
END; $$;

CREATE OR REPLACE FUNCTION public.cmms_submit_public_consultation_form(
  p_share_token UUID,
  p_patient_name TEXT,
  p_patient_phone TEXT DEFAULT NULL,
  p_patient_email TEXT DEFAULT NULL,
  p_responses JSONB DEFAULT '{}'::jsonb
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_form public.cmms_consultation_forms;
  v_sub public.cmms_consultation_submissions;
BEGIN
  SELECT * INTO v_form FROM public.cmms_consultation_forms
   WHERE share_token = p_share_token AND share_enabled = true AND is_active = true;
  IF v_form.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'This form link is no longer available');
  END IF;
  IF p_patient_name IS NULL OR trim(p_patient_name) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Name is required');
  END IF;

  INSERT INTO public.cmms_consultation_submissions
    (form_id, business_profile_id, form_name_snapshot, patient_name, patient_phone, patient_email, responses, submitted_via, created_by)
  VALUES
    (v_form.id, v_form.business_profile_id, v_form.name, trim(p_patient_name),
     NULLIF(trim(p_patient_phone), ''), NULLIF(trim(p_patient_email), ''),
     COALESCE(p_responses, '{}'::jsonb), 'public_link', NULL)
  RETURNING * INTO v_sub;

  RETURN jsonb_build_object('success', true, 'submissionId', v_sub.id);
END; $$;

REVOKE ALL ON FUNCTION public.cmms_save_consultation_form(UUID, UUID, TEXT, TEXT, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cmms_delete_consultation_form(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cmms_set_consultation_form_share(UUID, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cmms_save_consultation_field(UUID, UUID, TEXT, TEXT, JSONB, BOOLEAN, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cmms_delete_consultation_field(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cmms_add_common_clinical_fields(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cmms_record_consultation_submission(UUID, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cmms_get_public_consultation_form(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cmms_submit_public_consultation_form(UUID, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.cmms_save_consultation_form(UUID, UUID, TEXT, TEXT, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cmms_delete_consultation_form(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cmms_set_consultation_form_share(UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cmms_save_consultation_field(UUID, UUID, TEXT, TEXT, JSONB, BOOLEAN, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cmms_delete_consultation_field(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cmms_add_common_clinical_fields(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cmms_record_consultation_submission(UUID, TEXT, TEXT, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cmms_get_public_consultation_form(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cmms_submit_public_consultation_form(UUID, TEXT, TEXT, TEXT, JSONB) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

SELECT 'CMMS clinical consultation forms installed.' AS status;
