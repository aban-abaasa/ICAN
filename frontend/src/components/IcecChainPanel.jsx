import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, RefreshCw } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useWallet } from '../hooks/useWallet';
import { getBalance } from '../services/icanWalletService';
import {
  cancelWithdrawal, communityContract, getChainOverview, newCreditId, requestLinkChallenge, requestWithdrawal, submitLink, unlinkAddress,
} from '../services/chainService';
import { makeRequestIdStore } from '../utils/tradeResult';
import {
  burnStatus, checkBurn, checkWithdraw, explorerLink, formatUnits, friendlyChainError, ICEC_C_DECIMALS, networkStatus, sameAddress, shortAddress, withdrawalStatus,
} from '../utils/chainMath';

// ICEC-C, the community form of icaneracoin on the chain. It is a RECEIPT for icaneracoin that lives in the IcanEra ledger: it is
// priced by the platform exactly like the ledger coin and rises and falls with the market the same way, and it cannot be sent
// to anyone else. You move ledger ICEC onto the chain (it is locked in IcanEra and the same amount appears in your wallet),
// and bring it back by burning it (the same amount returns to your IcanEra balance). Putting it on a chain does not make it
// worth more or less, and does not protect its value: it is a public record, not a second market.

const TONE = { ok: 'text-emerald-400', wait: 'text-amber-400', off: 'text-slate-500' };

