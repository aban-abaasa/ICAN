import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkNationalIdFormat, describeNationalIdRule, isMissingFunctionError, maskedNationalId,
  nationalIdFormatMessage, nationalIdInputMode, normalizeNationalId
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
