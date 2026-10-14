import React, { useEffect, useRef } from 'react';
import { createChart, CandlestickSeries, ColorType, CrosshairMode } from 'lightweight-charts';

// A sector index as 5-minute candles. `candles` are oldest first: { time (unix seconds), open, high, low, close }, in
// index levels (100 = the day the sector opened). The chart is created once and fed new data; it only re-fits the view
// when the sector changes, so a poll never throws away the viewer's zoom.
const COLORS = {
  text: '#94a3b8',
  grid: 'rgba(148,163,184,0.12)',
  axis: 'rgba(148,163,184,0.25)',
  up: '#34d399',
  down: '#f87171',
};

export default function SectorIndexChart({ candles, ticker }) {
  const boxRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);
  const fittedFor = useRef(null);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return undefined;
    let chart;
    try {
      chart = createChart(el, {
        autoSize: true,
        layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: COLORS.text, fontSize: 11 },
        grid: { vertLines: { color: COLORS.grid }, horzLines: { color: COLORS.grid } },
        crosshair: { mode: CrosshairMode.Normal },
        rightPriceScale: { borderColor: COLORS.axis, scaleMargins: { top: 0.1, bottom: 0.1 } },
        timeScale: { borderColor: COLORS.axis, timeVisible: true, secondsVisible: false, rightOffset: 4 },
        // a vertical swipe on a phone scrolls the page instead of being swallowed by the chart
        handleScroll: { vertTouchDrag: false },
      });
      seriesRef.current = chart.addSeries(CandlestickSeries, {
        upColor: COLORS.up, downColor: COLORS.down,
        borderUpColor: COLORS.up, borderDownColor: COLORS.down,
        wickUpColor: COLORS.up, wickDownColor: COLORS.down,
        priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
      });
      chartRef.current = chart;
    } catch {
      chartRef.current = null; // a browser that cannot draw it just shows the numbers around it
    }
    return () => {
      try { chart?.remove(); } catch { /* already gone */ }
      chartRef.current = null;
      seriesRef.current = null;
      fittedFor.current = null;
    };
  }, []);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series || !candles?.length) return;
    series.setData(candles.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));
    if (fittedFor.current !== ticker) {
      chartRef.current?.timeScale().fitContent();
      fittedFor.current = ticker;
    }
  }, [candles, ticker]);

  const empty = !candles || candles.length < 2;
  return (
    <div className="relative h-64 sm:h-72 w-full" role="img" aria-label={`${ticker || 'Sector'} index chart`}>
      <div ref={boxRef} className="absolute inset-0" />
      {empty && (
        <div className="absolute inset-0 flex items-center justify-center text-center text-xs text-slate-500 px-6 pointer-events-none">
          The chart fills in as this index updates.
        </div>
      )}
    </div>
  );
}
