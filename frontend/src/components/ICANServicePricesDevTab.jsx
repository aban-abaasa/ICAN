import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { devServicePrices } from '../services/pitchBadgeService';
import { SERVICES, parsePriceIc, describePrice, describeServiceChange } from '../utils/servicePrices';

/**
 * "Services" section of the dev panel's fees tab: what IcanEra charges businesses for paid services, starting free. Each service has a price in
 * IcanEra coin and a Free / Charged switch that remembers the price, so a developer can alternate it whenever they like. A change applies to the next
 * publish or renewal; what is already running is not touched. Talks to ican_dev_get_service_prices / ican_dev_set_service_price
 * (supabase/migrations/20261119100000_video_product_badges.sql): the panel's dev token AND the signed-in operator account are required.
 */

const card = { background: 'var(--dp-card)', borderColor: 'var(--dp-card-bd)' };
const field = { background: 'var(--dp-inner)', borderColor: 'var(--dp-inner-bd)', color: 'var(--dp-txt)' };
const titleOf = (key) => SERVICES.find((s) => s.key === key)?.title || key;

export default function ICANServicePricesDevTab({ devToken }) {
  const [data, setData] = useState(null);
  const [missing, setMissing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [flash, setFlash] = useState('');
  const [busyKey, setBusyKey] = useState('');
  const [drafts, setDrafts] = useState({}); // key -> { price?: text, charged?: boolean }; absent = untouched

  const say = (m) => { setFlash(m); setTimeout(() => setFlash(''), 3500); };
  const notAllowed = 'Not allowed. Prices can only be read and changed from the allowlisted developer account, not from a support link.';

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await devServicePrices.get(devToken);
      if (res.missing) { setMissing(true); return; }
      setData(res.data);
    } catch (e) {
      setError(/unauthorized/i.test(e?.message || '') ? notAllowed : (e?.message || 'Could not load.'));
    } finally {
      setLoading(false);
    }
  }, [devToken]);
  useEffect(() => { load(); }, [load]);

  const save = async (service, row) => {
    const draft = drafts[service.key] || {};
    const priceText = draft.price ?? String(Number(row.price_ic));
    const parsed = parsePriceIc(priceText);
    if (!parsed.ok) { setError(parsed.error); return; }
    const charged = draft.charged ?? row.charged;
    if (charged && parsed.price === 0) { setError('Set a price above 0 to charge for this service, or switch it to Free.'); return; }
    const change = describeServiceChange(service, row, { charged, price: parsed.price });
    if (!change.changed) { setDrafts((d) => { const n = { ...d }; delete n[service.key]; return n; }); return; }
    if (!window.confirm(change.message)) return;
    if (change.big && !window.confirm(`Please confirm once more: ${service.title} will cost ${change.will} for every business that publishes or renews from now on.`)) return;
    setBusyKey(service.key); setError('');
    try {
      const res = await devServicePrices.set(devToken, service.key, parsed.price, charged);
      if (res.missing) { setMissing(true); return; }
      if (!res.data?.success) { setError(res.data?.error || 'That did not work.'); return; }
      setDrafts((d) => { const n = { ...d }; delete n[service.key]; return n; });
      say(`${service.title}: ${change.was} → ${change.will}. Applies from the next publish or renewal.`);
      await load();
    } catch (e) {
      setError(/unauthorized/i.test(e?.message || '') ? notAllowed : (e?.message || 'That did not work.'));
    } finally {
      setBusyKey('');
    }
  };

  if (loading) return <p className="text-sm" style={{ color: 'var(--dp-muted)' }}>Loading services…</p>;
  if (missing) return <p className="text-sm" style={{ color: 'var(--dp-muted)' }}>Paid services are not installed yet. Run VIDEO_PRODUCT_BADGES_PASTE_INTO_SUPABASE.sql.</p>;
  if (!data) return <p className="text-sm text-red-400">{error || 'Nothing to show.'}</p>;

  const byKey = Object.fromEntries((data.services || []).map((s) => [s.key, s]));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold" style={{ color: 'var(--dp-txt)' }}>Services</h2>
        <button type="button" onClick={load} className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg border" style={field}><RefreshCw className="w-3.5 h-3.5" />Refresh</button>
      </div>
      <p className="text-sm" style={{ color: 'var(--dp-muted)' }}>
        Paid features for businesses. Each starts <strong>free</strong>. Switch one to Charged to take its price from the business wallet; switch it back to Free at any time and the price is remembered.
        A change applies to the next publish or renewal; what is already running is not charged again.
      </p>
      {error && <p className="text-sm text-red-400" role="alert">{error}</p>}
      {flash && <p className="text-sm text-emerald-400" role="status">{flash}</p>}

      {SERVICES.map((service) => {
        const row = byKey[service.key];
        if (!row) return <p key={service.key} className="text-sm" style={{ color: 'var(--dp-muted)' }}>{service.title}: not set up. Run the paste file again.</p>;
        const draft = drafts[service.key] || {};
        const charged = draft.charged ?? row.charged;
        const priceText = draft.price ?? String(Number(row.price_ic));
        const parsed = parsePriceIc(priceText);
        const dirty = (draft.charged !== undefined && draft.charged !== row.charged) || (draft.price !== undefined && parsed.ok && parsed.price !== Number(row.price_ic));
        return (
          <div key={service.key} className="rounded-xl border p-4 space-y-3" style={card}>
            <div>
              <p className="font-semibold" style={{ color: 'var(--dp-txt)' }}>{service.title}</p>
              <p className="text-xs" style={{ color: 'var(--dp-muted)' }}>{service.what} Paid by {service.paidBy}.</p>
            </div>
            <p className="text-3xl font-bold" style={{ color: 'var(--dp-txt)' }}>{describePrice(row.charged, row.price_ic)}
              <span className="ml-2 text-xs font-normal" style={{ color: 'var(--dp-muted)' }}>
                {row.charged ? `charged now ${service.unit}` : `free now${Number(row.price_ic) > 0 ? ` · ${Number(row.price_ic)} IC remembered` : ''}`}
              </span>
            </p>
            {typeof data.badges_live === 'number' && service.key === 'pitch_product_badge' && (
              <p className="text-xs" style={{ color: 'var(--dp-muted)' }}>{data.badges_live} badge{data.badges_live === 1 ? '' : 's'} live right now.</p>
            )}

            <div className="flex flex-wrap items-end gap-3">
              <div role="radiogroup" aria-label={`${service.title} is free or charged`} className="flex rounded-lg overflow-hidden border" style={field}>
                {[[false, 'Free'], [true, 'Charged']].map(([value, text]) => (
                  <button key={text} type="button" role="radio" aria-checked={charged === value}
                    onClick={() => { setError(''); setDrafts((d) => ({ ...d, [service.key]: { ...d[service.key], charged: value } })); }}
                    className={`px-4 py-2 text-sm font-semibold ${charged === value ? (value ? 'bg-sky-600 text-white' : 'bg-emerald-600 text-white') : ''}`}>{text}</button>
                ))}
              </div>
              <label className="block text-xs" style={{ color: 'var(--dp-muted)' }}>Price (IC {service.unit})
                <input value={priceText} inputMode="decimal" onChange={(e) => { setError(''); setDrafts((d) => ({ ...d, [service.key]: { ...d[service.key], price: e.target.value.replace(/[^0-9.]/g, '') } })); }}
                  className="mt-1 block w-32 rounded-lg border px-3 py-2 text-sm" style={field} aria-label={`${service.title} price in IC`} />
              </label>
              <button type="button" disabled={!dirty || busyKey === service.key} onClick={() => save(service, row)}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-sky-600 hover:bg-sky-500 disabled:opacity-40">{busyKey === service.key ? 'Saving…' : 'Save'}</button>
            </div>
            {draft.price !== undefined && !parsed.ok && <p className="text-[11px] text-red-400">{parsed.error}</p>}
            {row.updated_at && <p className="text-[11px]" style={{ color: 'var(--dp-muted)' }}>Last changed {new Date(row.updated_at).toLocaleString()}</p>}
          </div>
        );
      })}

      <div className="rounded-xl border p-4 space-y-2" style={card}>
        <p className="font-semibold" style={{ color: 'var(--dp-txt)' }}>Recent changes</p>
        {(data.changes || []).length === 0
          ? <p className="text-sm" style={{ color: 'var(--dp-muted)' }}>No change has been made from this panel yet.</p>
          : (
            <ul className="text-sm space-y-1">
              {data.changes.map((c, i) => (
                <li key={`${c.changed_at}-${i}`} style={{ color: 'var(--dp-txt)' }}>
                  {titleOf(c.key)}: {describePrice(c.old_charged, c.old_price)} → <strong>{describePrice(c.new_charged, c.new_price)}</strong>
                  <span className="ml-2 text-xs" style={{ color: 'var(--dp-muted)' }}>{new Date(c.changed_at).toLocaleString()} · {c.changed_by || 'unknown'}</span>
                </li>
              ))}
            </ul>
          )}
      </div>
    </div>
  );
}
