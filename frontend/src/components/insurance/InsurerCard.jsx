import React, { useState } from 'react';
import { BadgeCheck, Clock, Globe, Languages, ShieldCheck } from 'lucide-react';
import { coverTypeLabel, formatIcan, periodLabel } from '../../utils/insuranceCatalog';
import { countryName } from '../../utils/franchise';
import { initials, isHttpsUrl } from '../../utils/insurerListing';

/**
 * One insurer as customers see it: licence and regulator up front, the promise it makes on claims, what it
 * covers and a few plans with prices. The public directory (landing page) and the live preview in the
 * insurer console render this same card from the same shape, so the preview is never a guess.
 * It has no buttons on purpose: the app's theme repaints every <button>.
 */
export default function InsurerCard({ insurer: c, dark = false, preview = false }) {
  const [logoBroken, setLogoBroken] = useState(false);
  const title = dark ? 'text-white' : 'text-slate-900';
  const body = dark ? 'text-slate-300' : 'text-slate-600';
  const faint = dark ? 'text-slate-400' : 'text-slate-500';
  const card = dark ? 'border-slate-700/50 bg-slate-900/70' : 'border-slate-200 bg-white';
  const chip = dark ? 'border-slate-600 text-slate-200' : 'border-slate-300 text-slate-700';
  const accent = dark ? 'text-teal-300' : 'text-teal-800';
  const showLogo = isHttpsUrl(c.logo_url, 300) && !logoBroken;
  const countries = [...new Set([c.country, ...(c.service_countries || [])].filter(Boolean))];

  return (
    <article className={`relative flex h-full flex-col gap-3 rounded-2xl border p-4 shadow-sm ${card}`} aria-label={`${c.name}, insurer`}>
      {preview && (
        <span className={`absolute right-3 top-3 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${chip}`}>Preview</span>
      )}
      <header className="flex items-start gap-3">
        {showLogo ? (
          <img src={c.logo_url} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setLogoBroken(true)}
            className="h-12 w-12 flex-none rounded-xl border border-slate-300/40 bg-white object-contain p-1" />
        ) : (
          <span aria-hidden="true" className={`flex h-12 w-12 flex-none items-center justify-center rounded-xl text-sm font-black ${dark ? 'bg-teal-300/15 text-teal-200' : 'bg-teal-100 text-teal-900'}`}>{initials(c.name)}</span>
        )}
        <div className="min-w-0 pr-14">
          <h3 className={`truncate text-base font-black leading-tight ${title}`}>{c.name}</h3>
          <p className={`mt-0.5 flex items-center gap-1 text-xs font-semibold ${accent}`}>
            <BadgeCheck className="h-3.5 w-3.5 flex-none" aria-hidden="true" />
            Licensed{c.regulator ? ` by ${c.regulator}` : ''}
          </p>
          {c.tagline && <p className={`mt-1 text-sm font-semibold leading-snug ${body}`}>{c.tagline}</p>}
        </div>
      </header>

      {c.about && <p className={`text-sm leading-relaxed ${body}`} style={{ display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{c.about}</p>}

      <ul className={`grid gap-1 text-xs ${faint}`}>
        {c.licence_number && <li className="flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5 flex-none" aria-hidden="true" />Licence {c.licence_number}</li>}
        {c.claims_decision_days != null && (
          <li className="flex items-center gap-1.5"><Clock className="h-3.5 w-3.5 flex-none" aria-hidden="true" />
            Claims decided within <b className={body}>{c.claims_decision_days} {c.claims_decision_days === 1 ? 'day' : 'days'}</b>{c.claims_hours ? ` · ${c.claims_hours}` : ''}
          </li>
        )}
        {countries.length > 0 && <li className="flex items-center gap-1.5"><Globe className="h-3.5 w-3.5 flex-none" aria-hidden="true" />{countries.map(countryName).join(', ')}</li>}
        {(c.languages || []).length > 0 && <li className="flex items-center gap-1.5"><Languages className="h-3.5 w-3.5 flex-none" aria-hidden="true" />{c.languages.join(', ')}</li>}
        {c.founded_year && <li>Since {c.founded_year}</li>}
      </ul>

      {(c.cover_types || []).length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Cover offered">
          {c.cover_types.map((t) => <li key={t} className={`rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${chip}`}>{coverTypeLabel(t)}</li>)}
        </ul>
      )}

      {(c.plans || []).length > 0 && (
        <ul className={`divide-y rounded-xl border text-sm ${dark ? 'divide-slate-700/60 border-slate-700/60' : 'divide-slate-200 border-slate-200'}`} aria-label="Plans">
          {c.plans.slice(0, 3).map((p) => (
            <li key={`${p.name}-${p.period_days}`} className="flex items-baseline justify-between gap-3 px-3 py-2">
              <span className={`min-w-0 truncate font-semibold ${title}`}>{p.name}<span className={`ml-1.5 text-xs font-normal ${faint}`}>{coverTypeLabel(p.cover_type)}</span></span>
              <span className={`flex-none text-right ${title}`}><b>{formatIcan(p.price_ican)}</b> <span className={`text-xs ${faint}`}>ICAN / {periodLabel(p.period_days)}</span></span>
            </li>
          ))}
        </ul>
      )}

      <footer className="mt-auto flex items-center justify-between gap-3 pt-1">
        <p className={`text-xs ${faint}`}>
          {c.plan_count > 0 ? <>{c.plan_count} {c.plan_count === 1 ? 'plan' : 'plans'}{c.from_price_ican != null && <> · from <b className={body}>{formatIcan(c.from_price_ican)} ICAN</b></>}</> : 'No plan on sale yet'}
        </p>
        {isHttpsUrl(c.website) && (
          <a href={c.website} target="_blank" rel="noopener noreferrer nofollow" className={`text-xs font-bold underline decoration-dotted ${accent}`}>Website</a>
        )}
      </footer>
    </article>
  );
}
