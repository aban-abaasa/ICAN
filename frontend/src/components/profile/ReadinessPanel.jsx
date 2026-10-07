import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, Check, ClipboardList, ExternalLink, Paperclip, Search, Shield, ShieldCheck, Timer,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { loadAllCovers } from '../../services/insuranceService';
import { coveredBy } from '../../utils/insuranceCatalog';
import InsuranceHub from '../insurance/InsuranceHub';
import useResumeAndBusiness from '../../hooks/useResumeAndBusiness';
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

const countryFrom = (text) => COUNTRIES.find((c) => c !== 'Other' && new RegExp(c, 'i').test(text || '')) || null;

const googleSearchUrl = (item, country) =>
  `https://www.google.com/search?q=${encodeURIComponent([item.authority, item.title, country === 'Other' ? '' : country].filter(Boolean).join(' '))}`;

/**
 * Readiness (Global Navigator): a saved compliance checklist for your country and situation,
 * with extra requirements from a public Google Sheet, Google Forms you can fill in here,
 * and Drive files kept as evidence. `onComplianceData` mirrors the result to a host dashboard.
 * Personal details come from My Resume and business details from the Pitchin business profile:
 * they pre-select your country and situation on a first visit and flag steps already recorded there.
 * `onOpenResume` (optional) adds an "Edit my resume" link.
 */
