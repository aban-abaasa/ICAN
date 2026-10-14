import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase/client';
import { useAuth } from '../context/AuthContext';
import { getBalance } from '../services/icanWalletService';
import { tradeSector, getMyHoldings, getMyFills } from '../services/sectorMarketService';
import { useSectorMarkets } from '../hooks/useSectorMarkets';
import { makeRequestIdStore } from '../utils/tradeResult';
import {
  ICEC, quoteBuy, quoteSell, validateBuy, validateSell, sectorState, friendlySectorError,
  formatLevel, formatPct, formatPrice, changeTone, holdingResult, trim, floor8,
} from '../utils/sectorTradeRules';
import SectorIndexChart from './SectorIndexChart';

// Sector Markets: ten sector index coins, bought and sold with icaneracoin (or any wallet the user holds). Each index
// follows the anonymous revenue totals of businesses in that sector on IcanEra. Nothing here invents money logic: the
// price, the fee and every check are the database's (public.ican_sector_trade); this screen previews, asks and reports.

const TONE_TEXT = { up: 'text-emerald-400', down: 'text-red-400', flat: 'text-slate-400' };
const STATE_DOT = { live: 'bg-emerald-400', warming: 'bg-amber-400', paused: 'bg-slate-500' };
const STATUS_TEXT = { connecting: 'Connecting…', live: 'Live', delayed: 'Delayed', offline: 'Offline' };
const STATUS_DOT = { connecting: 'bg-slate-500', live: 'bg-emerald-400', delayed: 'bg-amber-400', offline: 'bg-red-500' };

const useMoneyWallet = (userId) => {
  const [wallet, setWallet] = useState(null); // { currency, balance, price } -- price = ICEC cost in that currency
  const load = useCallback(async () => {
    if (!userId) { setWallet(null); return; }
    try {
      const { data: info } = await supabase.rpc('get_my_ican_trading_info');
      const currency = info?.currency ? String(info.currency).toUpperCase() : null;
      const price = Number(info?.price_per_ican);
      if (!currency || currency === ICEC || !(price > 0)) { setWallet(null); return; }
      const { data } = await supabase.from('wallet_accounts').select('balance').eq('user_id', userId).eq('currency', currency).maybeSingle();
      setWallet(data ? { currency, balance: parseFloat(data.balance) || 0, price } : null);
    } catch {
      setWallet(null);
    }
  }, [userId]);
  useEffect(() => { load(); }, [load]);
  return [wallet, load];
};

