/**
 * CMMS Employment Documents -- appointment letters & contracts, QR-sealed
 *
 * The QR "seal" embedded in every issued PDF (see
 * frontend/src/utils/generateEmploymentDocumentPdf.js) encodes a URL to
 * /verify-document?token=<verify_token> -- an opaque token resolved by the
 * public fn_verify_employment_document RPC (backend/CMMS_EMPLOYMENT_DOCUMENTS.sql),
 * the same "opaque token + narrow SECURITY DEFINER RPC" pattern already used
 * by CMMS staff attendance QR check-in and report sharing.
 */

import { supabase } from '../lib/supabase/client';
import { resolveMediaValue } from './r2StorageService';
import { getPublicAppUrl } from '../utils/publicAppUrl';

const genVerifyToken = () => {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
};

// Always the real production domain -- see cmmsInterviewService's
// buildCandidateInterviewLink for why (a QR seal on a printed letter is
// especially unforgiving of a dev/staging origin baked in at issue time).
export const buildVerifyUrl = (verifyToken) => getPublicAppUrl(`/verify-document?token=${verifyToken}`);

/**
 * Auto-provisions the applicant as a real CMMS employee (cmms_users row) at
 * the moment their appointment letter/contract is issued -- until this
 * runs, a "hired" applicant exists only as a cmms_job_applications row and
 * has no way to reach the CMMS workspace to see or sign their own document.
 * Idempotent: issuing a second document later reuses the same employee
 * record. Returns the cmms_users.id to attach to the document being issued.
 */
export const hireApplicantIntoCmms = async (jobApplicationId) => {
  const { data, error } = await supabase.rpc('fn_hire_applicant_into_cmms', { p_job_application_id: jobApplicationId });
  if (error) return { success: false, error: error.message };
  return { success: true, cmmsUserId: data };
};

// ============================================================
// Staff-facing (authenticated, RLS-enforced)
// ============================================================

export const createEmploymentDocument = async (companyId, fields, issuedByCmmsUserId) => {
  const verifyToken = genVerifyToken();
  const { data, error } = await supabase
    .from('cmms_employment_documents')
    .insert({
      cmms_company_id: companyId,
      job_application_id: fields.jobApplicationId || null,
      cmms_user_id: fields.cmmsUserId || null,
      document_type: fields.documentType,
      title: fields.title?.trim(),
      content: fields.content || {},
      status: 'draft',
      verify_token: verifyToken,
      issued_by: issuedByCmmsUserId || null,
    })
    .select()
    .single();
  if (error) return { success: false, error: error.message };
  return { success: true, data };
};

export const issueEmploymentDocument = async (documentId, { documentUrl, documentPath }) => {
  const { data, error } = await supabase
    .from('cmms_employment_documents')
    .update({
      document_url: documentUrl,
      document_path: documentPath,
      status: 'issued',
      issued_at: new Date().toISOString(),
    })
    .eq('id', documentId)
    .select()
    .single();
  if (error) return { success: false, error: error.message };
  return { success: true, data };
};

export const revokeEmploymentDocument = async (documentId) => {
  const { error } = await supabase.from('cmms_employment_documents').update({ status: 'revoked' }).eq('id', documentId);
  if (error) return { success: false, error: error.message };
  return { success: true };
};

export const getDocumentsForApplication = async (applicationId) => {
  const { data, error } = await supabase
    .from('cmms_employment_documents')
    .select('*')
    .eq('job_application_id', applicationId)
    .order('created_at', { ascending: false });
  if (error) return { success: false, error: error.message, data: [] };
  const resolved = await Promise.all((data || []).map(async (d) => ({ ...d, document_url: await resolveMediaValue(d.document_url) })));
  return { success: true, data: resolved };
};

export const getDocumentsForCompany = async (companyId) => {
  const { data, error } = await supabase
    .from('cmms_employment_documents')
    .select('*')
    .eq('cmms_company_id', companyId)
    .order('created_at', { ascending: false });
  if (error) return { success: false, error: error.message, data: [] };
  const resolved = await Promise.all((data || []).map(async (d) => ({ ...d, document_url: await resolveMediaValue(d.document_url) })));
  return { success: true, data: resolved };
};

