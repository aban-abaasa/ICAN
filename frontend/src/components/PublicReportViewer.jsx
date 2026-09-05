import React, { useEffect, useState } from 'react';
import { Lock, Mail, ShieldCheck, Loader, FileWarning, ArrowLeft } from 'lucide-react';
import {
  getReportShareAccess,
  verifyReportSharePassword,
  requestReportShareOtp,
  verifyReportShareOtp
} from '../services/cmmsReportShareService';

// Scoped CSS variables, same technique as PublicCompanyNoticeBoard.jsx: this
// page must render correctly for a visitor with no ICAN account and no app
// theme preference, in both light and dark, without being caught by the
// app-wide dynamic theme repaint in ThemeContext.jsx — so it owns its own
// palette instead of using stock Tailwind color classes, and isn't wrapped
// in ThemeProvider/AuthProvider at all (see main.jsx).
const RS_STYLES = `
.icanera-rs {
  --rs-bg: #f6f9f7;
  --rs-surface: #ffffff;
  --rs-surface-alt: #eef3f0;
  --rs-text: #16211b;
  --rs-text-muted: #56675d;
  --rs-text-faint: #8a9a90;
  --rs-border: #dbe6de;
  --rs-green: #166534;
  --rs-green-hover: #114f28;
  --rs-green-soft-bg: #e3f3e8;
  --rs-green-soft-text: #166534;
  --rs-amber-soft-bg: #faf1da;
  --rs-amber-soft-text: #8a5a12;
  --rs-maroon: #7a1f2b;
  --rs-maroon-soft-bg: #f5e6e7;
  --rs-maroon-soft-text: #7a1f2b;
}
@media (prefers-color-scheme: dark) {
  .icanera-rs {
    --rs-bg: #0f1613;
    --rs-surface: #17211c;
    --rs-surface-alt: #202b24;
    --rs-text: #eef4f0;
    --rs-text-muted: #a9baaf;
    --rs-text-faint: #7c8d82;
    --rs-border: #2b3830;
    --rs-green: #4ade80;
    --rs-green-hover: #22c55e;
    --rs-green-soft-bg: #163524;
    --rs-green-soft-text: #86efac;
    --rs-amber-soft-bg: #3a2f13;
    --rs-amber-soft-text: #f4c86a;
    --rs-maroon: #e5828d;
    --rs-maroon-soft-bg: #3a1a1e;
    --rs-maroon-soft-text: #f3a9b0;
  }
}
.icanera-rs { background: var(--rs-bg); color: var(--rs-text); }
.rs-surface { background: var(--rs-surface); border: 1px solid var(--rs-border); }
.rs-text-muted { color: var(--rs-text-muted); }
.rs-text-faint { color: var(--rs-text-faint); }
.rs-input { background: var(--rs-surface-alt); border: 1px solid var(--rs-border); color: var(--rs-text); }
.rs-btn { background: var(--rs-green); color: #ffffff; }
.rs-btn:hover { background: var(--rs-green-hover); }
.rs-wordmark-a { color: var(--rs-green); }
.rs-wordmark-b { color: var(--rs-text); }
`;

const SEVERITY_STYLE = {
  critical: { background: 'var(--rs-maroon-soft-bg)', color: 'var(--rs-maroon-soft-text)' },
  high: { background: 'var(--rs-amber-soft-bg)', color: 'var(--rs-amber-soft-text)' },
  medium: { background: 'var(--rs-amber-soft-bg)', color: 'var(--rs-amber-soft-text)' },
  low: { background: 'var(--rs-green-soft-bg)', color: 'var(--rs-green-soft-text)' }
};

const IcanEraWordmark = () => (
  <span className="font-bold tracking-tight">
    <span className="rs-wordmark-a">Ican</span>
    <span className="rs-wordmark-b">Era</span>
  </span>
);

const CenteredCard = ({ icon: Icon, title, children }) => (
  <div className="icanera-rs min-h-screen flex items-center justify-center p-6">
    <style>{RS_STYLES}</style>
    <div className="rs-surface rounded-2xl shadow-sm p-8 w-full max-w-md text-center">
      {Icon && (
        <div
          className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4"
          style={{ background: 'var(--rs-surface-alt)' }}
        >
          <Icon className="w-7 h-7" style={{ color: 'var(--rs-green)' }} />
        </div>
      )}
      <h1 className="text-lg font-bold mb-2">{title}</h1>
      {children}
    </div>
  </div>
);

