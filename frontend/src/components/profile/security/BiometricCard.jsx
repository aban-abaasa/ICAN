import React, { useCallback, useEffect, useState } from 'react';
import { Check, Fingerprint, Laptop, Loader2, ScanFace, Smartphone, Trash2 } from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { formatTimeAgo } from '../../../services/universalNotificationsService';
import {
  enablePasskey, isPasskeyBackendMissing, listPasskeys, removePasskey,
} from '../../../services/passkeyService';
import { biometricName, isPasskeySupported, platformAuthenticatorAvailable } from '../../../utils/webauthn';

const deviceIcon = (label) => (/Android|iOS|iPhone|iPad/i.test(label) ? Smartphone : Laptop);

/**
 * Fingerprint / face sign-in. The device checks the person and keeps the private key in its secure hardware; the server
 * only stores the public key, so there is no fingerprint or face anywhere to leak.
 */
export default function BiometricCard({ twoStepOn = false }) {
  const { user } = useAuth();
  const supported = isPasskeySupported();
  const hasPassword = Array.isArray(user?.app_metadata?.providers) && user.app_metadata.providers.includes('email');
  const name = biometricName();

  const [passkeys, setPasskeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [backendMissing, setBackendMissing] = useState(false);
  const [deviceReady, setDeviceReady] = useState(true); // false: this device has no fingerprint / face / screen lock to use
  const [asking, setAsking] = useState(false); // showing the password box
  const [password, setPassword] = useState('');
  const [removing, setRemoving] = useState(null); // passkey awaiting "yes, remove"
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    try {
      setPasskeys(await listPasskeys());
      setBackendMissing(false);
    } catch (err) {
      if (isPasskeyBackendMissing(err)) setBackendMissing(true);
      else setError(err.message);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!supported) { setLoading(false); return undefined; }
    load();
    platformAuthenticatorAvailable().then(setDeviceReady);
    return undefined;
  }, [supported, load]);

  const run = async (fn) => {
    setBusy(true);
    setError('');
    try { await fn(); } catch (err) { setError(err.message); }
    setBusy(false);
  };

  const thisDevice = passkeys.find((p) => p.isThisDevice) || null;

  const turnOn = () => run(async () => {
    if (hasPassword && !asking) { setAsking(true); setNotice(''); return; }
    if (hasPassword && !password) throw new Error('Enter your password to turn this on.');
    await enablePasskey({ password: hasPassword ? password : undefined });
    setAsking(false);
    setPassword('');
    setNotice('Done. Next time, tap “Sign in with fingerprint or face” on the sign-in screen.');
    await load();
  });

  const confirmRemove = () => run(async () => {
    await removePasskey(removing);
    setRemoving(null);
    setNotice('That device can no longer sign in with fingerprint or face.');
    await load();
  });

  const enabled = passkeys.length > 0;

  return (
    <section className="gr-card gr-form" aria-label="Fingerprint and face sign-in">
      <div className="gr-status">
        <Fingerprint aria-hidden="true" />
        <div className="gr-status__body">
          <div className="gr-sectionhead">
            <div>
              <p className="gr-eyebrow">The fast way in</p>
              <h3 className="gr-title gr-h">Sign in with fingerprint or face</h3>
            </div>
            {enabled
              ? <span className="gr-chip gr-chip--ok"><Check aria-hidden="true" />On · {passkeys.length} device{passkeys.length === 1 ? '' : 's'}</span>
              : <span className="gr-chip gr-chip--warn">Off</span>}
          </div>
          <p className="gr-sub">
            Open IcanEra with your {name} instead of typing a password. Your device does the checking and keeps the key
            to itself: IcanEra never sees, stores or sends your fingerprint or face.
            {twoStepOn ? ' You will still be asked for your authenticator code afterwards.' : ''}
          </p>
        </div>
      </div>

      {notice && <div className="gr-alert gr-alert--ok" role="status">{notice}</div>}
      {error && <div className="gr-alert gr-alert--err" role="alert">{error}</div>}

      {!supported && (
        <div className="gr-alert gr-alert--warn" role="note">
          This browser cannot use fingerprint or face sign-in. Open IcanEra in a recent Chrome, Safari, Edge or Firefox over a secure (https) connection.
        </div>
      )}

      {supported && backendMissing && (
        <div className="gr-alert gr-alert--warn" role="note">
          Fingerprint and face sign-in is not switched on for this server yet. An administrator needs to apply the biometric sign-in migration and deploy the passkey-auth function.
        </div>
      )}

      {supported && !backendMissing && loading && <div className="gr-skel" />}

      {supported && !backendMissing && !loading && (
        <>
          {passkeys.length > 0 && (
            <div className="gr-list">
              {passkeys.map((p) => {
                const Icon = deviceIcon(p.label);
                return (
                  <div key={p.id} className={`gr-device ${p.isThisDevice ? 'is-current' : ''}`}>
                    <span className="gr-device__icon"><Icon aria-hidden="true" /></span>
                    <div>
                      <div className="gr-device__t">
                        {p.label}
                        {p.isThisDevice && <span className="gr-chip gr-chip--ok">This device</span>}
                        {p.backed_up && <span className="gr-chip">Synced</span>}
                      </div>
                      <div className="gr-device__m">
                        Added {new Date(p.created_at).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })}
                        {' · '}{p.last_used_at ? `used ${formatTimeAgo(p.last_used_at).toLowerCase()}` : 'not used yet'}
                      </div>
                    </div>
                    <button type="button" className="gr-btn gr-btn--ghost gr-btn--sm" disabled={busy}
                      onClick={() => { setRemoving(p); setError(''); setNotice(''); }} aria-label={`Remove ${p.label}`}>
                      <Trash2 aria-hidden="true" />Remove
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {removing && (
            <div className="gr-form">
              <p className="gr-sub">Remove <b>{removing.label}</b>? It will go back to needing your password to sign in.</p>
              <div className="gr-grid2">
                <button type="button" className="gr-btn gr-btn--ghost" disabled={busy} onClick={() => setRemoving(null)}>Keep it</button>
                <button type="button" className="gr-btn gr-btn--danger" disabled={busy} onClick={confirmRemove}>
                  {busy ? <Loader2 className="gr-spin" aria-hidden="true" /> : <Trash2 aria-hidden="true" />}Remove
                </button>
              </div>
            </div>
          )}

          {!thisDevice && !removing && (
            <>
              {!deviceReady && (
                <div className="gr-alert gr-alert--warn" role="note">
                  This device has no fingerprint, face or screen lock turned on yet. Turn one on in your device settings, then come back.
                </div>
              )}

              {asking && (
                <div className="gr-field">
                  <label className="gr-label" htmlFor="gr-bio-password">Your password</label>
                  <input id="gr-bio-password" className="gr-input" type="password" autoComplete="current-password" autoFocus
                    placeholder="Confirm it is you" value={password}
                    onChange={(e) => { setPassword(e.target.value); setError(''); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') turnOn(); }} />
                  <p className="gr-small">A new way into your account needs your password first, so a stolen session cannot add one.</p>
                </div>
              )}

              <div className={asking ? 'gr-grid2' : undefined}>
                {asking && (
                  <button type="button" className="gr-btn gr-btn--ghost" disabled={busy}
                    onClick={() => { setAsking(false); setPassword(''); setError(''); }}>Cancel</button>
                )}
                <button type="button" className="gr-btn gr-btn--primary" disabled={busy || !deviceReady} onClick={turnOn}>
                  {busy ? <Loader2 className="gr-spin" aria-hidden="true" /> : <ScanFace aria-hidden="true" />}
                  {asking ? 'Turn on' : enabled ? 'Add this device' : 'Turn on for this device'}
                </button>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
