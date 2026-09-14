import React, { useState, useEffect } from 'react';
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

  return (
    <div style={pageStyle} className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border p-6" style={{ background: 'var(--dp-card)', borderColor: 'var(--dp-card-bd)' }}>
        <h1 className="mb-1 text-lg font-black" style={{ color: 'var(--dp-txt)' }}>IcanEra Support Console</h1>

        {status === 'checking' && <p className="text-sm" style={{ color: 'var(--dp-muted)' }}>Loading…</p>}

        {status === 'invalid' && (
          <p className="text-sm text-rose-400">{error || 'This link is invalid or has been revoked.'}</p>
        )}

        {status === 'password_required' && (
          <>
            <p className="mb-5 text-sm" style={{ color: 'var(--dp-muted)' }}>Enter the password you were given for this link.</p>
            <form onSubmit={handlePasswordSubmit} className="space-y-2">
              {error && <p className="text-xs text-rose-400">{error}</p>}
              <input
                type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                placeholder="Password" autoFocus
                className="w-full rounded-xl border px-3 py-2 text-sm outline-none"
                style={{ background: 'var(--dp-input)', borderColor: 'var(--dp-input-bd)', color: 'var(--dp-txt)' }}
              />
              <button type="submit" disabled={verifyingPassword || !password.trim()}
                className="w-full rounded-xl py-2.5 text-sm font-semibold disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg,#14b8a6,#0f766e)', color: '#fff' }}>
                {verifyingPassword ? 'Checking…' : 'Enter'}
              </button>
            </form>
          </>
        )}

        {status === 'email_required' && !codeSent && (
          <>
            <p className="mb-5 text-sm" style={{ color: 'var(--dp-muted)' }}>Enter the Gmail address this link was shared with.</p>
            <form onSubmit={handleSendCode} className="space-y-2">
              {error && <p className="text-xs text-rose-400">{error}</p>}
              <input
                type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="you@gmail.com" autoFocus
                className="w-full rounded-xl border px-3 py-2 text-sm outline-none"
                style={{ background: 'var(--dp-input)', borderColor: 'var(--dp-input-bd)', color: 'var(--dp-txt)' }}
              />
              <button type="submit" disabled={sendingCode || !email.trim()}
                className="w-full rounded-xl py-2.5 text-sm font-semibold disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg,#14b8a6,#0f766e)', color: '#fff' }}>
                {sendingCode ? 'Sending…' : 'Send access code'}
              </button>
            </form>
          </>
        )}

        {status === 'email_required' && codeSent && (
          <>
            <p className="mb-5 text-sm" style={{ color: 'var(--dp-muted)' }}>
              If {email} has access, a 6-digit code was just emailed to it.
            </p>
            <form onSubmit={handleCodeSubmit} className="space-y-2">
              {error && <p className="text-xs text-rose-400">{error}</p>}
              <input
                type="text" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="6-digit code" autoFocus
                className="w-full rounded-xl border px-3 py-2 text-sm tracking-widest outline-none"
                style={{ background: 'var(--dp-input)', borderColor: 'var(--dp-input-bd)', color: 'var(--dp-txt)' }}
              />
              <button type="submit" disabled={verifyingCode || code.length !== 6}
                className="w-full rounded-xl py-2.5 text-sm font-semibold disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg,#14b8a6,#0f766e)', color: '#fff' }}>
                {verifyingCode ? 'Checking…' : 'Enter'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
};

export default SupportConsole;
