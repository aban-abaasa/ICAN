import React, { useState } from 'react';
import { Loader, Wallet } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

// The two looks payment pages use: the dark storefront, the business website's own palette ("nb"),
// and the classic receipt page ("ptx").
const SKINS = {
  slate: {
    wrap: 'rounded-xl border border-emerald-700/40 bg-emerald-500/10 p-3 space-y-2.5',
    head: 'text-emerald-300', body: 'text-slate-300', faint: 'text-slate-500', err: 'text-xs text-red-400',
    google: 'w-full min-h-[44px] py-2.5 rounded-lg bg-white hover:bg-slate-100 text-slate-800 text-sm font-semibold transition flex items-center justify-center gap-2.5 disabled:opacity-60',
    link: 'text-xs text-slate-300 underline hover:text-white',
  },
  nb: {
    wrap: 'rounded-xl border nb-border nb-surface-alt p-3 space-y-2.5',
    head: 'nb-text', body: 'nb-text-muted', faint: 'nb-text-faint', err: 'nb-error-text text-xs',
    google: 'w-full min-h-[44px] py-2.5 rounded-xl bg-white text-slate-800 border border-slate-300 hover:bg-slate-50 text-sm font-semibold transition flex items-center justify-center gap-2.5 disabled:opacity-60',
    link: 'text-xs nb-link underline',
  },
  ptx: {
    wrap: 'ptx-callout ptx-alt',
    head: '', body: 'ptx-muted', faint: 'ptx-note', err: 'ptx-err',
    google: 'ptx-btn ptx-secondary',
    link: 'ptx-link',
  },
};

const GoogleG = () => (
  <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
    <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 8 3l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.6-.4-3.9z" />
    <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 8 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.4 6.3 14.7z" />
    <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
    <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z" />
  </svg>
);

/**
 * "Don't have an account? Get a free IcanEra wallet" — shown on every payment page to a visitor who is not
 * signed in. One tap on "Continue with Google" creates (or signs into) the account and brings them straight
 * back to the page they were on (AuthContext.signInWithGoogle returns to the exact path + query), so a
 * payment never has to be abandoned to sign up. Email sign-up stays one tap away.
 *
 *   skin            'slate' | 'nb' | 'ptx'  — which page palette to match
 *   pendingSection  optional: a business-website tab to reopen after the Google round-trip
 *   onUseEmail      optional: opens the email sign-up/sign-in form in place
 *   onBeforeRedirect optional: save anything held only in memory (a cart) before the page is left
 *   compact         just the button (and the email link) — for places that already explain why
 */
export default function ContinueWithGoogle({ skin = 'slate', pendingSection = null, onUseEmail = null, onBeforeRedirect = null, title = 'Use a free IcanEra wallet', compact = false, className = '' }) {
  const k = SKINS[skin] || SKINS.slate;
  const { signInWithGoogle } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const go = async () => {
    setError('');
    setBusy(true);
    try {
      if (pendingSection) sessionStorage.setItem('ican_notice_board_pending_section', pendingSection);
    } catch { /* private mode — the visitor just lands on the default tab */ }
    try { onBeforeRedirect?.(); } catch { /* never block sign-in on this */ }
    try {
      await signInWithGoogle();
      // The browser is leaving for Google; keep the button busy until it does.
    } catch (err) {
      setError(err?.message || 'Could not open Google. Please try again or use email.');
      setBusy(false);
    }
  };

  if (compact) {
    return (
      <div className={`space-y-2 ${className}`} data-testid="continue-with-google">
        <button type="button" onClick={go} disabled={busy} className={k.google}>
          {busy ? <Loader className="w-4 h-4 animate-spin" /> : <GoogleG />}
          {busy ? 'Opening Google…' : 'Continue with Google'}
        </button>
        {error && <p className={k.err} role="alert">{error}</p>}
        {onUseEmail && <p className={`text-center ${k.faint}`}><button type="button" onClick={onUseEmail} className={k.link}>Use email instead</button></p>}
      </div>
    );
  }

  return (
    <div className={`${k.wrap} ${className}`} data-testid="continue-with-google">
      <p className={`text-sm font-semibold flex items-center gap-2 ${k.head}`}><Wallet className="w-4 h-4" />{title}</p>
      <p className={`text-xs leading-relaxed ${k.body}`}>
        Recommended: your free wallet holds <b>icaneracoin</b> — one coin that works worldwide, <b>no payment fees</b>, every receipt in one place, and it lets you pay in instalments
        with the price locked from day one. No account yet? Continue with Google — a few seconds, and you come straight back here.
      </p>
      <button type="button" onClick={go} disabled={busy} className={k.google}>
        {busy ? <Loader className="w-4 h-4 animate-spin" /> : <GoogleG />}
        {busy ? 'Opening Google…' : 'Continue with Google'}
      </button>
      {error && <p className={k.err} role="alert">{error}</p>}
      {onUseEmail && (
        <p className={`text-center ${k.faint}`}>
          <button type="button" onClick={onUseEmail} className={k.link}>Use email instead</button>
        </p>
      )}
    </div>
  );
}
