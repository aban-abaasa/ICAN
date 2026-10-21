import React, { useEffect, useMemo, useState } from 'react';
import { PRODUCT_OF_HTML } from '../constants/brand';
import { QRCodeSVG } from 'qrcode.react';
import {
  Plus, Trash2, Share2, Printer, Copy, Check, Loader, FileText, Download,
  ChevronUp, ChevronDown, Sparkles, Power, UserPlus, Pencil, Lock, Paperclip, QrCode, Image as ImageIcon
} from 'lucide-react';
import {
  listConsultationForms, saveConsultationForm, deleteConsultationForm, setConsultationFormShare,
  listConsultationFields, saveConsultationField, deleteConsultationField, addCommonClinicalFields,
  addPhysiotherapyConsultationFields, addPatientAssessmentFields, listConsultationSubmissions, recordConsultationSubmission,
  saveConsultationFormSettings
} from '../services/cmmsConsultationFormService';
import { useAuth } from '../context/AuthContext';
import { syncManager } from '../lib/syncManager';
import { downloadCmmsQrPdf } from '../utils/downloadCmmsQrPdf';
import { downloadBlankConsultationFormPdf, downloadConsultationSubmissionPdf } from '../utils/generateConsultationFormPdf';
import { submissionEntries, formatAnswer, sectionDisplayLabel, bareSectionLabel } from '../utils/consultationSubmissionUtils';
import { cleanAttachments, formatReferenceCode, MAX_STAFF_ATTACHMENTS, recordAttachments, recordQrPayload, recordReferenceCode } from '../utils/consultationAttachments';
import { loadLogoAsset, makeQrDataUrl, useResolvedLogo } from '../utils/consultationBranding';
import { attachmentsHtml, closePrintShell, escapeHtml, fillPrintShell, letterheadHtml, openPrintShell } from '../utils/consultationPrint';
import {
  DEFAULT_FORM_SETTINGS, labelsToText, normalizeFormSettings, resolveAttachmentLabels, resolveAttachmentPrompt,
  settingsEqual, settingsPayload as settingsPayloadOf, settingsSummary, textToLabels
} from '../utils/consultationFormSettings';
import { resolveAttachmentUrls } from '../services/cmmsConsultationAttachmentService';
import ConsultationAttachmentPicker, { attachmentsToSave, attachmentsUploading } from './ConsultationAttachmentPicker';
import ConsultationRecordAttachments from './ConsultationRecordAttachments';

const FIELD_TYPES = [
  ['text', 'Short text'], ['textarea', 'Long text'], ['date', 'Date'], ['number', 'Number'],
  ['select', 'Single choice'], ['multiselect', 'Multiple choice'], ['checkbox', 'Yes / No'],
  ['section', 'Section header']
];
const FIELD_TYPE_LABEL = Object.fromEntries(FIELD_TYPES);
const NEEDS_OPTIONS = new Set(['select', 'multiselect']);

const shareUrl = (token) => `${window.location.origin}/consultation-forms/${token}`;

// Every printout (blank form, a patient's record) goes through the shared print
// helpers in utils/consultationPrint.js: the window is opened inside the click,
// then filled in once the logo / QR / attachments are ready.

// Collapsible section wrapper — used to keep heavy blocks (share link/QR
// details, the field-building tools) out of the way by default so the page
// isn't a wall of content on first load, especially on mobile where the
// forms list and selected-form detail stack into one long column.
const Disclosure = ({ title, icon: Icon, defaultOpen = false, children }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl border border-white/10 bg-white/5">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between gap-3 p-3 text-left">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-white">
          {Icon && <Icon className="h-4 w-4 text-cyan-300" />} {title}
        </span>
        {open ? <ChevronUp className="h-4 w-4 flex-shrink-0 text-slate-400" /> : <ChevronDown className="h-4 w-4 flex-shrink-0 text-slate-400" />}
      </button>
      {open && <div className="space-y-3 px-3 pb-3">{children}</div>}
    </div>
  );
};

