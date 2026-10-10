import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeftRight, ArrowRight, BarChart3, HelpCircle, LineChart as LineChartIcon, Moon, RefreshCw, Sun, X } from 'lucide-react';
import IcanTradingChart from './IcanTradingChart';
import IcanAnalysisPanel from './IcanAnalysisPanel';
import PublicTradePanel from './PublicTradePanel';
import { CHART_PALETTES } from './chartPalettes';
import { useLineStyles } from './chartLineStyles';
import usePublicTrading from '../hooks/usePublicTrading';
import usePublicIcanCandles from '../hooks/usePublicIcanCandles';
import { describeCandleWindow, summarizeAnalysis } from '../utils/candleIndicators';

// /icaneracoin -- the public icaneracoin price chart. Anyone (and any search engine) can open it with no
// account: the live candlestick chart, the chart analysis, and a plain-language explanation of what they show.
// Standalone like the other public pages (mounted outside ThemeProvider/AuthProvider in main.jsx), so it carries
// its own light and dark palettes (the visitor's system setting by default, their last choice afterwards). The <head> (title, description, JSON-LD) is written server-side by api/share-preview.js
// for crawlers that never run this JS; the effect below only keeps it right when the page is reached client-side.

const PAGE_TITLE = 'icaneracoin (ICAN) Price Chart — Live Candlestick Chart & Analysis | IcanEra';
const PAGE_DESCRIPTION = 'Live icaneracoin (ICAN) price chart: real-time candlesticks, trend, RSI, moving averages, support and resistance, built from real IcanEra transactions.';

const FAQ = [
  {
    q: 'What is icaneracoin?',
    a: 'icaneracoin (ICAN) is the coin behind IcanEra, a blockchain application for sending money across the globe and running business and personal finances. You can buy, sell and transfer it from your IcanEra wallet.',
  },
  {
    q: 'Where does the icaneracoin chart data come from?',
    a: 'Every candle is built from real IcanEra activity — wallet transfers, business wallet payments, trust group and SACCO contributions. Nothing is simulated. A quiet period simply shows a flat candle at the current price.',
  },
  {
    q: 'How do I read the candlesticks?',
    a: 'Each candle covers the timeframe you pick (five minutes by default). Its body runs from the opening to the closing price (green if the price rose, red if it fell) and its wick shows the highest and lowest price reached. Hover over any candle to read its exact numbers.',
  },
  {
    q: 'What do RSI, moving averages, support and resistance mean?',
    a: 'RSI compares recent gains with recent losses: above 70 is usually called overbought, below 30 oversold. A moving average (MA) is the average closing price over the last 20 or 50 candles. Support and resistance are price levels the chart has recently struggled to fall below or rise above.',
  },
];

const THEME_KEY = 'ican_chart_theme';
const initialTheme = () => {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch { /* storage blocked: fall through to the system setting */ }
  return typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
};

// Class sets per theme. Written out in full so Tailwind sees every class.
const SKIN = {
  dark: {
    page: 'bg-[#020617] text-[#f1f5f9]', bar: 'border-[#1e293b] bg-[#020617]/90', title: 'text-[#ffffff]', soft: 'text-[#94a3b8]', body: 'text-[#cbd5e1]',
    hover: 'hover:bg-[#1e293b] hover:text-[#ffffff]', cta: 'bg-[#fcd34d] text-[#020617] hover:bg-[#fde68a]', ghost: 'border-[#475569] text-[#f1f5f9] hover:bg-[#1e293b]',
    card: 'border-[#fcd34d]/30 bg-[#0f172a]/60', rule: 'divide-[#1e293b] border-[#1e293b]', faqQ: 'text-[#f1f5f9]', kicker: 'text-[#fcd34d]', footBorder: 'border-[#1e293b] text-[#64748b]', footLink: 'hover:text-[#cbd5e1]',
    errBtn: 'bg-[#1e293b] text-[#ffffff] hover:bg-[#334155]', icon: 'text-[#cbd5e1]', bg: '#020617',
  },
  light: {
    page: 'bg-[#f8fafc] text-[#0f172a]', bar: 'border-[#e2e8f0] bg-[#ffffff]/90', title: 'text-[#0f172a]', soft: 'text-[#64748b]', body: 'text-[#334155]',
    hover: 'hover:bg-[#f1f5f9] hover:text-[#0f172a]', cta: 'bg-[#064e3b] text-[#ffffff] hover:bg-[#065f46]', ghost: 'border-[#cbd5e1] text-[#1e293b] hover:bg-[#f1f5f9]',
    card: 'border-[#064e3b]/20 bg-[#ffffff]', rule: 'divide-[#e2e8f0] border-[#e2e8f0]', faqQ: 'text-[#0f172a]', kicker: 'text-[#065f46]', footBorder: 'border-[#e2e8f0] text-[#64748b]', footLink: 'hover:text-[#1e293b]',
    errBtn: 'bg-[#e2e8f0] text-[#0f172a] hover:bg-[#cbd5e1]', icon: 'text-[#334155]', bg: '#f8fafc',
  },
};

