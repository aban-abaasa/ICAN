import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Moon, RefreshCw, Sun } from 'lucide-react';
import IcanTradingChart from './IcanTradingChart';
import IcanAnalysisPanel from './IcanAnalysisPanel';
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

const PublicIcanChartPage = () => {
  const { candles, snapshot, analysis, loading, error, updatedAt, refresh } = usePublicIcanCandles(500);
  const [theme, setTheme] = useState(initialTheme);
  const k = SKIN[theme];
  const dark = theme === 'dark';

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

  const latest = candles.length ? candles[candles.length - 1] : null;
  const priceUgx = snapshot?.price_ugx != null ? Number(snapshot.price_ugx) : latest?.close ?? null;
  const priceUsd = snapshot?.price_usd != null ? Number(snapshot.price_usd) : null;
  const changePct = analysis ? Number(analysis.momentum) : null;
  const windowLabel = useMemo(() => describeCandleWindow(candles), [candles]);
  const summary = useMemo(
    () => summarizeAnalysis(analysis, { windowLabel, candleCount: candles.length }),
    [analysis, windowLabel, candles.length],
  );
  const up = dark ? 'text-[#34d399]' : 'text-[#047857]';
  const down = dark ? 'text-[#f87171]' : 'text-[#dc2626]';

  return (
    <div className={`min-h-screen font-sans ${k.page}`}>
      <header className={`sticky top-0 z-30 border-b backdrop-blur ${k.bar}`}>
        <div className="flex h-12 items-center gap-3 px-3 sm:px-5">
          <a href="/" className={`flex shrink-0 items-center gap-2 text-base font-bold tracking-tight ${k.title}`} aria-label="IcanEra home">
            <img src="/icons/icon-192x192.png" alt="" width="26" height="26" className="rounded-md" />
            <span className="hidden sm:inline">IcanEra</span>
          </a>
          <h1 className={`min-w-0 truncate text-sm font-bold sm:text-base ${k.title}`}>icaneracoin (ICAN) price chart</h1>
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
            <a href="/?auth=signup" className={`hidden rounded-md px-3 py-1.5 text-xs font-bold sm:inline-block ${k.cta}`}>Create account</a>
          </div>
        </div>
      </header>

      <main>
        {/* The chart owns the whole first screen: no card, no border, edge to edge. */}
        <section aria-label="icaneracoin candlestick chart" className="h-[calc(100dvh-3rem)] min-h-[480px] w-full">
          {error ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
              <p className={k.body}>The live chart could not be loaded right now.</p>
              <button type="button" onClick={refresh} className={`rounded-md px-4 py-2 text-sm font-semibold ${k.errBtn}`}>Try again</button>
            </div>
          ) : (
            <IcanTradingChart rows={candles} loading={loading} theme={theme} />
          )}
        </section>

        <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
          <p className={`text-xs ${k.soft}`}>
            Drag to move through time, scroll or pinch to zoom, hover for each candle&apos;s open, high, low and close. Switch timeframe above the chart.
            {priceUsd != null && <> Current price ≈ USD {priceUsd.toLocaleString(undefined, { maximumFractionDigits: 6 })}.</>}
          </p>

          <section aria-labelledby="chart-analysis-heading" className="mt-8">
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
              Create a free IcanEra account to buy, sell and send icaneracoin from your wallet, book orders at a price you choose
              straight from this chart, and manage your business and personal finances in one place.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <a href="/?auth=signup" className={`inline-flex items-center gap-2 rounded-md px-5 py-3 text-sm font-bold ${k.cta}`}>
                Create free account <ArrowRight className="h-4 w-4" />
              </a>
              <a href="/" className={`inline-flex items-center gap-2 rounded-md border px-5 py-3 text-sm font-semibold ${k.ghost}`}>
                Explore IcanEra
              </a>
            </div>
          </section>

          <section aria-labelledby="faq-heading" className="mt-12">
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
      </main>

      <footer className={`border-t px-4 py-6 text-center text-xs ${k.footBorder}`}>
        © IcanEra · <a href="/" className={`underline ${k.footLink}`}>Home</a> · <a href="/pricing" className={`underline ${k.footLink}`}>Pricing</a>
      </footer>
    </div>
  );
};

export default PublicIcanChartPage;
