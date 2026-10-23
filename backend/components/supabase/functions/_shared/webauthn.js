// Fingerprint / face sign-in (WebAuthn passkeys) for the passkey-auth Edge Function.
//
// The phone, laptop or tablet does the biometric check itself (fingerprint, Face ID, Android face unlock, Windows Hello)
// and signs a one-time challenge with a private key that never leaves the device's secure hardware. The server only ever
// holds the matching PUBLIC key, so there is no face image, fingerprint, template or third-party service anywhere.
//
// This file is the whole verifier - WebCrypto only, no dependencies - so there is nothing to trust but the platform:
//   registration  checkClientData + verifyRegistration   (is this a fresh, user-verified credential for THIS site?)
//   sign-in       verifyAssertion                         (did the stored key sign THIS challenge, user-verified?)
//
// Plain JavaScript (JSDoc types) on purpose: Deno imports it as it is, and Node unit-tests this very file
// (frontend/tests/webauthn.test.js).

/** COSE algorithms the app asks the device for: ES256 (every phone, Mac, Windows Hello) and RS256 (some Windows Hello TPMs). */
export const SUPPORTED_ALGS = [-7, -257];

export class WebAuthnError extends Error {
  constructor(message) {
    super(message);
    this.name = 'WebAuthnError';
  }
}

const textDecoder = new TextDecoder();
const subtle = () => globalThis.crypto.subtle;

// ------------------------------------------------------------------ bytes

