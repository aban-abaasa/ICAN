import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowLeftRight, ArrowRight, BarChart3, Database, HelpCircle, ShieldCheck, LineChart as LineChartIcon, Moon, RefreshCw, Sun, X } from 'lucide-react';
import IcanTradingChart from './IcanTradingChart';
import IcanAnalysisPanel from './IcanAnalysisPanel';
import PublicTradePanel from './PublicTradePanel';
import PublicSectorMarkets from './PublicSectorMarkets';
import PublicOnChainTokens from './PublicOnChainTokens';
import PublicStableCoin from './PublicStableCoin';
import AmbientToggle from './AmbientToggle';
import { CHART_PALETTES } from './chartPalettes';
import { useLineStyles } from './chartLineStyles';
import usePublicTrading from '../hooks/usePublicTrading';
import usePublicIcanCandles from '../hooks/usePublicIcanCandles';
import { COIN_BASE, VIEW_TITLES, pathForView, viewFromPath } from '../utils/coinRoutes';
import { describeCandleWindow, summarizeAnalysis } from '../utils/candleIndicators';
import NavGlowDefs from './NavGlowDefs';
import '../styles/navGlow.css';

// /icaneracoin -- the public icaneracoin price chart. Anyone (and any search engine) can open it with no
// account: the live candlestick chart, the chart analysis, and a plain-language explanation of what they show.
// Standalone like the other public pages (mounted outside ThemeProvider/AuthProvider in main.jsx), so it carries
// its own light and dark palettes (the visitor's system setting by default, their last choice afterwards). The <head> (title, description, JSON-LD) is written server-side by api/share-preview.js
// for crawlers that never run this JS; the effect below only keeps it right when the page is reached client-side.

const PAGE_DESCRIPTION = 'Live icaneracoin (ICAN) price chart: real-time candlesticks, trend, RSI, moving averages, support and resistance, built from real IcanEra transactions.';

