import React, { useState, useEffect } from 'react';
import { Shield, Lock, Mail, KeyRound, Eye, EyeOff, ArrowLeft, AlertTriangle, Loader2, ShieldAlert } from 'lucide-react';
import { getSupabaseClient } from '../lib/supabase/client';
import { ICANDevDashboard, DARK_VARS } from './ICANDevPanel';
import { PWAInstallButton } from './PWAInstallButton';

// Scoped alternative to the full ICANDevPanel, reachable at
// /support-console?key=<token> without needing the master DEV_TOKEN typed
// in by hand — see backend/SUPPORT_CONSOLE.sql. Mirrors the CMMS
// report-share link pattern (cmmsReportShareService.js /
// CMMS_REPORT_SHARING_SYSTEM.sql): a link is created in one of two modes —
// the developer sets a password, or the developer types in the allowed
// Gmail address(es) and the viewer proves it with a 6-digit code emailed to
// them. Either way, verifying hands back the same board token
// ICANDevDashboard's tabs already use internally, plus the admin-chosen
// allowed_tabs list — so this renders the exact same dashboard the dev
// panel does, just with its nav restricted to whichever tabs the admin
// picked for this particular link (a UI-level restriction only: every tab
// still calls the same DEV_TOKEN-gated RPCs underneath, so any tab beyond
// Messages/Public Board effectively hands out full dev-panel power — the
// admin sees that tradeoff spelled out when creating the link).
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

const getTokenFromUrl = () => {
  try {
    return new URLSearchParams(window.location.search).get('key') || '';
  } catch {
    return '';
  }
};

