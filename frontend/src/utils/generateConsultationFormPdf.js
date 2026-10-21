import { jsPDF } from 'jspdf';
import { drawProductOf } from './pdfCredit';
import { sectionDisplayLabel } from './consultationSubmissionUtils';
import { attachmentKind, attachmentLine, formatReferenceCode, recordQrPayload, recordReferenceCode } from './consultationAttachments';
import { fitWithin, imageUrlToDataUrl, loadLogoAsset, makeQrDataUrl } from './consultationBranding';
import { resolveAttachmentUrls } from '../services/cmmsConsultationAttachmentService';

// Real "Download PDF" for CMMS consultation forms — a proper jsPDF
// document (paginated, no popup) rather than the window.print() dialog
// CMMSConsultationForms.jsx/PublicConsultationFormViewer.jsx already offer
// for a physical printout. Same jsPDF-direct approach as
// generateEmploymentDocumentPdf.js, minus that file's verify-QR seal (a
// consultation form's PDF is a record copy, not a document needing
// authenticity verification).
//
// Every PDF has a letterhead — the business logo on the left, the QR code on
// the right (a "scan to fill this form online" link on a blank form, the
// record's reference code on a filled one) — and a record's photo / document
// attachments follow its answers. Logo, QR and attachment images are all
// best-effort: if one can't be fetched the PDF is still produced without it.

const safeFilename = (value) => (value || 'form')
  .trim().replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'form';

const MARGIN = 18;
const LINE_H = 5.5;

const HEADER_TOP = 12;
const HEADER_IMAGE = 26; // mm: the logo / QR box on each side of the title

// Drawn in the header zone: logo top-left, QR top-right with its caption and
// (for a record) reference code underneath.
const drawLetterheadImages = (pdf, pageWidth, { logo, qr }) => {
  if (logo?.dataUrl) {
    const { width, height } = fitWithin(logo.width, logo.height, HEADER_IMAGE, HEADER_IMAGE);
    pdf.addImage(logo.dataUrl, logo.format || 'PNG', MARGIN, HEADER_TOP + (HEADER_IMAGE - height) / 2, width, height);
  }
  if (qr?.dataUrl) {
    const x = pageWidth - MARGIN - HEADER_IMAGE;
    pdf.addImage(qr.dataUrl, 'PNG', x, HEADER_TOP, HEADER_IMAGE, HEADER_IMAGE);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(6.5);
    pdf.setTextColor(90);
    let captionY = HEADER_TOP + HEADER_IMAGE + 3;
    pdf.splitTextToSize(qr.caption || '', HEADER_IMAGE + 6).forEach((line) => {
      pdf.text(line, x + HEADER_IMAGE / 2, captionY, { align: 'center' });
      captionY += 3;
    });
    if (qr.code) {
      pdf.setFont('courier', 'bold');
      pdf.setFontSize(8);
      pdf.setTextColor(20);
      pdf.text(qr.code, x + HEADER_IMAGE / 2, captionY + 0.5, { align: 'center' });
      pdf.setFont('helvetica', 'normal');
    }
    pdf.setTextColor(0);
  }
};

