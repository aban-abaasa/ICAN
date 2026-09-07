import React, { useEffect, useState } from 'react';
import { X, FileText, QrCode, Loader, Ban, Save, CheckCircle2, Lock, ArrowRight } from 'lucide-react';
import { supabase } from '../lib/supabase/client';
import { uploadToR2 } from '../services/r2StorageService';
import cmmsEmploymentDocumentsService from '../services/cmmsEmploymentDocumentsService';
import { generateEmploymentDocumentPdf, employmentDocumentFilename } from '../utils/generateEmploymentDocumentPdf';

const defaultTitleFor = (type, position) => `${position ? position + ' — ' : ''}${type === 'employment_contract' ? 'Employment Contract' : 'Letter of Appointment'}`;

// A document only "counts" toward the pipeline if it hasn't been revoked --
// a revoked appointment letter means the offer isn't actually confirmed, so
// the contract step should stay locked exactly as if nothing was issued.
const findActive = (documents, type) => documents.find((d) => d.document_type === type && d.status !== 'revoked') || null;

/**
 * Admin modal to issue QR-sealed employment paperwork for one hire.
 * Opened automatically the moment an application is marked "Hired" (see
 * saveApplicationStatus in CMMSAnnouncementsPanel.jsx), or manually via the
 * "Issue appointment letter / contract" button.
 *
 * Enforces the real-world hiring order: the Letter of Appointment is step 1
 * and must be issued before the Employment Contract (step 2) unlocks --
 * matches how offers actually work (appointment/offer first, formal
 * contract once it's accepted) and stops an admin from generating a
 * contract with nothing backing it. Every document issued at either step
 * always carries the QR "seal" (generateEmploymentDocumentPdf embeds one
 * unconditionally) -- there's no path to an unsealed PDF.
 */
