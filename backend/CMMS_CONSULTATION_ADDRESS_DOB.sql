-- ============================================================
-- CMMS CLINICAL CONSULTATION FORMS — patient address & date of birth
-- as built-in identity fields
-- ============================================================
-- Full name / phone / email were already collected on every consultation
-- form as the submission's own patient_name/patient_phone/patient_email
-- columns — never a custom field, so no clinic has to remember to add
-- them and no preset duplicates them. Address and date of birth are just
-- as universal on a real clinical intake form, so they join that same
-- built-in identity block (public form, staff walk-in form) instead of
-- being something a clinic must add as a custom field.
--
-- cmms_add_physiotherapy_consultation_fields' own "Date of birth" field
-- and cmms_add_patient_assessment_fields' own "Address" field are removed
-- in this file's copy of those two functions (see
-- CMMS_PHYSIOTHERAPY_CONSULTATION_PRESET.sql /
-- CMMS_PATIENT_ASSESSMENT_PRESET.sql) so a form built from either preset
-- doesn't ask for the same thing twice.
--
-- Run after: CMMS_CLINICAL_CONSULTATION_FORMS.sql,
-- CMMS_PHYSIOTHERAPY_CONSULTATION_PRESET.sql,
-- CMMS_PATIENT_ASSESSMENT_PRESET.sql.
-- Safe to run more than once.
-- ============================================================

ALTER TABLE public.cmms_consultation_submissions
  ADD COLUMN IF NOT EXISTS patient_address TEXT,
  ADD COLUMN IF NOT EXISTS patient_dob DATE;

-- Signature changed (two new params) — drop first so CREATE OR REPLACE
-- can't collide with the old signature as a distinct overload.
DROP FUNCTION IF EXISTS public.cmms_record_consultation_submission(UUID, TEXT, TEXT, TEXT, JSONB);

CREATE OR REPLACE FUNCTION public.cmms_record_consultation_submission(
  p_form_id UUID,
  p_patient_name TEXT,
  p_patient_phone TEXT DEFAULT NULL,
  p_patient_email TEXT DEFAULT NULL,
  p_patient_address TEXT DEFAULT NULL,
  p_patient_dob DATE DEFAULT NULL,
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
    (form_id, business_profile_id, form_name_snapshot, patient_name, patient_phone, patient_email, patient_address, patient_dob, responses, submitted_via, created_by)
  VALUES
    (p_form_id, v_bp, v_name, trim(p_patient_name), NULLIF(trim(p_patient_phone), ''), NULLIF(trim(p_patient_email), ''),
     NULLIF(trim(p_patient_address), ''), p_patient_dob,
     COALESCE(p_responses, '{}'::jsonb), 'staff', auth.uid())
  RETURNING * INTO v_sub;
  RETURN v_sub;
END; $$;

DROP FUNCTION IF EXISTS public.cmms_submit_public_consultation_form(UUID, TEXT, TEXT, TEXT, JSONB);

CREATE OR REPLACE FUNCTION public.cmms_submit_public_consultation_form(
  p_share_token UUID,
  p_patient_name TEXT,
  p_patient_phone TEXT DEFAULT NULL,
  p_patient_email TEXT DEFAULT NULL,
  p_patient_address TEXT DEFAULT NULL,
  p_patient_dob DATE DEFAULT NULL,
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
    (form_id, business_profile_id, form_name_snapshot, patient_name, patient_phone, patient_email, patient_address, patient_dob, responses, submitted_via, created_by)
  VALUES
    (v_form.id, v_form.business_profile_id, v_form.name, trim(p_patient_name),
     NULLIF(trim(p_patient_phone), ''), NULLIF(trim(p_patient_email), ''),
     NULLIF(trim(p_patient_address), ''), p_patient_dob,
     COALESCE(p_responses, '{}'::jsonb), 'public_link', NULL)
  RETURNING * INTO v_sub;

  RETURN jsonb_build_object('success', true, 'submissionId', v_sub.id);
END; $$;

REVOKE ALL ON FUNCTION public.cmms_record_consultation_submission(UUID, TEXT, TEXT, TEXT, TEXT, DATE, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cmms_submit_public_consultation_form(UUID, TEXT, TEXT, TEXT, TEXT, DATE, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cmms_record_consultation_submission(UUID, TEXT, TEXT, TEXT, TEXT, DATE, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cmms_submit_public_consultation_form(UUID, TEXT, TEXT, TEXT, TEXT, DATE, JSONB) TO anon, authenticated;

-- Drop the now-redundant fields these two presets used to add themselves.
-- IF EXISTS-guarded per form, so this only touches forms that actually
-- have them — a clinic that already renamed/customized either field keeps
-- whatever it has (nothing here force-deletes an edited field).
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

  DELETE FROM public.cmms_consultation_form_fields WHERE form_id = p_form_id AND field_key = 'date_of_birth';

  RETURN QUERY SELECT * FROM public.cmms_consultation_form_fields WHERE form_id = p_form_id ORDER BY sort_order;
END; $$;

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

  DELETE FROM public.cmms_consultation_form_fields WHERE form_id = p_form_id AND field_key = 'address';

  RETURN QUERY SELECT * FROM public.cmms_consultation_form_fields WHERE form_id = p_form_id ORDER BY sort_order;
END; $$;

NOTIFY pgrst, 'reload schema';

SELECT 'CMMS consultation forms: address/DOB are now built-in identity fields.' AS status;
