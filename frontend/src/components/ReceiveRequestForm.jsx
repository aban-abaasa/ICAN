import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Clock, Loader2, Wallet, X, XCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { AuthPage } from './auth';
import { getReceiveRequest, submitReceiveRequest } from '../services/publicTransactionService';

/**
 * "Receive": the other side of the business website's Pay tab. A signed-in client asks the business for money
 * (a refund, a payout owed to them…). An owner / co-owner is notified and approves with the business-wallet PIN;
 * only then does the amount move from the business wallet into the client's own IcanEra wallet. This form files
 * the request and then follows it until it is paid, declined or has expired. Styled with the site's "nb" palette.
 */

const formatMoney = (amount) => `UGX ${Number(amount || 0).toLocaleString('en-UG', { maximumFractionDigits: 0 })}`;
const digits = (value) => String(value || '').replace(/[^0-9]/g, '');
const storeKey = (businessProfileId) => `icanera_receive_request_${businessProfileId}`;
const readSaved = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
const writeSaved = (key, value) => {
  try { if (value) localStorage.setItem(key, value); else localStorage.removeItem(key); } catch { /* private mode */ }
};

export default function ReceiveRequestForm({ businessProfileId, businessName, info }) {
  const { user, loading: authLoading } = useAuth();
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [request, setRequest] = useState(null);
  const [showAuth, setShowAuth] = useState(false);
  const key = storeKey(businessProfileId);

  // Follow a request filed earlier (the page may have been closed while the owner decided).
  useEffect(() => {
    if (!user) { setRequest(null); return undefined; }
    const savedId = readSaved(key);
    if (!savedId) return undefined;
    let cancelled = false;
    getReceiveRequest(savedId)
      .then((r) => { if (!cancelled) setRequest(r); })
      .catch(() => writeSaved(key, null));
    return () => { cancelled = true; };
  }, [user, key]);

  const refresh = useCallback(async () => {
    if (!request?.id) return;
    try { setRequest(await getReceiveRequest(request.id)); } catch { /* keep showing the last state */ }
  }, [request?.id]);

  // The owner may decide at any moment while it is pending: keep it fresh.
  useEffect(() => {
    if (request?.status !== 'pending') return undefined;
    const timer = setInterval(() => { if (!document.hidden) refresh(); }, 6000);
    return () => clearInterval(timer);
  }, [request?.status, refresh]);

  const numeric = Number(digits(amount));

  const submit = async (event) => {
    event.preventDefault();
    if (!user) { setShowAuth(true); return; }
    setError('');
    if (!numeric || numeric < info.min_ugx || numeric > info.max_ugx) {
      setError(`Enter an amount between ${formatMoney(info.min_ugx)} and ${formatMoney(info.max_ugx)}`);
      return;
    }
    if (note.trim().length < 3) { setError('Say what the money is for'); return; }
    setBusy(true);
    try {
      const created = await submitReceiveRequest({
        businessProfileId, amount: numeric, note: note.trim(), phone: phone.trim() || null,
      });
      writeSaved(key, created.id);
      setRequest(created);
    } catch (err) {
      setError(err.message || 'Could not send your request. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const startNew = () => {
    writeSaved(key, null);
    setRequest(null);
    setAmount('');
    setNote('');
    setError('');
  };

  const inputClass = 'nb-input w-full rounded-xl px-3.5 py-3 text-base min-h-[48px]';
  const primaryClass = 'w-full min-h-[48px] py-3 rounded-xl nb-btn-primary font-semibold flex items-center justify-center gap-2 disabled:opacity-50 transition';
  const name = businessName || info.issuer_name || 'the business';

  const status = request?.status;

  return (
    <div className="space-y-3">
      {status === 'pending' && (
        <div className="nb-surface-alt border nb-border rounded-xl p-4 text-center space-y-2">
          <Clock className="w-8 h-8 mx-auto nb-text-muted" />
          <p className="font-semibold nb-text">Request sent — waiting for {name}</p>
          <p className="text-sm nb-text-muted leading-relaxed">
            {formatMoney(request.amount_ugx)} for “{request.note}”. The owner has been notified and must approve it with their
            business-wallet PIN. If approved, the money goes into your IcanEra wallet. Keep this page open — it updates by itself.
          </p>
        </div>
      )}

      {status === 'paid' && (
        <div className="nb-surface-alt border nb-border rounded-xl p-4 text-center space-y-2">
          <CheckCircle2 className="w-9 h-9 mx-auto text-green-600" />
          <p className="font-semibold nb-text">Approved — the money is in your IcanEra wallet</p>
          <p className="text-sm nb-text-muted">{formatMoney(request.amount_ugx)} from {name}.</p>
          <button type="button" onClick={startNew} className="nb-link text-sm font-semibold min-h-[44px]">Make another request</button>
        </div>
      )}

      {(status === 'declined' || status === 'expired') && (
        <div className="nb-surface-alt border nb-border rounded-xl p-4 text-center space-y-2">
          <XCircle className="w-9 h-9 mx-auto text-red-600" />
          <p className="font-semibold nb-text">{status === 'declined' ? 'Request not approved' : 'Request expired'}</p>
          <p className="text-sm nb-text-muted">
            {status === 'declined'
              ? (request.decline_note || `${name} did not approve this request.`)
              : `${name} did not decide within 48 hours. Nothing was paid.`}
          </p>
          <button type="button" onClick={startNew} className="nb-link text-sm font-semibold min-h-[44px]">Make a new request</button>
        </div>
      )}

      {!request && (
        <form onSubmit={submit} className="space-y-3">
          <div className="nb-surface-alt border nb-border rounded-xl p-3 space-y-2">
            <input className={inputClass} placeholder="What is the money for?" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
            <input
              className={inputClass} placeholder="Amount (UGX)" inputMode="numeric"
              value={amount ? Number(digits(amount)).toLocaleString('en-UG') : ''} onChange={(e) => setAmount(digits(e.target.value))}
            />
            <input className={inputClass} placeholder="Your phone (optional)" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" />
          </div>
          {error && <p className="nb-error-text text-sm">{error}</p>}
          <button type="submit" disabled={busy || authLoading} className={primaryClass}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wallet className="w-4 h-4" />}
            {user ? `Request ${numeric ? formatMoney(numeric) : 'money'}` : 'Sign in to request money'}
          </button>
          <p className="text-xs nb-text-faint text-center leading-relaxed">
            Nothing is paid until {name}&rsquo;s owner approves. Approved money is paid into your IcanEra wallet
            {user ? '' : ' — a free account is needed'} (up to {formatMoney(info.max_ugx)} per request).
          </p>
        </form>
      )}

      {showAuth && (
        <div className="fixed inset-0 z-[60] overflow-y-auto bg-white">
          <button type="button" onClick={() => setShowAuth(false)} aria-label="Close"
            className="fixed top-3 right-3 z-[61] w-11 h-11 rounded-full bg-gray-100 flex items-center justify-center text-gray-700">
            <X className="w-5 h-5" />
          </button>
          <AuthPage initialView="signup" onAuthSuccess={() => setShowAuth(false)} />
        </div>
      )}
    </div>
  );
}
