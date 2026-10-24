// Fingerprint / face sign-in. The device checks the person and signs a one-time challenge; the passkey-auth Edge Function
// (backend/components/supabase/functions/passkey-auth) verifies the signature against the public key it stored, then hands
// back a token this app redeems into a normal Supabase session - the same route wallet sign-in takes.
//
//   enablePasskey      make a passkey on THIS device (signed in; asks the device for its fingerprint / face)
//   requestPasskeyLogin  sign in with nothing typed: the device offers its account, the person proves it is them
//   listPasskeys / removePasskey / removeAllPasskeys   the account's devices, straight from public.user_passkeys (RLS: own rows)
//
// Supabase tables and the Edge Function come from supabase/migrations/20261115100000_biometric_signin.sql (see BIOMETRIC_SIGNIN_DEPLOY.md).

import { getSupabaseClient } from '../lib/supabase/client';
import {
  BACKEND_MISSING_MESSAGE, PasskeyError, assertionPayload, bytesToB64url, creationOptionsFromServer, describeWebAuthnError,
  deviceLabel, explainFunctionFailure, isPasskeySupported, registrationPayload, requestOptionsFromServer,
} from '../utils/webauthn';

const FUNCTION_NAME = 'passkey-auth';
const THIS_DEVICE_KEY = 'ican_passkey_credential_id';

export class PasskeyBackendMissingError extends PasskeyError {
  constructor() {
    super(BACKEND_MISSING_MESSAGE, 'not_installed');
    this.name = 'PasskeyBackendMissingError';
  }
}
export const isPasskeyBackendMissing = (error) => error instanceof PasskeyBackendMissingError;

const client = () => {
  const sb = getSupabaseClient();
  if (!sb) throw new PasskeyError('The app is not connected to its database. Check your connection and try again.');
  return sb;
};

// ------------------------------------------------- "this device has one" memory

const readStorage = () => {
  try { return window.localStorage.getItem(THIS_DEVICE_KEY) || ''; } catch { return ''; }
};
const writeStorage = (value) => {
  try {
    if (value) window.localStorage.setItem(THIS_DEVICE_KEY, value);
    else window.localStorage.removeItem(THIS_DEVICE_KEY);
  } catch { /* storage unavailable: the sign-in button just stays in its plain place */ }
};

/** The credential id this browser last used or made, so the sign-in screen can put the fingerprint / face button first. */
export const thisDeviceCredentialId = () => readStorage();
export const isThisDeviceEnrolled = () => Boolean(readStorage());

// ----------------------------------------------------------------- the function

const callFunction = async (action, body = {}) => {
  const { data, error } = await client().functions.invoke(FUNCTION_NAME, { body: { action, ...body } });
  if (error) {
    let detail = null;
    try { detail = await error.context?.clone?.().json?.(); } catch { /* not JSON: a gateway page, or nothing at all */ }
    const { message, code } = explainFunctionFailure({
      detail,
      status: error.context?.status || 0,
      hasResponse: Boolean(error.context),
      online: navigator.onLine !== false,
    });
    throw code === 'not_installed' ? new PasskeyBackendMissingError() : new PasskeyError(message, code);
  }
  if (!data?.success) throw new PasskeyError(data?.error || 'Fingerprint or face sign-in did not work. Try again.', data?.code || '');
  return data;
};

const assertSupported = () => {
  if (!isPasskeySupported()) {
    throw new PasskeyError('This browser cannot use fingerprint or face sign-in. Use a recent Chrome, Safari, Edge or Firefox over https.', 'unsupported');
  }
};

// --------------------------------------------------------------------- enable

/**
 * Turn fingerprint / face sign-in on for this device. `password` is required (and checked by the server) when the account has
 * one - a stolen session alone must not be enough to add a new way in.
 * @returns {Promise<{id: string, label: string, created_at: string}>}
 */
export async function enablePasskey({ password } = {}) {
  assertSupported();
  const { challengeId, options } = await callFunction('register-options', password ? { password } : {});

  let credential;
  try {
    credential = await navigator.credentials.create({ publicKey: creationOptionsFromServer(options) });
  } catch (error) {
    throw new PasskeyError(describeWebAuthnError(error, 'create'));
  }
  if (!credential) throw new PasskeyError('Nothing was set up. Try again.');

  const saved = await callFunction('register-verify', {
    challengeId,
    label: deviceLabel(),
    ...registrationPayload(credential),
  });
  writeStorage(bytesToB64url(credential.rawId));
  return saved.passkey;
}

// -------------------------------------------------------------------- sign in

/**
 * Ask the device for a fingerprint / face check and have the server verify it.
 * @returns {Promise<{tokenHash: string, email: string}>} redeem with supabase.auth.verifyOtp({ token_hash, type: 'email' })
 */
export async function requestPasskeyLogin() {
  assertSupported();
  const { challengeId, options } = await callFunction('login-options');

  let credential;
  try {
    credential = await navigator.credentials.get({ publicKey: requestOptionsFromServer(options) });
  } catch (error) {
    throw new PasskeyError(describeWebAuthnError(error, 'get'));
  }
  if (!credential) throw new PasskeyError('Nothing was checked. Try again.');

  try {
    const result = await callFunction('login-verify', { challengeId, ...assertionPayload(credential) });
    writeStorage(bytesToB64url(credential.rawId));
    return { tokenHash: result.token_hash, email: result.email };
  } catch (error) {
    // The device offered a passkey the server no longer has (removed elsewhere): stop promoting it on this device.
    if (error?.code === 'unknown_credential' && readStorage() === bytesToB64url(credential.rawId)) writeStorage('');
    throw error;
  }
}

// --------------------------------------------------------------------- devices

const isMissingTable = (error) =>
  error && (error.code === '42P01' || error.code === 'PGRST205' || /does not exist|schema cache|could not find the table/i.test(error.message || ''));

/** The signed-in person's fingerprint / face devices, newest first. `isThisDevice` marks the one this browser last used. */
export async function listPasskeys() {
  const { data, error } = await client()
    .from('user_passkeys')
    .select('id, credential_id, label, transports, backed_up, created_at, last_used_at')
    .order('created_at', { ascending: false });
  if (error) {
    if (isMissingTable(error)) throw new PasskeyBackendMissingError();
    throw new PasskeyError(error.message || 'Could not load your devices.');
  }
  const mine = readStorage();
  return (data || []).map((row) => ({ ...row, isThisDevice: Boolean(mine) && row.credential_id === mine }));
}

export async function removePasskey(passkey) {
  const { error } = await client().from('user_passkeys').delete().eq('id', passkey.id);
  if (error) throw new PasskeyError(error.message || 'Could not remove this device.');
  if (passkey.isThisDevice) writeStorage('');
}

/** Used by "sign out everywhere": a lost phone must not keep a way back in. */
export async function removeAllPasskeys() {
  const { error } = await client().from('user_passkeys').delete().not('id', 'is', null);
  if (error && !isMissingTable(error)) throw new PasskeyError(error.message || 'Could not remove your devices.');
  writeStorage('');
}