/** @param {Uint8Array|ArrayBuffer} bytes @returns {string} base64url, no padding */
export function b64urlEncode(bytes) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (let i = 0; i < view.length; i += 1) binary += String.fromCharCode(view[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** @param {string} text base64url (padding optional) @returns {Uint8Array} */
export function b64urlDecode(text) {
  const value = String(text || '');
  if (!/^[A-Za-z0-9_-]*$/.test(value)) throw new WebAuthnError('Malformed data from the device.');
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

export function bytesEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
};

/** @returns {Promise<Uint8Array>} */
export async function sha256(data) {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  return new Uint8Array(await subtle().digest('SHA-256', bytes));
}

/** A fresh one-time challenge, base64url. */
export function newChallenge(size = 32) {
  return b64urlEncode(globalThis.crypto.getRandomValues(new Uint8Array(size)));
}

// -------------------------------------------------------- origin / site

/**
 * The origin a request came from, if this site may use passkeys: https anywhere, plain http only on localhost.
 * `allowed` (the PASSKEY_ALLOWED_ORIGINS setting, comma separated) narrows it further when set.
 * @param {string|null|undefined} originHeader
 * @param {string[]} [allowed]
 * @returns {{origin: string, rpId: string}}
 */
export function resolveOrigin(originHeader, allowed = []) {
  let url;
  try { url = new URL(String(originHeader || '')); } catch { throw new WebAuthnError('This request did not come from a web page.'); }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    throw new WebAuthnError('Fingerprint and face sign-in needs a secure (https) connection.');
  }
  if (allowed.length && !allowed.includes(url.origin)) throw new WebAuthnError('Fingerprint and face sign-in is not available on this address.');
  return { origin: url.origin, rpId: url.hostname };
}

// --------------------------------------------------- authenticator data

/**
 * @param {Uint8Array} authData
 * @returns {{rpIdHash: Uint8Array, userPresent: boolean, userVerified: boolean, backedUp: boolean, attested: boolean, signCount: number}}
 */
export function parseAuthenticatorData(authData) {
  if (!(authData instanceof Uint8Array) || authData.length < 37) throw new WebAuthnError('The device sent unreadable data.');
  const flags = authData[32];
  const view = new DataView(authData.buffer, authData.byteOffset, authData.byteLength);
  return {
    rpIdHash: authData.slice(0, 32),
    userPresent: (flags & 0x01) !== 0,
    userVerified: (flags & 0x04) !== 0,
    backedUp: (flags & 0x10) !== 0,
    attested: (flags & 0x40) !== 0,
    signCount: view.getUint32(33, false),
  };
}

/** The credential id inside registration authenticator data (attested credential data follows the 37-byte header). */
export function credentialIdFromAuthData(authData) {
  const parsed = parseAuthenticatorData(authData);
  if (!parsed.attested || authData.length < 55) throw new WebAuthnError('The device did not return a new credential.');
  const length = (authData[53] << 8) | authData[54];
  if (length < 16 || authData.length < 55 + length) throw new WebAuthnError('The device sent an unreadable credential.');
  return authData.slice(55, 55 + length);
}

/**
 * What the browser reports it just did: right kind of ceremony, for the challenge we issued, from the page we expect.
 * @param {Uint8Array} clientDataJSON
 * @param {{type: 'webauthn.create'|'webauthn.get', challenge: string, origin: string}} expected
 */
export function checkClientData(clientDataJSON, expected) {
  let data;
  try { data = JSON.parse(textDecoder.decode(clientDataJSON)); } catch { throw new WebAuthnError('The device sent unreadable data.'); }
  if (!data || data.type !== expected.type) throw new WebAuthnError('That was not the right kind of request.');
  if (typeof data.challenge !== 'string' || data.challenge !== expected.challenge) throw new WebAuthnError('That request is out of date. Please try again.');
  if (data.origin !== expected.origin) throw new WebAuthnError('That request came from a different site.');
  if (data.crossOrigin === true) throw new WebAuthnError('That request came from a different site.');
  return data;
}

/** Both flags: the device was in the person's hands (present) and checked who they are (fingerprint, face or device PIN). */
function requirePresenceAndVerification(parsed) {
  if (!parsed.userPresent) throw new WebAuthnError('The device did not confirm you were there.');
  if (!parsed.userVerified) throw new WebAuthnError('Your fingerprint, face or device PIN was not checked. Turn on screen lock and try again.');
}

// ------------------------------------------------------------- crypto

/**
 * An ECDSA signature as WebAuthn sends it (ASN.1 DER: SEQUENCE { INTEGER r, INTEGER s }) in the raw r||s form WebCrypto verifies.
 * @param {Uint8Array} der
 * @param {number} [size] bytes per integer (32 for P-256)
 */
export function derToRawEcdsa(der, size = 32) {
  const bad = () => new WebAuthnError('The device sent an unreadable signature.');
  let o = 0;
  if (der[o++] !== 0x30) throw bad();
  let sequenceLength = der[o++];
  if (sequenceLength & 0x80) {
    const lengthBytes = sequenceLength & 0x7f;
    if (lengthBytes < 1 || lengthBytes > 2) throw bad();
    sequenceLength = 0;
    for (let i = 0; i < lengthBytes; i += 1) sequenceLength = (sequenceLength << 8) | der[o++];
  }
  if (o + sequenceLength !== der.length) throw bad();

  const readInteger = () => {
    if (der[o++] !== 0x02) throw bad();
    const length = der[o++];
    if (!length || o + length > der.length) throw bad();
    let value = der.slice(o, o + length);
    o += length;
    while (value.length > 1 && value[0] === 0) value = value.slice(1); // the sign byte DER adds
    if (value.length > size) throw bad();
    const padded = new Uint8Array(size);
    padded.set(value, size - value.length);
    return padded;
  };

  const r = readInteger();
  const s = readInteger();
  if (o !== der.length) throw bad();
  return concat(r, s);
}

/** @param {Uint8Array} spki the public key in SubjectPublicKeyInfo form (what getPublicKey() returns) */
export async function importPublicKey(spki, alg) {
  try {
    if (alg === -7) return await subtle().importKey('spki', spki, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    if (alg === -257) return await subtle().importKey('spki', spki, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  } catch {
    throw new WebAuthnError('The device sent a public key that could not be read.');
  }
  throw new WebAuthnError('This device uses a sign-in method the app does not support yet.');
}

async function signatureIsValid({ publicKey, alg, authenticatorData, clientDataJSON, signature }) {
  const key = await importPublicKey(publicKey, alg);
  const signedData = concat(authenticatorData, await sha256(clientDataJSON));
  try {
    if (alg === -7) return await subtle().verify({ name: 'ECDSA', hash: 'SHA-256' }, key, derToRawEcdsa(signature), signedData);
    return await subtle().verify('RSASSA-PKCS1-v1_5', key, signature, signedData);
  } catch (error) {
    if (error instanceof WebAuthnError) throw error;
    return false;
  }
}

// ----------------------------------------------------------- the ceremonies

/**
 * Registration: a brand-new credential made on this site, with the person's biometric / PIN check.
 *
 * Attestation is "none" (we do not care WHICH device or maker - the account is already signed in), so the public key is taken
 * as the browser hands it over (SPKI) and checked to be a key of a supported type. A wrong key can only ever break the
 * registering person's own sign-in; it cannot reach anyone else's account.
 *
 * @param {{
 *   clientDataJSON: Uint8Array, authenticatorData: Uint8Array, credentialId: Uint8Array,
 *   publicKey: Uint8Array, alg: number,
 *   expected: {challenge: string, origin: string, rpId: string}
 * }} p
 * @returns {Promise<{backedUp: boolean, signCount: number}>}
 */
export async function verifyRegistration({ clientDataJSON, authenticatorData, credentialId, publicKey, alg, expected }) {
  checkClientData(clientDataJSON, { type: 'webauthn.create', challenge: expected.challenge, origin: expected.origin });
  const parsed = parseAuthenticatorData(authenticatorData);
  if (!bytesEqual(parsed.rpIdHash, await sha256(expected.rpId))) throw new WebAuthnError('That credential belongs to a different site.');
  requirePresenceAndVerification(parsed);
  if (!bytesEqual(credentialIdFromAuthData(authenticatorData), credentialId)) throw new WebAuthnError('The device sent mismatched credential details.');
  if (!SUPPORTED_ALGS.includes(alg)) throw new WebAuthnError('This device uses a sign-in method the app does not support yet.');
  await importPublicKey(publicKey, alg);
  return { backedUp: parsed.backedUp, signCount: parsed.signCount };
}

/**
 * Sign-in: the stored public key must have signed the challenge we issued, for this site, with the person verified.
 *
 * @param {{
 *   clientDataJSON: Uint8Array, authenticatorData: Uint8Array, signature: Uint8Array,
 *   credential: {publicKey: Uint8Array, alg: number, rpId: string, signCount: number},
 *   expected: {challenge: string, origin: string}
 * }} p
 * @returns {Promise<{signCount: number, backedUp: boolean}>} the counter and backup state to store
 */
export async function verifyAssertion({ clientDataJSON, authenticatorData, signature, credential, expected }) {
  checkClientData(clientDataJSON, { type: 'webauthn.get', challenge: expected.challenge, origin: expected.origin });
  const parsed = parseAuthenticatorData(authenticatorData);
  if (!bytesEqual(parsed.rpIdHash, await sha256(credential.rpId))) throw new WebAuthnError('That credential belongs to a different site.');
  requirePresenceAndVerification(parsed);

  const valid = await signatureIsValid({
    publicKey: credential.publicKey, alg: credential.alg, authenticatorData, clientDataJSON, signature,
  });
  if (!valid) throw new WebAuthnError('That fingerprint or face could not be verified.');

  // A counter that goes backwards (or stands still after having moved) means the credential was copied. Devices whose counter
  // is always 0 - synced passkeys on Apple and Google - are fine: both sides stay 0.
  if ((parsed.signCount !== 0 || credential.signCount !== 0) && parsed.signCount <= credential.signCount) {
    throw new WebAuthnError('This credential looks copied, so it was refused. Sign in another way and set it up again.');
  }
  return { signCount: parsed.signCount, backedUp: parsed.backedUp };
}
