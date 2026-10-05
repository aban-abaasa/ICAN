import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Save, Trash2 } from 'lucide-react';
import {
  adminGrantAdmin, adminListAdmins, adminListAllTerritories, adminRefreshTiers, adminRevokeAdmin,
  adminSaveRule, adminSaveSettings, adminSaveTerritory, listRules,
} from '../../services/franchiseService';
import { STREAM_LABEL, STRUCTURE_LABEL, fmtPct } from '../../utils/franchise';
import { Badge, Btn, Empty, Field, Input, Section, Select, Toggle, fmtDate, useAction } from './adminUi';

const TIERS = ['any', 'silver', 'gold', 'platinum'];
const STREAMS = Object.keys(STREAM_LABEL);
const STRUCTURES = Object.keys(STRUCTURE_LABEL);
const sum3 = (r) => Math.round((Number(r.hq_pct) + Number(r.master_pct) + Number(r.agency_pct)) * 1000) / 1000;

// ------------------------------------------------------------------ countries
const STATUS_TONE = { open: 'slate', reserved: 'amber', active: 'green', paused: 'red' };

/**
 * Every country is open by default, so this lists only the ones HQ has configured (live, reserved,
 * paused, a different tier, or notes) plus any country the finder adds. Nothing needs "opening".
 */
