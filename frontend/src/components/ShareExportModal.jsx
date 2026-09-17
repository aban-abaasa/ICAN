import React, { useEffect, useState } from 'react';
import { X, Link2, Lock, Mail, Globe, Copy, Check, Trash2, Loader, ListChecks, LayoutList } from 'lucide-react';
import {
  createReportExportShare,
  listReportExportShares,
  revokeReportExportShare
} from '../services/cmmsReportShareService';

const VISIBILITY_OPTIONS = [
  { value: 'public', label: 'Public', icon: Globe, description: 'Anyone with the link can view these reports.' },
  { value: 'password', label: 'Password-protected', icon: Lock, description: 'Anyone with the link and the password you set can view them.' },
  { value: 'restricted', label: 'Restricted to emails', icon: Mail, description: 'Only the email addresses you list can view them, after entering a code sent to them.' }
];

const shareUrlFor = (token) => `https://icanera.space/report-exports/${token}`;

const severityDot = { critical: 'bg-red-500', high: 'bg-orange-500', medium: 'bg-yellow-500', low: 'bg-blue-500' };

// Opened from the "Export Reports" panel's Share button — shares the same
// department-scoped "Written Reports" set that panel's Download/Print
// buttons produce (see ReportsManager's reportDepartmentFilter /
// reportScopeLabel in CMSSModule.jsx), as a public page instead of a file.
// `reports` (the same filteredCompanyReports list already on screen) lets
// the admin instead hand-pick exactly which individual reports go into the
// link, rather than only ever sharing a whole department/employee's worth.
const ShareExportModal = ({ companyId, departmentFilter, scopeLabel, reportCount, reports = [], onClose }) => {
  const [visibility, setVisibility] = useState('public');
  const [password, setPassword] = useState('');
  const [emailsText, setEmailsText] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState('');
  const [createdShare, setCreatedShare] = useState(null);
  const [copiedToken, setCopiedToken] = useState('');

  // 'scope' = the existing department/employee-filtered set (default,
  // unchanged behavior). 'pick' = a hand-picked subset of `reports`.
  const [shareMode, setShareMode] = useState('scope');
  const [selectedReportIds, setSelectedReportIds] = useState(() => new Set());

  const toggleReportSelected = (id) => {
    setSelectedReportIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const selectAllReports = () => setSelectedReportIds(new Set(reports.map((r) => r.id)));
  const clearSelectedReports = () => setSelectedReportIds(new Set());

  const [shares, setShares] = useState([]);
  const [isLoadingShares, setIsLoadingShares] = useState(false);

  useEffect(() => {
    loadShares();
  }, [companyId]);

  const loadShares = async () => {
    setIsLoadingShares(true);
    const result = await listReportExportShares(companyId);
    if (result.success) setShares(result.data);
    setIsLoadingShares(false);
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    setError('');

    if (visibility === 'password' && password.trim().length < 4) {
      setError('Password must be at least 4 characters.');
      return;
    }

    const allowedEmails = emailsText
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean);

    if (visibility === 'restricted' && allowedEmails.length === 0) {
      setError('Add at least one email address.');
      return;
    }

    if (shareMode === 'pick' && selectedReportIds.size === 0) {
      setError('Select at least one report to share.');
      return;
    }

    setIsCreating(true);
    const result = await createReportExportShare(companyId, {
      // Picking specific reports is a hard filter on top of the scope, so
      // leave department/reporter at 'all' in that mode rather than also
      // applying the on-screen department filter a second time.
      departmentFilter: shareMode === 'pick' ? 'all' : departmentFilter,
      reporterFilter: 'all',
      visibility,
      password: visibility === 'password' ? password : null,
      allowedEmails: visibility === 'restricted' ? allowedEmails : null,
      expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
      reportIds: shareMode === 'pick' ? Array.from(selectedReportIds) : null
    });
    setIsCreating(false);

    if (!result.success) {
      setError(result.error || 'Failed to create share link.');
      return;
    }

    setCreatedShare(result.data);
    setPassword('');
    setEmailsText('');
    setExpiresAt('');
    await loadShares();
  };

  const handleCopy = (token) => {
    navigator.clipboard.writeText(shareUrlFor(token));
    setCopiedToken(token);
    setTimeout(() => setCopiedToken(''), 2000);
  };

  const handleRevoke = async (shareId) => {
    if (!window.confirm('Revoke this link? Anyone using it will immediately lose access.')) return;
    const result = await revokeReportExportShare(shareId);
    if (result.success) {
      await loadShares();
    } else {
      alert('Failed to revoke: ' + result.error);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[2000] p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-lg shadow-xl w-full max-w-xl max-h-[90vh] overflow-y-auto text-white">
        <div className="flex items-center justify-between p-5 border-b border-slate-700">
          <div className="flex items-center gap-2">
            <Link2 size={20} className="text-cyan-400" />
            <h3 className="text-lg font-bold">Share written reports</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-200">
            <X size={20} />
          </button>
        </div>

        <div className="p-5 space-y-5">
          <div className="flex gap-1 rounded-lg bg-slate-800/60 p-1">
            <button
              type="button"
              onClick={() => setShareMode('scope')}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${shareMode === 'scope' ? 'bg-cyan-600 text-white' : 'text-gray-300 hover:bg-white/10'}`}
            >
              <LayoutList size={14} />
              Everything in scope
            </button>
            <button
              type="button"
              onClick={() => setShareMode('pick')}
              disabled={reports.length === 0}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors disabled:opacity-40 ${shareMode === 'pick' ? 'bg-cyan-600 text-white' : 'text-gray-300 hover:bg-white/10'}`}
            >
              <ListChecks size={14} />
              Choose specific reports
            </button>
          </div>

          {shareMode === 'scope' ? (
            <p className="text-sm text-gray-400">
              Scope: <strong className="text-gray-200">{scopeLabel}</strong> — {reportCount} report{reportCount === 1 ? '' : 's'}
            </p>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm text-gray-400">
                  <strong className="text-gray-200">{selectedReportIds.size}</strong> of {reports.length} report{reports.length === 1 ? '' : 's'} selected
                </p>
                <div className="flex gap-2 text-xs">
                  <button type="button" onClick={selectAllReports} className="text-cyan-400 hover:text-cyan-300">Select all</button>
                  <button type="button" onClick={clearSelectedReports} className="text-gray-400 hover:text-gray-200">Clear</button>
                </div>
              </div>
              <div className="max-h-56 overflow-y-auto space-y-1 rounded-lg border border-slate-700 p-2">
                {reports.length === 0 ? (
                  <p className="text-sm text-gray-500 p-2">No reports available to pick from.</p>
                ) : (
                  reports.map((report) => (
                    <label
                      key={report.id}
                      className={`flex items-start gap-2 p-2 rounded-lg cursor-pointer transition ${selectedReportIds.has(report.id) ? 'bg-cyan-500/10' : 'hover:bg-white/5'}`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedReportIds.has(report.id)}
                        onChange={() => toggleReportSelected(report.id)}
                        className="mt-1"
                      />
                      <span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${severityDot[String(report.severity || 'medium').toLowerCase()] || severityDot.medium}`} />
                      <span className="min-w-0">
                        <span className="block text-sm text-gray-200 truncate">{report.report_title || 'Untitled report'}</span>
                        <span className="block text-xs text-gray-500 truncate">
                          {report.reporter_name || report.reporter_email || 'Member'} · {new Date(report.created_at).toLocaleDateString()}
                        </span>
                      </span>
                    </label>
                  ))
                )}
              </div>
            </div>
          )}

          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-2">
              {VISIBILITY_OPTIONS.map(({ value, label, icon: Icon, description }) => (
                <label
                  key={value}
                  className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition ${
                    visibility === value ? 'border-cyan-500 bg-cyan-500/10' : 'border-slate-700 hover:border-slate-500'
                  }`}
                >
                  <input
                    type="radio"
                    name="export-visibility"
                    value={value}
                    checked={visibility === value}
                    onChange={() => setVisibility(value)}
                    className="mt-1"
                  />
                  <Icon size={18} className="text-gray-400 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-semibold">{label}</p>
                    <p className="text-xs text-gray-400">{description}</p>
                  </div>
                </label>
              ))}
            </div>

            {visibility === 'password' && (
              <input
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Set a password (min. 4 characters)"
                className="w-full px-4 py-2 rounded-lg bg-slate-800 border border-slate-600 text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
              />
            )}

            {visibility === 'restricted' && (
              <textarea
                value={emailsText}
                onChange={(e) => setEmailsText(e.target.value)}
                placeholder="Email addresses, separated by commas or new lines"
                rows={3}
                className="w-full px-4 py-2 rounded-lg bg-slate-800 border border-slate-600 text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
              />
            )}

            <div>
              <label className="block text-xs font-semibold text-gray-400 mb-1">Expires (optional)</label>
              <input
                type="datetime-local"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                className="w-full px-4 py-2 rounded-lg bg-slate-800 border border-slate-600 text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
              />
            </div>

            {error && <p className="text-sm text-red-400">{error}</p>}

            <button
              type="submit"
              disabled={isCreating || (shareMode === 'pick' && selectedReportIds.size === 0)}
              className="w-full bg-cyan-600 hover:bg-cyan-500 text-white px-4 py-2 rounded-lg disabled:opacity-50 flex items-center justify-center gap-2 font-semibold"
            >
              {isCreating ? <Loader size={16} className="animate-spin" /> : <Link2 size={16} />}
              Create link
            </button>
          </form>

          {createdShare && (
            <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3 flex items-center gap-2">
              <input
                readOnly
                value={shareUrlFor(createdShare.token)}
                className="flex-1 bg-transparent text-sm text-green-300 truncate outline-none"
              />
              <button
                onClick={() => handleCopy(createdShare.token)}
                className="shrink-0 flex items-center gap-1 text-sm text-green-300 hover:text-green-100"
              >
                {copiedToken === createdShare.token ? <Check size={16} /> : <Copy size={16} />}
                {copiedToken === createdShare.token ? 'Copied' : 'Copy'}
              </button>
            </div>
          )}

          <div className="border-t border-slate-700 pt-4">
            <h4 className="text-sm font-bold text-gray-300 mb-2">Existing links for this company</h4>
            {isLoadingShares ? (
              <p className="text-sm text-gray-500">Loading...</p>
            ) : shares.length === 0 ? (
              <p className="text-sm text-gray-500">No share links yet.</p>
            ) : (
              <div className="space-y-2">
                {shares.map((share) => {
                  const isRevoked = !!share.revoked_at;
                  const isExpired = share.expires_at && new Date(share.expires_at) <= new Date();
                  return (
                    <div key={share.id} className="flex items-center justify-between text-sm p-2 rounded-lg bg-white/5">
                      <div className="min-w-0">
                        <p className="font-medium text-gray-200 capitalize">
                          {share.visibility}
                          {isRevoked && <span className="ml-2 text-xs text-red-400">Revoked</span>}
                          {!isRevoked && isExpired && <span className="ml-2 text-xs text-orange-400">Expired</span>}
                        </p>
                        <p className="text-xs text-gray-500 truncate">
                          {Array.isArray(share.report_ids) && share.report_ids.length > 0
                            ? `${share.report_ids.length} selected report${share.report_ids.length === 1 ? '' : 's'}`
                            : share.department_filter === 'all' ? 'All Departments' : share.department_filter === 'unassigned' ? 'Unassigned' : 'One department'}
                          {' · '}
                          {share.view_count} view{share.view_count === 1 ? '' : 's'} · created{' '}
                          {new Date(share.created_at).toLocaleDateString()}
                        </p>
                      </div>
                      {!isRevoked && (
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            onClick={() => handleCopy(share.token)}
                            className="text-gray-400 hover:text-gray-200"
                            title="Copy link"
                          >
                            <Copy size={16} />
                          </button>
                          <button
                            onClick={() => handleRevoke(share.id)}
                            className="text-red-400 hover:text-red-300"
                            title="Revoke"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ShareExportModal;
