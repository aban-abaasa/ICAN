import React, { useState } from 'react';
import { Check, Loader, ShieldCheck, X } from 'lucide-react';
import { decidePaymentRequest } from '../services/publicTransactionService';

/**
 * A customer has paid a QR bill (cash claim, IcanEra wallet, Mobile Money, card or bank). An
 * authorised person approves it here — from the notification or from the QR Pay tab. Approving records
 * the sale; rejecting returns the money and reopens the bill with the reason shown to the customer.
 * Self-contained colours so it works inside both the light entry form and the dark notification inbox.
 */

const money = (n) => `UGX ${Number(n || 0).toLocaleString('en-UG', { maximumFractionDigits: 0 })}`;
const VIA = {
  cash: 'cash (they say they handed it over)',
  wallet: 'their IcanEra wallet (coins are held)',
  guest: 'Mobile Money, card or bank (money is held)',
};

export default function QrApprovalCard({ request, onDecided }) {
  const [busy, setBusy] = useState(null); // 'approve' | 'reject'
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  if (!request || request.status !== 'pending_approval') return null;

  const decide = async (approve) => {
    setError('');
    setNote('');
    setBusy(approve ? 'approve' : 'reject');
    try {
      const { request: next, refund } = await decidePaymentRequest(request.id, approve, approve ? null : reason.trim() || null);
      if (!approve && refund) {
        setNote(refund.success === false
          ? (refund.error || 'The refund could not be sent automatically — contact support.')
          : 'Rejected. The Mobile Money / card payment is being refunded.');
      }
      onDecided?.(next, { approved: approve, refund });
    } catch (err) {
      setError(err.message || 'Could not record your decision.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rounded-xl border-2 border-amber-400 bg-amber-50 p-4 text-gray-900">
      <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-amber-800"><ShieldCheck className="w-4 h-4" /> Needs your approval</p>
      <p className="mt-1 text-xl font-extrabold">{money(request.amount_ugx)}</p>
      <p className="text-sm text-gray-700">{request.description}</p>
      <p className="mt-2 text-sm">
        <b>{request.pending_payer_name || 'A customer'}</b>
        {request.pending_payer_phone ? ` (${request.pending_payer_phone})` : ''} paid with {VIA[request.pending_via] || 'a payment'}.
      </p>
      <p className="mt-1 text-[11px] text-gray-600">
        {request.pending_via === 'cash'
          ? 'Only approve once you really have the cash in your hand.'
          : 'Approve to receive the money and record the sale. Reject to send it back.'}
      </p>

      {rejecting && (
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value.slice(0, 200))}
          placeholder="Reason shown to the customer (optional)"
          className="mt-3 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-amber-500"
        />
      )}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      {note && <p className="mt-2 text-xs text-amber-800">{note}</p>}

      <div className="mt-3 grid grid-cols-2 gap-2">
        {!rejecting ? (
          <>
            <button type="button" disabled={!!busy} onClick={() => decide(true)}
              className="flex items-center justify-center gap-1.5 rounded-xl bg-green-600 py-2.5 text-sm font-bold text-white disabled:opacity-60">
              {busy === 'approve' ? <Loader className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Approve
            </button>
            <button type="button" disabled={!!busy} onClick={() => setRejecting(true)}
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
              className="rounded-xl border border-gray-300 bg-white py-2.5 text-sm font-bold text-gray-700 disabled:opacity-60">
              Back
            </button>
          </>
        )}
      </div>
    </div>
  );
}
