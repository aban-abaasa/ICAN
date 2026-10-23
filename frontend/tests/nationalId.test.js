import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkNationalIdFormat, checkProofImage, describeNationalIdRule, friendlyIdError, ID_PROOF_FOLDER, ID_PROOF_MAX_BYTES,
  idTrustLabel, idVerificationState, isFullName, isIdTakenResult, isMissingFunctionError, maskedNationalId,
  nameFitsId, nameWords, nationalIdFormatMessage, nationalIdInputMode, normalizeNationalId, proofFormProblem
} from '../src/utils/nationalId.js';

const UG = { label: 'National Identification Number (NIN)', hint: '14 characters, starting with CM or CF', pattern: '^C[MF][0-9A-Z]{12}$' };
const KE = { label: 'National ID number', hint: '7 or 8 digits', pattern: '^[0-9]{7,8}$' };

describe('normalising an ID the way the database does', () => {
  it('upper-cases and strips spaces, dots and dashes', () => {
    assert.equal(normalizeNationalId('cm 1234-5678.90ab'), 'CM1234567890AB');
  });
  it('handles empty and non-string input', () => {
    assert.equal(normalizeNationalId(''), '');
    assert.equal(normalizeNationalId(null), '');
    assert.equal(normalizeNationalId(undefined), '');
    assert.equal(normalizeNationalId(12345678), '12345678');
  });
});

describe('format check against a country rule', () => {
  it('accepts a well-formed Ugandan NIN however it is typed', () => {
    assert.equal(checkNationalIdFormat(UG, 'CM1234567890AB').ok, true);
    assert.equal(checkNationalIdFormat(UG, ' cf 1234 5678 90ab ').ok, true);
  });
  it('rejects the wrong prefix, length or characters', () => {
    assert.equal(checkNationalIdFormat(UG, 'XX1234567890AB').ok, false);
    assert.equal(checkNationalIdFormat(UG, 'CM12345').ok, false);
    assert.equal(checkNationalIdFormat(UG, 'CM1234567890A!').ok, false);
  });
  it('uses the rule of the country it is given (Kenya is digits only)', () => {
    assert.equal(checkNationalIdFormat(KE, '1234567').ok, true);
    assert.equal(checkNationalIdFormat(KE, '123456').ok, false);
    assert.equal(checkNationalIdFormat(KE, 'CM1234567890AB').ok, false);
  });
  it('flags an empty value separately so the form can say "required"', () => {
    const r = checkNationalIdFormat(UG, '   ');
    assert.equal(r.ok, false);
    assert.equal(r.empty, true);
  });
  it('lets the server decide when there is no rule or the pattern is not valid JavaScript', () => {
    assert.equal(checkNationalIdFormat(null, 'ABC123').ok, true);
    assert.equal(checkNationalIdFormat({ pattern: '^[[:digit:]]{5}$(' }, 'ABC123').ok, true);
  });
  it('returns the normalised value that will be sent', () => {
    assert.equal(checkNationalIdFormat(UG, 'cm1234567890ab').normalized, 'CM1234567890AB');
  });
});

describe('wording', () => {
  it('describes a rule for the field hint', () => {
    assert.equal(describeNationalIdRule(UG), 'National Identification Number (NIN) — 14 characters, starting with CM or CF');
    assert.equal(describeNationalIdRule({ label: 'ID' }), 'ID');
    assert.equal(describeNationalIdRule(null), '');
  });
  it('builds the invalid-format message', () => {
    assert.equal(nationalIdFormatMessage(KE), 'That does not look like a valid National ID number (7 or 8 digits).');
    assert.equal(nationalIdFormatMessage(null), 'That does not look like a valid national ID.');
  });
  it('shows only the last characters of an ID on file', () => {
    assert.equal(maskedNationalId('NIN', '90AB'), 'NIN ending 90AB');
    assert.equal(maskedNationalId(null, '1234'), 'ID ending 1234');
    assert.equal(maskedNationalId('NIN', ''), '');
  });
});

describe('choosing the phone keyboard', () => {
  it('opens the number pad only when the example ID is all digits', () => {
    assert.equal(nationalIdInputMode({ example: '12345678' }), 'numeric');
    assert.equal(nationalIdInputMode({ example: '1234 567 890' }), 'numeric');
    assert.equal(nationalIdInputMode({ example: 'CM1234567890AB' }), 'text');
    assert.equal(nationalIdInputMode(null), 'text');
    assert.equal(nationalIdInputMode({}), 'text');
  });
});

