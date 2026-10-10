import React, { Suspense, useEffect, useRef, useState } from 'react';
import { ArrowRight, LineChart as LineChartIcon } from 'lucide-react';
import { useTheme, isDarkFamilyTheme } from '../../context/ThemeContext';
import { lazyWithRetry } from '../../lib/lazyWithRetry';
import usePublicIcanCandles from '../../hooks/usePublicIcanCandles';
import IcanAnalysisPanel from '../IcanAnalysisPanel';
import { describeCandleWindow, summarizeAnalysis } from '../../utils/candleIndicators';

// The chart pulls in the charting library, so it is fetched (and the candle feed polled) only once this section is
// about to scroll into view -- the landing page's first paint never pays for it.
const IcanTradingChart = lazyWithRetry(() => import('../IcanTradingChart'));

const IcanChartLive = ({ isDarkTheme, onGetStarted }) => {
  const { candles, snapshot, analysis, loading, error, status } = usePublicIcanCandles(120);
  const latest = candles.length ? candles[candles.length - 1] : null;
  const priceUgx = snapshot?.price_ugx != null ? Number(snapshot.price_ugx) : latest?.close ?? null;
  const changePct = analysis ? Number(analysis.momentum) : null;
  const windowLabel = describeCandleWindow(candles);

  return (
    <>
      <div className="mt-5 flex flex-wrap items-end justify-center gap-x-5 gap-y-1">
        <p className={`text-3xl font-black tabular-nums ${isDarkTheme ? 'text-white' : 'text-slate-900'}`}>
          {priceUgx != null ? `UGX ${priceUgx.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : loading ? '…' : '—'}
        </p>
        {changePct != null && (
          <p className={`pb-0.5 text-base font-bold tabular-nums ${changePct > 0 ? 'text-emerald-500' : changePct < 0 ? 'text-red-500' : isDarkTheme ? 'text-slate-300' : 'text-slate-600'}`}>
            {changePct > 0 ? '+' : ''}{changePct.toFixed(2)}%
            <span className={`ml-1.5 text-xs font-medium ${isDarkTheme ? 'text-slate-400' : 'text-slate-500'}`}>{windowLabel}</span>
          </p>
        )}
      </div>

      <div className="mt-5 overflow-hidden">
        <div className="h-[340px] sm:h-[420px]">
          {error ? (
            <div className="flex h-full items-center justify-center p-6 text-center text-sm" style={{ color: isDarkTheme ? '#94a3b8' : '#64748b' }}>
              The live chart could not be loaded right now.
            </div>
          ) : (
            <Suspense fallback={<div className="flex h-full items-center justify-center text-sm" style={{ color: isDarkTheme ? '#64748b' : '#94a3b8' }}>Loading chart…</div>}>
              <IcanTradingChart rows={candles} loading={loading} variant="compact" theme={isDarkTheme ? 'dark' : 'light'} feedState={status} />
            </Suspense>
          )}
        </div>
      </div>

      {analysis && (
        <div className="mt-5">
          <p className={`mb-3 text-sm leading-6 ${isDarkTheme ? 'text-slate-300' : 'text-slate-600'}`}>
            {summarizeAnalysis(analysis, { windowLabel, candleCount: candles.length })}
          </p>
          <IcanAnalysisPanel analysis={analysis} dark={isDarkTheme} compact />
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <a
          href="/icaneracoin"
          className={`inline-flex items-center gap-2 rounded-md px-5 py-3 text-sm font-semibold transition ${isDarkTheme ? 'bg-amber-300 text-slate-950 hover:bg-amber-200' : 'bg-emerald-900 text-white hover:bg-emerald-800'}`}
        >
          Open the full chart &amp; analysis <ArrowRight className="h-4 w-4" />
        </a>
        <button
          type="button"
          onClick={() => onGetStarted?.('signup')}
          className={`inline-flex items-center gap-2 rounded-md border px-5 py-3 text-sm font-semibold transition ${isDarkTheme ? 'border-slate-600 text-slate-100 hover:bg-slate-800' : 'border-slate-300 text-slate-800 hover:bg-slate-100'}`}
        >
          Trade icaneracoin
        </button>
      </div>
    </>
  );
};

const IcanChartSection = ({ onGetStarted }) => {
  const { actualTheme } = useTheme();
  const isDarkTheme = isDarkFamilyTheme(actualTheme);
  const ref = useRef(null);
  const [near, setNear] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    if (typeof IntersectionObserver === 'undefined') { setNear(true); return undefined; }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { setNear(true); observer.disconnect(); }
    }, { rootMargin: '600px 0px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <section
      id="icaneracoin-chart"
      ref={ref}
      aria-labelledby="icaneracoin-chart-heading"
      className="relative py-10 md:py-16 lg:py-20 2xl:py-24 px-4 sm:px-6 lg:px-8 2xl:px-16"
    >
      <div className="max-w-4xl 2xl:max-w-5xl mx-auto">
        <div className="text-center">
          <div className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-full border text-xs md:text-sm font-bold mb-4 ${isDarkTheme ? 'border-amber-300/40 bg-amber-900/20 text-amber-200' : 'border-amber-400/60 bg-amber-100 text-amber-800'}`}>
            <LineChartIcon className="w-4 h-4" aria-hidden="true" />
            Live market chart
          </div>
          <h2 id="icaneracoin-chart-heading" className={`text-2xl md:text-4xl font-black ${isDarkTheme ? 'text-white' : 'text-slate-900'}`}>icaneracoin price chart</h2>
          <p className={`mt-2 text-sm md:text-base ${isDarkTheme ? 'text-slate-400' : 'text-slate-600'}`}>
            Live candlesticks and chart analysis for icaneracoin — built from real IcanEra transactions, open to everyone.
          </p>
        </div>

        {near ? (
          <IcanChartLive isDarkTheme={isDarkTheme} onGetStarted={onGetStarted} />
        ) : (
          <div className="mt-6 flex justify-center">
            <a href="/icaneracoin" className={`inline-flex items-center gap-2 text-sm font-semibold underline ${isDarkTheme ? 'text-amber-200' : 'text-emerald-900'}`}>
              View the icaneracoin chart <ArrowRight className="h-4 w-4" />
            </a>
          </div>
        )}
      </div>
    </section>
  );
};

export default IcanChartSection;
