import React, { useEffect, useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { insuranceService } from '../../../services/insuranceService';
import { COUNTRIES, countryName } from '../../../utils/franchise';
import {
  LANGUAGE_SUGGESTIONS, listingFromInsurer, listingToPayload, toDirectoryCard, validateListing,
} from '../../../utils/insurerListing';
import { Switch } from '../../profile/growth/parts';
import { Alert } from '../common';
import InsurerCard from '../InsurerCard';

const Counter = ({ value, max }) => <p className="ip-count" aria-hidden="true">{String(value || '').length}/{max}</p>;

/**
 * "My listing": the public profile customers see in the directory, edited beside a live preview of the
 * very card they will see. Saved through ins_update_listing (owner or administrator only).
 */
export default function ListingEditor({ insurer, plans, dark, onSaved }) {
  const initial = useMemo(() => listingFromInsurer(insurer), [insurer]);
  const [f, setF] = useState(initial);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({ tone: '', text: '' });
  const [customLang, setCustomLang] = useState('');
  useEffect(() => { setF(initial); setErrors({}); }, [initial]);

  const canEdit = insurer.is_admin !== false && insurer.status !== 'rejected';
  const dirty = JSON.stringify(f) !== JSON.stringify(initial);
  const set = (patch) => { setF((cur) => ({ ...cur, ...patch })); setMsg({ tone: '', text: '' }); };
  const field = (k) => ({ id: `ls-${k}`, value: f[k], disabled: !canEdit, onChange: (e) => { set({ [k]: e.target.value }); if (errors[k]) setErrors((x) => ({ ...x, [k]: undefined })); } });
  const err = (k) => (errors[k] ? <p role="alert" className="gr-hint" style={{ color: 'var(--gr-err)' }}>{errors[k]}</p> : null);

  const addCountry = (code) => { if (code && !f.service_countries.includes(code)) set({ service_countries: [...f.service_countries, code] }); };
  const dropCountry = (code) => set({ service_countries: f.service_countries.filter((c) => c !== code) });
  const toggleLang = (l) => set({ languages: f.languages.includes(l) ? f.languages.filter((x) => x !== l) : [...f.languages, l] });
  const addLang = () => {
    const l = customLang.trim();
    if (l.length >= 2 && l.length <= 30 && !f.languages.includes(l) && f.languages.length < 12) set({ languages: [...f.languages, l] });
    setCustomLang('');
  };

  const preview = useMemo(() => toDirectoryCard({
    ...insurer, tagline: f.tagline.trim() || null, description: f.description.trim() || null, website: f.website.trim(), logo_url: f.logo_url.trim(),
    service_countries: f.service_countries, languages: f.languages, founded_year: f.founded_year === '' ? null : Number(f.founded_year),
    claims_decision_days: f.claims_decision_days === '' ? null : Number(f.claims_decision_days), claims_hours: f.claims_hours.trim() || null,
  }, plans), [insurer, plans, f]);

  const save = async () => {
    const v = validateListing(f);
    setErrors(v.errors);
    if (!v.ok) return setMsg({ tone: 'bad', text: 'Please fix the highlighted fields.' });
    setBusy(true);
    const res = await insuranceService.updateListing(insurer.insurer_id, listingToPayload(f));
    setBusy(false);
    if (res.success) { setMsg({ tone: 'ok', text: 'Listing saved.' }); onSaved?.(); } else setMsg({ tone: 'bad', text: res.error });
  };

  const free = COUNTRIES.filter((c) => !f.service_countries.includes(c.code));

  return (
    <div className="ip-split">
      <div className="gr-form">
        {insurer.hidden_by_support && <Alert tone="bad">Support has hidden your listing{insurer.hidden_note ? `: ${insurer.hidden_note}` : '.'} Fix this and contact support to be shown again.</Alert>}
        {!canEdit && <Alert tone="warn">Only an owner or administrator of the business can edit the listing.</Alert>}

        <section className="gr-card gr-form">
          <p className="gr-eyebrow">Who you are</p>
          <div className="gr-field"><label className="gr-label" htmlFor="ls-tagline">Tagline</label>
            <input className="gr-input" maxLength={120} placeholder="e.g. Claims paid in 5 days" {...field('tagline')} />
            <Counter value={f.tagline} max={120} />{err('tagline')}</div>
          <div className="gr-field"><label className="gr-label" htmlFor="ls-description">About your company</label>
            <textarea className="gr-textarea" rows={4} maxLength={500} placeholder="Who you insure, what you are known for, how you pay claims." {...field('description')} />
            <Counter value={f.description} max={500} />{err('description')}</div>
          <div className="gr-grid2">
            <div className="gr-field"><label className="gr-label" htmlFor="ls-website">Website</label>
              <input className="gr-input" type="url" maxLength={200} placeholder="https://…" {...field('website')} />{err('website')}</div>
            <div className="gr-field"><label className="gr-label" htmlFor="ls-logo_url">Logo image link</label>
              <input className="gr-input" type="url" maxLength={300} placeholder="https://…/logo.png" {...field('logo_url')} />{err('logo_url')}
              <p className="gr-hint">Square works best. Without one customers see your initials.</p></div>
          </div>
          <div className="gr-field"><label className="gr-label" htmlFor="ls-founded_year">Year founded</label>
            <input className="gr-input" type="number" inputMode="numeric" min="1800" max={new Date().getFullYear()} placeholder="e.g. 2009" {...field('founded_year')} />{err('founded_year')}</div>
        </section>

        <section className="gr-card gr-form">
          <p className="gr-eyebrow">What you promise on claims</p>
          <div className="gr-grid2">
            <div className="gr-field"><label className="gr-label" htmlFor="ls-claims_decision_days">Decision within (days)</label>
              <input className="gr-input" type="number" inputMode="numeric" min="1" max="90" placeholder="e.g. 5" {...field('claims_decision_days')} />{err('claims_decision_days')}
              <p className="gr-hint">Only promise what you keep: customers see this on your card.</p></div>
            <div className="gr-field"><label className="gr-label" htmlFor="ls-claims_hours">Claims hours</label>
              <input className="gr-input" maxLength={120} placeholder="Mon-Sat, 8am-6pm" {...field('claims_hours')} />{err('claims_hours')}</div>
          </div>
          <div className="gr-grid2">
            <div className="gr-field"><label className="gr-label" htmlFor="ls-claims_phone">Claims phone (shown to policyholders)</label>
              <input className="gr-input" type="tel" maxLength={30} {...field('claims_phone')} />{err('claims_phone')}</div>
            <div className="gr-field"><label className="gr-label" htmlFor="ls-contact_email">Contact email (private)</label>
              <input className="gr-input" type="email" maxLength={120} {...field('contact_email')} />{err('contact_email')}</div>
          </div>
          <div className="gr-field"><label className="gr-label" htmlFor="ls-contact_phone">Contact phone (private)</label>
            <input className="gr-input" type="tel" maxLength={30} {...field('contact_phone')} />{err('contact_phone')}
            <p className="gr-hint">Your contact email and phone are never shown in the public directory.</p></div>
        </section>

        <section className="gr-card gr-form">
          <p className="gr-eyebrow">Where and in which languages</p>
          <div className="gr-field">
            <span className="gr-label">Countries you serve (your licence country always counts)</span>
            <div className="ip-chips">
              {f.service_countries.map((c) => (
                <button key={c} type="button" className="gr-chip" disabled={!canEdit} onClick={() => dropCountry(c)} aria-label={`Remove ${countryName(c)}`}>{countryName(c)}<X aria-hidden="true" style={{ width: 12, height: 12, marginLeft: 4 }} /></button>
              ))}
            </div>
            <select className="gr-select" value="" disabled={!canEdit} aria-label="Add a country" onChange={(e) => addCountry(e.target.value)}>
              <option value="">Add a country…</option>
              {free.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
            </select>{err('service_countries')}
          </div>
          <div className="gr-field">
            <span className="gr-label">Languages you serve customers in</span>
            <div className="ip-chips">
              {[...LANGUAGE_SUGGESTIONS, ...f.languages.filter((l) => !LANGUAGE_SUGGESTIONS.includes(l))].map((l) => (
                <button key={l} type="button" className="gr-chip" aria-pressed={f.languages.includes(l)} disabled={!canEdit} onClick={() => toggleLang(l)}>{l}</button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input className="gr-input" aria-label="Another language" maxLength={30} value={customLang} disabled={!canEdit} placeholder="Another language"
                onChange={(e) => setCustomLang(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addLang(); } }} />
              <button type="button" className="gr-btn gr-btn--ghost gr-btn--sm" disabled={!canEdit} onClick={addLang}><Plus aria-hidden="true" />Add</button>
            </div>{err('languages')}
          </div>
        </section>

        <section className="gr-card gr-form">
          <Switch checked={f.listed} onChange={canEdit ? (on) => set({ listed: on }) : () => {}}>
            Show my company in the public directory. Turn off to hide the listing; you keep selling to people who already know you.
          </Switch>
        </section>

        {msg.text && <Alert tone={msg.tone}>{msg.text}</Alert>}
        <button type="button" className="gr-btn gr-btn--primary gr-btn--block" disabled={!canEdit || busy || !dirty} onClick={save}>
          {busy ? 'Saving…' : dirty ? 'Save listing' : 'Saved'}
        </button>
      </div>

      <div className="ip-sticky gr-form">
        <p className="gr-eyebrow">Live preview</p>
        <InsurerCard insurer={preview} dark={dark} preview />
        <p className="gr-hint">This is the card customers see. It appears in the public directory once support has verified your licence and you have a plan on sale.</p>
      </div>
    </div>
  );
}
