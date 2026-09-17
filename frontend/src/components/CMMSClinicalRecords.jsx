import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Download, FileText, Loader, Printer, Search } from 'lucide-react';
import { listAllConsultationSubmissions, listConsultationForms, listConsultationFields } from '../services/cmmsConsultationFormService';
import { downloadConsultationSubmissionPdf } from '../utils/generateConsultationFormPdf';
import { submissionEntries, formatAnswer } from '../utils/consultationSubmissionUtils';

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Same window.open + document.write(...) + window.onload=print pattern used
// throughout CMMS (see CMMSConsultationForms.jsx) so printing behaves the
// same way everywhere.
const openPrintWindow = (title, bodyHtml) => {
  const printWindow = window.open('', '_blank', 'noopener,noreferrer');
  if (!printWindow) { alert('Allow pop-ups to print this record.'); return; }
  printWindow.document.write(`<!doctype html><html><head><title>${escapeHtml(title)}</title><style>
    body{font-family:Arial,sans-serif;max-width:720px;margin:32px auto;color:#111;line-height:1.6}
    h1{margin-bottom:2px;font-size:20px}
    .subtitle{color:#555;font-size:13px;margin-bottom:22px;border-bottom:1px solid #ddd;padding-bottom:14px}
    .field{margin-bottom:16px;page-break-inside:avoid}
    .field .label{font-weight:bold;font-size:13px;margin-bottom:4px}
    .field .answer{font-size:13px;white-space:pre-wrap;border-bottom:1px solid #999;min-height:18px;padding-bottom:4px}
    .section-heading{margin:26px 0 14px;font-size:14px;font-weight:bold;color:#111;border-bottom:2px solid #333;padding-bottom:4px;page-break-after:avoid}
    .section-heading:first-of-type{margin-top:4px}
    .meta{color:#555;font-size:11px;margin-top:28px;border-top:1px solid #ddd;padding-top:10px}
    @media print{body{margin:18px}}
  </style></head><body>${bodyHtml}<script>window.onload=()=>window.print()</script></body></html>`);
  printWindow.document.close();
};