export default function ReadinessPanel({ onComplianceData, onOpenResume }) {
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
  const [tab, setTab] = useState('checklist'); // checklist | insurance
  const [covers, setCovers] = useState([]);
  const [coversLoading, setCoversLoading] = useState(true);
  const [openCats, setOpenCats] = useState(null); // null = only the group holding the next required step
  const [toolsOpen, setToolsOpen] = useState(false);
  const { user, getDisplayName } = useAuth();
  const { resume, resumeLoaded, businesses, businessLoaded } = useResumeAndBusiness(user?.id);
  const [businessId, setBusinessId] = useState(null);
  const business = businesses.find((b) => b.id === businessId) || businesses[0] || null;
  const hadSavedSettings = useRef(false);
  const defaultsApplied = useRef(false);
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
  const savedStatus = useMemo(() => Object.fromEntries(Object.entries(progress).map(([k, v]) => [k, v.status])), [progress]);

  // Insurance items are ticked from the cover the person (or their businesses) actually holds, never by hand.
  const refreshCovers = useCallback(async () => {
    if (!user?.id) { setCoversLoading(false); return; }
    try { setCovers(await loadAllCovers(user.id)); } catch { setCovers([]); }
    setCoversLoading(false);
  }, [user?.id]);
  useEffect(() => { refreshCovers(); }, [refreshCovers]);

  const statusMap = useMemo(() => {
    const merged = { ...savedStatus };
    items.forEach((i) => { if (coveredBy(i, covers)) merged[i.key] = 'done'; });
    return merged;
  }, [savedStatus, items, covers]);
  const insuranceItems = useMemo(() => items.filter((i) => i.covers), [items]);
  const insuranceOpen = insuranceItems.filter((i) => !coveredBy(i, covers)).length;
  const compliance = useMemo(() => computeCompliance(items, statusMap), [items, statusMap]);
  const groups = useMemo(() => groupByCategory(items), [items]);
  const nextRequired = items.find((i) => i.required && statusMap[i.key] !== 'done');

  // Steps your Pitchin business profile already answers (business owners only).
  const detectedFor = (item) => {
    if (mode !== 'BO' || !business) return null;
    if (/-bo-register$/.test(item.key) && business.registration_number) return `Registration no. ${business.registration_number}`;
    if (/-bo-(tin|pin|tax)$/.test(item.key) && business.tax_id) return `Tax ID ${business.tax_id}`;
    return null;
  };

  // Initial load: remembered selection, the connected sheet, links.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [settings, linkRows] = await Promise.all([loadSettings(), listLinks()]);
        if (cancelled) return;
        setLinks(linkRows);
        if (settings) {
          hadSavedSettings.current = true;
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

  // First visit only: start from the country and situation your resume / business profile already imply.
  useEffect(() => {
    if (loading || !resumeLoaded || !businessLoaded || defaultsApplied.current) return;
    defaultsApplied.current = true;
    if (hadSavedSettings.current) return;
    const guess = countryFrom(businesses[0]?.country) || countryFrom(resume?.location);
    if (businesses.length > 0) setMode('BO');
    if (guess) setCountry(guess);
  }, [loading, resumeLoaded, businessLoaded, businesses, resume]);

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
    setToolsOpen(true);
    requestAnimationFrame(() => linksRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const evidenceFor = (key) => links.filter((l) => l.item_key === key && (!l.country || l.country === country) && (!l.mode || l.mode === mode));

  const defaultOpen = useMemo(() => new Set(nextRequired ? [nextRequired.category] : []), [nextRequired]);
  const isCatOpen = (category) => (openCats ? openCats.has(category) : defaultOpen.has(category));
  const toggleCat = (category, open) => {
    if (open === isCatOpen(category)) return;
    setOpenCats((prev) => {
      const next = new Set(prev || defaultOpen);
      if (open) next.add(category); else next.delete(category);
      return next;
    });
  };

  // Business owners see the Pitchin business profile; salaried people see their resume.
  const detailRows = (mode === 'BO'
    ? (business ? [
      ['Business', business.business_name],
      ['Registration no.', business.registration_number],
      ['Tax ID', business.tax_id],
      ['Address', [business.business_address, business.country].filter(Boolean).join(', ')],
      ['Status', business.verification_status],
    ] : [])
    : [
      ['Name', getDisplayName?.()],
      ['Phone', resume?.phone],
      ['Location', resume?.location],
      ['Headline', resume?.headline],
    ]).filter(([, v]) => v);
  const detailsLoaded = mode === 'BO' ? businessLoaded : resumeLoaded;

  return (
    <section className="gr rd" aria-label="Readiness">
      <header className="rd-head">
        <ScoreRing value={compliance.percent} label="Readiness" />
        <div className="gr-hero__copy">
          <p className="gr-eyebrow">Global Navigator</p>
          <h2 className="gr-title">Readiness</h2>
          <p className="gr-small">{compliance.done} of {compliance.total} done</p>
          <p className="gr-nudge">
            {nextRequired ? <>Next required step: <b>{nextRequired.title}</b>.</> : 'Every required step is done. Keep your documents current.'}
          </p>
        </div>
      </header>

      <div className="rd-pick">
        <Segmented label="Your situation" value={mode} onChange={setMode}
          options={Object.entries(MODES).map(([value, m]) => ({ value, label: m.short }))} />
        <select id="gr-country" aria-label="Country" className="gr-select" value={country} onChange={(e) => setCountry(e.target.value)}>
          {COUNTRIES.map((c) => <option key={c} value={c}>{c === 'Other' ? 'Other country (general guidance)' : c}</option>)}
        </select>
      </div>

      <div className="gr-tabs" role="tablist" aria-label="Readiness sections" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
        <button type="button" role="tab" className="gr-tab" aria-selected={tab === 'checklist'} onClick={() => setTab('checklist')}>
          <ClipboardList aria-hidden="true" />Checklist
        </button>
        <button type="button" role="tab" className="gr-tab" aria-selected={tab === 'insurance'} onClick={() => setTab('insurance')}>
          <Shield aria-hidden="true" />Insurance
          {insuranceOpen > 0 && <span className="gr-badge" aria-label={`${insuranceOpen} not covered`}>{insuranceOpen}</span>}
        </button>
      </div>

      {!backendReady && (
        <div className="gr-alert gr-alert--warn" role="status">
          <AlertTriangle aria-hidden="true" />
          <span>Saving is not switched on for this server yet, so ticks are not kept after you leave. An administrator needs to apply the readiness migration.</span>
        </div>
      )}
      {banner && <div className="gr-alert gr-alert--err" role="alert"><AlertTriangle aria-hidden="true" /><span>{banner}</span></div>}

      {tab === 'insurance' && (
        <InsuranceHub items={insuranceItems} covers={covers} coversLoading={coversLoading} onCoversChanged={refreshCovers} />
      )}

      {tab === 'checklist' && (<>
      <details className="rd-sec">
        <summary>{mode === 'BO' ? 'Your business' : 'Your details'}<span className="rd-note">{mode === 'BO' ? 'from Pitchin' : 'from your resume'}</span></summary>
        <div className="rd-body">
          {!detailsLoaded ? (
            <p className="gr-hint">Loading…</p>
          ) : detailRows.length > 0 ? (
            <>
              {mode === 'BO' && businesses.length > 1 && (
                <select aria-label="Business" className="gr-select" value={business?.id || ''} onChange={(e) => setBusinessId(e.target.value)}>
                  {businesses.map((b) => <option key={b.id} value={b.id}>{b.business_name}</option>)}
                </select>
              )}
              {detailRows.map(([label, value]) => (
                <div key={label} className="rd-line"><span className="gr-label">{label}</span><span>{value}</span></div>
              ))}
            </>
          ) : (
            <p className="gr-hint">
              {mode === 'BO' ? 'No business profile yet. Create one in Pitchin and its details appear here.' : 'No resume details yet. Add them to your resume and they appear here.'}
            </p>
          )}
          {mode === 'SE' && onOpenResume && <button type="button" className="rd-link" onClick={onOpenResume}>{resume ? 'Edit my resume' : 'Create my resume'}</button>}
        </div>
      </details>

      {loading ? (
        <><div className="gr-skel" /><div className="gr-skel" /></>
      ) : (
        groups.map((g) => {
          const doneCount = g.items.filter((i) => statusMap[i.key] === 'done').length;
          return (
            <details key={g.category} className="rd-sec" open={isCatOpen(g.category)} onToggle={(e) => toggleCat(g.category, e.currentTarget.open)}>
              <summary>{g.label}<span className="rd-note">{doneCount}/{g.items.length}</span></summary>
              <div className="rd-body">
                {g.items.map((item) => {
                  const status = statusMap[item.key] || 'todo';
                  const done = status === 'done';
                  const auto = coveredBy(item, covers);
                  const evidence = evidenceFor(item.key);
                  const detected = !done ? detectedFor(item) : null;
                  return (
                    <article key={item.key} className={`rd-item ${done ? 'is-done' : ''}`}>
                      <button type="button" className="gr-tick" aria-pressed={done} disabled={!!auto} onClick={() => setStatus(item, done ? 'todo' : 'done')}
                        title={auto ? 'Ticked from your active insurance' : undefined}
                        aria-label={auto ? `Covered: ${item.title}` : `${done ? 'Mark not done' : 'Mark done'}: ${item.title}`}>
                        <Check aria-hidden="true" />
                      </button>
                      <div className="rd-item__main">
                        <h4 className="rd-item__title">{item.title}</h4>
                        <div className="gr-block__meta">
                          <span className="gr-chip">{item.required ? 'Required' : 'Recommended'}</span>
                          {item.source === 'sheet' && <span className="gr-chip gr-chip--ok">From your sheet</span>}
                          {auto && <span className="gr-chip gr-chip--ok"><ShieldCheck aria-hidden="true" />Covered by {auto.insurer}</span>}
                          {status === 'in_progress' && <span className="gr-chip gr-chip--warn"><Timer aria-hidden="true" />Working on it</span>}
                          {evidence.map((l) => (
                            <button key={l.id} type="button" className="gr-chip" onClick={() => setPreview(l)} title="Open here">
                              <Paperclip aria-hidden="true" />{l.title}
                            </button>
                          ))}
                        </div>
                        {detected && (
                          <p className="rd-found">
                            Found in your Pitchin profile: {detected}.{' '}
                            <button type="button" className="rd-link" onClick={() => setStatus(item, 'done')}>Mark done</button>
                          </p>
                        )}
                        <details className="rd-more">
                          <summary>Details</summary>
                          {item.authority && <p className="gr-block__why">Ask: {item.authority}</p>}
                          {item.why && <p className="gr-block__why">{item.why}</p>}
                          <div className="gr-block__actions" style={{ gap: 8 }}>
                            {item.covers && !auto && (
                              <button type="button" className="gr-btn gr-btn--primary gr-btn--sm" onClick={() => setTab('insurance')}>
                                <Shield aria-hidden="true" />Find cover
                              </button>
                            )}
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
                        </details>
                      </div>
                    </article>
                  );
                })}
              </div>
            </details>
          );
        })
      )}

      <details className="rd-sec" open={toolsOpen} onToggle={(e) => setToolsOpen(e.currentTarget.open)}>
        <summary>Evidence, sheet and offices<span className="rd-note">{links.length} saved</span></summary>
        <div className="rd-body rd-tools">
          <div ref={linksRef}>
            <LinksCard links={links} items={items} backendReady={backendReady} defaultItemKey={attachTo} key={attachTo || 'general'}
              onAdd={doAddLink} onRemove={doRemoveLink} onPreview={setPreview} formOpen={linkFormOpen} setFormOpen={setLinkFormOpen} />
          </div>
          <GoogleSourceCard sheetUrl={sheet.url} syncedAt={sheet.syncedAt} count={sheetResult.items.length} note={sheet.rows ? sheetResult.error : null}
            busy={sheet.busy} error={sheet.error} backendReady={backendReady} onConnect={doConnect} onRefresh={doRefresh} onDisconnect={doDisconnect} />
          <OfficesCard items={items} country={country} />
        </div>
      </details>

      <p className="gr-hint" style={{ textAlign: 'center' }}>
        Guidance only, not legal advice. Confirm requirements with the authority named on each item.
      </p>
      </>)}

      {preview && <FramePreview link={preview} onClose={() => setPreview(null)} />}
    </section>
  );
}
