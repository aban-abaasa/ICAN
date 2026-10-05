import React, { useEffect, useRef, useState } from 'react';
import { Lock, X, Delete, Mail, KeyRound, CheckCircle2, Fingerprint, Smartphone } from 'lucide-react';
import { walletAccountService } from '../services/walletAccountService';
import './wallet-access-classic.css';

const PIN_MIN = 4;
const PIN_MAX = 6;

// Class names from wallet-access-classic.css, shared with the business page.
const field = 'wa-input';
const label = 'wa-label';
const panel = 'wa-panel';
const btnPrimary = 'wa-btn wa-btn-primary w-full';
const btnGhost = 'wa-btn wa-btn-ghost';
const linkBtn = 'wa-link';

const ROMAN = ['I', 'II', 'III', 'IV'];

// The printed-certificate frame: monogram seal, eyebrow, italic title, diamond
// rule, then index tabs and a scrolling body. Used by both wallet access pages.
export const AccessShell = ({ id, eyebrow, title, subtitle, onClose, z = 50, tabs, tab, onTab, children }) => (
  <div
    className="wa-overlay"
    style={{ zIndex: z }}
    role="presentation"
    onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
  >
    <div role="dialog" aria-modal="true" aria-labelledby={id} className="wa-card">
      <header className="wa-head">
        <button type="button" onClick={onClose} aria-label="Close" className="wa-close"><X className="h-4 w-4" /></button>
        <span className="wa-seal" aria-hidden="true"><Lock className="h-5 w-5" /></span>
        <p className="wa-eyebrow">{eyebrow}</p>
        <h2 id={id} className="wa-title">{title}</h2>
        {subtitle && <p className="wa-subtitle">{subtitle}</p>}
        <div className="wa-rule" aria-hidden="true" />
      </header>
      <div role="tablist" className="wa-tabs">
        {tabs.map(({ key, label: text }) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => onTab(key)} className="wa-tab">{text}</button>
        ))}
      </div>
      <div className="wa-body">{children}</div>
    </div>
  </div>
);

// Masked PIN boxes + keypad. A real (screen-reader-only) input keeps hardware
// keyboards working; only desktops auto-focus it so phones don't raise the OS
// keyboard over the keypad.
const PinPad = ({ value, onChange, disabled }) => {
  const inputRef = useRef(null);
  useEffect(() => {
    if (!disabled && window.matchMedia?.('(pointer: fine)').matches) inputRef.current?.focus();
  }, [disabled]);
  const add = (d) => onChange(value.length < PIN_MAX ? value + d : value);

  return (
    <div>
      <div className="wa-pinrow" aria-hidden="true">
        {Array.from({ length: PIN_MAX }).map((_, i) => (
          <span key={i} className={`wa-pinbox ${i < value.length ? 'is-filled' : ''} ${i >= PIN_MIN && i >= value.length ? 'is-optional' : ''}`}>
            {i < value.length ? '◆' : ''}
          </span>
        ))}
      </div>
      <p className="wa-small mt-2 text-center italic">{PIN_MIN}–{PIN_MAX} digits · never shared with anyone</p>
      <input
        ref={inputRef}
        type="password"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="new-password"
        maxLength={PIN_MAX}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, PIN_MAX))}
        aria-label="Wallet PIN"
        className="sr-only"
      />
      <div className="wa-keys">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => (
          <button key={d} type="button" disabled={disabled} onClick={() => add(String(d))} className="wa-key">{d}</button>
        ))}
        <button type="button" disabled={disabled} onClick={() => onChange('')} className="wa-key wa-key-fn">Clear</button>
        <button type="button" disabled={disabled} onClick={() => add('0')} className="wa-key">0</button>
        <button type="button" disabled={disabled} onClick={() => onChange(value.slice(0, -1))} aria-label="Delete last digit" className="wa-key wa-key-fn"><Delete className="h-5 w-5" /></button>
      </div>
    </div>
  );
};

const Steps = () => (
  <ol className="wa-steps">
    {[
      'We email you a one-time link.',
      'Open it and choose your wallet PIN.',
      'Come back here — this page continues on its own.'
    ].map((text, i) => (
      <li key={text}>
        <span className="wa-numeral">{ROMAN[i]}</span>
        <span>{text}</span>
      </li>
    ))}
  </ol>
);

