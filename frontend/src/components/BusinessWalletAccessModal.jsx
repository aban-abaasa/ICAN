import React, { useEffect, useRef, useState } from 'react';
import { KeyRound, Building2, CheckCircle2 } from 'lucide-react';
import { walletAccountService } from '../services/walletAccountService';
import { AccessShell, PinPad, Steps, LinkSent, field, label, panel, btnPrimary, btnGhost, linkBtn, PIN_MIN, PIN_MAX } from './WalletAccessModal';

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

  const linkState = { ...pinLink, loading: pinLink.loading || recheck.loading, error: recheck.note || pinLink.error };

  return (
    <AccessShell
      id="business-access-title"
      eyebrow="IcanEra Business Wallet"
      title="Wallet Access"
      subtitle={profile.business_name}
      onClose={onClose}
      z={200}
      tabs={[{ key: 'pin', label: 'I have a PIN' }, { key: 'about', label: hasWallet ? 'About this wallet' : 'Set up wallet' }]}
      tab={tab}
      onTab={setTab}
    >
      {justSet && <p role="status" className="wa-notice">✓ PIN set — your business wallet is ready.</p>}

      {/* ───────────── PIN tab ───────────── */}
      {tab === 'pin' && (
        checking ? (
          <p className="wa-p py-8 text-center italic">Consulting the ledger…</p>
        ) : hasPin ? (
          <form onSubmit={handleUnlock} autoComplete="off">
            <h3 className="wa-h">Business wallet PIN</h3>
            <p className="wa-p">Enter the PIN for {profile.business_name} to carry on.</p>
            {lockedNow && (
              <p role="alert" className="wa-alert">
                Too many wrong PINs — locked until {new Date(status.lockedUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.
              </p>
            )}
            {pinError && !lockedNow && <p role="alert" className="wa-alert">{pinError}</p>}
            <PinPad value={pin} onChange={setPin} disabled={unlocking || lockedNow} />
            <button type="submit" disabled={!canUnlock} className={`${btnPrimary} mt-5`}>{unlocking ? 'Checking…' : 'Unlock business wallet'}</button>
            <div className="mt-4 text-center"><button type="button" onClick={onForgotPin} className={linkBtn}>Forgot the PIN? Email me a reset link</button></div>
          </form>
        ) : (
          <div>
            <h3 className="wa-h flex items-center gap-2"><KeyRound className="h-4 w-4" style={{ color: 'var(--wa-gold)' }} /> No PIN on file yet</h3>
            <p className="wa-p">Only the business's highest-ownership shareholder can set the business wallet PIN.</p>
            {pinLink.sentTo ? (
              <div className="mt-4"><LinkSent pinLink={linkState} onSendLink={onSendLink} onContinue={handleContinue} /></div>
            ) : (
              <>
                <Steps />
                {pinLink.error && <p role="alert" className="wa-alert">{pinLink.error}</p>}
                <button type="button" disabled={pinLink.loading} onClick={onSendLink} className={`${btnPrimary} mt-5`}>
                  {pinLink.loading ? 'Sending link…' : 'Email me the PIN setup link'}
                </button>
                <p className="wa-small mt-2 text-center italic">The link goes to {userEmail || 'your sign-in email'}.</p>
              </>
            )}
          </div>
        )
      )}

      {/* ───────────── Second tab ───────────── */}
      {tab === 'about' && hasWallet && (
        <div>
          <h3 className="wa-h flex items-center gap-2"><Building2 className="h-4 w-4" style={{ color: 'var(--wa-gold)' }} /> {profile.business_name}</h3>
          <dl className="wa-ledger">
            <div><dt>Wallet</dt><dd className="break-all font-mono text-xs">{profile.ican_wallet.wallet_address || 'Business wallet'}</dd></div>
            <div><dt>Balance</dt><dd>{Number(profile.ican_wallet.ican_balance || 0).toLocaleString()} IcanEra</dd></div>
            <div><dt>PIN</dt><dd style={{ color: hasPin ? 'var(--wa-ok)' : 'var(--wa-gold-hi)' }}>{checking ? 'Checking…' : hasPin ? 'Set' : 'Not set yet'}</dd></div>
          </dl>
          <p className="wa-p mt-4">
            {hasPin
              ? 'Transfers and approvals from this wallet ask for the PIN. If it is lost, request a reset link by email.'
              : 'Set a PIN before making transactions from this wallet.'}
          </p>
          {hasPin && <button type="button" onClick={onForgotPin} className={`${btnGhost} mt-4 w-full`}>Reset the PIN by email</button>}
        </div>
      )}

      {tab === 'about' && !hasWallet && (
        <form onSubmit={onSubmit} className="space-y-4">
          <p className="wa-p" style={{ marginTop: 0 }}>
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
            <input id="bw-currency" type="text" value={localCurrencyLabel} readOnly className={field} />
          </div>

          {!hasLegacyAccount && (
            <div className={panel}>
              <h3 className="wa-h wa-h-sm flex items-center gap-2">
                Verify your email {otp.verified && <span className="inline-flex items-center gap-1 text-sm" style={{ color: 'var(--wa-ok)' }}><CheckCircle2 className="h-4 w-4" /> Verified</span>}
              </h3>
              {!otp.verified && (
                <>
                  <p className="wa-p mb-3">We'll email a 6-digit code to confirm this address before you set a PIN.</p>
                  {otp.error && <p className="wa-alert" style={{ marginTop: 0, marginBottom: '0.6rem' }}>{otp.error}</p>}
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
                      <button type="button" disabled={otp.loading} onClick={onVerifyCode} className="wa-btn wa-btn-primary">
                        {otp.loading ? '…' : 'Verify'}
                      </button>
                    </div>
                  )}
                  {otp.sent && <div className="mt-2"><button type="button" disabled={otp.loading} onClick={onSendCode} className={linkBtn}>Resend code</button></div>}
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
              className="wa-btn wa-btn-primary flex-1"
            >
              <CheckCircle2 className="h-4 w-4" /> {creating ? 'Saving…' : hasLegacyAccount ? 'Update account' : 'Create account'}
            </button>
          </div>
        </form>
      )}
    </AccessShell>
  );
};

export default BusinessWalletAccessModal;
