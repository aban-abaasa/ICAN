/**
 * National ID helpers shared by the wallet screens (pure functions — no network).
 * The server (backend/NATIONAL_ID_PER_COUNTRY.sql) is the authority; these exist so a
 * mistyped ID is caught while the person is still looking at the field.
 */

// Same normalisation the database applies before it checks the format and hashes the ID:
// upper-case, with spaces, dots and dashes removed ("cm 1234-5678.90ab" -> "CM1234567890AB").
export const normalizeNationalId = (value) => String(value ?? '').toUpperCase().replace(/[\s.-]/g, '');

// A rule is the row returned by get_national_id_rule(). `pattern` is a POSIX regex written for
// the normalised value. The patterns shipped with the migration are plain enough to mean the same
// in JavaScript; if an admin writes a POSIX-only pattern JavaScript rejects, we skip the local check
// and let the server decide rather than wrongly blocking the person.
export const checkNationalIdFormat = (rule, value) => {
  const normalized = normalizeNationalId(value);
  if (!normalized) return { ok: false, empty: true, normalized };
  if (!rule?.pattern) return { ok: true, normalized };
  try {
    return { ok: new RegExp(rule.pattern).test(normalized), normalized };
  } catch {
    return { ok: true, normalized };
  }
};

// "National Identification Number (NIN) — 14 characters, starting with CM or CF"
export const describeNationalIdRule = (rule) => {
  if (!rule) return '';
  return [rule.label, rule.hint].filter(Boolean).join(' — ');
};

// The message shown when a typed ID does not match the country's format.
export const nationalIdFormatMessage = (rule) => {
  const label = rule?.label || 'national ID';
  return `That does not look like a valid ${label}${rule?.hint ? ` (${rule.hint})` : ''}.`;
};

// Supabase/PostgREST report a function that has not been deployed yet in a few shapes.
// While the migration has not been run we treat the whole feature as "not available"
// (no field, no blocking screen) so the app can be deployed before the SQL is.
export const isMissingFunctionError = (error) => {
  if (!error) return false;
  if (error.code === 'PGRST202' || error.code === '42883') return true;
  return /could not find the function|function .* does not exist/i.test(String(error.message || ''));
};

// What to show for an ID already on file: "NIN ending 90AB".
export const maskedNationalId = (idType, last4) => {
  if (!last4) return '';
  return `${idType || 'ID'} ending ${last4}`;
};
