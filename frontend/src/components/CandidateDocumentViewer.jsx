import React, { useEffect, useState } from 'react';
import { CheckCircle2, Download, FileText, Loader2, ShieldCheck, XCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import AuthPage from './auth/AuthPage';
import CMMSDocumentSignModal from './CMMSDocumentSignModal';
import cmmsEmploymentDocumentsService from '../services/cmmsEmploymentDocumentsService';

/**
 * Standalone page at /candidate-document?documentId=<id> (see main.jsx).
 * Same account-linking flow as CandidateTestRunner/CandidateInterviewRoom,
 * then shows the applicant's own appointment letter/contract -- reusing the
 * existing wallet-PIN sign flow (CMMSDocumentSignModal) as-is, since it only
 * ever needs the document row and the signed-in user's id, never the full
 * CMMS company workspace it's normally opened from.
 */
const CandidateDocumentViewer = () => {
  const { user, loading: authLoading, signOut } = useAuth();
  const documentId = new URLSearchParams(window.location.search).get('documentId') || '';

  const [prefill, setPrefill] = useState(null);
  const [phase, setPhase] = useState('loading'); // loading | auth | linking | link-error | view | error
  const [error, setError] = useState('');
  const [doc, setDoc] = useState(null);
  const [showSign, setShowSign] = useState(false);

  const load = async () => {
    const docResult = await cmmsEmploymentDocumentsService.getDocumentById(documentId);
    if (!docResult.success) { setError('This document is no longer available.'); setPhase('error'); return; }
    setDoc(docResult.data);
    setPhase('view');
  };

  useEffect(() => {
    if (!documentId) { setPhase('error'); setError('This link is missing its document id.'); return; }
    if (authLoading) return;

    if (!user) {
      cmmsEmploymentDocumentsService.getDocumentPrefillContact(documentId).then((result) => {
        if (!result.success) { setPhase('error'); setError('This document link is invalid or has expired.'); return; }
        setPrefill({ email: result.data.applicant_email, fullName: result.data.applicant_name, phone: result.data.applicant_phone });
        setPhase('auth');
      });
      return;
    }

    const linkAndLoad = async () => {
      setPhase('linking');
      const linkResult = await cmmsEmploymentDocumentsService.linkIcanAccountViaDocument(documentId);
      if (!linkResult.success) { setError(linkResult.error); setPhase('link-error'); return; }
      await load();
    };
    linkAndLoad();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, authLoading, documentId]);

  if (phase === 'loading' || phase === 'linking' || authLoading) {
    return <main className="min-h-screen flex items-center justify-center bg-slate-950 text-white"><Loader2 className="w-8 h-8 animate-spin" /></main>;
  }

  if (phase === 'auth') {
    return <AuthPage initialView="signup" prefill={prefill} onAuthSuccess={() => {}} />;
  }

  if (phase === 'link-error') {
    return (
      <main className="min-h-screen flex items-center justify-center bg-slate-950 px-4 text-white">
        <div className="max-w-md w-full rounded-2xl border border-white/10 bg-slate-900/80 p-6 text-center">
          <XCircle className="w-10 h-10 text-red-400 mx-auto mb-3" />
          <p className="mb-4">{error}</p>
          <button onClick={() => signOut()} className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-sm font-semibold">Sign in with a different account</button>
        </div>
      </main>
    );
  }

  if (phase === 'error') {
    return (
      <main className="min-h-screen flex items-center justify-center bg-slate-950 px-4 text-white text-center">
        <div><XCircle className="w-10 h-10 text-red-400 mx-auto mb-3" /><p>{error}</p></div>
      </main>
    );
  }

  if (phase !== 'view' || !doc) {
    return <main className="min-h-screen flex items-center justify-center bg-slate-950 text-white"><ShieldCheck className="w-8 h-8" /></main>;
  }

  const content = doc.content || {};
  const fields = [
    ['Position', content.position],
    ['Department', content.department],
    ['Employment type', content.employmentType],
    ['Salary', content.salary],
    ['Start date', content.startDate],
  ].filter(([, value]) => value);

  return (
    <main className="min-h-screen bg-slate-950 text-white px-4 py-10">
      <div className="max-w-lg mx-auto rounded-2xl border border-white/10 bg-slate-900/80 p-8">
        <div className="flex items-center gap-3 mb-4">
          {doc.status === 'signed' ? <CheckCircle2 className="w-8 h-8 text-emerald-400" /> : <FileText className="w-8 h-8 text-indigo-300" />}
          <div>
            <p className="text-sm text-slate-400 capitalize">{doc.document_type?.replace('_', ' ')}</p>
            <h1 className="text-xl font-bold">{doc.title}</h1>
          </div>
        </div>

        {fields.length > 0 && (
          <div className="space-y-2 mb-5 text-sm">
            {fields.map(([label, value]) => (
              <div key={label} className="flex justify-between border-b border-white/5 pb-2">
                <span className="text-slate-400">{label}</span>
                <span className="font-medium">{value}</span>
              </div>
            ))}
          </div>
        )}

        {content.terms && <p className="text-sm text-slate-300 whitespace-pre-wrap mb-5">{content.terms}</p>}

        {doc.document_url && (
          <a
            href={doc.document_url}
            target="_blank"
            rel="noreferrer"
            className="w-full mb-3 py-2.5 rounded-lg bg-white/10 hover:bg-white/20 font-semibold text-sm flex items-center justify-center gap-2"
          >
            <Download className="w-4 h-4" /> Download PDF
          </a>
        )}

        {doc.status === 'signed' ? (
          <p className="text-sm text-emerald-300 flex items-center gap-2"><CheckCircle2 className="w-4 h-4" /> Signed {doc.signed_at ? new Date(doc.signed_at).toLocaleDateString() : ''}</p>
        ) : (
          <button
            onClick={() => setShowSign(true)}
            className="w-full py-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 font-semibold"
          >
            Sign with wallet PIN
          </button>
        )}
      </div>

      {showSign && (
        <CMMSDocumentSignModal
          document={doc}
          userId={user.id}
          onClose={() => setShowSign(false)}
          onSigned={() => { setShowSign(false); load(); }}
        />
      )}
    </main>
  );
};

export default CandidateDocumentViewer;
