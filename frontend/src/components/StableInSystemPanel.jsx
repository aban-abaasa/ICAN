import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import IcanTradingChart from './IcanTradingChart';
import LearnTab from './LearnTab';
import { getQuote, getHistory, getMyPosition, getMyFills, getMyWallets, swapStable } from '../services/stableUnitService';
import { makeRequestIdStore } from '../utils/tradeResult';
import {
  trim, previewBuy, previewSell, validateBuy, validateSell, friendlyStableError, historyToRows, rateAge,
} from '../utils/stableUnitRules';

// ICEC-S, the stable form of icaneracoin, inside IcanEra: no blockchain, no gas, no wallet to connect. One ICEC-S is worth
// one US dollar at the live rates the platform's hourly currency feed keeps (public.ican_currency_rates, the same table
// icaneracoin is priced from), and never less than its start value grown by inflation. You buy it from any wallet you hold
// and sell it back into any wallet. The price, the fee, the exchange rate and every check are the database's
// (ican_stable_swap); this screen previews, asks and reports.

const POLL_MS = 60_000;

export default function StableInSystemPanel() {
  const { user } = useAuth();
  const userId = user?.id || null;
  const [quote, setQuote] = useState(undefined);        // undefined: loading
  const [history, setHistory] = useState([]);
  const [wallets, setWallets] = useState([]);
  const [position, setPosition] = useState({ units: 0, cost_ugx: 0, value_ugx: null });
  const [fills, setFills] = useState([]);
  const [mode, setMode] = useState('buy');
  const [currency, setCurrency] = useState('UGX');
  const [amount, setAmount] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const requestIds = useRef(makeRequestIdStore('stable')).current;
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const loadMarket = useCallback(async () => {
    try {
      const [q, h] = await Promise.all([getQuote(), getHistory(500)]);
      if (!alive.current) return;
      setQuote(q);
      setHistory(h);
    } catch {
      if (alive.current) setQuote((cur) => (cur === undefined ? { available: false } : cur));
    }
  }, []);
  const loadMine = useCallback(async () => {
    if (!userId) return;
    try {
      const [w, p, f] = await Promise.all([getMyWallets(userId), getMyPosition(), getMyFills(8)]);
      if (!alive.current) return;
      setWallets(w); setPosition(p); setFills(f);
    } catch { /* keep what is on screen */ }
  }, [userId]);

  useEffect(() => {
    loadMarket(); loadMine();
    const t = setInterval(() => { if (document.visibilityState !== 'hidden') loadMarket(); }, POLL_MS);
    return () => clearInterval(t);
  }, [loadMarket, loadMine]);

  // default the wallet to UGX if there is one, else the first
  useEffect(() => {
    if (wallets.length && !wallets.some((w) => w.currency === currency)) setCurrency((wallets.find((w) => w.currency === 'UGX') || wallets[0]).currency);
  }, [wallets, currency]);

  const rows = useMemo(() => historyToRows(history), [history]);
  const wallet = wallets.find((w) => w.currency === currency);
  const held = Number(position.units) || 0;
  const num = Number(amount);

  const buy = mode === 'buy';
  const problem = quote?.available && amount !== ''
    ? (buy ? validateBuy({ amount: num, balance: wallet?.balance, quote, currency }) : validateSell({ units: num, held, quote, currency }))
    : null;
  const preview = quote?.available && num > 0 && !problem
    ? (buy ? previewBuy({ amount: num, currency, quote }) : previewSell({ units: num, currency, quote }))
    : null;
  const open = !!quote?.available && quote.trading_enabled && quote.has_capacity !== false;
  const ready = !!preview && !problem && (buy ? open : !!quote?.trading_enabled) && !busy && !!userId && !!wallet;

  const say = (kind, text) => setNotice({ kind, text });
  const reset = () => { setAmount(''); setReviewing(false); };

  const submit = async () => {
    if (!ready) return;
    setBusy(true); setNotice(null);
    const res = await swapStable({
      side: mode, amount: num, currency, expectedUnitUgx: Number(quote.unit_ugx),
      requestId: requestIds.idFor(`${mode}|${currency}|${amount}`),
    });
    setBusy(false); setReviewing(false);
    if (res.success) {
      requestIds.clear(); setAmount('');
      say('ok', res.duplicate ? 'That swap was already done.'
        : mode === 'buy' ? `Done. You now hold ${trim(res.newUnits, 8)} ICEC-S.` : `Done. ${trim(res.payAmount, 2)} ${res.payCurrency} was added to your wallet.`);
    } else {
      say('err', friendlyStableError(res));
    }
    loadMine(); loadMarket();
  };

  if (quote === undefined) return <p className="text-sm text-slate-500">Loading…</p>;
  if (quote.missing) return <p className="text-sm text-slate-400">ICEC-S is not installed yet.</p>;
  if (!quote.available) return <p className="text-sm text-slate-400">The live exchange rates are not available right now. Please try again shortly.</p>;

  const local = quote.currencies?.[currency];
  const status = quote.rates_stale ? { text: 'Rates updating', dot: 'bg-amber-400' } : { text: 'Live', dot: 'bg-emerald-400' };
  const noticeCls = { ok: 'bg-emerald-500/10 text-emerald-300', err: 'bg-red-500/10 text-red-300' };

  return (
    <div className="space-y-4 text-slate-200" data-testid="stable-panel">
      <LearnTab
        items={[
          { q: 'What is ICEC-S?', a: 'The stable form of icaneracoin. One ICEC-S is worth one US dollar. It lives inside IcanEra, so there is no blockchain, no gas fee and no outside wallet to connect.' },
          { q: 'Where does its price come from?', a: 'The same live currency rates icaneracoin uses, refreshed every hour. The value in each currency is the dollar rate for that currency, so a wallet in any currency sees the same value.' },
          { q: 'How does it protect against inflation?', a: `It rises with the dollar when the shilling weakens, and it never goes below its start value grown by Uganda's yearly inflation (${trim(quote.inflation_pct, 2)}% now). Nobody can promise it will beat inflation by more than that.` },
          { q: 'What backs it?', a: 'The other holders. Everything people pay in becomes one shared pool, and everything people sell comes out of it, so there is no company reserve to fund and nothing to switch on. While the pool holds a dollar for each ICEC-S, one ICEC-S is a dollar. If the shilling falls so sharply that the pool holds less than that, everyone holds the same smaller share until the rate recovers, and the screen tells you. It is not a bank deposit and nobody guarantees the dollar beyond the pool.' },
          { q: 'What does it cost, and what are the limits?', a: `A ${trim(quote.fee_bps / 100, 2)}% fee on each buy and each sell. Up to UGX ${trim(quote.max_trade_ugx, 0)} per swap. Swaps pause whenever the live rates are more than a few hours old.` },
        ]}
      />

      {/* what one ICEC-S is worth right now */}
      <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">1 ICEC-S =</p>
            <p className="text-3xl font-bold leading-tight text-white">{trim(local, 2)} <span className="text-base font-semibold text-slate-400">{currency}</span></p>
            <p className="text-sm text-slate-400">{quote.pool_short ? 'the pool\'s share of a dollar' : '1 US dollar'}{currency !== 'UGX' ? ` · UGX ${trim(quote.unit_ugx, 2)}` : ''}</p>
          </div>
          <div className="text-right">
            <span className="inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs text-slate-300" aria-live="polite">
              <span className={`h-2 w-2 rounded-full ${status.dot}`} />{status.text}
            </span>
            <p className="mt-1 text-[11px] text-slate-500">Rates {rateAge(quote.rates_updated_at)}</p>
          </div>
        </div>
        {quote.pool_short && (
          <p className="mt-3 rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-300" role="status">
            The pool holds less than a dollar per ICEC-S right now (a dollar is UGX {trim(quote.dollar_ugx, 2)}). Everyone shares the same smaller value until the rate recovers.
          </p>
        )}
        {quote.protected && (
          <p className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-300">
            <ShieldCheck className="h-3.5 w-3.5" /> Inflation floor active: UGX {trim(quote.floor_ugx, 2)}
          </p>
        )}
      </div>

      {/* chart & analysis */}
      <section className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-950" aria-label="ICEC-S value chart and analysis">
        <p className="px-4 pt-3 text-sm text-slate-400">Value &amp; analysis</p>
        <div className="mt-2 h-[22rem] w-full sm:h-[26rem]">
          <IcanTradingChart rows={rows} loading={false} theme="dark" wheelZoom={false} feedState={quote.rates_stale ? 'delayed' : 'live'}
            symbol="ICEC-S / UGX" initialTimeframe="1h" emptyNote="The value is recorded every hour from the live rates. Nothing here is simulated." />
        </div>
      </section>

      {/* the swap */}
      <div className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-4">
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-950 p-1" role="tablist" aria-label="Buy or sell">
          {['buy', 'sell'].map((m) => (
            <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => { setMode(m); reset(); setNotice(null); }}
              className={`rounded-md py-2 text-sm font-semibold capitalize ${mode === m ? (m === 'buy' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white') : 'text-slate-400 hover:text-white'}`}>{m}</button>
          ))}
        </div>

        {!userId ? <p className="text-sm text-slate-400">Sign in to swap.</p> : wallets.length === 0 ? <p className="text-sm text-slate-400">You have no wallet to swap from yet.</p> : (
          <>
            <label className="block text-xs text-slate-400">{buy ? 'Pay from' : 'Receive in'}
              <select value={currency} onChange={(e) => { setCurrency(e.target.value); reset(); }}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white">
                {wallets.map((w) => <option key={w.currency} value={w.currency}>{w.currency} wallet · {trim(w.balance, 2)}</option>)}
              </select>
            </label>
            <label className="block text-xs text-slate-400">{buy ? `Amount to spend (${currency})` : `ICEC-S to sell (you hold ${trim(held, 8)})`}
              <div className="mt-1 flex gap-2">
                <input type="text" inputMode="decimal" autoComplete="off" value={amount} placeholder="0" aria-label="Amount"
                  onChange={(e) => { setNotice(null); setReviewing(false); setAmount(e.target.value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1')); }}
                  className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-base text-white" />
                {buy && wallet && wallet.balance > 0 && <button type="button" onClick={() => setAmount(String(Math.floor(wallet.balance * 100) / 100))} className="rounded-lg border border-slate-700 px-3 text-xs text-slate-300 hover:text-white">Max</button>}
                {!buy && held > 0 && <button type="button" onClick={() => setAmount(String(held))} className="rounded-lg border border-slate-700 px-3 text-xs text-slate-300 hover:text-white">Max</button>}
              </div>
            </label>

            {preview && (
              <dl className="space-y-1 rounded-lg border border-slate-800 bg-slate-950 p-3 text-sm">
                {buy ? (
                  <div className="flex justify-between"><dt className="text-slate-400">You get about</dt><dd className="font-semibold text-white">{trim(preview.units, 8)} ICEC-S</dd></div>
                ) : (
                  <div className="flex justify-between"><dt className="text-slate-400">You get about</dt><dd className="font-semibold text-white">{trim(preview.local, 2)} {currency}</dd></div>
                )}
                <div className="flex justify-between"><dt className="text-slate-400">Fee ({trim(quote.fee_bps / 100, 2)}%)</dt><dd>UGX {trim(preview.fee, 2)}</dd></div>
              </dl>
            )}
            {problem && <p className="text-sm text-amber-400" role="alert">{problem}</p>}
            {!quote.trading_enabled && <p className="text-sm text-slate-400">{quote.rates_stale ? 'Swaps are paused while the live rates update.' : 'ICEC-S is not open for swaps yet.'}</p>}

            {reviewing ? (
              <div className="space-y-2">
                <p className="text-sm text-white">{buy ? `Swap ${trim(num, 2)} ${currency} for about ${trim(preview?.units, 8)} ICEC-S?` : `Sell ${trim(num, 8)} ICEC-S for about ${trim(preview?.local, 2)} ${currency}?`}</p>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => setReviewing(false)} disabled={busy} className="rounded-lg border border-slate-600 py-2 text-sm text-slate-300">Back</button>
                  <button type="button" onClick={submit} disabled={busy} className="rounded-lg bg-amber-500 py-2 text-sm font-bold text-slate-900 disabled:opacity-50">{busy ? 'Working…' : 'Confirm'}</button>
                </div>
              </div>
            ) : (
              <button type="button" disabled={!ready} onClick={() => setReviewing(true)}
                className={`w-full rounded-lg py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40 ${buy ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-red-600 hover:bg-red-500'}`}>Review {mode}</button>
            )}
          </>
        )}
        {notice && <p className={`rounded-md px-3 py-2 text-sm ${noticeCls[notice.kind]}`} role="status">{notice.text}</p>}
      </div>

      {/* what you hold */}
      {userId && (held > 0 || fills.length > 0) && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl border border-slate-800 bg-slate-900 p-3"><div className="text-xs text-slate-500">You hold</div><div className="text-xl font-semibold text-white">{trim(held, 8)}</div><div className="text-xs text-slate-400">ICEC-S</div></div>
            <div className="rounded-xl border border-slate-800 bg-slate-900 p-3"><div className="text-xs text-slate-500">Worth now</div><div className="text-xl font-semibold text-white">{position.value_ugx == null ? '—' : trim(position.value_ugx, 0)}</div><div className="text-xs text-slate-400">UGX</div></div>
          </div>
          {fills.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900">
              <table className="w-full text-xs">
                <caption className="px-4 pb-1 pt-3 text-left text-xs uppercase tracking-wide text-slate-500">Recent swaps</caption>
                <tbody>
                  {fills.map((f) => (
                    <tr key={f.id} className="border-t border-slate-800 text-slate-300">
                      <td className="px-4 py-2 text-slate-500">{new Date(f.created_at).toLocaleString()}</td>
                      <td className={f.side === 'buy' ? 'text-emerald-400' : 'text-red-400'}>{f.side === 'buy' ? 'Bought' : 'Sold'}</td>
                      <td className="text-right">{trim(f.units, 8)}</td>
                      <td className="px-4 text-right">{trim(f.pay_amount, 2)} {f.pay_currency}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      <button type="button" onClick={() => { loadMarket(); loadMine(); }} className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-white"><RefreshCw className="h-3.5 w-3.5" /> Refresh</button>
    </div>
  );
}
