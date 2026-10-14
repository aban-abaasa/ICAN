import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ShieldCheck, ShieldAlert, ExternalLink, RefreshCw } from 'lucide-react';
import { useWallet } from '../hooks/useWallet';
import { getFxRate, stableContracts, resolveStableContracts } from '../services/chainService';
import {
  checkDeposit, checkRedeem, explorerLink, formatUnits, friendlyChainError, localValue, networkStatus, proofOfReserve, rateFreshness, shortAddress,
} from '../utils/chainMath';

// ICEC-S, the stable form of icaneracoin. A US-dollar token: every unit is backed 1:1 by a US-dollar stablecoin held in a public
// vault, and can be redeemed for it at any time. It lives in the person's own wallet (self-custody): IcanEra cannot move it.
//
// Nothing here invents a price. A deposit and a redemption are 1:1 in the contract; the shilling figure is only a display of
// units x the USD -> UGX rate, and says how old that rate is. The proof of reserve is read live from the chain.

const POLL_MS = 20_000;

export default function StableUnitPanel({ cfg }) {
  const wallet = useWallet();
  const [fx, setFx] = useState(null);
  const [chain, setChain] = useState(null);          // what the contracts say right now
  const resolvedRef = useRef(null);                  // { token, reserve } read from the vault
  const [loadError, setLoadError] = useState('');
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState('deposit');
  const [tx, setTx] = useState(null);                // { label, hash, state: 'waiting' | 'confirming' | 'done' | 'failed', message }
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const net = networkStatus({ walletChainId: wallet.chainId, expectedChainId: cfg?.chain_id });
  const deployed = !!cfg?.stable_vault_address;          // the token and the reserve coin are read from the vault, never typed in
  const ready = wallet.account && net === 'ok' && deployed;
  const symbol = chain?.reserveSymbol || cfg?.reserve_token_symbol || 'USDC';
  const decimals = chain?.decimals ?? 6;

  useEffect(() => { getFxRate('USD/UGX').then(setFx).catch(() => setFx({ available: false })); }, []);
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState !== 'hidden') getFxRate('USD/UGX').then(setFx).catch(() => {}); }, 60_000);
    return () => clearInterval(t);
  }, []);

  const load = useCallback(async () => {
    if (!ready) { setChain(null); return; }
    try {
      const provider = wallet.getProvider();
      resolvedRef.current = await resolveStableContracts(provider, cfg);
      const c = stableContracts(provider, cfg, resolvedRef.current);
      const [dec, sym, reserveBal, allowance, tokenBal, col, paused] = await Promise.all([
        c.reserve.decimals(), c.reserve.symbol(), c.reserve.balanceOf(wallet.account), c.reserve.allowance(wallet.account, cfg.stable_vault_address),
        c.token.balanceOf(wallet.account), c.vault.collateralization(), c.vault.depositsPaused(),
      ]);
      if (!alive.current) return;
      setChain({ decimals: Number(dec), reserveSymbol: sym, reserveBal, allowance, tokenBal, held: col[0], supply: col[1], paused });
      setLoadError('');
    } catch (e) {
      if (alive.current) setLoadError('Could not read the contracts. Check that your wallet is on the right network.');
    }
  }, [ready, wallet, cfg]);

  useEffect(() => {
    load();
    if (!ready) return undefined;
    const t = setInterval(() => { if (document.visibilityState !== 'hidden') load(); }, POLL_MS);
    return () => clearInterval(t);
  }, [ready, load]);

  const por = useMemo(() => (chain ? proofOfReserve({ reserve: chain.held, supply: chain.supply }) : null), [chain]);
  const check = useMemo(() => {
    if (!chain) return { ok: false, error: null };
    return mode === 'deposit'
      ? checkDeposit({ amount, balance: chain.reserveBal, allowance: chain.allowance, decimals, depositsPaused: chain.paused })
      : checkRedeem({ amount, balance: chain.tokenBal, decimals });
  }, [chain, mode, amount, decimals]);

  // one transaction at a time: ask the wallet, wait for the chain, report in plain words
  const send = async (label, make) => {
    setTx({ label, state: 'waiting', message: 'Confirm in your wallet…' });
    try {
      const signer = await wallet.getRunner();
      const resolved = resolvedRef.current || await resolveStableContracts(wallet.getProvider(), cfg);
      const sent = await make(stableContracts(signer, cfg, resolved));
      setTx({ label, hash: sent.hash, state: 'confirming', message: 'Waiting for the network to confirm…' });
      await sent.wait();
      setTx({ label, hash: sent.hash, state: 'done', message: 'Done.' });
      return true;
    } catch (e) {
      setTx({ label, state: 'failed', message: friendlyChainError(e) });
      return false;
    } finally {
      load();
    }
  };

  const approve = () => send('Approve', (c) => c.reserve.approve(cfg.stable_vault_address, check.units));
  const submit = async () => {
    if (!check.ok) return;
    const ok = await send(mode === 'deposit' ? 'Deposit' : 'Redeem', (c) => (mode === 'deposit' ? c.vault.deposit(check.units) : c.vault.redeem(check.units)));
    if (ok) setAmount('');
  };

  const usdValue = chain ? formatUnits(chain.tokenBal, decimals, 2) : null;
  const ugx = chain && fx?.available ? localValue(chain.tokenBal, decimals, fx.rate) : null;
  const fresh = rateFreshness(fx);
  const explorer = (kind, v) => explorerLink(cfg?.explorer_url, kind, v);

  return (
    <div className="space-y-4 text-slate-200" data-testid="stable-panel">
      <div>
        <h3 className="text-xl font-bold text-white">ICEC-S <span className="text-sm font-normal text-slate-400">· the stable form</span></h3>
        <p className="text-sm text-slate-400">A US-dollar token. Each one is backed by one US-dollar stablecoin held in a public vault, and you can swap it back any time.</p>
      </div>

      {cfg?.is_testnet && <p className="text-xs rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-300 p-3">This is a test network. Test tokens have no real value; nothing here is real money yet.</p>}

      <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3 text-xs text-slate-400 space-y-1.5">
        <p><b className="text-slate-200">What it protects.</b> ICEC-S keeps its US-dollar value. When the shilling weakens against the dollar, an ICEC-S is worth more shillings; when the shilling strengthens it is worth fewer. It does not follow inflation by itself, and nobody can promise it will beat inflation.</p>
        <p><b className="text-slate-200">What you rely on.</b> The issuer of the dollar stablecoin behind it (it can lose its peg or freeze an address), the contract code (not yet independently audited), and your own wallet: IcanEra cannot move your ICEC-S or recover a lost key.</p>
      </div>

      {!deployed ? (
        <p className="text-sm text-slate-400">ICEC-S is not live on this network yet.</p>
      ) : !wallet.available ? (
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-4 text-sm text-slate-300 space-y-1">
          <p>To hold ICEC-S you need your own crypto wallet.</p>
          <p className="text-slate-400">Install a wallet such as MetaMask in this browser, or open this page inside your wallet app. Connecting from a regular phone browser (WalletConnect) is coming.</p>
        </div>
      ) : !wallet.account ? (
        <div className="space-y-2">
          <button type="button" onClick={wallet.connect} disabled={wallet.connecting} className="rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-bold text-slate-900 disabled:opacity-50">
            {wallet.connecting ? 'Waiting for your wallet…' : 'Connect wallet'}
          </button>
          {wallet.error && <p className="text-sm text-red-400" role="alert">{wallet.error}</p>}
        </div>
      ) : net !== 'ok' ? (
        <div className="space-y-2 rounded-lg border border-slate-800 bg-slate-900 p-4">
          <p className="text-sm text-slate-300">Your wallet is on a different network. ICEC-S lives on <b>{cfg.chain_name || `chain ${cfg.chain_id}`}</b>.</p>
          <button type="button" onClick={() => wallet.switchNetwork({ chainId: cfg.chain_id, name: cfg.chain_name, explorerUrl: cfg.explorer_url })} className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-bold text-slate-900">Switch network</button>
          {wallet.error && <p className="text-sm text-red-400" role="alert">{wallet.error}</p>}
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Connected: <span className="font-mono text-slate-200">{shortAddress(wallet.account)}</span></span>
            <button type="button" onClick={load} className="inline-flex items-center gap-1 hover:text-white" aria-label="Refresh"><RefreshCw className="h-3.5 w-3.5" /> Refresh</button>
          </div>
          {loadError && <p className="text-sm text-red-400" role="alert">{loadError}</p>}

          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl border border-slate-800 bg-slate-900 p-3">
              <div className="text-xs text-slate-500">Your ICEC-S</div>
              <div className="text-xl font-semibold text-white" data-testid="stable-balance">{usdValue ?? '—'}</div>
              <div className="text-xs text-slate-400">{ugx != null ? `≈ UGX ${Math.round(ugx).toLocaleString()}` : 'no exchange rate'}</div>
              <div className={`text-[11px] ${fresh.warn ? 'text-amber-400' : 'text-slate-500'}`}>{fresh.text}{fresh.warn && fx?.available ? ' (may be out of date)' : ''}</div>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900 p-3">
              <div className="text-xs text-slate-500">Your {symbol}</div>
              <div className="text-xl font-semibold text-white" data-testid="reserve-balance">{chain ? formatUnits(chain.reserveBal, decimals, 2) : '—'}</div>
              <div className="text-xs text-slate-400">to swap for ICEC-S</div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 space-y-3">
            <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-950 p-1" role="tablist" aria-label="Deposit or redeem">
              {[['deposit', `Get ICEC-S`], ['redeem', `Back to ${symbol}`]].map(([m, label]) => (
                <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => { setMode(m); setAmount(''); setTx(null); }}
                  className={`rounded-md py-2 text-sm font-semibold ${mode === m ? 'bg-amber-500 text-slate-900' : 'text-slate-400 hover:text-white'}`}>{label}</button>
              ))}
            </div>
            <label className="block text-xs text-slate-400">
              {mode === 'deposit' ? `Amount of ${symbol} to swap` : 'Amount of ICEC-S to swap back'}
              <input type="text" inputMode="decimal" autoComplete="off" value={amount} placeholder="0" aria-label="Amount"
                onChange={(e) => { setTx(null); setAmount(e.target.value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1')); }}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-base text-white" />
            </label>
            <p className="text-xs text-slate-500">One for one, with no fee from IcanEra. You pay the network's small fee in its own coin.</p>
            {check.error && <p className="text-sm text-amber-400" role="alert">{check.error}</p>}
            {mode === 'deposit' && check.ok && check.needsApproval ? (
              <div className="space-y-2">
                <p className="text-xs text-slate-400">Step 1 of 2: let the vault take exactly this amount of {symbol} from your wallet.</p>
                <button type="button" onClick={approve} disabled={tx?.state === 'waiting' || tx?.state === 'confirming'} className="w-full rounded-lg bg-amber-500 py-3 text-sm font-bold text-slate-900 disabled:opacity-50">Approve {amount} {symbol}</button>
              </div>
            ) : (
              <button type="button" onClick={submit} disabled={!check.ok || tx?.state === 'waiting' || tx?.state === 'confirming'}
                className="w-full rounded-lg bg-emerald-600 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40">
                {mode === 'deposit' ? 'Get ICEC-S' : `Swap back to ${symbol}`}
              </button>
            )}
            {chain?.paused && mode === 'deposit' && <p className="text-xs text-amber-400">New swaps into ICEC-S are paused. Swapping back is always open.</p>}
            {tx && (
              <p className={`rounded-md px-3 py-2 text-sm ${tx.state === 'failed' ? 'bg-red-500/10 text-red-300' : tx.state === 'done' ? 'bg-emerald-500/10 text-emerald-300' : 'bg-slate-800 text-slate-300'}`} role="status">
                <b>{tx.label}:</b> {tx.message}{' '}
                {tx.hash && explorer('tx', tx.hash) && <a href={explorer('tx', tx.hash)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline">View <ExternalLink className="h-3 w-3" /></a>}
              </p>
            )}
          </div>

          <div className={`rounded-xl border p-4 ${por?.backed === false ? 'border-red-500/50 bg-red-500/10' : 'border-slate-800 bg-slate-900'}`} data-testid="proof-of-reserve">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              {por?.backed === false ? <ShieldAlert className="h-4 w-4 text-red-400" /> : <ShieldCheck className="h-4 w-4 text-emerald-400" />}
              Proof of reserve, read from the chain just now
            </div>
            {por ? (
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <dt className="text-slate-400">Held in the vault</dt><dd className="text-right tabular-nums">{formatUnits(chain.held, decimals, 2)} {symbol}</dd>
                <dt className="text-slate-400">ICEC-S in existence</dt><dd className="text-right tabular-nums">{formatUnits(chain.supply, decimals, 2)}</dd>
                <dt className="text-slate-400">Backing</dt>
                <dd className={`text-right font-semibold ${por.backed ? 'text-emerald-400' : 'text-red-400'}`}>{por.backed ? `${(Number(por.coverageBps) / 100).toFixed(2)}% (every ICEC-S is covered)` : `SHORT by ${formatUnits(por.shortfall, decimals, 2)}`}</dd>
              </dl>
            ) : <p className="mt-2 text-sm text-slate-400">Reading the vault…</p>}
            <p className="mt-2 text-[11px] text-slate-500">
              The vault contract refuses any deposit or redemption that would leave it with less than it has issued. Vault:{' '}
              {explorer('address', cfg.stable_vault_address) ? <a className="font-mono underline" href={explorer('address', cfg.stable_vault_address)} target="_blank" rel="noreferrer">{shortAddress(cfg.stable_vault_address)}</a> : <span className="font-mono">{shortAddress(cfg.stable_vault_address)}</span>}
            </p>
          </div>
        </>
      )}
    </div>
  );
}
