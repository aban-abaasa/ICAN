import React, { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { QRCodeCanvas } from 'qrcode.react';
import { Check, CheckCircle2, Copy, Loader, Printer, QrCode, RefreshCw, X } from 'lucide-react';
import QrApprovalCard from './QrApprovalCard';
import StandingPayQr from './StandingPayQr';
import {
  buildPublicReceiptLink,
  cancelPaymentRequest,
  createPaymentRequest,
  getPaymentRequest,
  listPaymentRequests,
  markPaymentRequestCash,
} from '../services/publicTransactionService';

/**
 * The "QR Pay" tab of the transaction entry form.
 *
 * Turns what was typed ("Sold soda 3 5k") into a printable QR bill the customer scans — no account
 * needed. They pay with cash (the owner confirms it here), the IcanEra wallet, Mobile Money, card
 * or bank. Nothing is written to the ledger until the money is in: the moment it is, the real
 * income entry is created, so reports and the transactions list pick it up like any other sale.
 */

const money = (n) => `UGX ${Number(n || 0).toLocaleString('en-UG', { maximumFractionDigits: 0 })}`;
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const VIA = { cash: 'cash', wallet: 'an IcanEra wallet', guest: 'Mobile Money, card or bank' };
const STATUS_CHIP = {
  open: 'bg-amber-100 text-amber-800',
  pending_approval: 'bg-orange-100 text-orange-800',
  paid: 'bg-green-100 text-green-800',
  cancelled: 'bg-gray-200 text-gray-600',
};

// The entry form's own bookkeeping for this sale (the server keeps only plain whitelisted fields).
const buildMeta = (parsed, { mode, rawInput, receiptRef }) => {
  const meta = {
    category: parsed.detectedCategory,
    categoryName: parsed.categoryName,
    accounting_type: parsed.businessAccountingType,
    reporting_bucket: parsed.reportingBucket,
    product_name: parsed.productName,
    product_action: parsed.productAction,
    ledger_side: parsed.ledgerSide,
    raw_entry_text: parsed.originalText || rawInput,
    entry_mode: mode === 'business' ? 'professional_business' : 'personal_quick',
    record_category: mode === 'business' ? 'business' : 'personal',
    quantity: parsed.quantity,
    unit_price: parsed.unitPrice,
    receipt_ref: receiptRef || null,
  };
  Object.keys(meta).forEach((k) => {
    if (meta[k] === null || meta[k] === undefined || meta[k] === '' || !['string', 'number'].includes(typeof meta[k])) delete meta[k];
  });
  return meta;
};

export default function QrPaymentPanel({ parsed, rawInput, mode, businessProfileId, businessName, receiptRef, blocked, onPaid }) {
  const [request, setRequest] = useState(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(null); // 'cash' | 'cancel'
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [recent, setRecent] = useState([]);
  const [requireApproval, setRequireApproval] = useState(true);
  const notifiedRef = useRef(null);
  const onPaidRef = useRef(onPaid);
  onPaidRef.current = onPaid;

  const refreshRecent = useCallback(() => {
    listPaymentRequests(6).then(setRecent).catch(() => { /* list is a convenience */ });
  }, []);
  useEffect(() => { refreshRecent(); }, [refreshRecent]);

  // Tell the form (and so the reports) once, the first time a bill is seen paid.
  const apply = useCallback((next) => {
    setRequest(next);
    if (next?.status === 'paid' && notifiedRef.current !== next.id) {
      notifiedRef.current = next.id;
      onPaidRef.current?.(next);
      refreshRecent();
    }
  }, [refreshRecent]);

  // Watch an open bill: the customer may pay at any moment, by any method.
  const openId = request && ['open', 'pending_approval'].includes(request.status) ? request.id : null;
  useEffect(() => {
    if (!openId) return undefined;
    let cancelled = false;
    const timer = setInterval(() => {
      if (document.hidden) return;
      getPaymentRequest(openId).then((next) => { if (!cancelled) apply(next); }).catch(() => {});
    }, 4000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [openId, apply]);

  const canGenerate = Boolean(parsed?.isValid && parsed.isIncome && !blocked && !creating);

  const generate = async () => {
    setError('');
    if (!parsed?.isValid) { setError('Type what you are selling first, e.g. "Sold soda 3 5k".'); return; }
    if (!parsed.isIncome) { setError('A QR bill is for money coming IN — e.g. "Sold soda 3 5k". Use the other tabs to record money going out.'); return; }
    setCreating(true);
    try {
      const created = await createPaymentRequest({
        amount: parsed.amount,
        description: parsed.description,
        businessProfileId: mode === 'business' ? (businessProfileId || null) : null,
        meta: buildMeta(parsed, { mode, rawInput, receiptRef }),
        requireApproval,
      });
      notifiedRef.current = null;
      setRequest(created);
      refreshRecent();
    } catch (err) {
      setError(err.message || 'Could not create the QR.');
    } finally {
      setCreating(false);
    }
  };

  const confirmCash = async () => {
    setError('');
    setBusy('cash');
    try { apply(await markPaymentRequestCash(request.id)); } catch (err) { setError(err.message); } finally { setBusy(null); }
  };

  const cancel = async () => {
    setError('');
    setBusy('cancel');
    try { apply(await cancelPaymentRequest(request.id)); refreshRecent(); } catch (err) { setError(err.message); } finally { setBusy(null); }
  };

  const link = request ? buildPublicReceiptLink(request.code) : '';

  const copyLink = async () => {
    try { await navigator.clipboard?.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* clipboard blocked */ }
  };

  // Big, print-ready page: works on a receipt printer or A4, to stick on the counter.
  const print = async () => {
    setError('');
    try {
      const qr = await QRCode.toDataURL(link, { margin: 1, width: 420 });
      const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(request.receipt_number)}</title><style>
        @page{margin:8mm}body{font:14px Georgia,serif;color:#111;max-width:340px;margin:auto;padding:10px;text-align:center}
        h1{font-size:18px;margin:0}.sub{color:#555;font-size:12px;margin:2px 0 10px}.amt{font-size:28px;font-weight:bold;margin:8px 0 2px}
        .for{margin:0 0 8px}img{width:240px;height:240px}.how{font-size:12px;margin:6px 0}.url{word-break:break-all;font-size:10px;color:#444}
        .m{display:inline-block;border:1px solid #999;border-radius:12px;padding:2px 9px;margin:2px;font-size:11px}
      </style></head><body>
        <h1>${escapeHtml(businessName || 'Pay here')}</h1><div class="sub">Scan to pay — no account needed</div>
        <div class="amt">${escapeHtml(money(request.amount_ugx))}</div><div class="for">${escapeHtml(request.description)}</div>
        <img src="${qr}" alt="QR"/>
        <div class="how"><span class="m">IcanEra wallet</span><span class="m">Mobile Money</span><span class="m">Card</span><span class="m">Bank</span><span class="m">Cash</span></div>
        <div class="how">Paying cash? Hand it over and show this page.</div>
        <div class="url">${escapeHtml(link)}</div><div class="sub">Bill no. ${escapeHtml(request.receipt_number)}</div>
        <script>window.onload=function(){setTimeout(function(){window.print()},250)}<\/script></body></html>`;
      const win = window.open('', '_blank', 'width=420,height=720');
      if (!win) { setError('Allow pop-ups for this site to print the QR.'); return; }
      win.document.write(html);
      win.document.close();
    } catch (err) {
      setError(err.message || 'Could not prepare the QR for printing.');
    }
  };

  // ── A QR bill is showing ──────────────────────────────────────────────────
  if (request) {
    const paid = request.status === 'paid';
    const cancelled = request.status === 'cancelled';
    const pending = request.status === 'pending_approval';
    return (
      <div className="rounded-xl border-2 border-indigo-200 bg-indigo-50/60 p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-indigo-700"><QrCode className="w-4 h-4" /> QR bill · {request.receipt_number}</p>
          <button type="button" onClick={() => setRequest(null)} className="p-1 text-gray-500 hover:text-gray-800" aria-label="Close this QR"><X className="w-4 h-4" /></button>
        </div>

        <div className="text-center">
          <p className="text-2xl font-extrabold text-gray-900">{money(request.amount_ugx)}</p>
          <p className="text-sm text-gray-600">{request.description}</p>
        </div>

        {pending ? (
          <QrApprovalCard request={request} onDecided={(next) => { apply(next); refreshRecent(); }} />
        ) : paid ? (
          <div className="rounded-lg border border-green-300 bg-green-50 p-4 text-center">
            <CheckCircle2 className="w-9 h-9 mx-auto text-green-600" />
            <p className="font-bold text-green-800 mt-1">Paid ✓</p>
            <p className="text-xs text-green-700 mt-0.5">
              {request.payer_name ? `${request.payer_name} paid with ` : 'Paid with '}{VIA[request.paid_via] || 'a customer'}.
              Added to your transactions and reports.
            </p>
          </div>
        ) : cancelled ? (
          <p className="rounded-lg bg-gray-100 p-3 text-center text-sm text-gray-600">This QR bill was cancelled.</p>
        ) : (
          <>
            <div className="flex justify-center"><div className="rounded-xl bg-white p-2 shadow"><QRCodeCanvas value={link} size={190} /></div></div>
            <p className="flex items-center justify-center gap-2 text-xs text-indigo-800 font-semibold"><Loader className="w-3.5 h-3.5 animate-spin" /> Waiting for payment…</p>
            {request.last_reject_note && <p className="text-center text-[11px] text-red-600">Last payment rejected: {request.last_reject_note}</p>}
            <div className="flex flex-wrap justify-center gap-1.5 text-[11px] font-semibold text-gray-700">
              {['💵 Cash', '🪙 IcanEra wallet', '📱 Mobile Money', '💳 Card', '🏦 Bank'].map((m) => (
                <span key={m} className="rounded-full bg-white border border-indigo-200 px-2.5 py-1">{m}</span>
              ))}
            </div>
            <p className="text-[11px] text-center text-gray-500">
              {request.approval_required
                ? 'The customer scans and pays. You (and anyone with finance access) get a notification to approve it — only then is it recorded. Cash in your hand? Tap "Cash received".'
                : 'The customer scans, picks how to pay, and it is recorded the moment it arrives. Cash: take it, then tap "Cash received".'}
            </p>
          </>
        )}

        {error && <p className="text-xs text-red-600 text-center">{error}</p>}

        <div className="grid grid-cols-2 gap-2">
          {!paid && !cancelled && !pending && (
            <button type="button" onClick={confirmCash} disabled={!!busy} className="col-span-2 flex items-center justify-center gap-2 rounded-xl bg-green-600 py-2.5 text-sm font-bold text-white disabled:opacity-60">
              {busy === 'cash' ? <Loader className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} 💵 Cash received
            </button>
          )}
          <button type="button" onClick={print} className="flex items-center justify-center gap-2 rounded-xl bg-indigo-600 py-2.5 text-sm font-bold text-white"><Printer className="w-4 h-4" /> Print QR</button>
          <button type="button" onClick={copyLink} className="flex items-center justify-center gap-2 rounded-xl bg-white border border-gray-300 py-2.5 text-sm font-bold text-gray-700">
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />} {copied ? 'Copied' : 'Copy link'}
          </button>
          {!paid && !cancelled && !pending && (
            <button type="button" onClick={cancel} disabled={!!busy} className="col-span-2 text-xs font-semibold text-red-600 py-1 disabled:opacity-60">
              {busy === 'cancel' ? 'Cancelling…' : 'Cancel this QR bill'}
            </button>
          )}
          {(paid || cancelled) && (
            <button type="button" onClick={() => setRequest(null)} className="col-span-2 flex items-center justify-center gap-2 rounded-xl bg-gray-800 py-2.5 text-sm font-bold text-white"><RefreshCw className="w-4 h-4" /> New QR bill</button>
          )}
        </div>
      </div>
    );
  }

  // ── Ready to generate ─────────────────────────────────────────────────────
  return (
    <div className="space-y-3">
      <StandingPayQr
        businessProfileId={mode === 'business' ? (businessProfileId || null) : null}
        businessName={businessName}
        needsBusiness={mode === 'business' && !businessProfileId}
      />
      <div className="rounded-xl border-2 border-indigo-200 bg-indigo-50/60 p-4">
        <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-indigo-700"><QrCode className="w-4 h-4" /> QR Pay — one sale</p>
        <p className="mt-1 text-sm text-gray-700">
          Type the sale above, then make a printable QR. Customers scan it — no account needed — and pay with <b>cash</b>, the <b>IcanEra wallet</b>, <b>Mobile Money</b>, <b>card</b> or <b>bank</b>.
          It reaches your transactions and reports the moment it is paid.
        </p>
        {parsed?.isValid && parsed.isIncome && (
          <p className="mt-2 rounded-lg bg-white px-3 py-2 text-sm font-semibold text-gray-900">{parsed.description} · <span className="text-green-700">{money(parsed.amount)}</span></p>
        )}
        <label className="mt-3 flex cursor-pointer items-start gap-2 rounded-lg bg-white px-3 py-2 text-xs text-gray-700">
          <input type="checkbox" checked={requireApproval} onChange={(e) => setRequireApproval(e.target.checked)} className="mt-0.5 h-4 w-4 accent-indigo-600" />
          <span>
            <b className="text-gray-900">Ask an approver to confirm each payment</b> (recommended)
            <span className="block text-gray-500">When a customer pays, you and anyone with finance access are notified to approve it. Nothing is recorded or credited until then; reject and the money goes back.</span>
          </span>
        </label>
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
        <button
          type="button"
          onClick={generate}
          disabled={!canGenerate}
          className={`mt-3 flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold transition ${canGenerate ? 'bg-indigo-600 text-white active:scale-95' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}
        >
          {creating ? <Loader className="w-4 h-4 animate-spin" /> : <QrCode className="w-4 h-4" />} Generate payment QR
        </button>
      </div>

      {recent.length > 0 && (
        <div>
          <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-gray-500">Recent QR bills</p>
          <div className="space-y-1.5">
            {recent.map((r) => (
              <button key={r.id} type="button" onClick={() => { notifiedRef.current = r.status === 'paid' ? r.id : null; setRequest(r); }}
                className="flex w-full items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-left">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-gray-900">{r.description}</span>
                  <span className="block text-[11px] text-gray-500">{new Date(r.created_at).toLocaleString()}</span>
                </span>
                <span className="text-sm font-bold text-gray-800">{money(r.amount_ugx)}</span>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${STATUS_CHIP[r.status] || STATUS_CHIP.cancelled}`}>{r.status}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
