import React, { useEffect, useState } from 'react';
import { getChainConfig } from '../services/chainService';
import StableUnitPanel from './StableUnitPanel';
import IcecChainPanel from './IcecChainPanel';
import IcanTradingChart from './IcanTradingChart';
import LearnTab from './LearnTab';
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
      <h2 className="text-2xl font-bold text-white">icaneracoin on the blockchain</h2>
      <LearnTab
        items={[
          { q: 'What are ICEC-S and ICEC-C?', a: 'Two forms of icaneracoin on the blockchain. ICEC-S holds a steady US-dollar value. ICEC-C follows the IcanEra coin as the market moves.' },
          { q: 'ICEC-S, the stable form', a: 'A US-dollar token. Each one is backed by one US-dollar stablecoin held in a public vault, and you can swap it back any time. It keeps its dollar value: when the shilling weakens against the dollar an ICEC-S is worth more shillings, when the shilling strengthens it is worth fewer. It does not follow inflation by itself, and nobody can promise it will beat inflation.' },
          { q: 'What do I rely on with ICEC-S?', a: 'The issuer of the dollar stablecoin behind it (it can lose its peg or freeze an address), the contract code (not yet independently audited), and your own wallet: IcanEra cannot move your ICEC-S or recover a lost key.' },
          { q: 'ICEC-C, the community form', a: 'Your icaneracoin on the blockchain, as a public receipt. It is priced by the platform exactly like your ledger coin and moves with it, so its chart is the icaneracoin chart.' },
          { q: 'What happens when I move ICEC onto the chain?', a: 'It is locked in IcanEra and the same amount appears in your wallet, so your IcanEra balance is lower by the same amount. Moving it does not make it worth more or protect its value, and ICEC-C cannot be sent to anyone else: it can only come back to IcanEra.' },
        ]}
      />
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
