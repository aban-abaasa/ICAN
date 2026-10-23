import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PasskeyError, assertionPayload, b64urlToBytes, biometricName, bytesToB64url, creationOptionsFromServer, describeWebAuthnError,
  deviceLabel, registrationPayload, requestOptionsFromServer,
} from '../src/utils/webauthn.js';
import { b64urlEncode as serverEncode } from '../../backend/components/supabase/functions/_shared/webauthn.js';

const bytes = (...n) => Uint8Array.from(n);
const buffer = (...n) => bytes(...n).buffer;

test('base64url matches the server\'s encoding exactly, so ids and challenges survive the round trip', () => {
  const all = Uint8Array.from({ length: 256 }, (_, i) => i);
  assert.equal(bytesToB64url(all), serverEncode(all));
  assert.deepEqual(b64urlToBytes(bytesToB64url(all)), all);
  assert.deepEqual(b64urlToBytes(bytesToB64url(buffer(250, 251, 252)).replace(/=+$/, '')), bytes(250, 251, 252));
});

test('creation options from the server become bytes the browser accepts, leaving everything else alone', () => {
  const out = creationOptionsFromServer({
    challenge: bytesToB64url(bytes(1, 2, 3)),
    rp: { id: 'app.example.com', name: 'IcanEra' },
    user: { id: bytesToB64url(bytes(9, 9)), name: 'a@b.c', displayName: 'A' },
    excludeCredentials: [{ type: 'public-key', id: bytesToB64url(bytes(7, 7, 7)), transports: ['internal'] }],
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
  });
  assert.deepEqual(out.challenge, bytes(1, 2, 3));
  assert.deepEqual(out.user.id, bytes(9, 9));
  assert.equal(out.user.name, 'a@b.c');
  assert.deepEqual(out.excludeCredentials[0].id, bytes(7, 7, 7));
  assert.deepEqual(out.excludeCredentials[0].transports, ['internal']);
  assert.equal(out.authenticatorSelection.userVerification, 'required');
  assert.deepEqual(creationOptionsFromServer({ challenge: 'AQ', user: { id: 'AQ' } }).excludeCredentials, []);
});

test('sign-in options keep allowCredentials empty so the device offers its own accounts', () => {
  const out = requestOptionsFromServer({ challenge: bytesToB64url(bytes(4, 5)), rpId: 'app.example.com', userVerification: 'required', allowCredentials: [] });
  assert.deepEqual(out.challenge, bytes(4, 5));
  assert.deepEqual(out.allowCredentials, []);
  assert.equal(out.rpId, 'app.example.com');
  assert.deepEqual(requestOptionsFromServer({ challenge: 'AQ' }).allowCredentials, []);
});

test('a new credential is turned into exactly what the server verifies', () => {
  const credential = {
    rawId: buffer(1, 2, 3),
    response: {
      clientDataJSON: buffer(10),
      getAuthenticatorData: () => buffer(20, 21),
      getPublicKey: () => buffer(30, 31, 32),
      getPublicKeyAlgorithm: () => -7,
      getTransports: () => ['internal', 'hybrid'],
    },
  };
  assert.deepEqual(registrationPayload(credential), {
    credentialId: bytesToB64url(bytes(1, 2, 3)),
    clientDataJSON: bytesToB64url(bytes(10)),
    authenticatorData: bytesToB64url(bytes(20, 21)),
    publicKey: bytesToB64url(bytes(30, 31, 32)),
    publicKeyAlgorithm: -7,
    transports: ['internal', 'hybrid'],
  });
});

test('a browser without getPublicKey() is told to update, not left with a mystery', () => {
  const old = { rawId: buffer(1), response: { clientDataJSON: buffer(1) } };
  assert.throws(() => registrationPayload(old), (error) => error instanceof PasskeyError && error.code === 'browser_too_old');
  const noKey = { rawId: buffer(1), response: { clientDataJSON: buffer(1), getAuthenticatorData: () => buffer(1), getPublicKeyAlgorithm: () => -7, getPublicKey: () => null } };
  assert.throws(() => registrationPayload(noKey), PasskeyError);
});

test('a sign-in answer carries the signature and who the device says it signed for', () => {
  const credential = {
    rawId: buffer(1, 2),
    response: { clientDataJSON: buffer(3), authenticatorData: buffer(4, 5), signature: buffer(6, 7, 8), userHandle: buffer(9) },
  };
  assert.deepEqual(assertionPayload(credential), {
    credentialId: bytesToB64url(bytes(1, 2)),
    clientDataJSON: bytesToB64url(bytes(3)),
    authenticatorData: bytesToB64url(bytes(4, 5)),
    signature: bytesToB64url(bytes(6, 7, 8)),
    userHandle: bytesToB64url(bytes(9)),
  });
  credential.response.userHandle = null;
  assert.equal(assertionPayload(credential).userHandle, '');
});

test('browser error names become plain sentences', () => {
  const named = (name) => Object.assign(new Error('raw browser text'), { name });
  assert.match(describeWebAuthnError(named('NotAllowedError')), /cancelled|took too long/);
  assert.match(describeWebAuthnError(named('InvalidStateError'), 'create'), /already set up/);
  assert.doesNotMatch(describeWebAuthnError(named('InvalidStateError'), 'get'), /already set up/);
  assert.match(describeWebAuthnError(named('ConstraintError')), /screen lock/);
  assert.match(describeWebAuthnError(named('SecurityError')), /https/);
  assert.equal(describeWebAuthnError(new PasskeyError('ours')), 'ours');
  assert.equal(describeWebAuthnError(new Error('something odd')), 'something odd');
  assert.match(describeWebAuthnError({}), /did not work/);
});

test('the device is named the way its owner knows the feature', () => {
  assert.equal(biometricName('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit Safari/604.1'), 'Face ID or Touch ID');
  assert.equal(biometricName('Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/120 Mobile Safari/537.36'), 'fingerprint or face unlock');
  assert.equal(biometricName('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120 Safari/537.36'), 'Windows Hello');
  assert.equal(biometricName('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15'), 'Touch ID');
  assert.equal(biometricName('curl/8'), 'fingerprint or face');
  assert.equal(deviceLabel('Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/120 Mobile Safari/537.36'), 'Chrome on Android');
  assert.equal(deviceLabel(''), 'This device');
});
