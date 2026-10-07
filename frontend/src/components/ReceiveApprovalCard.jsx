import React, { useState } from 'react';
import { Check, Loader, LockKeyhole, X } from 'lucide-react';
import { decideReceiveRequest } from '../services/publicTransactionService';

/**
 * A client asked the business for money on its website. An owner / co-owner decides here (from the wallet
 * notification): approving needs the business-wallet PIN and pays the amount from the business wallet into the
 * client's IcanEra wallet; rejecting pays nothing and tells the client why. Self-contained colours so it works
 * inside the dark notification inbox.
 */

const money = (n) => `UGX ${Number(n || 0).toLocaleString('en-UG', { maximumFractionDigits: 0 })}`;

export default function ReceiveApprovalCard({ request, onDecided }) {
  const [pin, setPin] = useState('');
  const [reason, setReason] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [busy, setBusy] = useState(null); // 'approve' | 'reject'
  const [error, setError] = useState('');

  if (!request || request.status !== 'pending') return null;

  const decide = async (approve) => {
    setError('');
    if (approve && !/^\d{4,6}$/.test(pin)) { setError('Enter the 4-6 digit business-wallet PIN.'); return; }
    setBusy(approve ? 'approve' : 'reject');
    try {
      const next = await decideReceiveRequest(request.id, approve, { pin: approve ? pin : null, note: approve ? null : reason.trim() || null });
      setPin('');
      onDecided?.(next, { approved: approve });
    } catch (err) {
      setPin('');
      setError(err.message || 'Could not record your decision.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rounded-xl border-2 border-amber-400 bg-amber-50 p-4 text-gray-900">
      <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-amber-800"><LockKeyhole className="w-4 h-4" /> Payout needs your approval</p>
      <p className="mt-1 text-xl font-extrabold">{money(request.amount_ugx)}</p>
      <p className="text-sm text-gray-700">“{request.note}”</p>
      <p className="mt-2 text-sm">
        <b>{request.requester_name}</b>{request.requester_phone ? ` (${request.requester_phone})` : ''} asks {request.issuer_name || 'the business'} for this money.
      </p>
      <p className="mt-1 text-[11px] text-gray-600">Approving pays it from the business wallet into their IcanEra wallet. Only approve if you owe it.</p>

      {rejecting ? (
        <input
          type="text" value={reason} onChange={(e) => setReason(e.target.value.slice(0, 200))}
          placeholder="Reason shown to the client (optional)"
          className="mt-3 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-amber-500"
        />
      ) : (
        <input
          type="password" inputMode="numeric" maxLength={6} value={pin} autoComplete="off"
          onChange={(e) => setPin(e.target.value.replace(/[^0-9]/g, ''))} placeholder="Business-wallet PIN"
          className="mt-3 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-center text-sm tracking-[0.4em] text-gray-900 focus:outline-none focus:border-amber-500"
        />
      )}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

      <div className="mt-3 grid grid-cols-2 gap-2">
        {!rejecting ? (
          <>
            <button type="button" disabled={!!busy} onClick={() => decide(true)}
              className="flex items-center justify-center gap-1.5 rounded-xl bg-green-600 py-2.5 text-sm font-bold text-white disabled:opacity-60">
              {busy === 'approve' ? <Loader className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Approve &amp; pay
            </button>
            <button type="button" disabled={!!busy} onClick={() => { setRejecting(true); setError(''); }}
              className="flex items-center justify-center gap-1.5 rounded-xl border border-red-300 bg-white py-2.5 text-sm font-bold text-red-700 disabled:opacity-60">
              <X className="w-4 h-4" /> Reject
            </button>
          </>
        ) : (
          <>
            <button type="button" disabled={!!busy} onClick={() => decide(false)}
              className="flex items-center justify-center gap-1.5 rounded-xl bg-red-600 py-2.5 text-sm font-bold text-white disabled:opacity-60">
              {busy === 'reject' ? <Loader className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />} Confirm reject
            </button>
            <button type="button" disabled={!!busy} onClick={() => { setRejecting(false); setReason(''); }}
              className="rounded-xl border border-gray-300 bg-white py-2.5 text-sm font-bold text-gray-700 disabled:opacity-60">Back</button>
          </>
        )}
      </div>
    </div>
  );
}
