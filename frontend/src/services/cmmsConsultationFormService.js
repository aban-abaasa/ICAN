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

// The owner's per-form options (logo, QR codes, attachments - see utils/consultationFormSettings.js).
// Returns the updated form row.
export const saveConsultationFormSettings = async (formId, settings) => {
  const { data, error } = await supabase.rpc('cmms_save_consultation_form_settings', {
    p_form_id: formId,
    p_settings: settings || {}
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

// p_attachments is only sent when there is something to attach, so recording a
// plain walk-in still works against a database that hasn't had
// CMMS_CONSULTATION_LOGO_QR_ATTACHMENTS.sql run yet.
export const recordConsultationSubmission = async ({ formId, patientName, patientPhone, patientEmail, patientAddress, patientDob, responses, attachments }) => {
  const { data, error } = await supabase.rpc('cmms_record_consultation_submission', {
    p_form_id: formId,
    p_patient_name: patientName,
    p_patient_phone: patientPhone || null,
    p_patient_email: patientEmail || null,
    p_patient_address: patientAddress || null,
    p_patient_dob: patientDob || null,
    p_responses: responses || {},
    ...(attachments?.length ? { p_attachments: attachments } : {})
  });
  if (error) return { success: false, error: error.message };
  return { success: true, data };
};

// Staff adding photos / documents to a record that already exists (a lab result
// that arrives after the visit). Returns the updated submission row.
export const addConsultationAttachments = async (submissionId, attachments) => {
  const { data, error } = await supabase.rpc('cmms_add_consultation_attachments', {
    p_submission_id: submissionId,
    p_attachments: attachments || []
  });
  if (error) return { success: false, error: error.message };
  return { success: true, data };
};

export const removeConsultationAttachment = async (submissionId, key) => {
  const { data, error } = await supabase.rpc('cmms_remove_consultation_attachment', {
    p_submission_id: submissionId,
    p_key: key
  });
  if (error) return { success: false, error: error.message };
  return { success: true, data };
};

// The clinic's logo as the DB stores it (an "r2://<key>" marker or a URL), or
// null. The CMMS Board logo wins; the business profile's avatar is the
// fallback — the same order the public form's RPC and the notice board use.
// Staff-side counterpart of the businessLogo the public RPC returns.
export const getBusinessLogoValue = async (businessProfileId) => {
  if (!businessProfileId) return null;
  const { data: board } = await supabase
    .from('cmms_company_profiles')
    .select('logo_url')
    .eq('pichin_business_profile_id', businessProfileId)
    .maybeSingle();
  if (board?.logo_url) return board.logo_url;
  const { data: profile } = await supabase
    .from('business_profiles')
    .select('avatar_url')
    .eq('id', businessProfileId)
    .maybeSingle();
  return profile?.avatar_url || null;
};

// ============================================================
// PUBLIC: anonymous share-link access (no ICAN session)
// ============================================================

export const getPublicConsultationForm = async (shareToken) => {
  const { data, error } = await supabase.rpc('cmms_get_public_consultation_form', { p_share_token: shareToken });
  if (error) return { success: false, error: error.message };
  return { success: true, data: data || null };
};

export const submitPublicConsultationForm = async (shareToken, { patientName, patientPhone, patientEmail, patientAddress, patientDob, responses, attachments }) => {
  const { data, error } = await supabase.rpc('cmms_submit_public_consultation_form', {
    p_share_token: shareToken,
    p_patient_name: patientName,
    p_patient_phone: patientPhone || null,
    p_patient_email: patientEmail || null,
    p_patient_address: patientAddress || null,
    p_patient_dob: patientDob || null,
    p_responses: responses || {},
    ...(attachments?.length ? { p_attachments: attachments } : {})
  });
  if (error) return { success: false, error: error.message };
  if (!data?.success) return { success: false, error: data?.error || 'Could not submit form' };
  return { success: true, submissionId: data.submissionId };
};

export default {
  listConsultationForms,
  saveConsultationForm,
  saveConsultationFormSettings,
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
  addConsultationAttachments,
  removeConsultationAttachment,
  getBusinessLogoValue,
  getPublicConsultationForm,
  submitPublicConsultationForm
};
