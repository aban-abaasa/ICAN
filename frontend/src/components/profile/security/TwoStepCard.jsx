import React, { useState } from 'react';
import { Check, Copy, Loader2, ShieldCheck, ShieldOff, Smartphone } from 'lucide-react';
import {
  cancelTotpEnrollment, confirmTotpEnrollment, disableTotp, startTotpEnrollment,
} from '../../../services/securityService';

const digitsOnly = (v) => v.replace(/\D/g, '').slice(0, 6);

/** Authenticator-app (TOTP) two-step verification, on Supabase Auth MFA. */
export default function TwoStepCard({ factors, onChanged }) {
  const enabled = factors.verified[0] || null;
  const [step, setStep] = useState('idle'); // idle | enrolling | disabling
  const [setup, setSetup] = useState(null); // { factorId, qr, secret }
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [copied, setCopied] = useState(false);

  const run = async (fn) => {
    setBusy(true);
    setError('');
    try { await fn(); } catch (err) { setError(err.message); }
    setBusy(false);
  };

  const begin = () => run(async () => {
    setNotice('');
    setSetup(await startTotpEnrollment());
    setCode('');
    setStep('enrolling');
  });

  const confirm = () => run(async () => {
    if (code.length !== 6) throw new Error('Enter the 6-digit code shown in your authenticator app.');
    await confirmTotpEnrollment({ factorId: setup.factorId, code });
    setStep('idle');
    setSetup(null);
    setCode('');
    setNotice('Authenticator verification is on. You will be asked for a code each time you sign in.');
    await onChanged();
  });

  const cancel = async () => {
    if (setup) cancelTotpEnrollment(setup.factorId);
    setStep('idle');
    setSetup(null);
    setCode('');
    setError('');
  };

  const turnOff = () => run(async () => {
    if (code.length !== 6) throw new Error('Enter your current 6-digit code to turn this off.');
    await disableTotp({ factorId: enabled.id, code });
    setStep('idle');
    setCode('');
    setNotice('Authenticator verification is off.');
    await onChanged();
  });

  const copySecret = async () => {
    try {
      await navigator.clipboard.writeText(setup.secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard unavailable: the key is on screen to copy by hand */ }
  };

  return (
    <section className="gr-card gr-form" aria-label="Two-step verification">
      <div className="gr-status">
        {enabled ? <ShieldCheck aria-hidden="true" /> : <ShieldOff aria-hidden="true" />}
        <div className="gr-status__body">
          <div className="gr-sectionhead">
            <div>
              <p className="gr-eyebrow">Second step</p>
              <h3 className="gr-title gr-h">Verify with your authenticator app</h3>
            </div>
            {enabled ? <span className="gr-chip gr-chip--ok"><Check aria-hidden="true" />On</span> : <span className="gr-chip gr-chip--warn">Off</span>}
          </div>
          <p className="gr-sub">
            {enabled
              ? `Active since ${new Date(enabled.created_at).toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' })}. Signing in needs your password and a code from your authenticator app. Changing your password or deleting your account asks for a fresh code too.`
              : 'Adds a second step to signing in: a 6-digit code from an authenticator app (Google Authenticator, Microsoft Authenticator, Authy). A stolen password alone can no longer open your account.'}
          </p>
        </div>
      </div>

      {notice && <div className="gr-alert gr-alert--ok" role="status">{notice}</div>}
      {error && <div className="gr-alert gr-alert--err" role="alert">{error}</div>}

      {step === 'idle' && !enabled && (
        <button type="button" className="gr-btn gr-btn--primary" disabled={busy} onClick={begin}>
          {busy ? <Loader2 className="gr-spin" aria-hidden="true" /> : <Smartphone aria-hidden="true" />}Set up authenticator app
        </button>
      )}
      {step === 'idle' && enabled && (
        <button type="button" className="gr-btn gr-btn--danger" onClick={() => { setStep('disabling'); setError(''); setNotice(''); }}>
          <ShieldOff aria-hidden="true" />Turn off
        </button>
      )}

      {step === 'enrolling' && setup && (
        <div className="gr-form">
          <ol className="gr-steps">
            <li>Open your authenticator app and choose <b>Add account</b>.</li>
            <li>Scan this QR code, or type the setup key.</li>
            <li>Enter the 6-digit code the app shows.</li>
          </ol>
          <div className="gr-qr">
            <img src={setup.qr} alt="QR code for your authenticator app" />
            <div className="gr-secret">
              <code aria-label="Setup key">{setup.secret}</code>
              <button type="button" className="gr-icon-btn" onClick={copySecret} aria-label="Copy setup key">
                {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
              </button>
            </div>
          </div>
          <div className="gr-alert gr-alert--warn" role="note">
            <span>Keep the setup key somewhere safe, such as a password manager. If you lose your phone and the key, you will need support to reset two-step verification.</span>
          </div>
          <div className="gr-field">
            <label className="gr-label" htmlFor="gr-totp-code">6-digit code</label>
            <input id="gr-totp-code" className="gr-input gr-code" inputMode="numeric" autoComplete="one-time-code"
              placeholder="000000" value={code} onChange={(e) => setCode(digitsOnly(e.target.value))}
              onKeyDown={(e) => { if (e.key === 'Enter') confirm(); }} />
          </div>
          <div className="gr-grid2">
            <button type="button" className="gr-btn gr-btn--ghost" disabled={busy} onClick={cancel}>Cancel</button>
            <button type="button" className="gr-btn gr-btn--primary" disabled={busy} onClick={confirm}>
              {busy ? <Loader2 className="gr-spin" aria-hidden="true" /> : <Check aria-hidden="true" />}Turn on
            </button>
          </div>
        </div>
      )}

      {step === 'disabling' && enabled && (
        <div className="gr-form">
          <p className="gr-sub">Enter a current code from your authenticator app to confirm it is you.</p>
          <div className="gr-field">
            <label className="gr-label" htmlFor="gr-totp-off">6-digit code</label>
            <input id="gr-totp-off" className="gr-input gr-code" inputMode="numeric" autoComplete="one-time-code"
              placeholder="000000" value={code} autoFocus onChange={(e) => setCode(digitsOnly(e.target.value))}
              onKeyDown={(e) => { if (e.key === 'Enter') turnOff(); }} />
          </div>
          <div className="gr-grid2">
            <button type="button" className="gr-btn gr-btn--ghost" disabled={busy} onClick={() => { setStep('idle'); setCode(''); setError(''); }}>Keep it on</button>
            <button type="button" className="gr-btn gr-btn--danger" disabled={busy} onClick={turnOff}>
              {busy ? <Loader2 className="gr-spin" aria-hidden="true" /> : <ShieldOff aria-hidden="true" />}Turn off
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
