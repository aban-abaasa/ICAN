import React, { useState } from 'react';
import {
  ClipboardPaste, ExternalLink, FileText, FolderOpen, HardDrive, Link2, Loader2, Plus, Presentation, Sheet, Trash2, ClipboardList, Eye,
} from 'lucide-react';
import { KIND_LABELS, classifyGoogleUrl, extractGoogleLink, isEmbeddable } from '../../../utils/googleLinks';
import { isDrivePickerConfigured, pickFromGoogleDrive } from '../../../services/googleDrivePicker';

const KIND_ICON = { form: ClipboardList, drive_file: FileText, drive_folder: FolderOpen, doc: FileText, sheet: Sheet, slides: Presentation };

/** Connect Google Forms and Drive files: fill forms here, keep evidence with the checklist. */
export default function LinksCard({ links, items, backendReady, defaultItemKey, onAdd, onRemove, onPreview, formOpen, setFormOpen }) {
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [itemKey, setItemKey] = useState(defaultItemKey || '');
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirmId, setConfirmId] = useState(null);

  const pickerReady = isDrivePickerConfigured();
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

  // A copied Google link usually arrives inside other words (a WhatsApp share, an email line).
  // Keep just the link so people never have to trim it by hand.
  const takeLinkFromText = (text) => {
    const found = extractGoogleLink(text);
    if (!found.ok) return false;
    setUrl(found.url);
    setError('');
    setNotice('');
    return true;
  };

  const onUrlPaste = (e) => {
    const text = e.clipboardData?.getData('text') || '';
    if (text.trim() && takeLinkFromText(text)) e.preventDefault();
  };

  const pasteFromClipboard = async () => {
    setError('');
    setNotice('');
    try {
      const text = await navigator.clipboard.readText();
      if (!takeLinkFromText(text)) setError('There is no Google link in what you copied. In Google Drive, open the file, choose Share, then Copy link.');
    } catch {
      setError('This browser did not allow reading your clipboard. Press and hold in the box and choose Paste.');
    }
  };

  // Choose files in Google's own picker (My Drive, Shared with me, or upload from this device)
  // and save a link for each one, tied to the checklist item chosen above.
  const browseDrive = async () => {
    setError('');
    setNotice('');
    setPicking(true);
    try {
      const picked = await pickFromGoogleDrive();
      const known = new Set(links.map((l) => l.url));
      let added = 0;
      let skipped = 0;
      const problems = [];
      for (const file of picked) {
        if (!file.link.ok) { problems.push(`${file.name || 'A file'}: ${file.link.reason}`); continue; }
        if (known.has(file.link.url)) { skipped += 1; continue; }
        try {
          // eslint-disable-next-line no-await-in-loop
          await onAdd({ url: file.link.url, title: file.name, itemKey: itemKey || null });
          known.add(file.link.url);
          added += 1;
        } catch (err) {
          problems.push(`${file.name || 'A file'}: ${err.message}`);
        }
      }
      if (problems.length) setError(problems.join(' '));
      if (added) {
        setNotice(`Added ${added} ${added === 1 ? 'file' : 'files'} from Google Drive.${skipped ? ` ${skipped} already connected.` : ''}`);
        if (!problems.length) { setTitle(''); setItemKey(''); setFormOpen(false); }
      } else if (skipped && !problems.length) {
        setNotice('That is already connected.');
      }
    } catch (err) {
      setError(err.message || 'Google Drive could not open. Paste a link instead.');
    }
    setPicking(false);
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

      {notice && <div className="gr-alert gr-alert--ok" role="status">{notice}</div>}

      {formOpen && (
        <form className="gr-form" onSubmit={submit} noValidate aria-label="Connect a Google link">
          <div className="gr-field">
            <label className="gr-label" htmlFor="gr-link-item">Attach to</label>
            <select id="gr-link-item" className="gr-select" value={itemKey} onChange={(e) => setItemKey(e.target.value)}>
              <option value="">General (not tied to an item)</option>
              {items.map((i) => <option key={i.key} value={i.key}>{i.title}</option>)}
            </select>
          </div>

          <div className="gr-field">
            <span className="gr-label">From Google Drive</span>
            {pickerReady ? (
              <>
                <button type="button" className="gr-btn gr-btn--primary gr-btn--block" onClick={browseDrive} disabled={picking || busy}>
                  {picking ? <Loader2 className="gr-spin" aria-hidden="true" /> : <HardDrive aria-hidden="true" />}Browse my Google Drive
                </button>
                <p className="gr-hint">
                  Works on your phone and your computer. Pick several files at once, or use the Upload tab to send a file from this device to Drive and get its link.
                  The app only sees the files you pick.
                </p>
              </>
            ) : (
              <>
                <a className="gr-btn gr-btn--ghost gr-btn--block" href="https://drive.google.com/drive/my-drive" target="_blank" rel="noopener noreferrer">
                  <HardDrive aria-hidden="true" />Open Google Drive
                </a>
                <p className="gr-hint">
                  In Drive, open the file and choose Share, then Copy link. Come back here and tap Paste. On a phone the Drive app does the same.
                </p>
              </>
            )}
          </div>

          <div className="gr-field">
            <label className="gr-label" htmlFor="gr-link-url">Or paste a Google link</label>
            <div className="gr-grid2" style={{ gridTemplateColumns: '1fr auto' }}>
              <input id="gr-link-url" className="gr-input" inputMode="url" autoComplete="off" autoCapitalize="off" spellCheck="false"
                placeholder="Paste a Google Forms or Drive link" value={url} onChange={(e) => setUrl(e.target.value)} onPaste={onUrlPaste} />
              <button type="button" className="gr-btn gr-btn--ghost" onClick={pasteFromClipboard} aria-label="Paste the copied link">
                <ClipboardPaste aria-hidden="true" />Paste
              </button>
            </div>
            {detected && (
              <p className="gr-hint" role="status" style={{ color: detected.ok ? 'var(--gr-ok)' : 'var(--gr-err)' }}>
                {detected.ok ? `${detected.label} recognised.${detected.embedUrl ? '' : ' It will open in Google.'}` : detected.reason}
              </p>
            )}
          </div>
          <div className="gr-field">
            <label className="gr-label" htmlFor="gr-link-title">Name (optional)</label>
            <input id="gr-link-title" className="gr-input" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Tax clearance scan" />
          </div>
          {error && <div className="gr-alert gr-alert--err" role="alert">{error}</div>}
          <div className="gr-grid2">
            <button type="button" className="gr-btn gr-btn--ghost" onClick={() => { setFormOpen(false); setError(''); }} disabled={busy || picking}>Cancel</button>
            <button type="submit" className="gr-btn gr-btn--primary" disabled={busy || picking || !detected?.ok}>
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
