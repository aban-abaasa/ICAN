import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, Check, ClipboardList, ExternalLink, Globe, Paperclip, Search, Timer,
} from 'lucide-react';
import {
  COUNTRIES, MODES, computeCompliance, getBuiltInItems, groupByCategory, mergeItems, toComplianceData,
} from '../../utils/readinessCatalog';
import { parseSheetSource, rowsToRequirements } from '../../utils/googleLinks';
import {
  addLink, connectSheet, fetchSheetRows, isReadinessBackendMissing, listLinks, loadProgress, loadSettings,
  removeLink, saveItem, saveSettings,
} from '../../services/readinessService';
import GoogleSourceCard from './readiness/GoogleSourceCard';
import LinksCard from './readiness/LinksCard';
import FramePreview from './readiness/FramePreview';
import OfficesCard from './readiness/OfficesCard';
import { ScoreRing, Segmented } from './growth/parts';
import './growth/growth.css';

const googleSearchUrl = (item, country) =>
  `https://www.google.com/search?q=${encodeURIComponent([item.authority, item.title, country === 'Other' ? '' : country].filter(Boolean).join(' '))}`;

/**
 * Readiness (Global Navigator): a saved compliance checklist for your country and situation,
 * with extra requirements from a public Google Sheet, Google Forms you can fill in here,
 * and Drive files kept as evidence. `onComplianceData` mirrors the result to a host dashboard.
 */
