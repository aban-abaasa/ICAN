import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Download, FileText, Loader, Paperclip, Printer, ScanLine, Search } from 'lucide-react';
import { listAllConsultationSubmissions, listConsultationForms, listConsultationFields } from '../services/cmmsConsultationFormService';
import { resolveAttachmentUrls } from '../services/cmmsConsultationAttachmentService';
import { downloadConsultationSubmissionPdf } from '../utils/generateConsultationFormPdf';
import { submissionEntries, formatAnswer } from '../utils/consultationSubmissionUtils';
import {
  formatReferenceCode, parseRecordCode, recordAttachments, recordMatchesCode, recordQrPayload, recordReferenceCode
} from '../utils/consultationAttachments';
import { normalizeFormSettings } from '../utils/consultationFormSettings';
import { loadLogoAsset, makeQrDataUrl } from '../utils/consultationBranding';
import { attachmentsHtml, closePrintShell, escapeHtml, fillPrintShell, letterheadHtml, openPrintShell } from '../utils/consultationPrint';
import ConsultationRecordAttachments from './ConsultationRecordAttachments';
import ConsultationRecordScanner from './ConsultationRecordScanner';

// CMMS Clinical Operations — "Records" sub-tab (alongside Activity Log and
// Consultation Forms in CMMSClinicalOperationsPanel.jsx). Where
// CMMSConsultationForms.jsx shows one form's submissions at a time, this is
// every patient submission across every consultation form for the
// business, in one searchable list — the record book a clinic actually
// reaches for day to day, regardless of which form a patient filled out.
//
// Every record carries a short reference code (and a QR of it) on its printouts and on
// the patient's check-in pass; search accepts that code, and the camera button scans it.
// A record's logo / QR / attachment behaviour follows the owner's options for the form
// it came from (Form options in the Consultation Forms tab).
export default function CMMSClinicalRecords({ businessProfileId, businessName, businessLogo }) {
  const [records, setRecords] = useState([]);
  const [forms, setForms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [formFilter, setFormFilter] = useState('all');
  const [expandedId, setExpandedId] = useState(null);
  const [fieldsByForm, setFieldsByForm] = useState({});
  const [loadingFieldsFor, setLoadingFieldsFor] = useState(null);
  const [withAttachmentsOnly, setWithAttachmentsOnly] = useState(false);
  const [scanning, setScanning] = useState(false);

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

  const settingsByForm = useMemo(() => Object.fromEntries(forms.map((f) => [f.id, normalizeFormSettings(f.settings)])), [forms]);
  const settingsFor = (record) => settingsByForm[record.form_id] || normalizeFormSettings(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const code = parseRecordCode(search);
    return records.filter((r) => {
      if (formFilter !== 'all' && r.form_id !== formFilter) return false;
      if (withAttachmentsOnly && !recordAttachments(r).length) return false;
      if (!q) return true;
      if (code && recordMatchesCode(r, code)) return true;
      return [r.patient_name, r.patient_phone, r.patient_email, r.patient_address, r.form_name_snapshot]
        .some((v) => (v || '').toLowerCase().includes(q));
    });
  }, [records, search, formFilter, withAttachmentsOnly]);

  const attachmentCount = useMemo(() => records.filter((r) => recordAttachments(r).length).length, [records]);

  // A scanned QR fills the search with the code and opens the record it belongs to.
  const onScanned = (code) => {
    setScanning(false);
    setFormFilter('all');
    setWithAttachmentsOnly(false);
    setSearch(code);
    const match = records.find((r) => recordMatchesCode(r, code));
    if (match) toggleExpandOpen(match);
  };

  const toggleExpand = (record) => (expandedId === record.id ? setExpandedId(null) : toggleExpandOpen(record));

  const toggleExpandOpen = async (record) => {
    setExpandedId(record.id);
    if (record.form_id && !fieldsByForm[record.form_id]) {
      setLoadingFieldsFor(record.form_id);
      const result = await listConsultationFields(record.form_id);
      if (result.success) setFieldsByForm((current) => ({ ...current, [record.form_id]: result.data }));
      setLoadingFieldsFor(null);
    }
  };

  const entriesFor = (record) => submissionEntries(record, fieldsByForm[record.form_id] || []);

  const printRecord = async (record) => {
    const win = openPrintShell();
    if (!win) return;
    try {
      const options = settingsFor(record);
      // Fields for a record whose row wasn't expanded yet.
      let formFields = fieldsByForm[record.form_id];
      if (!formFields && record.form_id) {
        const result = await listConsultationFields(record.form_id);
        formFields = result.success ? result.data : [];
      }
      const { url: logoSrc, image: logoImage } = await loadLogoAsset(options.showLogo ? businessLogo : null);
      const code = recordReferenceCode(record.id);
      const [qrDataUrl, attachments] = await Promise.all([
        options.showQr && code ? makeQrDataUrl(recordQrPayload(record.id), { logo: logoImage }) : '',
        resolveAttachmentUrls(recordAttachments(record))
      ]);
      const entries = submissionEntries(record, formFields || []);
      const fieldsHtml = entries.map((entry) => entry.isSection
        ? `<div class="section-heading">${escapeHtml(entry.label)}</div>`
        : `<div class="field"><div class="label">${escapeHtml(entry.label)}</div><div class="answer">${escapeHtml(formatAnswer(entry))}</div></div>`
      ).join('');
      fillPrintShell(
        win,
        `${businessName || 'Clinic'} — ${record.patient_name}`,
        `${letterheadHtml({
          businessName, logoUrl: logoSrc,
          detailsHtml: `${escapeHtml(record.form_name_snapshot || 'Consultation form')}<br>
            Patient: ${escapeHtml(record.patient_name)}${record.patient_phone ? ' · ' + escapeHtml(record.patient_phone) : ''}${record.patient_email ? ' · ' + escapeHtml(record.patient_email) : ''}${record.patient_dob ? ' · DOB ' + escapeHtml(record.patient_dob) : ''}${record.patient_address ? '<br>Address: ' + escapeHtml(record.patient_address) : ''}<br>
            Submitted: ${escapeHtml(new Date(record.created_at).toLocaleString())} (${record.submitted_via === 'public_link' ? 'via public link' : 'recorded by staff'})`,
          qrDataUrl, qrCaption: qrDataUrl ? 'Record reference' : '', qrCode: qrDataUrl ? formatReferenceCode(code) : ''
        })}${fieldsHtml}${attachmentsHtml(attachments)}
         <div class="meta">Printed ${escapeHtml(new Date().toLocaleString())} · Powered by IcanEra · A product of GODMINDERA ORGANISATION (U) LTD</div>`
      );
    } catch (err) {
      console.error('Unable to prepare the printable record:', err);
      closePrintShell(win);
      setError('Unable to prepare the printout. Please try again.');
    }
  };

  const downloadRecordPdf = async (record) => {
    try {
      const options = settingsFor(record);
      await downloadConsultationSubmissionPdf({
        businessName, formName: record.form_name_snapshot, submission: record, entries: entriesFor(record),
        logoRaw: options.showLogo ? businessLogo : null, showQr: options.showQr
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
            placeholder="Search by name, phone, email, or reference code…"
            className="w-full rounded-lg bg-slate-900 py-2 pl-9 pr-3 text-sm text-white"
          />
        </div>
        <button
          type="button" onClick={() => setScanning(true)}
          className="flex items-center gap-1.5 rounded-lg border border-cyan-400/30 bg-cyan-400/10 px-3 py-2 text-xs font-semibold text-cyan-200 hover:bg-cyan-400/20"
        >
          <ScanLine className="h-4 w-4" /> Scan QR
        </button>
        {attachmentCount > 0 && (
          <button
            type="button" onClick={() => setWithAttachmentsOnly((v) => !v)} aria-pressed={withAttachmentsOnly}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold ${withAttachmentsOnly ? 'border-cyan-400 bg-cyan-400/20 text-cyan-100' : 'border-white/15 text-slate-300 hover:bg-white/5'}`}
          >
            <Paperclip className="h-4 w-4" /> With attachments ({attachmentCount})
          </button>
        )}
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
                    {recordAttachments(record).length > 0 && <span className="ml-1.5 inline-flex items-center gap-0.5 text-cyan-300"><Paperclip className="inline h-3 w-3" />{recordAttachments(record).length}</span>}
                    {recordReferenceCode(record.id) && <span className="ml-1.5 font-mono text-slate-500">#{formatReferenceCode(recordReferenceCode(record.id))}</span>}
                  </p>
                </div>
                {expandedId === record.id ? <ChevronUp className="h-4 w-4 shrink-0 text-slate-400" /> : <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />}
              </button>

              {expandedId === record.id && (
                <div className="mt-3 space-y-2 border-t border-white/10 pt-3">
                  {(record.patient_phone || record.patient_email || record.patient_dob || record.patient_address) && (
                    <p className="text-xs text-slate-400">
                      {[record.patient_phone, record.patient_email, record.patient_dob ? `DOB ${record.patient_dob}` : null, record.patient_address].filter(Boolean).join(' · ')}
                    </p>
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
                  <ConsultationRecordAttachments
                    record={record} settings={forms.find((f) => f.id === record.form_id)?.settings}
                    onRecordUpdated={(row) => setRecords((current) => current.map((r) => (r.id === row.id ? row : r)))}
                  />
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

      {scanning && <ConsultationRecordScanner onCode={onScanned} onClose={() => setScanning(false)} />}
    </div>
  );
}
