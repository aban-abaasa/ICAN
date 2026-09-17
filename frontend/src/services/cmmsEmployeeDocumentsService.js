/**
 * CMMS Payroll — employee credential documents ("Employee files").
 *
 * Real file uploads through the app's existing Cloudflare R2 storage
 * (r2StorageService.js). Deliberately reuses the already-allowlisted
 * 'cmms-employment-documents' R2 folder (backend/routes/storageRoutes.js)
 * instead of adding a new one -- the backend is deployed as a fixed set of
 * Vercel serverless functions, so this intentionally introduces zero new
 * backend routes/functions. Same real-upload mechanism
 * CMMSAnnouncementsPanel.jsx and CMMSEmploymentDocumentsPanel.jsx already
 * use, just filed under an existing folder rather than a bare URL text
 * field. See backend/CMMS_PAYROLL_EMPLOYEE_DOCUMENTS.sql for the table/RPCs
 * and the permission model (self-service is always allowed; adding/
 * removing/verifying another employee's document requires the Payroll
 * "edit" action).
 */

import { supabase } from '../lib/supabase/client';
import { uploadToR2, resolveMediaValue } from './r2StorageService';

export const EMPLOYEE_DOCUMENT_CATEGORIES = [
  { id: 'national_id', label: 'National ID / Passport' },
  { id: 'academic_certificate', label: 'Academic certificate' },
  { id: 'professional_certificate', label: 'Professional certificate / license' },
  { id: 'cv_resume', label: 'CV / Resume' },
  { id: 'bank_details', label: 'Bank account details' },
  { id: 'tax_pin_certificate', label: 'Tax PIN (TIN) certificate' },
  { id: 'nssf_certificate', label: 'NSSF certificate' },
  { id: 'next_of_kin_form', label: 'Next of kin form' },
  { id: 'police_clearance', label: 'Police clearance' },
  { id: 'medical_certificate', label: 'Medical certificate' },
  { id: 'work_permit', label: 'Work permit / Visa' },
  { id: 'signed_contract', label: 'Signed contract copy' },
  { id: 'other', label: 'Other' },
];

const resolveDocs = async (rows) =>
  Promise.all((rows || []).map(async (d) => ({ ...d, file_url: await resolveMediaValue(d.file_url) })));

/**
 * Uploads the file to R2 then records it against the employee via the
 * upload_employee_document RPC (which enforces self-vs-on-behalf-of
 * permissions server-side). Pass employeeUserId === the caller's own auth
 * id for a self-service upload from "My Salary".
 */
export const addEmployeeDocument = async ({ companyId, employeeUserId, category, label, file }) => {
  if (!file) return { success: false, error: 'Choose a file to upload.' };
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData?.session?.access_token;
  if (!accessToken) return { success: false, error: 'Could not verify your session to upload this file.' };

  const upload = await uploadToR2({ file, folder: 'cmms-employment-documents', accessToken });
  if (!upload.success) return { success: false, error: upload.error || 'File upload failed' };

  const { data, error } = await supabase.rpc('upload_employee_document', {
    p_cmms_company_id: companyId,
    p_employee_user_id: employeeUserId,
    p_category: category,
    p_label: label,
    p_file_url: upload.url,
    p_file_path: upload.key,
    p_file_name: file.name || null,
    p_mime_type: file.type || null,
    p_file_size_bytes: file.size || null,
  });
  if (error) return { success: false, error: error.message };
  return { success: true, documentId: data };
};

export const removeEmployeeDocument = async (documentId) => {
  const { error } = await supabase.rpc('revoke_employee_document', { p_document_id: documentId });
  if (error) return { success: false, error: error.message };
  return { success: true };
};

export const setEmployeeDocumentVerified = async (documentId, verified, notes = null) => {
  const { error } = await supabase.rpc('verify_employee_document', {
    p_document_id: documentId,
    p_verified: verified,
    p_notes: notes,
  });
  if (error) return { success: false, error: error.message };
  return { success: true };
};

/** The signed-in employee's own documents — self-scoped RPC, "My Salary". */
export const getMyEmployeeDocuments = async (companyId) => {
  const { data, error } = await supabase.rpc('get_my_employee_documents', { p_cmms_company_id: companyId });
  if (error) return { success: false, error: error.message, data: [] };
  return { success: true, data: await resolveDocs(data) };
};

/** Company-wide list for the Payroll admin screen (Payroll "edit"/"view"). */
export const getCompanyEmployeeDocuments = async (companyId, employeeUserId = null) => {
  const { data, error } = await supabase.rpc('get_company_employee_documents', {
    p_cmms_company_id: companyId,
    p_employee_user_id: employeeUserId,
  });
  if (error) return { success: false, error: error.message, data: [] };
  return { success: true, data: await resolveDocs(data) };
};

/**
 * Job applications with a résumé/CV already on file (Announcements & Jobs
 * hiring pipeline) that can be auto-picked into the vault instead of
 * re-uploaded. Pass employeeUserId === the caller's own auth id (or omit)
 * for self-service; a different id requires Payroll "edit" server-side.
 */
export const getApplicationDocumentsForEmployee = async (companyId, employeeUserId = null) => {
  const { data, error } = await supabase.rpc('get_application_documents_for_employee', {
    p_cmms_company_id: companyId,
    p_employee_user_id: employeeUserId,
  });
  if (error) return { success: false, error: error.message, data: [] };
  const resolved = await Promise.all((data || []).map(async (d) => ({ ...d, resume_url: await resolveMediaValue(d.resume_url) })));
  return { success: true, data: resolved };
};

/** Copies a job application's résumé reference into the vault -- the same
 * R2 object, never a re-upload. */
export const importApplicationDocument = async ({ companyId, employeeUserId, jobApplicationId, category = 'cv_resume', label = 'CV / Resume (from job application)' }) => {
  const { data, error } = await supabase.rpc('import_application_document', {
    p_cmms_company_id: companyId,
    p_employee_user_id: employeeUserId,
    p_job_application_id: jobApplicationId,
    p_category: category,
    p_label: label,
  });
  if (error) return { success: false, error: error.message };
  return { success: true, documentId: data };
};

export default {
  EMPLOYEE_DOCUMENT_CATEGORIES,
  addEmployeeDocument,
  removeEmployeeDocument,
  setEmployeeDocumentVerified,
  getMyEmployeeDocuments,
  getCompanyEmployeeDocuments,
  getApplicationDocumentsForEmployee,
  importApplicationDocument,
};
