import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createChart,
  ColorType,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  CrosshairMode,
  LineStyle,
} from 'lightweight-charts';
import { TIMEFRAMES, toSeries, aggregateSeries, smaSeries, rsiSeries, trendChannel, channelValue } from '../utils/candleSeries';
import DiamondChartBackdrop from './DiamondChartBackdrop';

// The icaneracoin trading chart: true OHLC candlesticks (body + wicks) on a TradingView-style canvas, with a
// crosshair and OHLC read-out, volume histogram, 20/50 moving-average overlays, an RSI pane, timeframe
// roll-ups (5m to 1D), a live candle countdown and a dashed Resistance / Support trend channel, all drawn over
// the IcanEra blockchain-diamond backdrop (candles are slim green/red, like a broker's chart). Read-only -- it draws the public candle feed and never
// places an order. `variant="compact"` is the landing-page version (candles, volume and a few controls).

const UP = '#22b24c';
const DOWN = '#e5233b';
const TREND = 'rgba(226,232,240,0.85)';
const LINE_EXTEND_BARS = 8; // the channel runs on past the last candle, like a hand-drawn trend line
const MA20 = '#fbbf24';
const MA50 = '#38bdf8';
const GRID = 'rgba(148,163,184,0.06)';
const AXIS = 'rgba(71,85,105,0.55)';

const localTick = (time, type) => {
  const d = new Date(time * 1000);
  return type <= 2
    ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
};
const localStamp = (time) => new Date(time * 1000).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

const precisionFor = (price) => (price < 1 ? 6 : price < 100 ? 4 : 2);
const fmtPrice = (n, digits = 2) => (Number.isFinite(n) ? n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits }) : '—');

// A market with no movement would otherwise autoscale to a hairline of noise; keep at least a 0.4% span so a
// quiet icaneracoin reads as a calm flat line in the middle of the pane instead of a jagged one.
const withMinimumSpan = (original) => {
  const res = original();
  if (!res || !res.priceRange) return res;
  const { minValue, maxValue } = res.priceRange;
  const mid = (minValue + maxValue) / 2;
  const minSpan = Math.abs(mid) * 0.004;
  if (maxValue - minValue >= minSpan) return res;
  return { ...res, priceRange: { minValue: mid - minSpan / 2, maxValue: mid + minSpan / 2 } };
};

const countdown = (seconds) => {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
};