const LinkSent = ({ pinLink, onSendLink, onContinue, compact = false }) => (
  <div className="wa-panel wa-panel-ok">
    <p className="wa-ok-title"><Mail className="h-4 w-4" /> Setup link sent</p>
    <p className="wa-p" style={compact ? { fontSize: '0.85rem' } : undefined}>
      Open the link we emailed to <strong>{pinLink.sentTo}</strong> and choose your PIN.
      If it opens in another window, just come back — we'll notice and let you straight in.
    </p>
    {pinLink.error && <p role="alert" className="wa-alert">{pinLink.error}</p>}
    <button type="button" disabled={pinLink.loading} onClick={onContinue} className={`${btnPrimary} mt-3`}>
      {pinLink.loading ? 'Checking…' : "I've set my PIN — continue"}
    </button>
    <button type="button" disabled={pinLink.loading} onClick={onSendLink} className={`${linkBtn} mt-3`}>Resend link</button>
  </div>
);

const WalletAccessModal = ({
  userId,
  userEmail,
  localCurrencyLabel,
  accountMessage,
  form,
  setForm,
  onEmailChange,
  otp,
  setOtp,
  pinLink,
  creating,
  onClose,
  onSubmit,
  onSendCode,
  onVerifyCode,
  onSendLink,
  onContinue,
  onUnlocked,
  onForgotPin
}) => {
  const [tab, setTab] = useState('pin');
  const [account, setAccount] = useState(null);
  const [checking, setChecking] = useState(true);
  const [pin, setPin] = useState('');
  const [unlocking, setUnlocking] = useState(false);
  const [pinError, setPinError] = useState('');

  // Learn what is really on file (the screen that opened this may be stale),
  // and fill in details we already have so nobody retypes their own name.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const row = userId ? await walletAccountService.checkUserAccount(userId) : null;
      if (cancelled) return;
      setAccount(row);
      setChecking(false);
      if (row && !row.pin_hash) {
        setForm((prev) => ({
          ...prev,
          accountHolderName: prev.accountHolderName || row.account_holder_name || '',
          phoneNumber: prev.phoneNumber || row.phone_number || '',
          email: prev.email || row.email || userEmail || ''
        }));
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const hasPin = !!account?.pin_hash;
  const canUnlock = pin.length >= PIN_MIN && !unlocking;
  const firstName = account?.account_holder_name ? account.account_holder_name.split(' ')[0] : '';

  const handleUnlock = async (e) => {
    e?.preventDefault();
    if (!canUnlock) return;
    setUnlocking(true);
    setPinError('');
    try {
      const result = await walletAccountService.verifyUserPIN(userId, pin);
      if (!result.success) {
        setPinError(result.error || 'That PIN is not correct.');
        setPin('');
        return;
      }
      const fresh = await walletAccountService.checkUserAccount(userId);
      setPin('');
      onUnlocked(fresh || account);
    } catch (error) {
      setPinError(error.message || 'Could not check your PIN. Please try again.');
    } finally {
      setUnlocking(false);
    }
  };

  return (
    <AccessShell
      id="wallet-access-title"
      eyebrow="IcanEra Wallet"
      title="Wallet Access"
      subtitle={firstName ? `Welcome back, ${firstName}` : 'Private · Secure · Yours'}
      onClose={onClose}
      tabs={[{ key: 'pin', label: 'I have a PIN' }, { key: 'setup', label: 'Set up my wallet' }]}
      tab={tab}
      onTab={setTab}
    >
      {accountMessage && (
        <p role="status" className={`wa-notice ${accountMessage.type === 'success' ? '' : 'is-error'}`}>{accountMessage.text}</p>
      )}

      {/* ───────────── PIN tab ───────────── */}
      {tab === 'pin' && (
        checking ? (
          <p className="wa-p py-8 text-center italic">Consulting the ledger…</p>
        ) : hasPin ? (
          <form onSubmit={handleUnlock} autoComplete="off">
            <h3 className="wa-h">Enter your PIN</h3>
            <p className="wa-p">You already have a wallet PIN. Enter it to carry on.</p>
            {pinError && <p role="alert" className="wa-alert">{pinError}</p>}
            <PinPad value={pin} onChange={setPin} disabled={unlocking} />
            <button type="submit" disabled={!canUnlock} className={`${btnPrimary} mt-5`}>{unlocking ? 'Checking…' : 'Unlock wallet'}</button>
            <div className="mt-4 text-center"><button type="button" onClick={onForgotPin} className={linkBtn}>Forgot your PIN? Email me a reset link</button></div>
          </form>
        ) : (
          <div>
            <h3 className="wa-h flex items-center gap-2"><KeyRound className="h-4 w-4" style={{ color: 'var(--wa-gold)' }} /> No PIN on file yet</h3>
            <p className="wa-p">Let's get you one — it takes a minute.</p>

            {pinLink.sentTo ? (
              <div className="mt-4"><LinkSent pinLink={pinLink} onSendLink={onSendLink} onContinue={onContinue} /></div>
            ) : (
              <>
                <Steps />
                <div className="mt-5 space-y-3">
                  <div>
                    <label className={label} htmlFor="wa-name">Full name *</label>
                    <input id="wa-name" type="text" value={form.accountHolderName} onChange={(e) => setForm({ ...form, accountHolderName: e.target.value })} placeholder="Enter your full name" className={field} />
                  </div>
                  <div>
                    <label className={label} htmlFor="wa-phone">Phone number *</label>
                    <input id="wa-phone" type="tel" value={form.phoneNumber} onChange={(e) => setForm({ ...form, phoneNumber: e.target.value })} placeholder="+256..." className={field} />
                  </div>
                </div>
                {pinLink.error && <p role="alert" className="wa-alert">{pinLink.error}</p>}
                <button type="button" disabled={pinLink.loading} onClick={onSendLink} className={`${btnPrimary} mt-5`}>
                  {pinLink.loading ? 'Sending link…' : 'Email me the PIN setup link'}
                </button>
                <p className="wa-small mt-2 text-center italic">The link goes to {userEmail || 'your sign-in email'}.</p>
                <div className="mt-3 text-center"><button type="button" onClick={() => setTab('setup')} className={linkBtn}>Prefer a 6-digit code or fingerprint options? →</button></div>
              </>
            )}
          </div>
        )
      )}

      {/* ───────────── Setup tab ───────────── */}
      {tab === 'setup' && (
        <form onSubmit={onSubmit} className="space-y-4">
          <p className="wa-p" style={{ marginTop: 0 }}>Set up your wallet with a secure PIN and optional biometrics.</p>

          <div>
            <label className={label} htmlFor="ws-name">Full name *</label>
            <input id="ws-name" type="text" value={form.accountHolderName} onChange={(e) => setForm({ ...form, accountHolderName: e.target.value })} placeholder="Enter your full name" className={field} />
          </div>
          <div>
            <label className={label} htmlFor="ws-phone">Phone number *</label>
            <input id="ws-phone" type="tel" value={form.phoneNumber} onChange={(e) => setForm({ ...form, phoneNumber: e.target.value })} placeholder="+256..." className={field} />
          </div>
          <div>
            <label className={label} htmlFor="ws-email">Email address *</label>
            <input id="ws-email" type="email" value={form.email} disabled={otp.verified} onChange={(e) => onEmailChange(e.target.value)} placeholder="you@example.com" className={field} />
          </div>

          {/* Email verification */}
          <div className={panel}>
            <h3 className="wa-h wa-h-sm flex items-center gap-2">
              Verify your email {otp.verified && <span className="inline-flex items-center gap-1 text-sm" style={{ color: 'var(--wa-ok)' }}><CheckCircle2 className="h-4 w-4" /> Verified</span>}
            </h3>
            {!otp.verified && (
              <>
                <p className="wa-p mb-3">We'll email a 6-digit code to confirm this address before you set a PIN.</p>
                {otp.error && <p className="wa-alert" style={{ marginTop: 0, marginBottom: '0.6rem' }}>{otp.error}</p>}
                {pinLink.error && !pinLink.sentTo && <p className="wa-alert" style={{ marginTop: 0, marginBottom: '0.6rem' }}>{pinLink.error}</p>}
                {pinLink.sentTo ? (
                  <LinkSent pinLink={pinLink} onSendLink={onSendLink} onContinue={onContinue} compact />
                ) : !otp.sent ? (
                  <button type="button" disabled={otp.loading || !form.email} onClick={onSendCode} className={btnPrimary}>
                    {otp.loading ? 'Sending…' : 'Send verification code'}
                  </button>
                ) : (
                  <div className="flex gap-2">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={otp.code}
                      onChange={(e) => setOtp((prev) => ({ ...prev, code: e.target.value.replace(/\D/g, '').slice(0, 6) }))}
                      placeholder="6-digit code"
                      aria-label="6-digit verification code"
                      className={`${field} flex-1 text-center tracking-widest`}
                    />
                    <button type="button" disabled={otp.loading} onClick={onVerifyCode} className="wa-btn wa-btn-primary">
                      {otp.loading ? '…' : 'Verify'}
                    </button>
                  </div>
                )}
                {otp.sent && !pinLink.sentTo && (
                  <div className="mt-2"><button type="button" disabled={otp.loading} onClick={onSendCode} className={linkBtn}>Resend code</button></div>
                )}
                {!pinLink.sentTo && (
                  <button type="button" disabled={pinLink.loading || otp.loading} onClick={onSendLink} className={`${btnGhost} mt-3 w-full`}>
                    {pinLink.loading ? 'Sending link…' : 'Email me a PIN setup link instead'}
                  </button>
                )}
              </>
            )}
          </div>

          {/* PIN */}
          <div className={panel} style={!otp.verified ? { opacity: 0.55 } : undefined}>
            <h3 className="wa-h wa-h-sm">Set your PIN</h3>
            <p className="wa-p mb-2">
              {otp.verified ? 'Your 4–6 digit PIN protects your account and approves transactions.' : 'Verify your email above to set your PIN.'}
            </p>
            <input
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              value={form.pin}
              disabled={!otp.verified}
              onChange={(e) => setForm({ ...form, pin: e.target.value.replace(/\D/g, '').slice(0, PIN_MAX) })}
              placeholder="4–6 digits"
              maxLength={PIN_MAX}
              aria-label="New wallet PIN"
              className={`${field} text-center text-xl tracking-[0.4em]`}
            />
            <p className="wa-small mt-1 italic">{form.pin.length} / {PIN_MAX} digits</p>
          </div>

          {/* Biometrics */}
          <div className={panel}>
            <h3 className="wa-h wa-h-sm">Biometric security <span className="wa-small font-normal italic">(optional)</span></h3>
            {[
              { key: 'fingerprintEnabled', icon: Fingerprint, title: 'Enable fingerprint', note: 'Use your fingerprint to unlock transactions' },
              { key: 'phonePhoneEnabled', icon: Smartphone, title: 'Use phone PIN', note: "Authenticate with your device's PIN or biometric" }
            ].map(({ key, icon: Icon, title, note }) => (
              <label key={key} className="wa-option">
                <input type="checkbox" checked={!!form[key]} onChange={() => setForm({ ...form, [key]: !form[key] })} />
                <Icon className="h-4 w-4" style={{ color: 'var(--wa-gold)' }} />
                <span className="flex-1"><span className="block text-sm font-semibold" style={{ color: 'var(--wa-title)' }}>{title}</span><span className="wa-small block">{note}</span></span>
              </label>
            ))}
          </div>

          <div>
            <label className={label} htmlFor="ws-currency">Preferred currency</label>
            <input id="ws-currency" type="text" value={localCurrencyLabel} readOnly className={field} />
          </div>

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} disabled={creating} className={`${btnGhost} flex-1`}>Cancel</button>
            <button type="submit" disabled={creating || !otp.verified} className="wa-btn wa-btn-primary flex-1">
              <CheckCircle2 className="h-4 w-4" /> {creating ? 'Creating…' : 'Create account'}
            </button>
          </div>
        </form>
      )}
    </AccessShell>
  );
};

export { PinPad, Steps, LinkSent, field, label, panel, btnPrimary, btnGhost, linkBtn, PIN_MIN, PIN_MAX };
export default WalletAccessModal;
