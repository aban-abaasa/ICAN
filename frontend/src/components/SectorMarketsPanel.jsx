import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSectorBoard, useSectorTicket } from '../hooks/useSectorTicket';
import {
  ICEC, formatLevel, formatPct, formatPrice, changeTone, holdingResult, trim, sectorState, sectorChartRows,
} from '../utils/sectorTradeRules';
import IcanTradingChart from './IcanTradingChart';
import SectorYourBusiness from './SectorYourBusiness';
import LearnTab from './LearnTab';
import { getDataTerms } from '../services/sectorMarketService';

// Sector Markets: ten sector index coins, bought and sold with icaneracoin (or any wallet the user holds). Each index
// follows the anonymous revenue totals of businesses in that sector on IcanEra. Nothing here invents money logic: the
// price, the fee and every check are the database's (public.ican_sector_trade); this screen previews, asks and reports.
// The trade flow itself lives in hooks/useSectorTicket.js, shared with the public /icaneracoin page.

const TONE_TEXT = { up: 'text-emerald-400', down: 'text-red-400', flat: 'text-slate-400' };
const STATE_DOT = { live: 'bg-emerald-400', warming: 'bg-amber-400', paused: 'bg-slate-500' };
const STATUS_TEXT = { connecting: 'Connecting…', live: 'Live', delayed: 'Delayed', offline: 'Offline' };
const STATUS_DOT = { connecting: 'bg-slate-500', live: 'bg-emerald-400', delayed: 'bg-amber-400', offline: 'bg-red-500' };
const SECTOR_ICON = { iAGRI: '🌾', iTRNS: '🚚', iRETL: '🛍️', iSOCL: '🤝', iHLTH: '⚕️', iEDUC: '🎓', iFINC: '🏦', iCNST: '🏗️', iHOSP: '🍽️', iTECH: '💻' };
const feedStateOf = { live: 'live', connecting: 'connecting', delayed: 'delayed', offline: 'offline' };

// The sector's progress toward opening, as a bar. Counts only: a business is never named.
function OpeningProgress({ st }) {
  if (st.kind !== 'warming') return null;
  return (
    <div className="mt-2">
      {st.need > 0 && (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800" role="progressbar" aria-valuemin={0} aria-valuemax={st.need} aria-valuenow={st.have} aria-label="Businesses earning toward opening this sector">
          <div className="h-full rounded-full bg-amber-400" style={{ width: `${Math.round(st.progress * 100)}%` }} />
        </div>
      )}
      <p className="mt-1 text-[11px] leading-tight text-slate-400">{st.headline}</p>
      {st.detail && <p className="text-[11px] leading-tight text-slate-500">{st.detail}</p>}
    </div>
  );
}

// The exact data clause businesses agree to, read from the database so it is always the wording on record.
function SharedDataText() {
  const [terms, setTerms] = useState(null);
  useEffect(() => {
    let live = true;
    getDataTerms().then((t) => { if (live) setTerms(t); }).catch(() => {});
    return () => { live = false; };
  }, []);
  return <>{terms?.body || 'Only combined sales totals of businesses that agreed are used. No business or customer is ever named.'}</>;
}

