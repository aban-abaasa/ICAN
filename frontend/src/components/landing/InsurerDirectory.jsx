import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, ShieldCheck } from 'lucide-react';
import { insuranceService, isNotInstalled } from '../../services/insuranceService';
import { COVER_TYPES } from '../../utils/insuranceCatalog';
import { COUNTRIES } from '../../utils/franchise';
import { guessCountry } from '../../utils/insurerListing';
import InsurerCard from '../insurance/InsurerCard';

/**
 * The public directory of insurers on IcanEra: verified companies with a plan on sale, each with its licence,
 * regulator, claims promise and prices. No account is needed to browse (ins_public_directory). It opens on the
 * visitor's own country when that has insurers and quietly widens to everyone when it does not. If the insurance
 * programme is not installed on this server, the whole block stays out of the way.
 */
export default function InsurerDirectory({ dark = false, onGetStarted, onApply }) {
  const detected = useMemo(() => guessCountry(), []);
  const [country, setCountry] = useState(detected);
  const [coverType, setCoverType] = useState('');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState(undefined);       // undefined = loading
  const [error, setError] = useState('');
  const [hidden, setHidden] = useState(false);
  const [widened, setWidened] = useState(false);
  const touched = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        let list = await insuranceService.publicDirectory({ country: country || null, coverType: coverType || null, search: search.trim() || null });
        // Nobody listed in the visitor's own country yet: show everyone rather than an empty page.
        if (!cancelled && list.length === 0 && country && !touched.current) {
          list = await insuranceService.publicDirectory({ country: null, coverType: coverType || null, search: search.trim() || null });
          if (!cancelled && list.length > 0) { setWidened(true); setCountry(''); }
        }
        if (!cancelled) { setRows(list); setError(''); }
      } catch (e) {
        if (cancelled) return;
        if (isNotInstalled(e)) setHidden(true); else { setError(e.message); setRows([]); }
      }
    }, search ? 350 : 0);
    return () => { cancelled = true; clearTimeout(t); };
  }, [country, coverType, search]);

  if (hidden) return null;

  const title = dark ? 'text-white' : 'text-slate-900';
  const body = dark ? 'text-slate-400' : 'text-slate-600';
  const input = `rounded-lg border px-3 py-2.5 text-sm outline-none transition focus:ring-2 ${dark
    ? 'border-slate-600 bg-slate-950 text-white placeholder-slate-500 focus:ring-teal-300/50'
    : 'border-slate-300 bg-white text-slate-900 placeholder-slate-400 focus:ring-teal-600/40'}`;
  const chipOn = dark ? 'border-teal-300 bg-teal-300 text-slate-950' : 'border-teal-800 bg-teal-800 text-white';
  const chipOff = dark ? 'border-slate-600 text-slate-300' : 'border-slate-300 text-slate-700';
  const primaryBtn = dark ? 'bg-teal-300 text-slate-950 hover:bg-teal-200' : 'bg-teal-800 text-white hover:bg-teal-700';

  const pick = (setter) => (v) => { touched.current = true; setWidened(false); setRows(undefined); setter(v); };

  return (
    <div id="insurance-directory" className="scroll-mt-24">
      <div className="mb-5 text-center">
        <h3 className={`text-xl font-black md:text-2xl ${title}`}>Find a licensed insurer</h3>
        <p className={`mx-auto mt-1 max-w-2xl text-sm ${body}`}>Every company here is checked by ICAN support against its regulator before it is listed. Pay in ICAN, and claim from the same app.</p>
      </div>

      <div className="mb-4 grid gap-3 md:grid-cols-[1fr_2fr]">
        <select aria-label="Country" className={input} value={country} onChange={(e) => pick(setCountry)(e.target.value)}>
          <option value="">All countries</option>
          {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
        </select>
        <label className="relative block">
          <span className="sr-only">Search insurers by name</span>
          <Search className={`pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 ${body}`} aria-hidden="true" />
          <input type="search" className={`${input} w-full pl-9`} placeholder="Search by company name" maxLength={60} value={search} onChange={(e) => pick(setSearch)(e.target.value)} />
        </label>
      </div>
      <div className="mb-5 flex flex-wrap gap-2" role="group" aria-label="Kind of cover">
        {Object.entries(COVER_TYPES).map(([id, t]) => (
          <button key={id} type="button" aria-pressed={coverType === id} onClick={() => pick(setCoverType)(coverType === id ? '' : id)}
            className={`rounded-full border px-3.5 py-1.5 text-xs font-bold transition ${coverType === id ? chipOn : chipOff}`}>{t.label}</button>
        ))}
      </div>

      {widened && <p role="status" className={`mb-4 text-center text-xs ${body}`}>No insurer is listed in your country yet, so here is everyone. Choose a country above to narrow it down.</p>}
      {error && <p role="alert" className="mb-4 text-center text-sm font-semibold text-red-500">{error}</p>}

      {rows === undefined ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-hidden="true">
          {[0, 1, 2].map((i) => <div key={i} className={`h-64 animate-pulse rounded-2xl ${dark ? 'bg-slate-800' : 'bg-slate-100'}`} />)}
        </div>
      ) : rows.length === 0 ? (
        <div className={`rounded-2xl border p-8 text-center ${dark ? 'border-slate-700/50 bg-slate-900/60' : 'border-slate-200 bg-white'}`}>
          <ShieldCheck className={`mx-auto h-9 w-9 ${dark ? 'text-teal-300' : 'text-teal-800'}`} aria-hidden="true" />
          <h4 className={`mt-3 text-lg font-black ${title}`}>No insurer matches yet</h4>
          <p className={`mx-auto mt-1 max-w-md text-sm ${body}`}>Try another country or kind of cover. Are you a licensed insurer? You could be the first one listed here.</p>
          <button type="button" onClick={onApply} className={`mt-4 rounded-lg px-5 py-2.5 text-sm font-bold ${primaryBtn}`}>List my insurance company</button>
        </div>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {rows.map((r) => <InsurerCard key={r.insurer_id} insurer={r} dark={dark} />)}
          </div>
          <div className="mt-6 text-center">
            <button type="button" onClick={() => onGetStarted?.('signup')} className={`rounded-lg px-6 py-3 text-sm font-bold transition ${primaryBtn}`}>Create an account to get cover</button>
          </div>
        </>
      )}
    </div>
  );
}
