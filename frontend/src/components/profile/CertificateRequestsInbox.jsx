import React, { useEffect, useRef, useState } from 'react';
import { FileText, X, Loader2, Upload } from 'lucide-react';
import {
  getMyCertificateRequests, uploadCertificateFile, approveCertificateRequest, denyCertificateRequest,
} from '../../services/portfolioCertificateService';
import { fmtRelativeTime } from '../landing/relativeTime';

const STATUS_LABEL = {
  pending: { text: 'Pending', className: 'text-amber-300 bg-amber-950/40 border-amber-800/40' },
  approved: { text: 'Approved', className: 'text-emerald-300 bg-emerald-950/40 border-emerald-800/40' },
  denied: { text: 'Denied', className: 'text-red-300 bg-red-950/40 border-red-800/40' },
};

/**
 * The resume owner's "Certificate Requests" card — companies who asked for
 * this person's academic certificate from their public /portfolio/<handle>
 * page (see CertificateRequestModal.jsx). Self-contained like
 * PortfolioMessagesInbox, so it can be dropped straight into the Portfolio
 * tab without any data plumbing from the parent.
 */
export default function CertificateRequestsInbox({ className = '' }) {
  const [requests, setRequests] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [respondingId, setRespondingId] = useState(null);
  const [error, setError] = useState(null);
  const fileInputRef = useRef(null);
  const pendingApprovalId = useRef(null);

  const refresh = () => getMyCertificateRequests().then(setRequests).catch((err) => console.error('CertificateRequestsInbox: load failed', err));

  useEffect(() => {
    refresh().finally(() => setIsLoading(false));
    const interval = setInterval(refresh, 15000);
    return () => clearInterval(interval);
  }, []);

  const handleDeny = async (requestId) => {
    setRespondingId(requestId);
    setError(null);
    try {
      const updated = await denyCertificateRequest(requestId);
      setRequests((prev) => prev.map((r) => (r.id === requestId ? updated : r)));
    } catch (err) {
      console.error('CertificateRequestsInbox: deny failed', err);
      setError(err.message || 'Could not deny this request.');
    } finally {
      setRespondingId(null);
    }
  };

  const startApprove = (requestId) => {
    pendingApprovalId.current = requestId;
    fileInputRef.current?.click();
  };

  const handleFilePicked = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    const requestId = pendingApprovalId.current;
    if (!file || !requestId) return;

    setRespondingId(requestId);
    setError(null);
    try {
      const { url, path } = await uploadCertificateFile(file);
      const updated = await approveCertificateRequest(requestId, { certificateUrl: url, certificatePath: path });
      setRequests((prev) => prev.map((r) => (r.id === requestId ? updated : r)));
    } catch (err) {
      console.error('CertificateRequestsInbox: approve failed', err);
      setError(err.message || 'Could not approve this request.');
    } finally {
      setRespondingId(null);
      pendingApprovalId.current = null;
    }
  };

  const pendingCount = requests.filter((r) => r.status === 'pending').length;

  return (
    <div className={`bg-slate-900/50 border border-indigo-700/30 rounded-xl p-4 ${className}`}>
      <input type="file" ref={fileInputRef} className="hidden" onChange={handleFilePicked} />
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-white font-semibold flex items-center gap-2">
          <FileText className="w-4 h-4 text-indigo-400" /> Certificate Requests
          {pendingCount > 0 && <span className="w-2 h-2 rounded-full bg-indigo-500" />}
        </h3>
      </div>

      {error && <p className="text-xs text-red-400 mb-2">{error}</p>}

      {isLoading ? (
        <div className="flex items-center justify-center py-6 text-gray-500">
          <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading...
        </div>
      ) : requests.length === 0 ? (
        <p className="text-sm text-gray-500 text-center py-4">
          No requests yet — companies who want your certificate can request it from your public resume page.
        </p>
      ) : (
        <div className="space-y-1.5">
          {requests.map((r) => {
            const meta = STATUS_LABEL[r.status] || STATUS_LABEL.pending;
            const isBusy = respondingId === r.id;
            return (
              <div key={r.id} className="p-2.5 bg-slate-950/30 rounded-lg">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm text-white font-medium truncate">{r.requester_company_name}</p>
                    <p className="text-xs text-gray-400 truncate">{r.requester_email}{r.requester_phone ? ` · ${r.requester_phone}` : ''}</p>
                    {r.message && <p className="text-xs text-gray-500 mt-1">{r.message}</p>}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className={`px-2 py-0.5 rounded-full border text-[10px] font-medium ${meta.className}`}>{meta.text}</span>
                    <span className="text-[10px] text-gray-500">{fmtRelativeTime(r.created_at)}</span>
                  </div>
                </div>
                {r.status === 'pending' && (
                  <div className="flex items-center gap-1.5 mt-2">
                    <button
                      onClick={() => startApprove(r.id)}
                      disabled={isBusy}
                      className="flex items-center gap-1 px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs rounded-lg disabled:opacity-40"
                    >
                      {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />} Approve & upload
                    </button>
                    <button
                      onClick={() => handleDeny(r.id)}
                      disabled={isBusy}
                      className="flex items-center gap-1 px-2.5 py-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white text-xs rounded-lg disabled:opacity-40"
                    >
                      <X className="w-3.5 h-3.5" /> Deny
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
