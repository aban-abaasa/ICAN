import React, { useEffect, useState } from 'react';
import { X, Link2, Lock, Mail, Globe, Copy, Check, Trash2, Loader } from 'lucide-react';
import {
  createReportShare,
  listReportShares,
  revokeReportShare
} from '../services/cmmsReportShareService';

const VISIBILITY_OPTIONS = [
  { value: 'public', label: 'Public', icon: Globe, description: 'Anyone with the link can view this report.' },
  { value: 'password', label: 'Password-protected', icon: Lock, description: 'Anyone with the link and the password you set can view it.' },
  { value: 'restricted', label: 'Restricted to emails', icon: Mail, description: 'Only the email addresses you list can view it, after entering a code sent to them.' }
];

const shareUrlFor = (token) => `https://icanera.space/reports/${token}`;

const ShareReportModal = ({ report, onClose }) => {
  const [visibility, setVisibility] = useState('public');
  const [password, setPassword] = useState('');
  const [emailsText, setEmailsText] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState('');
  const [createdShare, setCreatedShare] = useState(null);
  const [copied, setCopied] = useState(false);

  const [shares, setShares] = useState([]);
  const [isLoadingShares, setIsLoadingShares] = useState(false);

  useEffect(() => {
    loadShares();
  }, [report.id]);

  const loadShares = async () => {
    setIsLoadingShares(true);
    const result = await listReportShares(report.id);
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

    setIsCreating(true);
    const result = await createReportShare(report.id, {
      visibility,
      password: visibility === 'password' ? password : null,
      allowedEmails: visibility === 'restricted' ? allowedEmails : null,
      expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null
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
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRevoke = async (shareId) => {
    if (!window.confirm('Revoke this link? Anyone using it will immediately lose access.')) return;
    const result = await revokeReportShare(shareId);
    if (result.success) {
      await loadShares();
    } else {
      alert('Failed to revoke: ' + result.error);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[2000] p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b">
          <div className="flex items-center gap-2">
            <Link2 size={20} className="text-blue-600" />
            <h3 className="text-lg font-bold text-gray-900">Share report</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={20} />
          </button>
        </div>

        <div className="p-5 space-y-5">
          <p className="text-sm text-gray-600 truncate">
            <strong>{report.report_title}</strong>
          </p>

          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-2">
              {VISIBILITY_OPTIONS.map(({ value, label, icon: Icon, description }) => (
                <label
                  key={value}
                  className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition ${
                    visibility === value ? 'border-blue-600 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <input
                    type="radio"
                    name="visibility"
                    value={value}
                    checked={visibility === value}
                    onChange={() => setVisibility(value)}
                    className="mt-1"
                  />
                  <Icon size={18} className="text-gray-500 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{label}</p>
                    <p className="text-xs text-gray-500">{description}</p>
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
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            )}

            {visibility === 'restricted' && (
              <textarea
                value={emailsText}
                onChange={(e) => setEmailsText(e.target.value)}
                placeholder="Email addresses, separated by commas or new lines"
                rows={3}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            )}

            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Expires (optional)</label>
              <input
                type="datetime-local"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <button
              type="submit"
              disabled={isCreating}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isCreating ? <Loader size={16} className="animate-spin" /> : <Link2 size={16} />}
              Create link
            </button>
          </form>

          {createdShare && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-3 flex items-center gap-2">
              <input
                readOnly
                value={shareUrlFor(createdShare.token)}
                className="flex-1 bg-transparent text-sm text-green-800 truncate outline-none"
              />
              <button
                onClick={() => handleCopy(createdShare.token)}
                className="shrink-0 flex items-center gap-1 text-sm text-green-700 hover:text-green-900"
              >
                {copied ? <Check size={16} /> : <Copy size={16} />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          )}

          <div className="border-t pt-4">
            <h4 className="text-sm font-bold text-gray-700 mb-2">Existing links</h4>
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
                    <div key={share.id} className="flex items-center justify-between text-sm p-2 rounded-lg bg-gray-50">
                      <div className="min-w-0">
                        <p className="font-medium text-gray-800 capitalize">
                          {share.visibility}
                          {isRevoked && <span className="ml-2 text-xs text-red-600">Revoked</span>}
                          {!isRevoked && isExpired && <span className="ml-2 text-xs text-orange-600">Expired</span>}
                        </p>
                        <p className="text-xs text-gray-500 truncate">
                          {share.view_count} view{share.view_count === 1 ? '' : 's'} · created{' '}
                          {new Date(share.created_at).toLocaleDateString()}
                        </p>
                      </div>
                      {!isRevoked && (
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            onClick={() => handleCopy(share.token)}
                            className="text-gray-500 hover:text-gray-700"
                            title="Copy link"
                          >
                            <Copy size={16} />
                          </button>
                          <button
                            onClick={() => handleRevoke(share.id)}
                            className="text-red-500 hover:text-red-700"
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

export default ShareReportModal;
