import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Download, FileWarning, Loader, Printer } from 'lucide-react';
import { getPublicConsultationForm, submitPublicConsultationForm } from '../services/cmmsConsultationFormService';
import { downloadPublicConsultationSubmissionPdf } from '../utils/generateConsultationFormPdf';
import { sectionDisplayLabel } from '../utils/consultationSubmissionUtils';

// Same scoped-palette technique as PublicReportExportViewer.jsx (see that
// file for the full reasoning): this page has no ICAN session and no app
// theme to inherit, so it owns its own light/dark palette instead of stock
// Tailwind color classes. A "clear form" for a patient filling this out
// unattended calls for the light-first version of that palette.
const CF_STYLES = `
.icanera-cf {
  --cf-bg: #f6f9f7; --cf-surface: #ffffff; --cf-surface-alt: #eef3f0;
  --cf-text: #16211b; --cf-text-muted: #56675d; --cf-text-faint: #8a9a90;
  --cf-border: #dbe6de; --cf-green: #166534; --cf-green-hover: #114f28;
  --cf-maroon: #7a1f2b;
}
@media (prefers-color-scheme: dark) {
  .icanera-cf {
    --cf-bg: #0f1613; --cf-surface: #17211c; --cf-surface-alt: #202b24;
    --cf-text: #eef4f0; --cf-text-muted: #a9baaf; --cf-text-faint: #7c8d82;
    --cf-border: #2b3830; --cf-green: #4ade80; --cf-green-hover: #22c55e;
    --cf-maroon: #e5828d;
  }
}
.icanera-cf { background: var(--cf-bg); color: var(--cf-text); }
.cf-surface { background: var(--cf-surface); border: 1px solid var(--cf-border); }
.cf-text-muted { color: var(--cf-text-muted); }
.cf-text-faint { color: var(--cf-text-faint); }
.cf-input { background: var(--cf-surface-alt); border: 1px solid var(--cf-border); color: var(--cf-text); }
.cf-btn { background: var(--cf-green); color: #ffffff; }
.cf-btn:hover { background: var(--cf-green-hover); }
.cf-wordmark-a { color: var(--cf-green); }
.cf-wordmark-b { color: var(--cf-text); }
`;

const IcanEraWordmark = () => (
  <span className="font-bold tracking-tight">
    <span className="cf-wordmark-a">Ican</span><span className="cf-wordmark-b">Era</span>
  </span>
);

const CenteredCard = ({ icon: Icon, title, subtitle, children }) => (
  <div className="icanera-cf min-h-screen flex items-center justify-center p-6">
    <style>{CF_STYLES}</style>
    <div className="cf-surface rounded-2xl shadow-sm p-8 w-full max-w-md text-center">
      {Icon && (
        <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: 'var(--cf-surface-alt)' }}>
          <Icon className="w-7 h-7" style={{ color: 'var(--cf-green)' }} />
        </div>
      )}
      <h1 className="text-lg font-bold mb-1">{title}</h1>
      {subtitle && <p className="cf-text-muted text-sm mb-3">{subtitle}</p>}
      {children}
    </div>
  </div>
);

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Same window.open + document.write(...) + window.onload=print pattern used
// throughout CMMS (see CMSSModule.jsx's report exports and
// CMMSConsultationForms.jsx) so a patient can keep/print a copy of what
// they just submitted.
const printSubmittedAnswers = (form, patient, responses) => {
  const rows = (form.fields || []).map((f) => {
    if (f.fieldType === 'section') return `<div class="section-heading">${escapeHtml(sectionDisplayLabel(form.fields, f))}</div>`;
    const value = responses[f.fieldKey];
    const text = f.fieldType === 'checkbox' ? (value ? 'Yes' : 'No') : Array.isArray(value) ? (value.join(', ') || '—') : (value || '—');
    return `<div class="field"><div class="label">${escapeHtml(f.label)}</div><div class="answer">${escapeHtml(text)}</div></div>`;
  }).join('');
  const printWindow = window.open('', '_blank', 'noopener,noreferrer');
  if (!printWindow) { alert('Allow pop-ups to print this form.'); return; }
  printWindow.document.write(`<!doctype html><html><head><title>${escapeHtml(form.businessName || 'Clinic')} — ${escapeHtml(form.formName)}</title><style>
    body{font-family:Arial,sans-serif;max-width:720px;margin:32px auto;color:#111;line-height:1.6}
    h1{margin-bottom:2px;font-size:20px}
    .subtitle{color:#555;font-size:13px;margin-bottom:22px;border-bottom:1px solid #ddd;padding-bottom:14px}
    .field{margin-bottom:14px;page-break-inside:avoid}
    .field .label{font-weight:bold;font-size:13px;margin-bottom:2px}
    .field .answer{font-size:13px;white-space:pre-wrap}
    .section-heading{margin:22px 0 12px;font-size:14px;font-weight:bold;color:#111;border-bottom:2px solid #333;padding-bottom:4px;page-break-after:avoid}
    .section-heading:first-of-type{margin-top:4px}
    @media print{body{margin:18px}}
  </style></head><body><h1>${escapeHtml(form.businessName || 'Clinic')}</h1>
  <div class="subtitle">${escapeHtml(form.formName)}<br>Patient: ${escapeHtml(patient.name)}${patient.phone ? ' · ' + escapeHtml(patient.phone) : ''}<br>Submitted: ${escapeHtml(new Date().toLocaleString())}</div>
  ${rows}<script>window.onload=()=>window.print()</script></body></html>`);
  printWindow.document.close();
};

