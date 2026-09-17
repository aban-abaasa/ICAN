import { jsPDF } from 'jspdf';

// Real "Download PDF" for CMMS consultation forms — a proper jsPDF
// document (paginated, no popup) rather than the window.print() dialog
// CMMSConsultationForms.jsx/PublicConsultationFormViewer.jsx already offer
// for a physical printout. Same jsPDF-direct approach as
// generateEmploymentDocumentPdf.js, minus that file's verify-QR seal (a
// consultation form's PDF is a record copy, not a document needing
// authenticity verification).

const safeFilename = (value) => (value || 'form')
  .trim().replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'form';

const MARGIN = 18;
const LINE_H = 5.5;

// entries: [{ label, isRequired, text, ruleLines }] — a field with `text`
// renders that as wrapped answer/option text; a field without `text`
// renders `ruleLines` (default 1) blank underlines for someone to write on.
const renderConsultationPdf = ({ businessName, formName, subtitleLines, entries, footer }) => {
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const maxWidth = pageWidth - MARGIN * 2;
  let y = 20;

  const ensureRoom = (needed) => {
    if (y + needed > pageHeight - MARGIN) {
      pdf.addPage();
      y = MARGIN + 4;
    }
  };

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(16);
  pdf.text(businessName || 'Clinic', pageWidth / 2, y, { align: 'center' });
  y += 8;
  pdf.setFontSize(12);
  pdf.text(formName || 'Consultation form', pageWidth / 2, y, { align: 'center' });
  y += 6;
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  pdf.setTextColor(90);
  (subtitleLines || []).filter(Boolean).forEach((line) => {
    pdf.splitTextToSize(line, maxWidth).forEach((wrapped) => {
      pdf.text(wrapped, pageWidth / 2, y, { align: 'center' });
      y += 4.5;
    });
  });
  pdf.setTextColor(0);
  y += 3;
  pdf.setDrawColor(200);
  pdf.line(MARGIN, y, pageWidth - MARGIN, y);
  y += 9;

  entries.forEach(({ label, isRequired, text, ruleLines }) => {
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

  if (footer) {
    pdf.setFontSize(8);
    pdf.setTextColor(120);
    pdf.text(footer, MARGIN, pageHeight - 10);
  }

  return pdf;
};

// A blank, printable copy of the form template — same blank-line / checkbox
// treatment as CMMSConsultationForms.jsx's printBlankForm().
export const downloadBlankConsultationFormPdf = ({ businessName, form, fields }) => {
  const entries = fields.map((f) => {
    const options = Array.isArray(f.options) ? f.options : [];
    if (f.field_type === 'checkbox') {
      return { label: f.label, isRequired: f.is_required, text: '☐ Yes      ☐ No' };
    }
    if ((f.field_type === 'select' || f.field_type === 'multiselect') && options.length) {
      return { label: f.label, isRequired: f.is_required, text: options.map((o) => `☐ ${o}`).join('    ') };
    }
    return { label: f.label, isRequired: f.is_required, ruleLines: f.field_type === 'textarea' ? 3 : 1 };
  });
  const pdf = renderConsultationPdf({
    businessName,
    formName: form.name,
    subtitleLines: [form.description, 'Patient name: _______________________     Date: _______________'],
    entries,
    footer: `Printed ${new Date().toLocaleString()} · Powered by IcanEra`
  });
  pdf.save(`${safeFilename(form.name)}-blank.pdf`);
};

// A staff-viewed patient submission — mirrors printSubmission() in
// CMMSConsultationForms.jsx. `entries` is that file's own submissionEntries()
// output ({ label, fieldType, value }[]), reused as-is so the PDF and the
// on-screen/print views never disagree about labels or ordering.
export const downloadConsultationSubmissionPdf = ({ businessName, formName, submission, entries }) => {
  const contactLine = [submission.patient_phone, submission.patient_email].filter(Boolean).join(' · ');
  const pdfEntries = entries.map(({ label, fieldType, value }) => ({
    label,
    text: fieldType === 'checkbox'
      ? (value ? 'Yes' : 'No')
      : Array.isArray(value)
        ? (value.length ? value.join(', ') : '—')
        : ((value || value === 0) ? String(value) : '—')
  }));
  const pdf = renderConsultationPdf({
    businessName,
    formName: submission.form_name_snapshot || formName || 'Consultation form',
    subtitleLines: [
      `Patient: ${submission.patient_name}${contactLine ? ' · ' + contactLine : ''}`,
      `Submitted: ${new Date(submission.created_at).toLocaleString()} (${submission.submitted_via === 'public_link' ? 'via public link' : 'recorded by staff'})`
    ],
    entries: pdfEntries,
    footer: `Printed ${new Date().toLocaleString()} · Powered by IcanEra`
  });
  pdf.save(`${safeFilename(submission.patient_name)}-${safeFilename(submission.form_name_snapshot || formName)}.pdf`);
};

// The patient's own copy, right after they submit on the public share-link
// page (PublicConsultationFormViewer.jsx) — same shape as
// downloadConsultationSubmissionPdf but working from the public RPC's field
// list (fieldKey/fieldType/isRequired) and freshly-typed responses instead
// of a saved submission row.
export const downloadPublicConsultationSubmissionPdf = ({ form, patient, responses }) => {
  const contactLine = [patient.phone, patient.email].filter(Boolean).join(' · ');
  const entries = (form.fields || []).map((f) => {
    const value = responses[f.fieldKey];
    const text = f.fieldType === 'checkbox'
      ? (value ? 'Yes' : 'No')
      : Array.isArray(value)
        ? (value.length ? value.join(', ') : '—')
        : (value || '—');
    return { label: f.label, text };
  });
  const pdf = renderConsultationPdf({
    businessName: form.businessName,
    formName: form.formName,
    subtitleLines: [`Patient: ${patient.name}${contactLine ? ' · ' + contactLine : ''}`, `Submitted: ${new Date().toLocaleString()}`],
    entries,
    footer: 'Powered by IcanEra'
  });
  pdf.save(`${safeFilename(patient.name)}-${safeFilename(form.formName)}.pdf`);
};