const SupportConsole = () => {
  const supabase = getSupabaseClient();
  const [token] = useState(getTokenFromUrl);
  const [status, setStatus] = useState('checking'); // checking | invalid | password_required | email_required | granted
  const [label, setLabel] = useState('');
  const [boardToken, setBoardToken] = useState(null);
  const [allowedTabs, setAllowedTabs] = useState(['messages', 'board']);
  const [error, setError] = useState('');

  const [password, setPassword] = useState('');
  const [verifyingPassword, setVerifyingPassword] = useState(false);

  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [verifyingCode, setVerifyingCode] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (resendIn <= 0) return undefined;
    const t = setTimeout(() => setResendIn(n => n - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  useEffect(() => {
    if (!token) { setStatus('invalid'); setError('This link is missing its access key.'); return; }
    if (!supabase) { setStatus('invalid'); return; }
    (async () => {
      const { data, error: err } = await supabase.rpc('support_get_link_access', { p_token: token });
      if (err || !data || data.status === 'invalid') {
        setStatus('invalid');
        setError('This link is invalid or has been revoked.');
        return;
      }
      setLabel(data.label || '');
      setStatus(data.status);
    })();
  }, [token, supabase]);

  const handlePasswordSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!password.trim() || verifyingPassword || !supabase) return;
    setVerifyingPassword(true);
    try {
      const { data, error: err } = await supabase.rpc('support_verify_link_password', { p_token: token, p_password: password.trim() });
      if (err || !data?.success) { setError(data?.error || err?.message || 'Could not verify.'); return; }
      setLabel(data.label || label);
      setBoardToken(data.board_token);
      if (Array.isArray(data.allowed_tabs) && data.allowed_tabs.length) setAllowedTabs(data.allowed_tabs);
      setStatus('granted');
    } finally {
      setVerifyingPassword(false);
    }
  };

  const handleSendCode = async (e) => {
    e.preventDefault();
    setError('');
    if (!email.trim() || sendingCode) return;
    setSendingCode(true);
    try {
      const res = await fetch(`${API_BASE_URL}/report-shares/request-support-link-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, email: email.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!data.success) { setError(data.message || 'Could not send the code.'); return; }
      setCodeSent(true);
      setCode('');
      setResendIn(30);
    } catch {
      setError('Could not reach the server. Please try again.');
    } finally {
      setSendingCode(false);
    }
  };

  const handleCodeSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!code.trim() || verifyingCode || !supabase) return;
    setVerifyingCode(true);
    try {
      const { data, error: err } = await supabase.rpc('support_verify_link_otp', { p_token: token, p_email: email.trim(), p_code: code.trim() });
      if (err || !data?.success) { setError(data?.error || err?.message || 'Could not verify.'); return; }
      setLabel(data.label || label);
      setBoardToken(data.board_token);
      if (Array.isArray(data.allowed_tabs) && data.allowed_tabs.length) setAllowedTabs(data.allowed_tabs);
      setStatus('granted');
    } finally {
      setVerifyingCode(false);
    }
  };

  if (status === 'granted' && boardToken) {
    return (
      <ICANDevDashboard
        visibleTabs={allowedTabs}
        headerExtra={(
          <>
            {label && <span className="hidden md:block text-[10px]" style={{ color: 'var(--dp-muted)' }}>{label}</span>}
            <PWAInstallButton />
          </>
        )}
        onExit={() => window.location.reload()}
      />
    );
  }

  const pageStyle = { ...DARK_VARS, background: 'var(--dp-bg)' };

  const inputWrap = 'relative';
  const inputCls = 'h-12 w-full rounded-xl border pl-11 pr-3 text-base outline-none transition focus:border-teal-500/70 focus:ring-2 focus:ring-teal-500/20';
  const inputStyle = { background: 'var(--dp-input)', borderColor: 'var(--dp-input-bd)', color: 'var(--dp-txt)' };
  const primaryBtn = 'flex h-12 w-full items-center justify-center gap-2 rounded-xl text-sm font-bold text-white transition active:scale-[0.98] disabled:opacity-50';
  const primaryStyle = { background: 'linear-gradient(135deg,#14b8a6,#0f766e)', boxShadow: '0 6px 20px #14b8a633' };

  const ErrorNote = () => error ? (
    <div role="alert" className="flex items-start gap-2 rounded-xl border px-3 py-2.5 text-xs text-rose-400"
      style={{ borderColor: 'rgba(244,63,94,0.3)', background: 'rgba(244,63,94,0.08)' }}>
      <AlertTriangle size={14} className="mt-px flex-shrink-0" />
      <span>{error}</span>
    </div>
  ) : null;

  const Spinner = ({ label }) => (<><Loader2 size={16} className="animate-spin" /> {label}</>);

  return (
    <div style={pageStyle} className="relative flex min-h-[100dvh] flex-col items-center justify-center overflow-hidden px-4 py-8 font-sans">
      {/* ambient glow, same as the dev console hero cards */}
      <div className="pointer-events-none absolute -top-24 -right-16 h-72 w-72 rounded-full opacity-[0.14] blur-3xl" style={{ background: '#14b8a6' }} />
      <div className="pointer-events-none absolute -bottom-24 -left-16 h-64 w-64 rounded-full opacity-[0.10] blur-3xl" style={{ background: '#06b6d4' }} />

      <div className="relative w-full max-w-sm">
        <div className="mb-7 text-center">
          <div className="relative mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-3xl"
            style={{ background: 'linear-gradient(135deg,#14b8a6,#0284c7)', boxShadow: '0 0 40px #14b8a655' }}>
            <Shield size={28} className="text-white" />
            <span className="absolute -right-1 -top-1 h-4 w-4 rounded-full border-2 bg-emerald-400" style={{ borderColor: '#07091a', boxShadow: '0 0 10px #10b981' }} />
          </div>
          <p className="text-[9px] font-bold uppercase tracking-[0.3em]" style={{ color: 'var(--dp-muted)' }}>IcanEra Capital</p>
          <h1 className="mt-1 text-2xl font-black" style={{ color: 'var(--dp-txt)' }}>Support Console</h1>
          {label && <p className="mt-1 text-xs" style={{ color: 'var(--dp-sub)' }}>{label}</p>}
        </div>

        <div className="rounded-3xl border p-5 sm:p-6" style={{ background: 'var(--dp-card)', borderColor: 'var(--dp-card-bd)', backdropFilter: 'blur(24px)' }}>

          {status === 'checking' && (
            <div className="flex flex-col items-center gap-3 py-6" role="status">
              <Loader2 size={26} className="animate-spin text-teal-500" />
              <p className="text-sm" style={{ color: 'var(--dp-muted)' }}>Checking your link…</p>
            </div>
          )}

          {status === 'invalid' && (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl border" style={{ background: 'rgba(244,63,94,0.1)', borderColor: 'rgba(244,63,94,0.3)' }}>
                <ShieldAlert size={22} className="text-rose-400" />
              </div>
              <p className="text-sm font-bold" style={{ color: 'var(--dp-txt)' }}>Link not available</p>
              <p className="text-xs leading-relaxed text-rose-400">{error || 'This link is invalid or has been revoked.'}</p>
              <p className="text-[11px] leading-relaxed" style={{ color: 'var(--dp-muted)' }}>Ask the IcanEra team to send you a fresh support link.</p>
            </div>
          )}

          {status === 'password_required' && (
            <form onSubmit={handlePasswordSubmit} className="space-y-3">
              <div>
                <p className="text-base font-bold" style={{ color: 'var(--dp-txt)' }}>Welcome back</p>
                <p className="mt-0.5 text-xs" style={{ color: 'var(--dp-muted)' }}>Enter the password you were given for this link.</p>
              </div>
              <ErrorNote />
              <div className={inputWrap}>
                <Lock size={16} className="absolute left-4 top-1/2 -translate-y-1/2" style={{ color: 'var(--dp-muted)' }} />
                <input
                  type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password" autoFocus autoComplete="current-password" aria-label="Password"
                  className={`${inputCls} pr-11`} style={inputStyle}
                />
                <button type="button" onClick={() => setShowPassword(v => !v)} aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-1.5 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg transition active:scale-90" style={{ color: 'var(--dp-muted)' }}>
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              <button type="submit" disabled={verifyingPassword || !password.trim()} className={primaryBtn} style={primaryStyle}>
                {verifyingPassword ? <Spinner label="Checking…" /> : 'Enter console'}
              </button>
            </form>
          )}

          {status === 'email_required' && !codeSent && (
            <form onSubmit={handleSendCode} className="space-y-3">
              <div>
                <p className="text-base font-bold" style={{ color: 'var(--dp-txt)' }}>Verify it&apos;s you</p>
                <p className="mt-0.5 text-xs" style={{ color: 'var(--dp-muted)' }}>Enter the Gmail address this link was shared with and we&apos;ll email you a 6-digit code.</p>
              </div>
              <ErrorNote />
              <div className={inputWrap}>
                <Mail size={16} className="absolute left-4 top-1/2 -translate-y-1/2" style={{ color: 'var(--dp-muted)' }} />
                <input
                  type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@gmail.com" autoFocus autoComplete="email" inputMode="email" aria-label="Email address"
                  className={inputCls} style={inputStyle}
                />
              </div>
              <button type="submit" disabled={sendingCode || !email.trim()} className={primaryBtn} style={primaryStyle}>
                {sendingCode ? <Spinner label="Sending…" /> : 'Send access code'}
              </button>
            </form>
          )}

          {status === 'email_required' && codeSent && (
            <form onSubmit={handleCodeSubmit} className="space-y-3">
              <button type="button" onClick={() => { setCodeSent(false); setCode(''); setError(''); }}
                className="-ml-1 flex items-center gap-1 rounded-lg px-1 py-1 text-xs font-semibold transition active:scale-95" style={{ color: 'var(--dp-sub)' }}>
                <ArrowLeft size={14} /> Change email
              </button>
              <div>
                <p className="text-base font-bold" style={{ color: 'var(--dp-txt)' }}>Check your inbox</p>
                <p className="mt-0.5 break-words text-xs" style={{ color: 'var(--dp-muted)' }}>
                  If {email} has access, a 6-digit code was just emailed to it.
                </p>
              </div>
              <ErrorNote />
              <div className={inputWrap}>
                <KeyRound size={16} className="absolute left-4 top-1/2 -translate-y-1/2" style={{ color: 'var(--dp-muted)' }} />
                <input
                  type="text" inputMode="numeric" autoComplete="one-time-code" value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000" autoFocus aria-label="6-digit code"
                  className={`${inputCls} text-center text-xl font-bold tracking-[0.5em]`} style={inputStyle}
                />
              </div>
              <button type="submit" disabled={verifyingCode || code.length !== 6} className={primaryBtn} style={primaryStyle}>
                {verifyingCode ? <Spinner label="Checking…" /> : 'Enter console'}
              </button>
              <button type="button" onClick={handleSendCode} disabled={sendingCode || resendIn > 0}
                className="w-full py-1.5 text-xs font-semibold transition disabled:opacity-60" style={{ color: 'var(--dp-sub)' }}>
                {sendingCode ? 'Sending…' : resendIn > 0 ? `Resend code in ${resendIn}s` : 'Resend code'}
              </button>
            </form>
          )}
        </div>

        <div className="mt-5 flex items-center justify-center gap-2 text-[11px]" style={{ color: 'var(--dp-muted)' }}>
          <Lock size={11} /> Secured access · IcanEra support team only
        </div>
        {(status === 'password_required' || status === 'email_required') && (
          <div className="mt-3 flex justify-center"><PWAInstallButton /></div>
        )}
      </div>
    </div>
  );
};

export default SupportConsole;
