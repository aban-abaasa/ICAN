import React, { useEffect, useState } from 'react';
import { getMyBusinessWallets } from '../services/churchTitheService';

/**
 * "Paid by" — for a business tithe, choose which of your own businesses pays it from its business wallet.
 * value / onChange work with { id, name, balance } (only businesses that have a wallet account can be chosen).
 */
export default function PayerBusinessSelect({ value, onChange }) {
  const [list, setList] = useState(null); // null = loading
  const [err, setErr] = useState('');

  useEffect(() => {
    let live = true;
    getMyBusinessWallets().then((rows) => { if (live) setList(rows); }).catch((e) => { if (live) { setList([]); setErr(e.message); } });
    return () => { live = false; };
  }, []);

  if (list === null) return <p className="text-xs text-gray-400">Loading your businesses…</p>;
  if (!list.length) return <p className="text-xs text-rose-400" role="alert">{err || 'You have no registered business to pay from. Switch to a personal tithe, or pay by mobile money / cash.'}</p>;

  const usable = list.filter((b) => b.hasWallet);
  return (
    <div>
      <select
        value={value?.id || ''}
        onChange={(e) => onChange(usable.find((b) => b.id === e.target.value) || null)}
        className="w-full bg-slate-700/50 border border-purple-500/30 rounded-lg px-3 py-2 text-sm text-white focus:outline-none"
        aria-label="Business paying this tithe"
      >
        <option value="">— Choose the business that pays —</option>
        {list.map((b) => (
          <option key={b.id} value={b.id} disabled={!b.hasWallet}>
            {b.name}{b.hasWallet ? ` · UGX ${Math.round(b.balance).toLocaleString()}` : ' · no wallet account yet'}
          </option>
        ))}
      </select>
      {!usable.length && <p className="text-xs text-amber-400 mt-1">None of your businesses has a wallet account yet. Create one in the business profile, or pay by mobile money / cash.</p>}
    </div>
  );
}
