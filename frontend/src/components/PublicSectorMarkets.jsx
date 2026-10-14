import React, { useEffect, useRef, useState } from 'react';
import { CHART_PALETTES } from './chartPalettes';
import SectorIndexChart from './SectorIndexChart';
import { GoogleMark } from './PublicTradePanel';
import { useSectorBoard, useSectorTicket } from '../hooks/useSectorTicket';
import { ICEC, changeTone, formatLevel, formatPct, formatPrice, holdingResult, sectorState, trim } from '../utils/sectorTradeRules';

// Sector Markets on the public /icaneracoin page: ten coins that follow what businesses on IcanEra earn, sector by sector
// (farms, transport, retail, ...). Anyone can watch the indices with no account. Signing in with Google, the same way the
// coin trade panel does, opens a ticket to buy and sell them with icaneracoin.
//
// This is a SKIN: the trade flow is hooks/useSectorTicket.js, shared with the wallet's own Sector Markets tab, and every
// price, fee and check is the database's (public.ican_sector_trade). Colours are the page's own palettes as inline
// styles, on purpose: index.css remaps stock Tailwind colour classes onto theme variables these standalone pages lack.
//
// It hides itself until the sector SQL is installed, and it only keeps polling while it is on screen (a visitor reading
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

const PublicSectorMarkets = ({ theme = 'dark', skin: k, trading, onAvailability }) => {
  const c = CHART_PALETTES[theme] || CHART_PALETTES.dark;
  const rootRef = useRef(null);
  const inView = useInView(rootRef);

  const board = useSectorBoard({ enabled: inView });
  const { selected, setSelected, available, sectors, candles, status, tradingEnabled, feeBps, loading, error } = board;
  const userId = trading?.user?.id || null;
  const t = useSectorTicket(board, userId);
  const {
    mode, setMode, amount, setAmount, setAmountRaw, payWith, setPayWith, reviewing, setReviewing, busy, notice, icec, holdings, fills,
    money, sel, state, price, held, inMoney, buyQuote, sellQuote, problem, ready, feePct, proceedsIn, submit, startSell,
  } = t;

  const shown = available && sectors.length > 0;
  useEffect(() => { onAvailability?.(shown); }, [shown, onAvailability]);

  // Back from Google (?sectors=iRETL): open that sector, bring the section into view, tidy the address.
  useEffect(() => {
    if (!userId || !sectors.length) return;
    let params;
    try { params = new URLSearchParams(window.location.search); } catch { return; }
    const want = params.get(RETURN_PARAM);
    if (!want) return;
    if (sectors.some((s) => s.ticker === want)) setSelected(want);
    params.delete(RETURN_PARAM);
    const rest = params.toString();
    try { window.history.replaceState({}, '', window.location.pathname + (rest ? `?${rest}` : '') + window.location.hash); } catch { /* address stays */ }
    requestAnimationFrame(() => document.getElementById('sectors')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }, [userId, sectors, setSelected]);

  if (!available) return null;

  const card = { background: c.card, border: `1px solid ${c.cardBorder}`, color: c.fg };
  const field = { background: c.field, border: `1px solid ${c.fieldBorder}`, color: c.strong };
  const sub = { color: c.muted };
  const tone = { up: c.pos, down: c.neg, flat: c.soft };
  const dot = { live: c.live, warming: c.book, paused: c.muted };
  const noticeStyle = (kind) => (kind === 'err' ? { background: c.errBg, color: c.errText } : { background: c.okBg, color: c.okText });
  const feeText = feeBps ? ` A ${trim(feePct, 2)}% fee applies to each buy and sell.` : '';

  const signIn = () => trading?.continueWithGoogle?.({ returnParam: RETURN_PARAM, returnValue: selected || '1' });

  return (
    <section id="sectors" ref={rootRef} aria-labelledby="sectors-heading" className="mt-12 scroll-mt-16" data-testid="public-sectors">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className={`text-xs font-bold uppercase tracking-[0.16em] ${k.kicker}`}>Sector Markets</p>
          <h2 id="sectors-heading" className={`mt-1 text-2xl font-bold ${k.title}`}>Trade business data: ten sector coins</h2>
        </div>
        <span className="inline-flex items-center gap-2 text-xs" style={sub} aria-live="polite">
          <span className="h-2 w-2 rounded-full" style={{ background: status === 'live' ? c.live : status === 'delayed' ? c.book : status === 'offline' ? c.neg : c.muted }} />
          {STATUS_TEXT[status]}
        </span>
      </div>
      <p className={`mt-2 max-w-3xl text-sm leading-6 ${k.body}`}>
        Each coin follows the combined sales of the businesses in one sector on IcanEra: farms, transport, retail, health, education and more.
        Buy a sector you think will grow, sell when you want out. Prices come from anonymous totals; no business or customer is ever named,
        and a sector only opens once enough businesses take part that none can be picked out.
      </p>
      <p className="mt-3 max-w-3xl rounded-lg p-3 text-xs leading-5" style={{ background: c.warnBg, border: `1px solid ${c.warnBorder}`, color: c.warnText }}>
        Prices can fall as well as rise, and you can lose what you put in. You trade against the IcanEra market vault.{feeText} Nothing here is financial advice.
      </p>

      {error && <p className="mt-3 text-sm" style={{ color: c.errText }} role="alert">Could not load the markets. Retrying…</p>}
      {loading && !sectors.length && <p className="mt-3 text-sm" style={sub}>Loading markets…</p>}

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5" data-testid="sector-cards">
        {sectors.map((s) => {
          const st = sectorState(s, tradingEnabled);
          const active = s.ticker === selected;
          const ch = tone[changeTone(s.change_24h_pct)];
          return (
            <button
              key={s.ticker}
              type="button"
              onClick={() => setSelected(s.ticker)}
              aria-pressed={active}
              className="rounded-xl p-3 text-left transition"
              style={{ ...card, borderColor: active ? c.accent : c.cardBorder, borderWidth: active ? 2 : 1, padding: active ? 'calc(0.75rem - 1px)' : '0.75rem' }}
            >
              <div className="flex items-center justify-between">
                <span className={`font-mono font-bold ${k.kicker}`}>{s.ticker}</span>
                <span className="h-2 w-2 rounded-full" style={{ background: dot[st.kind] }} aria-hidden="true" />
              </div>
              <div className="truncate text-xs" style={sub}>{s.name}</div>
              <div className="mt-1 text-lg font-semibold tabular-nums" style={{ color: c.strong }}>{formatLevel(s.level)}</div>
              <div className="text-xs tabular-nums" style={{ color: ch }}>{s.level != null ? formatPct(s.change_24h_pct) : ' '}</div>
              <div className="mt-0.5 text-[11px] leading-tight" style={sub}>{st.label}</div>
            </button>
          );
        })}
      </div>

      {sel && (
        <div className="mt-4 grid gap-4 lg:grid-cols-5">
          <div className="rounded-xl p-3 lg:col-span-3" style={card}>
            <div className="mb-1 flex items-baseline justify-between">
              <div>
                <span className={`font-mono font-bold ${k.kicker}`}>{sel.ticker}</span>
                <span className="ml-2 text-sm" style={sub}>{sel.name}</span>
              </div>
              <div className="text-right">
                <div className="text-lg font-semibold tabular-nums" style={{ color: c.strong }}>{formatLevel(sel.level)}</div>
                <div className="text-xs" style={sub}>{price != null ? `${formatPrice(price)} ICEC per unit` : 'not priced yet'}</div>
              </div>
            </div>
            {sel.description && <p className="mb-2 text-xs" style={sub}>{sel.description}</p>}
            {state.kind === 'warming'
              ? <p className="py-10 text-center text-sm" style={sub}>{state.label}. A sector opens once enough businesses are contributing that no single one can be identified.</p>
              : <SectorIndexChart candles={candles} ticker={sel.ticker} theme={theme} />}
          </div>

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
                    ? <>Continue with Google to trade <b style={{ color: c.strong }}>{sel.ticker}</b>. Your IcanEra wallet is created for you and you pay with icaneracoin.</>
                    : 'Trading in sector coins opens soon. You can follow the indices here in the meantime.'}
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
                    <p className="pt-1 text-[11px]" style={sub}>The final amount uses the price at the moment of the trade. If it moves more than 1% against you, the trade is cancelled.</p>
                  </dl>
                )}
                {problem && <p className="text-sm" style={{ color: c.warnText }} role="alert">{problem}</p>}
                {!state.canTrade && <p className="text-sm" style={sub}>{state.kind === 'warming' ? 'This sector has not opened yet.' : 'Trading in this sector is paused right now.'}</p>}

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
                    <td className="px-3 text-right"><button type="button" onClick={() => startSell(h.sector)} className={`text-xs font-semibold ${k.kicker}`}>Sell</button></td>
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
