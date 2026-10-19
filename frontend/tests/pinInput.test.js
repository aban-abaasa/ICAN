import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cleanPin, isValidPin } from '../src/utils/pinInput.js';

describe('PIN input', () => {
  it('keeps digits only and stops at 6', () => {
    assert.equal(cleanPin('12 34-56'), '123456');
    assert.equal(cleanPin('1234567890'), '123456');
    assert.equal(cleanPin('ab12'), '12');
    assert.equal(cleanPin(null), '');
  });
  it('accepts 4, 5 and 6 digit PINs the wallet allows', () => {
    for (const p of ['1234', '12345', '123456']) assert.equal(isValidPin(p), true);
  });
  it('rejects too short, too long and non-numeric', () => {
    for (const p of ['', '123', '1234567', '12a4', undefined]) assert.equal(isValidPin(p), false);
  });
});
