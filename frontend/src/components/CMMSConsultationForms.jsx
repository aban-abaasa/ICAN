import React, { useEffect, useMemo, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  Plus, Trash2, Share2, Printer, Copy, Check, Loader, FileText, Download,
  ChevronUp, ChevronDown, Sparkles, Power, UserPlus
} from 'lucide-react';
import {
  listConsultationForms, saveConsultationForm, deleteConsultationForm, setConsultationFormShare,
  listConsultationFields, saveConsultationField, deleteConsultationField, addCommonClinicalFields,
  addPhysiotherapyConsultationFields, addPatientAssessmentFields, listConsultationSubmissions, recordConsultationSubmission
} from '../services/cmmsConsultationFormService';
import { downloadCmmsQrPdf } from '../utils/downloadCmmsQrPdf';
import { downloadBlankConsultationFormPdf, downloadConsultationSubmissionPdf } from '../utils/generateConsultationFormPdf';
import { submissionEntries, formatAnswer } from '../utils/consultationSubmissionUtils';

const FIELD_TYPES = [
  ['text', 'Short text'], ['textarea', 'Long text'], ['date', 'Date'], ['number', 'Number'],
  ['select', 'Single choice'], ['multiselect', 'Multiple choice'], ['checkbox', 'Yes / No'],
  ['section', 'Section header']
];
const FIELD_TYPE_LABEL = Object.fromEntries(FIELD_TYPES);
const NEEDS_OPTIONS = new Set(['select', 'multiselect']);

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const shareUrl = (token) => `${window.location.origin}/consultation-forms/${token}`;