function Territories({ flash }) {
  const [rows, setRows] = useState(null);
  const [draft, setDraft] = useState({});
  const [pinned, setPinned] = useState([]);
  const [find, setFind] = useState('');
  const [add, setAdd] = useState({ country: '', name: '', tier: 2 });
  const [busy, run] = useAction(flash);
  const load = useCallback(async () => { try { setRows(await adminListAllTerritories()); } catch (e) { flash(e.message, true); setRows([]); } }, [flash]);
  useEffect(() => { load(); }, [load]);

  const special = (t) => t.status !== 'open' || Number(t.tier) !== 2 || !!t.notes;
  const shown = useMemo(() => (rows || []).filter((t) => special(t) || pinned.includes(t.country_code)), [rows, pinned]);
  const counts = useMemo(() => {
    const c = { open: 0, active: 0, reserved: 0, paused: 0 };
    (rows || []).forEach((t) => { c[t.status] = (c[t.status] || 0) + 1; });
    return c;
  }, [rows]);

  const val = (t, k) => (draft[t.country_code]?.[k] ?? t[k]);
  const edit = (t, k, v) => setDraft((d) => ({ ...d, [t.country_code]: { ...d[t.country_code], [k]: v } }));
  const save = async (t) => {
    const d = draft[t.country_code]; if (!d) return;
    const res = await run(`t:${t.country_code}`, () => adminSaveTerritory({ country: t.country_code, tier: d.tier != null ? Number(d.tier) : null, status: d.status ?? null, notes: d.notes ?? null }), `${t.country_name} saved`);
    if (res.ok) { setDraft((x) => { const n = { ...x }; delete n[t.country_code]; return n; }); load(); }
  };
  const pick = (e) => {
    const t = (rows || []).find((r) => r.country_code === e.target.value);
    if (t && !pinned.includes(t.country_code)) setPinned((p) => [...p, t.country_code]);
    setFind('');
  };
  const create = async () => {
    if (add.country.trim().length !== 2) return flash('Use the 2-letter country code, e.g. XK.', true);
    const res = await run('t:add', () => adminSaveTerritory({ country: add.country, name: add.name || null, tier: Number(add.tier), status: 'open' }), 'Country added');
    if (res.ok) { setAdd({ country: '', name: '', tier: 2 }); load(); }
  };

  return (
    <Section title="Countries" hint="Every country is open to registered companies from the start; you never have to open one. Configure a country only to set its tier, reserve it for a signed partner, pause it, or add a note.">
      {rows === null ? <Empty>Loading...</Empty> : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-[11px]" style={{ color: 'var(--dp-sub)' }}>
            <Badge tone="slate">{counts.open} open</Badge><Badge tone="green">{counts.active} live</Badge><Badge tone="amber">{counts.reserved} reserved</Badge><Badge tone="red">{counts.paused} paused</Badge>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={find} onChange={pick} aria-label="Find a country to configure" className="!min-w-[14rem]">
              <option value="">Find a country to configure...</option>
              {rows.map((t) => <option key={t.country_code} value={t.country_code}>{t.country_name}</option>)}
            </Select>
            <span className="text-[11px]" style={{ color: 'var(--dp-muted)' }}>Showing {shown.length} configured or picked.</span>
          </div>
          {shown.map((t) => (
            <div key={t.country_code} className="grid items-center gap-2 rounded-xl border p-2.5 md:grid-cols-[1fr_90px_130px_1fr_auto]" style={{ background: 'var(--dp-inner)', borderColor: 'var(--dp-inner-bd)' }}>
              <p className="text-sm font-bold" style={{ color: 'var(--dp-txt)' }}>{t.country_name} <span className="font-mono text-[11px]" style={{ color: 'var(--dp-muted)' }}>{t.country_code}</span> <Badge tone={STATUS_TONE[t.status]}>{t.status === 'active' ? 'live' : t.status}</Badge></p>
              <Select value={val(t, 'tier')} onChange={(e) => edit(t, 'tier', e.target.value)} aria-label={`${t.country_name} tier`}><option value={1}>Tier 1</option><option value={2}>Tier 2</option><option value={3}>Tier 3</option></Select>
              <Select value={val(t, 'status')} onChange={(e) => edit(t, 'status', e.target.value)} aria-label={`${t.country_name} status`}><option value="open">Open</option><option value="reserved">Reserved</option><option value="active">Live</option><option value="paused">Paused</option></Select>
              <Input placeholder="Notes" value={val(t, 'notes') || ''} onChange={(e) => edit(t, 'notes', e.target.value)} className="!py-1.5 !text-xs" aria-label={`${t.country_name} notes`} />
              <Btn kind="primary" disabled={!draft[t.country_code]} busy={busy === `t:${t.country_code}`} onClick={() => save(t)}><Save size={11} /> Save</Btn>
            </div>
          ))}
          <details className="pt-2">
            <summary className="cursor-pointer text-[11px] font-bold" style={{ color: 'var(--dp-sub)' }}>A place that is not in the list (rare)</summary>
            <div className="mt-2 grid items-end gap-2 md:grid-cols-[110px_1fr_110px_auto]">
              <Field label="Code"><Input maxLength={2} placeholder="XK" value={add.country} onChange={(e) => setAdd((a) => ({ ...a, country: e.target.value.toUpperCase() }))} /></Field>
              <Field label="Name"><Input placeholder="Kosovo" value={add.name} onChange={(e) => setAdd((a) => ({ ...a, name: e.target.value }))} /></Field>
              <Field label="Tier"><Select value={add.tier} onChange={(e) => setAdd((a) => ({ ...a, tier: e.target.value }))} className="w-full"><option value={1}>1</option><option value={2}>2</option><option value={3}>3</option></Select></Field>
              <Btn kind="green" busy={busy === 't:add'} onClick={create}><Plus size={12} /> Add</Btn>
            </div>
          </details>
        </div>
      )}
    </Section>
  );
}