// Everything the page used to explain in running text now lives here, one tab per topic, so the sections above stay
// short. All panels stay in the DOM (inactive ones are just hidden) so the text still reads for crawlers.
const LEARN_TABS = [
  {
    id: 'chart',
    label: 'Chart',
    items: [
      {
        q: 'What is icaneracoin?',
        a: 'icaneracoin (ICAN) is the coin behind IcanEra, a blockchain application for sending money across the globe and running business and personal finances. You can buy, sell and transfer it from your IcanEra wallet.',
      },
      {
        q: 'How do I use the chart?',
        a: 'Drag to move through time, pinch or scroll to zoom, and tap or hover over a candle to see its open, high, low and close. Switch the timeframe above the chart.',
      },
      {
        q: 'How do I read the candlesticks?',
        a: 'Each candle covers the timeframe you pick (five minutes by default). Its body runs from the opening to the closing price (green if the price rose, red if it fell) and its wick shows the highest and lowest price reached. Hover over any candle to read its exact numbers.',
      },
      {
        q: 'Where does the icaneracoin chart data come from?',
        a: 'Every candle is built from real IcanEra activity — wallet transfers, business wallet payments, trust group and SACCO contributions. Nothing is simulated. A quiet period simply shows a flat candle at the current price.',
      },
    ],
  },
  {
    id: 'analysis',
    label: 'Indicators',
    items: [
      {
        q: 'What do RSI, moving averages, support and resistance mean?',
        a: 'RSI compares recent gains with recent losses: above 70 is usually called overbought, below 30 oversold. A moving average (MA) is the average closing price over the last 20 or 50 candles. Support and resistance are price levels the chart has recently struggled to fall below or rise above.',
      },
      {
        q: 'Are the indicators financial advice?',
        a: 'No. Indicators are calculated from the candles on the chart and are for information only. They show what the price has done, not what it will do. The analysis appears once there are at least two candles.',
      },
    ],
  },
  {
    id: 'sectors',
    label: 'Sector coins',
    items: [
      {
        q: 'What are Sector Markets?',
        a: 'Sector Markets are ten coins that each follow the combined sales of businesses in one sector on IcanEra, such as farms, transport, retail, health or education. Buy a sector you think will grow, sell when you want out. You buy and sell them with icaneracoin.',
      },
      {
        q: 'Is business data kept private?',
        a: 'Yes. The figures are anonymous totals: no business or customer is ever named, and a sector only opens once enough businesses take part that none can be picked out.',
      },
      {
        q: 'What are the risks and fees?',
        a: 'Prices can fall as well as rise, and you can lose what you put in. You trade against the IcanEra market vault, and a small fee applies to each buy and sell (shown before you confirm). If the price moves more than 1% against you between review and trade, the trade is cancelled. Nothing here is financial advice.',
      },
    ],
  },
  {
    id: 'tokens',
    label: 'Stable coins',
    items: [
      {
        q: 'What is ICEC-S?',
        a: 'ICEC-S is the stable form of icaneracoin: one ICEC-S is worth one US dollar. It lives inside your IcanEra wallet, so there is no blockchain to connect, no gas fee and no crypto wallet to install. It shows its value in your own currency (pounds, yen, euros, shillings, rupees and about 120 more), using the country you picked when you signed up.',
      },
      {
        q: 'Where does its price come from?',
        a: 'The same live currency rates icaneracoin is priced from, refreshed through the day. The chart records its value every minute. If those rates are ever more than a few hours old, swaps pause until they update.',
      },
      {
        q: 'Does it protect against inflation?',
        a: "It rises with the dollar when your local currency weakens, and it never goes below its start value grown by Uganda's yearly inflation, the same floor idea icaneracoin uses. Nobody can promise it will beat inflation by more than that.",
      },
      {
        q: 'What backs it?',
        a: 'Dollars. When you buy, your money is converted at the live rate and held in one shared pool as US dollars, so a falling local currency cannot shrink what an ICEC-S is worth. When you sell, the dollars come out of that pool. There is no company reserve behind it: in the rare case where the inflation floor sits above a plain dollar the pool can hold slightly less than the full value, the price is then the pool\'s share and the page says so. It is not a bank deposit.',
      },
      {
        q: 'What does it cost?',
        a: 'Buying is free. A 3% fee applies only when you cash out, the same single cash-out fee as the rest of IcanEra, and it goes to GODMINDERA ORGANISATION (U) LTD.',
      },
      {
        q: 'What is ICEC-C?',
        a: 'ICEC-C is the community form: a public blockchain receipt for icaneracoin you move out of your IcanEra wallet, worth what the coin is worth, which rises and falls as the community uses it. It lives in your own crypto wallet (IcanEra never holds your keys), cannot be sent to anyone else or sold on an exchange, and can only come back to IcanEra. It appears on this page once the chain is set up. Prices can fall as well as rise.',
      },
      {
        q: 'How do I get them?',
        a: "Sign in and open the wallet's Trade section, then the ICEC-S & C tab. Choose your currency, and buy or cash out in a few taps. This is not financial advice.",
      },
    ],
  },
  {
    id: 'trade',
    label: 'Trading',
    items: [
      {
        q: 'How do I trade icaneracoin?',
        a: 'Continue with Google to get your IcanEra wallet, top up with Mobile Money, card or bank, buy coins, and book buy or sell orders at the price you choose straight from the chart, trade the ten business-sector coins, or hold a steady dollar value with ICEC-S. You can manage your business and personal finances in the same place.',
      },
    ],
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

// The bottom bar's icons and the header links are real pages (see utils/coinRoutes.js): each has its own address, so the
// browser's Back button and a shared link work, and every page has a Back button in the header.
// Colours that travel along the active icon of the bottom bar (see styles/navGlow.css): the
// dark page's gold accent / the light page's deep emerald, with companions.
const NAV_COLOURS = {
  dark: { '--ng-active': '#fcd34d', '--ng-c1': '#fcd34d', '--ng-c2': '#34d399', '--ng-c3': '#38bdf8' },
  light: { '--ng-active': '#047857', '--ng-c1': '#10b981', '--ng-c2': '#f59e0b', '--ng-c3': '#0ea5e9' },
};

const PublicIcanChartPage = () => {
  const { candles, snapshot, analysis, loading, error, updatedAt, refresh, status } = usePublicIcanCandles(500);
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
  const [learnTab, setLearnTab] = useState('chart');

  // Which page of /icaneracoin is open. Moving between pages pushes a history entry, so Back returns to the page before.
  const [view, setView] = useState(() => viewFromPath(window.location.pathname));
  const navigate = useCallback((next) => {
    if (next === view) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    try { window.history.pushState({ ican: true }, '', pathForView(next)); } catch { /* the page still switches */ }
    setView(next);
  }, [view]);
  // Back button in the header: a page we pushed has somewhere to go back to; one opened from a link goes to the chart.
  const goBack = useCallback(() => {
    if (window.history.state?.ican) { window.history.back(); return; }
    try { window.history.replaceState({ ican: true }, '', COIN_BASE); } catch { /* ignore */ }
    setView('chart');
  }, []);
  useEffect(() => {
    const onPop = () => {
      setView(viewFromPath(window.location.pathname));
      const phone = window.matchMedia ? !window.matchMedia('(min-width: 1024px)').matches : true;
      setSheetOpen(!!window.history.state?.sheet && phone);
    };
    window.addEventListener('popstate', onPop);
    try { window.history.scrollRestoration = 'manual'; } catch { /* ignore */ }
    return () => { window.removeEventListener('popstate', onPop); try { window.history.scrollRestoration = 'auto'; } catch { /* ignore */ } };
  }, []);
  // each page opens at its top
  useEffect(() => { window.scrollTo(0, 0); }, [view]);
  useEffect(() => { document.title = VIEW_TITLES[view] || VIEW_TITLES.chart; }, [view]);

  // The phone trade sheet is a layer too: opening it adds a history entry, so Back closes the sheet, not the page.
  useEffect(() => {
    if (!sheetOpen || isDesktop || window.history.state?.sheet) return;
    try { window.history.pushState({ ...(window.history.state || {}), ican: true, sheet: true }, '', window.location.href); } catch { /* the sheet still opens */ }
  }, [sheetOpen, isDesktop]);
  const closeSheet = useCallback(() => {
    if (window.history.state?.sheet) window.history.back(); else setSheetOpen(false);
  }, []);

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
    const onKey = (e) => { if (e.key === 'Escape') closeSheet(); };
    window.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey); };
  }, [sheetOpen, isDesktop, closeSheet]);

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
    if (line.kind === 'live') { setTradeTab('buy'); setSheetOpen(true); return; }
    setTradeTab('book');
    if (line.kind === 'buy' || line.kind === 'sell') {
      setDraft((d) => ({ ...d, side: line.kind, price: String(Math.round(line.price * 100) / 100) }));
    }
    setSheetOpen(true);
  }, []);

  // The "?" next to a section opens the matching Learn tab and scrolls to it.
  const openLearn = useCallback((tab) => {
    setLearnTab(tab);
    navigate('learn');
  }, [navigate]);

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
      onClose={(why) => { if (why === 'chart' && !isDesktop) closeSheet(); }}
    />
  );

  // One independent glass tile of the phone bottom bar. While the Trade sheet is open
  // only Trade is lit; otherwise the tile for the section being read is.
  const navBtn = (id, label, Icon, onClick, { hero = false } = {}) => {
    const on = sheetOpen ? id === 'trade' : id === view;
    return (
      <button
        key={id}
        type="button"
        onClick={onClick}
        aria-current={on ? 'page' : undefined}
        className={`ng-tab ${on ? 'ng-on' : ''} ${hero ? 'ng-hero' : ''} flex flex-col items-center justify-center gap-0.5 px-1 py-1.5 text-[11px] font-semibold`}
      >
        <Icon className="h-5 w-5" aria-hidden="true" />
        {label}
      </button>
    );
  };

  return (
    <div className={`min-h-screen font-sans ${k.page}`}>
      <header className={`sticky top-0 z-30 border-b backdrop-blur ${k.bar}`}>
        <div className="flex h-12 items-center gap-2 px-3 sm:gap-3 sm:px-5">
          {view !== 'chart' && (
            <button type="button" onClick={goBack} aria-label="Back" title="Back" className={`-ml-1 shrink-0 rounded-md p-2 ${k.icon} ${k.hover}`}>
              <ArrowLeft className="h-5 w-5" />
            </button>
          )}
          {/* With the Back button showing, a narrow phone drops the small logo so the name keeps its room. */}
          <a href="/" className={`${view === 'chart' ? 'flex' : 'hidden min-[420px]:flex'} shrink-0 items-center gap-2 text-base font-bold tracking-tight ${k.title}`} aria-label="IcanEra home">
            <img src="/icons/icon-192x192.png" alt="" width="26" height="26" className="rounded-md" />
            <span className="hidden sm:inline">IcanEra</span>
          </a>
          {/* The name takes the room between the logo and the price and is cut with an ellipsis when it is tight (large text
              sizes on a small phone); it used to be unshrinkable, spilled out of its box and was drawn under the price. */}
          <h1 className="mr-1 flex min-w-0 flex-1 items-baseline gap-1.5 font-bold lg:flex-none">
            <span className={`min-w-0 truncate text-base sm:text-lg ${k.title}`}>icaneracoin</span>
            <span className={`hidden truncate text-sm font-semibold md:inline ${k.soft}`}>(ICAN) price chart</span>
          </h1>
          <nav aria-label="On this page" className="hidden items-center gap-1 text-sm font-semibold lg:flex">
            {[['chart', 'Chart'], ['analysis', 'Analysis'], ['sectors', 'Business data'], ['tokens', 'Stable coins'], ['learn', 'Learn']].map(([id, label]) => (
              <button key={id} type="button" onClick={() => navigate(id)} aria-current={view === id ? 'page' : undefined} className={`rounded-md px-3 py-1.5 ${k.icon} ${k.hover} ${view === id ? 'font-bold underline decoration-2 underline-offset-8' : ''}`}>{label}</button>
            ))}
          </nav>
          <div className="ml-auto flex shrink-0 items-center gap-1 text-sm tabular-nums sm:gap-2">
            {priceUgx != null && (
              <span className="flex items-baseline gap-1.5" aria-label="Current icaneracoin price">
                <span className={`font-bold ${k.title}`}><span className="hidden sm:inline">UGX </span>{fmtUgx(priceUgx)}</span>
                {changePct != null && (
                  <span className={`hidden text-xs font-semibold sm:inline ${changePct > 0 ? up : changePct < 0 ? down : k.soft}`}>
                    {changePct > 0 ? '+' : ''}{changePct.toFixed(2)}%
                  </span>
                )}
              </span>
            )}
            <button type="button" onClick={refresh} aria-label="Refresh chart" title={updatedAt ? `Updated ${updatedAt.toLocaleTimeString()}` : 'Refresh'} className={`hidden rounded-md p-1.5 sm:p-2 min-[400px]:block ${k.icon} ${k.hover}`}>
              <RefreshCw className="h-4 w-4" />
            </button>
            {/* The same switch as the website's: also turns this chart's own diamond backdrop on or off. */}
            <AmbientToggle className={`rounded-md p-1.5 sm:p-2 ${k.icon} ${k.hover}`} />
            <button type="button" onClick={toggleTheme} aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'} title={dark ? 'Light mode' : 'Dark mode'} className={`rounded-md p-1.5 sm:p-2 ${k.icon} ${k.hover}`}>
              {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </header>

      <main className="pb-20 lg:pb-0">
        {view === 'chart' && (
          <>
        {/* The chart and the docked trade panel share ONE row of their own. They used to be the first row of a grid that
            also held everything below, and a sticky panel in a grid stays pinned for the whole grid, not its row, so on a
            desktop it floated over the right-hand side of the analysis, the FAQ and the sector coins. */}
        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* The chart owns the whole first screen: no card, no border, edge to edge. On a phone it leaves a strip of
            the page showing underneath, and a vertical swipe scrolls the page (see the chart's handleScroll). */}
        <section id="chart" aria-label="icaneracoin candlestick chart" className="h-[calc(100svh-7.25rem-env(safe-area-inset-bottom))] min-h-[420px] w-full lg:h-[calc(100dvh-3rem)]">
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
              feedState={status}
            />
          )}
        </section>

        {isDesktop && (
          <aside ref={asideRef} aria-label="Trade icaneracoin" className="sticky top-12 h-[calc(100dvh-3rem)] overflow-y-auto border-l" style={{ background: c.sheet, borderColor: c.cardBorder }}>
            {panel}
          </aside>
        )}
        </div>

            <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
              <section className={`mt-10 flex flex-col gap-4 rounded-2xl border p-5 sm:flex-row sm:items-center sm:justify-between ${k.card}`}>
                <h2 className={`text-lg font-bold sm:text-xl ${k.title}`}>Ready to trade icaneracoin?</h2>
                <div className="flex flex-wrap gap-3">
                  <button type="button" onClick={() => { setTradeTab('buy'); setSheetOpen(true); }} className={`inline-flex min-h-[44px] items-center gap-2 rounded-md px-5 py-2.5 text-sm font-bold ${k.cta}`}>
                    Start trading <ArrowRight className="h-4 w-4" />
                  </button>
                  <a href="/" className={`inline-flex min-h-[44px] items-center gap-2 rounded-md border px-5 py-2.5 text-sm font-semibold ${k.ghost}`}>
                    Explore IcanEra
                  </a>
                </div>
              </section>
            </div>
          </>
        )}

        {view === 'analysis' && (
          <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
            <section id="analysis" aria-labelledby="chart-analysis-heading" className="scroll-mt-16">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className={`text-xs font-bold uppercase tracking-[0.16em] ${k.kicker}`}>Analysis</p>
                  <h2 id="chart-analysis-heading" className={`mt-1 text-xl font-bold sm:text-2xl ${k.title}`}>Chart analysis</h2>
                </div>
                <button type="button" onClick={() => openLearn('analysis')} aria-label="How to read the indicators" title="How to read the indicators" className={`-m-2 rounded-md p-2 ${k.icon} ${k.hover}`}>
                  <HelpCircle className="h-4 w-4" />
                </button>
              </div>
              {priceUgx != null && (
                <p className={`mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-sm tabular-nums ${k.soft}`}>
                  <span className={`text-lg font-bold ${k.title}`}>UGX {fmtUgx(priceUgx)}</span>
                  {priceUsd != null && <span>≈ USD {priceUsd.toLocaleString(undefined, { maximumFractionDigits: 6 })}</span>}
                  {changePct != null && <span className={`font-semibold ${changePct > 0 ? up : changePct < 0 ? down : ''}`}>{changePct > 0 ? '+' : ''}{changePct.toFixed(2)}%</span>}
                </p>
              )}
              <div className="mt-3">
                <IcanAnalysisPanel analysis={analysis} dark={dark} primaryCount={4} />
              </div>
              <p className={`mt-2 text-[11px] ${k.soft}`}>For information only, not financial advice.</p>
            </section>
          </div>
        )}

        {view === 'sectors' && (
          <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
            <div className="-mt-10">
            <PublicSectorMarkets
              theme={theme}
              skin={k}
              trading={trading}
              onLearn={() => openLearn('sectors')}
              ican={{ candles, price: priceUgx, changePct }}
              onTradeIcan={() => { setTradeTab('buy'); navigate('chart'); setSheetOpen(true); }}
            />
            </div>
          </div>
        )}

        {view === 'tokens' && (
          <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
            <div className="-mt-10">
            <PublicStableCoin theme={theme} skin={k} onLearn={() => openLearn('tokens')} />
            <PublicOnChainTokens theme={theme} skin={k} priceUgx={priceUgx} onLearn={() => openLearn('tokens')} />
            </div>
          </div>
        )}

        {view === 'learn' && (
          <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
            <div className="-mt-10">
            <section id="learn" aria-labelledby="learn-heading" className="mt-10 scroll-mt-16">
              <p className={`text-xs font-bold uppercase tracking-[0.16em] ${k.kicker}`}>Learn</p>
              <h2 id="learn-heading" className={`mt-1 text-xl font-bold sm:text-2xl ${k.title}`}>About icaneracoin</h2>
              <div role="tablist" aria-label="Learn topics" className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0" style={{ scrollbarWidth: 'none' }}>
                {LEARN_TABS.map((t) => {
                  const on = t.id === learnTab;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      role="tab"
                      id={`learn-tab-${t.id}`}
                      aria-selected={on}
                      aria-controls={`learn-panel-${t.id}`}
                      onClick={() => setLearnTab(t.id)}
                      className={`min-h-[40px] shrink-0 rounded-full border px-4 text-sm font-semibold ${on ? k.cta : `${k.ghost}`}`}
                    >
                      {t.label}
                    </button>
                  );
                })}
              </div>
              {LEARN_TABS.map((t) => (
                <div key={t.id} role="tabpanel" id={`learn-panel-${t.id}`} aria-labelledby={`learn-tab-${t.id}`} hidden={t.id !== learnTab} className="mt-3">
                  {t.id === 'analysis' && analysis && summary && (
                    <p className={`mb-3 rounded-xl border p-4 text-sm leading-6 ${k.card} ${k.body}`}>
                      <span className={`mb-1 block text-xs font-bold uppercase tracking-wide ${k.kicker}`}>Right now</span>
                      {summary}
                    </p>
                  )}
                  <div className={`divide-y rounded-xl border ${k.rule}`}>
                    {t.items.map((item) => (
                      <details key={item.q} className="group px-4 sm:px-5">
                        <summary className={`flex min-h-[48px] cursor-pointer list-none items-center justify-between gap-3 py-3 text-base font-semibold marker:hidden ${k.faqQ}`}>
                          {item.q}
                          <span aria-hidden="true" className={`shrink-0 text-sm transition-transform group-open:rotate-180 ${k.soft}`}>▾</span>
                        </summary>
                        <p className={`pb-4 text-sm leading-6 ${k.body}`}>{item.a}</p>
                      </details>
                    ))}
                  </div>
                </div>
              ))}
            </section>
            </div>
          </div>
        )}
      </main>

      <footer className={`border-t px-4 pb-28 pt-6 text-center text-xs lg:pb-6 ${k.footBorder}`}>
        © IcanEra · A product of GODMINDERA ORGANISATION (U) LTD · <a href="/" className={`underline ${k.footLink}`}>Home</a> · <a href="/pricing" className={`underline ${k.footLink}`}>Pricing</a>
      </footer>

      {/* Phone navigation: always within thumb reach, never hidden behind the chart. */}
      {!isDesktop && (
        <nav
          aria-label="Pages"
          className="ng-bar fixed inset-x-0 bottom-0 z-40 flex"
          style={{ ...NAV_COLOURS[theme], '--ng-surface': c.base, '--ng-text': c.soft, background: `${c.base}f2`, borderTop: `1px solid ${c.cardBorder}`, backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)' }}
        >
          <NavGlowDefs />
          {navBtn('chart', 'Chart', LineChartIcon, () => navigate('chart'))}
          {navBtn('trade', 'Trade', ArrowLeftRight, () => setSheetOpen(true), { hero: true })}
          {navBtn('analysis', 'Analysis', BarChart3, () => navigate('analysis'))}
          {navBtn('sectors', 'Data', Database, () => navigate('sectors'))}
          {navBtn('tokens', 'Stable', ShieldCheck, () => navigate('tokens'))}
          {navBtn('learn', 'Learn', HelpCircle, () => navigate('learn'))}
        </nav>
      )}

      {!isDesktop && sheetOpen && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Trade icaneracoin">
          <div className="absolute inset-0" style={{ background: c.scrim }} onClick={closeSheet} aria-hidden="true" />
          <div className="absolute inset-x-0 bottom-0 flex max-h-[90dvh] flex-col rounded-t-2xl shadow-2xl" style={{ background: c.sheet, color: c.fg, paddingBottom: 'env(safe-area-inset-bottom)' }}>
            <div className="relative flex h-11 shrink-0 items-center justify-center">
              <span className="h-1.5 w-10 rounded-full" style={{ background: c.fieldBorder }} aria-hidden="true" />
              <button type="button" onClick={closeSheet} aria-label="Close" className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-2" style={{ color: c.soft }}>
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
