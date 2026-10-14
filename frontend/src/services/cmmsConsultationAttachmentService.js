// Photos / documents attached to a CMMS consultation form submission.
//
// Files go to the app's existing Cloudflare R2 storage (r2StorageService.js and the
// /api/storage routes), so this adds no serverless function:
//   - a patient on the public share-link page has no account, so they use the anonymous,
//     rate-limited presign-upload-chat route with purpose 'consultation-form';
//   - staff use the normal authenticated presign-upload into the cmms-consultation folder.
// The DB stores only the plain R2 key plus display metadata (see
// backend/CMMS_CONSULTATION_LOGO_QR_ATTACHMENTS.sql); a viewing URL is resolved on demand.

import { supabase } from '../lib/supabase/client';
import { getBackendUrl } from '../lib/backendUrl';
import { compressImageFile } from '../utils/imageCompression';
import { validateAttachmentFile } from '../utils/consultationAttachments';
import { resolveDownloadUrl, resolveMediaValues, toR2Value, uploadToR2 } from './r2StorageService';

const currentToken = async () => (await supabase.auth.getSession())?.data?.session?.access_token || null;

const uploadAsGuest = async (file) => {
  const contentType = file.type;
  const presignRes = await fetch(`${getBackendUrl()}/api/storage/presign-upload-chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: file.name || 'attachment', contentType, purpose: 'consultation-form' })
  });
  const presign = await presignRes.json().catch(() => null);
  if (!presignRes.ok || !presign?.success) throw new Error(presign?.error || 'The file could not be uploaded.');
  const putRes = await fetch(presign.uploadUrl, { method: 'PUT', headers: { 'Content-Type': contentType }, body: file });
  if (!putRes.ok) throw new Error('The file could not be uploaded. Please try again.');
  return presign.key;
};

// Uploads one file and returns the attachment metadata to store on the record.
// Photos are shrunk first (a phone camera shot is often 3-8 MB). Throws an Error
// with a message that is safe to show to a patient.
export const uploadConsultationAttachment = async (file, { guest = false } = {}) => {
  const problem = validateAttachmentFile(file);
  if (problem) throw new Error(problem);

  const prepared = await compressImageFile(file, 1600, 0.75);
  let key;
  if (guest) {
    key = await uploadAsGuest(prepared);
  } else {
    const result = await uploadToR2({ file: prepared, folder: 'cmms-consultation', accessToken: await currentToken() });
    if (!result.success) throw new Error(result.error || 'The file could not be uploaded.');
    key = result.key;
  }
  return { key, name: prepared.name || file.name || 'attachment', type: prepared.type || file.type, size: prepared.size };
};

// attachments → same list with a viewable `url` on each. Anything that can't be
// resolved keeps url: '' and the UI shows a file card instead of a thumbnail.
export const resolveAttachmentUrls = async (attachments) => {
  const list = Array.isArray(attachments) ? attachments : [];
  if (!list.length) return [];
  const rows = list.map((a) => ({ ...a, _marker: a.key ? toR2Value(a.key) : null }));
  const resolved = await resolveMediaValues(rows, ['_marker']);
  return resolved.map(({ _marker, ...a }) => ({ ...a, url: _marker && !_marker.startsWith('r2://') ? _marker : '' }));
};

// A URL that forces "Save As" instead of opening the file in the tab; null if it can't be made.
export const getAttachmentDownloadUrl = (attachment) =>
  (attachment?.key ? resolveDownloadUrl(toR2Value(attachment.key), attachment.name || 'attachment') : Promise.resolve(null));

export default { uploadConsultationAttachment, resolveAttachmentUrls, getAttachmentDownloadUrl };
