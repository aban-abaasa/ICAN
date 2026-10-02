import React, { useEffect, useRef, useState } from 'react';
import { Lock, X, KeyRound, Building2, CheckCircle2 } from 'lucide-react';
import { walletAccountService } from '../services/walletAccountService';
import { PinPad, Steps, LinkSent, field, label, panel, btnPrimary, btnGhost, linkBtn, PIN_MIN, PIN_MAX } from './WalletAccessModal';

// Business twin of the personal Wallet Access card. The business wallet's PIN
// lives with the iCanEra business wallet (not on a personal account row), so
// "is a PIN set?" and "is this the PIN?" are answered by the business-wallet
// settings and verify_pitchin_business_wallet_pin().
const BusinessWalletAccessModal = ({
  profile,
  userEmail,
  localCurrencyLabel,
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
  onUnlocked,
  onForgotPin
}) => {
  const hasWallet = !!profile?.ican_wallet;
  const hasLegacyAccount = !!(profile?.user_accounts && profile.user_accounts.length > 0);

  const [tab, setTab] = useState('pin');
  const [status, setStatus] = useState(null); // { pinSet, lockedUntil } | null
  const [checking, setChecking] = useState(true);
  const [pin, setPin] = useState('');
  const [unlocking, setUnlocking] = useState(false);
  const [pinError, setPinError] = useState('');
  const [recheck, setRecheck] = useState({ loading: false, note: '' });
  const [justSet, setJustSet] = useState(false);
  const startedWithoutPin = useRef(false);

  const refreshStatus = async () => {
    const next = await walletAccountService.getBusinessWalletPinStatus(profile.id);
    setStatus(next);
    return next;
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const next = await walletAccountService.getBusinessWalletPinStatus(profile.id);
      if (cancelled) return;
      setStatus(next);
      startedWithoutPin.current = !next?.pinSet;
      setChecking(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.id]);

  const hasPin = !!status?.pinSet;

  // The setup link usually opens in another tab or the installed app. While
  // this page waits for a PIN, look again when the user returns and every few
  // seconds once the link has been sent, then carry on by itself.
  useEffect(() => {
    if (hasPin || checking) return undefined;
    let cancelled = false;
    const look = async () => {
      if (document.visibilityState === 'hidden') return;
      const next = await walletAccountService.getBusinessWalletPinStatus(profile.id);
      if (cancelled || !next?.pinSet) return;
      setStatus(next);
      if (startedWithoutPin.current) {
        setJustSet(true);
        setTimeout(() => onUnlocked(), 1200);
      }
    };
    document.addEventListener('visibilitychange', look);
    window.addEventListener('focus', look);
    const timer = pinLink.sentTo ? setInterval(look, 5000) : null;
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', look);
      window.removeEventListener('focus', look);
      if (timer) clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasPin, checking, pinLink.sentTo, profile.id]);

  const handleContinue = async () => {
    setRecheck({ loading: true, note: '' });
    const next = await refreshStatus();
    if (next?.pinSet) {
      setRecheck({ loading: false, note: '' });
      setJustSet(true);
      setTimeout(() => onUnlocked(), 1200);
      return;
    }
    setRecheck({ loading: false, note: "We can't see the PIN yet. Open the link in your email, set the PIN, then press Continue again." });
  };

  const lockedNow = status?.lockedUntil && new Date(status.lockedUntil) > new Date();
  const canUnlock = pin.length >= PIN_MIN && !unlocking && !lockedNow;

  const handleUnlock = async (e) => {
    e?.preventDefault();
    if (!canUnlock) return;
    setUnlocking(true);
    setPinError('');
    const result = await walletAccountService.verifyBusinessWalletPin(profile.id, pin);
    setPin('');
    if (result.success) {
      setUnlocking(false);
      onUnlocked();
      return;
    }
    setPinError(result.error || 'That PIN is not correct.');
    await refreshStatus();
    setUnlocking(false);
  };

  const tabClass = (name) => `flex-1 border-b-4 px-2 py-2.5 font-serif text-sm font-bold transition-colors ${tab === name ? 'border-[#14532d] text-[#14532d]' : 'border-transparent text-[#1f1a12]/55 hover:text-[#1f1a12]'}`;
  const linkState = { ...pinLink, loading: pinLink.loading || recheck.loading, error: recheck.note || pinLink.error };

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4"
      role="presentation"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="business-access-title"
        className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-sm border-2 border-[#1f1a12]/70 bg-[#fffdf6] text-[#1f1a12] shadow-[6px_6px_0_0_rgba(31,26,18,0.25)]"
      >
        {/* Masthead */}
        <div className="flex items-start justify-between gap-3 border-b-4 border-double border-[#1f1a12]/30 px-5 pb-3 pt-5">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.25em] text-[#8a6a1f]">IcanEra Business Wallet</p>
            <h2 id="business-access-title" className="mt-0.5 flex items-center gap-2 font-serif text-2xl font-bold">
              <Lock className="h-5 w-5 flex-shrink-0 text-[#14532d]" /> Wallet Access
            </h2>
            <p className="mt-0.5 truncate font-serif text-sm text-[#1f1a12]/70">{profile.business_name}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-sm p-1 hover:bg-[#1f1a12]/10"><X className="h-4 w-4" /></button>
        </div>

        {/* Index tabs */}
        <div role="tablist" className="flex border-b border-[#1f1a12]/25 px-5">
          <button type="button" role="tab" aria-selected={tab === 'pin'} onClick={() => setTab('pin')} className={tabClass('pin')}>🔑 I have a PIN</button>
          <button type="button" role="tab" aria-selected={tab === 'about'} onClick={() => setTab('about')} className={tabClass('about')}>
            {hasWallet ? '🏛 About this wallet' : '✨ Set up wallet'}
          </button>
        </div>

        <div className="px-5 pb-5 pt-4">
          {justSet && (
            <p role="status" className="mb-4 rounded-sm border border-[#14532d]/50 bg-[#14532d]/10 px-3 py-2 text-sm font-semibold text-[#14532d]">
              ✅ PIN set — your business wallet is ready.
            </p>
          )}

          {/* ───────────── PIN tab ───────────── */}
          {tab === 'pin' && (
            checking ? (
              <p className="py-10 text-center font-serif text-sm text-[#1f1a12]/60">Checking the business wallet…</p>
            ) : hasPin ? (
              <form onSubmit={handleUnlock} autoComplete="off">
                <h3 className="font-serif text-lg font-bold">Business wallet PIN</h3>
                <p className="mt-1 text-sm text-[#1f1a12]/80">Enter the PIN for {profile.business_name} to carry on.</p>
                {lockedNow && (
                  <p role="alert" className="mt-3 rounded-sm border border-red-700/40 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800">
                    Too many wrong PINs — locked until {new Date(status.lockedUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.
                  </p>
                )}
                {pinError && !lockedNow && <p role="alert" className="mt-3 rounded-sm border border-red-700/40 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800">{pinError}</p>}
                <PinPad value={pin} onChange={setPin} disabled={unlocking || lockedNow} />
                <button type="submit" disabled={!canUnlock} className={`${btnPrimary} mt-4`}>{unlocking ? 'Checking…' : 'Unlock business wallet'}</button>
                <button type="button" onClick={onForgotPin} className={`${linkBtn} mt-3 block`}>Forgot the PIN? Email me a reset link</button>
              </form>
            ) : (
              <div>
                <h3 className="flex items-center gap-2 font-serif text-lg font-bold"><KeyRound className="h-4 w-4 text-[#8a6a1f]" /> No PIN on file yet</h3>
                <p className="mt-1 text-sm text-[#1f1a12]/80">
                  Only the business's highest-ownership shareholder can set the business wallet PIN.
                </p>
                {pinLink.sentTo ? (
                  <div className="mt-3"><LinkSent pinLink={linkState} onSendLink={onSendLink} onContinue={handleContinue} /></div>
                ) : (
                  <>
                    <Steps />
                    {pinLink.error && <p role="alert" className="mt-3 rounded-sm border border-red-700/40 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800">{pinLink.error}</p>}
                    <button type="button" disabled={pinLink.loading} onClick={onSendLink} className={`${btnPrimary} mt-4`}>
                      {pinLink.loading ? 'Sending link…' : '📧 Email me the PIN setup link'}
                    </button>
                    <p className="mt-2 text-center text-[11px] text-[#1f1a12]/60">The link goes to {userEmail || 'your sign-in email'}.</p>
                  </>
                )}
              </div>
            )
          )}

          {/* ───────────── Second tab ───────────── */}
          {tab === 'about' && hasWallet && (
            <div>
              <h3 className="flex items-center gap-2 font-serif text-lg font-bold"><Building2 className="h-4 w-4 text-[#8a6a1f]" /> {profile.business_name}</h3>
              <dl className="mt-3 divide-y divide-[#1f1a12]/15 rounded-sm border border-[#1f1a12]/30 bg-[#f7f3e8] text-sm">
                <div className="flex justify-between gap-3 px-3 py-2"><dt className="text-[#1f1a12]/65">Wallet</dt><dd className="break-all text-right font-mono text-xs font-semibold">{profile.ican_wallet.wallet_address || 'Business wallet'}</dd></div>
                <div className="flex justify-between gap-3 px-3 py-2"><dt className="text-[#1f1a12]/65">Balance</dt><dd className="font-semibold">{Number(profile.ican_wallet.ican_balance || 0).toLocaleString()} IcanEra</dd></div>
                <div className="flex justify-between gap-3 px-3 py-2"><dt className="text-[#1f1a12]/65">PIN</dt><dd className={`font-semibold ${hasPin ? 'text-[#14532d]' : 'text-[#8a6a1f]'}`}>{checking ? 'Checking…' : hasPin ? 'Set' : 'Not set yet'}</dd></div>
              </dl>
              <p className="mt-3 text-sm text-[#1f1a12]/80">
                {hasPin
                  ? 'Transfers and approvals from this wallet ask for the PIN. If it is lost, request a reset link by email.'
                  : 'Set a PIN before making transactions from this wallet.'}
              </p>
              {hasPin && <button type="button" onClick={onForgotPin} className={`${btnGhost} mt-3 w-full`}>Reset the PIN by email</button>}
            </div>
          )}

          {tab === 'about' && !hasWallet && (
            <form onSubmit={onSubmit} className="space-y-4">
              <p className="text-sm text-[#1f1a12]/80">
                {hasLegacyAccount ? 'Update the details of this business wallet account.' : 'Create a wallet account for this business with a secure PIN.'}
              </p>
              <div>
                <label className={label} htmlFor="bw-name">Account holder name</label>
                <input id="bw-name" type="text" value={form.accountHolderName} onChange={(e) => setForm({ ...form, accountHolderName: e.target.value })} placeholder="Enter account holder name" className={field} />
              </div>
              <div>
                <label className={label} htmlFor="bw-email">Email address</label>
                <input id="bw-email" type="email" value={form.email} disabled={otp.verified} onChange={(e) => onEmailChange(e.target.value)} placeholder="Enter email address" className={field} />
              </div>
              <div>
                <label className={label} htmlFor="bw-phone">Phone number</label>
                <input id="bw-phone" type="tel" value={form.phoneNumber} onChange={(e) => setForm({ ...form, phoneNumber: e.target.value })} placeholder="Enter phone number" className={field} />
              </div>
              <div>
                <label className={label} htmlFor="bw-currency">Preferred currency</label>
                <input id="bw-currency" type="text" value={localCurrencyLabel} readOnly className={`${field} bg-[#f7f3e8]`} />
              </div>

              {!hasLegacyAccount && (
                <div className={panel}>
                  <h3 className="flex items-center gap-2 font-serif text-base font-bold">
                    📧 Verify your email {otp.verified && <span className="text-sm text-[#14532d]">✓ Verified</span>}
                  </h3>
                  {!otp.verified && (
                    <>
                      <p className="mb-3 mt-1 text-sm text-[#1f1a12]/80">We'll email a 6-digit code to confirm this address before you set a PIN.</p>
                      {otp.error && <p className="mb-2 text-xs font-semibold text-red-800">{otp.error}</p>}
                      {!otp.sent ? (
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
                      {otp.sent && <button type="button" disabled={otp.loading} onClick={onSendCode} className={`${linkBtn} mt-2`}>Resend code</button>}
                    </>
                  )}
                </div>
              )}

              <div>
                <label className={label} htmlFor="bw-pin">{hasLegacyAccount ? 'New PIN (4-6 digits)' : 'Create PIN (4-6 digits)'}</label>
                <input
                  id="bw-pin"
                  type="password"
                  inputMode="numeric"
                  autoComplete="new-password"
                  value={form.newPin}
                  disabled={!hasLegacyAccount && !otp.verified}
                  onChange={(e) => setForm({ ...form, newPin: e.target.value.replace(/\D/g, '').slice(0, PIN_MAX) })}
                  placeholder="Enter 4-6 digit PIN"
                  maxLength={PIN_MAX}
                  className={field}
                />
              </div>
              <div>
                <label className={label} htmlFor="bw-pin2">Confirm PIN</label>
                <input
                  id="bw-pin2"
                  type="password"
                  inputMode="numeric"
                  autoComplete="new-password"
                  value={form.confirmNewPin}
                  disabled={!hasLegacyAccount && !otp.verified}
                  onChange={(e) => setForm({ ...form, confirmNewPin: e.target.value.replace(/\D/g, '').slice(0, PIN_MAX) })}
                  placeholder="Confirm your PIN"
                  maxLength={PIN_MAX}
                  className={field}
                />
              </div>

              <div className="flex gap-3 pt-1">
                <button type="button" onClick={onClose} disabled={creating} className={`${btnGhost} flex-1`}>Cancel</button>
                <button
                  type="submit"
                  disabled={creating || !form.accountHolderName || !form.email || !form.phoneNumber || (!hasLegacyAccount && (!form.newPin || !form.confirmNewPin || !otp.verified))}
                  className="flex flex-1 items-center justify-center gap-2 rounded-sm border-2 border-[#14532d] bg-[#14532d] py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <CheckCircle2 className="h-4 w-4" /> {creating ? 'Saving…' : hasLegacyAccount ? 'Update account' : 'Create account'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

export default BusinessWalletAccessModal;
