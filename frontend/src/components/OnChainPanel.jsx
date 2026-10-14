import React, { useEffect, useState } from 'react';
import { getChainConfig } from '../services/chainService';
import StableUnitPanel from './StableUnitPanel';
import IcecChainPanel from './IcecChainPanel';

// The wallet's "On-chain" tab: icaneracoin in its two forms on the blockchain.
//   ICEC-S  the stable form: a US-dollar token, backed 1:1 by a dollar stablecoin in a public vault
//   ICEC-C  the community form: a receipt for ledger icaneracoin, priced by the platform like the ledger coin
// Hides itself until the on-chain SQL is installed. Self-custody throughout: the user's own wallet signs everything.

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
        {[['stable', 'ICEC-S · stable'], ['community', 'ICEC-C · community']].map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={which === id} onClick={() => setWhich(id)}
            className={`rounded-md py-2 text-sm font-semibold ${which === id ? 'bg-amber-500 text-slate-900' : 'text-slate-400 hover:text-white'}`}>{label}</button>
        ))}
      </div>
      {which === 'stable' ? <StableUnitPanel cfg={cfg} /> : <IcecChainPanel cfg={cfg} />}
    </div>
  );
}
