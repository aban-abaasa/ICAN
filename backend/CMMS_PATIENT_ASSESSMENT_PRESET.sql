-- ============================================================
-- CMMS CLINICAL CONSULTATION FORMS — "Patient Assessment
-- Information Form" preset
-- ============================================================
-- A third one-click preset (alongside cmms_add_common_clinical_fields and
-- cmms_add_physiotherapy_consultation_fields), matching a general
-- wellness/naturopathic-style patient assessment intake form. The source
-- document is one flat numbered list with no sections at all and ticks
-- everything as an individual checkbox ("☐ Male ☐ Female ☐ Other",
-- "☐ Daily ☐ Weekly ☐ Rarely ☐ Never", ...) — here every such single-choice
-- question becomes one dropdown (field_type 'select') instead of a row of
-- checkboxes, a real Yes/No question becomes one checkbox, and the flat
-- list is regrouped into five named sections (Personal Information,
-- Lifestyle & Habits, Health Background, Assessment & Goals, Consent &
-- Acknowledgment) using the 'section' field type from
-- CMMS_PHYSIOTHERAPY_CONSULTATION_PRESET.sql. Section labels are stored
-- bare, with no "1. " prefix — the frontend numbers sections 1, 2, 3...
-- fresh from their live order every time they're displayed
-- (sectionDisplayLabel in consultationSubmissionUtils.js), so
-- reordering/adding/deleting a section never leaves a stale number behind.
-- Like the other presets, every field it adds becomes an ordinary
-- editable/reorderable/deletable row afterward, and it never duplicates a
-- field_key already on the form. Full name / phone / email / address /
-- date of birth are left out: the public form and staff walk-in form
-- already collect those as the submission's own patient_name/
-- patient_phone/patient_email/patient_address/patient_dob columns (see
-- CMMS_CONSULTATION_ADDRESS_DOB.sql for the latter two).
--
-- Run after: CMMS_CLINICAL_CONSULTATION_FORMS.sql. Includes its own copy
-- of the 'section' field_type widening (safe/idempotent) so it does not
-- strictly depend on CMMS_PHYSIOTHERAPY_CONSULTATION_PRESET.sql having run
-- first, even though running that one too is recommended.
-- Safe to run more than once.
-- ============================================================

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

CREATE OR REPLACE FUNCTION public.cmms_add_patient_assessment_fields(p_form_id UUID)
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
      ('section_personal_info', 'Personal Information', 'section', NULL::jsonb, false),
      ('age', 'Age', 'number', NULL::jsonb, false),
      ('gender', 'Gender', 'select', '["Male","Female","Other"]'::jsonb, false),
      ('marital_status', 'Marital status', 'select', '["Single","Married","Divorced","Widowed"]'::jsonb, false),
      ('occupation', 'Occupation', 'text', NULL::jsonb, false),
      ('emergency_contact', 'Emergency contact (name & phone)', 'text', NULL::jsonb, false),
      ('preferred_communication', 'Preferred method of communication', 'select', '["Phone","Email","In-person"]'::jsonb, false),

      ('section_lifestyle', 'Lifestyle & Habits', 'section', NULL::jsonb, false),
      ('smokes', 'Do you smoke?', 'checkbox', NULL::jsonb, false),
      ('uses_alcohol', 'Do you use alcohol?', 'checkbox', NULL::jsonb, false),
      ('uses_recreational_drugs', 'Do you use recreational drugs?', 'checkbox', NULL::jsonb, false),
      ('exercise_frequency', 'Exercise frequency', 'select', '["Daily","Weekly","Rarely","Never"]'::jsonb, false),
      ('diet_nutrition_notes', 'Diet / nutrition notes', 'textarea', NULL::jsonb, false),

      ('section_health_background', 'Health Background', 'section', NULL::jsonb, false),
      ('health_background', 'Primary health concern, current diagnosis, past medical conditions, current medications, allergies, previous surgeries/hospitalizations, genetic conditions', 'textarea', NULL::jsonb, true),

      ('section_assessment_goals', 'Assessment & Goals', 'section', NULL::jsonb, false),
      ('recommendations_treatments', 'Recommendations and treatments', 'textarea', NULL::jsonb, false),
      ('services_seeking', 'What services are you seeking?', 'textarea', NULL::jsonb, false),
      ('short_term_goals', 'What are your short-term goals?', 'textarea', NULL::jsonb, false),
      ('long_term_goals', 'What are your long-term goals?', 'textarea', NULL::jsonb, false),

      ('section_consent', 'Consent & Acknowledgment', 'section', NULL::jsonb, false),
      ('consent_acknowledgment', 'I hereby consent to assessment and treatment services provided by this practice. I understand that my information will be kept confidential in accordance with applicable laws.', 'checkbox', NULL::jsonb, true),
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

REVOKE ALL ON FUNCTION public.cmms_add_patient_assessment_fields(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cmms_add_patient_assessment_fields(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';

SELECT 'CMMS patient assessment preset installed.' AS status;
