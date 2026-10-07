import React, { useCallback, useEffect, useState } from 'react';
import { BellRing, ChevronDown, ChevronUp } from 'lucide-react';
import { listPaymentRequests } from '../services/publicTransactionService';
import QrApprovalCard from './QrApprovalCard';

/**
 * "Payments waiting for your approval": every QR payment (cash claim, wallet, Mobile Money, card or bank) that a
 * customer has made and an authorised person still has to approve. It sits on the dashboard so the approver does not
 * have to hunt for the notification: Approve / Reject is right here.
 *
 * Shows nothing at all when nothing is waiting. Polls gently (every 2 minutes, paused while the tab is hidden) —
 * the phone alert and the wallet inbox are the instant channels.
 */
const POLL_MS = 120000;

export default function PendingQrApprovals({ onDecided }) {
  const [pending, setPending] = useState([]);
  const [open, setOpen] = useState(true);

  const load = useCallback(async () => {
    try {
      const rows = await listPaymentRequests(30);
      setPending(rows.filter((r) => r.status === 'pending_approval'));
    } catch { /* not signed in, or the QR payments SQL is not installed yet: show nothing */ }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(() => { if (!document.hidden) load(); }, POLL_MS);
    const onVisible = () => { if (!document.hidden) load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [load]);

  if (pending.length === 0) return null;

  return (
    <div className="mx-4 mt-4 rounded-2xl border-2 border-amber-400 bg-amber-50 text-gray-900 shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex min-h-[48px] w-full items-center gap-2 px-4 py-2.5 text-left"
      >
        <BellRing className="h-5 w-5 flex-shrink-0 text-amber-700" />
        <span className="min-w-0 flex-1 text-sm font-bold text-gray-900">
          {pending.length} payment{pending.length > 1 ? 's' : ''} waiting for your approval
        </span>
        {open ? <ChevronUp className="h-4 w-4 text-gray-500" /> : <ChevronDown className="h-4 w-4 text-gray-500" />}
      </button>
      {open && (
        <div className="space-y-3 px-3 pb-3">
          {pending.map((request) => (
            <QrApprovalCard
              key={request.id}
              request={request}
              onDecided={(next) => {
                setPending((prev) => prev.filter((r) => r.id !== request.id));
                load();
                if (onDecided) onDecided(next);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
