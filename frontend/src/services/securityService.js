// Security Center: Supabase Auth + the read/revoke functions from
// supabase/migrations/20261003091500_security_center.sql.
//
//   sessions & history   -> ican_security_* RPCs over auth.sessions / auth.audit_log_entries
//   two-step (TOTP)      -> supabase.auth.mfa.*
//   password             -> supabase.auth.updateUser (+ reauthenticate when the project requires it)
//   sign out others/all  -> supabase.auth.signOut({ scope })

import { createEphemeralSupabaseClient, getSupabaseClient } from '../lib/supabase/client';

const client = () => {
  const sb = getSupabaseClient();
  if (!sb) throw new Error('The app is not connected to its database. Check your connection and try again.');
  return sb;
};

export class SecurityBackendMissingError extends Error {
  constructor() {
    super('Device and sign-in history are not switched on for this server yet. An administrator needs to apply the security center migration.');
    this.name = 'SecurityBackendMissingError';
  }
}
export class ReauthRequiredError extends Error {
  constructor() {
    super('For your safety, confirm it is you: enter the code we just emailed.');
    this.name = 'ReauthRequiredError';
  }
}
export const isSecurityBackendMissing = (e) => e instanceof SecurityBackendMissingError;

// 42883 undefined_function; PGRST202 function not in the schema cache.
const isMissingFunction = (error) =>
  error && (error.code === '42883' || error.code === 'PGRST202' || /could not find the function|does not exist/i.test(error.message || ''));

const rpc = async (name, args) => {
  const { data, error } = await client().rpc(name, args);
  if (error) {
    if (isMissingFunction(error)) throw new SecurityBackendMissingError();
    throw new Error(error.message || 'Something went wrong. Please try again.');
  }
  return data;
};

// ------------------------------------------------------------ sessions & history

export const listSessions = async () => (await rpc('ican_security_list_sessions')) || [];
export const listActivity = async (limit = 30) => (await rpc('ican_security_activity', { p_limit: limit })) || [];
export const revokeSession = async (sessionId) => rpc('ican_security_revoke_session', { p_session_id: sessionId });

/** When the password was last set or changed (null when unknown or the migration is not applied). */
export async function getPasswordChangedAt() {
  try {
    return await rpc('ican_security_password_changed_at');
  } catch (e) {
    if (isSecurityBackendMissing(e)) return null;
    throw e;
  }
}

export async function signOutOtherDevices() {
  const { error } = await client().auth.signOut({ scope: 'others' });
  if (error) throw new Error(error.message);
}

// ------------------------------------------------------------- two-step (TOTP)

/** The account's authenticator factors: { verified: [...], pending: [...] } */
export async function getTotpFactors() {
  const { data, error } = await client().auth.mfa.listFactors();
  if (error) throw new Error(error.message);
  const all = (data?.all || []).filter((f) => f.factor_type === 'totp');
  return { verified: all.filter((f) => f.status === 'verified'), pending: all.filter((f) => f.status !== 'verified') };
}

/** Begin setup: returns the QR image (SVG data URI), the manual key and the factor id to confirm. */
export async function startTotpEnrollment() {
  const sb = client();
  // An abandoned earlier attempt would otherwise block a new one.
  const { pending } = await getTotpFactors();
  await Promise.all(pending.map((f) => sb.auth.mfa.unenroll({ factorId: f.id }).catch(() => {})));

  const { data, error } = await sb.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: `ICAN authenticator ${new Date().toISOString().slice(0, 10)}`,
    issuer: 'IcanEra',
  });
  if (error) throw new Error(/disabled|not enabled/i.test(error.message)
    ? 'Two-step verification is not enabled for this project yet. An administrator can switch it on in Supabase (Authentication, Multi-factor).'
    : error.message);
  return { factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret, uri: data.totp.uri };
}

const cleanCode = (code) => String(code || '').replace(/\D/g, '');

export async function confirmTotpEnrollment({ factorId, code }) {
  const { error } = await client().auth.mfa.challengeAndVerify({ factorId, code: cleanCode(code) });
  if (error) throw new Error(/invalid|expired/i.test(error.message) ? 'That code is not right, or it expired. Try the newest one.' : error.message);
}

/** Cancel an enrolment that was never confirmed. */
export async function cancelTotpEnrollment(factorId) {
  await client().auth.mfa.unenroll({ factorId }).catch(() => {});
}

/** Prove a fresh authenticator code (step-up before a sensitive action). Throws a plain-English error. */
export async function verifyTotpCode({ factorId, code }) {
  const { error } = await client().auth.mfa.challengeAndVerify({ factorId, code: cleanCode(code) });
  if (error) {
    throw new Error(/invalid|expired/i.test(error.message)
      ? 'That authenticator code is not right, or it expired. Use the newest one.'
      : error.message);
  }
}

/** Turning it off needs a fresh code: prove it is you, then remove the factor. */
export async function disableTotp({ factorId, code }) {
  const sb = client();
  const { error: verifyError } = await sb.auth.mfa.challengeAndVerify({ factorId, code: cleanCode(code) });
  if (verifyError) throw new Error(/invalid|expired/i.test(verifyError.message) ? 'That code is not right, or it expired. Try the newest one.' : verifyError.message);
  const { error } = await sb.auth.mfa.unenroll({ factorId });
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------- password

/**
 * Confirm the current password on a throwaway client (so the real session is
 * untouched), then set the new one. If the project insists on reauthentication,
 * a ReauthRequiredError tells the UI to ask for the emailed code and call again
 * with `nonce`.
 */
export async function changePassword({ email, currentPassword, newPassword, nonce }) {
  if (currentPassword) {
    const probe = createEphemeralSupabaseClient();
    if (!probe) throw new Error('The app is not connected to its database.');
    const { error } = await probe.auth.signInWithPassword({ email, password: currentPassword });
    probe.auth.signOut().catch(() => {}); // do not leave a session behind
    if (error) {
      throw new Error(/invalid login/i.test(error.message) ? 'Your current password is not correct.' : error.message);
    }
  }

  const { error } = await client().auth.updateUser(nonce ? { password: newPassword, nonce } : { password: newPassword });
  if (error) {
    if (/reauthentication|nonce/i.test(error.message)) {
      if (!nonce) {
        await client().auth.reauthenticate();
        throw new ReauthRequiredError();
      }
      throw new Error('That code is not right. Check your email for the newest one.');
    }
    if (/same.*password|different from the old/i.test(error.message)) throw new Error('Choose a password you have not used on this account before.');
    if (/weak|least|characters/i.test(error.message)) throw new Error(error.message);
    throw new Error(error.message || 'Your password could not be changed.');
  }
}

export async function sendPasswordResetEmail(email) {
  const { error } = await client().auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/reset-password` });
  if (error) throw new Error(error.message);
}
