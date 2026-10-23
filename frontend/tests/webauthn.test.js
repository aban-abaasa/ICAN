import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WebAuthnError, b64urlDecode, b64urlEncode, checkClientData, credentialIdFromAuthData, derToRawEcdsa, newChallenge,
  parseAuthenticatorData, resolveOrigin, sha256, verifyAssertion, verifyRegistration,
} from '../../backend/components/supabase/functions/_shared/webauthn.js';

// A software stand-in for the phone's secure hardware: it makes a key pair and signs exactly the way an authenticator does.
const ORIGIN = 'https://app.example.com';
const RP_ID = 'app.example.com';
const enc = new TextEncoder();
const FLAG_UP = 0x01;
const FLAG_UV = 0x04;
const FLAG_AT = 0x40;

const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

const rawToDer = (raw) => {
  const half = raw.length / 2;
  const integer = (bytes) => {
    let v = bytes;
    while (v.length > 1 && v[0] === 0) v = v.slice(1);
    if (v[0] & 0x80) v = concat(new Uint8Array([0]), v);
    return concat(new Uint8Array([0x02, v.length]), v);
  };
  const body = concat(integer(raw.slice(0, half)), integer(raw.slice(half)));
  return concat(new Uint8Array([0x30, body.length]), body);
};

async function makeAuthenticator(alg = -7) {
  const params = alg === -7
    ? { name: 'ECDSA', namedCurve: 'P-256' }
    : { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' };
  const { publicKey, privateKey } = await crypto.subtle.generateKey(params, true, ['sign', 'verify']);
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', publicKey));
  const credentialId = crypto.getRandomValues(new Uint8Array(32));

  const authData = async ({ flags, signCount, rpId = RP_ID, withCredential = false }) => {
    const counter = new Uint8Array(4);
    new DataView(counter.buffer).setUint32(0, signCount, false);
    const head = concat(await sha256(rpId), new Uint8Array([flags]), counter);
    if (!withCredential) return head;
    const idLength = new Uint8Array([credentialId.length >> 8, credentialId.length & 0xff]);
    return concat(head, new Uint8Array(16), idLength, credentialId, new Uint8Array([0xa5])); // + a stand-in for the COSE key
  };

  const clientData = (type, challenge, origin = ORIGIN, extra = {}) =>
    enc.encode(JSON.stringify({ type, challenge, origin, crossOrigin: false, ...extra }));

  const sign = async (authenticatorData, clientDataJSON) => {
    const data = concat(authenticatorData, await sha256(clientDataJSON));
    if (alg === -7) {
      const raw = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, data));
      return rawToDer(raw); // WebAuthn sends DER; WebCrypto produces r||s
    }
    return new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, data));
  };

  return { alg, spki, credentialId, authData, clientData, sign };
}

const registrationFor = async (device, overrides = {}) => {
  const challenge = newChallenge();
  const authenticatorData = await device.authData({ flags: FLAG_UP | FLAG_UV | FLAG_AT, signCount: 0, withCredential: true, ...overrides.auth });
  return {
    challenge,
    args: {
      clientDataJSON: device.clientData('webauthn.create', challenge, ...(overrides.clientDataArgs || [])),
      authenticatorData,
      credentialId: device.credentialId,
      publicKey: device.spki,
      alg: device.alg,
      expected: { challenge, origin: ORIGIN, rpId: RP_ID },
      ...overrides.args,
    },
  };
};

const assertionFor = async (device, { signCount = 1, flags = FLAG_UP | FLAG_UV, stored = 0, rpId = RP_ID, clientArgs = [], challenge = newChallenge() } = {}) => {
  const authenticatorData = await device.authData({ flags, signCount, rpId });
  const clientDataJSON = device.clientData('webauthn.get', challenge, ...clientArgs);
  return {
    clientDataJSON,
    authenticatorData,
    signature: await device.sign(authenticatorData, clientDataJSON),
    credential: { publicKey: device.spki, alg: device.alg, rpId: RP_ID, signCount: stored },
    expected: { challenge, origin: ORIGIN },
  };
};

const rejects = (promise, pattern) => assert.rejects(promise, (error) => {
  assert.ok(error instanceof WebAuthnError, `expected a WebAuthnError, got ${error}`);
  if (pattern) assert.match(error.message, pattern);
  return true;
});

// ---------------------------------------------------------------- helpers

test('base64url round-trips every byte value and refuses anything that is not base64url', () => {
  const all = Uint8Array.from({ length: 256 }, (_, i) => i);
  assert.deepEqual(b64urlDecode(b64urlEncode(all)), all);
  assert.doesNotMatch(b64urlEncode(all), /[+/=]/);
  assert.throws(() => b64urlDecode('not valid!'), WebAuthnError);
});

