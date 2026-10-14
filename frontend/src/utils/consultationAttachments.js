// Pure helpers for the photos / documents attached to a CMMS consultation
// form submission, and for the short record reference code printed (as a QR)
// on every record. Deliberately free of DOM / React / Supabase imports so
// tests/consultationAttachments.test.js can run them in plain Node.
//
// An attachment is { key, name, type, size, label, caption } — `key` is the
// R2 object key (see frontend/api/storage/[action].js); everything else is
// display metadata. The server (backend/CMMS_CONSULTATION_LOGO_QR_ATTACHMENTS.sql)
// re-cleans whatever the client sends, so this is for UX, not trust.

export const ATTACHMENT_LABELS = [
  'X-ray / scan', 'Injury photo', 'Lab result', 'Prescription',
  'ID / insurance card', 'Referral letter', 'Other'
];

export const ACCEPTED_ATTACHMENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'];
export const ACCEPT_ATTR = 'image/*,application/pdf';
export const MAX_FILE_MB = 10; // before compression; stored photos end up a few hundred KB
export const MAX_PUBLIC_ATTACHMENTS = 8; // per patient submission
export const MAX_STAFF_ATTACHMENTS = 12; // matches the server's per-call cap

export const attachmentKind = (attachment) => {
  const type = String(attachment?.type || '').toLowerCase();
  const name = String(attachment?.name || '').toLowerCase();
  if (type.startsWith('image/') || /\.(jpe?g|png|webp|gif|heic|heif)$/.test(name)) return 'image';
  if (type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  return 'file';
};

// Returns an error message for a file that can't be attached, or '' when fine.
export const validateAttachmentFile = (file) => {
  if (!file) return 'No file selected.';
  if (!ACCEPTED_ATTACHMENT_TYPES.includes(file.type)) return 'Please choose a JPG, PNG, WEBP or GIF photo, or a PDF.';
  if (file.size > MAX_FILE_MB * 1024 * 1024) return `Each file must be under ${MAX_FILE_MB} MB.`;
  return '';
};

export const formatFileSize = (bytes) => {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};

// The saved shape only — drops UI state (preview blob URLs, upload status).
export const cleanAttachments = (list) => (Array.isArray(list) ? list : [])
  .filter((a) => a && typeof a.key === 'string' && a.key)
  .map((a) => {
    const out = { key: a.key, name: a.name || 'file', type: a.type || '' };
    if (Number.isFinite(Number(a.size)) && Number(a.size) > 0) out.size = Number(a.size);
    if (a.label && String(a.label).trim()) out.label = String(a.label).trim();
    if (a.caption && String(a.caption).trim()) out.caption = String(a.caption).trim();
    return out;
  });

// A saved record's attachments, tolerant of null / legacy rows / pending-sync placeholders.
export const recordAttachments = (record) => cleanAttachments(record?.attachments);

export const attachmentsSummary = (list) => {
  const items = Array.isArray(list) ? list : [];
  if (!items.length) return '';
  const photos = items.filter((a) => attachmentKind(a) === 'image').length;
  const parts = [];
  if (photos) parts.push(`${photos} photo${photos === 1 ? '' : 's'}`);
  const docs = items.length - photos;
  if (docs) parts.push(`${docs} document${docs === 1 ? '' : 's'}`);
  return parts.join(', ');
};

// One text line per attachment, for places that can't show the file itself
// (a PDF where the image couldn't be fetched, a plain-text fallback).
export const attachmentLine = (attachment) => {
  const detail = [attachment?.name, formatFileSize(attachment?.size)].filter(Boolean).join(', ');
  return [attachment?.label, detail ? `(${detail})` : null, attachment?.caption].filter(Boolean).join(' - ');
};

// ── Record reference code ───────────────────────────────────────────────────
// The first 8 hex characters of a submission's id, upper-cased: short enough
// to read out or type, long enough that a clinic's records never collide in
// practice. It is what the QR printed on a record encodes — nothing stored.
const RECORD_QR_PREFIX = 'ICANERA-REC:';

export const recordReferenceCode = (id) => {
  const hex = String(id || '').replace(/-/g, '');
  return /^[0-9a-f]{8,}$/i.test(hex) ? hex.slice(0, 8).toUpperCase() : '';
};

export const recordQrPayload = (id) => {
  const code = recordReferenceCode(id);
  return code ? `${RECORD_QR_PREFIX}${code}` : '';
};

// Pulls a reference code out of whatever was scanned or typed: the full QR
// text, the bare code, or either with stray spacing / dashes.
export const parseRecordCode = (text) => {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const stripped = raw.toUpperCase().startsWith(RECORD_QR_PREFIX) ? raw.slice(RECORD_QR_PREFIX.length) : raw;
  const compact = stripped.replace(/[\s-]/g, '');
  return /^[0-9a-f]{8}$/i.test(compact) ? compact.toUpperCase() : null;
};

// "AB12 CD34" reads better on paper than "AB12CD34".
export const formatReferenceCode = (code) => (code && code.length === 8 ? `${code.slice(0, 4)} ${code.slice(4)}` : code || '');

export const recordMatchesCode = (record, code) => {
  if (!code) return false;
  return recordReferenceCode(record?.id) === String(code).toUpperCase();
};
