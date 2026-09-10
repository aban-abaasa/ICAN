import React, { useEffect, useMemo, useState } from 'react';
import { X, FileText, Loader2, Download, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import {
  requestCertificate, getSentCertificateRequests, resolveCertificateDownloadUrl,
} from '../../services/portfolioCertificateService';

const STATUS_META = {
  pending: { label: 'Pending', icon: Clock, className: 'text-amber-300 bg-amber-950/40 border-amber-800/40' },
  approved: { label: 'Approved', icon: CheckCircle2, className: 'text-emerald-300 bg-emerald-950/40 border-emerald-800/40' },
  denied: { label: 'Denied', icon: XCircle, className: 'text-red-300 bg-red-950/40 border-red-800/40' },
};

function RequestStatusRow({ request }) {
  const meta = STATUS_META[request.status] || STATUS_META.pending;
  const Icon = meta.icon;
  const [downloadUrl, setDownloadUrl] = useState(null);
  const [resolving, setResolving] = useState(false);

  const handleDownload = async () => {
    if (downloadUrl) {
      window.open(downloadUrl, '_blank', 'noopener,noreferrer');
      return;
    }
    setResolving(true);
    try {
      const url = await resolveCertificateDownloadUrl(request);
      if (url) {
        setDownloadUrl(url);
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    } finally {
      setResolving(false);
    }
  };

  return (
    <div className="flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg bg-slate-950/40 border border-slate-800">
      <div className="min-w-0">
        <p className="text-xs text-slate-300 truncate">Requested {new Date(request.created_at).toLocaleDateString()}</p>
        {request.response_note && <p className="text-[11px] text-slate-500 truncate">{request.response_note}</p>}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-medium ${meta.className}`}>
          <Icon className="w-3 h-3" /> {meta.label}
        </span>
        {request.status === 'approved' && request.certificate_url && (
          <button
            onClick={handleDownload}
            disabled={resolving}
            className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-medium disabled:opacity-50"
          >
            {resolving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />} Download
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * "Request Certificate" panel on the public /portfolio/<handle> page — a
 * company (signed-in or anonymous guest, same identity as PortfolioChatPanel)
 * asks the resume owner for their academic certificate, and can see the
 * status of every request they've sent this owner.
 */
export default function CertificateRequestModal({ ownerUserId, ownerName, guestId, guestName, onGuestNameChange, onClose }) {
  const { user, profile: viewerProfile } = useAuth();
  const [companyName, setCompanyName] = useState('');
  const [email, setEmail] = useState(viewerProfile?.email || user?.email || '');
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [sentRequests, setSentRequests] = useState([]);
  const [isLoadingSent, setIsLoadingSent] = useState(true);

  const effectiveGuestName = viewerProfile?.full_name || guestName?.trim() || '';

  const loadSentRequests = async () => {
    try {
      const all = await getSentCertificateRequests({ guestId });
      setSentRequests(all.filter((r) => r.owner_user_id === ownerUserId));
    } catch (err) {
      console.error('CertificateRequestModal: could not load sent requests', err);
    } finally {
      setIsLoadingSent(false);
    }
  };

  useEffect(() => {
    loadSentRequests();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerUserId]);

  const hasPendingOrApproved = useMemo(
    () => sentRequests.some((r) => r.status === 'pending' || r.status === 'approved'),
    [sentRequests]
  );

  const handleSubmit = async () => {
    if (isSubmitting) return;
    if (!companyName.trim() || !email.trim()) {
      setError('Company/organization name and email are required.');
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      await requestCertificate(ownerUserId, {
        companyName: companyName.trim(),
        email: email.trim(),
        phone: phone.trim() || null,
        message: message.trim() || null,
        guestId,
        guestName: effectiveGuestName,
      });
      setMessage('');
      await loadSentRequests();
    } catch (err) {
      console.error('CertificateRequestModal: request failed', err);
      setError(err.message || 'Could not send this request — please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="mb-6 rounded-xl border border-slate-800 bg-slate-900/80 overflow-hidden animate-fadeIn">
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-800 bg-slate-900/90">
        <div>
          <p className="text-sm font-semibold text-white flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5 text-indigo-400" /> Request Certificate from {ownerName?.split(' ')[0] || 'them'}
          </p>
          <p className="text-[10px] text-slate-500">{ownerName?.split(' ')[0] || 'They'} will review and approve or deny your request</p>
        </div>
        <button onClick={onClose} className="p-1 rounded hover:bg-white/5">
          <X className="w-4 h-4 text-slate-400" />
        </button>
      </div>

      <div className="px-3 py-3 space-y-2">
        {!user && (
          <input
            value={guestName}
            onChange={(e) => onGuestNameChange(e.target.value)}
            placeholder="Your name"
            className="w-full px-3 py-1.5 bg-slate-950/60 border border-slate-700 rounded-lg text-white placeholder-slate-500 text-xs focus:outline-none focus:border-indigo-500/60"
          />
        )}
        <input
          value={companyName}
          onChange={(e) => setCompanyName(e.target.value)}
          placeholder="Company / organization name"
          className="w-full px-3 py-1.5 bg-slate-950/60 border border-slate-700 rounded-lg text-white placeholder-slate-500 text-xs focus:outline-none focus:border-indigo-500/60"
        />
        <div className="flex gap-2">
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Contact email"
            type="email"
            className="min-w-0 flex-1 px-3 py-1.5 bg-slate-950/60 border border-slate-700 rounded-lg text-white placeholder-slate-500 text-xs focus:outline-none focus:border-indigo-500/60"
          />
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Phone (optional)"
            className="min-w-0 flex-1 px-3 py-1.5 bg-slate-950/60 border border-slate-700 rounded-lg text-white placeholder-slate-500 text-xs focus:outline-none focus:border-indigo-500/60"
          />
        </div>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Why you need this (optional)"
          rows={2}
          className="w-full resize-none px-3 py-1.5 bg-slate-950/60 border border-slate-700 rounded-lg text-white placeholder-slate-500 text-xs focus:outline-none focus:border-indigo-500/60"
        />

        {error && <p className="text-[11px] text-red-400">{error}</p>}

        <button
          onClick={handleSubmit}
          disabled={isSubmitting || !companyName.trim() || !email.trim()}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium rounded-lg transition-colors disabled:opacity-40"
        >
          {isSubmitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
          {hasPendingOrApproved ? 'Send another request' : 'Send request'}
        </button>

        {!isLoadingSent && sentRequests.length > 0 && (
          <div className="pt-1 space-y-1.5">
            <p className="text-[11px] text-slate-500 font-medium">Your requests</p>
            {sentRequests.map((r) => <RequestStatusRow key={r.id} request={r} />)}
          </div>
        )}
      </div>
    </div>
  );
}
