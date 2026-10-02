import React, { useEffect, useRef, useState } from 'react';
import { Lock, X, Delete, Mail, KeyRound, CheckCircle2, Fingerprint, Smartphone } from 'lucide-react';
import { walletAccountService } from '../services/walletAccountService';

const PIN_MIN = 4;
const PIN_MAX = 6;

// Classic printed-card look shared with PinPromptDialog: ivory stock, ink text,
// double-ruled header, square corners, a hard offset shadow and green/gold trim.
const field = 'w-full rounded-sm border-2 border-[#1f1a12]/40 bg-white px-3 py-2.5 text-[#1f1a12] placeholder-[#1f1a12]/40 focus:border-[#14532d] focus:outline-none disabled:opacity-60';
const label = 'mb-1 block text-[11px] font-bold uppercase tracking-wider text-[#1f1a12]/70';
const panel = 'rounded-sm border border-[#1f1a12]/30 bg-[#f7f3e8] p-3';
const btnPrimary = 'w-full rounded-sm border-2 border-[#14532d] bg-[#14532d] py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40';
const btnGhost = 'rounded-sm border-2 border-[#1f1a12]/60 px-3 py-2 text-sm font-semibold hover:bg-[#1f1a12] hover:text-[#f7f3e8] disabled:opacity-40';
const linkBtn = 'text-xs font-semibold text-[#14532d] underline underline-offset-2 hover:text-[#1f1a12] disabled:opacity-50';
const keyBtn = 'h-12 rounded-sm border-2 border-[#1f1a12]/40 bg-white text-lg font-bold shadow-[2px_2px_0_0_rgba(31,26,18,0.15)] hover:border-[#14532d] active:translate-y-px disabled:opacity-40';

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
      <div className="mt-4 flex justify-center gap-2" aria-hidden="true">
        {Array.from({ length: PIN_MAX }).map((_, i) => (
          <span
            key={i}
            className={`flex h-10 w-9 items-center justify-center rounded-sm border-2 text-xl ${i < value.length ? 'border-[#14532d] bg-[#14532d]/10' : 'border-[#1f1a12]/30'} ${i >= PIN_MIN && i >= value.length ? 'opacity-40' : ''}`}
          >
            {i < value.length ? '•' : ''}
          </span>
        ))}
      </div>
      <p className="mt-1 text-center text-[11px] text-[#1f1a12]/60">{PIN_MIN}–{PIN_MAX} digits · never shared with anyone</p>
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
      <div className="mt-4 grid grid-cols-3 gap-2">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => (
          <button key={d} type="button" disabled={disabled} onClick={() => add(String(d))} className={keyBtn}>{d}</button>
        ))}
        <button type="button" disabled={disabled} onClick={() => onChange('')} className="h-12 rounded-sm border-2 border-[#1f1a12]/40 text-xs font-semibold hover:border-[#14532d] disabled:opacity-40">Clear</button>
        <button type="button" disabled={disabled} onClick={() => add('0')} className={keyBtn}>0</button>
        <button type="button" disabled={disabled} onClick={() => onChange(value.slice(0, -1))} aria-label="Delete last digit" className="flex h-12 items-center justify-center rounded-sm border-2 border-[#1f1a12]/40 hover:border-[#14532d] disabled:opacity-40"><Delete className="h-5 w-5" /></button>
      </div>
    </div>
  );
};

