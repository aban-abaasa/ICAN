import React, { useEffect, useState, useCallback, useRef } from 'react';
import { QRCodeCanvas as QRCode } from 'qrcode.react';
import { CreditCard, Printer, RefreshCw, Check, X, Loader2 } from 'lucide-react';
import {
  getMyDigitalCard, rotateMyCardQr, setMyCardQrEnabled, listCardQrRequests,
  declineCardQrRequest, claimCardQrRequest, finishCardQrRequest, cardQrUrl,
} from '../services/digitalCardService';
import { sendFiatToMobileMoney } from '../services/icanWalletService';
import { walletAccountService } from '../services/walletAccountService';

const CARD_BG = { background: 'linear-gradient(135deg, #1a1f71 0%, #2f6fb0 60%, #1a1f71 100%)' };
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtNumber = (n = '') => String(n).replace(/(\d{4})(?=\d)/g, '$1 ');

/**
 * Wallet -> Cards: the owner's digital card, its scan-to-request QR, and the
 * requests scanners have made. A request only pays out after the owner
 * confirms it here with their transaction PIN.
 */
const DigitalCardPanel = ({ userId, askPin, onPaidOut }) => {
  const [card, setCard] = useState(null);
  const [requests, setRequests] = useState([]);
  const [busyId, setBusyId] = useState(null);
  const [msg, setMsg] = useState(null);
  const [flipped, setFlipped] = useState(false);
  const swipeStart = useRef(null);
  const qrRef = useRef(null);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const [c, r] = await Promise.all([getMyDigitalCard(), listCardQrRequests()]);
      setCard(c);
      setRequests(r);
      setError(null);
    } catch (e) {
      setError(e.message || 'Could not load your card');
    }
  }, []);

  useEffect(() => {
    if (!userId) return undefined;
    refresh();
    const t = setInterval(refresh, 15000);
    return () => clearInterval(t);
  }, [userId, refresh]);

  const confirm = async (req) => {
    setMsg(null);
    const pin = await askPin({
      title: 'Confirm card request',
      message: `Send ${Number(req.amount).toLocaleString()} ${req.currency} to ${req.requester_name} (${req.recipient_phone}, ${req.recipient_network})?`,
    });
    if (pin === null) return;
    setBusyId(req.id);
    try {
      const pinCheck = await walletAccountService.verifyUserPIN(userId, pin);
      if (!pinCheck?.success) throw new Error(pinCheck?.error || 'Incorrect transaction PIN');
      // Claim first so a double tap / second device can never pay it twice.
      const claimed = await claimCardQrRequest(req.id);
      try {
        const result = await sendFiatToMobileMoney({
          amount: Number(claimed.amount),
          currency: claimed.currency,
          recipientPhone: claimed.recipient_phone,
          network: claimed.recipient_network,
          note: claimed.note || `Card request from ${claimed.requester_name}`,
        });
        await finishCardQrRequest(req.id, true, result.reference, null);
        setMsg({ ok: true, text: `Sent ${Number(claimed.amount).toLocaleString()} ${claimed.currency} to ${claimed.requester_name}. It is confirmed with the network shortly and refunded automatically if it fails.` });
        onPaidOut?.();
      } catch (payErr) {
        await finishCardQrRequest(req.id, false, null, payErr.message).catch(() => {});
        throw payErr;
      }
    } catch (e) {
      setMsg({ ok: false, text: e.message || 'Could not complete this request' });
    } finally {
      setBusyId(null);
      refresh();
    }
  };

  const decline = async (req) => {
    setBusyId(req.id);
    try { await declineCardQrRequest(req.id); } catch (e) { setMsg({ ok: false, text: e.message }); }
    setBusyId(null);
    refresh();
  };

  const rotate = async () => {
    if (!window.confirm('Create a new QR code? The old one stops working and open requests are cancelled.')) return;
    try { await rotateMyCardQr(); await refresh(); setMsg({ ok: true, text: 'New QR code created. The old one no longer works.' }); }
    catch (e) { setMsg({ ok: false, text: e.message }); }
  };

  const toggleQr = async () => {
    try { await setMyCardQrEnabled(!card.qr_enabled); await refresh(); } catch (e) { setMsg({ ok: false, text: e.message }); }
  };

  const printCard = () => {
    const c = card;
    const qr = c.qr_enabled && qrRef.current?.toDataURL ? qrRef.current.toDataURL('image/png') : null;
    const e = `${String(c.expiry_month).padStart(2, '0')}/${String(c.expiry_year).slice(-2)}`;
    const w = window.open('', '_blank', 'width=700,height=600');
    if (!w) { setMsg({ ok: false, text: 'Allow pop-ups to print your card.' }); return; }
    w.document.write(`<!doctype html><title>ICANera card</title><style>
      @page{size:auto;margin:10mm}body{margin:0;font-family:Arial,sans-serif;display:flex;flex-direction:column;gap:8mm;align-items:center;padding:10mm}
      .card{width:85.6mm;height:53.98mm;border-radius:3.5mm;position:relative;color:#fff;overflow:hidden;box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact;background:linear-gradient(135deg,#1a1f71,#2f6fb0 60%,#1a1f71)}
      .top{position:absolute;left:5mm;right:5mm;top:4mm;display:flex;justify-content:space-between;font-weight:700}
      .num{position:absolute;left:5mm;right:5mm;top:23mm;font:16px monospace;letter-spacing:2px}
      .bot{position:absolute;left:5mm;right:5mm;bottom:4mm;display:flex;justify-content:space-between;font-size:10px}
      .bar{height:9mm;background:#000b;margin-top:5mm}.qr{display:flex;gap:3mm;align-items:center;padding:3mm 5mm}
      .qr img{width:24mm;height:24mm;background:#fff;padding:1mm;border-radius:1.5mm}.qr p{font-size:8px;margin:0}
      .foot{position:absolute;left:5mm;right:5mm;bottom:3mm;font-size:6px;opacity:.75}
    </style>
    <div class="card"><div class="top"><span>ICANera</span><span style="font-style:italic;font-size:16px">DIGITAL</span></div>
      <div class="num">${fmtNumber(c.card_number)}</div>
      <div class="bot"><div><div style="opacity:.7;font-size:7px">CARD HOLDER</div>${esc(c.holder_name)}</div><div><div style="opacity:.7;font-size:7px">EXPIRES</div>${e}</div></div></div>
    <div class="card"><div class="bar"></div><div class="qr">${qr ? `<img src="${qr}">` : ''}<p>Scan to request money from ${esc(c.holder_name.split(' ')[0])}. Nothing is sent until the owner confirms with their PIN.</p></div>
      <div class="foot">ICANera digital card · not a Visa/Mastercard network card</div></div>
    <script>window.onload=function(){setTimeout(function(){window.print()},300)}<\/script>`);
    w.document.close();
  };

  if (error) return <div className="mb-4 p-4 rounded-lg border bg-red-500/20 border-red-500/50 text-red-400">{error}</div>;
  if (!card) return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>;

  const pending = requests.filter((r) => r.status === 'pending' && new Date(r.expires_at) > new Date());
  const past = requests.filter((r) => !pending.includes(r)).slice(0, 5);
  const exp = `${String(card.expiry_month).padStart(2, '0')}/${String(card.expiry_year).slice(-2)}`;

  return (
    <div className="space-y-4 mb-6">
      {/* The card: tap or swipe to flip between front and back */}
      <div
        style={{ perspective: 1000, maxWidth: 380, touchAction: 'pan-y' }}
        onPointerDown={(e) => { swipeStart.current = e.clientX; }}
        onPointerUp={(e) => {
          if (swipeStart.current === null) return;
          const dx = e.clientX - swipeStart.current;
          swipeStart.current = null;
          if (Math.abs(dx) > 40 || Math.abs(dx) < 6) setFlipped((f) => !f);
        }}
        onPointerCancel={() => { swipeStart.current = null; }}
        role="button" aria-label="Flip card" tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setFlipped((f) => !f); }}
      >
        <div style={{ position: 'relative', aspectRatio: '1.586 / 1', transformStyle: 'preserve-3d', transition: 'transform 0.6s', transform: flipped ? 'rotateY(180deg)' : 'none', cursor: 'pointer' }}>
          {/* Front */}
          <div className="absolute inset-0 rounded-2xl p-5 text-white shadow-xl overflow-hidden"
            style={{ ...CARD_BG, backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' }}>
            <div className="flex items-start justify-between">
              <span className="text-sm font-semibold tracking-wide">ICANera</span>
              <span className="text-2xl font-extrabold italic tracking-tight">DIGITAL</span>
            </div>
            <div className="absolute left-5 right-5" style={{ top: '42%' }}>
              <p className="text-xl sm:text-2xl tracking-[0.18em] font-mono">{fmtNumber(card.card_number)}</p>
            </div>
            <div className="absolute left-5 right-5 bottom-4 flex items-end justify-between">
              <div className="min-w-0">
                <p className="text-[10px] uppercase opacity-70">Card holder</p>
                <p className="text-sm font-semibold truncate">{card.holder_name}</p>
              </div>
              <div className="text-right">
                <p className="text-[10px] uppercase opacity-70">Expires</p>
                <p className="text-sm font-semibold">{exp}</p>
              </div>
            </div>
          </div>
          {/* Back */}
          <div className="absolute inset-0 rounded-2xl text-white shadow-xl overflow-hidden"
            style={{ ...CARD_BG, backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}>
            <div className="h-[16%] bg-black/70 mt-[6%]" />
            <div className="flex items-center gap-3 px-5 mt-[4%]">
              <div className="bg-white p-1.5 rounded-lg shrink-0">
                {card.qr_enabled
                  ? <QRCode ref={qrRef} value={cardQrUrl(card.qr_token)} size={96} level="H" />
                  : <div className="w-24 h-24 flex items-center justify-center text-[10px] text-slate-600 text-center">QR off</div>}
              </div>
              <p className="text-[11px] leading-snug opacity-90">Scan to request money from {card.holder_name.split(' ')[0]}. Nothing is sent until the owner confirms with their PIN.</p>
            </div>
            <p className="absolute left-5 right-5 bottom-3 text-[9px] opacity-70">ICANera digital card · not a Visa/Mastercard network card · ••••{card.card_number.slice(-4)}</p>
          </div>
        </div>
      </div>
      <p className="text-xs text-gray-400">Tap or swipe the card to see the other side. This is your ICANera digital card; it is not a Visa/Mastercard network card and cannot be used at card terminals.</p>

      <div className="grid grid-cols-3 gap-2">
        <button onClick={printCard} className="px-3 py-2 text-xs bg-white/10 rounded flex items-center justify-center gap-1 text-white"><Printer className="w-3 h-3" /> Print</button>
        <button onClick={toggleQr} className="px-3 py-2 text-xs bg-white/10 rounded text-white">{card.qr_enabled ? 'QR off' : 'QR on'}</button>
        <button onClick={rotate} className="px-3 py-2 text-xs bg-white/10 rounded flex items-center justify-center gap-1 text-white"><RefreshCw className="w-3 h-3" /> New QR</button>
      </div>

      {msg && (
        <div className={`p-3 rounded-lg border text-sm ${msg.ok ? 'bg-green-500/20 border-green-500/50 text-green-300' : 'bg-red-500/20 border-red-500/50 text-red-300'}`}>{msg.text}</div>
      )}

      {/* Requests waiting for the owner */}
      <div>
        <h4 className="text-sm font-semibold text-white mb-2 flex items-center gap-2"><CreditCard className="w-4 h-4" /> Requests to confirm ({pending.length})</h4>
        {pending.length === 0 && <p className="text-xs text-gray-400">No one is waiting. Requests from your QR appear here.</p>}
        <div className="space-y-2">
          {pending.map((r) => (
            <div key={r.id} className="p-3 rounded-lg bg-slate-700/50 border border-slate-600/50">
              <div className="flex justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-white font-semibold">{Number(r.amount).toLocaleString()} {r.currency}</p>
                  <p className="text-xs text-gray-300 truncate">{r.requester_name} · {r.recipient_phone} · {r.recipient_network}</p>
                  {r.note && <p className="text-xs text-gray-400 truncate">"{r.note}"</p>}
                </div>
                <p className="text-[10px] text-gray-500 shrink-0">{new Date(r.created_at).toLocaleString()}</p>
              </div>
              <div className="flex gap-2 mt-2">
                <button disabled={busyId === r.id} onClick={() => confirm(r)}
                  className="flex-1 px-3 py-2 text-xs bg-green-600/60 hover:bg-green-600 text-white rounded flex items-center justify-center gap-1 disabled:opacity-50">
                  {busyId === r.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Confirm &amp; send
                </button>
                <button disabled={busyId === r.id} onClick={() => decline(r)}
                  className="flex-1 px-3 py-2 text-xs bg-red-600/50 hover:bg-red-600 text-white rounded flex items-center justify-center gap-1 disabled:opacity-50">
                  <X className="w-3 h-3" /> Decline
                </button>
              </div>
            </div>
          ))}
        </div>
        {past.length > 0 && (
          <div className="mt-3 space-y-1">
            {past.map((r) => (
              <p key={r.id} className="text-xs text-gray-400">{Number(r.amount).toLocaleString()} {r.currency} · {r.requester_name} · {r.status}</p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default DigitalCardPanel;
