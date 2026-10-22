import test from 'node:test';
import assert from 'node:assert/strict';
import { splitAttemptsMessage } from '../src/utils/pinAttempts.js';

test('a wrong-PIN message is split into its text and the count it carries', () => {
  assert.deepEqual(splitAttemptsMessage('❌ Invalid PIN. Attempts remaining: 2'), { text: '❌ Invalid PIN.', attempts: 2 });
  assert.deepEqual(splitAttemptsMessage('Invalid PIN. attempts remaining:1'), { text: 'Invalid PIN.', attempts: 1 });
});

test('the count never goes below zero (the server counts one past the last try)', () => {
  assert.equal(splitAttemptsMessage('❌ Invalid PIN. Attempts remaining: 0').attempts, 0);
  assert.equal(splitAttemptsMessage('❌ Invalid PIN. Attempts remaining: -1').attempts, 0);
});

test('an error that is not about the PIN has no count to show', () => {
  assert.deepEqual(splitAttemptsMessage('❌ Insufficient balance. Nothing was moved.'), { text: '❌ Insufficient balance. Nothing was moved.', attempts: null });
  assert.deepEqual(splitAttemptsMessage('🔒 Account locked. Too many failed PIN attempts. Contact support.').attempts, null);
});

test('no message at all is empty text and no count', () => {
  assert.deepEqual(splitAttemptsMessage(null), { text: '', attempts: null });
  assert.deepEqual(splitAttemptsMessage(undefined), { text: '', attempts: null });
  assert.deepEqual(splitAttemptsMessage(''), { text: '', attempts: null });
});
