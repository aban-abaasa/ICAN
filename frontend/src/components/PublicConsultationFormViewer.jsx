import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Download, FileWarning, Loader, Moon, Printer, Sun } from 'lucide-react';
import { getPublicConsultationForm, submitPublicConsultationForm } from '../services/cmmsConsultationFormService';
import { resolveAttachmentUrls } from '../services/cmmsConsultationAttachmentService';
import { downloadPublicConsultationSubmissionPdf } from '../utils/generateConsultationFormPdf';
import { sectionDisplayLabel } from '../utils/consultationSubmissionUtils';
import { cleanAttachments, formatReferenceCode, recordQrPayload, recordReferenceCode } from '../utils/consultationAttachments';
import { loadLogoAsset, makeQrDataUrl, useResolvedLogo } from '../utils/consultationBranding';
import { normalizeFormSettings, resolveAttachmentLabels, resolveAttachmentPrompt } from '../utils/consultationFormSettings';
import { attachmentsHtml, closePrintShell, escapeHtml, fillPrintShell, letterheadHtml, openPrintShell } from '../utils/consultationPrint';
import ConsultationAttachmentPicker, { attachmentsToSave, attachmentsUploading } from './ConsultationAttachmentPicker';
import LoadingPage from './LoadingPage';

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
/* System preference applies only when the visitor hasn't explicitly
   picked a mode with the toggle button below; an explicit choice
   ([data-theme]) always wins, in both directions. */
