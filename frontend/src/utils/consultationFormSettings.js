import { ATTACHMENT_LABELS, MAX_PUBLIC_ATTACHMENTS, MAX_STAFF_ATTACHMENTS } from './consultationAttachments.js';

// The owner-controlled options on each consultation form
// (cmms_consultation_forms.settings, backend/CMMS_CONSULTATION_LOGO_QR_ATTACHMENTS.sql).
// The logo, QR codes and attachments are available on every form and ON by
// default, but the business owner decides how each one behaves for that form:
//
//   showLogo            business logo on the public form, printouts, PDFs, QR flyer
//   showQr              QR codes on printouts / PDFs and the patient's check-in pass
//   allowAttachments    the photo & document block, for patients and staff
//   attachmentsRequired patients (public link) must attach at least one file
//   attachmentMax       1-12 files per submission
//   attachmentLabels    the tags a file can carry; null = built-in list, [] = no tags
//   attachmentPrompt    the heading above the attachment block
//
// Pure (no DOM / React) so tests/consultationFormSettings.test.js can cover it in Node.

export const DEFAULT_ATTACHMENT_PROMPT = 'Photos & documents';

export const DEFAULT_FORM_SETTINGS = Object.freeze({
  showLogo: true,
  showQr: true,
  allowAttachments: true,
  attachmentsRequired: false,
  attachmentMax: MAX_PUBLIC_ATTACHMENTS,
  attachmentLabels: null,
  attachmentPrompt: ''
});

const bool = (value, fallback) => (typeof value === 'boolean' ? value : fallback);

// Whatever the DB (or an older row, or a public RPC payload) holds → a complete settings object.
export const normalizeFormSettings = (raw) => {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const max = Number(source.attachmentMax);
  return {
    showLogo: bool(source.showLogo, DEFAULT_FORM_SETTINGS.showLogo),
    showQr: bool(source.showQr, DEFAULT_FORM_SETTINGS.showQr),
    allowAttachments: bool(source.allowAttachments, DEFAULT_FORM_SETTINGS.allowAttachments),
    attachmentsRequired: bool(source.attachmentsRequired, DEFAULT_FORM_SETTINGS.attachmentsRequired),
    attachmentMax: Number.isFinite(max) ? Math.max(1, Math.min(MAX_STAFF_ATTACHMENTS, Math.round(max))) : DEFAULT_FORM_SETTINGS.attachmentMax,
    attachmentLabels: Array.isArray(source.attachmentLabels)
      ? source.attachmentLabels.map((l) => String(l).trim()).filter(Boolean).slice(0, 12)
      : null,
    attachmentPrompt: typeof source.attachmentPrompt === 'string' ? source.attachmentPrompt.trim().slice(0, 80) : ''
  };
};

// The tags a file can be given on this form.
export const resolveAttachmentLabels = (settings) => {
  const labels = normalizeFormSettings(settings).attachmentLabels;
  return labels === null ? ATTACHMENT_LABELS : labels;
};

export const resolveAttachmentPrompt = (settings) => normalizeFormSettings(settings).attachmentPrompt || DEFAULT_ATTACHMENT_PROMPT;

// "Tags" text box ↔ list. Typing the built-in list back in stores null (= follow the
// defaults), clearing the box stores [] (= no tags).
export const labelsToText = (labels) => (labels === null || labels === undefined ? ATTACHMENT_LABELS : labels).join(', ');

export const textToLabels = (text) => {
  const labels = String(text || '').split(',').map((l) => l.trim()).filter(Boolean).slice(0, 12);
  const isDefault = labels.length === ATTACHMENT_LABELS.length && labels.every((l, i) => l === ATTACHMENT_LABELS[i]);
  return isDefault ? null : labels;
};

// What gets sent to cmms_save_consultation_form_settings. Defaults are still sent
// explicitly so a later change to the built-in defaults never silently flips a
// form the owner already configured.
export const settingsPayload = (settings) => {
  const s = normalizeFormSettings(settings);
  const payload = {
    showLogo: s.showLogo, showQr: s.showQr, allowAttachments: s.allowAttachments,
    attachmentsRequired: s.attachmentsRequired, attachmentMax: s.attachmentMax
  };
  if (s.attachmentLabels !== null) payload.attachmentLabels = s.attachmentLabels;
  if (s.attachmentPrompt) payload.attachmentPrompt = s.attachmentPrompt;
  return payload;
};

export const settingsEqual = (a, b) => JSON.stringify(settingsPayload(a)) === JSON.stringify(settingsPayload(b));

// One line for the form header: what is on, as the owner configured it.
export const settingsSummary = (raw) => {
  const s = normalizeFormSettings(raw);
  const attachments = !s.allowAttachments
    ? 'Attachments off'
    : `Attachments ${s.attachmentsRequired ? 'required' : 'optional'} (up to ${s.attachmentMax})`;
  return [s.showLogo ? 'Logo on' : 'Logo off', s.showQr ? 'QR on' : 'QR off', attachments];
};