export default function SectorMarketsPanel() {
  const { user } = useAuth();
  const userId = user?.id || null;

  const [selected, setSelected] = useState(null);
  const { available, sectors, candles, status, tradingEnabled, feeBps, maxTradeIcec, loading, error, refresh } = useSectorMarkets(selected);

  const [mode, setMode] = useState('buy');
  const [amount, setAmount] = useState('');
  const [payWith, setPayWith] = useState(ICEC);
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null); // { kind: 'ok' | 'err', text }

  const [icec, setIcec] = useState(null);
  const [holdings, setHoldings] = useState([]);
  const [fills, setFills] = useState([]);
  const [money, reloadMoney] = useMoneyWallet(userId);
  const requestIds = useRef(makeRequestIdStore('sector')).current;

  // first load: open the first live sector, or the first one
  useEffect(() => {
    if (selected || !sectors.length) return;
    setSelected((sectors.find((s) => s.status === 'live') || sectors[0]).ticker);
  }, [sectors, selected]);

  const refreshMine = useCallback(async () => {
    if (!userId) { setIcec(null); setHoldings([]); setFills([]); return; }
    try { const b = await getBalance(userId); setIcec(Number(b.ican) || 0); } catch { /* keep the last balance */ }
    try { setHoldings((await getMyHoldings()).holdings); } catch { /* keep the last list */ }
    try { setFills((await getMyFills(10)).fills); } catch { /* keep the last list */ }
    reloadMoney();
  }, [userId, reloadMoney]);

  useEffect(() => {
    refreshMine();
    if (!userId) return undefined;
    const t = setInterval(() => { if (document.visibilityState !== 'hidden') refreshMine(); }, 30_000);
    return () => clearInterval(t);
  }, [userId, refreshMine]);

  // changing what is being traded cancels a half-made review; picking another sector or side clears the last message
  // (typing a new amount clears it too, in the input handler: it must NOT clear here, or the success message that
  // follows emptying the box after a trade would vanish at once)
  useEffect(() => { setReviewing(false); }, [selected, mode, payWith, amount]);
  useEffect(() => { setNotice(null); }, [selected, mode]);
  useEffect(() => { if (payWith !== ICEC && !money) setPayWith(ICEC); }, [money, payWith]);

  const sel = useMemo(() => sectors.find((s) => s.ticker === selected) || null, [sectors, selected]);
  const state = sectorState(sel, tradingEnabled);
  const price = sel?.price_icec != null ? Number(sel.price_icec) : null;
  const held = Number(holdings.find((h) => h.sector === selected)?.units) || 0;
  const num = Number(amount);

  // what the entered amount is worth in ICEC (a money wallet is converted at the coin's price in that currency)
  const inMoney = payWith !== ICEC && money;
  const payIcec = mode === 'buy' ? (inMoney ? floor8(num / money.price) : num) : null;
  const balance = mode === 'buy' ? (inMoney ? money.balance : icec) : held;
  const buyQuote = mode === 'buy' ? quoteBuy({ amount: payIcec, price, feeBps }) : null;
  const sellQuote = mode === 'sell' ? quoteSell({ units: num, price, feeBps }) : null;
  const problem = !amount ? null
    : mode === 'buy'
      ? validateBuy({ amount: num, balance: Number.isFinite(balance) ? balance : undefined, payIcec, price, feeBps, maxTrade: maxTradeIcec })
      : validateSell({ units: num, held, price, feeBps, maxTrade: maxTradeIcec });
  const ready = !!userId && state.canTrade && price > 0 && num > 0 && !problem;
  const feePct = feeBps / 100;
  const proceedsIn = inMoney ? money.currency : ICEC;

  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setNotice(null);
    const requestId = requestIds.idFor(`${mode}|${selected}|${amount}|${payWith}`);
    const res = await tradeSector({ sector: selected, side: mode, amount: num, currency: payWith, requestId, expectedPrice: price, maxSlippagePct: 1 });
    setBusy(false);
    setReviewing(false);
    if (res.success) {
      requestIds.clear();
      setAmount('');
      setNotice({
        kind: 'ok',
        text: res.side === 'buy'
          ? `Bought ${trim(res.units, 8)} ${res.sector} at ${formatPrice(res.priceIcec)} ICEC.`
          : `Sold ${trim(res.units, 8)} ${res.sector} for ${trim(res.payAmount ?? res.netIcec, 8)} ${res.payAmount != null ? payWith : 'ICEC'}.`,
      });
      refreshMine();
      refresh();
    } else {
      if (res.code === 'price_moved') refresh();
      setNotice({ kind: 'err', text: friendlySectorError(res) });
    }
  };

  if (!available) return null;

  return (
    <div className="space-y-4 text-slate-200">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-xl font-bold text-white">Sector Markets</h3>
          <p className="text-sm text-slate-400">Ten sector coins that follow what businesses on IcanEra earn. Trade them with IcanEra coin.</p>
        </div>
        <span className="inline-flex items-center gap-2 text-xs text-slate-400" aria-live="polite">
          <span className={`w-2 h-2 rounded-full ${STATUS_DOT[status]}`} />{STATUS_TEXT[status]}
        </span>
      </div>

      <p className="text-xs text-slate-500 border border-slate-800 rounded-lg p-3 bg-slate-900/60">
        Prices come from combined, anonymous sales totals; no business or customer is ever named. They can fall as well as rise,
        and you can lose what you put in. You trade against the IcanEra market vault.{feeBps ? ` A ${trim(feePct, 2)}% fee applies to each buy and sell.` : ''}
      </p>

      {error && <p className="text-sm text-red-400" role="alert">Could not load the markets. Retrying…</p>}
      {loading && !sectors.length && <p className="text-sm text-slate-500">Loading markets…</p>}

      {/* the ten sectors */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
        {sectors.map((s) => {
          const st = sectorState(s, tradingEnabled);
          const active = s.ticker === selected;
          return (
            <button
              key={s.ticker}
              type="button"
              onClick={() => setSelected(s.ticker)}
              aria-pressed={active}
              className={`rounded-xl border p-3 text-left transition ${active ? 'border-amber-400 bg-slate-800' : 'border-slate-700 bg-slate-900 hover:border-slate-500'}`}
            >
              <div className="flex items-center justify-between">
                <span className="font-mono font-bold text-amber-300">{s.ticker}</span>
                <span className={`w-2 h-2 rounded-full ${STATE_DOT[st.kind]}`} aria-hidden="true" />
              </div>
              <div className="text-xs text-slate-400 truncate">{s.name}</div>
              <div className="mt-1 text-lg font-semibold text-white">{formatLevel(s.level)}</div>
              <div className={`text-xs ${TONE_TEXT[changeTone(s.change_24h_pct)]}`}>{s.level != null ? formatPct(s.change_24h_pct) : ' '}</div>
              <div className="text-[11px] text-slate-500 leading-tight mt-0.5">{st.label}</div>
            </button>
          );
        })}
      </div>

      {sel && (
        <div className="grid gap-4 lg:grid-cols-5">
          {/* chart */}
          <div className="lg:col-span-3 rounded-xl border border-slate-800 bg-slate-950 p-3">
            <div className="flex items-baseline justify-between mb-1">
              <div>
                <span className="font-mono font-bold text-amber-300">{sel.ticker}</span>
                <span className="ml-2 text-sm text-slate-400">{sel.name}</span>
              </div>
              <div className="text-right">
                <div className="text-lg font-semibold text-white">{formatLevel(sel.level)}</div>
                <div className="text-xs text-slate-500">{price != null ? `${formatPrice(price)} ICEC per unit` : 'not priced yet'}</div>
              </div>
            </div>
            {sel.description && <p className="text-xs text-slate-500 mb-2">{sel.description}</p>}
            {state.kind === 'warming'
              ? <p className="py-10 text-center text-sm text-slate-400">{state.label}. A sector opens once enough businesses are contributing that no single one can be identified.</p>
              : <SectorIndexChart candles={candles} ticker={sel.ticker} />}
          </div>

          {/* ticket */}
          <div className="lg:col-span-2 rounded-xl border border-slate-800 bg-slate-900 p-4 space-y-3">
            <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-slate-950" role="tablist" aria-label="Buy or sell">
              {['buy', 'sell'].map((m) => (
                <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => setMode(m)}
                  className={`py-2 rounded-md text-sm font-semibold capitalize ${mode === m ? (m === 'buy' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white') : 'text-slate-400 hover:text-white'}`}>
                  {m}
                </button>
              ))}
            </div>

            {!userId ? (
              <p className="text-sm text-slate-400">Sign in to trade sector coins.</p>
            ) : (
              <>
                {mode === 'buy' && money && (
                  <label className="block text-xs text-slate-400">Pay from
                    <select value={payWith} onChange={(e) => setPayWith(e.target.value)}
                      className="mt-1 w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-white">
                      <option value={ICEC}>IcanEra coin (ICEC)</option>
                      <option value={money.currency}>{money.currency} wallet</option>
                    </select>
                  </label>
                )}
                {mode === 'sell' && money && (
                  <label className="block text-xs text-slate-400">Receive in
                    <select value={payWith} onChange={(e) => setPayWith(e.target.value)}
                      className="mt-1 w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-white">
                      <option value={ICEC}>IcanEra coin (ICEC)</option>
                      <option value={money.currency}>{money.currency} wallet</option>
                    </select>
                  </label>
                )}

                <label className="block text-xs text-slate-400">
                  {mode === 'buy' ? `Amount to spend (${inMoney ? money.currency : 'ICEC'})` : `Units to sell (you hold ${trim(held, 8)})`}
                  <div className="mt-1 flex gap-2">
                    <input type="text" inputMode="decimal" autoComplete="off" value={amount}
                      onChange={(e) => { setNotice(null); setAmount(e.target.value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1')); }}
                      placeholder="0"
                      className="flex-1 min-w-0 rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-base text-white" />
                    {mode === 'sell' && held > 0 && (
                      <button type="button" onClick={() => setAmount(String(held))} className="px-3 rounded-lg border border-slate-700 text-xs text-slate-300 hover:text-white">Max</button>
                    )}
                  </div>
                </label>
                <p className="text-xs text-slate-500">
                  {mode === 'buy' ? `Balance: ${inMoney ? `${trim(money.balance, 2)} ${money.currency}` : `${icec == null ? '—' : trim(icec, 6)} ICEC`}` : `Worth about ${trim(held * (price || 0), 6)} ICEC at today's price`}
                </p>

                {(buyQuote || sellQuote) && !problem && (
                  <dl className="text-sm rounded-lg bg-slate-950 border border-slate-800 p-3 space-y-1">
                    {buyQuote && (<>
                      <div className="flex justify-between"><dt className="text-slate-400">You get about</dt><dd className="text-white font-semibold">{trim(buyQuote.units, 8)} {sel.ticker}</dd></div>
                      <div className="flex justify-between"><dt className="text-slate-400">Fee ({trim(feePct, 2)}%)</dt><dd>{trim(buyQuote.fee, 8)} ICEC</dd></div>
                    </>)}
                    {sellQuote && (<>
                      <div className="flex justify-between"><dt className="text-slate-400">You get about</dt><dd className="text-white font-semibold">{trim(sellQuote.net, 8)} ICEC{inMoney ? ` (paid in ${proceedsIn})` : ''}</dd></div>
                      <div className="flex justify-between"><dt className="text-slate-400">Fee ({trim(feePct, 2)}%)</dt><dd>{trim(sellQuote.fee, 8)} ICEC</dd></div>
                    </>)}
                    <p className="text-[11px] text-slate-500 pt-1">The final amount uses the price at the moment of the trade. If it moves more than 1% against you, the trade is cancelled.</p>
                  </dl>
                )}
                {problem && <p className="text-sm text-amber-400" role="alert">{problem}</p>}
                {!state.canTrade && <p className="text-sm text-slate-400">{state.kind === 'warming' ? 'This sector has not opened yet.' : 'Trading in this sector is paused right now.'}</p>}

                {reviewing ? (
                  <div className="space-y-2">
                    <p className="text-sm text-white">
                      {mode === 'buy'
                        ? `Buy about ${trim(buyQuote?.units, 8)} ${sel.ticker} for ${trim(num, 8)} ${inMoney ? money.currency : 'ICEC'}?`
                        : `Sell ${trim(sellQuote?.units, 8)} ${sel.ticker} for about ${trim(sellQuote?.net, 8)} ICEC?`}
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <button type="button" onClick={() => setReviewing(false)} disabled={busy} className="py-2 rounded-lg border border-slate-600 text-sm text-slate-300">Back</button>
                      <button type="button" onClick={submit} disabled={busy} className="py-2 rounded-lg bg-amber-500 text-slate-900 text-sm font-bold disabled:opacity-50">{busy ? 'Working…' : 'Confirm'}</button>
                    </div>
                  </div>
                ) : (
                  <button type="button" disabled={!ready} onClick={() => setReviewing(true)}
                    className={`w-full py-3 rounded-lg text-sm font-bold text-white disabled:opacity-40 disabled:cursor-not-allowed ${mode === 'buy' ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-red-600 hover:bg-red-500'}`}>
                    Review {mode}
                  </button>
                )}
              </>
            )}
            {notice && <p className={`text-sm ${notice.kind === 'ok' ? 'text-emerald-400' : 'text-red-400'}`} role="status">{notice.text}</p>}
          </div>
        </div>
      )}

      {/* what the user holds */}
      {userId && holdings.length > 0 && (
        <div className="rounded-xl border border-slate-800 bg-slate-900 overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="text-left px-4 pt-3 pb-1 text-xs uppercase tracking-wide text-slate-500">Your sector coins</caption>
            <thead><tr className="text-xs text-slate-500"><th className="text-left px-4 py-1">Sector</th><th className="text-right px-2">Units</th><th className="text-right px-2">Value (ICEC)</th><th className="text-right px-2">Result</th><th /></tr></thead>
            <tbody>
              {holdings.map((h) => {
                const r = holdingResult(h);
                return (
                  <tr key={h.sector} className="border-t border-slate-800">
                    <td className="px-4 py-2 font-mono text-amber-300">{h.sector}</td>
                    <td className="text-right px-2">{trim(h.units, 8)}</td>
                    <td className="text-right px-2">{trim(h.value_icec, 6)}</td>
                    <td className={`text-right px-2 ${TONE_TEXT[r.tone]}`}>{r.pnl == null ? '—' : `${r.pnl > 0 ? '+' : ''}${trim(r.pnl, 6)}`}{r.pct != null ? ` (${formatPct(r.pct)})` : ''}</td>
                    <td className="text-right px-3"><button type="button" onClick={() => { setSelected(h.sector); setMode('sell'); setAmount(''); }} className="text-xs text-amber-300 hover:text-amber-200">Sell</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {userId && fills.length > 0 && (
        <div className="rounded-xl border border-slate-800 bg-slate-900 overflow-x-auto">
          <table className="w-full text-xs">
            <caption className="text-left px-4 pt-3 pb-1 text-xs uppercase tracking-wide text-slate-500">Recent trades</caption>
            <tbody>
              {fills.map((f) => (
                <tr key={f.id} className="border-t border-slate-800 text-slate-300">
                  <td className="px-4 py-2 text-slate-500">{new Date(f.created_at).toLocaleString()}</td>
                  <td className={f.side === 'buy' ? 'text-emerald-400' : 'text-red-400'}>{f.side === 'buy' ? 'Bought' : 'Sold'}</td>
                  <td className="font-mono text-amber-300">{f.sector}</td>
                  <td className="text-right">{trim(f.units, 8)}</td>
                  <td className="text-right px-4">@ {formatPrice(f.price_icec)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
