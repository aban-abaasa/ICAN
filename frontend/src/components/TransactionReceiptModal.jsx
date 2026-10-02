import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { jsPDF } from 'jspdf';
import { X, Receipt, Paperclip, Download, Share2, Loader2, ShieldCheck, FileCheck2, ExternalLink } from 'lucide-react';
import { supabase } from '../lib/supabase/client';
import { uploadToR2, resolveMediaValues, isR2Key } from '../services/r2StorageService';
import {
  RECEIPT_FOLDER,
  RECEIPT_MAX_BYTES,
  compressReceiptImage,
  getProofStatus,
  getReceiptImageRef,
  getReceiptLines,
  getReceiptNumber,
  getReceiptText,
} from '../utils/transactionReceipt';

const isUuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ''));

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
  const [canAttach, setCanAttach] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { setTx(transaction); }, [transaction]);

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getUser().then(({ data }) => {
      if (!cancelled) setCanAttach(Boolean(data?.user?.id) && data.user.id === transaction?.user_id && isUuid(transaction?.id));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [transaction?.id, transaction?.user_id]);

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
  const hasImage = getProofStatus(tx) === 'attached';
  const isIncome = tx.transaction_type === 'income';

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

      // Merge into the latest stored metadata so concurrent edits aren't clobbered.
      const { data: current, error: readError } = await supabase
        .from('ican_transactions').select('metadata').eq('id', tx.id).eq('user_id', tx.user_id).maybeSingle();
      if (readError || !current) throw new Error('Could not find this transaction to attach the receipt.');
      const metadata = {
        ...(current.metadata || {}),
        receipt_url: upload.url,
        receipt_number: receiptNumber,
        receipt_attached_at: new Date().toISOString(),
      };
      const { error: updateError } = await supabase
        .from('ican_transactions').update({ metadata }).eq('id', tx.id).eq('user_id', tx.user_id);
      if (updateError) throw new Error(updateError.message || 'Could not save the receipt.');

      const updated = { ...tx, metadata: { ...(tx.metadata || {}), ...metadata } };
      setTx(updated);
      if (onProofAttached) onProofAttached(updated);
    } catch (err) {
      setError(err.message || 'Could not attach the receipt.');
    } finally {
      setUploading(false);
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
    pdf.text('Digitally recorded on the IcanEra ledger.', 15, 290);
    pdf.save(`${receiptNumber}.pdf`);
  };

  const share = async () => {
    const text = getReceiptText(tx, { businessName });
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

        <div className={`mb-4 flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold ${hasImage ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' : 'border-slate-700 bg-slate-900 text-slate-300'}`}>
          {hasImage ? <ShieldCheck className="h-4 w-4" /> : <FileCheck2 className="h-4 w-4" />}
          {hasImage ? 'Proof attached — receipt image backs this transaction' : 'System receipt generated from the ledger record'}
        </div>

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

        {error && <p className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}

        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
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
