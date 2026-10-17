import React, { useEffect, useMemo, useRef, useState } from 'react';
import { HelpCircle } from 'lucide-react';
import { CHART_PALETTES } from './chartPalettes';
import IcanTradingChart from './IcanTradingChart';
import CoinPicker, { ICAN_COIN } from './CoinPicker';
import { GoogleMark } from './PublicTradePanel';
import PublicSectionNotice from './PublicSectionNotice';
import { useSectorBoard, useSectorTicket } from '../hooks/useSectorTicket';
import { ICEC, changeTone, formatLevel, formatPct, formatPrice, holdingResult, trim, sectorChartRows } from '../utils/sectorTradeRules';

// Sector Markets on the public /icaneracoin page: ten coins that follow what businesses on IcanEra earn, sector by sector
// (farms, transport, retail, ...). Anyone can watch the indices with no account. Signing in with Google, the same way the
// coin trade panel does, opens a ticket to buy and sell them with icaneracoin.
//
// One chart serves every coin: a collapsed dropdown (CoinPicker) picks icaneracoin itself or any sector, and the chart,
// the figures and the ticket below follow the choice. icaneracoin's own trading stays on the page's main chart and panel;
// choosing it here shows its price history and a button into that panel.
//
// This is a SKIN: the trade flow is hooks/useSectorTicket.js, shared with the wallet's own Sector Markets tab, and every
// price, fee and check is the database's (public.ican_sector_trade). Colours are the page's own palettes as inline
// styles, on purpose: index.css remaps stock Tailwind colour classes onto theme variables these standalone pages lack.
//
// Until the sector SQL is installed (or no sector has data yet) it shows an explanatory notice in the same place rather than
// disappearing, so the page navigation can always load it. It only keeps polling while it is on screen (a visitor reading
// the FAQ is not holding a request open).

const RETURN_PARAM = 'sectors';

const STATUS_TEXT = { connecting: 'Connecting…', live: 'Prices live', delayed: 'Prices delayed', offline: 'Offline' };

export const useInView = (ref, margin = '300px') => {
  const [inView, setInView] = useState(typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { rootMargin: margin });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, margin]);
  return inView;
};

