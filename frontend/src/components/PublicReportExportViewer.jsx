import React, { useEffect, useState } from 'react';
import { Lock, Mail, ShieldCheck, Loader, FileWarning, ChevronDown, ChevronRight } from 'lucide-react';
import {
  getReportExportShareAccess,
  verifyReportExportSharePassword,
  verifyReportExportShareEmail
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

// Same executive-summary computation as CMSSModule.jsx's computeReportsSummary
// (this page is a separate, unauthenticated bundle with no session/app state
// to import from, hence the small duplication) -- so a viewer following a
// share link sees the same Priority Highlights an admin sees in the
// Consolidated Report tab, not just a flat department dump.
const SEVERITY_RANK = { critical: 3, high: 2, medium: 1, low: 0 };
const computeSummary = (reports) => {
  const byStatus = { open: 0, in_review: 0, resolved: 0, closed: 0 };
  const bySeverity = { critical: 0, high: 0, medium: 0, low: 0 };
  reports.forEach((r) => {
    const status = String(r.status || 'open').toLowerCase();
    const severity = String(r.severity || 'medium').toLowerCase();
    if (status in byStatus) byStatus[status] += 1;
    if (severity in bySeverity) bySeverity[severity] += 1;
  });
  const highlights = reports
    .filter((r) => ['critical', 'high'].includes(String(r.severity || '').toLowerCase()) && !['resolved', 'closed'].includes(String(r.status || 'open').toLowerCase()))
    .sort((a, b) => {
      const rankDiff = (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0);
      if (rankDiff !== 0) return rankDiff;
      return new Date(b.created_at) - new Date(a.created_at);
    });
  return { total: reports.length, byStatus, bySeverity, highlights };
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
          {Array.isArray(report.attachments) && report.attachments.length > 0 && (
            <div className="mt-3 space-y-1">
              {report.attachments.map((file, index) => (
                <a
                  key={index}
                  href={file.file_url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs"
                  style={{ background: 'var(--rs-surface-alt)' }}
                >
                  📎 {file.file_name || 'Attached file'}
                </a>
              ))}
            </div>
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
  const [emailError, setEmailError] = useState('');

  // Each report's `attachments` is a JSONB array of {file_url, ...} whose
  // file_url may itself be an r2:// key -- resolveMediaValues only resolves
  // flat row fields, so attachments are flattened into one batch resolve
  // call and reassigned back in original order (same technique as
  // cmmsReportAccessService.js's resolveReportAttachments).
  const resolveAttachments = async (reports) => {
    const flat = [];
    reports.forEach((r) => (Array.isArray(r.attachments) ? r.attachments : []).forEach((a) => flat.push(a)));
    if (flat.length === 0) return reports;
    const resolved = await resolveMediaValues(flat, ['file_url']);
    let i = 0;
    return reports.map((r) => ({
      ...r,
      attachments: (Array.isArray(r.attachments) ? r.attachments : []).map(() => resolved[i++])
    }));
  };

  const applyOkResult = async (data) => {
    setCompanyName(data.company_name || '');
    setScopeLabel(data.scope_label || '');
    const resolved = await resolveAttachments(await resolveMediaValues(data.reports || [], ['photo_url']));
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

  const handleEmailSubmit = async (e) => {
    e.preventDefault();
    setEmailError('');
    setIsVerifying(true);
    const result = await verifyReportExportShareEmail(shareToken, email);
    setIsVerifying(false);

    if (!result.success || !result.data) {
      setEmailError('Something went wrong. Please try again.');
      return;
    }

    const { status: verifyStatus, ...rest } = result.data;
    if (verifyStatus === 'ok') {
      await applyOkResult(rest);
    } else {
      setEmailError('This email does not have access to these reports.');
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
        <p className="rs-text-muted text-sm mb-4">Enter your email address to view these reports.</p>
        <form onSubmit={handleEmailSubmit} className="space-y-3 text-left">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="rs-input w-full px-4 py-2 rounded-lg focus:outline-none"
            autoFocus
            required
          />
          {emailError && <p className="text-sm" style={{ color: 'var(--rs-maroon)' }}>{emailError}</p>}
          <button
            type="submit"
            disabled={isVerifying || !email}
            className="rs-btn w-full px-4 py-2 rounded-lg disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isVerifying ? <Loader size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
            View reports
          </button>
        </form>
      </CenteredCard>
    );
  }

  // status === 'ok'
  const groups = groupReports(reports);
  const summary = computeSummary(reports);
  const statLabels = { open: 'Open', in_review: 'In Review', resolved: 'Resolved', closed: 'Closed' };
  const severityLabels = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' };

  return (
    <div className="icanera-rs min-h-screen">
      <style>{RS_STYLES}</style>
      <div className="max-w-3xl mx-auto px-4 py-10">
        <p className="rs-text-faint text-xs uppercase tracking-wide mb-1">{companyName}</p>
        <h1 className="text-2xl font-bold mb-1">Written Employee Reports</h1>
        <p className="rs-text-muted text-sm mb-8">{scopeLabel} · {reports.length} report{reports.length === 1 ? '' : 's'}</p>

        {reports.length > 0 && (
          <div className="rs-surface rounded-2xl p-5 mb-6">
            <h2 className="text-sm font-bold mb-3">Executive Summary</h2>
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 mb-3">
              <div className="rounded-lg p-2 text-center" style={{ background: 'var(--rs-surface-alt)' }}>
                <div className="text-lg font-bold">{summary.total}</div>
                <div className="text-[10px] uppercase rs-text-faint">Total</div>
              </div>
              {Object.entries(statLabels).map(([key, label]) => (
                <div key={key} className="rounded-lg p-2 text-center" style={{ background: 'var(--rs-surface-alt)' }}>
                  <div className="text-lg font-bold">{summary.byStatus[key]}</div>
                  <div className="text-[10px] uppercase rs-text-faint">{label}</div>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-4 gap-2">
              {Object.entries(severityLabels).map(([key, label]) => (
                <div key={key} className="rounded-lg p-2 text-center" style={{ background: 'var(--rs-surface-alt)' }}>
                  <div className="text-lg font-bold" style={key === 'critical' || key === 'high' ? { color: 'var(--rs-maroon)' } : undefined}>{summary.bySeverity[key]}</div>
                  <div className="text-[10px] uppercase rs-text-faint">{label}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {summary.highlights.length > 0 && (
          <div className="rs-surface rounded-2xl p-5 mb-6" style={{ borderColor: 'var(--rs-maroon-soft-bg)' }}>
            <h2 className="text-sm font-bold mb-3">⚠ Priority Highlights <span className="font-normal rs-text-faint">({summary.highlights.length} needing attention)</span></h2>
            <div className="space-y-1.5">
              {summary.highlights.map((r, index) => (
                <div key={index} className="flex flex-wrap items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs" style={{ background: 'var(--rs-surface-alt)' }}>
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase" style={SEVERITY_STYLE[r.severity] || SEVERITY_STYLE.medium}>{r.severity}</span>
                  <span className="font-medium truncate">{r.report_title || 'Untitled report'}</span>
                  <span className="rs-text-faint ml-auto">{r.department_name || (r.department_id ? 'Department' : 'Unassigned')} · {r.reporter_name || 'Member'}</span>
                </div>
              ))}
            </div>
          </div>
        )}

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
