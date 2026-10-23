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

// Phone keyboard to open for the ID field: digits-only IDs (e.g. Kenya, Tanzania) get the number
// pad; IDs with letters (Uganda's CM…/CF…) keep the full keyboard. Judged from the example value.
export const nationalIdInputMode = (rule) => (rule?.example && /^[0-9\s.-]+$/.test(String(rule.example)) ? 'numeric' : 'text');

// What to show for an ID already on file: "NIN ending 90AB".
export const maskedNationalId = (idType, last4) => {
  if (!last4) return '';
  return `${idType || 'ID'} ending ${last4}`;
};

// ── Proving an ID is yours (backend/NATIONAL_ID_OWNERSHIP.sql) ─────────────────────────────────

// The photos go to the EXISTING R2 folder the CMMS employee ID documents already use, through the existing
// presign-upload route: the app is at Vercel's function limit, so there is no route or folder of its own.
export const ID_PROOF_FOLDER = 'cmms-employment-documents';
export const ID_PROOF_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const ID_PROOF_MAX_BYTES = 8 * 1024 * 1024;

// A photo is acceptable if it is a JPEG, PNG or WebP picture of a sensible size. { ok, error? }
export const checkProofImage = (file, what = 'photo') => {
  if (!file) return { ok: false, error: `Add a ${what}.` };
  if (!ID_PROOF_TYPES.includes(file.type)) return { ok: false, error: `The ${what} must be a JPG, PNG or WebP picture.` };
  if (!(file.size > 0)) return { ok: false, error: `The ${what} is empty. Please choose it again.` };
  if (file.size > ID_PROOF_MAX_BYTES) return { ok: false, error: `The ${what} is too large (the limit is ${Math.round(ID_PROOF_MAX_BYTES / 1048576)} MB).` };
  return { ok: true };
};

// The words of a name, the way the database splits them: lower-case letters only, no repeats.
export const nameWords = (name) => [...new Set(
  String(name ?? '').toLowerCase().replace(/[^\p{L}\s]/gu, ' ').split(/\s+/).filter(Boolean)
)];

// "Aban Abaasa" is a full name; "Aban" is not. The ID's name must have at least two real words.
export const isFullName = (name) => nameWords(name).filter((w) => w.length >= 2).length >= 2;

// Does the wallet's name fit the name printed on the ID? Every word of the wallet name must be on the ID
// (a single letter counts as an initial). Same rule as national_id_name_matches() in the database.
export const nameFitsId = (walletName, idName) => {
  const wallet = nameWords(walletName);
  if (!wallet.length) return false;
  const id = nameWords(idName);
  return wallet.every((w) => (w.length === 1 ? id.some((x) => x[0] === w) : id.includes(w)));
};

// Everything that can be checked before a photo is uploaded. Returns an error message, or '' when all is well.
export const proofFormProblem = ({ nameOnId, walletName, idPhoto, selfie, needsId = false, country = '', value = '' } = {}) => {
  if (needsId) {
    if (!String(country || '').trim()) return 'Choose the country of your ID.';
    if (!normalizeNationalId(value)) return 'Enter your national ID number.';
  }
  if (!isFullName(nameOnId)) return 'Enter your full name exactly as it is printed on your ID (at least two names).';
  if (walletName && !nameFitsId(walletName, nameOnId)) {
    return `The name on your wallet (${walletName}) has to match the name on your ID. Change the wallet name in your account settings, or type the name exactly as printed on the ID.`;
  }
  const idCheck = checkProofImage(idPhoto, 'photo of your ID');
  if (!idCheck.ok) return idCheck.error;
  const selfieCheck = checkProofImage(selfie, 'selfie holding your ID');
  if (!selfieCheck.ok) return selfieCheck.error;
  return '';
};

// Where a person stands, in one word:
//   unavailable  the database part is not installed        verified    a reviewer confirmed the ID is theirs
//   none         no ID saved and no request                pending     a request is waiting for a reviewer
//   unverified   an ID is saved, nothing proven yet        rejected    the newest request was turned down
export const idVerificationState = (status) => {
  if (!status || status.available === false) return 'unavailable';
  if (status.verified) return 'verified';
  if (status.check?.status === 'pending') return 'pending';
  if (status.check?.status === 'rejected') return 'rejected';
  return status.hasId ? 'unverified' : 'none';
};

// The "already linked to another wallet" answer: the one case where the person can ask to take the ID back.
export const isIdTakenResult = (result) => !!result && !result.success
  && (result.code === 'id_taken' || /already linked to another wallet/i.test(String(result.error || '')));

// What a sender is told about the person they are about to pay. `trust` is { verified, nameMatches } or null
// when the database cannot say (then nothing is shown, rather than a wrong "not verified").
export const idTrustLabel = (trust) => {
  if (!trust) return null;
  if (!trust.verified) return { tone: 'warn', text: 'ID not verified' };
  if (!trust.nameMatches) return { tone: 'warn', text: 'ID verified, but the wallet name differs from the name on it' };
  return { tone: 'ok', text: 'ID verified' };
};

// A database refusal such as "NATIONAL_ID_NAME_LOCKED: your wallet name is tied to…" without its machine-readable prefix,
// so it can be shown to a person as the sentence it is.
export const friendlyIdError = (message) => String(message ?? '').replace(/^\s*(?:[^:]{0,40}:\s*)?NATIONAL_ID_[A-Z_]+:\s*/i, '');
