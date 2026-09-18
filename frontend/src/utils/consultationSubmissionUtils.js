// Shared between CMMSConsultationForms.jsx (a single form's submissions),
// CMMSClinicalRecords.jsx (every submission across every form, in one
// place), and PublicConsultationFormViewer.jsx/generateConsultationFormPdf.js
// (the live/blank form itself) so a section header's number and a
// submission's answers are interpreted identically wherever they're shown.

// Section numbering is always computed fresh from current order — never
// stored — so adding, deleting, or reordering a section keeps every number
// correct everywhere with nothing to manually renumber. This strips any
// number a preset (or an older version of one) baked into the label
// itself, so re-numbering never doubles up ("1. 1. Personal Information").
const SECTION_NUMBER_PREFIX = /^\d+\.\s*/;
export const bareSectionLabel = (label) => String(label || '').replace(SECTION_NUMBER_PREFIX, '');

// One field from `fields`/`form.fields`, numbered against its position
// among sections in that same array — works for both field shapes CMMS
// uses: the staff-side field_type/label rows and the public share-link
// RPC's fieldType/label rows. Non-section fields come back unchanged.
export const sectionDisplayLabel = (fields, field) => {
  const isSection = (f) => f.field_type === 'section' || f.fieldType === 'section';
  if (!isSection(field)) return field.label;
  let n = 0;
  for (const f of fields || []) {
    if (isSection(f)) n += 1;
    if (f === field || (f.id && field.id && f.id === field.id)) break;
  }
  return `${n}. ${bareSectionLabel(field.label)}`;
};

// A form's fields as they were AT SUBMISSION TIME may no longer match the
// live template — this starts from the live template (so a still-current
// section header always keeps its place in the layout) but only keeps a
// question if the submission actually answered it, then appends any
// answered key that's no longer on the template at all, so a deleted
// field's historical answer is never silently dropped.
export const submissionEntries = (submission, fields) => {
  const responses = submission?.responses || {};
  const seenKeys = new Set();
  const fromTemplate = (fields || []).map((f) => {
    seenKeys.add(f.field_key);
    if (f.field_type === 'section') {
      return { key: f.field_key, isSection: true, label: f.label, sortOrder: f.sort_order };
    }
    return {
      key: f.field_key, isSection: false, label: f.label, fieldType: f.field_type,
      sortOrder: f.sort_order, value: responses[f.field_key]
    };
  }).filter((e) => e.isSection || Object.prototype.hasOwnProperty.call(responses, e.key));
  const orphaned = Object.entries(responses)
    .filter(([key]) => !seenKeys.has(key))
    .map(([key, value]) => ({ key, isSection: false, label: key.replace(/_/g, ' '), fieldType: null, sortOrder: 9999, value }));
  const ordered = [...fromTemplate, ...orphaned].sort((a, b) => a.sortOrder - b.sortOrder);
  let n = 0;
  return ordered.map((entry) => {
    if (!entry.isSection) return entry;
    n += 1;
    return { ...entry, label: `${n}. ${bareSectionLabel(entry.label)}` };
  });
};

export const formatAnswer = (entry) => {
  if (entry.fieldType === 'checkbox') return entry.value ? 'Yes' : 'No';
  if (Array.isArray(entry.value)) return entry.value.length ? entry.value.join(', ') : '—';
  return entry.value || entry.value === 0 ? String(entry.value) : '—';
};