export default function SectorMarketsPanel() {
  const { user } = useAuth();
  const userId = user?.id || null;

  const board = useSectorBoard();
  const { selected, setSelected, available, sectors, candles, status, tradingEnabled, feeBps, loading, error } = board;
  const t = useSectorTicket(board, userId);
  const {
    mode, setMode, amount, setAmount, setAmountRaw, payWith, setPayWith, reviewing, setReviewing, busy, notice, icec, holdings, fills,
    money, sel, state, price, held, num, inMoney, payIcec, buyQuote, sellQuote, problem, ready, feePct, proceedsIn, submit, startSell, pinDialog,
  } = t;

  const chartRows = useMemo(() => sectorChartRows(candles), [candles]);

  if (!available) return null;

  // live sectors first, then the ones still opening (the ones with the most businesses on IcanEra closest to the front)
  const ordered = [...sectors].sort((a, b) => {
    const la = sectorState(a, tradingEnabled).kind === 'live' ? 0 : 1;
    const lb = sectorState(b, tradingEnabled).kind === 'live' ? 0 : 1;
    return la - lb || (Number(b.contributors) || 0) - (Number(a.contributors) || 0) || (Number(b.registered) || 0) - (Number(a.registered) || 0) || (a.sort_order || 0) - (b.sort_order || 0);
  });
  const opening = ordered.filter((s) => sectorState(s, tradingEnabled).kind === 'warming');

  return (
    <div className="space-y-5 text-slate-200">
      {pinDialog}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-xl font-bold text-white">Sector Markets</h3>
        </div>
        <span className="mt-1 inline-flex flex-shrink-0 items-center gap-2 rounded-full border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs text-slate-300" aria-live="polite">
          <span className={`h-2 w-2 rounded-full ${STATUS_DOT[status]}`} />{STATUS_TEXT[status]}
        </span>
      </div>

      <LearnTab
        items={[
          { q: 'What are sector coins?', a: 'Ten coins, one per business sector. Each follows what real businesses in that sector on IcanEra earn, and you trade them with IcanEra coin.' },
          { q: 'Where do prices come from?', a: 'From combined, anonymous sales totals of businesses that agreed to share them, together with the net value of the fixed assets those businesses record in CMMS. Assets only count for a business that also has sales. No business, customer or asset is ever named. A sector opens only when enough businesses are earning that none can be picked out, and you trade against the IcanEra market vault.' },
          { q: 'What are the risks and fees?', a: `Prices can fall as well as rise, and you can lose what you put in.${feeBps ? ` A ${trim(feePct, 2)}% fee applies to each buy and sell.` : ''} The final amount uses the price at the moment of the trade; if it moves more than 1% against you, the trade is cancelled.` },
          { q: 'Why is a sector "Opening soon"?', a: 'It has no price until enough businesses are earning in it. The numbers shown are real counts of businesses on IcanEra and of those sharing sales; nothing is estimated, and registering a business does not move a price.' },
          userId ? { q: 'What does my business share?', a: <SharedDataText /> } : null,
        ]}
      />

      {error && <p className="text-sm text-red-400" role="alert">Could not load the markets. Retrying…</p>}
      {loading && !sectors.length && <p className="text-sm text-slate-500">Loading markets…</p>}

      {/* the ten sectors: one swipeable rail, so the chart below gets the screen */}
      {sectors.length > 0 && (
        <div className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="tablist" aria-label="Sectors">
          {ordered.map((s) => {
            const st = sectorState(s, tradingEnabled);
            const active = s.ticker === selected;
            return (
              <button
                key={s.ticker}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setSelected(s.ticker)}
                className={`min-w-[8.25rem] flex-shrink-0 snap-start rounded-xl border px-3 py-2 text-left transition ${active ? 'border-amber-400 bg-slate-800' : 'border-slate-700 bg-slate-900 hover:border-slate-500'}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-sm font-bold text-amber-300"><span aria-hidden="true" className="mr-1">{SECTOR_ICON[s.ticker]}</span>{s.ticker}</span>
                  <span className={`h-2 w-2 rounded-full ${STATE_DOT[st.kind]}`} aria-hidden="true" />
                </div>
                {st.kind === 'warming' ? (
                  <div className="mt-1 text-xs text-slate-400">Opening soon</div>
                ) : (
                  <>
                    <div className="mt-1 text-base font-semibold leading-tight text-white">{formatLevel(s.level)}</div>
                    <div className={`text-xs ${TONE_TEXT[changeTone(s.change_24h_pct)]}`}>{s.level != null ? formatPct(s.change_24h_pct) : '\u00a0'}</div>
                  </>
                )}
              </button>
            );
          })}
        </div>
      )}

      {sel && (
        <div className="grid gap-4 lg:grid-cols-5">
          {/* chart & analysis */}
          <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 lg:col-span-3">
            <div className="flex items-start justify-between gap-3 px-4 pt-3">
              <div className="min-w-0">
                <p className="truncate text-sm text-slate-400"><span aria-hidden="true" className="mr-1">{SECTOR_ICON[sel.ticker]}</span>{sel.name}</p>
                <p className="text-2xl font-bold leading-tight text-white">{state.kind === 'warming' ? 'Opening soon' : formatLevel(sel.level)}</p>
              </div>
              {state.kind !== 'warming' && (
                <div className="text-right">
                  <p className={`text-sm font-semibold ${TONE_TEXT[changeTone(sel.change_24h_pct)]}`}>{sel.level != null ? `${formatPct(sel.change_24h_pct)} · 24h` : ''}</p>
                  <p className="text-xs text-slate-500">{price != null ? `${formatPrice(price)} ICEC per unit` : 'not priced yet'}</p>
                </div>
              )}
            </div>
            {state.kind === 'warming' ? (
              <div className="space-y-3 px-4 pb-5 pt-4">
                <OpeningProgress st={state} />
              </div>
            ) : (
              <div className="mt-2 h-[26rem] w-full sm:h-[30rem]">
                <IcanTradingChart
                  rows={chartRows}
                  loading={loading && chartRows.length === 0}
                  theme="dark"
                  wheelZoom={false}
                  feedState={feedStateOf[status]}
                  symbol={`${sel.ticker} · index`}
                  emptyNote="Candles appear as the sector's sales move its index. Nothing here is simulated."
                />
              </div>
            )}
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
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="0"
                      className="flex-1 min-w-0 rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-base text-white" />
                    {mode === 'sell' && held > 0 && (
                      <button type="button" onClick={() => setAmountRaw(String(held))} className="px-3 rounded-lg border border-slate-700 text-xs text-slate-300 hover:text-white">Max</button>
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

      {/* the owner's own business: where a sector's real data comes from */}
      <SectorYourBusiness userId={userId} />

      {/* sectors still opening: how close each is, from real counts */}
      {opening.length > 0 && (
        <section aria-label="Sectors opening soon" className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Opening soon</h4>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {opening.map((s) => {
              const st = sectorState(s, tradingEnabled);
              return (
                <button key={s.ticker} type="button" onClick={() => setSelected(s.ticker)}
                  className="rounded-xl border border-slate-800 bg-slate-900 p-3 text-left hover:border-slate-600">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-white"><span aria-hidden="true" className="mr-1.5">{SECTOR_ICON[s.ticker]}</span>{s.name}</span>
                    <span className="font-mono text-xs text-amber-300">{s.ticker}</span>
                  </div>
                  <OpeningProgress st={st} />
                </button>
              );
            })}
          </div>
        </section>
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
                    <td className="text-right px-3"><button type="button" onClick={() => startSell(h.sector)} className="text-xs text-amber-300 hover:text-amber-200">Sell</button></td>
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