describe('detecting a database that has not had the migration yet', () => {
  it('recognises the shapes PostgREST / Postgres use', () => {
    assert.equal(isMissingFunctionError({ code: 'PGRST202', message: 'x' }), true);
    assert.equal(isMissingFunctionError({ code: '42883', message: 'x' }), true);
    assert.equal(isMissingFunctionError({ message: 'Could not find the function public.get_my_national_id_status without parameters in the schema cache' }), true);
  });
  it('does not mistake a real failure for a missing feature', () => {
    assert.equal(isMissingFunctionError(null), false);
    assert.equal(isMissingFunctionError({ code: '57014', message: 'canceling statement due to timeout' }), false);
    assert.equal(isMissingFunctionError({ message: 'Failed to fetch' }), false);
  });
});


// ── proving an ID is yours ───────────────────────────────────────────────────────────────────────────────────────────

const photo = (over = {}) => ({ type: 'image/jpeg', size: 200_000, name: 'a.jpg', ...over });

describe('where the photos go', () => {
  it('uses a folder the upload route already allows (the app cannot add another serverless function)', async () => {
    const { readFileSync } = await import('node:fs');
    const route = readFileSync(new URL('../api/storage/[action].js', import.meta.url), 'utf8');
    const allowed = route.match(/const ALLOWED_FOLDERS = \[([^\]]*)\]/)[1];
    assert.ok(allowed.includes(`'${ID_PROOF_FOLDER}'`), `${ID_PROOF_FOLDER} must be one of the folders presign-upload accepts`);
  });
  it('is the same folder as the database function accepts', async () => {
    const { readFileSync } = await import('node:fs');
    const sql = readFileSync(new URL('../../backend/NATIONAL_ID_OWNERSHIP.sql', import.meta.url), 'utf8');
    assert.ok(sql.includes(`r2://${ID_PROOF_FOLDER}/`));
  });
});

describe('checking a photo before it is uploaded', () => {
  it('accepts JPEG, PNG and WebP of a sensible size', () => {
    for (const type of ['image/jpeg', 'image/png', 'image/webp']) assert.equal(checkProofImage(photo({ type })).ok, true);
  });
  it('rejects a missing, empty, oversized or non-image file, saying which', () => {
    assert.match(checkProofImage(null, 'selfie').error, /Add a selfie/);
    assert.match(checkProofImage(photo({ size: 0 })).error, /empty/);
    assert.match(checkProofImage(photo({ size: ID_PROOF_MAX_BYTES + 1 })).error, /too large/);
    assert.match(checkProofImage(photo({ type: 'application/pdf' })).error, /JPG, PNG or WebP/);
    assert.match(checkProofImage(photo({ type: 'image/gif' })).error, /JPG, PNG or WebP/);
  });
});

describe('names', () => {
  it('splits a name into lower-case words, ignoring punctuation and repeats', () => {
    assert.deepEqual(nameWords("KATO  Bob-Mugisha, bob"), ['kato', 'bob', 'mugisha']);
    assert.deepEqual(nameWords(null), []);
  });
  it('wants at least two real names', () => {
    assert.equal(isFullName('Bob Kato'), true);
    assert.equal(isFullName('KATO BOB MUGISHA'), true);
    assert.equal(isFullName('Bob'), false);
    assert.equal(isFullName('B K'), false);
    assert.equal(isFullName(''), false);
  });
  it('lets a wallet name be a shorter form of the name on the ID, but not a different person', () => {
    assert.equal(nameFitsId('Bob Kato', 'KATO BOB MUGISHA'), true);
    assert.equal(nameFitsId('kato', 'Kato Bob Mugisha'), true);
    assert.equal(nameFitsId('B. Kato', 'Kato Bob Mugisha'), true);
    assert.equal(nameFitsId('Bob Nakato', 'Kato Bob Mugisha'), false);
    assert.equal(nameFitsId('Alice', 'Kato Bob Mugisha'), false);
    assert.equal(nameFitsId('', 'Kato Bob Mugisha'), false);
  });
});

