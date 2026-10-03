import React, { useState } from 'react';
import {
  ExternalLink, FileText, FolderOpen, Link2, Loader2, Plus, Presentation, Sheet, Trash2, ClipboardList, Eye,
} from 'lucide-react';
import { KIND_LABELS, classifyGoogleUrl, isEmbeddable } from '../../../utils/googleLinks';

const KIND_ICON = { form: ClipboardList, drive_file: FileText, drive_folder: FolderOpen, doc: FileText, sheet: Sheet, slides: Presentation };

/** Connect Google Forms and Drive files: fill forms here, keep evidence with the checklist. */
export default function LinksCard({ links, items, backendReady, defaultItemKey, onAdd, onRemove, onPreview, formOpen, setFormOpen }) {
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [itemKey, setItemKey] = useState(defaultItemKey || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmId, setConfirmId] = useState(null);

  const detected = url.trim() ? classifyGoogleUrl(url) : null;

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    const c = classifyGoogleUrl(url);
    if (!c.ok) return setError(c.reason);
    setBusy(true);
    try {
      await onAdd({ url, title, itemKey: itemKey || null });
      setUrl(''); setTitle(''); setItemKey(''); setFormOpen(false);
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  };

  const itemTitle = (key) => items.find((i) => i.key === key)?.title;

  return (
    <section className="gr-card gr-form" aria-label="Forms and documents from Google">
      <div className="gr-sectionhead">
        <div>
          <p className="gr-eyebrow">Google Forms &amp; Drive</p>
          <h3 className="gr-title gr-h">Forms &amp; documents</h3>
        </div>
        <button type="button" className="gr-btn gr-btn--primary gr-btn--sm" disabled={!backendReady} onClick={() => setFormOpen(!formOpen)}>
          <Plus aria-hidden="true" />Connect
        </button>
      </div>
      <p className="gr-sub">
        Connect a Google Form to fill it in without leaving the app, or attach a certificate, receipt or application from Google Drive as evidence for a checklist item.
      </p>

      {formOpen && (
        <form className="gr-form" onSubmit={submit} noValidate aria-label="Connect a Google link">
          <div className="gr-field">
            <label className="gr-label" htmlFor="gr-link-url">Google link</label>
            <input id="gr-link-url" className="gr-input" inputMode="url" autoComplete="off" autoCapitalize="off" spellCheck="false"
              placeholder="Paste a Google Forms or Drive link" value={url} onChange={(e) => setUrl(e.target.value)} autoFocus />
            {detected && (
              <p className="gr-hint" role="status" style={{ color: detected.ok ? 'var(--gr-ok)' : 'var(--gr-err)' }}>
                {detected.ok ? `${detected.label} recognised.${detected.embedUrl ? '' : ' It will open in Google.'}` : detected.reason}
              </p>
            )}
          </div>
          <div className="gr-grid2">
            <div className="gr-field">
              <label className="gr-label" htmlFor="gr-link-title">Name (optional)</label>
              <input id="gr-link-title" className="gr-input" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Tax clearance scan" />
            </div>
            <div className="gr-field">
              <label className="gr-label" htmlFor="gr-link-item">Attach to</label>
              <select id="gr-link-item" className="gr-select" value={itemKey} onChange={(e) => setItemKey(e.target.value)}>
                <option value="">General (not tied to an item)</option>
                {items.map((i) => <option key={i.key} value={i.key}>{i.title}</option>)}
              </select>
            </div>
          </div>
          {error && <div className="gr-alert gr-alert--err" role="alert">{error}</div>}
          <div className="gr-grid2">
            <button type="button" className="gr-btn gr-btn--ghost" onClick={() => { setFormOpen(false); setError(''); }} disabled={busy}>Cancel</button>
            <button type="submit" className="gr-btn gr-btn--primary" disabled={busy || !detected?.ok}>
              {busy ? <Loader2 className="gr-spin" aria-hidden="true" /> : <Link2 aria-hidden="true" />}Connect
            </button>
          </div>
        </form>
      )}

      {links.length === 0 ? (
        <p className="gr-sub" style={{ textAlign: 'center', padding: '8px 0' }}>Nothing connected yet.</p>
      ) : (
        <div className="gr-list">
          {links.map((l) => {
            const Icon = KIND_ICON[l.kind] || FileText;
            const embeddable = isEmbeddable(l.url);
            return (
              <div key={l.id} className="gr-device">
                <span className="gr-device__icon"><Icon aria-hidden="true" /></span>
                <div style={{ minWidth: 0 }}>
                  <div className="gr-device__t" style={{ overflowWrap: 'anywhere' }}>{l.title}</div>
                  <div className="gr-device__m">
                    {KIND_LABELS[l.kind]}{l.item_key && itemTitle(l.item_key) ? ` · for "${itemTitle(l.item_key)}"` : ''}
                  </div>
                </div>
                {confirmId === l.id ? (
                  <div className="gr-block__actions">
                    <button type="button" className="gr-btn gr-btn--ghost gr-btn--sm" onClick={() => setConfirmId(null)}>Keep</button>
                    <button type="button" className="gr-btn gr-btn--danger gr-btn--sm" onClick={() => { onRemove(l.id); setConfirmId(null); }}>Remove</button>
                  </div>
                ) : (
                  <div className="gr-block__actions">
                    {embeddable && (
                      <button type="button" className="gr-icon-btn" onClick={() => onPreview(l)} aria-label={`${l.kind === 'form' ? 'Fill in' : 'Preview'} ${l.title}`} title={l.kind === 'form' ? 'Fill in here' : 'Preview'}>
                        <Eye aria-hidden="true" />
                      </button>
                    )}
                    <a className="gr-icon-btn" href={l.url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${l.title} in Google`} title="Open in Google"><ExternalLink aria-hidden="true" /></a>
                    <button type="button" className="gr-icon-btn gr-icon-btn--danger" onClick={() => setConfirmId(l.id)} aria-label={`Remove ${l.title}`} title="Remove"><Trash2 aria-hidden="true" /></button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      <p className="gr-hint">Only the link is saved in your account. Your files stay in your Google Drive, shared the way you set them.</p>
    </section>
  );
}
