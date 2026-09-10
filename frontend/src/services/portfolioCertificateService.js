/**
 * Certificate requests — a business/company visiting someone's public
 * /portfolio/<handle> page can request that person's academic certificate
 * (result slip / transcript — most people know these documents as
 * "certificates", so that's the term used throughout this feature); the
 * owner approves (attaching the file) or denies (see
 * backend/db/CREATE_PORTFOLIO_CERTIFICATE_REQUESTS.sql).
 *
 * Requester-side calls (signed-in or anonymous guest) always go through the
 * SECURITY DEFINER RPCs, same reasoning as portfolioChatService.js. Owner
 * uploads go through the authenticated R2 presign route directly, since the
 * owner is always signed in.
 */

import { supabase } from '../lib/supabase/client';
import { uploadToR2, resolveDownloadUrl } from './r2StorageService';

const CERTIFICATE_MAX_MB = 15;

// ─── Requester side (public page — guest or signed-in) ─────────────────────

export async function requestCertificate(ownerUserId, {
  companyName, email, phone, message, guestId, guestName,
} = {}) {
  const { data, error } = await supabase.rpc('request_portfolio_certificate', {
    p_owner_user_id: ownerUserId,
    p_requester_company_name: companyName,
    p_requester_email: email,
    p_requester_phone: phone || null,
    p_message: message || null,
    p_guest_id: guestId || null,
    p_guest_name: guestName || null,
  });
  if (error) throw error;
  return data;
}

export async function getSentCertificateRequests({ guestId } = {}) {
  const { data, error } = await supabase.rpc('get_sent_certificate_requests', {
    p_guest_id: guestId || null,
  });
  if (error) throw error;
  return data || [];
}

// ─── Owner side (Portfolio tab — always authenticated) ──────────────────────

export async function getMyCertificateRequests() {
  const { data, error } = await supabase
    .from('portfolio_certificate_requests')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

/** Upload the certificate file the owner is approving a request with. */
export async function uploadCertificateFile(file) {
  if (!file) throw new Error('No file selected');
  if (file.size > CERTIFICATE_MAX_MB * 1024 * 1024) {
    throw new Error(`File exceeds ${CERTIFICATE_MAX_MB}MB limit`);
  }
  const { data: { session } } = await supabase.auth.getSession();
  const result = await uploadToR2({ file, folder: 'portfolio-certificates', accessToken: session?.access_token });
  if (!result.success) throw new Error(result.error || 'Upload failed');
  return { url: result.url, path: result.key };
}

export async function approveCertificateRequest(requestId, { certificateUrl, certificatePath, note } = {}) {
  const { data, error } = await supabase.rpc('respond_portfolio_certificate_request', {
    p_request_id: requestId,
    p_action: 'approve',
    p_certificate_url: certificateUrl || null,
    p_certificate_path: certificatePath || null,
    p_note: note || null,
  });
  if (error) throw error;
  return data;
}

export async function denyCertificateRequest(requestId, { note } = {}) {
  const { data, error } = await supabase.rpc('respond_portfolio_certificate_request', {
    p_request_id: requestId,
    p_action: 'deny',
    p_note: note || null,
  });
  if (error) throw error;
  return data;
}

/** Resolve an approved request's stored certificate to a downloadable URL. */
export async function resolveCertificateDownloadUrl(request) {
  if (!request?.certificate_url) return null;
  return resolveDownloadUrl(request.certificate_url, `certificate-${request.id}`);
}
