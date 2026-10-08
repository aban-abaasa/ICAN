import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { jsPDF } from 'jspdf';
import QRCode from 'qrcode';
import { QRCodeCanvas } from 'qrcode.react';
import { X, Receipt, Paperclip, Download, Share2, Loader2, ShieldCheck, FileCheck2, ExternalLink, Printer, Copy, Check, QrCode } from 'lucide-react';
import { supabase } from '../lib/supabase/client';
import {
  buildPublicReceiptLink, getTransactionPublicLink, getTransactionReceiveState, setTransactionPublicPay, setTransactionPublicReceive,
} from '../services/publicTransactionService';
import { uploadToR2, resolveMediaValues, isR2Key } from '../services/r2StorageService';
import {
  RECEIPT_FOLDER,
  RECEIPT_MAX_BYTES,
  compressReceiptImage,
  getProofRequirement,
  getProofStatus,
  getReceiptImageRef,
  getReceiptLines,
  getReceiptNumber,
  getReceiptRef,
  getReceiptText,
  signReceipt,
} from '../utils/transactionReceipt';
import { EVIDENCE_GRADES, getEvidenceGrade } from '../utils/receiptTruth';

const pickProof = (meta = {}) => ({
  receipt_url: meta.receipt_url || null,
  receipt_ref: meta.receipt_ref || null,
  receipt_attached_at: meta.receipt_attached_at || null,
});

const isUuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ''));

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * Opens when a transaction is tapped. Shows the attached proof image when there
 * is one, otherwise the system receipt generated from the ledger row, and lets
 * the person who recorded the entry attach/replace proof using the existing R2
 * upload flow.
 */
