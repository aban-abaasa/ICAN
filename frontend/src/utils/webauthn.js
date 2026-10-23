// Browser side of fingerprint / face sign-in (WebAuthn passkeys).
//
// The page never sees a fingerprint or a face: it asks the device to check the person, and the device answers with a
// signature. These are the pure helpers (no network, no page state), tested in tests/webauthnBrowser.test.js; the calls
// that touch the page and the server live in services/passkeyService.js.

import { describeUserAgent } from './securityHelpers.js';

export class PasskeyError extends Error {
  constructor(message, code = '') {
    super(message);
    this.name = 'PasskeyError';
    this.code = code;
  }
}

// ------------------------------------------------------------------ bytes

export function bytesToB64url(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlToBytes(text) {
  const base64 = String(text || '').replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ------------------------------------------------------------ what this device can do

/** The browser can do passkeys at all (it also needs https, which every real deployment has; localhost counts). */
export function isPasskeySupported() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  return Boolean(
    window.isSecureContext
    && typeof window.PublicKeyCredential === 'function'
    && navigator.credentials?.create
    && navigator.credentials?.get,
  );
}

/** This device has a fingerprint / face / PIN check it can use to make a passkey. */
export async function platformAuthenticatorAvailable() {
  try {
    return Boolean(await window.PublicKeyCredential?.isUserVerifyingPlatformAuthenticatorAvailable?.());
  } catch {
    return false;
  }
}

/** What the device calls its biometric, for the sentence "Use {name} to sign in". Only a hint: the device decides how to check. */
export function biometricName(userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : '') {
  const ua = String(userAgent || '');
  if (/iPhone|iPad|iPod/.test(ua)) return 'Face ID or Touch ID';
  if (/Android/.test(ua)) return 'fingerprint or face unlock';
  if (/Windows/.test(ua)) return 'Windows Hello';
  if (/Mac OS X|Macintosh/.test(ua)) return 'Touch ID';
  return 'fingerprint or face';
}

/** A name for this device in the list of devices that can sign in, e.g. "Chrome on Android". */
export function deviceLabel(userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : '') {
  const { label } = describeUserAgent(userAgent);
  return label === 'Unknown device' ? 'This device' : label;
}

// ------------------------------------------------- server <-> navigator.credentials

/** The server sends ids and challenges as base64url text; the browser API wants bytes. */
export function creationOptionsFromServer(options) {
  return {
    ...options,
    challenge: b64urlToBytes(options.challenge),
    user: { ...options.user, id: b64urlToBytes(options.user.id) },
    excludeCredentials: (options.excludeCredentials || []).map((c) => ({ ...c, id: b64urlToBytes(c.id) })),
  };
}

export function requestOptionsFromServer(options) {
  return {
    ...options,
    challenge: b64urlToBytes(options.challenge),
    allowCredentials: (options.allowCredentials || []).map((c) => ({ ...c, id: b64urlToBytes(c.id) })),
  };
}

/**
 * What the server needs to store a new passkey. The public key and authenticator data are read straight from the browser
 * (WebAuthn level 3: Chrome/Edge 85+, Safari 16.4+, Firefox 119+), which spares the server a CBOR parser.
 */
export function registrationPayload(credential) {
  const response = credential?.response;
  if (!response
    || typeof response.getPublicKey !== 'function'
    || typeof response.getAuthenticatorData !== 'function'
    || typeof response.getPublicKeyAlgorithm !== 'function') {
    throw new PasskeyError('This browser is too old for fingerprint and face sign-in. Update it and try again.', 'browser_too_old');
  }
  const publicKey = response.getPublicKey();
  if (!publicKey) throw new PasskeyError('This device did not return a usable key. Try again.', 'no_public_key');
  return {
    credentialId: bytesToB64url(credential.rawId),
    clientDataJSON: bytesToB64url(response.clientDataJSON),
    authenticatorData: bytesToB64url(response.getAuthenticatorData()),
    publicKey: bytesToB64url(publicKey),
    publicKeyAlgorithm: response.getPublicKeyAlgorithm(),
    transports: typeof response.getTransports === 'function' ? response.getTransports() : [],
  };
}

export function assertionPayload(credential) {
  const response = credential.response;
  return {
    credentialId: bytesToB64url(credential.rawId),
    clientDataJSON: bytesToB64url(response.clientDataJSON),
    authenticatorData: bytesToB64url(response.authenticatorData),
    signature: bytesToB64url(response.signature),
    userHandle: response.userHandle ? bytesToB64url(response.userHandle) : '',
  };
}

// ----------------------------------------------------- a failed call to the server

export const BACKEND_MISSING_MESSAGE = 'Fingerprint and face sign-in is not switched on for this server yet. An administrator needs to apply the migration and deploy the passkey-auth function.';

/**
 * What a failed call to the passkey-auth function means, in words a person can act on.
 *
 * A function that is not deployed answers 404 WITHOUT the CORS headers a browser insists on, so the page is told the request
 * failed outright (no response at all) - the same thing a dead connection looks like. The one difference is that the device
 * still says it is online, so that case names both causes instead of blaming the connection alone.
 *
 * @param {{detail?: {error?: string, code?: string}|null, status?: number, hasResponse?: boolean, online?: boolean}} failure
 * @returns {{message: string, code: string}}
 */
export function explainFunctionFailure({ detail = null, status = 0, hasResponse = false, online = true } = {}) {
  if (detail?.code === 'not_installed' || (!detail?.error && status === 404)) return { message: BACKEND_MISSING_MESSAGE, code: 'not_installed' };
  if (detail?.error) return { message: String(detail.error), code: detail.code || '' };
  if (hasResponse) return { message: 'The server had a problem. Try again in a moment.', code: 'server_error' };
  if (!online) return { message: 'You are offline. Fingerprint and face sign-in needs a connection.', code: 'offline' };
  return {
    message: 'Could not reach fingerprint and face sign-in. If your connection is fine, it is probably not switched on for this server yet: an administrator needs to deploy the passkey-auth function.',
    code: 'unreachable',
  };
}

// ----------------------------------------------------------------- errors

/**
 * The browser's DOMException names are for developers; people get a sentence that says what to do.
 * @param {unknown} error
 * @param {'create'|'get'} ceremony
 */
export function describeWebAuthnError(error, ceremony = 'get') {
  if (error instanceof PasskeyError) return error.message;
  switch (error?.name) {
    case 'NotAllowedError':
      return 'That was cancelled, or it took too long. Try again when you are ready.';
    case 'AbortError':
      return 'That was cancelled.';
    case 'InvalidStateError':
      return ceremony === 'create'
        ? 'This device is already set up for your account.'
        : 'That did not work. Try again.';
    case 'ConstraintError':
      return 'This device has no fingerprint, face or screen lock turned on. Turn one on in your device settings, then try again.';
    case 'NotSupportedError':
      return 'This device or browser cannot use fingerprint or face sign-in.';
    case 'SecurityError':
      return 'Fingerprint and face sign-in only works on the real, secure (https) address of the app.';
    default:
      return error?.message || 'Fingerprint or face sign-in did not work. Try again.';
  }
}
