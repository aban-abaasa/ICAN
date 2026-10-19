-- ============================================================
-- CMMS CONSULTATION FORMS — repair for a database where
-- CMMS_CONSULTATION_LOGO_QR_ATTACHMENTS.sql was run WITHOUT
-- CMMS_CONSULTATION_ADDRESS_DOB.sql
-- ============================================================
-- Symptom: every consultation submission (staff walk-in and public link)
-- fails because the deployed functions insert into patient_address /
-- patient_dob, columns that were never added.
--
-- This reaches the same end state as running ADDRESS_DOB.sql and then
-- LOGO_QR_ATTACHMENTS.sql, without the transient 7-argument overload.
-- Safe to run more than once. Paste the whole file into the Supabase SQL editor.
-- ============================================================

-- 1. The missing columns.
ALTER TABLE public.cmms_consultation_submissions
  ADD COLUMN IF NOT EXISTS patient_address TEXT,
  ADD COLUMN IF NOT EXISTS patient_dob DATE;

-- 2. Old 5-argument overloads left behind (the 8-argument versions stay).
DROP FUNCTION IF EXISTS public.cmms_record_consultation_submission(UUID, TEXT, TEXT, TEXT, JSONB);
DROP FUNCTION IF EXISTS public.cmms_submit_public_consultation_form(UUID, TEXT, TEXT, TEXT, JSONB);

-- 3. Presets no longer add their own Date of birth / Address field
--    (those are built-in identity fields now).
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

-- 4. Check: expect patient_address and patient_dob listed, and exactly one
--    row per function (each with p_attachments).
SELECT column_name FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'cmms_consultation_submissions'
   AND column_name IN ('patient_address', 'patient_dob', 'attachments');

SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('cmms_record_consultation_submission', 'cmms_submit_public_consultation_form');
