import React, { useState } from 'react';
import { Copy, Database, Loader2, RefreshCw, Unplug, Check } from 'lucide-react';
import { SHEET_TEMPLATE_HEADER } from '../../../utils/googleLinks';

/** Public data from Google: a published Google Sheet that adds requirements to the checklist. */
export default function GoogleSourceCard({ sheetUrl, syncedAt, count, note, busy, error, backendReady, onConnect, onRefresh, onDisconnect }) {
  const [url, setUrl] = useState('');
  const [copied, setCopied] = useState(false);

  const copyTemplate = async () => {
    try {
      await navigator.clipboard.writeText(SHEET_TEMPLATE_HEADER);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard unavailable: the header is shown on screen */ }
  };

  const submit = (e) => {
    e.preventDefault();
    if (url.trim()) onConnect(url);
  };

  return (
    <section className="gr-card gr-form" aria-label="Public data from Google">
      <div className="gr-status">
        <Database aria-hidden="true" />
        <div className="gr-status__body">
          <div className="gr-sectionhead">
            <h3 className="gr-title gr-h">Public data from Google</h3>
            {sheetUrl && <span className="gr-chip gr-chip--ok"><Check aria-hidden="true" />Connected</span>}
          </div>
          <p className="gr-sub">
            Keep your requirements in a Google Sheet that anyone can read, such as an official list from your authority, your accountant or your community.
            They appear in the checklist next to the built-in items and stay in step with the sheet.
          </p>
        </div>
      </div>

      {sheetUrl ? (
        <>
          <dl style={{ margin: 0 }}>
            <div className="gr-kv"><dt>Source</dt><dd style={{ fontWeight: 500, fontSize: '.78rem' }}>{(sheetUrl.split('/').find((part) => part.length > 20) || 'Google Sheet').slice(0, 14)}…</dd></div>
            <div className="gr-kv"><dt>Items for this country</dt><dd>{count ?? 0}</dd></div>
            <div className="gr-kv"><dt>Last refreshed</dt><dd>{syncedAt ? new Date(syncedAt).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : 'Not yet'}</dd></div>
          </dl>
          {note && <div className="gr-alert" role="note">{note}</div>}
          {error && <div className="gr-alert gr-alert--err" role="alert">{error}</div>}
          <div className="gr-grid2">
            <button type="button" className="gr-btn gr-btn--ghost" disabled={busy} onClick={onRefresh}>
              {busy ? <Loader2 className="gr-spin" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}Refresh
            </button>
            <button type="button" className="gr-btn gr-btn--danger" disabled={busy} onClick={onDisconnect}><Unplug aria-hidden="true" />Disconnect</button>
          </div>
        </>
      ) : (
        <form className="gr-form" onSubmit={submit} noValidate>
          <div className="gr-field">
            <label className="gr-label" htmlFor="gr-sheet-url">Google Sheet link</label>
            <input id="gr-sheet-url" className="gr-input" inputMode="url" autoComplete="off" autoCapitalize="off" spellCheck="false"
              placeholder="https://docs.google.com/spreadsheets/d/…" value={url} onChange={(e) => setUrl(e.target.value)} />
            <p className="gr-hint">Share it as &quot;Anyone with the link can view&quot;, or use File, Share, Publish to web, CSV.</p>
          </div>
          {error && <div className="gr-alert gr-alert--err" role="alert">{error}</div>}
          <button type="submit" className="gr-btn gr-btn--primary" disabled={busy || !backendReady || !url.trim()}>
            {busy ? <Loader2 className="gr-spin" aria-hidden="true" /> : <Database aria-hidden="true" />}Connect sheet
          </button>
          <details className="gr-fold">
            <summary><span className="gr-link">What should the sheet look like?</span></summary>
            <div className="gr-fold__body gr-form">
              <p className="gr-sub">The first row holds the column names. Only <b>title</b> is required. Leave country or mode blank for &quot;everyone&quot;.</p>
              <div className="gr-secret"><code>{SHEET_TEMPLATE_HEADER}</code>
                <button type="button" className="gr-icon-btn" onClick={copyTemplate} aria-label="Copy the header row">{copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}</button>
              </div>
              <p className="gr-hint">
                <b>mode</b> is SE (salaried) or BO (business owner). <b>category</b> is one of identity, tax, social, legal, health, finance.
                <b> required</b> is yes or no.
              </p>
            </div>
          </details>
        </form>
      )}
    </section>
  );
}