// attachments: [{ ...attachment, image: { dataUrl, format, width, height } | null }].
// Photos that loaded are laid out two to a row with their label / caption;
// everything else (PDFs, a photo that failed to load) becomes a one-line entry.
const drawAttachments = (pdf, attachments, { pageWidth, maxWidth, getY, setY, ensureRoom }) => {
  if (!attachments?.length) return;
  ensureRoom(40);
  let y = getY() + 3;
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(11.5);
  pdf.setTextColor(0);
  pdf.text(`Attachments (${attachments.length})`, MARGIN, y);
  y += 3;
  pdf.setDrawColor(60);
  pdf.setLineWidth(0.6);
  pdf.line(MARGIN, y, pageWidth - MARGIN, y);
  pdf.setLineWidth(0.2);
  y += 7;
  setY(y);

  const photos = attachments.filter((a) => a.image);
  const others = attachments.filter((a) => !a.image);
  const gap = 6;
  const colW = (maxWidth - gap) / 2;
  const maxPhotoH = 70;

  for (let i = 0; i < photos.length; i += 2) {
    const row = photos.slice(i, i + 2).map((a) => ({ a, box: fitWithin(a.image.width, a.image.height, colW, maxPhotoH) }));
    const captions = row.map(({ a }) => {
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(8);
      const text = [a.label, a.caption].filter(Boolean).join(' - ') || a.name || '';
      return pdf.splitTextToSize(text, colW);
    });
    const rowH = Math.max(...row.map(({ box }) => box.height)) + 3 + Math.max(...captions.map((c) => c.length)) * 3.6 + 5;
    ensureRoom(rowH);
    const top = getY();
    row.forEach(({ a, box }, col) => {
      const x = MARGIN + col * (colW + gap);
      pdf.setDrawColor(210);
      pdf.rect(x, top, colW, box.height + 1.5);
      pdf.addImage(a.image.dataUrl, a.image.format || 'JPEG', x + (colW - box.width) / 2, top + 0.75, box.width, box.height);
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(8);
      pdf.setTextColor(60);
      captions[col].forEach((line, n) => pdf.text(line, x, top + box.height + 5 + n * 3.6));
    });
    setY(top + rowH);
  }

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9.5);
  pdf.setTextColor(30);
  others.forEach((a) => {
    pdf.splitTextToSize(`- ${attachmentLine(a)}`, maxWidth).forEach((line) => {
      ensureRoom(6);
      pdf.text(line, MARGIN, getY());
      setY(getY() + 5);
    });
  });
  pdf.setTextColor(0);
};

// entries: [{ label, isRequired, text, ruleLines, isSection }] — a section
// entry renders as a heading + rule (no answer); otherwise a field with
// `text` renders that as wrapped answer/option text, and a field without
// `text` renders `ruleLines` (default 1) blank underlines to write on.
// logo / qr / attachments are optional (see the header comment above).
const renderConsultationPdf = ({ businessName, formName, subtitleLines, entries, footer, logo, qr, attachments }) => {
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const maxWidth = pageWidth - MARGIN * 2;
  // The title block is centred on the page; with images either side it has to
  // fit between them.
  const hasSideImages = !!(logo?.dataUrl || qr?.dataUrl);
  const titleWidth = hasSideImages ? maxWidth - (HEADER_IMAGE + 6) * 2 : maxWidth;
  let y = hasSideImages ? HEADER_TOP + 8 : 20;

  const ensureRoom = (needed) => {
    if (y + needed > pageHeight - MARGIN) {
      pdf.addPage();
      y = MARGIN + 4;
    }
  };

  drawLetterheadImages(pdf, pageWidth, { logo, qr });

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(16);
  pdf.splitTextToSize(businessName || 'Clinic', titleWidth).forEach((line) => {
    pdf.text(line, pageWidth / 2, y, { align: 'center' });
    y += 7;
  });
  y += 1;
  pdf.setFontSize(12);
  pdf.splitTextToSize(formName || 'Consultation form', titleWidth).forEach((line) => {
    pdf.text(line, pageWidth / 2, y, { align: 'center' });
    y += 5.5;
  });
  y += 0.5;
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  pdf.setTextColor(90);
  (subtitleLines || []).filter(Boolean).forEach((line) => {
    pdf.splitTextToSize(line, titleWidth).forEach((wrapped) => {
      pdf.text(wrapped, pageWidth / 2, y, { align: 'center' });
      y += 4.5;
    });
  });
  pdf.setTextColor(0);
  y += 3;
  if (hasSideImages) y = Math.max(y, HEADER_TOP + HEADER_IMAGE + 14); // clear the QR + its caption
  pdf.setDrawColor(200);
  pdf.line(MARGIN, y, pageWidth - MARGIN, y);
  y += 9;

  entries.forEach(({ label, isRequired, text, ruleLines, isSection }) => {
    if (isSection) {
      ensureRoom(16);
      y += 3;
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(11.5);
      pdf.setTextColor(0);
      pdf.text(label, MARGIN, y);
      y += 3;
      pdf.setDrawColor(60);
      pdf.setLineWidth(0.6);
      pdf.line(MARGIN, y, pageWidth - MARGIN, y);
      pdf.setLineWidth(0.2);
      y += 8;
      return;
    }

    ensureRoom(14);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(10.5);
    pdf.setTextColor(0);
    pdf.text(`${label}${isRequired ? ' *' : ''}`, MARGIN, y);
    y += 5.5;
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(10);
    pdf.setTextColor(30);

    if (text !== undefined && text !== null) {
      const lines = pdf.splitTextToSize(text, maxWidth);
      lines.forEach((line) => {
        ensureRoom(LINE_H);
        pdf.text(line, MARGIN, y);
        y += LINE_H;
      });
      y += 3;
    } else {
      for (let i = 0; i < (ruleLines || 1); i += 1) {
        ensureRoom(9);
        pdf.setDrawColor(160);
        pdf.line(MARGIN, y, pageWidth - MARGIN, y);
        y += 8;
      }
      y += 1;
    }
  });

  drawAttachments(pdf, attachments, { pageWidth, maxWidth, getY: () => y, setY: (value) => { y = value; }, ensureRoom });

  if (footer) {
    pdf.setFontSize(8);
    pdf.setTextColor(120);
    // `footer` is the lead-in; the GODMINDERA credit follows it as a clickable link.
    drawProductOf(pdf, MARGIN, pageHeight - 10, { lead: footer });
  }

  return pdf;
};