export default function IcecChainPanel({ cfg }) {
  const { user } = useAuth();
  const userId = user?.id || null;
  const wallet = useWallet();
  const [overview, setOverview] = useState(null);
  const [ledger, setLedger] = useState(null);
  const [onchain, setOnchain] = useState(null);           // ICEC-C in the connected wallet, base units
  const [amount, setAmount] = useState('');
  const [burnAmount, setBurnAmount] = useState('');
  const [toAddress, setToAddress] = useState('');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState(null);             // { kind, text }
  const [reviewing, setReviewing] = useState(false);
  const alive = useRef(true);
  const requestIds = useRef(makeRequestIdStore('bridge')).current;
  useEffect(() => () => { alive.current = false; }, []);

  const configured = !!(cfg?.chain_id && cfg?.icec_community_address);
  const net = networkStatus({ walletChainId: wallet.chainId, expectedChainId: cfg?.chain_id });
  const addresses = useMemo(() => (overview?.addresses || []).filter((a) => !a.revoked), [overview]);
  const connectedLinked = !!wallet.account && addresses.some((a) => sameAddress(a.address, wallet.account));
  const say = (kind, text) => setNotice({ kind, text });

  const refresh = useCallback(async () => {
    if (!userId) return;
    const o = await getChainOverview().catch(() => null);
    if (alive.current && o && !o.missing) setOverview(o);
    try { const b = await getBalance(userId); if (alive.current) setLedger(Number(b.ican) || 0); } catch { /* keep the last figure */ }
  }, [userId]);

  const loadOnchain = useCallback(async () => {
    if (!configured || !wallet.account || net !== 'ok') { setOnchain(null); return; }
    try {
      const bal = await communityContract(wallet.getProvider(), cfg).balanceOf(wallet.account);
      if (alive.current) setOnchain(bal);
    } catch { /* keep the last figure */ }
  }, [configured, wallet, net, cfg]);

  // faster while something is on its way, slower when idle
  const inFlight = (overview?.withdrawals || []).some((w) => w.status === 'pending' || w.status === 'submitted');
  useEffect(() => {
    refresh(); loadOnchain();
    const t = setInterval(() => { if (document.visibilityState !== 'hidden') { refresh(); loadOnchain(); } }, inFlight ? 8_000 : 30_000);
    return () => clearInterval(t);
  }, [refresh, loadOnchain, inFlight]);

  // default the destination to the connected, linked address
  useEffect(() => {
    if (!toAddress && addresses.length) setToAddress((addresses.find((a) => sameAddress(a.address, wallet.account)) || addresses[0]).address);
  }, [addresses, wallet.account, toAddress]);

  const linkThisWallet = async () => {
    setBusy('link'); setNotice(null);
    try {
      const ch = await requestLinkChallenge(wallet.account);
      if (ch.already_linked) { say('ok', 'This wallet is already linked.'); return; }
      if (!ch.success) { say('err', ch.error || 'Could not start linking.'); return; }
      const signature = await wallet.signText(ch.message);        // proves you hold the key; moves no funds
      const res = await submitLink({ challengeId: ch.challenge_id, signature });
      say(res.success ? 'ok' : 'err', res.success ? 'Wallet linked.' : res.error);
    } catch (e) {
      say('err', friendlyChainError(e));
    } finally { setBusy(''); refresh(); }
  };

  const unlink = async (address) => {
    setBusy('unlink'); setNotice(null);
    const res = await unlinkAddress(address).catch((e) => ({ success: false, error: e.message }));
    say(res.success ? 'ok' : 'err', res.success ? (res.refunded_withdrawals ? `Address removed. ${res.refunded_icec} ICEC that had not been sent yet went back to your balance.` : 'Address removed.') : res.error);
    setBusy(''); refresh();
  };

  const wcheck = checkWithdraw({ amount, ledgerBalance: ledger, min: cfg?.min_withdrawal_icec, max: cfg?.max_withdrawal_icec, addressLinked: addresses.some((a) => sameAddress(a.address, toAddress)) });

  const withdraw = async () => {
    if (!wcheck.ok || busy) return;
    setBusy('withdraw'); setNotice(null);
    const res = await requestWithdrawal({ amount: Number(amount), address: toAddress, requestId: requestIds.idFor(`${amount}|${toAddress}`) });
    setBusy(''); setReviewing(false);
    if (res.success) { requestIds.clear(); setAmount(''); say('ok', res.duplicate ? 'That withdrawal was already started.' : `Started. ${amount} ICEC is locked in IcanEra and will appear in your wallet shortly.`); }
    else say('err', res.error);
    refresh();
  };

  const cancel = async (id) => {
    setBusy(`cancel:${id}`); setNotice(null);
    const res = await cancelWithdrawal(id).catch((e) => ({ success: false, error: e.message }));
    say(res.success ? 'ok' : 'err', res.success ? 'Cancelled. The ICEC is back in your IcanEra balance.' : (res.error || 'Could not cancel.'));
    setBusy(''); refresh();
  };

  const bcheck = checkBurn({ amount: burnAmount, balance: onchain });
  const burn = async () => {
    if (!bcheck.ok || busy) return;
    setBusy('burn'); setNotice(null);
    try {
      const signer = await wallet.getRunner();
      const sent = await communityContract(signer, cfg).burnForCredit(bcheck.units, newCreditId());
      say('info', 'Sent. Waiting for the network to confirm…');
      await sent.wait();
      setBurnAmount('');
      say('ok', `Done. It returns to your IcanEra balance after ${cfg.confirmations || 12} more blocks (usually a few minutes).`);
    } catch (e) {
      say('err', friendlyChainError(e));
    } finally { setBusy(''); loadOnchain(); refresh(); }
  };

  const explorer = (kind, v) => explorerLink(cfg?.explorer_url, kind, v);
  const noticeCls = { ok: 'bg-emerald-500/10 text-emerald-300', err: 'bg-red-500/10 text-red-300', info: 'bg-slate-800 text-slate-300' };

  return (
    <div className="space-y-4 text-slate-200" data-testid="community-panel">
      <div>
        <h3 className="text-xl font-bold text-white">ICEC-C <span className="text-sm font-normal text-slate-400">· the community form</span></h3>
        <p className="text-sm text-slate-400">Your icaneracoin on the blockchain, as a public receipt. It moves with the IcanEra coin price, the same as your ledger coin.</p>
      </div>
      {cfg?.is_testnet && <p className="text-xs rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-300 p-3">This is a test network. Test tokens have no real value.</p>}
      <p className="rounded-lg border border-slate-800 bg-slate-900/60 p-3 text-xs text-slate-400">
        Moving it onto the chain does not make it worth more or protect its value, and ICEC-C cannot be sent to anyone else: it can only come back to IcanEra.
        While it is on the chain it is locked in IcanEra, so your IcanEra balance is lower by the same amount.
      </p>

      {!configured ? <p className="text-sm text-slate-400">ICEC-C is not live on this network yet.</p>
        : !userId ? <p className="text-sm text-slate-400">Sign in to move icaneracoin onto the chain.</p>
        : !wallet.available ? (
          <div className="rounded-lg border border-slate-800 bg-slate-900 p-4 text-sm text-slate-300">
            To hold ICEC-C you need your own crypto wallet. Install one such as MetaMask in this browser, or open this page inside your wallet app.
          </div>
        ) : !wallet.account ? (
          <div className="space-y-2">
            <button type="button" onClick={wallet.connect} disabled={wallet.connecting} className="rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-bold text-slate-900 disabled:opacity-50">{wallet.connecting ? 'Waiting for your wallet…' : 'Connect wallet'}</button>
            {wallet.error && <p className="text-sm text-red-400" role="alert">{wallet.error}</p>}
          </div>
        ) : net !== 'ok' ? (
          <div className="space-y-2 rounded-lg border border-slate-800 bg-slate-900 p-4">
            <p className="text-sm text-slate-300">Your wallet is on a different network. ICEC-C lives on <b>{cfg.chain_name || `chain ${cfg.chain_id}`}</b>.</p>
            <button type="button" onClick={() => wallet.switchNetwork({ chainId: cfg.chain_id, name: cfg.chain_name, explorerUrl: cfg.explorer_url })} className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-bold text-slate-900">Switch network</button>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>Connected: <span className="font-mono text-slate-200">{shortAddress(wallet.account)}</span></span>
              <button type="button" onClick={() => { refresh(); loadOnchain(); }} className="inline-flex items-center gap-1 hover:text-white" aria-label="Refresh"><RefreshCw className="h-3.5 w-3.5" /> Refresh</button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl border border-slate-800 bg-slate-900 p-3"><div className="text-xs text-slate-500">In IcanEra</div><div className="text-xl font-semibold text-white" data-testid="ledger-balance">{ledger == null ? '—' : ledger.toLocaleString(undefined, { maximumFractionDigits: 8 })}</div><div className="text-xs text-slate-400">ICEC</div></div>
              <div className="rounded-xl border border-slate-800 bg-slate-900 p-3"><div className="text-xs text-slate-500">In your wallet</div><div className="text-xl font-semibold text-white" data-testid="onchain-balance">{onchain == null ? '—' : formatUnits(onchain, ICEC_C_DECIMALS)}</div><div className="text-xs text-slate-400">ICEC-C</div></div>
            </div>

            {!connectedLinked && (
              <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 space-y-2">
                <p className="text-sm text-slate-300">Link this wallet to your IcanEra account. You sign a short message to show it is yours; this moves no money.</p>
                <button type="button" onClick={linkThisWallet} disabled={busy === 'link'} className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-bold text-slate-900 disabled:opacity-50">{busy === 'link' ? 'Waiting for your wallet…' : `Link ${shortAddress(wallet.account)}`}</button>
              </div>
            )}

            {addresses.length > 0 && (
              <div className="rounded-xl border border-slate-800 bg-slate-900 p-3 text-sm">
                <div className="mb-1 text-xs uppercase tracking-wide text-slate-500">Your linked wallets</div>
                {addresses.map((a) => (
                  <div key={a.address} className="flex items-center justify-between py-1">
                    <span className="font-mono text-slate-200">{shortAddress(a.address)}{sameAddress(a.address, wallet.account) ? <span className="ml-2 text-xs text-emerald-400">connected</span> : null}</span>
                    <button type="button" onClick={() => unlink(a.address)} disabled={!!busy} className="text-xs text-slate-400 hover:text-red-300">Remove</button>
                  </div>
                ))}
              </div>
            )}

            {addresses.length > 0 && (
              <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 space-y-3">
                <h4 className="text-sm font-semibold text-white">Move ICEC onto the chain</h4>
                {!cfg.bridge_enabled && <p className="text-sm text-amber-400">Moving ICEC onto the chain is paused right now. You can still bring ICEC-C back.</p>}
                {addresses.length > 1 && (
                  <label className="block text-xs text-slate-400">Send to
                    <select value={toAddress} onChange={(e) => setToAddress(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white">
                      {addresses.map((a) => <option key={a.address} value={a.address}>{shortAddress(a.address)}</option>)}
                    </select>
                  </label>
                )}
                <label className="block text-xs text-slate-400">Amount (ICEC)
                  <input type="text" inputMode="decimal" autoComplete="off" value={amount} placeholder="0" aria-label="Amount to move onto the chain"
                    onChange={(e) => { setNotice(null); setReviewing(false); setAmount(e.target.value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1')); }}
                    className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-base text-white" />
                </label>
                <p className="text-xs text-slate-500">From {cfg.min_withdrawal_icec} to {cfg.max_withdrawal_icec} ICEC at a time. No fee from IcanEra.</p>
                {wcheck.error && <p className="text-sm text-amber-400" role="alert">{wcheck.error}</p>}
                {reviewing ? (
                  <div className="space-y-2">
                    <p className="text-sm text-white">Lock {amount} ICEC in IcanEra and send {amount} ICEC-C to {shortAddress(toAddress)}?</p>
                    <div className="grid grid-cols-2 gap-2">
                      <button type="button" onClick={() => setReviewing(false)} className="rounded-lg border border-slate-600 py-2 text-sm text-slate-300">Back</button>
                      <button type="button" onClick={withdraw} disabled={busy === 'withdraw'} className="rounded-lg bg-amber-500 py-2 text-sm font-bold text-slate-900 disabled:opacity-50">{busy === 'withdraw' ? 'Working…' : 'Confirm'}</button>
                    </div>
                  </div>
                ) : (
                  <button type="button" disabled={!wcheck.ok || !cfg.bridge_enabled} onClick={() => setReviewing(true)} className="w-full rounded-lg bg-emerald-600 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40">Review</button>
                )}
              </div>
            )}

            {(overview?.withdrawals || []).length > 0 && (
              <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900">
                <table className="w-full text-sm">
                  <caption className="px-4 pb-1 pt-3 text-left text-xs uppercase tracking-wide text-slate-500">Your withdrawals</caption>
                  <tbody>
                    {overview.withdrawals.map((w) => {
                      const st = withdrawalStatus(w);
                      return (
                        <tr key={w.id} className="border-t border-slate-800">
                          <td className="px-4 py-2 tabular-nums">{Number(w.amount).toLocaleString(undefined, { maximumFractionDigits: 8 })}</td>
                          <td className="px-2 font-mono text-xs text-slate-400">{shortAddress(w.to_address)}</td>
                          <td className={`px-2 ${TONE[st.tone]}`} title={st.help}>{st.label}{w.minted_tx_hash && explorer('tx', w.minted_tx_hash) ? <a href={explorer('tx', w.minted_tx_hash)} target="_blank" rel="noreferrer" className="ml-1 inline-block align-middle" aria-label="View on the explorer"><ExternalLink className="h-3 w-3" /></a> : null}</td>
                          <td className="px-3 text-right">{w.cancellable && <button type="button" onClick={() => cancel(w.id)} disabled={!!busy} className="text-xs text-amber-300 hover:text-amber-200">Cancel</button>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 space-y-3">
              <h4 className="text-sm font-semibold text-white">Bring ICEC-C back to IcanEra</h4>
              {!connectedLinked && <p className="text-sm text-amber-400">Only burn from a wallet you have linked. ICEC-C burned from an unlinked address is not credited to your account.</p>}
              <label className="block text-xs text-slate-400">Amount (ICEC-C)
                <div className="mt-1 flex gap-2">
                  <input type="text" inputMode="decimal" autoComplete="off" value={burnAmount} placeholder="0" aria-label="Amount to bring back"
                    onChange={(e) => { setNotice(null); setBurnAmount(e.target.value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1')); }}
                    className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-base text-white" />
                  {onchain != null && onchain > 0n && <button type="button" onClick={() => setBurnAmount(formatUnits(onchain, ICEC_C_DECIMALS).replace(/,/g, ''))} className="rounded-lg border border-slate-700 px-3 text-xs text-slate-300 hover:text-white">Max</button>}
                </div>
              </label>
              {bcheck.error && <p className="text-sm text-amber-400" role="alert">{bcheck.error}</p>}
              <button type="button" onClick={burn} disabled={!bcheck.ok || !connectedLinked || busy === 'burn'} className="w-full rounded-lg bg-emerald-600 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40">{busy === 'burn' ? 'Waiting for your wallet…' : 'Bring back to IcanEra'}</button>
            </div>

            {(overview?.burns || []).length > 0 && (
              <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900">
                <table className="w-full text-sm">
                  <caption className="px-4 pb-1 pt-3 text-left text-xs uppercase tracking-wide text-slate-500">Brought back</caption>
                  <tbody>
                    {overview.burns.map((b) => {
                      const st = burnStatus(b);
                      return (
                        <tr key={`${b.tx_hash}:${b.created_at}`} className="border-t border-slate-800">
                          <td className="px-4 py-2 tabular-nums">{Number(b.amount).toLocaleString(undefined, { maximumFractionDigits: 8 })}</td>
                          <td className={`px-2 ${TONE[st.tone]}`} title={st.help}>{st.label}</td>
                          <td className="px-3 text-right text-xs text-slate-500">{new Date(b.created_at).toLocaleString()}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      {notice && <p className={`rounded-md px-3 py-2 text-sm ${noticeCls[notice.kind]}`} role="status">{notice.text}</p>}
    </div>
  );
}
