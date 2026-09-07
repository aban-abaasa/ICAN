import React, { useEffect, useState } from 'react';
import { BadgeCheck, Loader2, ShieldAlert, ShieldX } from 'lucide-react';
import cmmsEmploymentDocumentsService from '../services/cmmsEmploymentDocumentsService';

/**
 * Standalone public page at /verify-document?token=<verify_token> (see
 * main.jsx) -- what scanning an employment document's QR "seal" opens. No
 * login, no providers: same pattern as PublicStaffAttendanceCheckIn.jsx.
 * Shows only a narrow confirmation (never the document's private terms),
 * via the anon-callable fn_verify_employment_document RPC.
 */
const PublicDocumentVerify = () => {
  const token = new URLSearchParams(window.location.search).get('token') || '';
  const [state, setState] = useState('loading'); // loading | valid | invalid | error

  const [info, setInfo] = useState(null);

  useEffect(() => {
    if (!token) { setState('error'); return; }
    cmmsEmploymentDocumentsService.verifyEmploymentDocument(token).then((result) => {
      if (!result.success) { setState('error'); return; }
      setInfo(result.data);
      setState(result.data.is_valid ? 'valid' : 'invalid');
    });
  }, [token]);

  const documentTypeLabel = (type) => (type === 'employment_contract' ? 'Employment Contract' : 'Letter of Appointment');

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-950 flex items-center justify-center px-4 py-10 text-white">
      <section className="w-full max-w-md rounded-3xl border border-white/10 bg-slate-900/80 p-7 text-center shadow-2xl backdrop-blur">
        {state === 'loading' && <Loader2 className="w-10 h-10 mx-auto animate-spin text-indigo-300" />}

        {state === 'valid' && (
          <>
            <BadgeCheck className="w-14 h-14 mx-auto mb-4 text-emerald-400" />
            <h1 className="text-xl font-bold mb-1">Genuine document</h1>
            <p className="text-slate-400 mb-5">This {documentTypeLabel(info.document_type).toLowerCase()} was issued by {info.company_name}.</p>
            <div className="space-y-2 text-left text-sm bg-white/5 rounded-xl p-4 border border-white/10">
              <Row label="Document" value={info.title} />
              <Row label="Type" value={documentTypeLabel(info.document_type)} />
              <Row label="Issued to" value={info.employee_name} />
              {info.position && <Row label="Position" value={info.position} />}
              <Row label="Issued" value={info.issued_at ? new Date(info.issued_at).toLocaleDateString() : '—'} />
              <Row label="Status" value={info.status === 'signed' ? 'Signed' : 'Issued'} />
            </div>
          </>
        )}

        {state === 'invalid' && (
          <>
            <ShieldAlert className="w-14 h-14 mx-auto mb-4 text-amber-400" />
            <h1 className="text-xl font-bold mb-1">Document revoked</h1>
            <p className="text-slate-400">This document was issued by {info?.company_name || 'the company'} but has since been revoked and is no longer valid.</p>
          </>
        )}

        {state === 'error' && (
          <>
            <ShieldX className="w-14 h-14 mx-auto mb-4 text-red-400" />
            <h1 className="text-xl font-bold mb-1">Not found</h1>
            <p className="text-slate-400">This QR code / link does not match any document we've issued. It may be invalid or tampered with.</p>
          </>
        )}
      </section>
    </main>
  );
};

const Row = ({ label, value }) => (
  <div className="flex items-center justify-between gap-3"><span className="text-slate-500">{label}</span><span className="font-medium text-right">{value}</span></div>
);

export default PublicDocumentVerify;
