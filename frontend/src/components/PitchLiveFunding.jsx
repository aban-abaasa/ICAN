import React, { useEffect, useState } from 'react';
import { getLiveShareOffer } from '../services/pitchinValuationService';
import { CountryService } from '../services/countryService';

// Raised / Goal / Equity for a pitch, read from the LIVE share value (the same
// getLiveShareOffer() the Invest flow prices against) instead of the static
// raised_amount / target_funding columns, which are seeded once and never
// recomputed. Amounts are priced at the live value in UGX and then shown in the
// viewer's own country currency (no hardcoded rates; CountryService supplies
// them). While the live value loads, or when none exists yet, the stored pitch
// figures are shown so the block never goes blank.
//
//   Raised = shares already issued x live share price
//   Goal   = the offered equity % of the live business value
//   Equity = the % the pitch offers

const OFFER_TTL_MS = 60_000;
const offerCache = new Map(); // businessProfileId -> { at, offer, promise }

function readOffer(businessProfileId, ownerUserId, { force = false } = {}) {
  const hit = offerCache.get(businessProfileId);
  if (!force && hit && (hit.promise || Date.now() - hit.at < OFFER_TTL_MS)) return hit.promise || Promise.resolve(hit.offer);
  const promise = getLiveShareOffer(businessProfileId, ownerUserId)
    .catch(() => ({ available: false, reason: 'default' }))
    .then((offer) => { offerCache.set(businessProfileId, { at: Date.now(), offer }); return offer; });
  offerCache.set(businessProfileId, { at: hit?.at || 0, offer: hit?.offer, promise });
  return promise;
}

const NO_DECIMALS = new Set(['UGX', 'TZS', 'RWF', 'BIF', 'SSP', 'DJF', 'XAF', 'XOF', 'JPY', 'KRW', 'IDR', 'VND']);

function formatLive(ugx, countryCode) {
  const code = CountryService.getCurrencyCode(countryCode || 'UG');
  const local = CountryService.icanToLocal(1, countryCode || 'UG', Number(ugx) || 0);
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency', currency: code, notation: 'compact',
      minimumFractionDigits: 0, maximumFractionDigits: NO_DECIMALS.has(code) ? 0 : 1,
    }).format(local);
  } catch {
    return `${code} ${Math.round(local).toLocaleString()}`;
  }
}

const formatStored = (amount) => (!amount ? '$0' : `$${(amount / 1000).toFixed(0)}K`);

export default function PitchLiveFunding({ pitch, country, variant = 'card' }) {
  const businessProfileId = pitch?.business_profile_id || pitch?.business_profiles?.id;
  const ownerUserId = pitch?.business_profiles?.user_id || pitch?.user_id;
  const [offer, setOffer] = useState(() => offerCache.get(businessProfileId)?.offer || null);

  useEffect(() => {
    if (!businessProfileId) { setOffer(null); return undefined; }
    let cancelled = false;
    const load = (force) => readOffer(businessProfileId, ownerUserId, { force }).then((o) => { if (!cancelled) setOffer(o); });
    load(false);
    // Keep it live without hammering the free-plan database: one refresh a
    // minute, and only while the tab is visible.
    const timer = setInterval(() => { if (document.visibilityState === 'visible') load(true); }, OFFER_TTL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [businessProfileId, ownerUserId]);

  const equityPct = Number(pitch?.equity_offering) || 0;
  const live = offer?.available && Number(offer.sharePriceUgx) > 0 ? offer : null;

  let raised = formatStored(pitch?.raised_amount);
  let goal = formatStored(pitch?.target_funding);
  if (live) {
    const price = Number(live.sharePriceUgx);
    const valuation = Number(live.businessValueUgx) || Number(live.totalShares) * price;
    raised = formatLive(Number(live.sharesIssued || 0) * price, country);
    goal = formatLive((equityPct / 100) * valuation, country);
  }

  const big = variant === 'detail';
  const cells = [
    { label: 'Raised', value: raised },
    { label: 'Goal', value: goal },
    { label: 'Equity', value: `${equityPct}%` },
  ];
  return (
    <div
      className={big ? 'grid grid-cols-3 gap-3 mb-3 pb-3 border-b border-white/10' : 'grid grid-cols-3 gap-2 bg-white/5 p-2 rounded mb-3'}
      title={live ? 'Live: priced at the current share value' : 'Stored figures (no live share value yet)'}
    >
      {cells.map((cell, i) => (
        <div key={cell.label} className={`text-center ${i === 1 ? 'border-x border-white/10' : ''}`}>
          <p className={big ? 'text-[11px] text-slate-500 uppercase tracking-wide' : 'text-xs text-slate-400'}>
            {cell.label}{live && i === 0 ? <span className="ml-1 text-emerald-400" aria-label="Live value">●</span> : null}
          </p>
          <p className={big ? 'text-sm font-bold text-white' : 'text-xs font-bold text-white'}>{cell.value}</p>
        </div>
      ))}
    </div>
  );
}