const PublicReportViewer = ({ shareToken }) => {
  const [status, setStatus] = useState('loading'); // loading | invalid | password_required | email_required | ok
  const [report, setReport] = useState(null);

  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [lockedUntil, setLockedUntil] = useState(null);
  const [isVerifying, setIsVerifying] = useState(false);

  const [email, setEmail] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [code, setCode] = useState('');
  const [otpError, setOtpError] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);
  const [otpMessage, setOtpMessage] = useState('');

  useEffect(() => {
    (async () => {
      const result = await getReportShareAccess(shareToken);
      if (!result.success || !result.data) {
        setStatus('invalid');
        return;
      }
      const { status: accessStatus, ...rest } = result.data;
      if (accessStatus === 'ok') {
        setReport(rest);
        setStatus('ok');
      } else if (accessStatus === 'password_required' || accessStatus === 'email_required') {
        setStatus(accessStatus);
      } else {
        setStatus('invalid');
      }
    })();
  }, [shareToken]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => setResendCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  const handlePasswordSubmit = async (e) => {
    e.preventDefault();
    setPasswordError('');
    setIsVerifying(true);
    const result = await verifyReportSharePassword(shareToken, password);
    setIsVerifying(false);

    if (!result.success || !result.data) {
      setPasswordError('Something went wrong. Please try again.');
      return;
    }

    const { status: verifyStatus, locked_until, ...rest } = result.data;
    if (verifyStatus === 'ok') {
      setReport(rest);
      setStatus('ok');
    } else if (verifyStatus === 'locked') {
      setLockedUntil(locked_until);
      setPasswordError('Too many attempts. Try again later.');
    } else if (verifyStatus === 'invalid_password') {
      setPasswordError('Incorrect password.');
    } else {
      setStatus('invalid');
    }
  };

  const handleSendCode = async (e) => {
    e.preventDefault();
    setOtpError('');
    const result = await requestReportShareOtp(shareToken, email);
    setOtpMessage(result.message || 'If that email has access, a code has been sent.');
    setOtpSent(true);
    setResendCooldown(60);
  };

  const handleVerifyCode = async (e) => {
    e.preventDefault();
    setOtpError('');
    setIsVerifying(true);
    const result = await verifyReportShareOtp(shareToken, email, code);
    setIsVerifying(false);

    if (!result.success || !result.data) {
      setOtpError('Something went wrong. Please try again.');
      return;
    }

    const { status: verifyStatus, ...rest } = result.data;
    if (verifyStatus === 'ok') {
      setReport(rest);
      setStatus('ok');
    } else if (verifyStatus === 'invalid_code') {
      setOtpError('Incorrect code.');
    } else if (verifyStatus === 'too_many_attempts') {
      setOtpError('Too many attempts. Request a new code.');
    } else if (verifyStatus === 'no_active_code') {
      setOtpError('That code has expired. Request a new one.');
    } else {
      setOtpError('This email does not have access to this report.');
    }
  };

  if (status === 'loading') {
    return (
      <div className="icanera-rs min-h-screen flex items-center justify-center">
        <style>{RS_STYLES}</style>
        <Loader className="w-8 h-8 animate-spin" style={{ color: 'var(--rs-green)' }} />
      </div>
    );
  }

  if (status === 'invalid') {
    return (
      <CenteredCard icon={FileWarning} title="This link is invalid or has expired">
        <p className="rs-text-muted text-sm">
          Ask whoever shared this report with you for a new link.
        </p>
      </CenteredCard>
    );
  }

  if (status === 'password_required') {
    return (
      <CenteredCard icon={Lock} title="Password required">
        <p className="rs-text-muted text-sm mb-4">Enter the password to view this report.</p>
        <form onSubmit={handlePasswordSubmit} className="space-y-3 text-left">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            className="rs-input w-full px-4 py-2 rounded-lg focus:outline-none"
            autoFocus
          />
          {passwordError && <p className="text-sm" style={{ color: 'var(--rs-maroon)' }}>{passwordError}</p>}
          <button
            type="submit"
            disabled={isVerifying || !password}
            className="rs-btn w-full px-4 py-2 rounded-lg disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isVerifying ? <Loader size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
            View report
          </button>
        </form>
      </CenteredCard>
    );
  }

  if (status === 'email_required') {
    return (
      <CenteredCard icon={Mail} title="This report is restricted">
        <p className="rs-text-muted text-sm mb-4">
          {otpSent
            ? 'Enter the code we emailed you.'
            : 'Enter your email address to request a viewing code.'}
        </p>

        {!otpSent ? (
          <form onSubmit={handleSendCode} className="space-y-3 text-left">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="rs-input w-full px-4 py-2 rounded-lg focus:outline-none"
              autoFocus
              required
            />
            <button type="submit" className="rs-btn w-full px-4 py-2 rounded-lg flex items-center justify-center gap-2">
              <Mail size={16} />
              Send code
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerifyCode} className="space-y-3 text-left">
            {otpMessage && <p className="rs-text-faint text-xs">{otpMessage}</p>}
            <input
              type="text"
              inputMode="numeric"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="6-digit code"
              className="rs-input w-full px-4 py-2 rounded-lg text-center tracking-[0.5em] focus:outline-none"
              autoFocus
            />
            {otpError && <p className="text-sm" style={{ color: 'var(--rs-maroon)' }}>{otpError}</p>}
            <button
              type="submit"
              disabled={isVerifying || code.length !== 6}
              className="rs-btn w-full px-4 py-2 rounded-lg disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isVerifying ? <Loader size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
              View report
            </button>
            <button
              type="button"
              onClick={handleSendCode}
              disabled={resendCooldown > 0}
              className="w-full text-xs rs-text-muted hover:underline disabled:opacity-50"
            >
              {resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : 'Resend code'}
            </button>
            <button
              type="button"
              onClick={() => { setOtpSent(false); setCode(''); setOtpError(''); }}
              className="w-full text-xs rs-text-faint flex items-center justify-center gap-1"
            >
              <ArrowLeft size={12} /> Use a different email
            </button>
          </form>
        )}
      </CenteredCard>
    );
  }

  // status === 'ok'
  return (
    <div className="icanera-rs min-h-screen">
      <style>{RS_STYLES}</style>
      <div className="max-w-2xl mx-auto px-4 py-10">
        <p className="rs-text-faint text-xs uppercase tracking-wide mb-1">{report.company_name}</p>
        <h1 className="text-2xl font-bold mb-3">{report.report_title}</h1>

        <div className="flex flex-wrap gap-2 mb-6">
          <span
            className="px-3 py-1 rounded-full text-xs font-semibold"
            style={SEVERITY_STYLE[report.severity] || SEVERITY_STYLE.medium}
          >
            {String(report.severity).toUpperCase()}
          </span>
          <span
            className="px-3 py-1 rounded-full text-xs font-semibold"
            style={{ background: 'var(--rs-surface-alt)', color: 'var(--rs-text-muted)' }}
          >
            {String(report.report_status).replace('_', ' ').toUpperCase()}
          </span>
          <span
            className="px-3 py-1 rounded-full text-xs font-semibold"
            style={{ background: 'var(--rs-surface-alt)', color: 'var(--rs-text-muted)' }}
          >
            {report.report_category}
          </span>
        </div>

        <div className="rs-surface rounded-2xl p-6 mb-6">
          <p className="whitespace-pre-wrap leading-relaxed">{report.report_body}</p>
        </div>

        <p className="rs-text-muted text-sm">
          Submitted by <strong>{report.reporter_name}</strong>
          {report.reporter_role ? ` (${report.reporter_role})` : ''} on{' '}
          {new Date(report.report_created_at).toLocaleDateString()}
        </p>

        <footer className="text-center text-xs rs-text-faint pt-12 pb-6">
          Powered by <IcanEraWordmark />
        </footer>
      </div>
    </div>
  );
};

export default PublicReportViewer;