// ============================================================
// Employee-facing (sign with wallet PIN) & public verification
// ============================================================

/** The signed-in employee's own documents -- RLS
 * (cmms_employment_documents_employee_select) already restricts this to
 * rows linked to their own cmms_users/cmms_job_applications record, so no
 * extra filter is needed beyond the company. */
export const getMyEmploymentDocuments = async (companyId) => {
  const { data, error } = await supabase
    .from('cmms_employment_documents')
    .select('*')
    .eq('cmms_company_id', companyId)
    .order('created_at', { ascending: false });
  if (error) return { success: false, error: error.message, data: [] };
  const resolved = await Promise.all((data || []).map(async (d) => ({ ...d, document_url: await resolveMediaValue(d.document_url) })));
  return { success: true, data: resolved };
};

export const signEmploymentDocument = async (documentId, pinMasked, signatureMethod = 'wallet_pin') => {
  const { error } = await supabase.rpc('fn_sign_employment_document', {
    p_document_id: documentId,
    p_signature_method: signatureMethod,
    p_pin_masked: pinMasked,
  });
  if (error) return { success: false, error: error.message };
  return { success: true };
};

export const verifyEmploymentDocument = async (token) => {
  const { data, error } = await supabase.rpc('fn_verify_employment_document', { p_token: token });
  if (error) return { success: false, error: error.message, data: null };
  if (!data?.length) return { success: false, error: 'Document not found', data: null };
  return { success: true, data: data[0] };
};

// ============================================================
// Candidate-facing (authenticated, standalone /candidate-document page --
// see CandidateDocumentViewer.jsx, mirrors CandidateTestRunner/
// CandidateInterviewRoom's link-then-load pattern)
// ============================================================

// Always the real production domain -- see buildVerifyUrl above.
export const buildCandidateDocumentLink = (documentId) => getPublicAppUrl(`/candidate-document?documentId=${documentId}`);

/** Callable before the candidate is signed in at all -- pre-fills the ICAN
 * signup form from the document's owner (job application, or the linked
 * cmms_users row if there's no application on file). */
export const getDocumentPrefillContact = async (documentId) => {
  const { data, error } = await supabase.rpc('fn_get_document_prefill_contact', { p_document_id: documentId });
  if (error || !data?.length) return { success: false, error: error?.message, data: null };
  return { success: true, data: data[0] };
};

/** Called right after the candidate signs up/signs in via the document
 * link -- links their new ICAN account to whichever owner (application or
 * cmms_users row) matches the email they just authenticated with. */
export const linkIcanAccountViaDocument = async (documentId) => {
  const { data, error } = await supabase.rpc('fn_link_ican_account_via_document', { p_document_id: documentId });
  if (error) return { success: false, error: error.message };
  return { success: true, linked: Boolean(data) };
};

/** The signed-in candidate's own document by id -- RLS
 * (cmms_employment_documents_employee_select) restricts this to a document
 * linked to their own cmms_users/cmms_job_applications record. */
export const getDocumentById = async (documentId) => {
  const { data, error } = await supabase.from('cmms_employment_documents').select('*').eq('id', documentId).single();
  if (error) return { success: false, error: error.message, data: null };
  return { success: true, data: { ...data, document_url: await resolveMediaValue(data.document_url) } };
};

export default {
  buildVerifyUrl,
  hireApplicantIntoCmms,
  createEmploymentDocument,
  issueEmploymentDocument,
  revokeEmploymentDocument,
  getDocumentsForApplication,
  getDocumentsForCompany,
  getMyEmploymentDocuments,
  signEmploymentDocument,
  verifyEmploymentDocument,
  buildCandidateDocumentLink,
  getDocumentPrefillContact,
  linkIcanAccountViaDocument,
  getDocumentById,
};
