import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { jsPDF } from 'jspdf';
import QRCode from 'qrcode';
import { QRCodeCanvas } from 'qrcode.react';
import { getSupabaseClient } from '../lib/supabase/client';

export default function IcanPaymentReceiptModal({ receipt, onClose }) {
  const [storeWebsiteUrl, setStoreWebsiteUrl] = useState(typeof window !== 'undefined' ? window.location.origin : 'https://icanera.icanera.space');
  useEffect(() => {
    let cancelled = false;
    const loadStoreWebsite = async () => {
      if (!receipt?.recipientUserId) return;
      try {
        const supabase = getSupabaseClient();
        const { data: business } = await supabase.from('business_profiles')
          .select('id, website').eq('user_id', receipt.recipientUserId).limit(1).maybeSingle();
        if (!business?.id) return;
        const { data: cmmsCompany } = await supabase.from('cmms_company_profiles')
          .select('id, website').eq('pichin_business_profile_id', business.id).maybeSingle();
        const website = cmmsCompany?.id
          ? `${window.location.origin}/notices/${cmmsCompany.id}`
          : business.website || window.location.origin;
        if (!cancelled) setStoreWebsiteUrl(/^https?:\/\//i.test(website) ? website : `https://${website}`);
      } catch (error) {
        console.warn('Could not resolve public business website for receipt QR:', error);
      }
    };
    loadStoreWebsite();
    return () => { cancelled = true; };
  }, [receipt?.recipientUserId]);
  if (!receipt) return null;
  const recipient = receipt.recipientName || 'IcanEra recipient';
  const payer = receipt.payerName || 'You';
  const isBusinessReceipt = receipt.recipientClassification === 'business';
  const receiptText = [
    'IcanEra Digital Receipt', `Receipt: ${receipt.receiptNumber}`,
    `Amount: ${Number(receipt.amount).toLocaleString()} ${receipt.currency}`,
    `Method: ${receipt.paymentMethod === 'cash' ? 'Cash' : 'IcanEra Wallet'}`,
    `Received by: ${recipient}`, `Paid by: ${payer}`,
    `Payment code: ${receipt.paymentCode}`,
    `Transaction: ${receipt.transactionId || 'Recorded on IcanEra ledger'}`,
    `Description: ${receipt.description || 'Payment'}`,
    `Date: ${new Date(receipt.issuedAt).toLocaleString()}`,
  ].join('\n');
  const downloadReceipt = async () => {
    const qr = await QRCode.toDataURL(storeWebsiteUrl, { margin: 1, width: 260 });
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>IcanEra receipt ${receipt.receiptNumber}</title><style>body{font:15px Georgia,serif;background:#f5f2e9;color:#25253f;padding:32px}.receipt{max-width:520px;margin:auto;background:#fffdf8;border:1px solid #c4a052;border-radius:14px;padding:28px;white-space:pre-wrap}.head{margin:-28px -28px 22px;padding:24px;background:#312e81;color:#fffdf8;border-bottom:4px solid #c4a052;border-radius:14px 14px 0 0;font-size:22px;font-weight:bold}.qr{text-align:center;border-top:1px solid #e6d8b2;margin-top:22px;padding-top:18px}.qr img{width:150px;height:150px;background:#fff;padding:8px}.qr a{color:#312e81}@media print{body{background:white;padding:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}}</style></head><body><main class="receipt"><header class="head">IcanEra · Payment receipt</header>${receiptText.replace('IcanEra Digital Receipt\n', '')}<section class="qr"><strong>Visit ${recipient}</strong><br><img src="${qr}" alt="QR code to public website"><p>Scan to open the public business website</p><a href="${storeWebsiteUrl}">${storeWebsiteUrl}</a></section></main></body></html>`;
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `${receipt.receiptNumber}.html`; link.click(); URL.revokeObjectURL(url);
  };
  const saveAsPdf = async () => {
    const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
    const qr = await QRCode.toDataURL(storeWebsiteUrl, { margin: 1, width: 260 });
    pdf.setFillColor(49, 46, 129); pdf.rect(0, 0, 210, 32, 'F');
    pdf.setFillColor(196, 160, 82); pdf.rect(0, 32, 210, 2, 'F');
    pdf.setTextColor(255, 255, 255); pdf.setFontSize(20); pdf.text('IcanEra Receipt', 15, 20);
    pdf.setTextColor(37, 37, 63); pdf.setFontSize(12);
    pdf.text(pdf.splitTextToSize(receiptText.replace('IcanEra Digital Receipt\n', ''), 175), 18, 48);
    pdf.setDrawColor(196, 160, 82); pdf.setFillColor(250, 248, 241); pdf.roundedRect(74, 221, 62, 52, 3, 3, 'FD');
    pdf.addImage(qr, 'PNG', 89, 222, 32, 32);
    pdf.setTextColor(49, 46, 129); pdf.setFontSize(9); pdf.text(`Visit ${recipient}`, 105, 258, { align: 'center' });
    pdf.setTextColor(71, 85, 105); pdf.setFontSize(8); pdf.text(pdf.splitTextToSize(storeWebsiteUrl, 55), 105, 263, { align: 'center' });
    pdf.setFontSize(9); pdf.setTextColor(71, 85, 105);
    pdf.text('This is a digitally recorded IcanEra payment receipt.', 18, 280);
    pdf.save(`${receipt.receiptNumber}.pdf`);
  };
  const shareReceipt = async () => {
    if (navigator.share) return navigator.share({ title: 'IcanEra receipt', text: receiptText });
    await navigator.clipboard?.writeText(receiptText);
  };
  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-end justify-center bg-black/75 p-0 sm:items-center sm:p-4">
      <div className="max-h-[calc(100dvh-0.75rem)] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-5 pb-[max(6rem,env(safe-area-inset-bottom))] text-slate-900 shadow-2xl dark:bg-slate-950 dark:text-slate-100 sm:max-h-[90vh] sm:rounded-2xl sm:p-6">
        <div className="mb-5 text-center"><div className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-3xl dark:bg-emerald-950">✓</div><p className="text-xs font-bold uppercase tracking-[0.16em] text-cyan-700 dark:text-cyan-300">IcanEra smart receipt</p><h2 className="text-2xl font-bold text-slate-950 dark:text-white">{isBusinessReceipt ? recipient : 'Payment completed'}</h2><p className="text-sm text-slate-600 dark:text-slate-300">{isBusinessReceipt ? 'Verified business payment receipt' : (receipt.paymentMethod === 'cash' ? 'Cash payment recorded successfully' : 'IcanEra transaction recorded successfully')}</p></div>
        <div className="space-y-3 rounded-xl bg-slate-100 p-4 text-sm text-slate-900 dark:bg-slate-900 dark:text-slate-100">
          <div className="flex justify-between gap-4"><span>Receipt</span><strong className="text-right break-all">{receipt.receiptNumber}</strong></div><div className="flex justify-between gap-4"><span>Amount</span><strong>{Number(receipt.amount).toLocaleString()} {receipt.currency}</strong></div><div className="flex justify-between gap-4"><span>Received by</span><strong className="text-right">{recipient}</strong></div><div className="flex justify-between gap-4"><span>Paid by</span><strong className="text-right">{payer}</strong></div><div className="flex justify-between gap-4"><span>Payment code</span><strong className="max-w-[190px] truncate">{receipt.paymentCode}</strong></div><div className="flex justify-between gap-4"><span>Transaction</span><strong className="max-w-[190px] truncate">{receipt.transactionId || 'Recorded on IcanEra ledger'}</strong></div><div className="flex justify-between gap-4"><span>Time</span><strong className="text-right">{new Date(receipt.issuedAt).toLocaleString()}</strong></div>
        </div>
        <div className="my-5 rounded-xl border border-amber-300 bg-amber-50 p-4 text-center dark:bg-slate-900"><QRCodeCanvas value={storeWebsiteUrl} size={148} includeMargin /><p className="mt-2 text-sm font-semibold text-indigo-900 dark:text-amber-200">Scan to visit {recipient}'s public website</p><p className="mt-1 break-all text-xs text-slate-600 dark:text-slate-300">{storeWebsiteUrl}</p></div>
        <div className="mt-5 grid grid-cols-2 gap-3"><button onClick={saveAsPdf} className="rounded-xl bg-slate-900 px-4 py-3 font-bold text-white dark:bg-slate-700">Download PDF</button><button onClick={shareReceipt} className="rounded-xl bg-sky-600 px-4 py-3 font-bold text-white">Share</button><button onClick={downloadReceipt} className="rounded-xl bg-slate-200 px-4 py-3 font-bold text-slate-900 dark:bg-slate-800 dark:text-white">Download web copy</button><button onClick={onClose} className="rounded-xl bg-orange-500 px-4 py-3 font-bold text-white">Done</button></div>
      </div>
    </div>, document.body);
}