// ------------------------------------------------------------------ rate card
function RateCard({ flash }) {
  const [rules, setRules] = useState(null);
  const [draft, setDraft] = useState({});
  const [add, setAdd] = useState({ stream: 'subscription', structure: 'with_master', agency_tier: 'any', hq_pct: '40', master_pct: '20', agency_pct: '40' });
  const [busy, run] = useAction(flash);
  const load = useCallback(async () => { try { setRules(await listRules()); } catch (e) { flash(e.message, true); setRules([]); } }, [flash]);
  useEffect(() => { load(); }, [load]);

  const row = (r) => ({ ...r, ...(draft[r.id] || {}) });
  const edit = (r, k, v) => setDraft((d) => ({ ...d, [r.id]: { ...d[r.id], [k]: v } }));
  const save = async (r) => {
    const x = row(r);
    const res = await run(`r:${r.id}`, () => adminSaveRule({ stream: x.stream, structure: x.structure, agency_tier: x.agency_tier, hq_pct: Number(x.hq_pct), master_pct: Number(x.master_pct), agency_pct: Number(x.agency_pct), active: !!x.active }), 'Rate saved: applies to new fees from now');
    if (res.ok) { setDraft((d) => { const n = { ...d }; delete n[r.id]; return n; }); load(); }
  };
  const create = async () => {
    const x = { ...add, hq_pct: Number(add.hq_pct), master_pct: Number(add.master_pct), agency_pct: Number(add.agency_pct) };
    const res = await run('r:add', () => adminSaveRule(x), 'Rule saved');
    if (res.ok) load();
  };
  const grouped = useMemo(() => {
    const g = {};
    (rules || []).forEach((r) => { (g[r.stream] ||= []).push(r); });
    return g;
  }, [rules]);

  return (
    <Section title="Rate card" hint="How each fee is shared: HQ / country master / serving partner. Each row must add up to exactly 100. Changes apply to fees from now on; past ones keep the split they were made with.">
      {rules === null ? <Empty>Loading...</Empty> : (
        <div className="space-y-5">
          {STREAMS.filter((s) => grouped[s]).map((stream) => (
            <div key={stream}>
              <p className="mb-2 flex items-center gap-2 text-xs font-black" style={{ color: 'var(--dp-txt)' }}>
                {STREAM_LABEL[stream]}
                {stream === 'wallet_fee' && <Badge tone="amber" title="Regulated wallet and asset fees are never shared unless the switch in Program settings is on">regulated: off by default</Badge>}
              </p>
              <div className="space-y-1.5">
                {grouped[stream].map((r0) => {
                  const r = row(r0); const total = sum3(r); const ok = total === 100; const dirty = !!draft[r0.id];
                  return (
                    <div key={r0.id} className="grid items-center gap-2 rounded-xl border p-2 md:grid-cols-[1.4fr_80px_repeat(3,86px)_70px_auto]" style={{ background: 'var(--dp-inner)', borderColor: 'var(--dp-inner-bd)', opacity: r.active ? 1 : 0.55 }}>
                      <p className="text-xs font-bold" style={{ color: 'var(--dp-txt)' }}>{STRUCTURE_LABEL[r.structure]}</p>
                      <Badge tone="slate">{r.agency_tier}</Badge>
                      {[['hq_pct', 'HQ'], ['master_pct', 'Master'], ['agency_pct', 'Partner']].map(([k, l]) => (
                        <label key={k} className="text-[9px] font-bold uppercase" style={{ color: 'var(--dp-muted)' }}>{l}
                          <Input type="number" step="0.5" min="0" max="100" value={r[k]} onChange={(e) => edit(r0, k, e.target.value)} className="!px-2 !py-1 !text-xs" aria-label={`${STRUCTURE_LABEL[r.structure]} ${l} percent`} />
                        </label>
                      ))}
                      <Badge tone={ok ? 'green' : 'red'} title="HQ + master + partner">{fmtPct(total)}</Badge>
                      <div className="flex items-center gap-2">
                        <label className="flex items-center gap-1 text-[10px]" style={{ color: 'var(--dp-sub)' }}><input type="checkbox" checked={!!r.active} onChange={(e) => edit(r0, 'active', e.target.checked)} /> on</label>
                        <Btn kind="primary" disabled={!dirty || !ok} busy={busy === `r:${r0.id}`} onClick={() => save(r0)}><Save size={11} /></Btn>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          <div className="flex items-start gap-2 rounded-xl border p-3 text-[11px]" style={{ background: 'var(--dp-inner)', borderColor: 'var(--dp-inner-bd)', color: 'var(--dp-sub)' }}>
            <Badge tone="amber">regulated</Badge>
            <p><b style={{ color: 'var(--dp-txt)' }}>Wallet and asset fees are never shared.</b> Selling ICAN, payouts and similar fees stay 100% with HQ. Sharing them takes both a rule here and the switch in Program settings, and should wait for legal advice.</p>
          </div>

          <div className="rounded-xl border p-3" style={{ borderColor: 'var(--dp-inner-bd)' }}>
            <p className="mb-2 text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--dp-muted)' }}>Add or replace a rule</p>
            <div className="grid items-end gap-2 md:grid-cols-[1fr_1.3fr_100px_repeat(3,80px)_auto]">
              <Select value={add.stream} onChange={(e) => setAdd((a) => ({ ...a, stream: e.target.value }))}>{STREAMS.map((s) => <option key={s} value={s}>{STREAM_LABEL[s]}</option>)}</Select>
              <Select value={add.structure} onChange={(e) => setAdd((a) => ({ ...a, structure: e.target.value }))}>{STRUCTURES.map((s) => <option key={s} value={s}>{STRUCTURE_LABEL[s]}</option>)}</Select>
              <Select value={add.agency_tier} onChange={(e) => setAdd((a) => ({ ...a, agency_tier: e.target.value }))}>{TIERS.map((t) => <option key={t} value={t}>{t}</option>)}</Select>
              {['hq_pct', 'master_pct', 'agency_pct'].map((k) => <Input key={k} type="number" step="0.5" value={add[k]} onChange={(e) => setAdd((a) => ({ ...a, [k]: e.target.value }))} className="!px-2 !py-2 !text-xs" aria-label={k} />)}
              <Btn kind="green" disabled={sum3(add) !== 100} busy={busy === 'r:add'} onClick={create}><Plus size={12} /> Save</Btn>
            </div>
            {sum3(add) !== 100 && <p className="mt-1 text-[11px] text-red-500">HQ + master + partner = {fmtPct(sum3(add))}; it must be 100.</p>}
          </div>
        </div>
      )}
    </Section>
  );
}

// ------------------------------------------------------------------ settings
const SETTING_KEYS = ['enabled', 'share_wallet_fees', 'silver_min_accounts', 'gold_min_accounts', 'platinum_min_accounts', 'active_window_days', 'hq_share_floor_pct', 'max_kicker_pts', 'max_penalty_pts'];

function Settings({ settings, flash, onChanged }) {
  const [f, setF] = useState(null);
  const [busy, run] = useAction(flash);
  useEffect(() => { if (settings) setF(Object.fromEntries(SETTING_KEYS.map((k) => [k, settings[k]]))); }, [settings]);
  if (!f) return null;
  const patch = {};
  SETTING_KEYS.forEach((k) => { if (String(f[k]) !== String(settings[k])) patch[k] = typeof settings[k] === 'boolean' ? f[k] : Number(f[k]); });
  const dirty = Object.keys(patch).length > 0;
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const asc = Number(f.silver_min_accounts) <= Number(f.gold_min_accounts) && Number(f.gold_min_accounts) <= Number(f.platinum_min_accounts);

  const setWallet = (v) => {
    if (v && !window.confirm('Wallet and asset fees are the regulated side of the platform. Share them with partners only if your legal advisers have confirmed it is allowed. Turn sharing on?')) return;
    setF((x) => ({ ...x, share_wallet_fees: v }));
  };
  const save = async () => {
    const res = await run('settings', () => adminSaveSettings(patch), 'Settings saved');
    if (res.ok) onChanged();
  };
  const refresh = async () => { const r = await run('tiers', () => adminRefreshTiers(), (x) => `${x?.changed || 0} agency tier(s) updated`); if (r.ok) onChanged(); };

  return (
    <Section title="Program settings" right={<Btn onClick={refresh} busy={busy === 'tiers'}>Recalculate agency tiers now</Btn>}>
      <div className="grid gap-x-8 gap-y-4 md:grid-cols-2">
        <Toggle label="Franchise program on" hint="Off = no new revenue is shared. Existing balances and statements are untouched." checked={!!f.enabled} onChange={(v) => setF((x) => ({ ...x, enabled: v }))} />
        <Toggle label="Share wallet and asset fees" hint="Regulated side. Keep OFF unless advised otherwise. A rule alone is not enough." checked={!!f.share_wallet_fees} onChange={setWallet} />
        <Field label="Gold from (paying accounts)"><Input type="number" min="0" value={f.gold_min_accounts} onChange={set('gold_min_accounts')} /></Field>
        <Field label="Platinum from (paying accounts)"><Input type="number" min="0" value={f.platinum_min_accounts} onChange={set('platinum_min_accounts')} /></Field>
        <Field label="Account counts as active for (days)" hint="A customer is 'paying' if their fees came in within this window."><Input type="number" min="1" max="365" value={f.active_window_days} onChange={set('active_window_days')} /></Field>
        <Field label="HQ share floor (%)" hint="A quality kicker can never push HQ below this."><Input type="number" step="0.5" min="0" max="100" value={f.hq_share_floor_pct} onChange={set('hq_share_floor_pct')} /></Field>
        <Field label="Max quality kicker (points)"><Input type="number" step="0.5" min="0" value={f.max_kicker_pts} onChange={set('max_kicker_pts')} /></Field>
        <Field label="Max quality penalty (points)"><Input type="number" step="0.5" min="0" value={f.max_penalty_pts} onChange={set('max_penalty_pts')} /></Field>
      </div>
      {!asc && <p className="mt-3 text-[11px] text-red-500">Tier thresholds must rise: silver 0, then gold, then platinum.</p>}
      <div className="mt-4 flex justify-end"><Btn kind="primary" disabled={!dirty || !asc} busy={busy === 'settings'} onClick={save}><Save size={12} /> Save settings</Btn></div>
    </Section>
  );
}

// ------------------------------------------------------------------ HQ admins
function Admins({ flash }) {
  const [rows, setRows] = useState(null);
  const [email, setEmail] = useState('');
  const [busy, run] = useAction(flash);
  const load = useCallback(async () => { try { setRows(await adminListAdmins()); } catch (e) { flash(e.message, true); setRows([]); } }, [flash]);
  useEffect(() => { load(); }, [load]);
  const grant = async () => { const r = await run('grant', () => adminGrantAdmin(email.trim()), 'Admin added'); if (r.ok) { setEmail(''); load(); } };
  const revoke = async (a) => { if (!window.confirm(`Remove franchise admin access for ${a.email}?`)) return; const r = await run(`rv:${a.user_id}`, () => adminRevokeAdmin(a.user_id), 'Access removed'); if (r.ok) load(); };

  return (
    <Section title="Franchise admins" hint="Accounts that can administer franchises besides platform developers. Each signs in with their own account.">
      {rows === null ? <Empty>Loading...</Empty> : (
        <div className="space-y-2">
          {rows.length === 0 && <p className="text-xs" style={{ color: 'var(--dp-muted)' }}>Only platform developers can administer franchises right now.</p>}
          {rows.map((a) => (
            <div key={a.user_id} className="flex items-center justify-between rounded-xl border p-2.5 text-xs" style={{ background: 'var(--dp-inner)', borderColor: 'var(--dp-inner-bd)', color: 'var(--dp-txt)' }}>
              <span>{a.email} <span style={{ color: 'var(--dp-muted)' }}>· added {fmtDate(a.added_at)}{a.note ? ` · ${a.note}` : ''}</span></span>
              <Btn kind="danger" busy={busy === `rv:${a.user_id}`} onClick={() => revoke(a)}><Trash2 size={11} /> Remove</Btn>
            </div>
          ))}
          <div className="flex gap-2 pt-1">
            <Input type="email" placeholder="Email of an existing IcanEra account" value={email} onChange={(e) => setEmail(e.target.value)} />
            <Btn kind="green" disabled={!email.includes('@')} busy={busy === 'grant'} onClick={grant}><Plus size={12} /> Add</Btn>
          </div>
        </div>
      )}
    </Section>
  );
}

export default function AdminSetup({ settings, flash, onChanged }) {
  return (
    <div className="space-y-4">
      <Territories flash={flash} />
      <RateCard flash={flash} />
      <Settings settings={settings} flash={flash} onChanged={onChanged} />
      <Admins flash={flash} />
    </div>
  );
}
