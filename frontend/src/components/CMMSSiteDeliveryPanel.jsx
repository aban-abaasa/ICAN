import React, { useCallback, useEffect, useState } from 'react';
import { Check, Loader, Truck, X } from 'lucide-react';
import { getMySiteDelivery, setMySiteDelivery } from '../services/siteDeliveryService';
import { deliveryChecklist, describeUndeliverable } from '../utils/siteDelivery';

/**
 * CMMS > Products & services > Delivery.
 *
 * One switch that lets the website's Market deliver the business's OWN store products. It is dropship's delivery, not a new one:
 * the same BodaGoEra riders, the real fare, the delivery window and payment held until the rider has collected the order. Nothing
 * is listed or copied - the website always shows the store's current products.
 *
 * The switch will not move until the store can really deliver; the checklist says what is missing and how to fix it.
 * (supabase/migrations/20261113100000_site_delivery.sql)
 */
export default function CMMSSiteDeliveryPanel({ companyId }) {
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    const result = await getMySiteDelivery(companyId);
    if (result.success) { setInfo(result.data); setError(''); } else { setInfo(null); setError(result.error); }
    setLoading(false);
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  const toggle = async () => {
    if (!info || busy) return;
    setBusy(true);
    setError('');
    const result = await setMySiteDelivery(companyId, !info.enabled);
    setBusy(false);
    if (!result.success) { setError(result.error); return; }
    setInfo(result.data);
  };

  const checklist = deliveryChecklist(info);
  const deliverable = Number(info?.products?.deliverable) || 0;
  const undeliverable = describeUndeliverable(info?.products);
  const canSwitch = Boolean(info?.can_change) && (info?.ready || info?.enabled);

  return (
    <div className="mt-4 rounded-lg border border-white/15 bg-white/5 p-4" data-testid="site-delivery-panel">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="flex items-center gap-2 text-sm font-semibold text-white"><Truck className="w-4 h-4" />Delivery</h4>
          <p className="text-xs cmms-classic-muted mt-1">
            Let customers have your store products delivered. A BodaGoera rider collects the order from your store and brings it to them — the same
            delivery your Dropship orders use. They pay the rider&apos;s real fare, and the payment is held until the rider has collected the order.
          </p>
        </div>
        {loading ? (
          <Loader className="w-5 h-5 animate-spin flex-shrink-0 text-white/70" />
        ) : (
          <button
            type="button"
            role="switch"
            aria-checked={Boolean(info?.enabled)}
            aria-label="Offer delivery on the website"
            disabled={!canSwitch || busy}
            onClick={toggle}
            className={`relative flex-shrink-0 h-7 w-12 rounded-full border transition disabled:opacity-40 ${info?.enabled ? 'bg-emerald-500 border-emerald-400' : 'bg-white/10 border-white/30'}`}
          >
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${info?.enabled ? 'left-6' : 'left-0.5'}`} />
          </button>
        )}
      </div>

      {error && <p className="text-xs text-red-300 mt-3" role="alert">{error}</p>}

      {info && (
        <>
          <ul className="mt-3 space-y-2">
            {checklist.map((item) => (
              <li key={item.key} className="flex items-start gap-2 text-xs">
                {item.ok
                  ? <Check className="w-4 h-4 flex-shrink-0 text-emerald-400" aria-label="Done" />
                  : <X className="w-4 h-4 flex-shrink-0 text-amber-300" aria-label="Missing" />}
                <span className={item.ok ? 'text-white/90' : 'text-white'}>
                  {item.label}
                  {!item.ok && <span className="block cmms-classic-muted mt-0.5">{item.hint}</span>}
                </span>
              </li>
            ))}
          </ul>

          {info.store_name && (
            <p className="text-xs cmms-classic-muted mt-3">
              Delivering from <strong className="text-white">{info.store_name}</strong>.{' '}
              {deliverable > 0
                ? `${deliverable} product${deliverable === 1 ? '' : 's'} will be offered for delivery${info.enabled ? '' : ' once you switch it on'}.`
                : 'No product can be delivered yet.'}
            </p>
          )}
          {undeliverable && <p className="text-xs text-amber-300 mt-1">{undeliverable}</p>}
          {!info.can_change && (
            <p className="text-xs cmms-classic-muted mt-3">Only a member of the business can switch delivery on or off.</p>
          )}
          {info.enabled && !info.ready && (
            <p className="text-xs text-amber-300 mt-3">Delivery is switched on but paused: something above is missing, so customers are not being offered it.</p>
          )}
        </>
      )}
    </div>
  );
}
