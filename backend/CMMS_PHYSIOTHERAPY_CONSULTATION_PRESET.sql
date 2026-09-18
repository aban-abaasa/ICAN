-- ============================================================
-- CMMS CLINICAL CONSULTATION FORMS — section headers + a ready-made
-- "Physiotherapy Initial Consultation" preset
-- ============================================================
-- Two additions on top of CMMS_CLINICAL_CONSULTATION_FORMS.sql:
--
--   1. A new field_type value, 'section' — a display-only heading with no
--      input, used to lay a form out in named sections (e.g. "Personal
--      Details", "Chief Complaint & Pain Assessment") the way a printed
--      clinical intake form is normally organised. It carries no options,
--      is never required, and is never part of a submission's `responses`
--      — the builder, public form, print view and PDF export all treat it
--      as a heading/divider, not a question. Section labels are stored
--      bare (no "1. " prefix) — the frontend numbers sections 1, 2, 3...
--      fresh from their live order every time they're displayed
--      (sectionDisplayLabel in consultationSubmissionUtils.js), so
--      reordering/adding/deleting a section never leaves a stale number
--      behind and there is nothing to keep in sync here.
--
--   2. cmms_add_physiotherapy_consultation_fields() — a second one-click
--      preset alongside cmms_add_common_clinical_fields(), matching a
--      standard physiotherapy initial-consultation intake form section for
--      section (personal details; chief complaint incl. a 0–10 pain scale
--      and pain-type checkboxes; red-flag medical screening; lifestyle and
--      goals; consent + signature). Like the existing preset, every field
--      it adds becomes an ordinary row afterward — fully editable,
--      reorderable and deletable, same as a hand-built form — and it never
--      duplicates a field_key already on the form. Full name / phone /
--      email / address / date of birth are deliberately left out: the
--      public form and staff walk-in form already collect those as the
--      submission's own patient_name/patient_phone/patient_email/
--      patient_address/patient_dob columns (see
--      CMMS_CONSULTATION_ADDRESS_DOB.sql for the latter two).
--
-- Run after: CMMS_CLINICAL_CONSULTATION_FORMS.sql.
-- Safe to run more than once.
-- ============================================================

-- Widen the field_type CHECK to include 'section', whatever its
-- auto-generated constraint name turned out to be.
DO $$
DECLARE
  v_conname TEXT;
BEGIN
  SELECT conname INTO v_conname
  FROM pg_constraint
  WHERE conrelid = 'public.cmms_consultation_form_fields'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%field_type%';
  IF v_conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.cmms_consultation_form_fields DROP CONSTRAINT %I', v_conname);
  END IF;
END $$;

ALTER TABLE public.cmms_consultation_form_fields
  ADD CONSTRAINT cmms_consultation_form_fields_field_type_check
  CHECK (field_type IN ('text', 'textarea', 'date', 'number', 'select', 'multiselect', 'checkbox', 'section'));

-- Same as CMMS_CLINICAL_CONSULTATION_FORMS.sql's version, with 'section'
-- added to the accepted field_type list.
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
  IF lower(trim(p_field_type)) NOT IN ('text', 'textarea', 'date', 'number', 'select', 'multiselect', 'checkbox', 'section') THEN
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

CREATE OR REPLACE FUNCTION public.cmms_add_physiotherapy_consultation_fields(p_form_id UUID)
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
      ('section_personal_details', 'Personal Details', 'section', NULL::jsonb, false),
      ('gender', 'Gender', 'select', '["Male","Female","Other"]'::jsonb, false),
      ('emergency_contact', 'Emergency contact (name & relationship)', 'text', NULL::jsonb, false),
      ('emergency_phone', 'Emergency phone', 'text', NULL::jsonb, false),
      ('occupation', 'Occupation', 'text', NULL::jsonb, false),

      ('section_chief_complaint', 'Chief Complaint & Pain Assessment', 'section', NULL::jsonb, false),
      ('primary_reason_for_visit', 'Primary reason for visit', 'textarea', NULL::jsonb, true),
      ('symptom_onset', 'When did the symptoms begin?', 'text', NULL::jsonb, false),
      ('how_issue_occurred', 'How did the issue occur? (e.g. sudden injury, gradual onset, surgery, posture)', 'textarea', NULL::jsonb, false),
      ('pain_scale_current', 'Pain scale - current (0-10)', 'number', NULL::jsonb, false),
      ('pain_scale_best', 'Pain scale - best (0-10)', 'number', NULL::jsonb, false),
      ('pain_scale_worst', 'Pain scale - worst (0-10)', 'number', NULL::jsonb, false),
      ('pain_type', 'Type of pain', 'multiselect', '["Dull / Aching","Sharp / Stabbing","Burning","Throbbing","Numbness / Tingling","Stiffness / Tightness"]'::jsonb, false),
      ('pain_better', 'What makes the pain better?', 'textarea', NULL::jsonb, false),
      ('pain_worse', 'What makes the pain worse?', 'textarea', NULL::jsonb, false),

      ('section_medical_history', 'Medical History & Screening', 'section', NULL::jsonb, false),
      ('had_physio_before', 'Have you had physiotherapy before?', 'checkbox', NULL::jsonb, false),
      ('recent_imaging', 'Recent X-rays, MRIs, or CT scans for this issue?', 'checkbox', NULL::jsonb, false),
      ('medical_screening', 'Do you currently have or have a history of any of the following?', 'multiselect', '["High / Low Blood Pressure","Diabetes","Heart Condition","Osteoporosis / Osteopenia","Recent Surgeries or Fractures","Cancer / Tumors","Dizziness or Balance Issues","Pregnancy (if applicable)"]'::jsonb, false),
      ('current_medications_supplements', 'Current medications / supplements', 'textarea', NULL::jsonb, false),

      ('section_lifestyle_goals', 'Daily Lifestyle & Goals', 'section', NULL::jsonb, false),
      ('activity_level', 'Physical activity level', 'select', '["Sedentary","Light","Moderate","Highly Active"]'::jsonb, false),
      ('sleep_quality', 'Sleep quality', 'select', '["Good","Moderate","Disturbed by pain"]'::jsonb, false),
      ('treatment_goals', 'What are your primary goals for treatment? (e.g. pain relief, return to sport, better mobility, daily function)', 'textarea', NULL::jsonb, false),

      ('section_consent', 'Consent & Acknowledgment', 'section', NULL::jsonb, false),
      ('consent_acknowledgment', 'I understand that physical therapy involves an initial evaluation and ongoing treatment techniques (e.g. manual therapy, exercise prescription, electrotherapy). I consent to evaluation and treatment as recommended by my physiotherapist.', 'checkbox', NULL::jsonb, true),
      ('client_signature', 'Client signature (type full name to sign)', 'text', NULL::jsonb, true)
    ) AS presets(key, label, ftype, opts, required)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM public.cmms_consultation_form_fields WHERE form_id = p_form_id AND field_key = v_preset.key) THEN
      INSERT INTO public.cmms_consultation_form_fields (form_id, label, field_key, field_type, options, is_required, sort_order)
      VALUES (p_form_id, v_preset.label, v_preset.key, v_preset.ftype, v_preset.opts, v_preset.required, v_next_sort);
      v_next_sort := v_next_sort + 1;
    END IF;
  END LOOP;

  RETURN QUERY SELECT * FROM public.cmms_consultation_form_fields WHERE form_id = p_form_id ORDER BY sort_order;
END; $$;

REVOKE ALL ON FUNCTION public.cmms_add_physiotherapy_consultation_fields(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cmms_add_physiotherapy_consultation_fields(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';

SELECT 'CMMS physiotherapy consultation preset installed.' AS status;