export default function TransactionReceiptModal({ transaction, businessName = null, onClose, onProofAttached }) {
  const fileInputRef = useRef(null);
  const [tx, setTx] = useState(transaction);
  const [imageUrl, setImageUrl] = useState(null);
  const [imageLoading, setImageLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [target, setTarget] = useState(null); // { id, user_id } of the ledger row proof is saved on
  const [refInput, setRefInput] = useState('');
  const [savingRef, setSavingRef] = useState(false);
  const [signer, setSigner] = useState('');
  const [seal, setSeal] = useState(null);
  // Public QR: { code, pay_status, can_enable, blocker, paid } -- null when this row has none
  // (a tithe receipt, a shared coin-feed row, an offline entry that has not synced yet).
  const [pub, setPub] = useState(null);
  const [pubBusy, setPubBusy] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  // Receive-by-QR (money-out entries of a business): { receive_status, can_enable, can_manage, blocker, expires_at, received }
  const [recv, setRecv] = useState(null);
  const [recvBusy, setRecvBusy] = useState(false);

  useEffect(() => { setTx(transaction); setRefInput(getReceiptRef(transaction) || ''); }, [transaction]);

  // Every ledger entry has a public code; fetch it (older entries get theirs here, on first open).
  useEffect(() => {
    let cancelled = false;
    setPub(null);
    if (!transaction?.id || !isUuid(transaction.id)) return undefined;
    getTransactionPublicLink(transaction.id)
      .then((link) => { if (!cancelled) setPub(link); })
      .catch(() => { /* not one of the viewer's own ledger entries: no QR section */ });
    return () => { cancelled = true; };
  }, [transaction?.id]);

  // Money-out entries of a business can also pay the client who scans the QR.
  useEffect(() => {
    let cancelled = false;
    setRecv(null);
    if (!pub?.code || !transaction?.id || !isUuid(transaction.id)) return undefined;
    if (transaction.transaction_type !== 'expense' || !transaction.business_profile_id) return undefined;
    getTransactionReceiveState(transaction.id)
      .then((state) => { if (!cancelled) setRecv(state); })
      .catch(() => { /* no receive section */ });
    return () => { cancelled = true; };
  }, [pub?.code, transaction?.id, transaction?.transaction_type, transaction?.business_profile_id]);

  // Resolve which ledger row proof is saved on: the row itself when it's the
  // user's own, or -- for tithe receipts -- the ledger row the tithe page wrote
  // for that tithe record (metadata.tithe_id), when one exists.
  useEffect(() => {
    let cancelled = false;
    setTarget(null);
    (async () => {
      try {
        const { data } = await supabase.auth.getUser();
        const uid = data?.user?.id;
        if (!uid || !transaction) return;
        if (isUuid(transaction.id) && transaction.user_id === uid) { if (!cancelled) setTarget({ id: transaction.id, user_id: uid }); return; }
        if (transaction.metadata?.source === 'tithe page' && isUuid(transaction.id)) {
          const { data: row } = await supabase.from('ican_transactions').select('id, user_id, metadata')
            .eq('user_id', uid).eq('metadata->>tithe_id', transaction.id).limit(1).maybeSingle();
          if (row && !cancelled) {
            setTarget({ id: row.id, user_id: uid });
            // Show proof already saved on the ledger row
            setTx((prev) => ({ ...prev, metadata: { ...(prev.metadata || {}), ...pickProof(row.metadata) } }));
            setRefInput(row.metadata?.receipt_ref || '');
          }
        }
      } catch { /* attach stays hidden */ }
    })();
    return () => { cancelled = true; };
  }, [transaction?.id, transaction?.user_id]);

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getUser().then(({ data }) => {
      const u = data?.user;
      const name = u?.user_metadata?.full_name || u?.user_metadata?.name || (u?.email ? u.email.split('@')[0] : '');
      if (!cancelled) setSigner(name);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    signReceipt(tx, { businessName }).then((hash) => { if (!cancelled) setSeal(hash); });
    return () => { cancelled = true; };
  }, [tx, businessName]);

  const imageRef = getReceiptImageRef(tx);
  useEffect(() => {
    let cancelled = false;
    if (!imageRef) { setImageUrl(null); return undefined; }
    if (!isR2Key(imageRef)) { setImageUrl(imageRef); return undefined; }
    setImageLoading(true);
    resolveMediaValues([{ receipt_url: imageRef }], ['receipt_url'])
      .then(([row]) => { if (!cancelled) setImageUrl(isR2Key(row?.receipt_url) ? null : row?.receipt_url || null); })
      .finally(() => { if (!cancelled) setImageLoading(false); });
    return () => { cancelled = true; };
  }, [imageRef]);

  if (!tx) return null;

  const lines = getReceiptLines(tx, { businessName });
  const receiptNumber = getReceiptNumber(tx);
  const proofStatus = getProofStatus(tx);
  const proofNeed = getProofRequirement(tx);
  const evidence = EVIDENCE_GRADES[getEvidenceGrade(tx)];
  const hasImage = proofStatus === 'attached';
  const canAttach = Boolean(target);
  const isIncome = tx.transaction_type === 'income';
  const publicLink = pub?.code ? buildPublicReceiptLink(pub.code) : '';
  const payOpen = pub?.pay_status === 'open';
  const payPaid = pub?.pay_status === 'paid';

  const togglePay = async () => {
    setError('');
    setPubBusy(true);
    try {
      setPub(await setTransactionPublicPay(tx.id, !payOpen));
    } catch (err) {
      setError(err.message || 'Could not change the payment setting.');
    } finally {
      setPubBusy(false);
    }
  };

  const recvOpen = recv?.receive_status === 'open';
  const recvDone = recv?.receive_status === 'received';

  const toggleReceive = async () => {
    setError('');
    setRecvBusy(true);
    try {
      setRecv(await setTransactionPublicReceive(tx.id, !recvOpen));
    } catch (err) {
      setError(err.message || 'Could not change the payout setting.');
    } finally {
      setRecvBusy(false);
    }
  };

  const copyLink = async () => {
    try { await navigator.clipboard?.writeText(publicLink); setLinkCopied(true); setTimeout(() => setLinkCopied(false), 2000); } catch { /* clipboard blocked */ }
  };

  // A narrow, print-ready page (works on a 58/80 mm receipt printer and on A4): the receipt lines and
  // the public QR. Opens the browser's print dialog, which also offers "Save as PDF".
  const printReceipt = async () => {
    setError('');
    try {
      const qr = await QRCode.toDataURL(publicLink, { margin: 1, width: 320 });
      const rows = lines.map(([k, v]) => `<tr><td class="k">${escapeHtml(k)}</td><td class="v">${escapeHtml(v)}</td></tr>`).join('');
      const note = payOpen ? 'Scan to see this receipt or to pay it — no account needed' : 'Scan to see this receipt online — no account needed';
      const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(receiptNumber)}</title><style>
        @page{margin:6mm}body{font:13px Georgia,serif;color:#111;margin:0;padding:8px;max-width:340px;margin:auto}
        h1{font-size:16px;text-align:center;margin:0 0 2px}.sub{text-align:center;color:#555;font-size:11px;margin-bottom:8px}
        .amt{text-align:center;font-size:22px;font-weight:bold;margin:6px 0 10px}table{width:100%;border-collapse:collapse}
        td{padding:3px 0;vertical-align:top;border-bottom:1px dotted #bbb}.k{color:#555;width:38%}.v{text-align:right;word-break:break-word}
        .qr{text-align:center;margin-top:12px}.qr img{width:170px;height:170px}.qr p{margin:4px 0;font-size:11px}.url{word-break:break-all;color:#333}
      </style></head><body>
        <h1>${escapeHtml(businessName || 'IcanEra receipt')}</h1><div class="sub">IcanEra transaction receipt</div>
        <div class="amt">${isIncome ? '+' : '-'}${Math.abs(Number(tx.amount) || 0).toLocaleString()} ${escapeHtml(tx.currency || 'UGX')}</div>
        <table>${rows}</table>
        <div class="qr"><img src="${qr}" alt="QR"/><p><b>${escapeHtml(note)}</b></p><p class="url">${escapeHtml(publicLink)}</p></div>
        <script>window.onload=function(){setTimeout(function(){window.print()},250)}<\/script></body></html>`;
      const win = window.open('', '_blank', 'width=420,height=720');
      if (!win) { setError('Allow pop-ups for this site to print the receipt.'); return; }
      win.document.write(html);
      win.document.close();
    } catch (err) {
      setError(err.message || 'Could not prepare the receipt for printing.');
    }
  };

  // Merge proof fields into the latest stored metadata so concurrent edits aren't clobbered.
  const saveProof = async (fields) => {
    const { data: current, error: readError } = await supabase
      .from('ican_transactions').select('metadata').eq('id', target.id).eq('user_id', target.user_id).maybeSingle();
    if (readError || !current) throw new Error('Could not find this transaction to save the receipt on.');
    const metadata = { ...(current.metadata || {}), receipt_number: receiptNumber, ...fields };
    const { error: updateError } = await supabase
      .from('ican_transactions').update({ metadata }).eq('id', target.id).eq('user_id', target.user_id);
    if (updateError) throw new Error(updateError.message || 'Could not save the receipt.');
    const updated = { ...tx, metadata: { ...(tx.metadata || {}), ...pickProof(metadata), receipt_number: receiptNumber } };
    setTx(updated);
    if (onProofAttached) onProofAttached(updated);
  };

  const handleFile = async (event) => {
    const picked = event.target.files?.[0];
    event.target.value = '';
    if (!picked) return;
    setError('');
    if (!/^image\//i.test(picked.type)) { setError('Please choose a photo of the receipt (JPG, PNG or WebP).'); return; }
    setUploading(true);
    try {
      const file = await compressReceiptImage(picked);
      if (file.size > RECEIPT_MAX_BYTES) throw new Error('That image is too large (max 8 MB).');
      const { data: { session } } = await supabase.auth.getSession();
      const upload = await uploadToR2({ file, folder: RECEIPT_FOLDER, accessToken: session?.access_token });
      if (!upload.success) throw new Error(upload.error || 'Upload failed');
      await saveProof({ receipt_url: upload.url, receipt_attached_at: new Date().toISOString() });
    } catch (err) {
      setError(err.message || 'Could not attach the receipt.');
    } finally {
      setUploading(false);
    }
  };

  const handleSaveRef = async () => {
    setError('');
    setSavingRef(true);
    try {
      await saveProof({ receipt_ref: refInput.trim() || null, receipt_attached_at: tx.metadata?.receipt_attached_at || new Date().toISOString() });
    } catch (err) {
      setError(err.message || 'Could not save the receipt number.');
    } finally {
      setSavingRef(false);
    }
  };

  const savePdf = async () => {
    const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
    pdf.setFillColor(49, 46, 129); pdf.rect(0, 0, 210, 30, 'F');
    pdf.setFillColor(196, 160, 82); pdf.rect(0, 30, 210, 2, 'F');
    pdf.setTextColor(255, 255, 255); pdf.setFontSize(18); pdf.text('IcanEra Transaction Receipt', 15, 19);
    pdf.setTextColor(37, 37, 63); pdf.setFontSize(11);
    let y = 44;
    lines.forEach(([label, value]) => {
      pdf.setFont(undefined, 'bold'); pdf.text(`${label}:`, 15, y);
      pdf.setFont(undefined, 'normal');
      const wrapped = pdf.splitTextToSize(String(value), 120);
      pdf.text(wrapped, 62, y);
      y += Math.max(7, wrapped.length * 5.5);
    });
    // Embed the attached proof when the storage host lets us read it; the
    // text receipt is still complete without it.
    if (imageUrl) {
      try {
        const blob = await (await fetch(imageUrl)).blob();
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
        const props = pdf.getImageProperties(dataUrl);
        const maxW = 120; const maxH = Math.max(40, 280 - y - 8);
        const ratio = Math.min(maxW / props.width, maxH / props.height);
        pdf.setFont(undefined, 'bold'); pdf.text('Attached proof', 15, y + 6);
        pdf.addImage(dataUrl, props.fileType || 'JPEG', 15, y + 10, props.width * ratio, props.height * ratio);
      } catch (err) {
        console.warn('Receipt image not embedded in PDF:', err);
      }
    }
    pdf.setFont(undefined, 'normal'); pdf.setFontSize(8); pdf.setTextColor(100, 116, 139);
    // The public QR: anyone can scan the printed page to see (or pay) this receipt, no account needed.
    if (publicLink) {
      try {
        const qrData = await QRCode.toDataURL(publicLink, { margin: 1, width: 300 });
        pdf.addImage(qrData, 'PNG', 158, 238, 38, 38);
        pdf.setFontSize(7); pdf.setTextColor(49, 46, 129);
        pdf.text(payOpen ? 'Scan to see or pay' : 'Scan to see online', 177, 279, { align: 'center' });
        pdf.setTextColor(100, 116, 139);
      } catch (err) {
        console.warn('QR not added to the PDF:', err);
      }
    }
    if (seal) {
      pdf.setFont('times', 'italic'); pdf.setFontSize(16); pdf.setTextColor(49, 46, 129);
      pdf.text(signer || 'IcanEra', 15, 272);
      pdf.setDrawColor(196, 160, 82); pdf.line(15, 274, 95, 274);
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7); pdf.setTextColor(100, 116, 139);
      pdf.text('Autographed digitally by the account holder', 15, 278);
      pdf.text(`SHA-256 seal: ${seal.slice(0, 32)}`, 15, 282);
      pdf.text(`${seal.slice(32)}`, 15, 285.5);
    }
    pdf.setFontSize(8);
    pdf.text('Digitally recorded on the IcanEra ledger.', 15, 291);
    pdf.save(`${receiptNumber}.pdf`);
  };

  const share = async () => {
    const text = getReceiptText(tx, { businessName }, seal) + (publicLink ? `\nView online: ${publicLink}` : '');
    if (navigator.share) { try { await navigator.share({ title: 'IcanEra receipt', text }); } catch { /* dismissed */ } return; }
    await navigator.clipboard?.writeText(text);
  };

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-end justify-center bg-black/75 sm:items-center sm:p-4" onClick={onClose}>
      <div
        className="max-h-[calc(100dvh-0.75rem)] w-full max-w-md overflow-y-auto rounded-t-3xl border border-slate-700 bg-slate-950 p-5 pb-[max(2rem,env(safe-area-inset-bottom))] text-slate-100 shadow-2xl sm:max-h-[90vh] sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className={`flex h-11 w-11 items-center justify-center rounded-full ${isIncome ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
              <Receipt className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-300">IcanEra receipt</p>
              <p className={`text-xl font-bold ${isIncome ? 'text-green-400' : 'text-red-400'}`}>
                {isIncome ? '+' : '-'}{Math.abs(Number(tx.amount) || 0).toLocaleString()} {tx.currency || 'UGX'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white" aria-label="Close receipt">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className={`mb-4 flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold ${proofStatus !== 'system' ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' : 'border-slate-700 bg-slate-900 text-slate-300'}`}>
          {proofStatus !== 'system' ? <ShieldCheck className="h-4 w-4" /> : <FileCheck2 className="h-4 w-4" />}
          <span className="min-w-0 flex-1">
            {hasImage ? 'Proof attached — receipt image backs this transaction' : proofStatus === 'reference' ? 'Receipt number recorded as proof' : 'System receipt generated from the ledger record'}
          </span>
          <span className="flex-shrink-0 rounded-full bg-black/30 px-2 py-0.5 text-[10px] font-bold" title={evidence.blurb}>
            {evidence.medal} {evidence.label}
          </span>
        </div>

        {proofNeed.required && (
          <div className={`mb-4 rounded-lg border px-3 py-2 text-xs ${proofNeed.complete ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' : 'border-amber-500/40 bg-amber-500/10 text-amber-200'}`}>
            <p className="font-bold">
              {proofNeed.complete ? '100% proof — manual transaction fully evidenced' : 'Manual transaction between two parties — 100% proof required'}
            </p>
            <ul className="mt-1 space-y-0.5">
              <li>{proofNeed.hasPhoto ? '✅' : '⬜'} Receipt photo</li>
              <li>{proofNeed.hasNumber ? '✅' : '⬜'} Receipt number</li>
            </ul>
            {!proofNeed.complete && !canAttach && (
              <p className="mt-1 text-[11px] opacity-80">Only the person who recorded this entry can attach the proof.</p>
            )}
          </div>
        )}

        {hasImage && (
          <div className="mb-4 overflow-hidden rounded-xl border border-slate-700 bg-slate-900">
            {imageLoading ? (
              <div className="flex h-40 items-center justify-center text-slate-400"><Loader2 className="h-5 w-5 animate-spin" /></div>
            ) : imageUrl ? (
              <a href={imageUrl} target="_blank" rel="noopener noreferrer" className="relative block">
                <img src={imageUrl} alt={`Receipt ${receiptNumber}`} className="max-h-80 w-full object-contain" />
                <span className="absolute bottom-2 right-2 flex items-center gap-1 rounded-full bg-black/60 px-2 py-1 text-[10px] text-white"><ExternalLink className="h-3 w-3" /> Open full size</span>
              </a>
            ) : (
              <p className="p-4 text-center text-xs text-amber-300">The receipt image couldn't be loaded right now. Try again in a moment.</p>
            )}
          </div>
        )}

        <div className="space-y-2 rounded-xl bg-slate-900 p-4 text-sm">
          {lines.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-4">
              <span className="text-slate-400">{label}</span>
              <strong className="max-w-[60%] break-words text-right text-slate-100">{value}</strong>
            </div>
          ))}
        </div>

        {pub?.code && (
          <div className="mt-4 rounded-xl border border-cyan-500/30 bg-cyan-500/5 p-4">
            <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-300"><QrCode className="h-3.5 w-3.5" /> Public QR</p>
            <div className="mt-3 flex items-center gap-4">
              <div className="flex-shrink-0 rounded-lg bg-white p-1.5"><QRCodeCanvas value={publicLink} size={104} /></div>
              <div className="min-w-0 text-xs text-slate-300">
                <p className="font-semibold text-slate-100">
                  {payPaid ? 'Paid through this QR' : payOpen ? 'Anyone can scan to see this receipt or pay it' : 'Anyone can scan to see this receipt'}
                </p>
                <p className="mt-1 text-slate-400">No account needed. It is printed on the PDF and the printout.</p>
                <p className="mt-1 break-all font-mono text-[9px] text-slate-500">{publicLink}</p>
              </div>
            </div>

            {payPaid && pub.paid && (
              <p className="mt-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
                Paid by {pub.paid.payer_name || 'a customer'}{pub.paid.payer_phone ? ` (${pub.paid.payer_phone})` : ''} with {pub.paid.via === 'wallet' ? 'an IcanEra wallet' : 'Mobile Money, card or bank'}
                {pub.paid.paid_at ? ` · ${new Date(pub.paid.paid_at).toLocaleString()}` : ''}. The money is in your {tx.business_profile_id ? 'business wallet' : 'IcanEra wallet'}.
              </p>
            )}

            {!payPaid && (pub.can_enable || payOpen) && (
              <button
                onClick={togglePay}
                disabled={pubBusy}
                className={`mt-3 flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left text-sm disabled:opacity-60 ${payOpen ? 'border-emerald-500/50 bg-emerald-500/10' : 'border-slate-700 bg-slate-900'}`}
              >
                <span>
                  <span className="block font-semibold text-slate-100">Let the customer pay by scanning</span>
                  <span className="block text-[11px] text-slate-400">
                    {payOpen
                      ? 'On — they pay with Mobile Money, card, bank or an IcanEra wallet. You receive the full amount.'
                      : 'Off — the QR only shows the receipt.'}
                  </span>
                </span>
                <span className={`relative h-6 w-11 flex-shrink-0 rounded-full transition ${payOpen ? 'bg-emerald-500' : 'bg-slate-600'}`}>
                  {pubBusy
                    ? <Loader2 className="absolute left-3 top-1 h-4 w-4 animate-spin text-white" />
                    : <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${payOpen ? 'left-[22px]' : 'left-0.5'}`} />}
                </span>
              </button>
            )}
            {!payPaid && !payOpen && !pub.can_enable && pub.blocker && (
              <p className="mt-3 text-[11px] text-slate-500">Payment by QR is not available here: {pub.blocker}.</p>
            )}

            {recvDone && recv.received && (
              <p className="mt-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
                Received by {recv.received.recipient_name || 'the client'}
                {recv.received.received_at ? ` · ${new Date(recv.received.received_at).toLocaleString()}` : ''}. UGX {Number(recv.received.amount_ugx || 0).toLocaleString()} was paid from your business wallet.
              </p>
            )}
            {recv && !recvDone && (recv.can_enable || recvOpen) && (
              <button
                onClick={toggleReceive}
                disabled={recvBusy}
                className={`mt-3 flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left text-sm disabled:opacity-60 ${recvOpen ? 'border-emerald-500/50 bg-emerald-500/10' : 'border-slate-700 bg-slate-900'}`}
              >
                <span>
                  <span className="block font-semibold text-slate-100">Let the client receive this by scanning</span>
                  <span className="block text-[11px] text-slate-400">
                    {recvOpen
                      ? `On — the client signs in with IcanEra and collects this amount from your business wallet, once${recv.expires_at ? ` (until ${new Date(recv.expires_at).toLocaleDateString()})` : ''}.`
                      : 'Off — nobody can collect money through this QR. Turning it on is valid for 7 days.'}
                  </span>
                </span>
                <span className={`relative h-6 w-11 flex-shrink-0 rounded-full transition ${recvOpen ? 'bg-emerald-500' : 'bg-slate-600'}`}>
                  {recvBusy
                    ? <Loader2 className="absolute left-3 top-1 h-4 w-4 animate-spin text-white" />
                    : <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${recvOpen ? 'left-[22px]' : 'left-0.5'}`} />}
                </span>
              </button>
            )}
            {recv && !recvDone && !recvOpen && !recv.can_enable && (recv.blocker || recv.can_manage === false) && (
              <p className="mt-3 text-[11px] text-slate-500">
                Receiving by QR is not available here: {recv.blocker || 'only the business owner, a co-owner or finance team can switch it on'}.
              </p>
            )}

            <div className="mt-3 grid grid-cols-2 gap-2">
              <button onClick={printReceipt} className="flex items-center justify-center gap-2 rounded-xl bg-cyan-600 px-3 py-2.5 text-sm font-bold text-white"><Printer className="h-4 w-4" /> Print with QR</button>
              <button onClick={copyLink} className="flex items-center justify-center gap-2 rounded-xl bg-slate-800 px-3 py-2.5 text-sm font-bold text-white">
                {linkCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {linkCopied ? 'Copied' : 'Copy link'}
              </button>
            </div>
          </div>
        )}

        {seal && (
          <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-amber-300">Autograph</p>
            <p className="mt-1 text-2xl text-indigo-200" style={{ fontFamily: '"Brush Script MT", "Segoe Script", cursive' }}>{signer || 'IcanEra'}</p>
            <p className="mt-1 break-all font-mono text-[9px] text-slate-400" title="SHA-256 seal over this receipt's details">SHA-256 seal · {seal.slice(0, 32)}…</p>
          </div>
        )}

        {error && <p className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}

        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
        {canAttach && (
          <div className="mt-4 flex gap-2">
            <input
              type="text"
              value={refInput}
              onChange={(e) => setRefInput(e.target.value.slice(0, 60))}
              placeholder="Receipt / reference no."
              className="min-w-0 flex-1 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:border-indigo-400 focus:outline-none"
            />
            <button
              onClick={handleSaveRef}
              disabled={savingRef || refInput.trim() === (getReceiptRef(tx) || '')}
              className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40"
            >
              {savingRef ? '…' : 'Save'}
            </button>
          </div>
        )}
        <div className="mt-4 grid grid-cols-2 gap-3">
          {canAttach && (
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="col-span-2 flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-60"
            >
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
              {uploading ? 'Uploading receipt…' : hasImage ? 'Replace receipt image' : 'Attach receipt image'}
            </button>
          )}
          <button onClick={savePdf} className="flex items-center justify-center gap-2 rounded-xl bg-slate-800 px-4 py-3 text-sm font-bold text-white"><Download className="h-4 w-4" /> PDF</button>
          <button onClick={share} className="flex items-center justify-center gap-2 rounded-xl bg-sky-600 px-4 py-3 text-sm font-bold text-white"><Share2 className="h-4 w-4" /> Share</button>
        </div>
      </div>
    </div>,
    document.body
  );
}