const FieldControl = ({ field, value, onChange }) => {
  const common = 'cf-input w-full rounded-xl px-4 py-2.5 focus:outline-none';
  if (field.fieldType === 'textarea') return <textarea required={field.isRequired} value={value || ''} onChange={(e) => onChange(e.target.value)} rows={3} className={common} />;
  if (field.fieldType === 'date') return <input required={field.isRequired} type="date" value={value || ''} onChange={(e) => onChange(e.target.value)} className={common} />;
  if (field.fieldType === 'number') return <input required={field.isRequired} type="number" value={value ?? ''} onChange={(e) => onChange(e.target.value)} className={common} />;
  if (field.fieldType === 'checkbox') {
    return (
      <label className="flex items-center gap-2 text-sm">
        <input required={field.isRequired} type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} /> Yes
      </label>
    );
  }
  if (field.fieldType === 'select') {
    return (
      <select required={field.isRequired} value={value || ''} onChange={(e) => onChange(e.target.value)} className={common}>
        <option value="">Select…</option>
        {(field.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  if (field.fieldType === 'multiselect') {
    const selected = Array.isArray(value) ? value : [];
    const toggle = (opt) => onChange(selected.includes(opt) ? selected.filter((o) => o !== opt) : [...selected, opt]);
    return (
      <div className="flex flex-wrap gap-1.5">
        {(field.options || []).map((o) => (
          <button
            key={o} type="button" onClick={() => toggle(o)}
            className="rounded-full border px-3 py-1 text-xs"
            style={selected.includes(o) ? { background: 'var(--cf-green)', color: '#fff', borderColor: 'var(--cf-green)' } : { borderColor: 'var(--cf-border)' }}
          >
            {o}
          </button>
        ))}
      </div>
    );
  }
  return <input required={field.isRequired} value={value || ''} onChange={(e) => onChange(e.target.value)} className={common} />;
};

// Anonymous, unauthenticated patient-facing consultation form — reached via
// the public link a clinic toggles on in CMMSConsultationForms.jsx
// (/consultation-forms/:shareToken, see main.jsx).
// A patient filling this out unattended can get interrupted — a call, a
// dropped connection, an accidental tab close — so progress is kept in
// localStorage per share link (never sent anywhere) and offered back the
// next time this same token loads, cleared the moment a submit succeeds.
const draftStorageKey = (shareToken) => `icanera-consultation-draft-${shareToken}`;

const PublicConsultationFormViewer = ({ shareToken }) => {
  const [status, setStatus] = useState('loading'); // loading | invalid | ready | submitting | submitted
  const [form, setForm] = useState(null);
  const [patient, setPatient] = useState({ name: '', phone: '', email: '' });
  const [responses, setResponses] = useState({});
  const [error, setError] = useState('');
  const [draftRestored, setDraftRestored] = useState(false);
  const draftLoadedRef = useRef(false);

  useEffect(() => {
    (async () => {
      const result = await getPublicConsultationForm(shareToken);
      if (!result.success || !result.data) { setStatus('invalid'); return; }
      setForm(result.data);
      try {
        const saved = JSON.parse(localStorage.getItem(draftStorageKey(shareToken)) || 'null');
        if (saved && (saved.patient?.name || Object.keys(saved.responses || {}).length)) {
          setPatient((p) => ({ ...p, ...saved.patient }));
          setResponses(saved.responses || {});
          setDraftRestored(true);
        }
      } catch { /* private-browsing / blocked storage — just start blank */ }
      draftLoadedRef.current = true;
      setStatus('ready');
    })();
  }, [shareToken]);

  useEffect(() => {
    if (!draftLoadedRef.current || status === 'submitted') return;
    try { localStorage.setItem(draftStorageKey(shareToken), JSON.stringify({ patient, responses })); } catch { /* ignore */ }
  }, [shareToken, patient, responses, status]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setStatus('submitting');
    const result = await submitPublicConsultationForm(shareToken, {
      patientName: patient.name, patientPhone: patient.phone, patientEmail: patient.email, responses
    });
    if (!result.success) {
      setError(result.error || 'Could not submit this form. Please try again.');
      setStatus('ready');
      return;
    }
    try { localStorage.removeItem(draftStorageKey(shareToken)); } catch { /* ignore */ }
    setStatus('submitted');
  };

  const downloadOwnCopy = () => {
    try {
      downloadPublicConsultationSubmissionPdf({ form, patient, responses });
    } catch (err) {
      console.error('Unable to create the submission PDF:', err);
    }
  };

  if (status === 'loading') {
    return (
      <div className="icanera-cf min-h-screen flex items-center justify-center">
        <style>{CF_STYLES}</style>
        <Loader className="w-8 h-8 animate-spin" style={{ color: 'var(--cf-green)' }} />
      </div>
    );
  }

  if (status === 'invalid') {
    return (
      <CenteredCard icon={FileWarning} title="This link is invalid or no longer available">
        <p className="cf-text-muted text-sm">Ask the clinic for a new link.</p>
      </CenteredCard>
    );
  }

  if (status === 'submitted') {
    return (
      <CenteredCard icon={CheckCircle2} title="Thank you" subtitle={`Your ${form.formName.toLowerCase()} has been submitted to ${form.businessName || 'the clinic'}.`}>
        <div className="space-y-2">
          <button type="button" onClick={downloadOwnCopy} className="cf-btn w-full px-4 py-2 rounded-lg flex items-center justify-center gap-2">
            <Download size={16} /> Download PDF copy
          </button>
          <button type="button" onClick={() => printSubmittedAnswers(form, patient, responses)} className="cf-input w-full px-4 py-2 rounded-lg flex items-center justify-center gap-2">
            <Printer size={16} /> Print a copy
          </button>
        </div>
      </CenteredCard>
    );
  }

  // status === 'ready' | 'submitting'
  return (
    <div className="icanera-cf min-h-screen">
      <style>{CF_STYLES}</style>
      <div className="max-w-xl mx-auto px-4 py-10">
        <p className="cf-text-faint text-xs uppercase tracking-wide mb-1">{form.businessName}</p>
        <h1 className="text-2xl font-bold mb-1">{form.formName}</h1>
        {form.formDescription && <p className="cf-text-muted text-sm mb-4">{form.formDescription}</p>}
        {draftRestored && (
          <p className="cf-text-muted text-xs mb-4 flex items-center gap-1.5">
            <span style={{ color: 'var(--cf-green)' }}>●</span> Picked up where you left off — your answers were saved on this device.
          </p>
        )}

        <form onSubmit={handleSubmit} className="cf-surface rounded-2xl p-6 space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold mb-1 cf-text-muted">Full name *</label>
              <input required value={patient.name} onChange={(e) => setPatient((p) => ({ ...p, name: e.target.value }))} className="cf-input w-full rounded-xl px-4 py-2.5 focus:outline-none" />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1 cf-text-muted">Phone</label>
              <input value={patient.phone} onChange={(e) => setPatient((p) => ({ ...p, phone: e.target.value }))} className="cf-input w-full rounded-xl px-4 py-2.5 focus:outline-none" />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1 cf-text-muted">Email</label>
              <input type="email" value={patient.email} onChange={(e) => setPatient((p) => ({ ...p, email: e.target.value }))} className="cf-input w-full rounded-xl px-4 py-2.5 focus:outline-none" />
            </div>
          </div>

          {form.fields.map((field) => (
            field.fieldType === 'section' ? (
              <div key={field.id} className="pt-2 first:pt-0">
                <p className="text-sm font-bold uppercase tracking-wide" style={{ color: 'var(--cf-green)' }}>{sectionDisplayLabel(form.fields, field)}</p>
                <div className="mt-2 border-t" style={{ borderColor: 'var(--cf-border)' }} />
              </div>
            ) : (
              <div key={field.id}>
                <label className="block text-xs font-semibold mb-1 cf-text-muted">
                  {field.label}{field.isRequired && <span style={{ color: 'var(--cf-maroon)' }}> *</span>}
                </label>
                <FieldControl
                  field={field}
                  value={responses[field.fieldKey]}
                  onChange={(value) => setResponses((r) => ({ ...r, [field.fieldKey]: value }))}
                />
              </div>
            )
          ))}

          {error && <p className="text-sm" style={{ color: 'var(--cf-maroon)' }}>{error}</p>}

          <button type="submit" disabled={status === 'submitting'} className="cf-btn w-full px-4 py-2.5 rounded-xl font-semibold disabled:opacity-50 flex items-center justify-center gap-2">
            {status === 'submitting' ? <Loader size={16} className="animate-spin" /> : null}
            {status === 'submitting' ? 'Submitting…' : 'Submit'}
          </button>
        </form>

        <footer className="text-center text-xs cf-text-faint pt-10 pb-6">
          Powered by <IcanEraWordmark />
        </footer>
      </div>
    </div>
  );
};

export default PublicConsultationFormViewer;
