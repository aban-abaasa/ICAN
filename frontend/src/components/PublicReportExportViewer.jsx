import React, { useEffect, useState } from 'react';
import { Lock, Mail, ShieldCheck, Loader, FileWarning, ArrowLeft, ChevronDown, ChevronRight } from 'lucide-react';
import {
  getReportExportShareAccess,
  verifyReportExportSharePassword,
  requestReportExportShareOtp,
  verifyReportExportShareOtp
} from '../services/cmmsReportShareService';
import { resolveMediaValues } from '../services/r2StorageService';

// Same scoped-palette technique as PublicReportViewer.jsx (see that file
// for the full reasoning): this page has no ICAN session and no app theme
// to inherit, so it owns its own light/dark palette instead of stock
// Tailwind color classes.
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

const CenteredCard = ({ icon: Icon, title, subtitle, children }) => (
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
      <h1 className="text-lg font-bold mb-1">{title}</h1>
      {subtitle && <p className="rs-text-muted text-sm mb-3">{subtitle}</p>}
      {children}
    </div>
  </div>
);

// Same Department -> Employee grouping as groupReportsByDeptAndReporter()
// in CMSSModule.jsx, working off the flat `reports` array the anon RPC
// returns instead of the authenticated cmmsData.reports list.
const groupReports = (reports) => {
  const deptMap = new Map();
  reports.forEach((r) => {
    const deptId = r.department_id || 'unassigned';
    const deptName = r.department_id ? (r.department_name || 'Unknown Department') : 'Unassigned / No Department';
    if (!deptMap.has(deptId)) deptMap.set(deptId, { deptName, reporters: new Map() });
    const deptEntry = deptMap.get(deptId);
    const reporterKey = r.reporter_name || r.reporter_role || 'unknown';
    const reporterName = r.reporter_name || 'Member';
    if (!deptEntry.reporters.has(reporterKey)) {
      deptEntry.reporters.set(reporterKey, { reporterKey, reporterName, reporterRole: r.reporter_role || '', reports: [] });
    }
    deptEntry.reporters.get(reporterKey).reports.push(r);
  });

  return Array.from(deptMap.entries())
    .map(([deptId, entry]) => ({
      deptId,
      deptName: entry.deptName,
      reporters: Array.from(entry.reporters.values()).sort((a, b) => a.reporterName.localeCompare(b.reporterName))
    }))
    .sort((a, b) => {
      if (a.deptId === 'unassigned') return 1;
      if (b.deptId === 'unassigned') return -1;
      return a.deptName.localeCompare(b.deptName);
    });
};

const ReportCard = ({ report }) => {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="rs-surface rounded-xl p-4">
      <button type="button" onClick={() => setExpanded((v) => !v)} className="w-full flex items-start justify-between gap-3 text-left">
        <div className="min-w-0">
          <p className="font-semibold truncate">{report.report_title || 'Untitled report'}</p>
          <p className="rs-text-faint text-xs mt-0.5">{new Date(report.created_at).toLocaleString()}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span
            className="px-2.5 py-1 rounded-full text-[11px] font-semibold"
            style={SEVERITY_STYLE[report.severity] || SEVERITY_STYLE.medium}
          >
            {String(report.severity || 'medium').toUpperCase()}
          </span>
          {expanded ? <ChevronDown size={16} className="rs-text-muted" /> : <ChevronRight size={16} className="rs-text-muted" />}
        </div>
      </button>
      {expanded && (
        <div className="mt-3 pt-3 border-t" style={{ borderColor: 'var(--rs-border)' }}>
          <p className="rs-text-muted text-xs mb-2">
            Category: {report.report_category || 'general'} · Status: {String(report.status || 'open').replace('_', ' ')}
          </p>
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{report.report_body}</p>
          {report.photo_url && (
            <img src={report.photo_url} alt="Report attachment" className="mt-3 max-w-xs rounded-lg border" style={{ borderColor: 'var(--rs-border)' }} />
          )}
        </div>
      )}
    </div>
  );
};