// Downloads each attachment photo (shrunk, JPEG) so jsPDF can embed it.
// Non-images, and photos that can't be fetched, come back with image: null.
const prepareAttachmentsForPdf = async (attachments) => {
  const withUrls = await resolveAttachmentUrls(attachments);
  return Promise.all(withUrls.map(async (a) => ({
    ...a,
    image: attachmentKind(a) === 'image' && a.url
      ? await imageUrlToDataUrl(a.url, { maxDim: 1400, format: 'jpeg', quality: 0.8 })
      : null
  })));
};

// Logo and (optionally) QR in one step. The QR carries the logo in its centre.
const prepareBranding = async ({ logoRaw, qrText, qrCaption, qrCode }) => {
  const { image: logo } = await loadLogoAsset(logoRaw);
  const qr = qrText ? { dataUrl: await makeQrDataUrl(qrText, { logo }), caption: qrCaption, code: qrCode } : null;
  return { logo, qr };
};

// A blank, printable copy of the form template — same blank-line / checkbox
// treatment as CMMSConsultationForms.jsx's printBlankForm().
// `shareUrl` (the form's public link, when sharing is on) becomes a "scan to
// fill this in on your phone" QR in the letterhead.
export const downloadBlankConsultationFormPdf = async ({ businessName, form, fields, logoRaw, shareUrl }) => {
  const entries = fields.map((f) => {
    if (f.field_type === 'section') {
      return { label: sectionDisplayLabel(fields, f), isSection: true };
    }
    const options = Array.isArray(f.options) ? f.options : [];
    if (f.field_type === 'checkbox') {
      return { label: f.label, isRequired: f.is_required, text: '☐ Yes      ☐ No' };
    }
    if ((f.field_type === 'select' || f.field_type === 'multiselect') && options.length) {
      return { label: f.label, isRequired: f.is_required, text: options.map((o) => `☐ ${o}`).join('    ') };
    }
    return { label: f.label, isRequired: f.is_required, ruleLines: f.field_type === 'textarea' ? 3 : 1 };
  });
  const { logo, qr } = await prepareBranding({ logoRaw, qrText: shareUrl, qrCaption: 'Scan to fill in online' });
  const pdf = renderConsultationPdf({
    businessName,
    formName: form.name,
    subtitleLines: [form.description, 'Patient name: _______________________     Date: _______________'],
    entries,
    footer: `Printed ${new Date().toLocaleString()} · Powered by IcanEra · `,
    logo,
    qr
  });
  pdf.save(`${safeFilename(form.name)}-blank.pdf`);
};

