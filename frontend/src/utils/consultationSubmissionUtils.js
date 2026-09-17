// Shared between CMMSConsultationForms.jsx (a single form's submissions)
// and CMMSClinicalRecords.jsx (every submission across every form, in one
// place) so a submission's answers are interpreted identically wherever
// they're shown — same section-header handling, same fallback for a field
// that's since been renamed/retyped/deleted from its live template.

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
  return [...fromTemplate, ...orphaned].sort((a, b) => a.sortOrder - b.sortOrder);
};

export const formatAnswer = (entry) => {
  if (entry.fieldType === 'checkbox') return entry.value ? 'Yes' : 'No';
  if (Array.isArray(entry.value)) return entry.value.length ? entry.value.join(', ') : '—';
  return entry.value || entry.value === 0 ? String(entry.value) : '—';
};