const PublicSectorMarkets = ({ theme = 'dark', skin: k, trading, onAvailability, onLearn, ican, onTradeIcan }) => {
  const c = CHART_PALETTES[theme] || CHART_PALETTES.dark;
  const rootRef = useRef(null);
  const inView = useInView(rootRef);

  const board = useSectorBoard({ enabled: inView });
  const { selected, setSelected, available, sectors, candles, status, tradingEnabled, feeBps, loading, error } = board;
  const userId = trading?.user?.id || null;
  const t = useSectorTicket(board, userId);
  const {
    mode, setMode, amount, setAmount, setAmountRaw, payWith, setPayWith, reviewing, setReviewing, busy, notice, icec, holdings, fills,
    money, sel, state, price, held, inMoney, buyQuote, sellQuote, problem, ready, feePct, proceedsIn, submit, startSell, pinDialog,
  } = t;

  // 'ICAN' while the chart shows icaneracoin itself, null while it follows the selected sector
  const [coin, setCoin] = useState(null);
  const isIcan = coin === ICAN_COIN;
  const pickCoin = (id) => {
    if (id === ICAN_COIN) { setCoin(ICAN_COIN); return; }
    setCoin(null);
    setSelected(id);
  };
  const sellHolding = (sector) => { setCoin(null); startSell(sector); };

  // Both charts are the SAME analysis chart as icaneracoin's own (candles, moving averages, RSI, timeframes, trend lines).
  // icaneracoin's candles and the selected sector's candles are both { timestamp, open, high, low, close }.
  const icanRows = useMemo(() => sectorChartRows(ican?.candles), [ican?.candles]);
  const sectorRows = useMemo(() => sectorChartRows(candles), [candles]);

  const shown = available && sectors.length > 0;
  useEffect(() => { onAvailability?.(shown); }, [shown, onAvailability]);

  // Back from Google (?sectors=iRETL): open that sector, bring the section into view, tidy the address.
  useEffect(() => {
    if (!userId || !sectors.length) return;
    let params;
    try { params = new URLSearchParams(window.location.search); } catch { return; }
    const want = params.get(RETURN_PARAM);
    if (!want) return;
    if (sectors.some((s) => s.ticker === want)) { setCoin(null); setSelected(want); }
    params.delete(RETURN_PARAM);
    const rest = params.toString();
    try { window.history.replaceState({}, '', window.location.pathname + (rest ? `?${rest}` : '') + window.location.hash); } catch { /* address stays */ }
    requestAnimationFrame(() => document.getElementById('sectors')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }, [userId, sectors, setSelected]);

  if (!available || (!loading && !error && !sectors.length)) {
    return (
      <div ref={rootRef}>
        <PublicSectionNotice id="sectors" theme={theme} skin={k} kicker="Business data" title="Sector coins" loading={loading} onLearn={onLearn}>
          Ten coins that follow business sales, sector by sector.
        </PublicSectionNotice>
      </div>
    );
  }

  const card = { background: c.card, border: `1px solid ${c.cardBorder}`, color: c.fg };
  const field = { background: c.field, border: `1px solid ${c.fieldBorder}`, color: c.strong };
  const sub = { color: c.muted };
  const tone = { up: c.pos, down: c.neg, flat: c.soft };
  const noticeStyle = (kind) => (kind === 'err' ? { background: c.errBg, color: c.errText } : { background: c.okBg, color: c.okText });
  
  const signIn = () => trading?.continueWithGoogle?.({ returnParam: RETURN_PARAM, returnValue: selected || '1' });

  return (
    <section id="sectors" ref={rootRef} aria-labelledby="sectors-heading" className="mt-10 scroll-mt-16" data-testid="public-sectors">
      {pinDialog}
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className={`text-xs font-bold uppercase tracking-[0.16em] ${k.kicker}`}>Business data</p>
          <h2 id="sectors-heading" className={`mt-1 text-xl font-bold sm:text-2xl ${k.title}`}>Sector coins</h2>
        </div>
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-2 text-xs" style={sub} aria-live="polite">
            <span className="h-2 w-2 rounded-full" style={{ background: status === 'live' ? c.live : status === 'delayed' ? c.book : status === 'offline' ? c.neg : c.muted }} />
            {STATUS_TEXT[status]}
          </span>
          {onLearn && (
            <button type="button" onClick={onLearn} aria-label="How sector coins work" title="How sector coins work" className="-m-2 rounded-md p-2" style={{ color: c.soft }}>
              <HelpCircle className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
      <p className="mt-1 text-xs" style={sub}>
        Prices can fall as well as rise.{feeBps ? ` ${trim(feePct, 2)}% fee per trade.` : ''}
      </p>

      {error && <p className="mt-3 text-sm" style={{ color: c.errText }} role="alert">Could not load the markets. Retrying…</p>}
      {loading && !sectors.length && <p className="mt-3 text-sm" style={sub}>Loading markets…</p>}

      <CoinPicker theme={theme} skin={k} value={isIcan ? ICAN_COIN : selected} onChange={pickCoin} sectors={sectors} tradingEnabled={tradingEnabled} ican={ican} />

      {(isIcan || sel) && (
        <div className="mt-4 grid gap-4 lg:grid-cols-5">
          <div className="rounded-xl p-3 lg:col-span-3" style={card}>
            <div className="mb-1 flex items-baseline justify-between">
              <div>
                <span className={`font-mono font-bold ${k.kicker}`}>{isIcan ? ICAN_COIN : sel.ticker}</span>
                <span className="ml-2 text-sm" style={sub} title={isIcan ? undefined : sel.description || undefined}>{isIcan ? 'icaneracoin' : sel.name}</span>
              </div>
              <div className="text-right">
                {isIcan ? (
                  <>
                    <div className="text-lg font-semibold tabular-nums" style={{ color: c.strong }}>{ican?.price != null ? `UGX ${Number(ican.price).toLocaleString(undefined, { maximumFractionDigits: 2 })}` : '—'}</div>
                    <div className="text-xs" style={{ color: tone[changeTone(ican?.changePct)] }}>{ican?.changePct != null ? formatPct(ican.changePct) : ' '}</div>
                  </>
                ) : (
                  <>
                    <div className="text-lg font-semibold tabular-nums" style={{ color: c.strong }}>{formatLevel(sel.level)}</div>
                    <div className="text-xs" style={sub}>{price != null ? `${formatPrice(price)} ICEC per unit` : 'not priced yet'}</div>
                  </>
                )}
              </div>
            </div>
            {!isIcan && state.kind === 'warming' ? (
              <div className="space-y-1 py-8 text-center">
                <p className="text-sm font-semibold" style={{ color: c.strong }}>{state.headline || state.label}</p>
                {state.detail && <p className="text-xs" style={sub}>{state.detail}</p>}
                <p className="mx-auto max-w-xs text-xs" style={sub}>No price and nothing to trade until then; nothing here is estimated.</p>
              </div>
            ) : (
              <div className="mt-2 h-[22rem] w-full overflow-hidden rounded-lg sm:h-[26rem]">
                <IcanTradingChart
                  rows={isIcan ? icanRows : sectorRows}
                  loading={loading && !(isIcan ? icanRows : sectorRows).length}
                  theme={theme}
                  wheelZoom={false}
                  feedState={status}
                  symbol={isIcan ? 'ICAN / UGX' : `${sel.ticker} · index`}
                  emptyNote={isIcan ? undefined : "Candles appear as the sector's sales move its index. Nothing here is simulated."}
                />
              </div>
            )}
          </div>

          {isIcan ? (
            <div className="space-y-3 rounded-xl p-4 lg:col-span-2" style={card} data-testid="ican-card">
              <p className="text-sm" style={{ color: c.fg }}>
                <b style={{ color: c.strong }}>icaneracoin</b> is the main coin. Its full chart and trading panel are at the top of this page.
              </p>
              <button type="button" onClick={onTradeIcan} className="w-full rounded-lg py-3 text-sm font-bold" style={{ background: c.accent, color: c.accentText }}>
                Trade icaneracoin
              </button>
              <p className="text-xs" style={sub}>Pick a sector coin from the list above to see its chart and trade it here.</p>
            </div>
          ) : (
          <div className="space-y-3 rounded-xl p-4 lg:col-span-2" style={card} data-testid="sector-ticket">
            <div className="grid grid-cols-2 gap-1 rounded-lg p-1" style={{ background: c.tabsBg }} role="tablist" aria-label="Buy or sell">
              {['buy', 'sell'].map((m) => (
                <button
                  key={m}
                  type="button"
                  role="tab"
                  aria-selected={mode === m}
                  onClick={() => setMode(m)}
                  className="rounded-md py-2 text-sm font-semibold capitalize"
                  style={mode === m ? { background: m === 'buy' ? c.buy : c.sell, color: c.buyText } : { color: c.soft }}
                >
                  {m}
                </button>
              ))}
            </div>

            {!userId ? (
              <div className="space-y-3">
                <p className="text-sm" style={{ color: c.fg }}>
                  {tradingEnabled
                    ? <>Sign in to trade <b style={{ color: c.strong }}>{sel.ticker}</b>.</>
                    : 'Trading opens soon. You can follow the prices meanwhile.'}
                </p>
                <button
                  type="button"
                  onClick={signIn}
                  className="flex min-h-[48px] w-full items-center justify-center gap-3 rounded-lg border text-sm font-semibold"
                  style={{ background: '#ffffff', color: '#1f2937', borderColor: '#d1d5db' }}
                >
                  <GoogleMark /> Continue with Google
                </button>
                {trading?.notice && <p className="rounded-md px-3 py-2 text-xs" role="alert" style={{ background: c.errBg, color: c.errText }}>{trading.notice.text}</p>}
              </div>
            ) : (
              <>
                {money && (
                  <label className="block text-xs" style={sub}>{mode === 'buy' ? 'Pay from' : 'Receive in'}
                    <select value={payWith} onChange={(e) => setPayWith(e.target.value)} className="mt-1 w-full rounded-lg px-3 py-2 text-sm" style={field}>
                      <option value={ICEC}>IcanEra coin (ICEC)</option>
                      <option value={money.currency}>{money.currency} wallet</option>
                    </select>
                  </label>
                )}

                <label className="block text-xs" style={sub}>
                  {mode === 'buy' ? `Amount to spend (${inMoney ? money.currency : 'ICEC'})` : `Units to sell (you hold ${trim(held, 8)})`}
                  <div className="mt-1 flex gap-2">
                    <input
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="0"
                      aria-label={mode === 'buy' ? 'Amount to spend' : 'Units to sell'}
                      className="min-w-0 flex-1 rounded-lg px-3 py-2 text-base"
                      style={field}
                    />
                    {mode === 'sell' && held > 0 && (
                      <button type="button" onClick={() => setAmountRaw(String(held))} className="rounded-lg px-3 text-xs" style={{ border: `1px solid ${c.fieldBorder}`, color: c.soft }}>Max</button>
                    )}
                  </div>
                </label>
                <p className="text-xs" style={sub}>
                  {mode === 'buy'
                    ? `Balance: ${inMoney ? `${trim(money.balance, 2)} ${money.currency}` : `${icec == null ? '—' : trim(icec, 6)} ICEC`}`
                    : `Worth about ${trim(held * (price || 0), 6)} ICEC at today's price`}
                </p>

                {(buyQuote || sellQuote) && !problem && (
                  <dl className="space-y-1 rounded-lg p-3 text-sm" style={{ background: c.field, border: `1px solid ${c.cardBorder}` }}>
                    {buyQuote && (<>
                      <div className="flex justify-between"><dt style={sub}>You get about</dt><dd className="font-semibold" style={{ color: c.strong }}>{trim(buyQuote.units, 8)} {sel.ticker}</dd></div>
                      <div className="flex justify-between"><dt style={sub}>Fee ({trim(feePct, 2)}%)</dt><dd>{trim(buyQuote.fee, 8)} ICEC</dd></div>
                    </>)}
                    {sellQuote && (<>
                      <div className="flex justify-between"><dt style={sub}>You get about</dt><dd className="font-semibold" style={{ color: c.strong }}>{trim(sellQuote.net, 8)} ICEC{inMoney ? ` (paid in ${proceedsIn})` : ''}</dd></div>
                      <div className="flex justify-between"><dt style={sub}>Fee ({trim(feePct, 2)}%)</dt><dd>{trim(sellQuote.fee, 8)} ICEC</dd></div>
                    </>)}
                    <p className="pt-1 text-[11px]" style={sub}>Final amount uses the price at trade time; cancelled if it moves over 1% against you.</p>
                  </dl>
                )}
                {problem && <p className="text-sm" style={{ color: c.warnText }} role="alert">{problem}</p>}
                {!state.canTrade && <p className="text-sm" style={sub}>{state.kind === 'warming' ? 'Not open yet.' : 'Trading paused for now.'}</p>}

                {reviewing ? (
                  <div className="space-y-2">
                    <p className="text-sm" style={{ color: c.strong }}>
                      {mode === 'buy'
                        ? `Buy about ${trim(buyQuote?.units, 8)} ${sel.ticker} for ${trim(Number(amount), 8)} ${inMoney ? money.currency : 'ICEC'}?`
                        : `Sell ${trim(sellQuote?.units, 8)} ${sel.ticker} for about ${trim(sellQuote?.net, 8)} ICEC?`}
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <button type="button" onClick={() => setReviewing(false)} disabled={busy} className="rounded-lg py-2 text-sm" style={{ border: `1px solid ${c.fieldBorder}`, color: c.soft }}>Back</button>
                      <button type="button" onClick={submit} disabled={busy} className="rounded-lg py-2 text-sm font-bold disabled:opacity-50" style={{ background: c.accent, color: c.accentText }}>{busy ? 'Working…' : 'Confirm'}</button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={!ready}
                    onClick={() => setReviewing(true)}
                    className="w-full rounded-lg py-3 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-40"
                    style={{ background: mode === 'buy' ? c.buy : c.sell, color: c.buyText }}
                  >
                    Review {mode}
                  </button>
                )}
              </>
            )}
            {notice && <p className="rounded-md px-3 py-2 text-sm" role="status" style={noticeStyle(notice.kind)}>{notice.text}</p>}
          </div>
          )}
        </div>
      )}

      {userId && holdings.length > 0 && (
        <div className="mt-4 overflow-x-auto rounded-xl" style={card}>
          <table className="w-full text-sm">
            <caption className="px-4 pb-1 pt-3 text-left text-xs uppercase tracking-wide" style={sub}>Your sector coins</caption>
            <thead><tr className="text-xs" style={sub}><th className="px-4 py-1 text-left">Sector</th><th className="px-2 text-right">Units</th><th className="px-2 text-right">Value (ICEC)</th><th className="px-2 text-right">Result</th><th /></tr></thead>
            <tbody>
              {holdings.map((h) => {
                const r = holdingResult(h);
                return (
                  <tr key={h.sector} style={{ borderTop: `1px solid ${c.cardBorder}` }}>
                    <td className={`px-4 py-2 font-mono ${k.kicker}`}>{h.sector}</td>
                    <td className="px-2 text-right tabular-nums">{trim(h.units, 8)}</td>
                    <td className="px-2 text-right tabular-nums">{trim(h.value_icec, 6)}</td>
                    <td className="px-2 text-right tabular-nums" style={{ color: tone[r.tone] }}>{r.pnl == null ? '—' : `${r.pnl > 0 ? '+' : ''}${trim(r.pnl, 6)}`}{r.pct != null ? ` (${formatPct(r.pct)})` : ''}</td>
                    <td className="px-3 text-right"><button type="button" onClick={() => sellHolding(h.sector)} className={`text-xs font-semibold ${k.kicker}`}>Sell</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {userId && fills.length > 0 && (
        <div className="mt-4 overflow-x-auto rounded-xl" style={card}>
          <table className="w-full text-xs">
            <caption className="px-4 pb-1 pt-3 text-left text-xs uppercase tracking-wide" style={sub}>Recent sector trades</caption>
            <tbody>
              {fills.map((f) => (
                <tr key={f.id} style={{ borderTop: `1px solid ${c.cardBorder}` }}>
                  <td className="px-4 py-2" style={sub}>{new Date(f.created_at).toLocaleString()}</td>
                  <td style={{ color: f.side === 'buy' ? c.pos : c.neg }}>{f.side === 'buy' ? 'Bought' : 'Sold'}</td>
                  <td className={`font-mono ${k.kicker}`}>{f.sector}</td>
                  <td className="text-right tabular-nums">{trim(f.units, 8)}</td>
                  <td className="px-4 text-right tabular-nums">@ {formatPrice(f.price_icec)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};

export default PublicSectorMarkets;