export default function ReadinessPanel({ onComplianceData }) {
  const [country, setCountry] = useState('Uganda');
  const [mode, setMode] = useState('SE');
  const [progress, setProgress] = useState({}); // key -> { status, note }
  const [links, setLinks] = useState([]);
  const [sheet, setSheet] = useState({ url: null, rows: null, syncedAt: null, busy: false, error: '' });
  const [loading, setLoading] = useState(true);
  const [backendReady, setBackendReady] = useState(true);
  const [progressReady, setProgressReady] = useState(false);
  const [banner, setBanner] = useState('');
  const [preview, setPreview] = useState(null);
  const [linkFormOpen, setLinkFormOpen] = useState(false);
  const [attachTo, setAttachTo] = useState('');
  const linksRef = useRef(null);
  const loadedSelection = useRef(null);

  const failure = useCallback((err) => {
    if (isReadinessBackendMissing(err)) setBackendReady(false);
    else setBanner(err.message || 'Something went wrong. Please try again.');
  }, []);

  // Items = built-in guidance + whatever the connected public sheet adds for this country and mode.
  const sheetResult = useMemo(
    () => (sheet.rows ? rowsToRequirements(sheet.rows, { country, mode }) : { items: [], error: null }),
    [sheet.rows, country, mode],
  );
  const items = useMemo(() => mergeItems(getBuiltInItems(country, mode), sheetResult.items), [country, mode, sheetResult.items]);
  const statusMap = useMemo(() => Object.fromEntries(Object.entries(progress).map(([k, v]) => [k, v.status])), [progress]);
  const compliance = useMemo(() => computeCompliance(items, statusMap), [items, statusMap]);
  const groups = useMemo(() => groupByCategory(items), [items]);
  const nextRequired = items.find((i) => i.required && statusMap[i.key] !== 'done');

  // Initial load: remembered selection, the connected sheet, links.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [settings, linkRows] = await Promise.all([loadSettings(), listLinks()]);
        if (cancelled) return;
        setLinks(linkRows);
        if (settings) {
          setCountry(COUNTRIES.includes(settings.country) ? settings.country : 'Uganda');
          setMode(settings.mode === 'BO' ? 'BO' : 'SE');
          if (settings.sheet_url) {
            setSheet((s) => ({ ...s, url: settings.sheet_url, syncedAt: settings.sheet_synced_at, busy: true }));
            // Refresh from Google in the background; the saved checklist shows immediately.
            (async () => {
              try {
                const source = parseSheetSource(settings.sheet_url);
                if (!source.ok) throw new Error(source.reason);
                const { rows } = await fetchSheetRows(source.csvUrl);
                if (!cancelled) setSheet((s) => ({ ...s, rows, busy: false, error: '', syncedAt: new Date().toISOString() }));
              } catch (err) {
                if (!cancelled) setSheet((s) => ({ ...s, busy: false, error: err.message }));
              }
            })();
          }
        }
      } catch (err) {
        if (!cancelled) failure(err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [failure]);

  // Progress belongs to a country + mode: reload when either changes.
  useEffect(() => {
    if (loading || !backendReady) return undefined;
    const sel = `${country}|${mode}`;
    if (loadedSelection.current === sel) return undefined;
    let cancelled = false;
    loadedSelection.current = sel;
    setProgress({});
    setProgressReady(false);
    loadProgress(country, mode)
      .then((p) => { if (!cancelled) { setProgress(p); setProgressReady(true); } })
      .catch((err) => { if (!cancelled) failure(err); });
    return () => { cancelled = true; };
  }, [country, mode, loading, backendReady, failure]);

  // Remember the selection and the headline percentage (debounced, one small write).
  useEffect(() => {
    // Wait for the saved progress: saving the percentage earlier would overwrite it with 0.
    if (loading || !backendReady || !progressReady) return undefined;
    const timer = setTimeout(() => {
      saveSettings({ country, mode, compliance_percent: compliance.percent }).catch((err) => { if (isReadinessBackendMissing(err)) setBackendReady(false); });
    }, 700);
    return () => clearTimeout(timer);
  }, [country, mode, compliance.percent, loading, backendReady, progressReady]);

  useEffect(() => {
    if (onComplianceData && !loading) onComplianceData(toComplianceData(items, statusMap));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, statusMap, loading]);

  const setStatus = async (item, status) => {
    const previous = progress[item.key];
    setProgress((p) => ({ ...p, [item.key]: { ...(p[item.key] || {}), status } }));
    if (!backendReady) return;
    try { await saveItem({ country, mode, key: item.key, status }); } catch (err) {
      setProgress((p) => ({ ...p, [item.key]: previous || { status: 'todo' } }));
      failure(err);
    }
  };

  const doConnect = async (input) => {
    setSheet((s) => ({ ...s, busy: true, error: '' }));
    try {
      const result = await connectSheet(input, { country, mode });
      await saveSettings({ country, mode, sheet_url: result.storeUrl, sheet_synced_at: new Date().toISOString(), sheet_item_count: result.count });
      setSheet({ url: result.storeUrl, rows: result.rows, syncedAt: new Date().toISOString(), busy: false, error: '' });
    } catch (err) {
      if (isReadinessBackendMissing(err)) setBackendReady(false);
      setSheet((s) => ({ ...s, busy: false, error: err.message }));
    }
  };
  const doRefresh = async () => {
    await doConnect(sheet.url);
  };
  const doDisconnect = async () => {
    try {
      await saveSettings({ sheet_url: null, sheet_synced_at: null, sheet_item_count: null });
      setSheet({ url: null, rows: null, syncedAt: null, busy: false, error: '' });
    } catch (err) { failure(err); }
  };

  const doAddLink = async ({ url, title, itemKey }) => {
    const row = await addLink({ url, title, country, mode, itemKey });
    setLinks((l) => [row, ...l]);
  };
  const doRemoveLink = async (id) => {
    const previous = links;
    setLinks((l) => l.filter((x) => x.id !== id));
    try { await removeLink(id); } catch (err) { setLinks(previous); failure(err); }
  };

  const attachEvidence = (item) => {
    setAttachTo(item.key);
    setLinkFormOpen(true);
    requestAnimationFrame(() => linksRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const evidenceFor = (key) => links.filter((l) => l.item_key === key && (!l.country || l.country === country) && (!l.mode || l.mode === mode));

  return (
    <section className="gr" aria-label="Readiness">
      <header className="gr-card gr-hero">
        <div className="gr-hero__top">
          <ScoreRing value={compliance.percent} label="Readiness" />
          <div className="gr-hero__copy">
            <p className="gr-eyebrow">Global Navigator</p>
            <h2 className="gr-title">Readiness</h2>
            <p className="gr-small">{compliance.done} of {compliance.total} done</p>
            <p className="gr-nudge">
              {nextRequired ? <>Next required step: <b>{nextRequired.title}</b>.</> : 'Every required step is done. Keep your documents current.'}
            </p>
          </div>
        </div>
        <div className="gr-form">
          <Segmented label="Your situation" value={mode} onChange={setMode}
            options={Object.entries(MODES).map(([value, m]) => ({ value, label: m.short }))} />
          <div className="gr-field">
            <label className="gr-label" htmlFor="gr-country">Country</label>
            <select id="gr-country" className="gr-select" value={country} onChange={(e) => setCountry(e.target.value)}>
              {COUNTRIES.map((c) => <option key={c} value={c}>{c === 'Other' ? 'Other country (general guidance)' : c}</option>)}
            </select>
          </div>
          <div className="gr-progress" role="progressbar" aria-valuenow={compliance.percent} aria-valuemin={0} aria-valuemax={100} aria-label="Readiness progress"><i style={{ width: `${compliance.percent}%` }} /></div>
        </div>
      </header>

      {!backendReady && (
        <div className="gr-alert gr-alert--warn" role="status">
          <AlertTriangle aria-hidden="true" />
          <span>Saving is not switched on for this server yet, so ticks are not kept after you leave. An administrator needs to apply the readiness migration.</span>
        </div>
      )}
      {banner && <div className="gr-alert gr-alert--err" role="alert"><AlertTriangle aria-hidden="true" /><span>{banner}</span></div>}

      {loading ? (
        <><div className="gr-skel" /><div className="gr-skel" /></>
      ) : (
        groups.map((g) => (
          <section key={g.category} className="gr-form" aria-label={g.label}>
            <p className="gr-eyebrow">{g.label}</p>
            <div className="gr-list">
              {g.items.map((item) => {
                const status = statusMap[item.key] || 'todo';
                const done = status === 'done';
                const evidence = evidenceFor(item.key);
                return (
                  <article key={item.key} className={`gr-item ${done ? 'is-done' : ''}`}>
                    <button type="button" className="gr-tick" aria-pressed={done} onClick={() => setStatus(item, done ? 'todo' : 'done')}
                      aria-label={`${done ? 'Mark not done' : 'Mark done'}: ${item.title}`}>
                      <Check aria-hidden="true" />
                    </button>
                    <div style={{ minWidth: 0 }} className="gr-form">
                      <div>
                        <h4 className="gr-block__title" style={{ fontSize: '.98rem' }}><span>{item.title}</span></h4>
                        <div className="gr-block__meta" style={{ marginTop: 4 }}>
                          <span className="gr-chip">{item.required ? 'Required' : 'Recommended'}</span>
                          {item.authority && <span>{item.authority}</span>}
                          {item.source === 'sheet' && <span className="gr-chip gr-chip--ok">From your sheet</span>}
                          {status === 'in_progress' && <span className="gr-chip gr-chip--warn"><Timer aria-hidden="true" />Working on it</span>}
                        </div>
                      </div>
                      {item.why && <p className="gr-block__why">{item.why}</p>}
                      {evidence.length > 0 && (
                        <div className="gr-block__actions" aria-label="Evidence">
                          {evidence.map((l) => (
                            <button key={l.id} type="button" className="gr-chip" onClick={() => setPreview(l)} title="Open here">
                              <Paperclip aria-hidden="true" />{l.title}
                            </button>
                          ))}
                        </div>
                      )}
                      <div className="gr-block__actions" style={{ gap: 8 }}>
                        {!done && (
                          <button type="button" className="gr-btn gr-btn--ghost gr-btn--sm" onClick={() => setStatus(item, status === 'in_progress' ? 'todo' : 'in_progress')} aria-pressed={status === 'in_progress'}>
                            <Timer aria-hidden="true" />{status === 'in_progress' ? 'Not started' : 'Working on it'}
                          </button>
                        )}
                        <button type="button" className="gr-btn gr-btn--ghost gr-btn--sm" disabled={!backendReady} onClick={() => attachEvidence(item)}>
                          <Paperclip aria-hidden="true" />Attach evidence
                        </button>
                        {item.link && (
                          <a className="gr-btn gr-btn--ghost gr-btn--sm" href={item.link} target="_blank" rel="noopener noreferrer"><ExternalLink aria-hidden="true" />Official site</a>
                        )}
                        <a className="gr-btn gr-btn--ghost gr-btn--sm" href={googleSearchUrl(item, country)} target="_blank" rel="noopener noreferrer"><Search aria-hidden="true" />Search Google</a>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ))
      )}

      <div ref={linksRef}>
        <LinksCard links={links} items={items} backendReady={backendReady} defaultItemKey={attachTo} key={attachTo || 'general'}
          onAdd={doAddLink} onRemove={doRemoveLink} onPreview={setPreview} formOpen={linkFormOpen} setFormOpen={setLinkFormOpen} />
      </div>

      <GoogleSourceCard sheetUrl={sheet.url} syncedAt={sheet.syncedAt} count={sheetResult.items.length} note={sheet.rows ? sheetResult.error : null}
        busy={sheet.busy} error={sheet.error} backendReady={backendReady} onConnect={doConnect} onRefresh={doRefresh} onDisconnect={doDisconnect} />

      <OfficesCard items={items} country={country} />

      <p className="gr-hint" style={{ textAlign: 'center' }}>
        <ClipboardList aria-hidden="true" style={{ width: 14, height: 14, display: 'inline', marginRight: 6 }} />
        <Globe aria-hidden="true" style={{ width: 14, height: 14, display: 'inline', marginRight: 6 }} />
        Guidance only, not legal advice. Requirements and thresholds change, so confirm with the authority named on each item.
      </p>

      {preview && <FramePreview link={preview} onClose={() => setPreview(null)} />}
    </section>
  );
}