// Opens a fresh tab with a minimal print-friendly document, the same
// window.open + document.write(...) + window.onload=print pattern
// CMSSModule.jsx already uses for its report exports — kept identical so
// printing behaves the same way everywhere in CMMS.
const openPrintWindow = (title, bodyHtml) => {
  const printWindow = window.open('', '_blank', 'noopener,noreferrer');
  if (!printWindow) { alert('Allow pop-ups to print this form.'); return; }
  printWindow.document.write(`<!doctype html><html><head><title>${escapeHtml(title)}</title><style>
    body{font-family:Arial,sans-serif;max-width:720px;margin:32px auto;color:#111;line-height:1.6}
    h1{margin-bottom:2px;font-size:20px}
    .subtitle{color:#555;font-size:13px;margin-bottom:22px;border-bottom:1px solid #ddd;padding-bottom:14px}
    .field{margin-bottom:16px;page-break-inside:avoid}
    .field .label{font-weight:bold;font-size:13px;margin-bottom:4px}
    .field .required{color:#b91c1c;font-weight:normal}
    .field .answer{font-size:13px;white-space:pre-wrap;border-bottom:1px solid #999;min-height:18px;padding-bottom:4px}
    .blank-line{border-bottom:1px solid #999;height:22px}
    .blank-lines .blank-line{margin-bottom:6px}
    .section-heading{margin:26px 0 14px;font-size:14px;font-weight:bold;color:#111;border-bottom:2px solid #333;padding-bottom:4px;page-break-after:avoid}
    .section-heading:first-of-type{margin-top:4px}
    .meta{color:#555;font-size:11px;margin-top:28px;border-top:1px solid #ddd;padding-top:10px}
    @media print{body{margin:18px}}
  </style></head><body>${bodyHtml}<script>window.onload=()=>window.print()</script></body></html>`);
  printWindow.document.close();
};

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
export default function CMMSConsultationForms({ businessProfileId, businessName }) {
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

  const [viewingSubmissionId, setViewingSubmissionId] = useState(null);
  const [recording, setRecording] = useState(false);
  const [walkIn, setWalkIn] = useState({ name: '', phone: '', email: '', responses: {} });
  const [savingWalkIn, setSavingWalkIn] = useState(false);

  const selectedForm = forms.find((f) => f.id === selectedFormId) || null;

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
    listConsultationFields(selectedFormId).then((r) => r.success && setFields(r.data));
    listConsultationSubmissions(selectedFormId).then((r) => r.success && setSubmissions(r.data));
    setViewingSubmissionId(null);
    setRecording(false);
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
    if (result.success) setFields(result.data);
  };

  const addPhysiotherapyPreset = async () => {
    if (!selectedForm) return;
    const result = await addPhysiotherapyConsultationFields(selectedForm.id);
    if (result.success) setFields(result.data); else setError(result.error);
  };

  const addPatientAssessmentPreset = async () => {
    if (!selectedForm) return;
    const result = await addPatientAssessmentFields(selectedForm.id);
    if (result.success) setFields(result.data); else setError(result.error);
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
      setFields((current) => [...current, result.data]);
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
      setFields((current) => [...current, result.data]);
      setSectionLabel('');
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

  const printBlankForm = () => {
    if (!selectedForm) return;
    const fieldsHtml = fields.map((f) => {
      if (f.field_type === 'section') {
        return `<div class="section-heading">${escapeHtml(f.label)}</div>`;
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
    openPrintWindow(
      `${businessName || 'Clinic'} — ${selectedForm.name}`,
      `<h1>${escapeHtml(businessName || 'Clinic')}</h1>
       <div class="subtitle">${escapeHtml(selectedForm.name)}${selectedForm.description ? ' — ' + escapeHtml(selectedForm.description) : ''}<br>
       Patient name: _______________________ &nbsp;&nbsp; Date: _______________</div>
       ${fieldsHtml}`
    );
  };

  const printSubmission = (submission) => {
    const entries = submissionEntries(submission, fields);
    const fieldsHtml = entries.map((entry) => entry.isSection
      ? `<div class="section-heading">${escapeHtml(entry.label)}</div>`
      : `<div class="field"><div class="label">${escapeHtml(entry.label)}</div><div class="answer">${escapeHtml(formatAnswer(entry))}</div></div>`
    ).join('');
    openPrintWindow(
      `${businessName || 'Clinic'} — ${submission.patient_name}`,
      `<h1>${escapeHtml(businessName || 'Clinic')}</h1>
       <div class="subtitle">${escapeHtml(submission.form_name_snapshot || selectedForm?.name || 'Consultation form')}<br>
       Patient: ${escapeHtml(submission.patient_name)}${submission.patient_phone ? ' · ' + escapeHtml(submission.patient_phone) : ''}${submission.patient_email ? ' · ' + escapeHtml(submission.patient_email) : ''}<br>
       Submitted: ${escapeHtml(new Date(submission.created_at).toLocaleString())} (${submission.submitted_via === 'public_link' ? 'via public link' : 'recorded by staff'})</div>
       ${fieldsHtml}
       <div class="meta">Printed ${escapeHtml(new Date().toLocaleString())} · Powered by IcanEra</div>`
    );
  };

  const downloadBlankPdf = () => {
    if (!selectedForm) return;
    try {
      downloadBlankConsultationFormPdf({ businessName, form: selectedForm, fields });
    } catch (err) {
      console.error('Unable to create blank form PDF:', err);
      setError('Unable to create the PDF. Please try again.');
    }
  };

  const downloadSubmissionPdf = (submission) => {
    try {
      downloadConsultationSubmissionPdf({
        businessName, formName: selectedForm?.name, submission, entries: submissionEntries(submission, fields)
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
        note: 'No ICAN account needed — anyone with this code can fill out and submit this form.'
      });
    } catch (err) {
      console.error('Unable to create the share QR PDF:', err);
      setError('Unable to create the QR code PDF. Please try again.');
    }
  };

  const submitWalkIn = async (e) => {
    e.preventDefault();
    if (!selectedForm || !walkIn.name.trim()) return;
    setSavingWalkIn(true);
    setError('');
    const result = await recordConsultationSubmission({
      formId: selectedForm.id, patientName: walkIn.name.trim(), patientPhone: walkIn.phone, patientEmail: walkIn.email,
      responses: walkIn.responses
    });
    setSavingWalkIn(false);
    if (!result.success) { setError(result.error); return; }
    setSubmissions((current) => [result.data, ...current]);
    setWalkIn({ name: '', phone: '', email: '', responses: {} });
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
                <div className="min-w-0">
                  <h3 className="truncate text-lg font-bold text-white">{selectedForm.name}</h3>
                  {selectedForm.description && <p className="text-sm text-slate-400">{selectedForm.description}</p>}
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

              {/* Public share link */}
              <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="flex items-center gap-1.5 text-sm font-semibold text-white"><Share2 className="h-4 w-4 text-cyan-300" /> Public share link</p>
                    <p className="text-xs text-slate-400">Anyone with this link can fill out and submit this form — no ICAN account needed.</p>
                  </div>
                  <button
                    type="button" onClick={toggleShare}
                    className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${selectedForm.share_enabled ? 'bg-emerald-500 text-white' : 'bg-slate-700 text-slate-300'}`}
                  >
                    {selectedForm.share_enabled ? 'Shared — tap to stop' : 'Not shared — tap to enable'}
                  </button>
                </div>
                {selectedForm.share_enabled && (
                  <>
                    <div className="mt-3 flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2">
                      <code className="min-w-0 flex-1 truncate text-xs text-cyan-300">{shareUrl(selectedForm.share_token)}</code>
                      <button type="button" onClick={copyShareLink} className="flex items-center gap-1 rounded-lg bg-white/10 px-2 py-1 text-xs text-white hover:bg-white/20">
                        {copyState === 'copied' ? <Check className="h-3.5 w-3.5 text-emerald-300" /> : <Copy className="h-3.5 w-3.5" />}
                        {copyState === 'copied' ? 'Copied' : 'Copy'}
                      </button>
                      <button type="button" onClick={shareLink} className="flex items-center gap-1 rounded-lg bg-cyan-600 px-2 py-1 text-xs text-white hover:bg-cyan-500">
                        <Share2 className="h-3.5 w-3.5" /> Share
                      </button>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-4 rounded-lg border border-white/10 bg-slate-900/60 p-3">
                      <div className="rounded-lg bg-white p-2">
                        <QRCodeSVG value={shareUrl(selectedForm.share_token)} size={104} />
                      </div>
                      <div className="min-w-0 flex-1 space-y-2">
                        <p className="text-xs text-slate-400">
                          Patients can scan this to open and fill out the form on their own phone — no link needed. Print it at reception or put it on a sign.
                        </p>
                        <button type="button" onClick={downloadShareQr} className="flex items-center gap-1.5 rounded-lg border border-white/15 px-2.5 py-1.5 text-xs text-slate-200 hover:bg-white/5">
                          <Download className="h-3.5 w-3.5" /> Download QR (PDF)
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>

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

                  <div className="space-y-1.5">
                    {fields.length === 0 && (
                      <p className="rounded-xl border border-dashed border-white/15 p-4 text-center text-xs text-slate-400">
                        No fields yet — use a preset above, or add your own below.
                      </p>
                    )}
                    {fields.map((f, index) => (
                      f.field_type === 'section' ? (
                        <div key={f.id} className="flex items-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-400/5 px-3 py-2">
                          <div className="flex flex-col">
                            <button type="button" onClick={() => moveField(index, -1)} disabled={index === 0} className="text-slate-400 hover:text-white disabled:opacity-20"><ChevronUp className="h-3.5 w-3.5" /></button>
                            <button type="button" onClick={() => moveField(index, 1)} disabled={index === fields.length - 1} className="text-slate-400 hover:text-white disabled:opacity-20"><ChevronDown className="h-3.5 w-3.5" /></button>
                          </div>
                          <p className="min-w-0 flex-1 truncate text-sm font-bold uppercase tracking-wide text-emerald-200">{f.label}</p>
                          <span className="rounded-full bg-emerald-400/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">Section</span>
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
                          <button type="button" onClick={() => removeField(f)} className="text-red-400 hover:text-red-300"><Trash2 className="h-4 w-4" /></button>
                        </div>
                      )
                    ))}
                  </div>

                  <form onSubmit={submitField} className="space-y-2 rounded-xl border border-white/10 bg-white/5 p-4">
                    <p className="flex items-center gap-1.5 text-sm font-semibold text-white"><Plus className="h-4 w-4 text-cyan-300" /> Add a custom field</p>
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
                      <div className="grid gap-2 sm:grid-cols-3">
                        <input required value={walkIn.name} onChange={(e) => setWalkIn((w) => ({ ...w, name: e.target.value }))} placeholder="Patient name *" className="rounded-lg bg-slate-900 px-3 py-2 text-sm text-white" />
                        <input value={walkIn.phone} onChange={(e) => setWalkIn((w) => ({ ...w, phone: e.target.value }))} placeholder="Phone" className="rounded-lg bg-slate-900 px-3 py-2 text-sm text-white" />
                        <input value={walkIn.email} onChange={(e) => setWalkIn((w) => ({ ...w, email: e.target.value }))} placeholder="Email" className="rounded-lg bg-slate-900 px-3 py-2 text-sm text-white" />
                      </div>
                      {fields.map((f) => (
                        f.field_type === 'section' ? (
                          <p key={f.id} className="pt-2 text-xs font-bold uppercase tracking-wide text-cyan-300 border-t border-white/10 first:border-t-0 first:pt-0">{f.label}</p>
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
                      <div className="flex gap-2">
                        <button type="button" onClick={() => setRecording(false)} className="rounded-lg border border-white/15 px-4 py-2 text-sm text-slate-300">Cancel</button>
                        <button disabled={savingWalkIn || !walkIn.name.trim()} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
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
                              <p className="text-xs text-slate-400">{new Date(s.created_at).toLocaleString()} · {s.submitted_via === 'public_link' ? 'Public link' : 'Recorded by staff'}</p>
                            </div>
                            {viewingSubmissionId === s.id ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
                          </button>
                          {viewingSubmissionId === s.id && (
                            <div className="mt-3 space-y-2 border-t border-white/10 pt-3">
                              {(s.patient_phone || s.patient_email) && (
                                <p className="text-xs text-slate-400">{[s.patient_phone, s.patient_email].filter(Boolean).join(' · ')}</p>
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