const Steps = () => (
  <ol className="mt-3 space-y-1.5 text-sm text-[#1f1a12]/85">
    {[
      'We email you a one-time link.',
      'Open it and choose your wallet PIN.',
      'Come back here — this page continues on its own.'
    ].map((text, i) => (
      <li key={text} className="flex items-start gap-2">
        <span className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border border-[#8a6a1f] font-serif text-[11px] font-bold text-[#8a6a1f]">{i + 1}</span>
        <span>{text}</span>
      </li>
    ))}
  </ol>
);

const LinkSent = ({ pinLink, onSendLink, onContinue, compact = false }) => (
  <div className={`${panel} border-[#14532d]/50 bg-[#14532d]/5`}>
    <p className="flex items-center gap-2 font-serif text-base font-bold text-[#14532d]">
      <Mail className="h-4 w-4" /> Setup link sent
    </p>
    <p className={`mt-1 ${compact ? 'text-xs' : 'text-sm'} text-[#1f1a12]/85`}>
      Open the link we emailed to <span className="font-semibold">{pinLink.sentTo}</span> and choose your PIN.
      If it opens in another window, just come back — we'll notice and let you straight in.
    </p>
    {pinLink.error && <p role="alert" className="mt-2 text-xs font-semibold text-red-800">{pinLink.error}</p>}
    <button type="button" disabled={pinLink.loading} onClick={onContinue} className={`${btnPrimary} mt-3`}>
      {pinLink.loading ? 'Checking…' : "I've set my PIN — continue"}
    </button>
    <button type="button" disabled={pinLink.loading} onClick={onSendLink} className={`${linkBtn} mt-2`}>Resend link</button>
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

  const tabClass = (name) => `flex-1 border-b-4 px-2 py-2.5 font-serif text-sm font-bold transition-colors ${tab === name ? 'border-[#14532d] text-[#14532d]' : 'border-transparent text-[#1f1a12]/55 hover:text-[#1f1a12]'}`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="presentation"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="wallet-access-title"
        className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-sm border-2 border-[#1f1a12]/70 bg-[#fffdf6] text-[#1f1a12] shadow-[6px_6px_0_0_rgba(31,26,18,0.25)]"
      >
        {/* Masthead */}
        <div className="flex items-start justify-between gap-3 border-b-4 border-double border-[#1f1a12]/30 px-5 pb-3 pt-5">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.25em] text-[#8a6a1f]">IcanEra Wallet</p>
            <h2 id="wallet-access-title" className="mt-0.5 flex items-center gap-2 font-serif text-2xl font-bold">
              <Lock className="h-5 w-5 text-[#14532d]" /> Wallet Access
            </h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-sm p-1 hover:bg-[#1f1a12]/10"><X className="h-4 w-4" /></button>
        </div>

        {/* Index tabs */}
        <div role="tablist" className="flex border-b border-[#1f1a12]/25 px-5">
          <button type="button" role="tab" aria-selected={tab === 'pin'} onClick={() => setTab('pin')} className={tabClass('pin')}>🔑 I have a PIN</button>
          <button type="button" role="tab" aria-selected={tab === 'setup'} onClick={() => setTab('setup')} className={tabClass('setup')}>✨ Set up my wallet</button>
        </div>

        <div className="px-5 pb-5 pt-4">
          {accountMessage && (
            <p
              role="status"
              className={`mb-4 rounded-sm border px-3 py-2 text-sm font-semibold ${accountMessage.type === 'success' ? 'border-[#14532d]/50 bg-[#14532d]/10 text-[#14532d]' : 'border-red-700/40 bg-red-50 text-red-800'}`}
            >
              {accountMessage.text}
            </p>
          )}

          {/* ───────────── PIN tab ───────────── */}
          {tab === 'pin' && (
            checking ? (
              <p className="py-10 text-center font-serif text-sm text-[#1f1a12]/60">Checking your wallet…</p>
            ) : hasPin ? (
              <form onSubmit={handleUnlock} autoComplete="off">
                <h3 className="font-serif text-lg font-bold">Welcome back{account?.account_holder_name ? `, ${account.account_holder_name.split(' ')[0]}` : ''}</h3>
                <p className="mt-1 text-sm text-[#1f1a12]/80">You already have a wallet PIN. Enter it to carry on.</p>
                {pinError && <p role="alert" className="mt-3 rounded-sm border border-red-700/40 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800">{pinError}</p>}
                <PinPad value={pin} onChange={setPin} disabled={unlocking} />
                <button type="submit" disabled={!canUnlock} className={`${btnPrimary} mt-4`}>{unlocking ? 'Checking…' : 'Unlock wallet'}</button>
                <button type="button" onClick={onForgotPin} className={`${linkBtn} mt-3 block`}>Forgot your PIN? Email me a reset link</button>
              </form>
            ) : (
              <div>
                <h3 className="flex items-center gap-2 font-serif text-lg font-bold"><KeyRound className="h-4 w-4 text-[#8a6a1f]" /> No PIN on file yet</h3>
                <p className="mt-1 text-sm text-[#1f1a12]/80">Let's get you one — it takes a minute.</p>

                {pinLink.sentTo ? (
                  <div className="mt-3"><LinkSent pinLink={pinLink} onSendLink={onSendLink} onContinue={onContinue} /></div>
                ) : (
                  <>
                    <Steps />
                    <div className="mt-4 space-y-3">
                      <div>
                        <label className={label} htmlFor="wa-name">Full name *</label>
                        <input id="wa-name" type="text" value={form.accountHolderName} onChange={(e) => setForm({ ...form, accountHolderName: e.target.value })} placeholder="Enter your full name" className={field} />
                      </div>
                      <div>
                        <label className={label} htmlFor="wa-phone">Phone number *</label>
                        <input id="wa-phone" type="tel" value={form.phoneNumber} onChange={(e) => setForm({ ...form, phoneNumber: e.target.value })} placeholder="+256..." className={field} />
                      </div>
                    </div>
                    {pinLink.error && <p role="alert" className="mt-3 rounded-sm border border-red-700/40 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800">{pinLink.error}</p>}
                    <button type="button" disabled={pinLink.loading} onClick={onSendLink} className={`${btnPrimary} mt-4`}>
                      {pinLink.loading ? 'Sending link…' : '📧 Email me the PIN setup link'}
                    </button>
                    <p className="mt-2 text-center text-[11px] text-[#1f1a12]/60">The link goes to {userEmail || 'your sign-in email'}.</p>
                    <button type="button" onClick={() => setTab('setup')} className={`${linkBtn} mt-2 block mx-auto`}>Prefer a 6-digit code or fingerprint options? →</button>
                  </>
                )}
              </div>
            )
          )}

          {/* ───────────── Setup tab ───────────── */}
          {tab === 'setup' && (
            <form onSubmit={onSubmit} className="space-y-4">
              <p className="text-sm text-[#1f1a12]/80">Set up your wallet with a secure PIN and optional biometrics.</p>

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
                <h3 className="flex items-center gap-2 font-serif text-base font-bold">
                  📧 Verify your email {otp.verified && <span className="text-sm text-[#14532d]">✓ Verified</span>}
                </h3>
                {!otp.verified && (
                  <>
                    <p className="mb-3 mt-1 text-sm text-[#1f1a12]/80">We'll email a 6-digit code to confirm this address before you set a PIN.</p>
                    {otp.error && <p className="mb-2 text-xs font-semibold text-red-800">{otp.error}</p>}
                    {pinLink.error && !pinLink.sentTo && <p className="mb-2 text-xs font-semibold text-red-800">{pinLink.error}</p>}
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
                        <button type="button" disabled={otp.loading} onClick={onVerifyCode} className="rounded-sm border-2 border-[#14532d] bg-[#14532d] px-4 text-sm font-bold text-white disabled:opacity-40">
                          {otp.loading ? '…' : 'Verify'}
                        </button>
                      </div>
                    )}
                    {otp.sent && !pinLink.sentTo && (
                      <button type="button" disabled={otp.loading} onClick={onSendCode} className={`${linkBtn} mt-2`}>Resend code</button>
                    )}
                    {!pinLink.sentTo && (
                      <button type="button" disabled={pinLink.loading || otp.loading} onClick={onSendLink} className={`${btnGhost} mt-3 w-full`}>
                        {pinLink.loading ? 'Sending link…' : '🔗 Email me a PIN setup link instead'}
                      </button>
                    )}
                  </>
                )}
              </div>

              {/* PIN */}
              <div className={`${panel} ${!otp.verified ? 'opacity-50' : ''}`}>
                <h3 className="font-serif text-base font-bold">🔐 Set your PIN</h3>
                <p className="mb-2 mt-1 text-sm text-[#1f1a12]/80">
                  {otp.verified ? "Your 4–6 digit PIN protects your account and approves transactions." : 'Verify your email above to set your PIN.'}
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
                <p className="mt-1 text-[11px] text-[#1f1a12]/60">{form.pin.length} / {PIN_MAX} digits</p>
              </div>

              {/* Biometrics */}
              <div className={panel}>
                <h3 className="mb-2 font-serif text-base font-bold">👆 Biometric security <span className="text-xs font-normal text-[#1f1a12]/60">(optional)</span></h3>
                {[
                  { key: 'fingerprintEnabled', icon: Fingerprint, title: 'Enable fingerprint', note: 'Use your fingerprint to unlock transactions' },
                  { key: 'phonePhoneEnabled', icon: Smartphone, title: 'Use phone PIN', note: "Authenticate with your device's PIN or biometric" }
                ].map(({ key, icon: Icon, title, note }) => (
                  <label key={key} className="mb-2 flex cursor-pointer items-center gap-3 rounded-sm border border-[#1f1a12]/25 bg-white p-2.5 last:mb-0 hover:border-[#14532d]">
                    <input type="checkbox" checked={!!form[key]} onChange={() => setForm({ ...form, [key]: !form[key] })} className="h-5 w-5 accent-[#14532d]" />
                    <Icon className="h-4 w-4 text-[#8a6a1f]" />
                    <span className="flex-1"><span className="block text-sm font-semibold">{title}</span><span className="block text-xs text-[#1f1a12]/65">{note}</span></span>
                  </label>
                ))}
              </div>

              <div>
                <label className={label} htmlFor="ws-currency">Preferred currency</label>
                <input id="ws-currency" type="text" value={localCurrencyLabel} readOnly className={`${field} bg-[#f7f3e8]`} />
              </div>

              <div className="flex gap-3 pt-1">
                <button type="button" onClick={onClose} disabled={creating} className={`${btnGhost} flex-1`}>Cancel</button>
                <button type="submit" disabled={creating || !otp.verified} className="flex flex-1 items-center justify-center gap-2 rounded-sm border-2 border-[#14532d] bg-[#14532d] py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40">
                  <CheckCircle2 className="h-4 w-4" /> {creating ? 'Creating…' : 'Create account'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

export { PinPad, Steps, LinkSent, field, label, panel, btnPrimary, btnGhost, linkBtn, PIN_MIN, PIN_MAX };
export default WalletAccessModal;