const CMMSEmploymentDocumentsPanel = ({ companyId, companyName, application, currentCmmsUserId, onClose }) => {
  const [documentType, setDocumentType] = useState('appointment_letter');
  const [title, setTitle] = useState('');
  const [titleTouched, setTitleTouched] = useState(false);
  const [position, setPosition] = useState('');
  const [department, setDepartment] = useState('');
  const [employmentType, setEmploymentType] = useState('');
  const [salary, setSalary] = useState('');
  const [startDate, setStartDate] = useState('');
  const [terms, setTerms] = useState('');
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [issuing, setIssuing] = useState(false);
  const [error, setError] = useState('');

  const appointmentDoc = findActive(documents, 'appointment_letter');
  const contractDoc = findActive(documents, 'employment_contract');
  const contractLocked = !appointmentDoc;

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const [{ data: job }, docsResult] = await Promise.all([
        application.job_posting_id
          ? supabase.from('cmms_announcements').select('title, department, employment_type, salary_range').eq('id', application.job_posting_id).maybeSingle()
          : Promise.resolve({ data: null }),
        cmmsEmploymentDocumentsService.getDocumentsForApplication(application.id),
      ]);
      setPosition(job?.title || '');
      setDepartment(job?.department || '');
      setEmploymentType(job?.employment_type || '');
      setSalary(job?.salary_range || '');
      const docs = docsResult.success ? docsResult.data : [];
      // Land on whichever step is next: appointment letter first, then
      // employment contract once that's issued -- same order the button
      // enforces below, so re-opening this modal picks up where hiring
      // left off instead of always defaulting back to step 1.
      const nextType = findActive(docs, 'appointment_letter') && !findActive(docs, 'employment_contract')
        ? 'employment_contract' : 'appointment_letter';
      setDocumentType(nextType);
      setTitle(defaultTitleFor(nextType, job?.title || ''));
      setDocuments(docs);
      setLoading(false);
    };
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [application.id]);

  // Keep the title in sync with the step unless the admin has typed their
  // own -- covers both the initial load above and the auto-advance after
  // issuing the appointment letter (which switches documentType directly).
  useEffect(() => {
    if (!titleTouched) setTitle(defaultTitleFor(documentType, position));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentType]);

  const changeDocumentType = (nextType) => {
    if (nextType === 'employment_contract' && contractLocked) return;
    setDocumentType(nextType);
  };

  const issue = async () => {
    if (!title.trim() || !position.trim()) { alert('Please provide at least a title and position.'); return; }
    setIssuing(true); setError('');
    try {
      // Issuing the actual paperwork is the real "you're hired" moment --
      // this is what turns the applicant into a real CMMS employee
      // (cmms_users row) so they have somewhere to sign in and receive it.
      // Idempotent: a later document for the same applicant reuses the
      // employee record this creates the first time.
      const hireResult = await cmmsEmploymentDocumentsService.hireApplicantIntoCmms(application.id);
      if (!hireResult.success) throw new Error(hireResult.error);
      const cmmsUserId = hireResult.cmmsUserId;

      const content = { position, department, employmentType, salary, startDate, terms };
      const createResult = await cmmsEmploymentDocumentsService.createEmploymentDocument(
        companyId,
        { jobApplicationId: application.id, cmmsUserId, documentType, title, content },
        currentCmmsUserId
      );
      if (!createResult.success) throw new Error(createResult.error);
      const doc = createResult.data;

      const verifyUrl = cmmsEmploymentDocumentsService.buildVerifyUrl(doc.verify_token);
      const pdfBlob = await generateEmploymentDocumentPdf({
        companyName, documentType, title, employeeName: application.applicant_name, content, issuedAt: new Date().toISOString(), verifyUrl,
      });
      const filename = employmentDocumentFilename(documentType, application.applicant_name);
      const file = new File([pdfBlob], filename, { type: 'application/pdf' });

      const { data: { session } } = await supabase.auth.getSession();
      const uploadResult = await uploadToR2({ file, folder: 'cmms-employment-documents', accessToken: session?.access_token });
      if (!uploadResult.success) throw new Error(uploadResult.error || 'Upload failed');

      const issueResult = await cmmsEmploymentDocumentsService.issueEmploymentDocument(doc.id, { documentUrl: uploadResult.url, documentPath: uploadResult.key });
      if (!issueResult.success) throw new Error(issueResult.error);

      const refreshed = await cmmsEmploymentDocumentsService.getDocumentsForApplication(application.id);
      const nextDocs = refreshed.success ? refreshed.data : documents;
      if (refreshed.success) setDocuments(nextDocs);

      // Step 1 just closed out -- advance straight to step 2 instead of
      // leaving the admin to notice the contract option unlocked and
      // re-pick it themselves. Carries over position/department/etc. since
      // it's almost always the same job; terms is cleared since a contract's
      // terms are rarely a copy-paste of the appointment letter's.
      if (documentType === 'appointment_letter' && !findActive(nextDocs, 'employment_contract')) {
        setDocumentType('employment_contract');
        setTitleTouched(false);
        setTerms('');
        alert('✅ Appointment letter issued and QR-sealed. Next: issue the employment contract below.');
      } else {
        alert('✅ Document issued and QR-sealed. The employee can now review and sign it.');
      }
    } catch (err) {
      setError(err.message || 'Failed to issue document');
    } finally {
      setIssuing(false);
    }
  };

  const revoke = async (doc) => {
    if (!window.confirm(`Revoke "${doc.title}"? It will no longer verify as valid.`)) return;
    const result = await cmmsEmploymentDocumentsService.revokeEmploymentDocument(doc.id);
    if (!result.success) { alert(`❌ ${result.error}`); return; }
    const refreshed = await cmmsEmploymentDocumentsService.getDocumentsForApplication(application.id);
    if (refreshed.success) setDocuments(refreshed.data);
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[60] overflow-y-auto">
      <div className="min-h-screen flex items-start justify-center p-4 pb-16">
        <div className="glass-card w-full max-w-2xl p-6 my-8 border border-purple-400/30">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold text-white flex items-center gap-2"><FileText className="w-5 h-5 text-purple-300" /> Employment documents — {application.applicant_name}</h3>
            <button onClick={onClose} className="text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
          </div>

          {loading ? (
            <div className="flex justify-center py-10"><Loader className="w-6 h-6 text-purple-400 animate-spin" /></div>
          ) : (
            <div className="space-y-5">
              <HiringSteps
                appointmentDoc={appointmentDoc}
                contractDoc={contractDoc}
                activeType={documentType}
                onSelect={changeDocumentType}
              />

              {documents.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-semibold text-white">Previously issued</p>
                  {documents.map((doc) => (
                    <div key={doc.id} className="flex items-center justify-between gap-3 p-3 rounded bg-white/5 border border-white/10">
                      <div>
                        <p className="text-white text-sm font-medium">{doc.title}</p>
                        <p className="text-xs text-gray-400 capitalize">{doc.status} {doc.document_type === 'employment_contract' ? '· Contract' : '· Appointment letter'}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        {doc.document_url && <a href={doc.document_url} target="_blank" rel="noreferrer" className="text-xs text-blue-300 hover:text-blue-200">View PDF</a>}
                        <a href={cmmsEmploymentDocumentsService.buildVerifyUrl(doc.verify_token)} target="_blank" rel="noreferrer" className="text-xs text-emerald-300 hover:text-emerald-200 flex items-center gap-1"><QrCode className="w-3.5 h-3.5" /> Verify link</a>
                        {doc.status !== 'revoked' && <button onClick={() => revoke(doc)} className="text-red-300 hover:text-white" title="Revoke"><Ban className="w-4 h-4" /></button>}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="border-t border-white/10 pt-4">
                <p className="text-sm font-semibold text-white mb-1">
                  {documentType === 'employment_contract' ? 'Step 2 — Issue the employment contract' : 'Step 1 — Issue the appointment letter'}
                </p>
                <p className="text-xs text-gray-400 mb-3 flex items-center gap-1.5">
                  <QrCode className="w-3.5 h-3.5 text-emerald-300" /> Every document is QR-sealed automatically — there's no way to issue one without a verifiable proof code.
                </p>
                <div className="grid md:grid-cols-2 gap-3">
                  <select value={documentType} onChange={(e) => changeDocumentType(e.target.value)} className="px-3 py-2 rounded bg-slate-900 text-white border border-white/20">
                    <option value="appointment_letter">Appointment letter</option>
                    <option value="employment_contract" disabled={contractLocked}>
                      Employment contract{contractLocked ? ' (issue appointment letter first)' : ''}
                    </option>
                  </select>
                  <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} placeholder="Start date" className="px-3 py-2 rounded bg-slate-900 text-white border border-white/20" />
                  <input value={title} onChange={(e) => { setTitle(e.target.value); setTitleTouched(true); }} placeholder="Document title" className="px-3 py-2 rounded bg-white/10 text-white border border-white/20 md:col-span-2" />
                  <input value={position} onChange={(e) => setPosition(e.target.value)} placeholder="Position" className="px-3 py-2 rounded bg-white/10 text-white border border-white/20" />
                  <input value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="Department" className="px-3 py-2 rounded bg-white/10 text-white border border-white/20" />
                  <input value={employmentType} onChange={(e) => setEmploymentType(e.target.value)} placeholder="Employment type" className="px-3 py-2 rounded bg-white/10 text-white border border-white/20" />
                  <input value={salary} onChange={(e) => setSalary(e.target.value)} placeholder="Salary" className="px-3 py-2 rounded bg-white/10 text-white border border-white/20" />
                  <textarea value={terms} onChange={(e) => setTerms(e.target.value)} placeholder="Terms & conditions" rows={4} className="px-3 py-2 rounded bg-white/10 text-white border border-white/20 md:col-span-2" />
                </div>
                {error && <p className="text-red-300 text-sm mt-2">{error}</p>}
                <div className="flex justify-end mt-3">
                  <button disabled={issuing} onClick={issue} className="px-4 py-2 rounded bg-purple-600 hover:bg-purple-500 text-white font-semibold flex items-center gap-2">
                    <Save className="w-4 h-4" /> {issuing ? 'Issuing…' : 'Generate & issue (QR-sealed)'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

/** Visual "Appointment letter → Employment contract" progress indicator.
 * Clicking a completed/unlocked step jumps the form to it; the locked
 * (contract, before an appointment letter exists) step is inert. */
const HiringSteps = ({ appointmentDoc, contractDoc, activeType, onSelect }) => {
  const steps = [
    { type: 'appointment_letter', label: 'Appointment letter', doc: appointmentDoc, locked: false },
    { type: 'employment_contract', label: 'Employment contract', doc: contractDoc, locked: !appointmentDoc },
  ];
  return (
    <div className="flex items-center gap-2">
      {steps.map((step, i) => {
        const done = Boolean(step.doc);
        const active = activeType === step.type;
        return (
          <React.Fragment key={step.type}>
            {i > 0 && <ArrowRight className="w-4 h-4 text-gray-600 shrink-0" />}
            <button
              type="button"
              disabled={step.locked}
              onClick={() => onSelect(step.type)}
              className={`flex-1 text-left px-3 py-2 rounded border flex items-center gap-2 transition-colors ${
                active ? 'bg-purple-600/20 border-purple-400/50' : 'bg-white/5 border-white/10'
              } ${step.locked ? 'opacity-40 cursor-not-allowed' : 'hover:border-white/30'}`}
            >
              {step.locked ? <Lock className="w-4 h-4 text-gray-400 shrink-0" />
                : done ? <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                : <FileText className="w-4 h-4 text-gray-400 shrink-0" />}
              <span className="min-w-0">
                <span className="block text-xs font-semibold text-white">{i + 1}. {step.label}</span>
                <span className="block text-[11px] text-gray-400 capitalize">
                  {step.locked ? 'Locked' : done ? step.doc.status : 'Not issued yet'}
                </span>
              </span>
            </button>
          </React.Fragment>
        );
      })}
    </div>
  );
};

export default CMMSEmploymentDocumentsPanel;