const PublicReportExportViewer = ({ shareToken }) => {
  const [status, setStatus] = useState('loading'); // loading | invalid | password_required | email_required | ok
  const [companyName, setCompanyName] = useState('');
  const [scopeLabel, setScopeLabel] = useState('');
  const [reports, setReports] = useState([]);

  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);

  const [email, setEmail] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [code, setCode] = useState('');
  const [otpError, setOtpError] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);
  const [otpMessage, setOtpMessage] = useState('');

  const applyOkResult = async (data) => {
    setCompanyName(data.company_name || '');
    setScopeLabel(data.scope_label || '');
    const resolved = await resolveMediaValues(data.reports || [], ['photo_url']);
    setReports(resolved);
    setStatus('ok');
  };

  useEffect(() => {
    (async () => {
      const result = await getReportExportShareAccess(shareToken);
      if (!result.success || !result.data) {
        setStatus('invalid');
        return;
      }
      const { status: accessStatus, ...rest } = result.data;
      if (accessStatus === 'ok') {
        await applyOkResult(rest);
      } else if (accessStatus === 'password_required' || accessStatus === 'email_required') {
        setCompanyName(rest.company_name || '');
        setScopeLabel(rest.scope_label || '');
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
    const result = await verifyReportExportSharePassword(shareToken, password);
    setIsVerifying(false);

    if (!result.success || !result.data) {
      setPasswordError('Something went wrong. Please try again.');
      return;
    }

    const { status: verifyStatus, ...rest } = result.data;
    if (verifyStatus === 'ok') {
      await applyOkResult(rest);
    } else if (verifyStatus === 'locked') {
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
    const result = await requestReportExportShareOtp(shareToken, email);
    setOtpMessage(result.message || 'If that email has access, a code has been sent.');
    setOtpSent(true);
    setResendCooldown(60);
  };

  const handleVerifyCode = async (e) => {
    e.preventDefault();
    setOtpError('');
    setIsVerifying(true);
    const result = await verifyReportExportShareOtp(shareToken, email, code);
    setIsVerifying(false);

    if (!result.success || !result.data) {
      setOtpError('Something went wrong. Please try again.');
      return;
    }

    const { status: verifyStatus, ...rest } = result.data;
    if (verifyStatus === 'ok') {
      await applyOkResult(rest);
    } else if (verifyStatus === 'invalid_code') {
      setOtpError('Incorrect code.');
    } else if (verifyStatus === 'too_many_attempts') {
      setOtpError('Too many attempts. Request a new code.');
    } else if (verifyStatus === 'no_active_code') {
      setOtpError('That code has expired. Request a new one.');
    } else {
      setOtpError('This email does not have access to these reports.');
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
          Ask whoever shared this with you for a new link.
        </p>
      </CenteredCard>
    );
  }

  if (status === 'password_required') {
    return (
      <CenteredCard icon={Lock} title="Password required" subtitle={`${companyName ? companyName + ' — ' : ''}${scopeLabel}`}>
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
            View reports
          </button>
        </form>
      </CenteredCard>
    );
  }

  if (status === 'email_required') {
    return (
      <CenteredCard icon={Mail} title="These reports are restricted" subtitle={`${companyName ? companyName + ' — ' : ''}${scopeLabel}`}>
        <p className="rs-text-muted text-sm mb-4">
          {otpSent ? 'Enter the code we emailed you.' : 'Enter your email address to request a viewing code.'}
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
              View reports
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
  const groups = groupReports(reports);

  return (
    <div className="icanera-rs min-h-screen">
      <style>{RS_STYLES}</style>
      <div className="max-w-3xl mx-auto px-4 py-10">
        <p className="rs-text-faint text-xs uppercase tracking-wide mb-1">{companyName}</p>
        <h1 className="text-2xl font-bold mb-1">Written Employee Reports</h1>
        <p className="rs-text-muted text-sm mb-8">{scopeLabel} · {reports.length} report{reports.length === 1 ? '' : 's'}</p>

        {groups.length === 0 ? (
          <div className="rs-surface rounded-2xl p-8 text-center rs-text-muted">No reports in this scope.</div>
        ) : (
          <div className="space-y-8">
            {groups.map((dept) => (
              <section key={dept.deptId}>
                <h2 className="text-base font-bold mb-3 px-1">{dept.deptName}</h2>
                <div className="space-y-5">
                  {dept.reporters.map((rep) => (
                    <div key={rep.reporterKey}>
                      <p className="rs-text-muted text-xs font-semibold mb-2 px-1">
                        {rep.reporterName}{rep.reporterRole ? ` — ${rep.reporterRole}` : ''} ({rep.reports.length})
                      </p>
                      <div className="space-y-2">
                        {rep.reports.map((report) => (
                          <ReportCard key={report.id} report={report} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}

        <footer className="text-center text-xs rs-text-faint pt-12 pb-6">
          Powered by <IcanEraWordmark />
        </footer>
      </div>
    </div>
  );
};

export default PublicReportExportViewer;
