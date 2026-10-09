import React, { useEffect, useRef, useState } from 'react';
import { ShieldCheck, LogOut } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useOptionalTheme } from '../../context/ThemeContext';
import { DiamondSpinner } from '../IcanDiamond';
import { getClassicAuthPalette, classicAuthClass } from './classicAuthTheme';
import './classicAuth.css';

const friendly = (err) => {
  const message = String(err?.message || '');
  if (/invalid|incorrect|expired/i.test(message)) return 'That code is not right, or it has expired. Check the latest code in your authenticator app.';
  if (/rate|too many|limit/i.test(message)) return 'Too many attempts. Wait a minute and try again.';
  return message || 'Verification failed. Please try again.';
};

/**
 * Shown after sign-in when the account has two-step verification and this session has
 * not yet entered a code. Nothing behind it renders until the code is accepted.
 */
export default function MfaChallenge() {
  const { verifyMfa, signOut, user } = useAuth();
  const { actualTheme } = useOptionalTheme();
  const palette = getClassicAuthPalette(actualTheme);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const submit = async (e) => {
    e?.preventDefault();
    const digits = code.replace(/\D/g, '');
    if (digits.length !== 6) { setError('Enter the 6-digit code from your authenticator app.'); return; }
    setBusy(true);
    setError('');
    try {
      await verifyMfa(digits);
    } catch (err) {
      setError(friendly(err));
      setCode('');
      setBusy(false);
      inputRef.current?.focus();
    }
  };

  return (
    <div className={`${classicAuthClass(actualTheme)} min-h-screen flex items-center justify-center px-4 py-8`} style={{ backgroundImage: palette.pageBg }}>
      <form
        onSubmit={submit}
        className="max-w-md w-full rounded-[30px] shadow-2xl p-8 border"
        style={{ backgroundColor: palette.cardBg, borderColor: palette.cardBorder, boxShadow: palette.cardShadow }}
        aria-labelledby="mfa-title"
      >
        <div className="text-center mb-6">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl flex items-center justify-center" style={{ backgroundImage: palette.primaryGradient, color: palette.primaryText, boxShadow: palette.primaryShadow }}>
            <ShieldCheck className="w-8 h-8" aria-hidden="true" />
          </div>
          <h2 id="mfa-title" className="text-2xl font-bold" style={{ color: palette.text }}>Verify with your authenticator app</h2>
          <p className="ia-kicker" style={{ color: palette.muted }}>Second step to protect your account</p>
        </div>

        <p className="text-sm text-center mb-5" style={{ color: palette.muted }}>
          Open your authenticator app and enter the 6-digit code for <b style={{ color: palette.text }}>{user?.email}</b>.
        </p>

        {error && (
          <div role="alert" className="mb-5 p-4 bg-red-500/10 border border-red-500/30 rounded-xl">
            <p className="text-red-400 text-sm text-center">{error}</p>
          </div>
        )}

        <label htmlFor="mfa-code" className="block text-sm font-medium mb-2" style={{ color: palette.label }}>Verification code</label>
        <input
          id="mfa-code"
          ref={inputRef}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, '').slice(0, 7))}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={7}
          placeholder="123 456"
          className={`w-full px-4 py-3 border rounded-xl text-center tracking-[0.4em] text-xl font-semibold focus:outline-none focus:ring-2 ${palette.inputPlaceholder}`}
          style={{ backgroundColor: palette.inputBg, borderColor: palette.inputBorder, color: palette.inputText, fontSize: 'max(16px, 1.25rem)' }}
        />

        <button
          type="submit"
          disabled={busy}
          className="mt-5 w-full py-3 px-4 font-semibold rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          style={{ backgroundImage: palette.primaryGradient, color: palette.primaryText, boxShadow: palette.primaryShadow }}
        >
          {busy ? (<><DiamondSpinner className="animate-spin w-5 h-5" />Checking…</>) : 'Verify and continue'}
        </button>

        <button
          type="button"
          onClick={() => signOut().catch(() => {})}
          className="mt-4 w-full py-2 text-sm flex items-center justify-center gap-2"
          style={{ color: palette.link }}
        >
          <LogOut className="w-4 h-4" aria-hidden="true" />Use a different account
        </button>
      </form>
    </div>
  );
}