describe('the form, checked before anything is uploaded', () => {
  const ok = { nameOnId: 'Bob Kato Mugisha', walletName: 'Bob Kato', idPhoto: photo(), selfie: photo() };
  it('passes a complete, consistent form', () => assert.equal(proofFormProblem(ok), ''));
  it('asks for the ID number and country only when claiming', () => {
    assert.equal(proofFormProblem({ ...ok, needsId: false }), '');
    assert.match(proofFormProblem({ ...ok, needsId: true, country: '', value: 'CM1234567890AB' }), /country/);
    assert.match(proofFormProblem({ ...ok, needsId: true, country: 'UG', value: ' ' }), /ID number/);
    assert.equal(proofFormProblem({ ...ok, needsId: true, country: 'UG', value: 'CM1234567890AB' }), '');
  });
  it('refuses a name that is not the wallet\'s, naming both', () => {
    const msg = proofFormProblem({ ...ok, nameOnId: 'Zed Yusuf' });
    assert.match(msg, /Bob Kato/);
    assert.match(msg, /match the name on your ID/);
  });
  it('refuses a single name, a missing photo and a missing selfie, in that order', () => {
    assert.match(proofFormProblem({ ...ok, nameOnId: 'Bob' }), /full name/);
    assert.match(proofFormProblem({ ...ok, idPhoto: null }), /photo of your ID/);
    assert.match(proofFormProblem({ ...ok, selfie: null }), /selfie/);
  });
  it('does not insist on a wallet name that does not exist yet', () => assert.equal(proofFormProblem({ ...ok, walletName: '' }), ''));
});

describe('where a person stands', () => {
  const base = { available: true, authenticated: true, hasId: true, verified: false, check: null };
  it('reads each situation', () => {
    assert.equal(idVerificationState(null), 'unavailable');
    assert.equal(idVerificationState({ available: false }), 'unavailable');
    assert.equal(idVerificationState({ ...base, hasId: false }), 'none');
    assert.equal(idVerificationState(base), 'unverified');
    assert.equal(idVerificationState({ ...base, verified: true }), 'verified');
    assert.equal(idVerificationState({ ...base, check: { status: 'pending' } }), 'pending');
    assert.equal(idVerificationState({ ...base, hasId: false, check: { status: 'pending', kind: 'claim' } }), 'pending');
    assert.equal(idVerificationState({ ...base, check: { status: 'rejected' } }), 'rejected');
  });
  it('a verified ID stays verified whatever an old request says', () => {
    assert.equal(idVerificationState({ ...base, verified: true, check: { status: 'rejected' } }), 'verified');
  });
  it('an approved request that no longer holds the ID falls back to what is saved', () => {
    assert.equal(idVerificationState({ ...base, hasId: false, check: { status: 'approved' } }), 'none');
    assert.equal(idVerificationState({ ...base, check: { status: 'approved' } }), 'unverified');
  });
});

describe('the "already linked" answer', () => {
  it('is recognised by its code or its words', () => {
    assert.equal(isIdTakenResult({ success: false, code: 'id_taken', error: 'x' }), true);
    assert.equal(isIdTakenResult({ success: false, error: 'This ID is already linked to another wallet. If it is yours, contact support.' }), true);
  });
  it('is not mistaken for anything else', () => {
    assert.equal(isIdTakenResult({ success: false, error: 'That does not look like a valid NIN.' }), false);
    assert.equal(isIdTakenResult({ success: true }), false);
    assert.equal(isIdTakenResult(null), false);
  });
});

describe('what a sender is told', () => {
  it('shows nothing when the database could not say', () => assert.equal(idTrustLabel(null), null));
  it('warns about an unverified person', () => assert.deepEqual(idTrustLabel({ verified: false, nameMatches: false }), { tone: 'warn', text: 'ID not verified' }));
  it('confirms a verified person whose name fits', () => assert.deepEqual(idTrustLabel({ verified: true, nameMatches: true }), { tone: 'ok', text: 'ID verified' }));
  it('does not call a verified person with a different wallet name plainly "verified"', () => {
    const label = idTrustLabel({ verified: true, nameMatches: false });
    assert.equal(label.tone, 'warn');
    assert.match(label.text, /differs/);
  });
});

describe('database refusals shown as sentences', () => {
  it('drops the machine-readable prefix', () => {
    assert.equal(friendlyIdError('NATIONAL_ID_NAME_LOCKED: your wallet name is tied to your ID.'), 'your wallet name is tied to your ID.');
    assert.equal(friendlyIdError('P0001: NATIONAL_ID_NOT_VERIFIED: verify your ID'), 'verify your ID');
  });
  it('leaves other messages alone', () => {
    assert.equal(friendlyIdError('Network error'), 'Network error');
    assert.equal(friendlyIdError(undefined), '');
  });
});
