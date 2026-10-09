import React, { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { QRCodeCanvas } from 'qrcode.react';
import { Check, ChevronDown, ChevronUp, Copy, Loader, Printer, QrCode } from 'lucide-react';
import { buildPayCodeLink, getMyPayCode, getReceiveSettings, updateMyPayCode, updateReceiveSettings } from '../services/publicTransactionService';

/**
 * The business's PERMANENT pay QR: print it once and stick it on the counter. Any customer scans it, types
 * any amount (or lists what they are buying with prices), pays with cash / IcanEra wallet / Mobile Money /
 * card / bank and gets a receipt. Each payment reaches the owner's notifications for approval (unless
 * approval is switched off here). Collapsed by default; it only loads when opened.
 */

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => `UGX ${Number(n || 0).toLocaleString('en-UG', { maximumFractionDigits: 0 })}`;

export default function StandingPayQr({ businessProfileId, businessName, needsBusiness }) {
  const [open, setOpen] = useState(false);
  const [paycode, setPaycode] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [max, setMax] = useState('');
  // "Let clients request money from us" (business only): { enabled, max_ugx, can_change }
  const [recv, setRecv] = useState(null);
  const [recvMax, setRecvMax] = useState('');
  const loadedFor = useRef(null);

  useEffect(() => {
    if (!open || needsBusiness) return;
    const key = businessProfileId || 'personal';
    if (loadedFor.current === key) return;
    loadedFor.current = key;
    setLoading(true);
    setError('');
    setPaycode(null);
    setRecv(null);
    getMyPayCode(businessProfileId || null)
      .then((pc) => {
        setPaycode(pc);
        setMax(String(Math.round(Number(pc.max_amount_ugx))));
        if (businessProfileId) {
          getReceiveSettings(businessProfileId)
            .then((r) => { setRecv(r); setRecvMax(String(Math.round(Number(r.max_ugx)))); })
            .catch(() => setRecv(null)); // receive SQL not installed yet: no switch
        }
      })
      .catch((err) => { setError(err.message || 'Could not load your pay QR.'); loadedFor.current = null; })
      .finally(() => setLoading(false));
  }, [open, businessProfileId, needsBusiness]);

  const link = paycode ? buildPayCodeLink(paycode) : '';

  const save = async (patch) => {
    setError('');
    setSaving(true);
    try {
      const next = await updateMyPayCode(paycode.id, patch);
      setPaycode(next);
      setMax(String(Math.round(Number(next.max_amount_ugx))));
    } catch (err) {
      setError(err.message || 'Could not save.');
    } finally {
      setSaving(false);
    }
  };

  const saveReceive = async (patch) => {
    setError('');
    setSaving(true);
    try {
      const next = await updateReceiveSettings(businessProfileId, patch);
      setRecv(next);
      setRecvMax(String(Math.round(Number(next.max_ugx))));
    } catch (err) {
      setError(err.message || 'Could not save.');
    } finally {
      setSaving(false);
    }
  };

  const copy = async () => {
    try { await navigator.clipboard?.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* clipboard blocked */ }
  };

  // A poster for the counter: big QR, plain words, the ways to pay.
  const printPoster = async () => {
    setError('');
    try {
      const qr = await QRCode.toDataURL(link, { margin: 1, width: 560 });
      const title = paycode.title || businessName || 'Pay here';
      const html = `<!doctype html><html><head><meta charset="utf-8"><title>Pay ${escapeHtml(title)}</title><style>
        @page{margin:10mm}body{font-family:Georgia,'Times New Roman',serif;color:#25253f;text-align:center;max-width:420px;margin:auto;padding:14px}
        .band{background:#312e81;color:#fffdf8;border-bottom:5px solid #c4a052;padding:18px 12px;border-radius:10px 10px 0 0;-webkit-print-color-adjust:exact;print-color-adjust:exact}
        .eyebrow{font:700 11px system-ui,sans-serif;letter-spacing:.2em;text-transform:uppercase;color:#e6c877}
        h1{font-size:28px;margin:6px 0 0}.box{border:1px solid #e6d8b2;border-top:0;border-radius:0 0 10px 10px;padding:18px 12px;background:#fffdf8}
        img{width:300px;height:300px}.big{font-size:20px;font-weight:700;margin:8px 0 2px}.sm{font:13px system-ui,sans-serif;color:#555;margin:4px 0}
        .m{display:inline-block;border:1px solid #c4a052;border-radius:14px;padding:3px 11px;margin:3px;font:600 12px system-ui,sans-serif}
        .url{word-break:break-all;font:10px system-ui,sans-serif;color:#666;margin-top:10px}
      </style></head><body>
        <div class="band"><div class="eyebrow">Pay with IcanEra</div><h1>${escapeHtml(title)}</h1></div>
        <div class="box">
          <div class="big">Scan to pay — any amount</div>
          <div class="sm">Type what you are paying for and the price. Get your receipt on your phone.</div>
          <img src="${qr}" alt="QR"/>
          <div><span class="m">IcanEra wallet</span><span class="m">Mobile Money</span><span class="m">Card</span><span class="m">Bank</span><span class="m">Cash</span></div>
          <div class="url">${escapeHtml(link)}</div>
        </div>
        <script>window.onload=function(){setTimeout(function(){window.print()},250)}<\/script></body></html>`;
      const win = window.open('', '_blank', 'width=480,height=760');
      if (!win) { setError('Allow pop-ups for this site to print the poster.'); return; }
      win.document.write(html);
      win.document.close();
    } catch (err) {
      setError(err.message || 'Could not prepare the poster for printing.');
    }
  };

  return (
    <div className="rounded-xl border-2 border-amber-300 bg-amber-50/60 text-gray-900">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full min-h-[48px] items-center gap-2 px-4 py-2.5 text-left"
      >
        <QrCode className="h-4 w-4 flex-shrink-0 text-amber-800" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold text-gray-900">Permanent pay QR</span>
          <span className="block text-[11px] text-gray-600">Print once — customers pay any amount on your website</span>
        </span>
        {open ? <ChevronUp className="h-4 w-4 text-gray-500" /> : <ChevronDown className="h-4 w-4 text-gray-500" />}
      </button>

      {open && (
        <div className="space-y-3 border-t border-amber-200 px-4 pb-4 pt-3">
          {needsBusiness ? (
            <p className="text-xs text-gray-700">Pick which business this is for (above) to see its permanent QR.</p>
          ) : loading ? (
            <p className="flex items-center gap-2 text-xs text-gray-600"><Loader className="h-3.5 w-3.5 animate-spin" /> Loading…</p>
          ) : paycode ? (
            <>
              <div className="flex items-center gap-3">
                <div className="flex-shrink-0 rounded-lg bg-white p-1.5 shadow"><QRCodeCanvas value={link} size={116} /></div>
                <div className="min-w-0 text-xs text-gray-700">
                  <p className="text-sm font-bold text-gray-900">{paycode.title || businessName || 'Pay here'}</p>
                  <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${paycode.active ? 'bg-green-100 text-green-800' : 'bg-gray-200 text-gray-600'}`}>
                    {paycode.active ? 'ON — taking payments' : 'OFF'}
                  </span>
                  <p className="mt-1.5 break-all font-mono text-[9px] text-gray-500">{link}</p>
                  <p className="mt-1 text-[11px] text-gray-600">{paycode.company_id ? "Opens the Pay tab of your public website." : "Opens a simple pay page (your business has no public website page yet)."}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={printPoster} className="flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-indigo-700 px-3 text-sm font-bold text-white">
                  <Printer className="h-4 w-4" /> Print poster
                </button>
                <button type="button" onClick={copy} className="flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-amber-400 bg-white px-3 text-sm font-bold text-gray-800">
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {copied ? 'Copied' : 'Copy link'}
                </button>
              </div>

              <label className="flex min-h-[44px] cursor-pointer items-start gap-2 rounded-lg bg-white px-3 py-2 text-xs text-gray-700">
                <input type="checkbox" checked={paycode.approval_required} disabled={saving}
                  onChange={(e) => save({ approvalRequired: e.target.checked })} className="mt-0.5 h-4 w-4 accent-indigo-700" />
                <span>
                  <b className="text-gray-900">Approve each payment</b>
                  <span className="block text-gray-500">You (and finance staff) get a notification for every payment and approve it before it is recorded.</span>
                </span>
              </label>

              <div className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-xs text-gray-700">
                <span className="flex-1">Biggest amount a customer can enter</span>
                <input
                  type="text" inputMode="numeric" value={max ? Number(max).toLocaleString('en-UG') : ''}
                  onChange={(e) => setMax(e.target.value.replace(/[^0-9]/g, ''))}
                  onBlur={() => { if (max && Number(max) !== Math.round(Number(paycode.max_amount_ugx))) save({ maxAmount: Number(max) }); }}
                  className="w-32 rounded-md border border-gray-300 px-2 py-2 text-right text-base text-gray-900 focus:border-indigo-500 focus:outline-none"
                  aria-label="Biggest amount in UGX"
                />
              </div>
              <p className="text-[11px] text-gray-500">Currently up to {money(paycode.max_amount_ugx)} per payment.</p>

              {recv && (
                <div className="space-y-2 rounded-lg bg-white px-3 py-2 text-xs text-gray-700">
                  <label className="flex min-h-[44px] cursor-pointer items-start gap-2">
                    <input type="checkbox" checked={recv.enabled} disabled={saving || !recv.can_change}
                      onChange={(e) => saveReceive({ enabled: e.target.checked })} className="mt-0.5 h-4 w-4 accent-indigo-700" />
                    <span>
                      <b className="text-gray-900">Let clients request money from this business</b>
                      <span className="block text-gray-500">
                        Adds a “Receive” side to your website&rsquo;s Pay tab. Nothing is paid until an owner or co-owner approves each request with the business-wallet PIN.
                        {!recv.can_change && ' Only an owner or co-owner can change this.'}
                      </span>
                    </span>
                  </label>
                  {recv.enabled && (
                    <div className="flex items-center gap-2">
                      <span className="flex-1">Biggest request</span>
                      <input
                        type="text" inputMode="numeric" value={recvMax ? Number(recvMax).toLocaleString('en-UG') : ''} disabled={!recv.can_change}
                        onChange={(e) => setRecvMax(e.target.value.replace(/[^0-9]/g, ''))}
                        onBlur={() => { if (recvMax && Number(recvMax) !== Math.round(Number(recv.max_ugx))) saveReceive({ maxUgx: Number(recvMax) }); }}
                        className="w-32 rounded-md border border-gray-300 px-2 py-2 text-right text-base text-gray-900 focus:border-indigo-500 focus:outline-none"
                        aria-label="Biggest request in UGX"
                      />
                    </div>
                  )}
                </div>
              )}

              <button type="button" disabled={saving} onClick={() => save({ active: !paycode.active })}
                className={`min-h-[44px] w-full rounded-xl text-sm font-bold ${paycode.active ? 'border border-red-300 bg-white text-red-700' : 'bg-green-600 text-white'} disabled:opacity-60`}>
                {saving ? 'Saving…' : paycode.active ? 'Switch this QR off' : 'Switch this QR on'}
              </button>
            </>
          ) : null}
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
      )}
    </div>
  );
}
