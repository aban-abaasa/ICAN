import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { getDataTerms, getDataConsentStatus, acceptDataTerms } from '../services/sectorMarketService';

// The data clause of the Terms & Conditions: businesses agree that anonymous, combined sales totals may be used to
// compute the sector index values traded on Sector Markets. The WORDING comes from the database
// (icanera_trading.data_terms_text, versioned) so what a business agrees to is exactly what is on record.
//
//  - <SectorDataTermsCheckbox> : the required tick when a business account is created
//  - <SectorDataTermsGate>     : asks existing businesses the same, once, until they answer
//
// Both render nothing when the feature is not installed, so they are safe to leave in place.

export function SectorDataTermsCheckbox({ checked, onChange, onTerms }) {
  const [terms, setTerms] = useState(null);

  useEffect(() => {
    let live = true;
    getDataTerms()
      .then((t) => { if (live) { setTerms(t); onTerms?.(t); } })
      .catch(() => { /* not installed or offline: nothing to agree to yet */ });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!terms) return null;
  return (
    <div className="mt-6 rounded-lg border border-slate-600 bg-slate-800/60 p-4" data-testid="sector-data-terms">
      <p className="text-sm font-semibold text-white">{terms.title}</p>
      <p className="mt-1 text-xs leading-relaxed text-slate-300">{terms.body}</p>
      <label className="mt-3 flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={!!checked}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-0.5 h-4 w-4 flex-shrink-0 accent-emerald-500"
        />
        <span className="text-sm text-slate-200">I have read and agree to this, as part of the Terms &amp; Conditions for creating a business account.</span>
      </label>
    </div>
  );
}

const dismissKey = (id, version) => `ican-sector-terms-later:${id}:${version}`;
const wasDismissed = (id, version) => { try { return sessionStorage.getItem(dismissKey(id, version)) === '1'; } catch { return false; } };
const remember = (id, version) => { try { sessionStorage.setItem(dismissKey(id, version), '1'); } catch { /* private window: it just asks again */ } };

export function SectorDataTermsGate({ profiles }) {
  const [pending, setPending] = useState(null); // { id, name }
  const [terms, setTerms] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0); // bumped after an answer, to look for the next business
  const key = (profiles || []).map((p) => p.id).join(',');

  useEffect(() => {
    let live = true;
    (async () => {
      const t = await getDataTerms().catch(() => null);
      if (!t || !live) { if (live) setPending(null); return; }
      for (const p of profiles || []) {
        if (!p?.id || wasDismissed(p.id, t.version)) continue;
        const status = await getDataConsentStatus(p.id).catch(() => null);  // null: not theirs to answer for, or not installed
        if (status && status.accepted === false) {
          if (live) { setTerms(t); setPending({ id: p.id, name: p.business_name || p.businessName || 'your business' }); }
          return;
        }
      }
      if (live) setPending(null);
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick]);

  const accept = useCallback(async () => {
    if (!pending || !terms) return;
    setBusy(true);
    setError('');
    const res = await acceptDataTerms(pending.id, terms.version).catch((e) => ({ success: false, error: e?.message }));
    setBusy(false);
    if (res?.success) { setPending(null); setTick((n) => n + 1); }
    else setError(res?.error || 'Could not save your answer. Please try again.');
  }, [pending, terms]);

  const later = useCallback(() => {
    if (pending && terms) remember(pending.id, terms.version);
    setPending(null);
    setTick((n) => n + 1);
  }, [pending, terms]);

  if (!pending || !terms) return null;
  // Rendered on <body> so the app's bottom navigation (its own stacking context) can never sit on top of the buttons.
  // The card is capped to the visible viewport (dvh follows the phone's address bar); only the text scrolls, so
  // "Not now" / "I agree" stay on screen on small and short phones, and clear of the gesture bar.
  return createPortal(
    <div
      className="fixed inset-0 z-[300] flex items-end justify-center bg-black/70 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sector-terms-title"
    >
      <div className="flex max-h-[92dvh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl border border-slate-700 bg-slate-900 shadow-xl sm:max-h-[85dvh] sm:rounded-2xl">
        <div className="flex-1 overflow-y-auto overscroll-contain px-4 pb-2 pt-4 sm:px-5 sm:pt-5">
          <h2 id="sector-terms-title" className="text-base font-bold leading-snug text-white sm:text-lg">{terms.title}</h2>
          <p className="mt-1 break-words text-xs text-slate-400">For {pending.name}</p>
          <p className="mt-3 text-[13px] leading-relaxed text-slate-200 sm:text-sm">{terms.body}</p>
          <p className="mt-3 text-xs leading-relaxed text-slate-400">Until you agree, {pending.name} is simply left out of these totals. Nothing else about your account changes.</p>
          {error && <p className="mt-3 text-sm text-red-400" role="alert">{error}</p>}
        </div>
        <div
          className="grid grid-cols-2 gap-2 border-t border-slate-700 bg-slate-900 px-4 pt-3 sm:px-5"
          style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom, 0px))' }}
        >
          <button type="button" onClick={later} disabled={busy} className="min-h-[44px] rounded-lg border border-slate-600 text-sm text-slate-300 hover:text-white">Not now</button>
          <button type="button" onClick={accept} disabled={busy} className="min-h-[44px] rounded-lg bg-emerald-600 text-sm font-bold text-white hover:bg-emerald-500 disabled:opacity-50">{busy ? 'Saving…' : 'I agree'}</button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default SectorDataTermsGate;