test('challenges are random, 32 bytes, and never repeat', () => {
  const a = newChallenge();
  assert.equal(b64urlDecode(a).length, 32);
  assert.notEqual(a, newChallenge());
});

test('only https sites (and localhost for development) may use fingerprint / face sign-in', () => {
  assert.deepEqual(resolveOrigin('https://app.example.com'), { origin: 'https://app.example.com', rpId: 'app.example.com' });
  assert.deepEqual(resolveOrigin('http://localhost:5173'), { origin: 'http://localhost:5173', rpId: 'localhost' });
  assert.throws(() => resolveOrigin('http://app.example.com'), /secure/);
  assert.throws(() => resolveOrigin(null), WebAuthnError);
  assert.throws(() => resolveOrigin('not a url'), WebAuthnError);
});

test('an allow-list narrows the sites that may use it', () => {
  const allowed = ['https://app.example.com'];
  assert.equal(resolveOrigin('https://app.example.com', allowed).rpId, 'app.example.com');
  assert.throws(() => resolveOrigin('https://evil.example.net', allowed), /not available on this address/);
});

test('ECDSA signatures in DER form convert to the r||s form WebCrypto verifies, including short and sign-padded integers', () => {
  const raw = new Uint8Array(64);
  raw[0] = 0x80; // high bit set -> DER adds a 0x00 sign byte
  raw[31] = 0x01;
  raw[32] = 0x00; // leading zero bytes in s are stripped by DER and must be put back
  raw[33] = 0x00;
  raw[63] = 0x7f;
  assert.deepEqual(derToRawEcdsa(rawToDer(raw)), raw);
  assert.throws(() => derToRawEcdsa(new Uint8Array([0x31, 0x00])), WebAuthnError);
  assert.throws(() => derToRawEcdsa(rawToDer(raw).slice(0, 20)), WebAuthnError);
});

test('authenticator data: flags and the counter are read from the right bytes', async () => {
  const device = await makeAuthenticator();
  const parsed = parseAuthenticatorData(await device.authData({ flags: FLAG_UP | FLAG_UV | 0x10, signCount: 0x01020304 }));
  assert.equal(parsed.userPresent, true);
  assert.equal(parsed.userVerified, true);
  assert.equal(parsed.backedUp, true);
  assert.equal(parsed.attested, false);
  assert.equal(parsed.signCount, 0x01020304);
  assert.throws(() => parseAuthenticatorData(new Uint8Array(10)), WebAuthnError);
});

test('the credential id is read out of the registration data', async () => {
  const device = await makeAuthenticator();
  const data = await device.authData({ flags: FLAG_UP | FLAG_UV | FLAG_AT, signCount: 0, withCredential: true });
  assert.deepEqual(credentialIdFromAuthData(data), device.credentialId);
  assert.throws(() => credentialIdFromAuthData(new Uint8Array(37)), WebAuthnError); // a header with no attested credential data
});

test('client data must be the right ceremony, challenge and site', () => {
  const ok = enc.encode(JSON.stringify({ type: 'webauthn.get', challenge: 'abc', origin: ORIGIN }));
  assert.doesNotThrow(() => checkClientData(ok, { type: 'webauthn.get', challenge: 'abc', origin: ORIGIN }));
  assert.throws(() => checkClientData(ok, { type: 'webauthn.create', challenge: 'abc', origin: ORIGIN }), WebAuthnError);
  assert.throws(() => checkClientData(ok, { type: 'webauthn.get', challenge: 'xyz', origin: ORIGIN }), WebAuthnError);
  assert.throws(() => checkClientData(ok, { type: 'webauthn.get', challenge: 'abc', origin: 'https://evil.example.net' }), WebAuthnError);
  assert.throws(() => checkClientData(enc.encode('{nope'), { type: 'webauthn.get', challenge: 'abc', origin: ORIGIN }), WebAuthnError);
  const framed = enc.encode(JSON.stringify({ type: 'webauthn.get', challenge: 'abc', origin: ORIGIN, crossOrigin: true }));
  assert.throws(() => checkClientData(framed, { type: 'webauthn.get', challenge: 'abc', origin: ORIGIN }), WebAuthnError);
});

// ------------------------------------------------------------ registration

for (const alg of [-7, -257]) {
  test(`registration accepts a fresh, user-verified credential (alg ${alg})`, async () => {
    const device = await makeAuthenticator(alg);
    const { args } = await registrationFor(device);
    const result = await verifyRegistration(args);
    assert.deepEqual(result, { backedUp: false, signCount: 0 });
  });
}

