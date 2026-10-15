import React, { useEffect, useState } from 'react';
import { getChainConfig } from '../services/chainService';
import StableUnitPanel from './StableUnitPanel';
import IcecChainPanel from './IcecChainPanel';
import IcanTradingChart from './IcanTradingChart';
import usePublicIcanCandles from '../hooks/usePublicIcanCandles';

// The wallet's "On-chain" tab: icaneracoin in its two forms on the blockchain.
//   ICEC-S  the stable form: a US-dollar token, backed 1:1 by a dollar stablecoin in a public vault
//   ICEC-C  the community form: a receipt for ledger icaneracoin, priced by the platform like the ledger coin
// Hides itself until the on-chain SQL is installed. Self-custody throughout: the user's own wallet signs everything.

// ICEC-C is priced by the platform exactly like the ledger coin, so its chart IS the icaneracoin chart, with the same
// analysis tools (moving averages, RSI, timeframes, trend lines). Mounted only while the community tab is open, so the feed
// is only polled when someone is looking. ICEC-S has no chart: it is a fixed dollar token and its shilling figure is shown live.
function CommunityPriceChart() {
  const { candles, loading, error, status } = usePublicIcanCandles(500);
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-950" aria-label="ICEC-C price chart and analysis">
      <div className="px-4 pt-3">
        <p className="text-sm text-slate-400">Price &amp; analysis</p>
        <p className="text-xs text-slate-500">ICEC-C moves with the IcanEra coin, so this is the same live chart.</p>
      </div>
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

export default function OnChainPanel() {
  const [cfg, setCfg] = useState(undefined);       // undefined: loading, { missing: true }: not installed, else the config
  const [which, setWhich] = useState('stable');

  useEffect(() => {
    let live = true;
    getChainConfig().then((c) => { if (live) setCfg(c); }).catch(() => { if (live) setCfg({ missing: true }); });
    return () => { live = false; };
  }, []);

  if (cfg === undefined) return <p className="text-sm text-slate-500">Loading…</p>;
  if (cfg.missing) return <p className="text-sm text-slate-400">On-chain tokens are not available yet.</p>;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold text-white">icaneracoin on the blockchain</h2>
        <p className="text-sm text-slate-400">Two forms. One holds a steady dollar value. The other follows the IcanEra coin as the market moves.</p>
      </div>
      <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-900 p-1" role="tablist" aria-label="Which form">
        {[['stable', 'ICEC-S', 'Steady dollar value'], ['community', 'ICEC-C', 'Follows the market']].map(([id, label, hint]) => (
          <button key={id} type="button" role="tab" aria-selected={which === id} onClick={() => setWhich(id)}
            className={`rounded-md px-2 py-2 text-center leading-tight ${which === id ? 'bg-amber-500 text-slate-900' : 'text-slate-400 hover:text-white'}`}>
            <span className="block text-sm font-bold">{label}</span>
            <span className={`block text-[11px] ${which === id ? 'text-slate-800' : 'text-slate-500'}`}>{hint}</span>
          </button>
        ))}
      </div>
      {which === 'stable' ? <StableUnitPanel cfg={cfg} /> : (<><CommunityPriceChart /><IcecChainPanel cfg={cfg} /></>)}
    </div>
  );
}
