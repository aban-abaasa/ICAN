import React, { useEffect, useState } from 'react';
import { getChainConfig } from '../services/chainService';
import StableInSystemPanel from './StableInSystemPanel';
import IcecChainPanel from './IcecChainPanel';
import IcanTradingChart from './IcanTradingChart';
import LearnTab from './LearnTab';
import usePublicIcanCandles from '../hooks/usePublicIcanCandles';

// The wallet's "ICEC-S & C" tab: icaneracoin in its two stable/community forms.
//   ICEC-S  the stable form, worth one US dollar, INSIDE IcanEra (no blockchain, no gas): StableInSystemPanel
//   ICEC-C  the community form, a public blockchain receipt for ledger icaneracoin (self-custody; hides until the chain is set up)

// ICEC-C is priced by the platform exactly like the ledger coin, so its chart IS the icaneracoin chart, with the same
// analysis tools (moving averages, RSI, timeframes, trend lines). Mounted only while the community tab is open, so the feed
// is only polled when someone is looking.
function CommunityPriceChart() {
  const { candles, loading, error, status } = usePublicIcanCandles(500);
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-950" aria-label="ICEC-C price chart and analysis">
      <p className="px-4 pt-3 text-sm text-slate-400">Price &amp; analysis</p>
      <div className="mt-2 h-[24rem] w-full sm:h-[28rem]">
        {error ? (
          <p className="p-6 text-center text-sm text-slate-400">The live chart could not be loaded right now.</p>
        ) : (
          <IcanTradingChart rows={candles} loading={loading} theme="dark" wheelZoom={false} feedState={status} symbol="ICEC-C / UGX" />
        )}
      </div>
    </section>
  );
}

// The blockchain half. Only this tab needs the chain's configuration.
function CommunityTab() {
  const [cfg, setCfg] = useState(undefined);       // undefined: loading, { missing: true }: not installed, else the config
  useEffect(() => {
    let live = true;
    getChainConfig().then((c) => { if (live) setCfg(c); }).catch(() => { if (live) setCfg({ missing: true }); });
    return () => { live = false; };
  }, []);
  return (
    <div className="space-y-4">
      <LearnTab
        items={[
          { q: 'What is ICEC-C?', a: 'Your icaneracoin on a public blockchain, as a receipt. It is priced by the platform exactly like your ledger coin and moves with it, so its chart is the icaneracoin chart.' },
          { q: 'What happens when I move ICEC onto the chain?', a: 'It is locked in IcanEra and the same amount appears in your own crypto wallet, so your IcanEra balance is lower by the same amount. Moving it does not make it worth more or protect its value, and ICEC-C cannot be sent to anyone else: it can only come back to IcanEra.' },
        ]}
      />
      <CommunityPriceChart />
      {cfg === undefined ? <p className="text-sm text-slate-500">Loading…</p>
        : cfg.missing ? <p className="text-sm text-slate-400">Moving icaneracoin onto a blockchain is not available yet.</p>
        : <IcecChainPanel cfg={cfg} />}
    </div>
  );
}

export default function OnChainPanel() {
  const [which, setWhich] = useState('stable');
  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold text-white">icaneracoin, stable &amp; community</h2>
      <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-900 p-1" role="tablist" aria-label="Which form">
        {[['stable', 'ICEC-S', 'Steady dollar value'], ['community', 'ICEC-C', 'Follows the market']].map(([id, label, hint]) => (
          <button key={id} type="button" role="tab" aria-selected={which === id} onClick={() => setWhich(id)}
            className={`rounded-md px-2 py-2 text-center leading-tight ${which === id ? 'bg-amber-500 text-slate-900' : 'text-slate-400 hover:text-white'}`}>
            <span className="block text-sm font-bold">{label}</span>
            <span className={`block text-[11px] ${which === id ? 'text-slate-800' : 'text-slate-500'}`}>{hint}</span>
          </button>
        ))}
      </div>
      {which === 'stable' ? <StableInSystemPanel /> : <CommunityTab />}
    </div>
  );
}