test('registration refuses a credential whose person was never verified', async () => {
  const device = await makeAuthenticator();
  const { args } = await registrationFor(device, { auth: { flags: FLAG_UP | FLAG_AT } });
  await rejects(verifyRegistration(args), /not checked/);
});

test('registration refuses a credential made for another site, another challenge, or another credential id', async () => {
  const device = await makeAuthenticator();
  await rejects(verifyRegistration((await registrationFor(device, { auth: { rpId: 'evil.example.net' } })).args), /different site/);
  await rejects(verifyRegistration((await registrationFor(device, { args: { expected: { challenge: newChallenge(), origin: ORIGIN, rpId: RP_ID } } })).args), /out of date/);
  await rejects(verifyRegistration((await registrationFor(device, { args: { credentialId: crypto.getRandomValues(new Uint8Array(32)) } })).args), /mismatched/);
});

test('registration refuses a public key it cannot read, or an unsupported algorithm', async () => {
  const device = await makeAuthenticator();
  await rejects(verifyRegistration((await registrationFor(device, { args: { publicKey: new Uint8Array(40) } })).args), /could not be read/);
  await rejects(verifyRegistration((await registrationFor(device, { args: { alg: -8 } })).args), /not support/);
});

// ----------------------------------------------------------------- sign-in

for (const alg of [-7, -257]) {
  test(`sign-in accepts the stored key's signature over the issued challenge (alg ${alg})`, async () => {
    const device = await makeAuthenticator(alg);
    const result = await verifyAssertion(await assertionFor(device, { signCount: 5, stored: 4 }));
    assert.deepEqual(result, { signCount: 5, backedUp: false });
  });
}

test('devices that always report a counter of 0 (synced passkeys) still sign in, every time', async () => {
  const device = await makeAuthenticator();
  await verifyAssertion(await assertionFor(device, { signCount: 0, stored: 0 }));
  await verifyAssertion(await assertionFor(device, { signCount: 0, stored: 0 }));
});

test('a counter that does not move forward means a copied credential and is refused', async () => {
  const device = await makeAuthenticator();
  await rejects(verifyAssertion(await assertionFor(device, { signCount: 7, stored: 7 })), /copied/);
  await rejects(verifyAssertion(await assertionFor(device, { signCount: 3, stored: 7 })), /copied/);
  await rejects(verifyAssertion(await assertionFor(device, { signCount: 0, stored: 7 })), /copied/);
});

test('sign-in refuses a signature made by a different key', async () => {
  const device = await makeAuthenticator();
  const stranger = await makeAuthenticator();
  const attempt = await assertionFor(stranger);
  attempt.credential.publicKey = device.spki; // the account's key, signed by someone else's
  await rejects(verifyAssertion(attempt), /could not be verified/);
});

test('sign-in refuses a tampered challenge answer or tampered authenticator data', async () => {
  const device = await makeAuthenticator();
  const tamperedClient = await assertionFor(device);
  tamperedClient.clientDataJSON = device.clientData('webauthn.get', tamperedClient.expected.challenge, ORIGIN, { extra: 'changed after signing' });
  await rejects(verifyAssertion(tamperedClient), /could not be verified/);

  const tamperedAuth = await assertionFor(device);
  tamperedAuth.authenticatorData = tamperedAuth.authenticatorData.slice();
  tamperedAuth.authenticatorData[36] ^= 0xff; // counter byte
  await rejects(verifyAssertion(tamperedAuth), /could not be verified/);
});

test('sign-in refuses an old challenge, a different site, and a phishing page', async () => {
  const device = await makeAuthenticator();
  const stale = await assertionFor(device);
  stale.expected.challenge = newChallenge();
  await rejects(verifyAssertion(stale), /out of date/);

  await rejects(verifyAssertion(await assertionFor(device, { clientArgs: ['https://evil.example.net'] })), /different site/);
  await rejects(verifyAssertion(await assertionFor(device, { rpId: 'evil.example.net' })), /different site/);
});

test('sign-in refuses an assertion where the person was not verified, however valid the signature', async () => {
  const device = await makeAuthenticator();
  await rejects(verifyAssertion(await assertionFor(device, { flags: FLAG_UP })), /not checked/);
  await rejects(verifyAssertion(await assertionFor(device, { flags: FLAG_UV })), /not confirm/);
});

test('a garbage signature is refused, not crashed on', async () => {
  const device = await makeAuthenticator();
  const attempt = await assertionFor(device);
  attempt.signature = new Uint8Array([1, 2, 3]);
  await rejects(verifyAssertion(attempt), /signature/);
});