// A staff-viewed patient submission — mirrors printSubmission() in
// CMMSConsultationForms.jsx. `entries` is that file's own submissionEntries()
// output ({ label, fieldType, value }[]), reused as-is so the PDF and the
// on-screen/print views never disagree about labels or ordering.
// The letterhead QR is the record's reference code; its attachments follow the answers.
// `logoRaw` / `showQr` carry the form owner's options: no logoRaw = no logo, showQr false = no QR.
export const downloadConsultationSubmissionPdf = async ({ businessName, formName, submission, entries, logoRaw, showQr = true }) => {
  const contactLine = [submission.patient_phone, submission.patient_email, submission.patient_dob ? `DOB ${submission.patient_dob}` : null].filter(Boolean).join(' · ');
  const pdfEntries = entries.map(({ label, fieldType, value, isSection }) => (
    isSection ? { label, isSection: true } : {
      label,
      text: fieldType === 'checkbox'
        ? (value ? 'Yes' : 'No')
        : Array.isArray(value)
          ? (value.length ? value.join(', ') : '—')
          : ((value || value === 0) ? String(value) : '—')
    }
  ));
  const code = recordReferenceCode(submission.id);
  const [{ logo, qr }, attachments] = await Promise.all([
    prepareBranding({ logoRaw, qrText: showQr ? recordQrPayload(submission.id) : '', qrCaption: 'Record reference', qrCode: formatReferenceCode(code) }),
    prepareAttachmentsForPdf(submission.attachments)
  ]);
  const pdf = renderConsultationPdf({
    businessName,
    formName: submission.form_name_snapshot || formName || 'Consultation form',
    subtitleLines: [
      `Patient: ${submission.patient_name}${contactLine ? ' · ' + contactLine : ''}`,
      submission.patient_address ? `Address: ${submission.patient_address}` : null,
      `Submitted: ${new Date(submission.created_at).toLocaleString()} (${submission.submitted_via === 'public_link' ? 'via public link' : 'recorded by staff'})`
    ],
    entries: pdfEntries,
    footer: `Printed ${new Date().toLocaleString()} · Powered by IcanEra · `,
    logo,
    qr,
    attachments
  });
  pdf.save(`${safeFilename(submission.patient_name)}-${safeFilename(submission.form_name_snapshot || formName)}.pdf`);
};

// The patient's own copy, right after they submit on the public share-link
// page (PublicConsultationFormViewer.jsx) — same shape as
// downloadConsultationSubmissionPdf but working from the public RPC's field
// list (fieldKey/fieldType/isRequired) and freshly-typed responses instead
// of a saved submission row.
// `attachments` are the patient's own uploads; `submissionId` (returned by the submit RPC)
// puts their record reference code and QR on the copy.
export const downloadPublicConsultationSubmissionPdf = async ({ form, patient, responses, attachments, submissionId, logoRaw, showQr = true }) => {
  const contactLine = [patient.phone, patient.email, patient.dob ? `DOB ${patient.dob}` : null].filter(Boolean).join(' · ');
  const entries = (form.fields || []).map((f) => {
    if (f.fieldType === 'section') return { label: sectionDisplayLabel(form.fields, f), isSection: true };
    const value = responses[f.fieldKey];
    const text = f.fieldType === 'checkbox'
      ? (value ? 'Yes' : 'No')
      : Array.isArray(value)
        ? (value.length ? value.join(', ') : '—')
        : (value || '—');
    return { label: f.label, text };
  });
  const code = recordReferenceCode(submissionId);
  const [{ logo, qr }, preparedAttachments] = await Promise.all([
    prepareBranding({
      logoRaw,
      qrText: showQr ? recordQrPayload(submissionId) : '',
      qrCaption: 'Show this at reception',
      qrCode: formatReferenceCode(code)
    }),
    prepareAttachmentsForPdf(attachments)
  ]);
  const pdf = renderConsultationPdf({
    businessName: form.businessName,
    formName: form.formName,
    subtitleLines: [`Patient: ${patient.name}${contactLine ? ' · ' + contactLine : ''}`, patient.address ? `Address: ${patient.address}` : null, `Submitted: ${new Date().toLocaleString()}`],
    entries,
    footer: 'Powered by IcanEra · ',
    logo,
    qr,
    attachments: preparedAttachments
  });
  pdf.save(`${safeFilename(patient.name)}-${safeFilename(form.formName)}.pdf`);
};