// CMMS Clinical Operations — "Records" sub-tab (alongside Activity Log and
// Consultation Forms in CMMSClinicalOperationsPanel.jsx). Where
// CMMSConsultationForms.jsx shows one form's submissions at a time, this is
// every patient submission across every consultation form for the
// business, in one searchable list — the record book a clinic actually
// reaches for day to day, regardless of which form a patient filled out.
export default function CMMSClinicalRecords({ businessProfileId, businessName }) {
  const [records, setRecords] = useState([]);
  const [forms, setForms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [formFilter, setFormFilter] = useState('all');
  const [expandedId, setExpandedId] = useState(null);
  const [fieldsByForm, setFieldsByForm] = useState({});
  const [loadingFieldsFor, setLoadingFieldsFor] = useState(null);

  useEffect(() => {
    if (!businessProfileId) return;
    setLoading(true);
    Promise.all([listAllConsultationSubmissions(businessProfileId), listConsultationForms(businessProfileId)]).then(([subs, formsResult]) => {
      if (subs.success) setRecords(subs.data); else setError(subs.error);
      if (formsResult.success) setForms(formsResult.data);
      setLoading(false);
    });
  }, [businessProfileId]);

  const formNameById = useMemo(() => Object.fromEntries(forms.map((f) => [f.id, f.name])), [forms]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return records.filter((r) => {
      if (formFilter !== 'all' && r.form_id !== formFilter) return false;
      if (!q) return true;
      return [r.patient_name, r.patient_phone, r.patient_email, r.form_name_snapshot]
        .some((v) => (v || '').toLowerCase().includes(q));
    });
  }, [records, search, formFilter]);

  const toggleExpand = async (record) => {
    if (expandedId === record.id) { setExpandedId(null); return; }
    setExpandedId(record.id);
    if (record.form_id && !fieldsByForm[record.form_id]) {
      setLoadingFieldsFor(record.form_id);
      const result = await listConsultationFields(record.form_id);
      if (result.success) setFieldsByForm((current) => ({ ...current, [record.form_id]: result.data }));
      setLoadingFieldsFor(null);
    }
  };

  const entriesFor = (record) => submissionEntries(record, fieldsByForm[record.form_id] || []);

  const printRecord = (record) => {
    const entries = entriesFor(record);
    const fieldsHtml = entries.map((entry) => entry.isSection
      ? `<div class="section-heading">${escapeHtml(entry.label)}</div>`
      : `<div class="field"><div class="label">${escapeHtml(entry.label)}</div><div class="answer">${escapeHtml(formatAnswer(entry))}</div></div>`
    ).join('');
    openPrintWindow(
      `${businessName || 'Clinic'} — ${record.patient_name}`,
      `<h1>${escapeHtml(businessName || 'Clinic')}</h1>
       <div class="subtitle">${escapeHtml(record.form_name_snapshot || 'Consultation form')}<br>
       Patient: ${escapeHtml(record.patient_name)}${record.patient_phone ? ' · ' + escapeHtml(record.patient_phone) : ''}${record.patient_email ? ' · ' + escapeHtml(record.patient_email) : ''}<br>
       Submitted: ${escapeHtml(new Date(record.created_at).toLocaleString())} (${record.submitted_via === 'public_link' ? 'via public link' : 'recorded by staff'})</div>
       ${fieldsHtml}
       <div class="meta">Printed ${escapeHtml(new Date().toLocaleString())} · Powered by IcanEra</div>`
    );
  };

  const downloadRecordPdf = (record) => {
    try {
      downloadConsultationSubmissionPdf({
        businessName, formName: record.form_name_snapshot, submission: record, entries: entriesFor(record)
      });
    } catch (err) {
      console.error('Unable to create record PDF:', err);
      setError('Unable to create the PDF. Please try again.');
    }
  };

  return (
    <div className="space-y-4 overflow-x-hidden">
      <div>
        <h2 className="text-2xl font-bold text-white">Records</h2>
        <p className="mt-1 text-sm text-slate-400">
          Every patient submission across every consultation form, in one place — search by name, or filter to one form.
        </p>
      </div>

      {error && <p className="rounded-lg bg-red-500/10 p-3 text-sm text-red-200">{error}</p>}

      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by patient name, phone, or email…"
            className="w-full rounded-lg bg-slate-900 py-2 pl-9 pr-3 text-sm text-white"
          />
        </div>
        <select
          value={formFilter} onChange={(e) => setFormFilter(e.target.value)}
          className="rounded-lg bg-slate-900 px-3 py-2 text-sm text-white"
        >
          <option value="all">All forms</option>
          {forms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-slate-400"><Loader className="h-4 w-4 animate-spin" /> Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-white/15 p-10 text-center text-sm text-slate-400">
          <div>
            <FileText className="mx-auto mb-2 h-7 w-7" />
            {records.length === 0 ? 'No records yet — they will appear here as patients submit any consultation form.' : 'No records match your search.'}
          </div>
        </div>
      ) : (
        <div className="space-y-1.5">
          {filtered.map((record) => (
            <div key={record.id} className="rounded-xl border border-white/10 bg-white/5 p-3">
              <button type="button" onClick={() => toggleExpand(record)} className="flex w-full items-center justify-between gap-3 text-left">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-white">{record.patient_name}</p>
                  <p className="truncate text-xs text-slate-400">
                    {record.form_name_snapshot || formNameById[record.form_id] || 'Consultation form'} · {new Date(record.created_at).toLocaleString()} · {record.submitted_via === 'public_link' ? 'Public link' : 'Recorded by staff'}
                  </p>
                </div>
                {expandedId === record.id ? <ChevronUp className="h-4 w-4 shrink-0 text-slate-400" /> : <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />}
              </button>

              {expandedId === record.id && (
                <div className="mt-3 space-y-2 border-t border-white/10 pt-3">
                  {(record.patient_phone || record.patient_email) && (
                    <p className="text-xs text-slate-400">{[record.patient_phone, record.patient_email].filter(Boolean).join(' · ')}</p>
                  )}
                  {loadingFieldsFor === record.form_id ? (
                    <div className="flex items-center gap-2 text-sm text-slate-400"><Loader className="h-4 w-4 animate-spin" /> Loading answers…</div>
                  ) : (
                    entriesFor(record).map((entry) => (
                      entry.isSection ? (
                        <p key={entry.key} className="pt-2 text-xs font-bold uppercase tracking-wide text-cyan-300 first:pt-0">{entry.label}</p>
                      ) : (
                        <div key={entry.key} className="text-sm">
                          <p className="text-xs text-slate-400">{entry.label}</p>
                          <p className="text-slate-100">{formatAnswer(entry)}</p>
                        </div>
                      )
                    ))
                  )}
                  <div className="mt-1 flex gap-2">
                    <button type="button" onClick={() => printRecord(record)} className="flex items-center gap-1.5 rounded-lg border border-white/15 px-2.5 py-1.5 text-xs text-slate-200 hover:bg-white/5">
                      <Printer className="h-3.5 w-3.5" /> Print
                    </button>
                    <button type="button" onClick={() => downloadRecordPdf(record)} className="flex items-center gap-1.5 rounded-lg border border-white/15 px-2.5 py-1.5 text-xs text-slate-200 hover:bg-white/5">
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
  );
}
