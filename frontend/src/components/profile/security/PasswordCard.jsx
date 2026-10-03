import React, { useState } from 'react';
import { Eye, EyeOff, KeyRound, Loader2, Mail } from 'lucide-react';
import { passwordStrength } from '../../../utils/securityHelpers';
import {
  ReauthRequiredError, changePassword, sendPasswordResetEmail, signOutOtherDevices, verifyTotpCode,
} from '../../../services/securityService';

/** Change password: confirms the current one, scores the new one, can sign other devices out. */
export default function PasswordCard({ email, personal, mfaFactorId, onChanged }) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [signOutOthers, setSignOutOthers] = useState(true);
  const [needsCode, setNeedsCode] = useState(false);
  const [nonce, setNonce] = useState('');
  const [totp, setTotp] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const strength = passwordStrength(next, personal);

  const reset = () => {
    setOpen(false); setCurrent(''); setNext(''); setConfirm(''); setNonce(''); setTotp(''); setNeedsCode(false); setError('');
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!current) return setError('Enter your current password.');
    if (next.length < 8) return setError('Use at least 8 characters.');
    if (strength.score < 2) return setError('That password is too easy to guess. Make it longer or less predictable.');
    if (next !== confirm) return setError('The two new passwords do not match.');
    if (next === current) return setError('Your new password must be different from the current one.');
    if (mfaFactorId && !needsCode && totp.replace(/\D/g, '').length !== 6) return setError('Enter the 6-digit code from your authenticator app.');

    setBusy(true);
    try {
      // Step-up: with an authenticator app set up, a fresh code is part of changing the password.
      if (mfaFactorId && !needsCode) await verifyTotpCode({ factorId: mfaFactorId, code: totp });
      await changePassword({ email, currentPassword: needsCode ? null : current, newPassword: next, nonce: needsCode ? nonce.trim() : undefined });
      if (signOutOthers) await signOutOtherDevices().catch(() => {});
      reset();
      setNotice(signOutOthers ? 'Password changed. Your other devices were signed out.' : 'Password changed.');
      await onChanged();
    } catch (err) {
      if (err instanceof ReauthRequiredError) setNeedsCode(true);
      setError(err.message);
    }
    setBusy(false);
  };

  const emailReset = async () => {
    setError('');
    setBusy(true);
    try {
      await sendPasswordResetEmail(email);
      setNotice(`We emailed a reset link to ${email}.`);
      reset();
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  };

  return (
    <section className="gr-card gr-form" aria-label="Password">
      <div className="gr-status">
        <KeyRound aria-hidden="true" />
        <div className="gr-status__body">
          <h3 className="gr-title gr-h">Password</h3>
          <p className="gr-sub">Use a long, unique password you do not use anywhere else.</p>
        </div>
      </div>

      {notice && <div className="gr-alert gr-alert--ok" role="status">{notice}</div>}

      {!open ? (
        <button type="button" className="gr-btn gr-btn--ghost" onClick={() => { setOpen(true); setNotice(''); }}>
          <KeyRound aria-hidden="true" />Change password
        </button>
      ) : (
        <form className="gr-form" onSubmit={submit} noValidate>
          <div className="gr-field">
            <label className="gr-label" htmlFor="gr-pw-current">Current password</label>
            <input id="gr-pw-current" className="gr-input" type="password" autoComplete="current-password" value={current}
              onChange={(e) => setCurrent(e.target.value)} disabled={needsCode} />
          </div>
          <div className="gr-field">
            <label className="gr-label" htmlFor="gr-pw-new">New password</label>
            <div className="gr-pwwrap">
              <input id="gr-pw-new" className="gr-input" type={show ? 'text' : 'password'} autoComplete="new-password" value={next}
                onChange={(e) => setNext(e.target.value)} disabled={needsCode} aria-describedby="gr-pw-hint" />
              <button type="button" className="gr-icon-btn" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'}>
                {show ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
              </button>
            </div>
            {next && (
              <div id="gr-pw-hint" aria-live="polite">
                <div className="gr-meter" data-score={strength.score} role="presentation"><i /><i /><i /><i /></div>
                <p className="gr-hint"><b>{strength.label}.</b> {strength.tips.join(' ')}</p>
              </div>
            )}
          </div>
          <div className="gr-field">
            <label className="gr-label" htmlFor="gr-pw-confirm">Confirm new password</label>
            <input id="gr-pw-confirm" className="gr-input" type={show ? 'text' : 'password'} autoComplete="new-password" value={confirm}
              onChange={(e) => setConfirm(e.target.value)} disabled={needsCode} />
          </div>

          {mfaFactorId && !needsCode && (
            <div className="gr-field">
              <label className="gr-label" htmlFor="gr-pw-totp">Authenticator code</label>
              <input id="gr-pw-totp" className="gr-input gr-code" inputMode="numeric" autoComplete="one-time-code" placeholder="000000"
                value={totp} onChange={(e) => setTotp(e.target.value.replace(/\D/g, '').slice(0, 6))} />
              <p className="gr-hint">Open your authenticator app and enter the current code to confirm it is you.</p>
            </div>
          )}

          {needsCode && (
            <div className="gr-field">
              <label className="gr-label" htmlFor="gr-pw-nonce">Code from your email</label>
              <input id="gr-pw-nonce" className="gr-input" inputMode="numeric" autoComplete="one-time-code" value={nonce} autoFocus
                onChange={(e) => setNonce(e.target.value)} placeholder="Enter the code we emailed you" />
            </div>
          )}

          <label className="gr-switch">
            <input type="checkbox" checked={signOutOthers} onChange={(e) => setSignOutOthers(e.target.checked)} />
            <i aria-hidden="true" /><span>Sign out my other devices after changing</span>
          </label>

          {error && <div className="gr-alert gr-alert--err" role="alert">{error}</div>}

          <div className="gr-grid2">
            <button type="button" className="gr-btn gr-btn--ghost" onClick={reset} disabled={busy}>Cancel</button>
            <button type="submit" className="gr-btn gr-btn--primary" disabled={busy}>
              {busy ? <Loader2 className="gr-spin" aria-hidden="true" /> : <KeyRound aria-hidden="true" />}Update password
            </button>
          </div>
          <button type="button" className="gr-link" onClick={emailReset} disabled={busy} style={{ justifySelf: 'start' }}>
            <Mail aria-hidden="true" style={{ width: 14, height: 14, display: 'inline', marginRight: 6 }} />Forgot your current password? Email me a reset link
          </button>
        </form>
      )}
    </section>
  );
}