const IcanTradingChart = ({ rows, loading = false, variant = 'full' }) => {
  const full = variant === 'full';
  // How many candles to frame: fewer on a phone so the bodies stay readable.
  const framedBars = () => {
    const narrow = (containerRef.current?.clientWidth || 1000) < 520;
    return full ? (narrow ? 60 : 120) : (narrow ? 45 : 80);
  };
  const containerRef = useRef(null);
  const apiRef = useRef(null); // { chart, candles, volume, ma20, ma50, rsi }
  const viewKeyRef = useRef('');
  const channelRef = useRef(null);
  const placeRef = useRef(() => {});
  const [tfId, setTfId] = useState('5m');
  const [showMA, setShowMA] = useState(true);
  const [showVolume, setShowVolume] = useState(true);
  const [showTrend, setShowTrend] = useState(true);
  const [labels, setLabels] = useState(null);
  const [hover, setHover] = useState(null);
  const [now, setNow] = useState(() => Date.now());

  const tf = TIMEFRAMES.find((t) => t.id === tfId) || TIMEFRAMES[0];
  const base = useMemo(() => toSeries(rows), [rows]);
  const bars = useMemo(() => aggregateSeries(base, tf.seconds), [base, tf.seconds]);
  const last = bars.length ? bars[bars.length - 1] : null;
  const prev = bars.length > 1 ? bars[bars.length - 2] : null;

  // One chart for the life of the component.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;

    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#94a3b8',
        fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
        fontSize: 11,
        panes: { separatorColor: AXIS, separatorHoverColor: '#334155', enableResize: true },
      },
      grid: { vertLines: { color: GRID }, horzLines: { color: GRID } },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: 'rgba(148,163,184,0.5)', style: LineStyle.Dashed, labelBackgroundColor: '#334155' },
        horzLine: { color: 'rgba(148,163,184,0.5)', style: LineStyle.Dashed, labelBackgroundColor: '#334155' },
      },
      rightPriceScale: { borderColor: AXIS, scaleMargins: { top: 0.1, bottom: 0.2 } },
      timeScale: {
        borderColor: AXIS,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 6,
        tickMarkFormatter: localTick,
      },
      localization: { timeFormatter: localStamp },
      handleScale: { axisPressedMouseMove: true },
    });

    const candles = chart.addSeries(CandlestickSeries, {
      upColor: UP,
      downColor: DOWN,
      borderUpColor: UP,
      borderDownColor: DOWN,
      wickUpColor: UP,
      wickDownColor: DOWN,
      priceLineStyle: LineStyle.Dashed,
      autoscaleInfoProvider: withMinimumSpan,
    });

    const volume = chart.addSeries(HistogramSeries, {
      priceScaleId: 'volume',
      priceFormat: { type: 'volume' },
      lastValueVisible: false,
      priceLineVisible: false,
    });
    volume.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });

    const lineOpts = { lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false };
    const ma20 = chart.addSeries(LineSeries, { ...lineOpts, color: MA20 });
    const ma50 = chart.addSeries(LineSeries, { ...lineOpts, color: MA50 });
    const trendOpts = { ...lineOpts, color: TREND, lineWidth: 1, lineStyle: LineStyle.LargeDashed };
    const resistance = chart.addSeries(LineSeries, trendOpts);
    const support = chart.addSeries(LineSeries, trendOpts);

    let rsi = null;
    if (full) {
      rsi = chart.addSeries(
        LineSeries,
        { color: '#a78bfa', lineWidth: 1, priceLineVisible: false, lastValueVisible: true, priceFormat: { type: 'custom', formatter: (v) => v.toFixed(1), minMove: 0.1 } },
        1,
      );
      rsi.createPriceLine({ price: 70, color: 'rgba(229,35,59,0.6)', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: '' });
      rsi.createPriceLine({ price: 30, color: 'rgba(34,178,76,0.6)', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: '' });
      rsi.priceScale().applyOptions({ scaleMargins: { top: 0.12, bottom: 0.12 } });
      const panes = chart.panes();
      if (panes[1]) panes[1].setHeight(110);
    }

    chart.subscribeCrosshairMove((param) => {
      const c = param.seriesData && param.seriesData.get(candles);
      if (!param.time || !c) { setHover(null); return; }
      const v = param.seriesData.get(volume);
      setHover({ time: param.time, open: c.open, high: c.high, low: c.low, close: c.close, volume: v ? v.value : 0 });
    });

    chart.timeScale().subscribeVisibleLogicalRangeChange(() => placeRef.current());

    apiRef.current = { chart, candles, volume, ma20, ma50, rsi, resistance, support };
    return () => {
      apiRef.current = null;
      chart.remove();
    };
  }, [full]);

  // Push data in. Re-frame the view only when the timeframe changes or the first candles arrive, so the 20-second
  // refresh never yanks the chart away from wherever the visitor has scrolled to.
  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    const closePrice = bars.length ? bars[bars.length - 1].close : 100;
    const digits = precisionFor(closePrice);
    api.candles.applyOptions({ priceFormat: { type: 'price', precision: digits, minMove: Math.pow(10, -digits) } });

    api.candles.setData(bars.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));
    api.volume.setData(bars.map((b) => ({ time: b.time, value: b.volume, color: b.close >= b.open ? 'rgba(34,178,76,0.35)' : 'rgba(229,35,59,0.35)' })));
    api.ma20.setData(smaSeries(bars, 20));
    api.ma50.setData(smaSeries(bars, 50));
    if (api.rsi) api.rsi.setData(rsiSeries(bars, 14));

    const channel = trendChannel(bars, full ? 120 : 80);
    channelRef.current = channel;
    if (channel) {
      const firstTime = bars[channel.start].time;
      const lastTime = bars[channel.end].time;
      // One point per future bar: the time scale gives each distinct time exactly one bar of width, so a single
      // far-away point would be squeezed into one bar and kink the line.
      const line = (side) => [
        { time: firstTime, value: channelValue(channel, channel.start, side) },
        { time: lastTime, value: channelValue(channel, channel.end, side) },
        ...Array.from({ length: LINE_EXTEND_BARS }, (_, k) => ({
          time: lastTime + (k + 1) * tf.seconds,
          value: channelValue(channel, channel.end + k + 1, side),
        })),
      ];
      api.resistance.setData(line('upper'));
      api.support.setData(line('lower'));
    } else {
      api.resistance.setData([]);
      api.support.setData([]);
    }

    const key = `${tfId}:${bars.length ? 'data' : 'empty'}`;
    if (bars.length && viewKeyRef.current !== key) {
      viewKeyRef.current = key;
      api.chart.timeScale().setVisibleLogicalRange({ from: Math.max(-2, bars.length - framedBars()), to: bars.length + LINE_EXTEND_BARS + 4 });
    }
    requestAnimationFrame(() => placeRef.current());
  }, [bars, tfId, full, tf.seconds]);

  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    api.ma20.applyOptions({ visible: showMA });
    api.ma50.applyOptions({ visible: showMA });
    api.volume.applyOptions({ visible: showVolume });
    api.resistance.applyOptions({ visible: showTrend });
    api.support.applyOptions({ visible: showTrend });
    placeRef.current();
  }, [showMA, showVolume, showTrend]);

  // "Resistance" / "Support" captions sit on the left of each dashed line, following it as the chart is panned.
  placeRef.current = useCallback(() => {
    const api = apiRef.current;
    const channel = channelRef.current;
    if (!api || !channel || !showTrend) { setLabels((prevLabels) => (prevLabels ? null : prevLabels)); return; }
    const scale = api.chart.timeScale();
    const edge = scale.coordinateToLogical(8);
    if (edge == null) return;
    const logical = Math.max(edge, channel.start);
    const x = scale.logicalToCoordinate(logical);
    const place = (side) => {
      const y = api.candles.priceToCoordinate(channelValue(channel, logical, side));
      return y == null ? null : Math.round(y);
    };
    const next = { x: x == null ? 8 : Math.round(x) + 6, res: place('upper'), sup: place('lower') };
    setLabels((prevLabels) => (prevLabels && prevLabels.x === next.x && prevLabels.res === next.res && prevLabels.sup === next.sup ? prevLabels : next));
  }, [showTrend]);

  useEffect(() => { placeRef.current(); }, [now, bars.length]);

  // Candle countdown + LIVE heartbeat: only needs a once-a-second tick in the full version.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const shown = hover || last;
  const hoverIndex = hover ? bars.findIndex((b) => b.time === hover.time) : -1;
  const shownPrev = hover ? bars[hoverIndex - 1] : prev;
  const changeBase = shownPrev ? shownPrev.close : shown ? shown.open : null;
  const change = shown && changeBase ? ((shown.close - changeBase) / changeBase) * 100 : null;
  const digits = precisionFor(shown ? shown.close : 100);
  const secondsLeft = tf.seconds - (Math.floor(now / 1000) % tf.seconds);
  const up = shown ? shown.close >= shown.open : true;

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-[#020617] text-[#cbd5e1]" style={{ fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif' }}>
      <DiamondChartBackdrop />
      {full && (
        <div className="relative z-10 flex flex-nowrap items-center gap-x-3 overflow-x-auto whitespace-nowrap border-b border-[#334155]/50 bg-[#020617]/55 px-3 py-2 text-xs backdrop-blur-sm">
          <div className="flex shrink-0 items-center gap-0.5 rounded-md bg-[#0f172a] p-0.5" role="tablist" aria-label="Timeframe">
            {TIMEFRAMES.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={t.id === tfId}
                onClick={() => setTfId(t.id)}
                className={`rounded px-2.5 py-1 font-semibold transition-colors ${t.id === tfId ? 'bg-[#fcd34d] text-[#020617]' : 'text-[#94a3b8] hover:text-[#ffffff]'}`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button type="button" aria-pressed={showMA} onClick={() => setShowMA((v) => !v)} className={`rounded-md border px-2.5 py-1 font-semibold transition-colors ${showMA ? 'border-[#475569] bg-[#1e293b] text-[#ffffff]' : 'border-[#1e293b] text-[#64748b] hover:text-[#cbd5e1]'}`}>
              <span style={{ color: MA20 }}>MA20</span> <span style={{ color: MA50 }}>MA50</span>
            </button>
            <button type="button" aria-pressed={showVolume} onClick={() => setShowVolume((v) => !v)} className={`rounded-md border px-2.5 py-1 font-semibold transition-colors ${showVolume ? 'border-[#475569] bg-[#1e293b] text-[#ffffff]' : 'border-[#1e293b] text-[#64748b] hover:text-[#cbd5e1]'}`}>
              Volume
            </button>
            <button type="button" aria-pressed={showTrend} onClick={() => setShowTrend((v) => !v)} className={`rounded-md border px-2.5 py-1 font-semibold transition-colors ${showTrend ? 'border-[#475569] bg-[#1e293b] text-[#ffffff]' : 'border-[#1e293b] text-[#64748b] hover:text-[#cbd5e1]'}`}>
              Trend lines
            </button>
          </div>
          <button
            type="button"
            onClick={() => apiRef.current && apiRef.current.chart.timeScale().setVisibleLogicalRange({ from: Math.max(-2, bars.length - framedBars()), to: bars.length + LINE_EXTEND_BARS + 4 })}
            className="shrink-0 rounded-md border border-[#1e293b] px-2.5 py-1 font-semibold text-[#94a3b8] hover:text-[#ffffff]"
          >
            Reset view
          </button>
          <div className="ml-auto flex shrink-0 items-center gap-2 pl-2 text-[11px] text-[#94a3b8]">
            <span className="relative flex h-2 w-2" aria-hidden="true">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#34d399] opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[#34d399]" />
            </span>
            <span className="font-semibold uppercase tracking-wide text-[#6ee7b7]">Live</span>
            <span className="tabular-nums">candle closes in {countdown(secondsLeft)}</span>
          </div>
        </div>
      )}

      <div className="relative min-h-0 flex-1">
        <div ref={containerRef} className="absolute inset-0 z-[1]" />

        {labels && showTrend && (
          <>
            {labels.res != null && (
              <span className="pointer-events-none absolute z-[2] -translate-y-full pb-1 text-[11px] font-semibold tracking-wide text-[#e2e8f0] [text-shadow:0_1px_3px_#020617]" style={{ left: labels.x, top: labels.res }}>
                Resistance
              </span>
            )}
            {labels.sup != null && (
              <span className="pointer-events-none absolute z-[2] pt-1 text-[11px] font-semibold tracking-wide text-[#e2e8f0] [text-shadow:0_1px_3px_#020617]" style={{ left: labels.x, top: labels.sup }}>
                Support
              </span>
            )}
          </>
        )}

        {shown && (
          <div className="pointer-events-none absolute left-2 top-1.5 z-[3] max-w-[calc(100%-5rem)] text-[11px] leading-5 tabular-nums">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0">
              <span className="font-bold text-[#f1f5f9]">ICAN / UGX</span>
              <span className="text-[#64748b]">{tf.label}</span>
              <span>O <b className={up ? 'text-[#4ade80]' : 'text-[#f87171]'}>{fmtPrice(shown.open, digits)}</b></span>
              <span>H <b className={up ? 'text-[#4ade80]' : 'text-[#f87171]'}>{fmtPrice(shown.high, digits)}</b></span>
              <span>L <b className={up ? 'text-[#4ade80]' : 'text-[#f87171]'}>{fmtPrice(shown.low, digits)}</b></span>
              <span>C <b className={up ? 'text-[#4ade80]' : 'text-[#f87171]'}>{fmtPrice(shown.close, digits)}</b></span>
              {change != null && <b className={change >= 0 ? 'text-[#4ade80]' : 'text-[#f87171]'}>{change >= 0 ? '+' : ''}{change.toFixed(2)}%</b>}
            </div>
            {full && showMA && (
              <div className="flex gap-3 text-[#64748b]">
                <span style={{ color: MA20 }}>MA 20</span>
                <span style={{ color: MA50 }}>MA 50</span>
                <span className="text-[#a78bfa]">RSI 14 ↓</span>
              </div>
            )}
          </div>
        )}

        {(loading || bars.length === 0) && (
          <div className="absolute inset-0 z-[4] flex flex-col items-center justify-center gap-2 bg-[#020617]/70 text-center">
            {loading ? (
              <>
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#334155] border-t-amber-300" />
                <p className="text-sm text-[#94a3b8]">Connecting to the market feed…</p>
              </>
            ) : (
              <>
                <p className="text-sm font-semibold text-[#cbd5e1]">No trading activity yet</p>
                <p className="max-w-xs text-xs text-[#64748b]">Candles appear as soon as icaneracoin moves — nothing here is simulated.</p>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default IcanTradingChart;
