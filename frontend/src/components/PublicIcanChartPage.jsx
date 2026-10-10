import React, { useEffect, useMemo } from 'react';
import { ArrowRight, LineChart as LineChartIcon, RefreshCw } from 'lucide-react';
import IcanTradingChart from './IcanTradingChart';
import IcanAnalysisPanel from './IcanAnalysisPanel';
import usePublicIcanCandles from '../hooks/usePublicIcanCandles';
import { describeCandleWindow, summarizeAnalysis } from '../utils/candleIndicators';

// /icaneracoin -- the public icaneracoin price chart. Anyone (and any search engine) can open it with no
// account: the live candlestick chart, the chart analysis, and a plain-language explanation of what they show.
// Standalone like the other public pages (mounted outside ThemeProvider/AuthProvider in main.jsx), so it carries
// its own dark palette. The <head> (title, description, JSON-LD) is written server-side by api/share-preview.js
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

  useEffect(() => {
    document.title = PAGE_TITLE;
    setMeta('meta[name="description"]', 'content', PAGE_DESCRIPTION);
    setMeta('link[rel="canonical"]', 'href', 'https://icanera.space/icaneracoin');
    document.body.style.background = '#020617';
    return () => { document.body.style.background = ''; };
  }, []);

  const latest = candles.length ? candles[candles.length - 1] : null;
  const priceUgx = snapshot?.price_ugx != null ? Number(snapshot.price_ugx) : latest?.close ?? null;
  const priceUsd = snapshot?.price_usd != null ? Number(snapshot.price_usd) : null;
  const changePct = analysis ? Number(analysis.momentum) : null;
  const windowLabel = useMemo(() => describeCandleWindow(candles), [candles]);
  const summary = useMemo(
    () => summarizeAnalysis(analysis, { windowLabel, candleCount: candles.length }),
    [analysis, windowLabel, candles.length],
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans">
      <header className="border-b border-slate-800">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <a href="/" className="flex items-center gap-2 text-lg font-bold tracking-tight text-white">
            <img src="/icons/icon-192x192.png" alt="" width="28" height="28" className="rounded-md" />
            IcanEra
          </a>
          <nav className="flex items-center gap-2 text-sm font-semibold">
            <a href="/" className="rounded-md px-3 py-2 text-slate-300 hover:text-white">Home</a>
            <a href="/?auth=signup" className="rounded-md bg-amber-300 px-3.5 py-2 text-slate-950 hover:bg-amber-200">Create account</a>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
        <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-amber-300">
          <LineChartIcon className="h-4 w-4" aria-hidden="true" /> Live market chart
        </p>
        <h1 className="mt-3 text-3xl font-black tracking-tight text-white sm:text-5xl">icaneracoin (ICAN) price chart</h1>
        <p className="mt-3 max-w-3xl text-base leading-7 text-slate-300">
          Live candlestick chart and chart analysis for icaneracoin, the coin behind IcanEra. Every candle is built
          from real transactions on the platform — no simulated data.
        </p>

        <section aria-label="Current icaneracoin price" className="mt-6 flex flex-wrap items-end gap-x-6 gap-y-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Price per icaneracoin</p>
            <p className="text-3xl font-black tabular-nums text-white sm:text-4xl">
              {priceUgx != null ? `UGX ${fmtUgx(priceUgx)}` : loading ? 'Loading…' : 'Unavailable'}
            </p>
          </div>
          {priceUsd != null && (
            <p className="pb-1 text-lg font-semibold tabular-nums text-slate-300">≈ USD {priceUsd.toLocaleString(undefined, { maximumFractionDigits: 6 })}</p>
          )}
          {changePct != null && (
            <p className={`pb-1 text-lg font-bold tabular-nums ${changePct > 0 ? 'text-emerald-400' : changePct < 0 ? 'text-red-400' : 'text-slate-300'}`}>
              {changePct > 0 ? '+' : ''}{changePct.toFixed(2)}% <span className="text-sm font-medium text-slate-400">over {windowLabel}</span>
            </p>
          )}
        </section>

        <section aria-label="icaneracoin candlestick chart" className="mt-6 overflow-hidden rounded-xl border border-slate-800 bg-slate-950">
          <div className="flex items-center justify-between gap-3 border-b border-slate-800 px-4 py-2.5 text-xs text-slate-400">
            <span className="font-semibold text-slate-200">ICAN / UGX · real candlestick chart</span>
            <span className="flex items-center gap-2">
              {updatedAt && <span>Updated {updatedAt.toLocaleTimeString()}</span>}
              <button
                type="button"
                onClick={refresh}
                aria-label="Refresh chart"
                className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
            </span>
          </div>
          <div className="h-[560px] sm:h-[680px]">
            {error ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
                <p className="text-slate-300">The live chart could not be loaded right now.</p>
                <button type="button" onClick={refresh} className="rounded-md bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700">Try again</button>
              </div>
            ) : (
              <IcanTradingChart rows={candles} loading={loading} />
            )}
          </div>
        </section>
        <p className="mt-2 text-xs text-slate-500">Drag to move through time, scroll or pinch to zoom, hover for each candle's open, high, low and close. Switch timeframe above the chart.</p>

        <section aria-labelledby="chart-analysis-heading" className="mt-10">
          <h2 id="chart-analysis-heading" className="text-2xl font-bold text-white">icaneracoin chart analysis</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">{summary}</p>
          <div className="mt-4">
            <IcanAnalysisPanel analysis={analysis} dark />
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Indicators are calculated from the candles above and are for information only — they are not financial advice.
          </p>
        </section>

        <section className="mt-12 rounded-2xl border border-amber-300/30 bg-slate-900/60 p-6 sm:p-8">
          <h2 className="text-2xl font-bold text-white">Trade icaneracoin on IcanEra</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
            Create a free IcanEra account to buy, sell and send icaneracoin from your wallet, book orders at a price you choose
            straight from this chart, and manage your business and personal finances in one place.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <a href="/?auth=signup" className="inline-flex items-center gap-2 rounded-md bg-amber-300 px-5 py-3 text-sm font-bold text-slate-950 hover:bg-amber-200">
              Create free account <ArrowRight className="h-4 w-4" />
            </a>
            <a href="/" className="inline-flex items-center gap-2 rounded-md border border-slate-600 px-5 py-3 text-sm font-semibold text-slate-100 hover:bg-slate-800">
              Explore IcanEra
            </a>
          </div>
        </section>

        <section aria-labelledby="faq-heading" className="mt-12">
          <h2 id="faq-heading" className="text-2xl font-bold text-white">About the icaneracoin chart</h2>
          <div className="mt-4 divide-y divide-slate-800 rounded-xl border border-slate-800">
            {FAQ.map((item) => (
              <details key={item.q} className="group px-4 py-3 sm:px-5">
                <summary className="cursor-pointer list-none text-base font-semibold text-slate-100 marker:hidden">{item.q}</summary>
                <p className="mt-2 text-sm leading-6 text-slate-300">{item.a}</p>
              </details>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-800 px-4 py-6 text-center text-xs text-slate-500">
        © IcanEra · <a href="/" className="underline hover:text-slate-300">Home</a> · <a href="/pricing" className="underline hover:text-slate-300">Pricing</a>
      </footer>
    </div>
  );
};

export default PublicIcanChartPage;