const fmtUgx = (n) => Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });

const setMeta = (selector, attr, value) => {
  let el = document.head.querySelector(selector);
  if (!el) {
    el = document.createElement(selector.startsWith('link') ? 'link' : 'meta');
    const match = selector.match(/\[(\w+(?::\w+)?)="([^"]+)"\]/);
    if (match) el.setAttribute(match[1], match[2]);
    document.head.appendChild(el);
  }
  el.setAttribute(attr, value);
};


// True at desktop width: the trade panel docks beside the chart there, and slides up as a sheet on a phone.
const useIsDesktop = () => {
  const query = '(min-width: 1024px)';
  const [matches, setMatches] = useState(() => typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false);
  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return matches;
};

const scrollToId = (id) => {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

const PublicIcanChartPage = () => {
  const { candles, snapshot, analysis, loading, error, updatedAt, refresh } = usePublicIcanCandles(500);
  const [theme, setTheme] = useState(initialTheme);
  const k = SKIN[theme];
  const dark = theme === 'dark';
  const c = CHART_PALETTES[theme];
  const isDesktop = useIsDesktop();

  // Trading state lives here so the chart (lines, taps) and the panel stay in step.
  const { lineStyles, updateLineStyle, resetLineStyles } = useLineStyles();
  const [tradeTab, setTradeTab] = useState('buy');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [placement, setPlacement] = useState(false);
  const [draft, setDraft] = useState({ side: 'buy', amount: '', price: '' });

  const latest = candles.length ? candles[candles.length - 1] : null;
  const priceUgx = snapshot?.price_ugx != null ? Number(snapshot.price_ugx) : latest?.close ?? null;
  const priceUsd = snapshot?.price_usd != null ? Number(snapshot.price_usd) : null;
  const trading = usePublicTrading(priceUgx);

  // A new message (payment cancelled, order booked, ...) always appears at the top of the panel; bring that into
  // view rather than leaving it scrolled out of sight behind the sheet's header.
  const sheetScrollRef = useRef(null);
  const asideRef = useRef(null);
  useEffect(() => {
    if (!trading.notice) return;
    [sheetScrollRef.current, asideRef.current].forEach((el) => { if (el) el.scrollTo({ top: 0, behavior: 'smooth' }); });
  }, [trading.notice]);

  const toggleTheme = () => {
    const next = dark ? 'light' : 'dark';
    setTheme(next);
    try { localStorage.setItem(THEME_KEY, next); } catch { /* choice just won't be remembered */ }
  };

  useEffect(() => {
    document.title = PAGE_TITLE;
    setMeta('meta[name="description"]', 'content', PAGE_DESCRIPTION);
    setMeta('link[rel="canonical"]', 'href', 'https://icanera.space/icaneracoin');
    return () => { document.body.style.background = ''; };
  }, []);

  useEffect(() => {
    document.body.style.background = k.bg;
    document.documentElement.style.colorScheme = theme;
    const meta = document.head.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', k.bg);
  }, [k.bg, theme]);

  // Back from Google (?trade=1): open the trade panel, then tidy the address.
  useEffect(() => {
    let params;
    try { params = new URLSearchParams(window.location.search); } catch { return; }
    if (params.get('trade') !== '1' || !trading.signedIn) return;
    setSheetOpen(true);
    setTradeTab('buy');
    params.delete('trade');
    const rest = params.toString();
    try { window.history.replaceState({}, '', window.location.pathname + (rest ? `?${rest}` : '') + window.location.hash); } catch { /* address stays */ }
  }, [trading.signedIn]);

  // The sheet owns the screen on a phone: lock the page behind it, and let Escape close it.
  useEffect(() => {
    if (!sheetOpen || isDesktop) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => { if (e.key === 'Escape') setSheetOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey); };
  }, [sheetOpen, isDesktop]);

  // A tap on empty chart while picking a price fills the order form (sell above the market, buy below, like the
  // wallet's chart) and brings the panel back.
  const handlePickPrice = useCallback((price) => {
    if (!placement) return;
    setDraft((d) => ({ ...d, price: String(price), side: priceUgx && price > priceUgx ? 'sell' : 'buy' }));
    setPlacement(false);
    setTradeTab('book');
    setSheetOpen(true);
  }, [placement, priceUgx]);

  // A tap on one of the visitor's lines: a booked order opens the Book list; a past buy / sell price starts a new
  // booking at that same price.
  const handleLineSelect = useCallback((line) => {
    setTradeTab('book');
    if (line.kind === 'buy' || line.kind === 'sell') {
      setDraft((d) => ({ ...d, side: line.kind, price: String(Math.round(line.price * 100) / 100) }));
    }
    setSheetOpen(true);
  }, []);

  const draftPrice = tradeTab === 'book' && Number(draft.price) > 0 ? Number(draft.price) : null;

  const changePct = analysis ? Number(analysis.momentum) : null;
  const windowLabel = useMemo(() => describeCandleWindow(candles), [candles]);
  const summary = useMemo(
    () => summarizeAnalysis(analysis, { windowLabel, candleCount: candles.length }),
    [analysis, windowLabel, candles.length],
  );
  const up = dark ? 'text-emerald-400' : 'text-emerald-700';
  const down = dark ? 'text-red-400' : 'text-red-600';

  const panel = (
    <PublicTradePanel
      trading={trading}
      theme={theme}
      priceUgx={priceUgx}
      tab={tradeTab}
      setTab={setTradeTab}
      draft={draft}
      setDraft={setDraft}
      placement={placement}
      setPlacement={setPlacement}
      onClose={(why) => { if (why === 'chart' && !isDesktop) setSheetOpen(false); }}
    />
  );

  const navBtn = (label, Icon, onClick, { primary = false, active = false } = {}) => (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="flex min-h-[56px] flex-col items-center justify-center gap-0.5 text-[11px] font-semibold"
      style={primary ? { background: c.tabOnBg, color: c.tabOnText } : { color: active ? c.strong : c.soft }}
    >
      <Icon className="h-5 w-5" aria-hidden="true" />
      {label}
    </button>
  );

  return (
    <div className={`min-h-screen font-sans ${k.page}`}>
      <header className={`sticky top-0 z-30 border-b backdrop-blur ${k.bar}`}>
        <div className="flex h-12 items-center gap-3 px-3 sm:px-5">
          <a href="/" className={`flex shrink-0 items-center gap-2 text-base font-bold tracking-tight ${k.title}`} aria-label="IcanEra home">
            <img src="/icons/icon-192x192.png" alt="" width="26" height="26" className="rounded-md" />
            <span className="hidden sm:inline">IcanEra</span>
          </a>
          <h1 className={`min-w-0 truncate text-sm font-bold sm:text-base ${k.title}`}>icaneracoin (ICAN) price chart</h1>
          <nav aria-label="On this page" className="hidden items-center gap-1 text-sm font-semibold lg:flex">
            <button type="button" onClick={() => scrollToId('analysis')} className={`rounded-md px-3 py-1.5 ${k.icon} ${k.hover}`}>Analysis</button>
            <button type="button" onClick={() => scrollToId('learn')} className={`rounded-md px-3 py-1.5 ${k.icon} ${k.hover}`}>Learn</button>
          </nav>
          <div className="ml-auto flex shrink-0 items-center gap-2 text-sm tabular-nums">
            {priceUgx != null && (
              <span className="flex items-baseline gap-1.5" aria-label="Current icaneracoin price">
                <span className={`font-bold ${k.title}`}>UGX {fmtUgx(priceUgx)}</span>
                {changePct != null && (
                  <span className={`hidden text-xs font-semibold sm:inline ${changePct > 0 ? up : changePct < 0 ? down : k.soft}`}>
                    {changePct > 0 ? '+' : ''}{changePct.toFixed(2)}%
                  </span>
                )}
              </span>
            )}
            <button type="button" onClick={refresh} aria-label="Refresh chart" title={updatedAt ? `Updated ${updatedAt.toLocaleTimeString()}` : 'Refresh'} className={`rounded-md p-2 ${k.icon} ${k.hover}`}>
              <RefreshCw className="h-4 w-4" />
            </button>
            <button type="button" onClick={toggleTheme} aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'} title={dark ? 'Light mode' : 'Dark mode'} className={`rounded-md p-2 ${k.icon} ${k.hover}`}>
              {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </header>

      <main className="lg:grid lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* The chart owns the whole first screen: no card, no border, edge to edge. On a phone it leaves a strip of
            the page showing underneath, and a vertical swipe scrolls the page (see the chart's handleScroll). */}
        <section id="chart" aria-label="icaneracoin candlestick chart" className="h-[calc(100svh-6.5rem-env(safe-area-inset-bottom))] min-h-[420px] w-full lg:h-[calc(100dvh-3rem)]">
          {error ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
              <p className={k.body}>The live chart could not be loaded right now.</p>
              <button type="button" onClick={refresh} className={`rounded-md px-4 py-2 text-sm font-semibold ${k.errBtn}`}>Try again</button>
            </div>
          ) : (
            <IcanTradingChart
              rows={candles}
              loading={loading}
              theme={theme}
              orders={trading.orders}
              buyMarkers={trading.buyMarkers}
              sellMarkers={trading.sellMarkers}
              draftPrice={draftPrice}
              lineStyles={lineStyles}
              onLineStyleChange={updateLineStyle}
              onLineStylesReset={resetLineStyles}
              placement={placement}
              onPickPrice={handlePickPrice}
              onLineSelect={handleLineSelect}
            />
          )}
        </section>

        {isDesktop && (
          <aside ref={asideRef} aria-label="Trade icaneracoin" className="sticky top-12 h-[calc(100dvh-3rem)] overflow-y-auto border-l" style={{ background: c.sheet, borderColor: c.cardBorder }}>
            {panel}
          </aside>
        )}

        <div className="lg:col-span-2">
          <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
            <p className={`text-xs ${k.soft}`}>
              Drag to move through time, pinch or scroll to zoom, tap or hover for each candle&apos;s open, high, low and close. Switch timeframe above the chart.
              {priceUsd != null && <> Current price ≈ USD {priceUsd.toLocaleString(undefined, { maximumFractionDigits: 6 })}.</>}
            </p>

            <section id="analysis" aria-labelledby="chart-analysis-heading" className="mt-8 scroll-mt-16">
              <h2 id="chart-analysis-heading" className={`text-2xl font-bold ${k.title}`}>icaneracoin chart analysis</h2>
              <p className={`mt-2 max-w-3xl text-sm leading-6 ${k.body}`}>{summary}</p>
              <div className="mt-4">
                <IcanAnalysisPanel analysis={analysis} dark={dark} />
              </div>
              <p className={`mt-3 text-xs ${k.soft}`}>
                Indicators are calculated from the candles above and are for information only — they are not financial advice.
              </p>
            </section>

            <section className={`mt-12 rounded-2xl border p-6 sm:p-8 ${k.card}`}>
              <h2 className={`text-2xl font-bold ${k.title}`}>Trade icaneracoin on IcanEra</h2>
              <p className={`mt-2 max-w-2xl text-sm leading-6 ${k.body}`}>
                Continue with Google to get your IcanEra wallet, top up with Mobile Money, card or bank, buy coins, and book buy or sell orders
                at the price you choose straight from this chart. Manage your business and personal finances in the same place.
              </p>
              <div className="mt-5 flex flex-wrap gap-3">
                <button type="button" onClick={() => { setTradeTab('buy'); setSheetOpen(true); if (isDesktop) scrollToId('chart'); }} className={`inline-flex items-center gap-2 rounded-md px-5 py-3 text-sm font-bold ${k.cta}`}>
                  Start trading <ArrowRight className="h-4 w-4" />
                </button>
                <a href="/" className={`inline-flex items-center gap-2 rounded-md border px-5 py-3 text-sm font-semibold ${k.ghost}`}>
                  Explore IcanEra
                </a>
              </div>
            </section>

            <section id="learn" aria-labelledby="faq-heading" className="mt-12 scroll-mt-16">
              <h2 id="faq-heading" className={`text-2xl font-bold ${k.title}`}>About the icaneracoin chart</h2>
              <div className={`mt-4 divide-y rounded-xl border ${k.rule}`}>
                {FAQ.map((item) => (
                  <details key={item.q} className="group px-4 py-3 sm:px-5">
                    <summary className={`cursor-pointer list-none text-base font-semibold marker:hidden ${k.faqQ}`}>{item.q}</summary>
                    <p className={`mt-2 text-sm leading-6 ${k.body}`}>{item.a}</p>
                  </details>
                ))}
              </div>
            </section>
          </div>
        </div>
      </main>

      <footer className={`border-t px-4 pb-24 pt-6 text-center text-xs lg:pb-6 ${k.footBorder}`}>
        © IcanEra · <a href="/" className={`underline ${k.footLink}`}>Home</a> · <a href="/pricing" className={`underline ${k.footLink}`}>Pricing</a>
      </footer>

      {/* Phone navigation: always within thumb reach, never hidden behind the chart. */}
      {!isDesktop && (
        <nav aria-label="Page sections" className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t backdrop-blur" style={{ background: c.card, borderColor: c.cardBorder, paddingBottom: 'env(safe-area-inset-bottom)' }}>
          {navBtn('Chart', LineChartIcon, () => window.scrollTo({ top: 0, behavior: 'smooth' }))}
          {navBtn('Trade', ArrowLeftRight, () => setSheetOpen(true), { primary: true, active: sheetOpen })}
          {navBtn('Analysis', BarChart3, () => scrollToId('analysis'))}
          {navBtn('Learn', HelpCircle, () => scrollToId('learn'))}
        </nav>
      )}

      {!isDesktop && sheetOpen && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Trade icaneracoin">
          <div className="absolute inset-0" style={{ background: c.scrim }} onClick={() => setSheetOpen(false)} aria-hidden="true" />
          <div className="absolute inset-x-0 bottom-0 flex max-h-[90dvh] flex-col rounded-t-2xl shadow-2xl" style={{ background: c.sheet, color: c.fg, paddingBottom: 'env(safe-area-inset-bottom)' }}>
            <div className="relative flex h-11 shrink-0 items-center justify-center">
              <span className="h-1.5 w-10 rounded-full" style={{ background: c.fieldBorder }} aria-hidden="true" />
              <button type="button" onClick={() => setSheetOpen(false)} aria-label="Close" className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-2" style={{ color: c.soft }}>
                <X className="h-5 w-5" />
              </button>
            </div>
            <div ref={sheetScrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{panel}</div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PublicIcanChartPage;
