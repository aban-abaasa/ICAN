/**
 * CMMS Clinical Operations — customizable consultation forms.
 * Staff-side calls go through Supabase RPCs the same way
 * cmms_create_specialist_record does elsewhere in CMMS (membership-checked
 * server-side, RLS only exposes a SELECT policy). The two `public*` calls
 * use the same anon Supabase client and need no ICAN session — see
 * PublicConsultationFormViewer.jsx.
 */

import { supabase } from '../lib/supabase/client';

// ============================================================
// STAFF: forms
// ============================================================

export const listConsultationForms = async (businessProfileId) => {
  const { data, error } = await supabase
    .from('cmms_consultation_forms')
    .select('*')
    .eq('business_profile_id', businessProfileId)
    .order('created_at', { ascending: false });
  if (error) return { success: false, error: error.message };
  return { success: true, data: data || [] };
};

export const saveConsultationForm = async ({ id, businessProfileId, name, description, isActive }) => {
  const { data, error } = await supabase.rpc('cmms_save_consultation_form', {
    p_id: id || null,
    p_business_profile_id: businessProfileId || null,
    p_name: name,
    p_description: description || null,
    p_is_active: isActive ?? true
  });
  if (error) return { success: false, error: error.message };
  return { success: true, data };
};

export const deleteConsultationForm = async (formId) => {
  const { error } = await supabase.rpc('cmms_delete_consultation_form', { p_form_id: formId });
  if (error) return { success: false, error: error.message };
  return { success: true };
};

export const setConsultationFormShare = async (formId, enabled) => {
  const { data, error } = await supabase.rpc('cmms_set_consultation_form_share', {
    p_form_id: formId,
    p_enabled: enabled
  });
  if (error) return { success: false, error: error.message };
  return { success: true, data };
};

// ============================================================
// STAFF: fields
// ============================================================

export const listConsultationFields = async (formId) => {
  const { data, error } = await supabase
    .from('cmms_consultation_form_fields')
    .select('*')
    .eq('form_id', formId)
    .order('sort_order');
  if (error) return { success: false, error: error.message };
  return { success: true, data: data || [] };
};

export const saveConsultationField = async ({ id, formId, label, fieldType, options, isRequired, sortOrder }) => {
  const { data, error } = await supabase.rpc('cmms_save_consultation_field', {
    p_id: id || null,
    p_form_id: formId || null,
    p_label: label,
    p_field_type: fieldType || 'text',
    p_options: options || null,
    p_is_required: !!isRequired,
    p_sort_order: sortOrder ?? 0
  });
  if (error) return { success: false, error: error.message };
  return { success: true, data };
};

export const deleteConsultationField = async (fieldId) => {
  const { error } = await supabase.rpc('cmms_delete_consultation_field', { p_id: fieldId });
  if (error) return { success: false, error: error.message };
  return { success: true };
};

export const addCommonClinicalFields = async (formId) => {
  const { data, error } = await supabase.rpc('cmms_add_common_clinical_fields', { p_form_id: formId });
  if (error) return { success: false, error: error.message };
  return { success: true, data: data || [] };
};

export const addPhysiotherapyConsultationFields = async (formId) => {
  const { data, error } = await supabase.rpc('cmms_add_physiotherapy_consultation_fields', { p_form_id: formId });
  if (error) return { success: false, error: error.message };
  return { success: true, data: data || [] };
};

export const addPatientAssessmentFields = async (formId) => {
  const { data, error } = await supabase.rpc('cmms_add_patient_assessment_fields', { p_form_id: formId });
  if (error) return { success: false, error: error.message };
  return { success: true, data: data || [] };
};

// ============================================================
// STAFF: submissions
// ============================================================

export const listConsultationSubmissions = async (formId) => {
  const { data, error } = await supabase
    .from('cmms_consultation_submissions')
    .select('*')
    .eq('form_id', formId)
    .order('created_at', { ascending: false });
  if (error) return { success: false, error: error.message };
  return { success: true, data: data || [] };
};

// Every submission across every consultation form for this business, in
// one place — the "Records" tab (CMMSClinicalRecords.jsx), as opposed to
// the per-form submissions list above.
export const listAllConsultationSubmissions = async (businessProfileId) => {
  const { data, error } = await supabase
    .from('cmms_consultation_submissions')
    .select('*')
    .eq('business_profile_id', businessProfileId)
    .order('created_at', { ascending: false });
  if (error) return { success: false, error: error.message };
  return { success: true, data: data || [] };
};

export const recordConsultationSubmission = async ({ formId, patientName, patientPhone, patientEmail, patientAddress, patientDob, responses }) => {
  const { data, error } = await supabase.rpc('cmms_record_consultation_submission', {
    p_form_id: formId,
    p_patient_name: patientName,
    p_patient_phone: patientPhone || null,
    p_patient_email: patientEmail || null,
    p_patient_address: patientAddress || null,
    p_patient_dob: patientDob || null,
    p_responses: responses || {}
  });
  if (error) return { success: false, error: error.message };
  return { success: true, data };
};

// ============================================================
// PUBLIC: anonymous share-link access (no ICAN session)
// ============================================================

export const getPublicConsultationForm = async (shareToken) => {
  const { data, error } = await supabase.rpc('cmms_get_public_consultation_form', { p_share_token: shareToken });
  if (error) return { success: false, error: error.message };
  return { success: true, data: data || null };
};

export const submitPublicConsultationForm = async (shareToken, { patientName, patientPhone, patientEmail, patientAddress, patientDob, responses }) => {
  const { data, error } = await supabase.rpc('cmms_submit_public_consultation_form', {
    p_share_token: shareToken,
    p_patient_name: patientName,
    p_patient_phone: patientPhone || null,
    p_patient_email: patientEmail || null,
    p_patient_address: patientAddress || null,
    p_patient_dob: patientDob || null,
    p_responses: responses || {}
  });
  if (error) return { success: false, error: error.message };
  if (!data?.success) return { success: false, error: data?.error || 'Could not submit form' };
  return { success: true, submissionId: data.submissionId };
};

export default {
  listConsultationForms,
  saveConsultationForm,
  deleteConsultationForm,
  setConsultationFormShare,
  listConsultationFields,
  saveConsultationField,
  deleteConsultationField,
  addCommonClinicalFields,
  addPhysiotherapyConsultationFields,
  addPatientAssessmentFields,
  listConsultationSubmissions,
  listAllConsultationSubmissions,
  recordConsultationSubmission,
  getPublicConsultationForm,
  submitPublicConsultationForm
};