// A labelled on/off switch for the owner's per-form options.
const OptionToggle = ({ label, hint, checked, onChange }) => (
  <label className="flex cursor-pointer items-start justify-between gap-3">
    <span className="min-w-0">
      <span className="block text-sm font-medium text-white">{label}</span>
      {hint && <span className="block text-xs text-slate-400">{hint}</span>}
    </span>
    <button
      type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
      className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition ${checked ? 'bg-emerald-500' : 'bg-slate-600'}`}
    >
      <span style={{ background: '#ffffff' }} className={`absolute top-0.5 h-5 w-5 rounded-full transition-all ${checked ? 'left-[22px]' : 'left-0.5'}`} />
    </button>
  </label>
);

// Renders one editable input for a field definition — shared by the
// staff "record a walk-in submission" form below.
const FieldInput = ({ field, value, onChange }) => {
  if (field.field_type === 'textarea') {
    return <textarea value={value || ''} onChange={(e) => onChange(e.target.value)} rows={3} className="w-full rounded-lg bg-slate-900 px-3 py-2 text-sm text-white" />;
  }
  if (field.field_type === 'date') {
    return <input type="date" value={value || ''} onChange={(e) => onChange(e.target.value)} className="w-full rounded-lg bg-slate-900 px-3 py-2 text-sm text-white" />;
  }
  if (field.field_type === 'number') {
    return <input type="number" value={value ?? ''} onChange={(e) => onChange(e.target.value)} className="w-full rounded-lg bg-slate-900 px-3 py-2 text-sm text-white" />;
  }
  if (field.field_type === 'checkbox') {
    return (
      <label className="flex items-center gap-2 text-sm text-slate-200">
        <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} /> Yes
      </label>
    );
  }
  if (field.field_type === 'select') {
    return (
      <select value={value || ''} onChange={(e) => onChange(e.target.value)} className="w-full rounded-lg bg-slate-900 px-3 py-2 text-sm text-white">
        <option value="">Select…</option>
        {(field.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  if (field.field_type === 'multiselect') {
    const selected = Array.isArray(value) ? value : [];
    const toggle = (opt) => onChange(selected.includes(opt) ? selected.filter((o) => o !== opt) : [...selected, opt]);
    return (
      <div className="flex flex-wrap gap-1.5">
        {(field.options || []).map((o) => (
          <button
            key={o} type="button" onClick={() => toggle(o)}
            className={`rounded-full border px-2.5 py-1 text-xs ${selected.includes(o) ? 'border-cyan-400 bg-cyan-400/20 text-cyan-200' : 'border-white/15 text-slate-300'}`}
          >
            {o}
          </button>
        ))}
      </div>
    );
  }
  return <input value={value || ''} onChange={(e) => onChange(e.target.value)} className="w-full rounded-lg bg-slate-900 px-3 py-2 text-sm text-white" />;
};

// CMMS Clinical Operations — "Consultation Forms" sub-tab (alongside the
// existing activity-log sub-tab in CMMSClinicalOperationsPanel.jsx).
// businessName is purely cosmetic (print header / public page heading).
// A preset re-run or a slow load racing an add can hand back the same field
// twice; keep the first of each id so React keys stay unique.
const uniqueById = (rows) => {
  const seen = new Set();
  return (rows || []).filter((r) => (seen.has(r.id) ? false : seen.add(r.id)));
};

export default function CMMSConsultationForms({ businessProfileId, businessName, businessLogo }) {
  const { queueAction } = useAuth();
  const logoUrl = useResolvedLogo(businessLogo);
  const [forms, setForms] = useState([]);
  const [loadingForms, setLoadingForms] = useState(true);
  const [selectedFormId, setSelectedFormId] = useState(null);
  const [fields, setFields] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [detailTab, setDetailTab] = useState('builder'); // builder | submissions
  const [error, setError] = useState('');
  const [copyState, setCopyState] = useState('idle');

  const [newFormName, setNewFormName] = useState('');
  const [creating, setCreating] = useState(false);

  const [fieldForm, setFieldForm] = useState({ label: '', fieldType: 'text', isRequired: false, optionsText: '' });
  const [savingField, setSavingField] = useState(false);

  const [sectionLabel, setSectionLabel] = useState('');
  const [savingSection, setSavingSection] = useState(false);

  const [editingFieldId, setEditingFieldId] = useState(null);
  const [editDraft, setEditDraft] = useState({ label: '', fieldType: 'text', isRequired: false, optionsText: '' });
  const [savingEdit, setSavingEdit] = useState(false);

  const [viewingSubmissionId, setViewingSubmissionId] = useState(null);
  const [recording, setRecording] = useState(false);
  const [walkIn, setWalkIn] = useState({ name: '', phone: '', email: '', address: '', dob: '', responses: {} });
  const [walkInAttachments, setWalkInAttachments] = useState([]);
  const [savingWalkIn, setSavingWalkIn] = useState(false);

  const selectedForm = forms.find((f) => f.id === selectedFormId) || null;

  // The owner's options for this form (logo / QR codes / attachments). `brandLogo` is the logo
  // value handed to every printout, PDF and flyer - null when the owner switched the logo off.
  const settings = useMemo(() => normalizeFormSettings(selectedForm?.settings), [selectedForm]);
  const brandLogo = settings.showLogo ? businessLogo : null;
  const attachmentLabels = resolveAttachmentLabels(settings);
  const attachmentPrompt = resolveAttachmentPrompt(settings);

  const [optionsDraft, setOptionsDraft] = useState({ ...DEFAULT_FORM_SETTINGS, labelsText: labelsToText(null) });
  const [savingOptions, setSavingOptions] = useState(false);
  // Re-seed the editor only when the saved options (or the selected form) really change - a
  // refresh of the forms list must not throw away what the owner is midway through editing.
  const savedSettingsKey = `${selectedForm?.id || ''}:${JSON.stringify(settings)}`;
  useEffect(() => {
    setOptionsDraft({ ...settings, labelsText: labelsToText(settings.attachmentLabels) });
  }, [savedSettingsKey]);
  const draftSettings = { ...optionsDraft, attachmentLabels: textToLabels(optionsDraft.labelsText) };
  const optionsDirty = !settingsEqual(draftSettings, settings);
  const setOption = (changes) => setOptionsDraft((d) => ({ ...d, ...changes }));

  const saveOptions = async () => {
    if (!selectedForm) return;
    setSavingOptions(true);
    setError('');
    const result = await saveConsultationFormSettings(selectedForm.id, settingsPayloadOf(draftSettings));
    setSavingOptions(false);
    if (result.success) setForms((current) => current.map((f) => (f.id === selectedForm.id ? result.data : f)));
    else setError(result.error);
  };

  const loadForms = async () => {
    setLoadingForms(true);
    const result = await listConsultationForms(businessProfileId);
    if (result.success) {
      setForms(result.data);
      setSelectedFormId((current) => current || result.data[0]?.id || null);
    } else setError(result.error);
    setLoadingForms(false);
  };

  useEffect(() => { if (businessProfileId) loadForms(); }, [businessProfileId]);

  useEffect(() => {
    if (!selectedFormId) { setFields([]); setSubmissions([]); return; }
    listConsultationFields(selectedFormId).then((r) => r.success && setFields(uniqueById(r.data)));
    listConsultationSubmissions(selectedFormId).then((r) => r.success && setSubmissions(r.data));
    setViewingSubmissionId(null);
    setRecording(false);
    setWalkInAttachments([]);
  }, [selectedFormId]);

  // A walk-in recorded offline (see submitWalkIn below) is queued and shown
  // right away as a local pendingSync placeholder. Once syncManager actually
  // runs the RPC, refetch this form's submissions so the placeholder is
  // replaced by the real, server-assigned record.
  useEffect(() => {
    if (!selectedFormId) return;
    return syncManager.onSyncStateChange((state) => {
      if (state.status === 'synced' && state.syncedCount > 0) {
        listConsultationSubmissions(selectedFormId).then((r) => r.success && setSubmissions(r.data));
      }
    });
  }, [selectedFormId]);

  const createForm = async (e) => {
    e.preventDefault();
    if (!newFormName.trim()) return;
    setCreating(true);
    setError('');
    const result = await saveConsultationForm({ businessProfileId, name: newFormName.trim() });
    setCreating(false);
    if (!result.success) { setError(result.error); return; }
    setNewFormName('');
    setForms((current) => [result.data, ...current]);
    setSelectedFormId(result.data.id);
  };

  const toggleActive = async (form) => {
    const result = await saveConsultationForm({ id: form.id, name: form.name, isActive: !form.is_active });
    if (result.success) setForms((current) => current.map((f) => (f.id === form.id ? result.data : f)));
  };

  const removeForm = async (form) => {
    if (!window.confirm(`Delete "${form.name}"? Past patient submissions stay on record — only the form template is removed.`)) return;
    const result = await deleteConsultationForm(form.id);
    if (result.success) {
      setForms((current) => current.filter((f) => f.id !== form.id));
      if (selectedFormId === form.id) setSelectedFormId(null);
    }
  };

  const toggleShare = async () => {
    if (!selectedForm) return;
    const result = await setConsultationFormShare(selectedForm.id, !selectedForm.share_enabled);
    if (result.success) setForms((current) => current.map((f) => (f.id === selectedForm.id ? result.data : f)));
  };

  const copyShareLink = async () => {
    if (!selectedForm) return;
    const url = shareUrl(selectedForm.share_token);
    try {
      await navigator.clipboard.writeText(url);
      setCopyState('copied');
      setTimeout(() => setCopyState('idle'), 2000);
    } catch {
      window.prompt('Copy this link:', url);
    }
  };

  // Native OS share sheet (WhatsApp, SMS, email, AirDrop…) where supported
  // — same navigator.share + clipboard-fallback pattern already used for
  // sharing links elsewhere in CMMS (see CMMSServiceProviderContractPanel.jsx).
  const shareLink = async () => {
    if (!selectedForm) return;
    const url = shareUrl(selectedForm.share_token);
    if (navigator.share) {
      try { await navigator.share({ title: `${businessName ? businessName + ' — ' : ''}${selectedForm.name}`, text: 'Please fill out this form:', url }); return; } catch { return; }
    }
    copyShareLink();
  };

  const addPresetFields = async () => {
    if (!selectedForm) return;
    const result = await addCommonClinicalFields(selectedForm.id);
    if (result.success) setFields(uniqueById(result.data));
  };

  const addPhysiotherapyPreset = async () => {
    if (!selectedForm) return;
    const result = await addPhysiotherapyConsultationFields(selectedForm.id);
    if (result.success) setFields(uniqueById(result.data)); else setError(result.error);
  };

  const addPatientAssessmentPreset = async () => {
    if (!selectedForm) return;
    const result = await addPatientAssessmentFields(selectedForm.id);
    if (result.success) setFields(uniqueById(result.data)); else setError(result.error);
  };

  const submitField = async (e) => {
    e.preventDefault();
    if (!selectedForm || !fieldForm.label.trim()) return;
    setSavingField(true);
    const options = NEEDS_OPTIONS.has(fieldForm.fieldType)
      ? fieldForm.optionsText.split(',').map((o) => o.trim()).filter(Boolean)
      : null;
    const result = await saveConsultationField({
      formId: selectedForm.id, label: fieldForm.label.trim(), fieldType: fieldForm.fieldType,
      options, isRequired: fieldForm.isRequired, sortOrder: fields.length
    });
    setSavingField(false);
    if (result.success) {
      setFields((current) => uniqueById([...current, result.data]));
      setFieldForm({ label: '', fieldType: 'text', isRequired: false, optionsText: '' });
    } else setError(result.error);
  };

  // A dedicated quick-add for section headers, separate from "Add a custom
  // field" below — the field-type dropdown there also offers "Section
  // header" as one of eight options, but that buries the one action most
  // people reach for right after a preset: breaking the form up into named
  // parts. This is the same saveConsultationField call, just pre-set to
  // fieldType 'section' with no type/options/required choices to make.
  const submitSection = async (e) => {
    e.preventDefault();
    if (!selectedForm || !sectionLabel.trim()) return;
    setSavingSection(true);
    const result = await saveConsultationField({
      formId: selectedForm.id, label: sectionLabel.trim(), fieldType: 'section', sortOrder: fields.length
    });
    setSavingSection(false);
    if (result.success) {
      setFields((current) => uniqueById([...current, result.data]));
      setSectionLabel('');
    } else setError(result.error);
  };

  // A field's label/type/options/required were previously only settable at
  // creation — fixing a typo, or a wording change like this preset's
  // "...previous surgeries/hospitalizations" growing a trailing "genetic
  // conditions", meant deleting the field and re-adding it, which drops its
  // field_key and orphans any past answers under it. This reuses the same
  // saveConsultationField(id, ...) update path moveField already relies on.
  const startEditField = (f) => {
    setEditingFieldId(f.id);
    setEditDraft({
      label: f.field_type === 'section' ? bareSectionLabel(f.label) : f.label,
      fieldType: f.field_type,
      isRequired: !!f.is_required,
      optionsText: (f.options || []).join(', ')
    });
  };

  const cancelEditField = () => setEditingFieldId(null);

  const submitEditField = async (e, f) => {
    e.preventDefault();
    if (!editDraft.label.trim()) return;
    setSavingEdit(true);
    const options = NEEDS_OPTIONS.has(editDraft.fieldType)
      ? editDraft.optionsText.split(',').map((o) => o.trim()).filter(Boolean)
      : null;
    const result = await saveConsultationField({
      id: f.id, label: editDraft.label.trim(), fieldType: editDraft.fieldType,
      options, isRequired: editDraft.isRequired, sortOrder: f.sort_order
    });
    setSavingEdit(false);
    if (result.success) {
      setFields((current) => current.map((item) => (item.id === f.id ? result.data : item)));
      setEditingFieldId(null);
    } else setError(result.error);
  };

  const removeField = async (field) => {
    const result = await deleteConsultationField(field.id);
    if (result.success) setFields((current) => current.filter((f) => f.id !== field.id));
  };

  const moveField = async (index, direction) => {
    const target = index + direction;
    if (target < 0 || target >= fields.length) return;
    const a = fields[index], b = fields[target];
    const reordered = [...fields];
    reordered[index] = b; reordered[target] = a;
    setFields(reordered);
    await Promise.all([
      saveConsultationField({ id: a.id, label: a.label, fieldType: a.field_type, options: a.options, isRequired: a.is_required, sortOrder: target }),
      saveConsultationField({ id: b.id, label: b.label, fieldType: b.field_type, options: b.options, isRequired: b.is_required, sortOrder: index })
    ]);
  };

  // The QR in a blank form's letterhead sends whoever scans it to the online version of
  // the form - only possible while sharing is on (otherwise the link would be dead).
  const printBlankForm = async () => {
    if (!selectedForm) return;
    const win = openPrintShell();
    if (!win) return;
    try {
      const { url: logoSrc, image: logoImage } = await loadLogoAsset(brandLogo);
      const qrDataUrl = settings.showQr && selectedForm.share_enabled
        ? await makeQrDataUrl(shareUrl(selectedForm.share_token), { logo: logoImage })
        : '';
      const fieldsHtml = fields.map((f) => {
        if (f.field_type === 'section') {
          return `<div class="section-heading">${escapeHtml(sectionDisplayLabel(fields, f))}</div>`;
        }
        let answerHtml;
        if (f.field_type === 'select' || f.field_type === 'multiselect') {
          answerHtml = `<div class="answer">${(f.options || []).map((o) => escapeHtml(o)).join(' &nbsp;□&nbsp; ') || '&nbsp;'}</div>`;
        } else if (f.field_type === 'checkbox') {
          answerHtml = `<div class="answer">☐ Yes &nbsp;&nbsp; ☐ No</div>`;
        } else if (f.field_type === 'textarea') {
          answerHtml = `<div class="blank-lines"><div class="blank-line"></div><div class="blank-line"></div><div class="blank-line"></div></div>`;
        } else {
          answerHtml = `<div class="blank-line"></div>`;
        }
        return `<div class="field"><div class="label">${escapeHtml(f.label)}${f.is_required ? ' <span class="required">*</span>' : ''}</div>${answerHtml}</div>`;
      }).join('');
      fillPrintShell(
        win,
        `${businessName || 'Clinic'} — ${selectedForm.name}`,
        `${letterheadHtml({
          businessName, logoUrl: logoSrc,
          detailsHtml: `${escapeHtml(selectedForm.name)}${selectedForm.description ? ' — ' + escapeHtml(selectedForm.description) : ''}<br>Patient name: _______________________ &nbsp;&nbsp; Date: _______________`,
          qrDataUrl, qrCaption: qrDataUrl ? 'Scan to fill in online' : ''
        })}${fieldsHtml}`
      );
    } catch (err) {
      console.error('Unable to prepare the printable form:', err);
      closePrintShell(win);
      setError('Unable to prepare the printout. Please try again.');
    }
  };

  // A patient's record: the letterhead QR is the record's reference code (scan it, or type
  // the code into Records search, to pull the record up), and its attachments follow the answers.
  const printSubmission = async (submission) => {
    const win = openPrintShell();
    if (!win) return;
    try {
      const { url: logoSrc, image: logoImage } = await loadLogoAsset(brandLogo);
      const code = recordReferenceCode(submission.id);
      const [qrDataUrl, attachments] = await Promise.all([
        settings.showQr && code ? makeQrDataUrl(recordQrPayload(submission.id), { logo: logoImage }) : '',
        resolveAttachmentUrls(recordAttachments(submission))
      ]);
      const entries = submissionEntries(submission, fields);
      const fieldsHtml = entries.map((entry) => entry.isSection
        ? `<div class="section-heading">${escapeHtml(entry.label)}</div>`
        : `<div class="field"><div class="label">${escapeHtml(entry.label)}</div><div class="answer">${escapeHtml(formatAnswer(entry))}</div></div>`
      ).join('');
      fillPrintShell(
        win,
        `${businessName || 'Clinic'} — ${submission.patient_name}`,
        `${letterheadHtml({
          businessName, logoUrl: logoSrc,
          detailsHtml: `${escapeHtml(submission.form_name_snapshot || selectedForm?.name || 'Consultation form')}<br>
            Patient: ${escapeHtml(submission.patient_name)}${submission.patient_phone ? ' · ' + escapeHtml(submission.patient_phone) : ''}${submission.patient_email ? ' · ' + escapeHtml(submission.patient_email) : ''}${submission.patient_dob ? ' · DOB ' + escapeHtml(submission.patient_dob) : ''}${submission.patient_address ? '<br>Address: ' + escapeHtml(submission.patient_address) : ''}<br>
            Submitted: ${escapeHtml(new Date(submission.created_at).toLocaleString())} (${submission.submitted_via === 'public_link' ? 'via public link' : 'recorded by staff'})`,
          qrDataUrl, qrCaption: qrDataUrl ? 'Record reference' : '', qrCode: qrDataUrl ? formatReferenceCode(code) : ''
        })}${fieldsHtml}${attachmentsHtml(attachments)}
         <div class="meta">Printed ${escapeHtml(new Date().toLocaleString())} · Powered by IcanEra · ${PRODUCT_OF_HTML}</div>`
      );
    } catch (err) {
      console.error('Unable to prepare the printable record:', err);
      closePrintShell(win);
      setError('Unable to prepare the printout. Please try again.');
    }
  };

  const downloadBlankPdf = async () => {
    if (!selectedForm) return;
    try {
      await downloadBlankConsultationFormPdf({
        businessName, form: selectedForm, fields, logoRaw: brandLogo,
        shareUrl: settings.showQr && selectedForm.share_enabled ? shareUrl(selectedForm.share_token) : undefined
      });
    } catch (err) {
      console.error('Unable to create blank form PDF:', err);
      setError('Unable to create the PDF. Please try again.');
    }
  };

  const downloadSubmissionPdf = async (submission) => {
    try {
      await downloadConsultationSubmissionPdf({
        businessName, formName: selectedForm?.name, submission, entries: submissionEntries(submission, fields), logoRaw: brandLogo, showQr: settings.showQr
      });
    } catch (err) {
      console.error('Unable to create submission PDF:', err);
      setError('Unable to create the PDF. Please try again.');
    }
  };

  const downloadShareQr = async () => {
    if (!selectedForm) return;
    try {
      await downloadCmmsQrPdf({
        type: 'consultation-form',
        url: shareUrl(selectedForm.share_token),
        location: selectedForm.description || 'Scan to fill out this form on your phone',
        companyName: businessName,
        title: selectedForm.name,
        note: 'No ICAN account needed — anyone with this code can fill out and submit this form.',
        logoRaw: brandLogo
      });
    } catch (err) {
      console.error('Unable to create the share QR PDF:', err);
      setError('Unable to create the QR code PDF. Please try again.');
    }
  };

  // The same branded QR as a plain PNG - for a sticker, a social post, a WhatsApp status.
  const downloadShareQrPng = async () => {
    if (!selectedForm) return;
    try {
      const { image } = await loadLogoAsset(brandLogo);
      const dataUrl = await makeQrDataUrl(shareUrl(selectedForm.share_token), { logo: image, size: 1000 });
      const link = document.createElement('a');
      link.href = dataUrl;
      link.download = `${(selectedForm.name || 'form').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'form'}-qr.png`;
      link.click();
    } catch (err) {
      console.error('Unable to create the share QR image:', err);
      setError('Unable to create the QR code image. Please try again.');
    }
  };

  const submitWalkIn = async (e) => {
    e.preventDefault();
    if (!selectedForm || !walkIn.name.trim()) return;
    if (attachmentsUploading(walkInAttachments)) { setError('Please wait for the attachments to finish uploading.'); return; }
    setSavingWalkIn(true);
    setError('');

    const payload = {
      formId: selectedForm.id, patientName: walkIn.name.trim(), patientPhone: walkIn.phone, patientEmail: walkIn.email,
      patientAddress: walkIn.address, patientDob: walkIn.dob || null, responses: walkIn.responses,
      attachments: cleanAttachments(attachmentsToSave(walkInAttachments))
    };

    // WhatsApp-style offline recording: a clinic filling this in with no
    // connection (the whole point of a "walk-in" form) still gets an
    // instant local record, queued through the same offline-action queue
    // ICAN's transactions already use (see AuthContext.queueAction /
    // syncManager.js) and synced automatically once back online.
    if (!navigator.onLine) {
      try {
        await queueAction('consultation_form_submission', payload);
        setSubmissions((current) => [{
          id: `pending_${Date.now()}`,
          form_id: selectedForm.id,
          business_profile_id: businessProfileId,
          patient_name: payload.patientName,
          patient_phone: payload.patientPhone || null,
          patient_email: payload.patientEmail || null,
          patient_address: payload.patientAddress || null,
          patient_dob: payload.patientDob || null,
          responses: payload.responses,
          attachments: payload.attachments,
          submitted_via: 'staff',
          created_at: new Date().toISOString(),
          pendingSync: true,
        }, ...current]);
        setWalkIn({ name: '', phone: '', email: '', address: '', dob: '', responses: {} });
        setWalkInAttachments([]);
        setRecording(false);
      } catch (err) {
        setError(err.message || 'Could not save this submission offline.');
      }
      setSavingWalkIn(false);
      return;
    }

    const result = await recordConsultationSubmission(payload);
    setSavingWalkIn(false);
    if (!result.success) { setError(result.error); return; }
    setSubmissions((current) => [result.data, ...current]);
    setWalkIn({ name: '', phone: '', email: '', address: '', dob: '', responses: {} });
    setWalkInAttachments([]);
    setRecording(false);
  };

  const viewingSubmission = useMemo(() => submissions.find((s) => s.id === viewingSubmissionId) || null, [submissions, viewingSubmissionId]);

  return (
    <div className="space-y-5 overflow-x-hidden">
      <div>
        <h2 className="text-2xl font-bold text-white">Consultation Forms</h2>
        <p className="mt-1 text-sm text-slate-400">
          Build a customizable patient intake form — bio, medical history, injuries, surgical history, next of kin,
          or anything else — then share it as a public link or print it.
        </p>
      </div>

      {error && <p className="rounded-lg bg-red-500/10 p-3 text-sm text-red-200">{error}</p>}

      <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        {/* ── Forms list ─────────────────────────────────────────── */}
        <div className="min-w-0 space-y-3">
          <form onSubmit={createForm} className="flex gap-2">
            <input
              value={newFormName} onChange={(e) => setNewFormName(e.target.value)}
              placeholder="New form, e.g. General Consultation"
              className="min-w-0 flex-1 rounded-lg bg-slate-900 px-3 py-2 text-sm text-white"
            />
            <button disabled={creating || !newFormName.trim()} className="flex items-center justify-center rounded-lg bg-blue-600 px-3 py-2 text-white disabled:opacity-50">
              {creating ? <Loader className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            </button>
          </form>

          {loadingForms ? (
            <div className="flex items-center gap-2 text-sm text-slate-400"><Loader className="h-4 w-4 animate-spin" /> Loading…</div>
          ) : forms.length === 0 ? (
            <p className="rounded-xl border border-dashed border-white/15 p-4 text-center text-xs text-slate-400">
              No consultation forms yet — create one above.
            </p>
          ) : (
            <div className="space-y-1.5">
              {forms.map((f) => (
                <button
                  key={f.id} type="button" onClick={() => setSelectedFormId(f.id)}
                  className={`w-full rounded-xl border p-3 text-left transition ${
                    f.id === selectedFormId ? 'border-cyan-400/60 bg-cyan-400/10' : 'border-white/10 bg-white/5 hover:bg-white/10'
                  }`}
                >
                  <p className="truncate text-sm font-semibold text-white">{f.name}</p>
                  <div className="mt-1 flex items-center gap-1.5">
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${f.is_active ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-600/40 text-slate-400'}`}>
                      {f.is_active ? 'Active' : 'Inactive'}
                    </span>
                    {f.share_enabled && (
                      <span className="flex items-center gap-0.5 rounded-full bg-cyan-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-300">
                        <Share2 className="h-2.5 w-2.5" /> Shared
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ── Selected form detail ───────────────────────────────── */}
        <div className="min-w-0">
          {!selectedForm ? (
            <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-white/15 p-10 text-center text-sm text-slate-400">
              <div><FileText className="mx-auto mb-2 h-7 w-7" />Pick or create a form to start customizing it.</div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/5 p-4">
                <div className="flex min-w-0 items-center gap-3">
                  {settings.showLogo && logoUrl && (
                    <img src={logoUrl} alt="" style={{ background: '#ffffff' }} className="h-12 w-12 shrink-0 rounded-xl border border-white/10 object-contain p-0.5" />
                  )}
                  <div className="min-w-0">
                    <h3 className="truncate text-lg font-bold text-white">{selectedForm.name}</h3>
                    {selectedForm.description && <p className="text-sm text-slate-400">{selectedForm.description}</p>}
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {settingsSummary(settings).map((text) => (
                        <span key={text} className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${/off/.test(text) ? 'bg-slate-600/40 text-slate-400' : 'bg-cyan-500/15 text-cyan-300'}`}>{text}</span>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" onClick={() => toggleActive(selectedForm)} className="flex items-center gap-1.5 rounded-lg border border-white/15 px-2.5 py-1.5 text-xs text-slate-200 hover:bg-white/5">
                    <Power className="h-3.5 w-3.5" /> {selectedForm.is_active ? 'Deactivate' : 'Activate'}
                  </button>
                  <button type="button" onClick={printBlankForm} className="flex items-center gap-1.5 rounded-lg border border-white/15 px-2.5 py-1.5 text-xs text-slate-200 hover:bg-white/5">
                    <Printer className="h-3.5 w-3.5" /> Print blank form
                  </button>
                  <button type="button" onClick={downloadBlankPdf} className="flex items-center gap-1.5 rounded-lg border border-white/15 px-2.5 py-1.5 text-xs text-slate-200 hover:bg-white/5">
                    <Download className="h-3.5 w-3.5" /> Download PDF
                  </button>
                  <button type="button" onClick={() => removeForm(selectedForm)} className="flex items-center gap-1.5 rounded-lg border border-red-400/30 px-2.5 py-1.5 text-xs text-red-300 hover:bg-red-500/10">
                    <Trash2 className="h-3.5 w-3.5" /> Delete
                  </button>
                </div>
              </div>

              {/* Share link & QR code — always available; the QR just needs sharing switched on */}
              <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="flex items-center gap-1.5 text-sm font-semibold text-white"><QrCode className="h-4 w-4 text-cyan-300" /> Share link &amp; QR code</p>
                    <p className="text-xs text-slate-400">Anyone with the link or QR code can fill out and submit this form — no ICAN account needed.</p>
                  </div>
                  <button
                    type="button" onClick={toggleShare}
                    className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${selectedForm.share_enabled ? 'bg-emerald-500 text-white' : 'bg-slate-700 text-slate-300'}`}
                  >
                    {selectedForm.share_enabled ? 'Shared — tap to stop' : 'Not shared — tap to enable'}
                  </button>
                </div>

                {selectedForm.share_enabled ? (
                  <div className="mt-3 space-y-3">
                    <div className="flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2">
                      <code className="min-w-0 flex-1 truncate text-xs text-cyan-300">{shareUrl(selectedForm.share_token)}</code>
                      <button type="button" onClick={copyShareLink} className="flex items-center gap-1 rounded-lg bg-white/10 px-2 py-1 text-xs text-white hover:bg-white/20">
                        {copyState === 'copied' ? <Check className="h-3.5 w-3.5 text-emerald-300" /> : <Copy className="h-3.5 w-3.5" />}
                        {copyState === 'copied' ? 'Copied' : 'Copy'}
                      </button>
                      <button type="button" onClick={shareLink} className="flex items-center gap-1 rounded-lg bg-cyan-600 px-2 py-1 text-xs text-white hover:bg-cyan-500">
                        <Share2 className="h-3.5 w-3.5" /> Share
                      </button>
                    </div>
                    <div className="flex flex-wrap items-center gap-4 rounded-lg border border-white/10 bg-slate-900/60 p-3">
                      {/* inline white: index.css maps .bg-white to the theme background, and a QR needs a light quiet zone */}
                      <div className="rounded-lg p-1" style={{ background: '#ffffff' }}>
                        <QRCodeSVG
                          value={shareUrl(selectedForm.share_token)} size={128} level="H" marginSize={2}
                          imageSettings={settings.showLogo && logoUrl ? { src: logoUrl, height: 26, width: 26, excavate: true } : undefined}
                        />
                      </div>
                      <div className="min-w-0 flex-1 space-y-2">
                        <p className="text-xs text-slate-400">
                          Patients scan this to open and fill out the form on their own phone — no link needed.
                          {settings.showLogo && logoUrl ? ' Your logo sits in the centre.' : ''} Print it at reception, put it on a sign, or post it online.
                        </p>
                        <div className="flex flex-wrap gap-2">
                          <button type="button" onClick={downloadShareQr} className="flex items-center gap-1.5 rounded-lg border border-white/15 px-2.5 py-1.5 text-xs text-slate-200 hover:bg-white/5">
                            <Download className="h-3.5 w-3.5" /> Download flyer (PDF)
                          </button>
                          <button type="button" onClick={downloadShareQrPng} className="flex items-center gap-1.5 rounded-lg border border-white/15 px-2.5 py-1.5 text-xs text-slate-200 hover:bg-white/5">
                            <ImageIcon className="h-3.5 w-3.5" /> Download image (PNG)
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 flex flex-wrap items-center gap-4 rounded-lg border border-dashed border-white/15 bg-slate-900/40 p-3">
                    <div className="relative rounded-lg p-1" style={{ background: '#ffffff' }}>
                      <div className="blur-[5px]"><QRCodeSVG value={shareUrl(selectedForm.share_token)} size={104} marginSize={2} /></div>
                      <Lock className="absolute left-1/2 top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 text-slate-700" />
                    </div>
                    <div className="min-w-0 flex-1 space-y-2">
                      <p className="text-xs text-slate-400">
                        This form's QR code is ready but locked until sharing is on. Once it is, you can print the QR on a flyer, and
                        {settings.showQr ? ' blank printouts and PDFs get a "scan to fill in online" QR automatically.' : ' you can turn on QR codes for printouts in Form options below.'}
                      </p>
                      <button type="button" onClick={toggleShare} className="flex items-center gap-1.5 rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-cyan-500">
                        <QrCode className="h-3.5 w-3.5" /> Turn on sharing &amp; reveal QR
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* The owner decides how the logo, QR codes and attachments work for THIS form */}
              <Disclosure key={`options-${selectedForm.id}`} title="Form options — logo, QR codes & attachments" icon={Sparkles}>
                <p className="text-xs text-slate-400">
                  These are available on every form and start switched on. Choose how each one works for <span className="font-semibold text-slate-200">{selectedForm.name}</span>.
                </p>
                <OptionToggle
                  label="Business logo" checked={optionsDraft.showLogo} onChange={(v) => setOption({ showLogo: v })}
                  hint={logoUrl ? 'Shown on the patient form, printouts, PDFs and the QR flyer.' : 'No logo found yet - add one in your Board profile and it appears everywhere.'}
                />
                <OptionToggle
                  label="QR codes" checked={optionsDraft.showQr} onChange={(v) => setOption({ showQr: v })}
                  hint="A scan-to-fill QR on blank printouts and PDFs, a reference QR on each patient record, and the patient's check-in pass."
                />
                <OptionToggle
                  label="Photo & document attachments" checked={optionsDraft.allowAttachments} onChange={(v) => setOption({ allowAttachments: v })}
                  hint="Patients and staff can attach X-rays, injury photos, lab results, ID or insurance cards."
                />
                {optionsDraft.allowAttachments && (
                  <div className="space-y-3 border-l border-white/10 pl-3">
                    <OptionToggle
                      label="Patients must attach at least one file" checked={optionsDraft.attachmentsRequired}
                      onChange={(v) => setOption({ attachmentsRequired: v })} hint="Applies to patients filling the form in online; staff recording a walk-in aren't blocked."
                    />
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="block text-xs text-slate-400">
                        Most files per submission
                        <select
                          value={optionsDraft.attachmentMax} onChange={(e) => setOption({ attachmentMax: Number(e.target.value) })}
                          className="mt-1 w-full rounded-lg bg-slate-900 px-3 py-2 text-sm text-white"
                        >
                          {Array.from({ length: MAX_STAFF_ATTACHMENTS }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
                        </select>
                      </label>
                      <label className="block text-xs text-slate-400">
                        Heading above the attachments
                        <input
                          value={optionsDraft.attachmentPrompt} onChange={(e) => setOption({ attachmentPrompt: e.target.value })} maxLength={80}
                          placeholder="Photos & documents" className="mt-1 w-full rounded-lg bg-slate-900 px-3 py-2 text-sm text-white"
                        />
                      </label>
                    </div>
                    <label className="block text-xs text-slate-400">
                      Tags a file can carry (comma-separated — clear the box for no tags)
                      <input
                        value={optionsDraft.labelsText} onChange={(e) => setOption({ labelsText: e.target.value })}
                        className="mt-1 w-full rounded-lg bg-slate-900 px-3 py-2 text-sm text-white"
                      />
                    </label>
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button" onClick={saveOptions} disabled={!optionsDirty || savingOptions}
                    className="flex items-center gap-1.5 rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    {savingOptions && <Loader className="h-3.5 w-3.5 animate-spin" />} Save options
                  </button>
                  <button
                    type="button" onClick={() => setOptionsDraft({ ...DEFAULT_FORM_SETTINGS, labelsText: labelsToText(null) })}
                    className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/5"
                  >
                    Reset to defaults
                  </button>
                </div>
              </Disclosure>

              {/* Fields / Submissions sub-tabs */}
              <div className="flex gap-2 border-b border-white/10">
                {[['builder', `Fields (${fields.length})`], ['submissions', `Submissions (${submissions.length})`]].map(([key, label]) => (
                  <button
                    key={key} type="button" onClick={() => setDetailTab(key)}
                    className={`border-b-2 px-3 py-2 text-sm font-medium transition ${detailTab === key ? 'border-cyan-400 text-white' : 'border-transparent text-slate-400'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {detailTab === 'builder' && (
                <div className="space-y-3">
                  <button
                    type="button"
                    onClick={() => { setDetailTab('submissions'); setRecording(true); }}
                    className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-500"
                  >
                    <UserPlus className="h-3.5 w-3.5" /> Manually enter a client's answers on this form
                  </button>

                  <Disclosure key={`presets-${selectedForm.id}`} title="Presets & add fields" icon={Sparkles} defaultOpen={fields.length === 0}>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={addPresetFields} className="flex items-center gap-1.5 rounded-lg border border-cyan-400/30 bg-cyan-400/10 px-3 py-1.5 text-xs font-semibold text-cyan-200 hover:bg-cyan-400/20">
                        <Sparkles className="h-3.5 w-3.5" /> Add common clinical fields (bio, medical history, allergies, next of kin…)
                      </button>
                      <button type="button" onClick={addPhysiotherapyPreset} className="flex items-center gap-1.5 rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-1.5 text-xs font-semibold text-emerald-200 hover:bg-emerald-400/20">
                        <Sparkles className="h-3.5 w-3.5" /> Add physiotherapy initial consultation form
                      </button>
                      <button type="button" onClick={addPatientAssessmentPreset} className="flex items-center gap-1.5 rounded-lg border border-violet-400/30 bg-violet-400/10 px-3 py-1.5 text-xs font-semibold text-violet-200 hover:bg-violet-400/20">
                        <Sparkles className="h-3.5 w-3.5" /> Add patient assessment information form
                      </button>
                    </div>

                    <form onSubmit={submitSection} className="flex gap-2 rounded-xl border border-emerald-400/20 bg-emerald-400/5 p-3">
                      <input
                        value={sectionLabel} onChange={(e) => setSectionLabel(e.target.value)}
                        placeholder="Add a section heading, e.g. Medical History"
                        className="min-w-0 flex-1 rounded-lg bg-slate-900 px-3 py-2 text-sm text-white"
                      />
                      <button disabled={savingSection || !sectionLabel.trim()} className="flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50 hover:bg-emerald-500">
                        {savingSection ? <Loader className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Add section
                      </button>
                    </form>
                  </Disclosure>

                  <div className="space-y-1.5">
                    {fields.length === 0 && (
                      <p className="rounded-xl border border-dashed border-white/15 p-4 text-center text-xs text-slate-400">
                        No fields yet — use a preset above, or add your own below.
                      </p>
                    )}
                    {fields.map((f, index) => {
                      if (editingFieldId === f.id) {
                        return (
                          <form key={f.id} onSubmit={(e) => submitEditField(e, f)} className="space-y-2 rounded-xl border border-cyan-400/30 bg-cyan-400/10 p-3">
                            <div className="grid gap-2 sm:grid-cols-2">
                              <input
                                autoFocus required value={editDraft.label} onChange={(e) => setEditDraft((d) => ({ ...d, label: e.target.value }))}
                                className="rounded-lg bg-slate-900 px-3 py-2 text-sm text-white"
                              />
                              {editDraft.fieldType !== 'section' && (
                                <select value={editDraft.fieldType} onChange={(e) => setEditDraft((d) => ({ ...d, fieldType: e.target.value }))} className="rounded-lg bg-slate-900 px-3 py-2 text-sm text-white">
                                  {FIELD_TYPES.filter(([v]) => v !== 'section').map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                                </select>
                              )}
                            </div>
                            {NEEDS_OPTIONS.has(editDraft.fieldType) && (
                              <input
                                value={editDraft.optionsText} onChange={(e) => setEditDraft((d) => ({ ...d, optionsText: e.target.value }))}
                                placeholder="Choices, comma-separated" className="w-full rounded-lg bg-slate-900 px-3 py-2 text-sm text-white"
                              />
                            )}
                            {editDraft.fieldType !== 'section' && (
                              <label className="flex items-center gap-2 text-xs text-slate-300">
                                <input type="checkbox" checked={editDraft.isRequired} onChange={(e) => setEditDraft((d) => ({ ...d, isRequired: e.target.checked }))} />
                                Required
                              </label>
                            )}
                            <div className="flex gap-2">
                              <button disabled={savingEdit || !editDraft.label.trim()} className="rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
                                {savingEdit ? 'Saving…' : 'Save'}
                              </button>
                              <button type="button" onClick={cancelEditField} className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/5">Cancel</button>
                            </div>
                          </form>
                        );
                      }
                      return f.field_type === 'section' ? (
                        <div key={f.id} className="flex items-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-400/5 px-3 py-2">
                          <div className="flex flex-col">
                            <button type="button" onClick={() => moveField(index, -1)} disabled={index === 0} className="text-slate-400 hover:text-white disabled:opacity-20"><ChevronUp className="h-3.5 w-3.5" /></button>
                            <button type="button" onClick={() => moveField(index, 1)} disabled={index === fields.length - 1} className="text-slate-400 hover:text-white disabled:opacity-20"><ChevronDown className="h-3.5 w-3.5" /></button>
                          </div>
                          <p className="min-w-0 flex-1 truncate text-sm font-bold uppercase tracking-wide text-emerald-200">{sectionDisplayLabel(fields, f)}</p>
                          <span className="rounded-full bg-emerald-400/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">Section</span>
                          <button type="button" onClick={() => startEditField(f)} className="text-slate-300 hover:text-white"><Pencil className="h-3.5 w-3.5" /></button>
                          <button type="button" onClick={() => removeField(f)} className="text-red-400 hover:text-red-300"><Trash2 className="h-4 w-4" /></button>
                        </div>
                      ) : (
                        <div key={f.id} className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 p-3">
                          <div className="flex flex-col">
                            <button type="button" onClick={() => moveField(index, -1)} disabled={index === 0} className="text-slate-400 hover:text-white disabled:opacity-20"><ChevronUp className="h-3.5 w-3.5" /></button>
                            <button type="button" onClick={() => moveField(index, 1)} disabled={index === fields.length - 1} className="text-slate-400 hover:text-white disabled:opacity-20"><ChevronDown className="h-3.5 w-3.5" /></button>
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-white">
                              {f.label}{f.is_required && <span className="ml-1 text-red-400">*</span>}
                            </p>
                            <p className="text-xs text-slate-400">
                              {FIELD_TYPE_LABEL[f.field_type] || f.field_type}
                              {NEEDS_OPTIONS.has(f.field_type) && f.options?.length ? ` — ${f.options.join(', ')}` : ''}
                            </p>
                          </div>
                          <button type="button" onClick={() => startEditField(f)} className="text-slate-300 hover:text-white"><Pencil className="h-3.5 w-3.5" /></button>
                          <button type="button" onClick={() => removeField(f)} className="text-red-400 hover:text-red-300"><Trash2 className="h-4 w-4" /></button>
                        </div>
                      );
                    })}
                  </div>

                  <Disclosure key={`custom-${selectedForm.id}`} title="Add a custom field" icon={Plus} defaultOpen={fields.length === 0}>
                    <form onSubmit={submitField} className="space-y-2">
                      <div className="grid gap-2 sm:grid-cols-2">
                        <input
                          required value={fieldForm.label} onChange={(e) => setFieldForm((f) => ({ ...f, label: e.target.value }))}
                          placeholder={fieldForm.fieldType === 'section' ? 'Section heading, e.g. Medical History' : 'Field label, e.g. Blood pressure'}
                          className="rounded-lg bg-slate-900 px-3 py-2 text-sm text-white"
                        />
                        <select value={fieldForm.fieldType} onChange={(e) => setFieldForm((f) => ({ ...f, fieldType: e.target.value }))} className="rounded-lg bg-slate-900 px-3 py-2 text-sm text-white">
                          {FIELD_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                        </select>
                      </div>
                      {NEEDS_OPTIONS.has(fieldForm.fieldType) && (
                        <input
                          value={fieldForm.optionsText} onChange={(e) => setFieldForm((f) => ({ ...f, optionsText: e.target.value }))}
                          placeholder="Choices, comma-separated (e.g. Mild, Moderate, Severe)" className="w-full rounded-lg bg-slate-900 px-3 py-2 text-sm text-white"
                        />
                      )}
                      {fieldForm.fieldType !== 'section' && (
                        <label className="flex items-center gap-2 text-xs text-slate-300">
                          <input type="checkbox" checked={fieldForm.isRequired} onChange={(e) => setFieldForm((f) => ({ ...f, isRequired: e.target.checked }))} />
                          Required
                        </label>
                      )}
                      <button disabled={savingField || !fieldForm.label.trim()} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                        {savingField ? 'Adding…' : fieldForm.fieldType === 'section' ? 'Add section' : 'Add field'}
                      </button>
                    </form>
                  </Disclosure>
                </div>
              )}

              {detailTab === 'submissions' && (
                <div className="space-y-3">
                  {!recording ? (
                    <button type="button" onClick={() => setRecording(true)} className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white">
                      <Plus className="h-3.5 w-3.5" /> Record a walk-in submission
                    </button>
                  ) : (
                    <form onSubmit={submitWalkIn} className="space-y-3 rounded-xl border border-white/10 bg-white/5 p-4">
                      <p className="text-sm font-semibold text-white">Record this consultation for a patient in front of you</p>
                      {fields[0]?.field_type === 'section' && (
                        <p className="text-xs font-bold uppercase tracking-wide text-cyan-300">{sectionDisplayLabel(fields, fields[0])}</p>
                      )}
                      <div className="grid gap-2 sm:grid-cols-3">
                        <input required value={walkIn.name} onChange={(e) => setWalkIn((w) => ({ ...w, name: e.target.value }))} placeholder="Patient name *" className="rounded-lg bg-slate-900 px-3 py-2 text-sm text-white" />
                        <input value={walkIn.phone} onChange={(e) => setWalkIn((w) => ({ ...w, phone: e.target.value }))} placeholder="Phone" className="rounded-lg bg-slate-900 px-3 py-2 text-sm text-white" />
                        <input value={walkIn.email} onChange={(e) => setWalkIn((w) => ({ ...w, email: e.target.value }))} placeholder="Email" className="rounded-lg bg-slate-900 px-3 py-2 text-sm text-white" />
                      </div>
                      <div className="grid gap-2 sm:grid-cols-3">
                        <div>
                          <label className="mb-1 block text-xs text-slate-400">Date of birth</label>
                          <input type="date" value={walkIn.dob} onChange={(e) => setWalkIn((w) => ({ ...w, dob: e.target.value }))} className="w-full rounded-lg bg-slate-900 px-3 py-2 text-sm text-white" />
                        </div>
                        <div className="sm:col-span-2">
                          <label className="mb-1 block text-xs text-slate-400">Address</label>
                          <input value={walkIn.address} onChange={(e) => setWalkIn((w) => ({ ...w, address: e.target.value }))} className="w-full rounded-lg bg-slate-900 px-3 py-2 text-sm text-white" />
                        </div>
                      </div>
                      {(fields[0]?.field_type === 'section' ? fields.slice(1) : fields).map((f) => (
                        f.field_type === 'section' ? (
                          <p key={f.id} className="pt-2 text-xs font-bold uppercase tracking-wide text-cyan-300 border-t border-white/10">{sectionDisplayLabel(fields, f)}</p>
                        ) : (
                          <div key={f.id}>
                            <label className="mb-1 block text-xs text-slate-400">{f.label}{f.is_required && <span className="text-red-400"> *</span>}</label>
                            <FieldInput
                              field={f}
                              value={walkIn.responses[f.field_key]}
                              onChange={(value) => setWalkIn((w) => ({ ...w, responses: { ...w.responses, [f.field_key]: value } }))}
                            />
                          </div>
                        )
                      ))}
                      {settings.allowAttachments && (
                        <div className="border-t border-white/10 pt-3">
                          <ConsultationAttachmentPicker
                            items={walkInAttachments} onItemsChange={setWalkInAttachments} variant="staff"
                            max={settings.attachmentMax} labels={attachmentLabels} title={attachmentPrompt}
                            disabled={!navigator.onLine} disabledReason="Attachments upload when you're back online - save now and add them to the record later."
                          />
                        </div>
                      )}
                      <div className="flex gap-2">
                        <button type="button" onClick={() => setRecording(false)} className="rounded-lg border border-white/15 px-4 py-2 text-sm text-slate-300">Cancel</button>
                        <button disabled={savingWalkIn || !walkIn.name.trim() || attachmentsUploading(walkInAttachments)} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                          {savingWalkIn ? 'Saving…' : 'Save submission'}
                        </button>
                      </div>
                    </form>
                  )}

                  {submissions.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-white/15 p-4 text-center text-xs text-slate-400">
                      No submissions yet — share the public link above, or record one for a walk-in patient.
                    </p>
                  ) : (
                    <div className="space-y-1.5">
                      {submissions.map((s) => (
                        <div key={s.id} className="rounded-xl border border-white/10 bg-white/5 p-3">
                          <button type="button" onClick={() => setViewingSubmissionId(viewingSubmissionId === s.id ? null : s.id)} className="flex w-full items-center justify-between gap-3 text-left">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-white">{s.patient_name}</p>
                              <p className="text-xs text-slate-400">
                                {new Date(s.created_at).toLocaleString()} · {s.submitted_via === 'public_link' ? 'Public link' : 'Recorded by staff'}
                                {recordAttachments(s).length > 0 && (
                                  <span className="ml-1.5 inline-flex items-center gap-0.5 text-cyan-300"><Paperclip className="h-3 w-3" />{recordAttachments(s).length}</span>
                                )}
                                {s.pendingSync && <span className="ml-1.5 text-amber-400">· Pending sync</span>}
                              </p>
                            </div>
                            {viewingSubmissionId === s.id ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
                          </button>
                          {viewingSubmissionId === s.id && (
                            <div className="mt-3 space-y-2 border-t border-white/10 pt-3">
                              {(s.patient_phone || s.patient_email || s.patient_dob || s.patient_address) && (
                                <p className="text-xs text-slate-400">
                                  {[s.patient_phone, s.patient_email, s.patient_dob ? `DOB ${s.patient_dob}` : null, s.patient_address].filter(Boolean).join(' · ')}
                                </p>
                              )}
                              {submissionEntries(s, fields).map((entry) => (
                                entry.isSection ? (
                                  <p key={entry.key} className="pt-2 text-xs font-bold uppercase tracking-wide text-cyan-300 first:pt-0">{entry.label}</p>
                                ) : (
                                  <div key={entry.key} className="text-sm">
                                    <p className="text-xs text-slate-400">{entry.label}</p>
                                    <p className="text-slate-100">{formatAnswer(entry)}</p>
                                  </div>
                                )
                              ))}
                              <ConsultationRecordAttachments
                                record={s} settings={selectedForm.settings}
                                onRecordUpdated={(row) => setSubmissions((current) => current.map((x) => (x.id === row.id ? row : x)))}
                              />
                              <div className="mt-1 flex gap-2">
                                <button type="button" onClick={() => printSubmission(s)} className="flex items-center gap-1.5 rounded-lg border border-white/15 px-2.5 py-1.5 text-xs text-slate-200 hover:bg-white/5">
                                  <Printer className="h-3.5 w-3.5" /> Print
                                </button>
                                <button type="button" onClick={() => downloadSubmissionPdf(s)} className="flex items-center gap-1.5 rounded-lg border border-white/15 px-2.5 py-1.5 text-xs text-slate-200 hover:bg-white/5">
                                  <Download className="h-3.5 w-3.5" /> Download PDF
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
