import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { LineChart as LineChartIcon, ChevronDown, ArrowRight, Maximize2, X } from 'lucide-react';
import IcanTradingChart from './IcanTradingChart';
import { CHART_PALETTES } from './chartPalettes';
import usePublicIcanCandles from '../hooks/usePublicIcanCandles';
import { isDarkFamilyTheme, useOptionalTheme } from '../context/ThemeContext';
import { describeCandleWindow, summarizeAnalysis } from '../utils/candleIndicators';

// The icaneracoin trading chart on the IcanEra dashboard (desktop and phone): the same candlesticks, timeframes,
// moving averages, RSI and Resistance / Support channel as the public /icaneracoin page, fed by the same candle feed.
//
// It sits straight on the page -- no card around it -- and the expand button opens it across the whole screen (and
// back). Self-contained: mount it anywhere, no props. It is read-only here: trading (Buy with wallet cash or card,
// Sell, Book) is one tap away on the full chart page, which shares this sign-in, so opening the dashboard never
// places or fills an order. On the page the wheel scrolls the page instead of zooming the chart, so the dashboard
// never gets stuck under the mouse; in the full-screen view the wheel zooms, like any chart.
const IcanPriceChartWidget = () => {
  const { candles, snapshot, analysis, loading, error, refresh } = usePublicIcanCandles(300);
  const { actualTheme } = useOptionalTheme();
  const theme = isDarkFamilyTheme(actualTheme) ? 'dark' : 'light';
  const c = CHART_PALETTES[theme];
  const [isExpanded, setIsExpanded] = useState(true);
  const [fullScreen, setFullScreen] = useState(false);

  const latest = candles.length ? candles[candles.length - 1] : null;
  const price = snapshot?.price_ugx != null ? Number(snapshot.price_ugx) : latest?.close ?? null;
  const changePct = analysis ? Number(analysis.momentum) : null;
  const windowLabel = useMemo(() => describeCandleWindow(candles), [candles]);
  const summary = useMemo(
    () => summarizeAnalysis(analysis, { windowLabel, candleCount: candles.length }),
    [analysis, windowLabel, candles.length],
  );

  // The full-screen view owns the screen: lock the page behind it and let Escape close it.
  useEffect(() => {
    if (!fullScreen) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => { if (e.key === 'Escape') setFullScreen(false); };
    window.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey); };
  }, [fullScreen]);

  const priceText = price != null ? `UGX ${price.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : null;
  const changeText = changePct != null ? `${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%` : null;
  const changeTone = changePct != null && changePct >= 0 ? 'text-emerald-400' : 'text-red-400';

  const failed = (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm" style={{ color: 'var(--color-textSecondary)' }}>
      <p>The live chart could not be loaded right now.</p>
      <button type="button" onClick={refresh} className="rounded-md border px-3 py-1.5 text-xs font-semibold" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>Try again</button>
    </div>
  );

  return (
    <section aria-label="icaneracoin chart">
      <div className="flex items-center gap-2 px-1 py-2">
        <button
          type="button"
          onClick={() => setIsExpanded((prev) => !prev)}
          aria-expanded={isExpanded}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <LineChartIcon className="h-4 w-4 shrink-0" style={{ color: '#f97316' }} aria-hidden="true" />
          <span className="text-sm font-bold" style={{ color: 'var(--color-text)' }}>icaneracoin</span>
          <span className="rounded border px-1.5 py-0.5 text-[10px] font-semibold" style={{ color: '#f97316', borderColor: 'rgba(249,115,22,0.4)' }}>Live</span>
          {priceText && (
            <span className="ml-auto whitespace-nowrap text-xs font-semibold tabular-nums" style={{ color: 'var(--color-text)' }}>
              {priceText}
              {changeText && <span className={`ml-1 ${changeTone}`} title={`Change over ${windowLabel}`}>{changeText}</span>}
            </span>
          )}
          <ChevronDown className="h-4 w-4 shrink-0 transition-transform" style={{ color: 'var(--color-textSecondary)', transform: isExpanded ? 'rotate(180deg)' : undefined }} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => setFullScreen(true)}
          aria-label="Open the chart full screen"
          title="Full screen"
          className="shrink-0 rounded-md p-2 hover:bg-white/10"
          style={{ color: 'var(--color-text)' }}
        >
          <Maximize2 className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {isExpanded && (
        <>
          {/* Straight on the page: no card, no border, no rounded corners. */}
          <div className="h-[380px] w-full md:h-[440px]">
            {fullScreen ? null : error ? failed : (
              <IcanTradingChart rows={candles} loading={loading} theme={theme} wheelZoom={false} />
            )}
          </div>
          <p className="mt-2 px-1 text-xs leading-5" style={{ color: 'var(--color-textSecondary)' }}>{summary}</p>
          <a
            href="/icaneracoin"
            className="mt-1 inline-flex items-center gap-1.5 px-1 text-xs font-semibold underline underline-offset-2"
            style={{ color: 'var(--color-text)' }}
          >
            Open the chart page &amp; trade <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        </>
      )}

      {fullScreen && createPortal(
        <div className="fixed inset-0 z-[60] flex flex-col" role="dialog" aria-modal="true" aria-label="icaneracoin chart, full screen" style={{ background: c.base, color: c.fg }}>
          <div className="flex h-12 shrink-0 items-center gap-3 border-b px-3" style={{ borderColor: c.cardBorder, background: c.card }}>
            <LineChartIcon className="h-4 w-4 shrink-0" style={{ color: '#f97316' }} aria-hidden="true" />
            <span className="text-base font-bold" style={{ color: c.strong }}>icaneracoin</span>
            {priceText && (
              <span className="ml-auto whitespace-nowrap text-sm font-semibold tabular-nums" style={{ color: c.strong }}>
                {priceText}
                {changeText && <span className="ml-1.5 text-xs" style={{ color: changePct >= 0 ? c.pos : c.neg }}>{changeText}</span>}
              </span>
            )}
            <a href="/icaneracoin" className="hidden shrink-0 rounded-md px-3 py-1.5 text-xs font-bold min-[400px]:inline-block" style={{ background: c.tabOnBg, color: c.tabOnText }}>Trade</a>
            <button type="button" onClick={() => setFullScreen(false)} aria-label="Close full screen" className="shrink-0 rounded-md p-2" style={{ color: c.soft }}>
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
          <div className="min-h-0 flex-1">
            {error ? failed : <IcanTradingChart rows={candles} loading={loading} theme={theme} />}
          </div>
        </div>,
        document.body,
      )}
    </section>
  );
};

export default IcanPriceChartWidget;