@media (prefers-color-scheme: dark) {
  .icanera-cf:not([data-theme="light"]) {
    --cf-bg: #0f1613; --cf-surface: #17211c; --cf-surface-alt: #202b24;
    --cf-text: #eef4f0; --cf-text-muted: #a9baaf; --cf-text-faint: #7c8d82;
    --cf-border: #2b3830; --cf-green: #4ade80; --cf-green-hover: #22c55e;
    --cf-maroon: #e5828d;
  }
}
.icanera-cf[data-theme="dark"] {
  --cf-bg: #0f1613; --cf-surface: #17211c; --cf-surface-alt: #202b24;
  --cf-text: #eef4f0; --cf-text-muted: #a9baaf; --cf-text-faint: #7c8d82;
  --cf-border: #2b3830; --cf-green: #4ade80; --cf-green-hover: #22c55e;
  --cf-maroon: #e5828d;
}
.icanera-cf { background: var(--cf-bg); color: var(--cf-text); }
.icanera-cf, .cf-surface, .cf-input, .cf-btn, .cf-theme-toggle {
  transition: background-color 0.25s ease, color 0.25s ease, border-color 0.25s ease;
}
.cf-surface { background: var(--cf-surface); border: 1px solid var(--cf-border); }
.cf-text-muted { color: var(--cf-text-muted); }
.cf-text-faint { color: var(--cf-text-faint); }
.cf-input { background: var(--cf-surface-alt); border: 1px solid var(--cf-border); color: var(--cf-text); }
.cf-btn { background: var(--cf-green); color: #ffffff; }
.cf-btn:hover { background: var(--cf-green-hover); }
.cf-wordmark-a { color: var(--cf-green); }
.cf-wordmark-b { color: var(--cf-text); }
.cf-theme-toggle { background: var(--cf-surface-alt); border: 1px solid var(--cf-border); color: var(--cf-text-muted); }
.cf-theme-toggle:hover { color: var(--cf-text); }
@keyframes cf-fade-in-up { from { opacity: 0; transform: translateY(-10px); } to { opacity: 1; transform: translateY(0); } }
.cf-business-name { animation: cf-fade-in-up 0.55s cubic-bezier(0.16, 1, 0.3, 1) both; }
.cf-logo { background: #ffffff; border: 1px solid var(--cf-border); object-fit: contain; animation: cf-fade-in-up 0.55s cubic-bezier(0.16, 1, 0.3, 1) both; }
.cf-pass { background: var(--cf-surface-alt); border: 1px dashed var(--cf-border); }
.cf-pass-qr { background: #ffffff; padding: 8px; border-radius: 14px; border: 1px solid var(--cf-border); }
`;

const IcanEraWordmark = () => (
  <span className="font-bold tracking-tight">
    <span className="cf-wordmark-a">Ican</span><span className="cf-wordmark-b">Era</span>
  </span>
);

const ThemeToggle = ({ theme, onToggle, className = '' }) => (
  <button
    type="button" onClick={onToggle} aria-label="Toggle light/dark mode"
    className={`cf-theme-toggle flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${className}`}
  >
    {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
  </button>
);

const CenteredCard = ({ icon: Icon, title, subtitle, theme, onToggleTheme, children }) => (
  <div className="icanera-cf relative min-h-screen flex items-center justify-center p-6" data-theme={theme}>
    <style>{CF_STYLES}</style>
    {onToggleTheme && <ThemeToggle theme={theme} onToggle={onToggleTheme} className="absolute top-4 right-4" />}
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

// The patient's own printable copy of what they just submitted: letterhead with
// the clinic's logo and the record's reference QR, their answers, and their
// attachments. The window opens first (synchronously, inside the click) and is
// filled in once the logo / QR / photos are ready.
const printSubmittedAnswers = async (form, settings, patient, responses, attachments, submissionId, logoUrl) => {
  const win = openPrintShell();
  if (!win) return;
  try {
    const { image: logoImage } = await loadLogoAsset(settings.showLogo ? form.businessLogo : null);
    const qrDataUrl = settings.showQr && submissionId ? await makeQrDataUrl(recordQrPayload(submissionId), { logo: logoImage }) : '';
    const resolvedAttachments = await resolveAttachmentUrls(attachments);
    const rows = (form.fields || []).map((f) => {
      if (f.fieldType === 'section') return `<div class="section-heading">${escapeHtml(sectionDisplayLabel(form.fields, f))}</div>`;
      const value = responses[f.fieldKey];
      const text = f.fieldType === 'checkbox' ? (value ? 'Yes' : 'No') : Array.isArray(value) ? (value.join(', ') || '—') : (value || '—');
      return `<div class="field"><div class="label">${escapeHtml(f.label)}</div><div class="answer">${escapeHtml(text)}</div></div>`;
    }).join('');
    const details = `${escapeHtml(form.formName)}<br>Patient: ${escapeHtml(patient.name)}${patient.phone ? ' · ' + escapeHtml(patient.phone) : ''}${patient.dob ? ' · DOB ' + escapeHtml(patient.dob) : ''}${patient.address ? '<br>Address: ' + escapeHtml(patient.address) : ''}<br>Submitted: ${escapeHtml(new Date().toLocaleString())}`;
    fillPrintShell(
      win,
      `${form.businessName || 'Clinic'} — ${form.formName}`,
      `${letterheadHtml({
        businessName: form.businessName, logoUrl: settings.showLogo ? (logoUrl || logoImage?.dataUrl || '') : '', detailsHtml: details,
        qrDataUrl, qrCaption: qrDataUrl ? 'Show this at reception' : '', qrCode: qrDataUrl ? formatReferenceCode(recordReferenceCode(submissionId)) : ''
      })}${rows}${attachmentsHtml(resolvedAttachments)}`
    );
  } catch (err) {
    console.error('Unable to prepare the printable copy:', err);
    closePrintShell(win);
  }
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
  const [patient, setPatient] = useState({ name: '', phone: '', email: '', address: '', dob: '' });
  const [responses, setResponses] = useState({});
  const [error, setError] = useState('');
  const [draftRestored, setDraftRestored] = useState(false);
  const [attachments, setAttachments] = useState([]);
  const [submissionId, setSubmissionId] = useState(null);
  const [pass, setPass] = useState({ qr: '', code: '' }); // the "show this at reception" QR
  const draftLoadedRef = useRef(false);
  // The business owner's per-form options (logo / QR codes / attachments) arrive with the form.
  const settings = normalizeFormSettings(form?.settings);
  const logoUrl = useResolvedLogo(settings.showLogo ? form?.businessLogo : null);

  // Resolved once at mount from a saved choice or the device's own
  // light/dark setting, then explicit from then on — the toggle button
  // below just flips it, no three-way "system" state to reason about.
  const [theme, setTheme] = useState(() => {
    try {
      const saved = localStorage.getItem('icanera-cf-theme');
      if (saved === 'light' || saved === 'dark') return saved;
    } catch { /* ignore */ }
    return (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
  });
  const toggleTheme = () => {
    setTheme((current) => {
      const next = current === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem('icanera-cf-theme', next); } catch { /* ignore */ }
      return next;
    });
  };

  useEffect(() => {
    (async () => {
      const result = await getPublicConsultationForm(shareToken);
      if (!result.success || !result.data) { setStatus('invalid'); return; }
      setForm(result.data);
      try {
        const saved = JSON.parse(localStorage.getItem(draftStorageKey(shareToken)) || 'null');
        if (saved && (saved.patient?.name || Object.keys(saved.responses || {}).length || saved.attachments?.length)) {
          setPatient((p) => ({ ...p, ...saved.patient }));
          setResponses(saved.responses || {});
          // Files already uploaded stay attached; the picker re-fetches their thumbnails.
          if (normalizeFormSettings(result.data.settings).allowAttachments) {
            setAttachments(cleanAttachments(saved.attachments).map((a, i) => ({ ...a, id: `restored_${i}`, status: 'done' })));
          }
          setDraftRestored(true);
        }
      } catch { /* private-browsing / blocked storage — just start blank */ }
      draftLoadedRef.current = true;
      setStatus('ready');
    })();
  }, [shareToken]);

  useEffect(() => {
    if (!draftLoadedRef.current || status === 'submitted') return;
    try {
      localStorage.setItem(draftStorageKey(shareToken), JSON.stringify({ patient, responses, attachments: cleanAttachments(attachmentsToSave(attachments)) }));
    } catch { /* ignore */ }
  }, [shareToken, patient, responses, attachments, status]);

  const savedAttachments = settings.allowAttachments ? cleanAttachments(attachmentsToSave(attachments)) : [];

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (attachmentsUploading(attachments)) { setError('Please wait for your files to finish uploading.'); return; }
    if (settings.allowAttachments && settings.attachmentsRequired && !savedAttachments.length) {
      setError('Please attach at least one photo or document.');
      return;
    }
    setError('');
    setStatus('submitting');
    const result = await submitPublicConsultationForm(shareToken, {
      patientName: patient.name, patientPhone: patient.phone, patientEmail: patient.email,
      patientAddress: patient.address, patientDob: patient.dob, responses, attachments: savedAttachments
    });
    if (!result.success) {
      setError(result.error || 'Could not submit this form. Please try again.');
      setStatus('ready');
      return;
    }
    try { localStorage.removeItem(draftStorageKey(shareToken)); } catch { /* ignore */ }
    setSubmissionId(result.submissionId);
    setStatus('submitted');
  };

  // The check-in pass: once submitted, the patient gets a QR (their record's reference
  // code, with the clinic's logo in its centre) that reception can scan or read out.
  useEffect(() => {
    if (status !== 'submitted' || !submissionId || !settings.showQr) return undefined;
    let cancelled = false;
    (async () => {
      const { image } = await loadLogoAsset(settings.showLogo ? form.businessLogo : null);
      const qr = await makeQrDataUrl(recordQrPayload(submissionId), { logo: image, size: 520 });
      if (!cancelled) setPass({ qr, code: formatReferenceCode(recordReferenceCode(submissionId)) });
    })().catch(() => {});
    return () => { cancelled = true; };
  }, [status, submissionId, form, settings.showQr, settings.showLogo]);

  const [downloading, setDownloading] = useState(false);
  const downloadOwnCopy = async () => {
    setDownloading(true);
    try {
      await downloadPublicConsultationSubmissionPdf({
        form, patient, responses, attachments: savedAttachments, submissionId,
        logoRaw: settings.showLogo ? form.businessLogo : null, showQr: settings.showQr
      });
    } catch (err) {
      console.error('Unable to create the submission PDF:', err);
    }
    setDownloading(false);
  };

  if (status === 'loading') {
    return <LoadingPage tone={theme === 'dark' ? 'dark' : 'light'} label="Opening the form…" />;
  }

  if (status === 'invalid') {
    return (
      <CenteredCard icon={FileWarning} title="This link is invalid or no longer available" theme={theme} onToggleTheme={toggleTheme}>
        <p className="cf-text-muted text-sm">Ask the clinic for a new link.</p>
      </CenteredCard>
    );
  }

  if (status === 'submitted') {
    return (
      <div className="icanera-cf relative min-h-screen flex items-center justify-center p-6" data-theme={theme}>
        <style>{CF_STYLES}</style>
        <ThemeToggle theme={theme} onToggle={toggleTheme} className="absolute top-4 right-4" />
        <div className="cf-surface rounded-2xl shadow-sm p-8 w-full max-w-md text-center">
          {logoUrl ? (
            <img src={logoUrl} alt="" className="cf-logo w-16 h-16 rounded-2xl mx-auto mb-4" />
          ) : (
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: 'var(--cf-surface-alt)' }}>
              <CheckCircle2 className="w-7 h-7" style={{ color: 'var(--cf-green)' }} />
            </div>
          )}
          <h1 className="text-lg font-bold mb-1 flex items-center justify-center gap-1.5">
            {logoUrl && <CheckCircle2 size={18} style={{ color: 'var(--cf-green)' }} />} Thank you
          </h1>
          <p className="cf-text-muted text-sm mb-4">{`Your ${form.formName.toLowerCase()} has been submitted to ${form.businessName || 'the clinic'}.`}</p>

          {pass.qr && (
            <div className="cf-pass rounded-2xl p-4 mb-4">
              <p className="text-xs font-semibold uppercase tracking-wide cf-text-muted mb-2">Your check-in pass</p>
              <img src={pass.qr} alt="Your record QR code" className="cf-pass-qr w-40 h-40 mx-auto" />
              <p className="mt-2 font-mono text-lg font-bold tracking-widest">{pass.code}</p>
              <p className="cf-text-faint text-xs mt-1">Show this at reception so they can find your record instantly.</p>
            </div>
          )}

          <div className="space-y-2">
            <button type="button" onClick={downloadOwnCopy} disabled={downloading} className="cf-btn w-full px-4 py-2 rounded-lg flex items-center justify-center gap-2 disabled:opacity-60">
              {downloading ? <Loader size={16} className="animate-spin" /> : <Download size={16} />} Download PDF copy
            </button>
            <button type="button" onClick={() => printSubmittedAnswers(form, settings, patient, responses, savedAttachments, submissionId, logoUrl)} className="cf-input w-full px-4 py-2 rounded-lg flex items-center justify-center gap-2">
              <Printer size={16} /> Print a copy
            </button>
          </div>
        </div>
      </div>
    );
  }

  // status === 'ready' | 'submitting'
  const leadingSection = form.fields[0]?.fieldType === 'section' ? form.fields[0] : null;
  const remainingFields = leadingSection ? form.fields.slice(1) : form.fields;
  return (
    <div className="icanera-cf min-h-screen" data-theme={theme}>
      <style>{CF_STYLES}</style>
      <div className="max-w-xl mx-auto px-4 py-10">
        <div className="flex items-start justify-between gap-3 mb-1">
          <div className="flex min-w-0 items-center gap-3">
            {logoUrl && <img src={logoUrl} alt="" className="cf-logo w-14 h-14 sm:w-16 sm:h-16 rounded-2xl shrink-0" />}
            <p className="cf-business-name text-3xl sm:text-4xl font-extrabold tracking-tight leading-tight">{form.businessName}</p>
          </div>
          <ThemeToggle theme={theme} onToggle={toggleTheme} className="mt-1" />
        </div>
        <h1 className="text-base sm:text-lg font-semibold cf-text-muted mb-1">{form.formName}</h1>
        {form.formDescription && <p className="cf-text-muted text-sm mb-4">{form.formDescription}</p>}
        {draftRestored && (
          <p className="cf-text-muted text-xs mb-4 flex items-center gap-1.5">
            <span style={{ color: 'var(--cf-green)' }}>●</span> Picked up where you left off — your answers were saved on this device.
          </p>
        )}

        <form onSubmit={handleSubmit} className="cf-surface rounded-2xl p-6 space-y-5">
          {/* Full name/phone/email are always collected (they're the
              submission's own patient_name/phone/email columns, not a
              custom field) — when the form's very first field is a section
              header, that heading is shown here, above them, so it reads as
              the umbrella for the whole top block (name through whatever
              else that section covers) instead of floating apart from it. */}
          {leadingSection && (
            <div>
              <p className="text-sm font-bold uppercase tracking-wide" style={{ color: 'var(--cf-green)' }}>{sectionDisplayLabel(form.fields, leadingSection)}</p>
              <div className="mt-2 border-t" style={{ borderColor: 'var(--cf-border)' }} />
            </div>
          )}
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
            <div>
              <label className="block text-xs font-semibold mb-1 cf-text-muted">Date of birth</label>
              <input type="date" value={patient.dob} onChange={(e) => setPatient((p) => ({ ...p, dob: e.target.value }))} className="cf-input w-full rounded-xl px-4 py-2.5 focus:outline-none" />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold mb-1 cf-text-muted">Address</label>
              <input value={patient.address} onChange={(e) => setPatient((p) => ({ ...p, address: e.target.value }))} className="cf-input w-full rounded-xl px-4 py-2.5 focus:outline-none" />
            </div>
          </div>

          {remainingFields.map((field) => (
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

          {settings.allowAttachments && (
            <div className="pt-2">
              <div className="mb-3 border-t" style={{ borderColor: 'var(--cf-border)' }} />
              <ConsultationAttachmentPicker
                items={attachments} onItemsChange={setAttachments} variant="public" guest max={settings.attachmentMax}
                labels={resolveAttachmentLabels(settings)} required={settings.attachmentsRequired}
                title={`${resolveAttachmentPrompt(settings)}${settings.attachmentsRequired ? '' : ' (optional)'}`}
              />
            </div>
          )}

          {error && <p className="text-sm" style={{ color: 'var(--cf-maroon)' }}>{error}</p>}

          <button type="submit" disabled={status === 'submitting' || attachmentsUploading(attachments)} className="cf-btn w-full px-4 py-2.5 rounded-xl font-semibold disabled:opacity-50 flex items-center justify-center gap-2">
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
