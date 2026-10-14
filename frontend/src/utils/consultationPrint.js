import { attachmentKind, attachmentLine } from './consultationAttachments';

// The one print path for every CMMS consultation-form printout (blank form,
// a patient's record, the patient's own copy on the public page). It replaces
// three copies of the same window.open + document.write + window.print()
// block, and adds what every one of them now needs: a letterhead with the
// business logo, a QR code, and the record's photo / document attachments.

export const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const PRINT_CSS = `
  body{font-family:Arial,sans-serif;max-width:720px;margin:32px auto;color:#111;line-height:1.6}
  h1{margin:0 0 2px;font-size:20px}
  .letterhead{display:flex;align-items:center;gap:16px;border-bottom:2px solid #166534;padding-bottom:14px;margin-bottom:22px}
  .lh-logo img{display:block;max-width:84px;max-height:84px;object-fit:contain}
  .lh-title{flex:1;min-width:0}
  .subtitle{color:#555;font-size:13px}
  .lh-qr{text-align:center;font-size:9px;color:#555;line-height:1.3;width:96px;flex:none}
  .lh-qr img{display:block;width:96px;height:96px;margin:0 auto 3px}
  .lh-qr .code{font-family:monospace;font-size:11px;font-weight:bold;color:#111;letter-spacing:.5px}
  .field{margin-bottom:16px;page-break-inside:avoid}
  .field .label{font-weight:bold;font-size:13px;margin-bottom:4px}
  .field .required{color:#b91c1c;font-weight:normal}
  .field .answer{font-size:13px;white-space:pre-wrap;border-bottom:1px solid #999;min-height:18px;padding-bottom:4px}
  .blank-line{border-bottom:1px solid #999;height:22px}
  .blank-lines .blank-line{margin-bottom:6px}
  .section-heading{margin:26px 0 14px;font-size:14px;font-weight:bold;color:#111;border-bottom:2px solid #333;padding-bottom:4px;page-break-after:avoid}
  .section-heading:first-of-type{margin-top:4px}
  .attachments{margin-top:26px}
  .attachments-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  .attachment{border:1px solid #ccc;border-radius:6px;padding:8px;page-break-inside:avoid;font-size:11px}
  .attachment img{display:block;width:100%;max-height:260px;object-fit:contain;background:#f5f5f5;margin-bottom:6px}
  .attachment .tag{display:inline-block;background:#e6f2ea;color:#166534;border-radius:10px;padding:1px 8px;font-size:10px;font-weight:bold}
  .attachment .doc{font-weight:bold;word-break:break-word}
  .meta{color:#555;font-size:11px;margin-top:28px;border-top:1px solid #ddd;padding-top:10px}
  @media print{body{margin:18px}}
`;

// Call this synchronously from the click handler, THEN build the body. A
// window opened after an `await` is treated as an unrequested pop-up by
// Safari and by Chrome once the click's activation has expired; opening it
// up front (and filling it in when the logo / QR / photos are ready) keeps
// printing reliable. No 'noopener' feature on purpose: it makes window.open
// return null, which the old copies of this code mistook for a blocked pop-up.
export const openPrintShell = () => {
  const win = window.open('', '_blank');
  if (!win) {
    alert('Allow pop-ups to print this form.');
    return null;
  }
  win.document.write('<!doctype html><title>Preparing…</title><body style="font-family:Arial,sans-serif;color:#555;padding:40px">Preparing your document…</body>');
  win.document.close(); // finish the placeholder so fillPrintShell's document.open() starts from a clean, loaded document
  return win;
};

export const fillPrintShell = (win, title, bodyHtml) => {
  if (!win || win.closed) return;
  win.document.open();
  win.document.write(`<!doctype html><html><head><title>${escapeHtml(title)}</title><style>${PRINT_CSS}</style></head><body>${bodyHtml}<script>window.onload=()=>window.print()</script></body></html>`);
  win.document.close();
};

export const closePrintShell = (win) => {
  try { if (win && !win.closed) win.close(); } catch { /* ignore */ }
};

// Logo | business name + form details | QR. Any of the three may be absent;
// the layout simply closes up.
export const letterheadHtml = ({ businessName, logoUrl, detailsHtml, qrDataUrl, qrCaption, qrCode }) => `
  <div class="letterhead">
    ${logoUrl ? `<div class="lh-logo"><img src="${escapeHtml(logoUrl)}" alt=""></div>` : ''}
    <div class="lh-title">
      <h1>${escapeHtml(businessName || 'Clinic')}</h1>
      <div class="subtitle">${detailsHtml || ''}</div>
    </div>
    ${qrDataUrl ? `<div class="lh-qr"><img src="${escapeHtml(qrDataUrl)}" alt="QR code">${qrCaption ? escapeHtml(qrCaption) : ''}${qrCode ? `<div class="code">${escapeHtml(qrCode)}</div>` : ''}</div>` : ''}
  </div>`;

// attachments: [{ …attachment, url }] where url is a resolved, viewable URL.
export const attachmentsHtml = (attachments) => {
  if (!attachments?.length) return '';
  const cards = attachments.map((a) => {
    const kind = attachmentKind(a);
    const tag = a.label ? `<span class="tag">${escapeHtml(a.label)}</span> ` : '';
    const caption = a.caption ? `<div>${escapeHtml(a.caption)}</div>` : '';
    if (kind === 'image' && a.url) {
      return `<div class="attachment"><img src="${escapeHtml(a.url)}" alt="${escapeHtml(a.name || 'attachment')}">${tag}${caption}</div>`;
    }
    return `<div class="attachment"><div class="doc">${escapeHtml(a.name || 'Document')}</div>${tag}${caption}<div>${escapeHtml(attachmentLine(a))}</div></div>`;
  }).join('');
  return `<div class="attachments"><div class="section-heading">Attachments (${attachments.length})</div><div class="attachments-grid">${cards}</div></div>`;
};
