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
// the IcanEra blockchain-diamond backdrop (slim green/red candles, like a broker's chart). Read-only: it draws
// the public candle feed and never places an order. `variant="compact"` is the landing-page version.
// `theme` is "dark" or "light". Colours are plain hex / inline styles on purpose: the app's ThemeContext repaints
// stock Tailwind colour classes, which would wash the legend out on the landing page.

const LINE_EXTEND_BARS = 8; // the channel runs on past the last candle, like a hand-drawn trend line

const PALETTES = {
  dark: {
    text: '#94a3b8', grid: 'rgba(148,163,184,0.06)', axis: 'rgba(71,85,105,0.55)',
    crossLine: 'rgba(148,163,184,0.5)', crossLabel: '#334155',
    up: '#22b24c', down: '#e5233b', upVol: 'rgba(34,178,76,0.35)', downVol: 'rgba(229,35,59,0.35)',
    ma20: '#fbbf24', ma50: '#38bdf8', rsi: '#a78bfa', trend: 'rgba(226,232,240,0.85)',
    base: '#020617', fg: '#cbd5e1', strong: '#f1f5f9', muted: '#64748b', soft: '#94a3b8',
    pos: '#4ade80', neg: '#f87171', live: '#34d399', liveText: '#6ee7b7',
    barBg: 'rgba(2,6,23,0.55)', barBorder: 'rgba(51,65,85,0.5)', tabsBg: '#0f172a', tabOnBg: '#fcd34d', tabOnText: '#020617',
    chipOnBg: '#1e293b', chipOnBorder: '#475569', chipOnText: '#ffffff', chipOffBorder: '#1e293b', chipOffText: '#64748b',
    caption: '#e2e8f0', captionShadow: '0 1px 3px #020617', veil: 'rgba(2,6,23,0.7)', spinTrack: '#334155', spinHead: '#fcd34d',
  },
  light: {
    text: '#475569', grid: 'rgba(15,23,42,0.07)', axis: 'rgba(100,116,139,0.35)',
    crossLine: 'rgba(71,85,105,0.55)', crossLabel: '#475569',
    up: '#16a34a', down: '#dc2626', upVol: 'rgba(22,163,74,0.28)', downVol: 'rgba(220,38,38,0.28)',
    ma20: '#d97706', ma50: '#0284c7', rsi: '#7c3aed', trend: 'rgba(51,65,85,0.85)',
    base: '#f8fafc', fg: '#334155', strong: '#0f172a', muted: '#64748b', soft: '#475569',
    pos: '#15803d', neg: '#b91c1c', live: '#10b981', liveText: '#047857',
    barBg: 'rgba(255,255,255,0.7)', barBorder: 'rgba(148,163,184,0.45)', tabsBg: '#e2e8f0', tabOnBg: '#0f172a', tabOnText: '#ffffff',
    chipOnBg: '#e2e8f0', chipOnBorder: '#94a3b8', chipOnText: '#0f172a', chipOffBorder: '#cbd5e1', chipOffText: '#64748b',
    caption: '#1e293b', captionShadow: '0 1px 2px #ffffff', veil: 'rgba(248,250,252,0.75)', spinTrack: '#cbd5e1', spinHead: '#0f172a',
  },
};

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

// Everything on the canvas that depends on the theme, applied at creation and again whenever the theme flips.
const applyPalette = (api, c) => {
  api.chart.applyOptions({
    layout: { textColor: c.text, panes: { separatorColor: c.axis, separatorHoverColor: c.crossLabel } },
    grid: { vertLines: { color: c.grid }, horzLines: { color: c.grid } },
    crosshair: {
      vertLine: { color: c.crossLine, labelBackgroundColor: c.crossLabel },
      horzLine: { color: c.crossLine, labelBackgroundColor: c.crossLabel },
    },
    rightPriceScale: { borderColor: c.axis },
    timeScale: { borderColor: c.axis },
  });
  api.candles.applyOptions({
    upColor: c.up, downColor: c.down, borderUpColor: c.up, borderDownColor: c.down, wickUpColor: c.up, wickDownColor: c.down,
  });
  api.ma20.applyOptions({ color: c.ma20 });
  api.ma50.applyOptions({ color: c.ma50 });
  api.resistance.applyOptions({ color: c.trend });
  api.support.applyOptions({ color: c.trend });
  if (api.rsi) api.rsi.applyOptions({ color: c.rsi });
};

const IcanTradingChart = ({ rows, loading = false, variant = 'full', theme = 'dark' }) => {
  const full = variant === 'full';
  const c = PALETTES[theme] || PALETTES.dark;
  const paletteRef = useRef(c);
  paletteRef.current = c;

  const containerRef = useRef(null);
  const apiRef = useRef(null); // { chart, candles, volume, ma20, ma50, rsi, resistance, support }
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

  // How many candles to frame: fewer on a phone so the bodies stay readable.
  const framedBars = () => {
    const narrow = (containerRef.current?.clientWidth || 1000) < 520;
    return full ? (narrow ? 60 : 120) : (narrow ? 45 : 80);
  };

  const tf = TIMEFRAMES.find((t) => t.id === tfId) || TIMEFRAMES[0];
  const base = useMemo(() => toSeries(rows), [rows]);
  const bars = useMemo(() => aggregateSeries(base, tf.seconds), [base, tf.seconds]);
  const last = bars.length ? bars[bars.length - 1] : null;
  const prev = bars.length > 1 ? bars[bars.length - 2] : null;

  // One chart for the life of the component.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;
    const p = paletteRef.current;

    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: p.text,
        fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
        fontSize: 11,
        panes: { separatorColor: p.axis, separatorHoverColor: p.crossLabel, enableResize: true },
      },
      grid: { vertLines: { color: p.grid }, horzLines: { color: p.grid } },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: p.crossLine, style: LineStyle.Dashed, labelBackgroundColor: p.crossLabel },
        horzLine: { color: p.crossLine, style: LineStyle.Dashed, labelBackgroundColor: p.crossLabel },
      },
      rightPriceScale: { borderColor: p.axis, scaleMargins: { top: 0.1, bottom: 0.2 } },
      timeScale: {
        borderColor: p.axis,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 6,
        tickMarkFormatter: localTick,
      },
      localization: { timeFormatter: localStamp },
      handleScale: { axisPressedMouseMove: true },
    });

    const candles = chart.addSeries(CandlestickSeries, {
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
    const ma20 = chart.addSeries(LineSeries, lineOpts);
    const ma50 = chart.addSeries(LineSeries, lineOpts);
    const trendOpts = { ...lineOpts, lineStyle: LineStyle.LargeDashed };
    const resistance = chart.addSeries(LineSeries, trendOpts);
    const support = chart.addSeries(LineSeries, trendOpts);

    let rsi = null;
    if (full) {
      rsi = chart.addSeries(
        LineSeries,
        { lineWidth: 1, priceLineVisible: false, lastValueVisible: true, priceFormat: { type: 'custom', formatter: (v) => v.toFixed(1), minMove: 0.1 } },
        1,
      );
      rsi.createPriceLine({ price: 70, color: 'rgba(229,35,59,0.6)', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: '' });
      rsi.createPriceLine({ price: 30, color: 'rgba(34,178,76,0.6)', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: '' });
      rsi.priceScale().applyOptions({ scaleMargins: { top: 0.12, bottom: 0.12 } });
      const panes = chart.panes();
      if (panes[1]) panes[1].setHeight(Math.max(110, Math.round(el.clientHeight * 0.2)));
    }

    chart.subscribeCrosshairMove((param) => {
      const candle = param.seriesData && param.seriesData.get(candles);
      if (!param.time || !candle) { setHover(null); return; }
      const v = param.seriesData.get(volume);
      setHover({ time: param.time, open: candle.open, high: candle.high, low: candle.low, close: candle.close, volume: v ? v.value : 0 });
    });

    chart.timeScale().subscribeVisibleLogicalRangeChange(() => placeRef.current());

    apiRef.current = { chart, candles, volume, ma20, ma50, rsi, resistance, support };
    applyPalette(apiRef.current, p);
    return () => {
      apiRef.current = null;
      chart.remove();
    };
  }, [full]);

  useEffect(() => {
    if (apiRef.current) applyPalette(apiRef.current, c);
  }, [c]);

  // Push data in. Re-frame the view only when the timeframe changes or the first candles arrive, so the 20-second
  // refresh never yanks the chart away from wherever the visitor has scrolled to.
  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    const closePrice = bars.length ? bars[bars.length - 1].close : 100;
    const digits = precisionFor(closePrice);
    api.candles.applyOptions({ priceFormat: { type: 'price', precision: digits, minMove: Math.pow(10, -digits) } });

    api.candles.setData(bars.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));
    api.volume.setData(bars.map((b) => ({ time: b.time, value: b.volume, color: b.close >= b.open ? c.upVol : c.downVol })));
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bars, tfId, full, tf.seconds, c]);

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

  // Candle countdown + LIVE heartbeat: a once-a-second tick.
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
  const tone = (isUp) => ({ color: isUp ? c.pos : c.neg });

  const chip = (on) => ({
    borderColor: on ? c.chipOnBorder : c.chipOffBorder,
    background: on ? c.chipOnBg : 'transparent',
    color: on ? c.chipOnText : c.chipOffText,
  });

  return (
    <div
      className="relative flex h-full w-full flex-col overflow-hidden"
      style={{ background: c.base, color: c.fg, fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif' }}
    >
      <DiamondChartBackdrop theme={theme} />
      {full && (
        <div
          className="relative z-10 flex flex-nowrap items-center gap-x-3 overflow-x-auto whitespace-nowrap border-b px-3 py-2 text-xs backdrop-blur-sm"
          style={{ background: c.barBg, borderColor: c.barBorder }}
        >
          <div className="flex shrink-0 items-center gap-0.5 rounded-md p-0.5" style={{ background: c.tabsBg }} role="tablist" aria-label="Timeframe">
            {TIMEFRAMES.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={t.id === tfId}
                onClick={() => setTfId(t.id)}
                className="rounded px-2.5 py-1 font-semibold transition-colors"
                style={t.id === tfId ? { background: c.tabOnBg, color: c.tabOnText } : { color: c.soft }}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button type="button" aria-pressed={showMA} onClick={() => setShowMA((v) => !v)} className="rounded-md border px-2.5 py-1 font-semibold transition-colors" style={chip(showMA)}>
              <span style={{ color: c.ma20 }}>MA20</span> <span style={{ color: c.ma50 }}>MA50</span>
            </button>
            <button type="button" aria-pressed={showVolume} onClick={() => setShowVolume((v) => !v)} className="rounded-md border px-2.5 py-1 font-semibold transition-colors" style={chip(showVolume)}>
              Volume
            </button>
            <button type="button" aria-pressed={showTrend} onClick={() => setShowTrend((v) => !v)} className="rounded-md border px-2.5 py-1 font-semibold transition-colors" style={chip(showTrend)}>
              Trend lines
            </button>
          </div>
          <button
            type="button"
            onClick={() => apiRef.current && apiRef.current.chart.timeScale().setVisibleLogicalRange({ from: Math.max(-2, bars.length - framedBars()), to: bars.length + LINE_EXTEND_BARS + 4 })}
            className="shrink-0 rounded-md border px-2.5 py-1 font-semibold"
            style={{ borderColor: c.chipOffBorder, color: c.soft }}
          >
            Reset view
          </button>
          <div className="ml-auto flex shrink-0 items-center gap-2 pl-2 text-[11px]" style={{ color: c.soft }}>
            <span className="relative flex h-2 w-2" aria-hidden="true">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ background: c.live }} />
              <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: c.live }} />
            </span>
            <span className="font-semibold uppercase tracking-wide" style={{ color: c.liveText }}>Live</span>
            <span className="tabular-nums">candle closes in {countdown(secondsLeft)}</span>
          </div>
        </div>
      )}

      <div className="relative min-h-0 flex-1">
        <div ref={containerRef} className="absolute inset-0 z-[1]" />

        {labels && showTrend && (
          <>
            {labels.res != null && (
              <span className="pointer-events-none absolute z-[2] -translate-y-full pb-1 text-[11px] font-semibold tracking-wide" style={{ left: labels.x, top: labels.res, color: c.caption, textShadow: c.captionShadow }}>
                Resistance
              </span>
            )}
            {labels.sup != null && (
              <span className="pointer-events-none absolute z-[2] pt-1 text-[11px] font-semibold tracking-wide" style={{ left: labels.x, top: labels.sup, color: c.caption, textShadow: c.captionShadow }}>
                Support
              </span>
            )}
          </>
        )}

        {shown && (
          <div className="pointer-events-none absolute left-2 top-1.5 z-[3] max-w-[calc(100%-5rem)] text-[11px] leading-5 tabular-nums">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0">
              <span className="font-bold" style={{ color: c.strong }}>ICAN / UGX</span>
              <span style={{ color: c.muted }}>{tf.label}</span>
              <span>O <b style={tone(up)}>{fmtPrice(shown.open, digits)}</b></span>
              <span>H <b style={tone(up)}>{fmtPrice(shown.high, digits)}</b></span>
              <span>L <b style={tone(up)}>{fmtPrice(shown.low, digits)}</b></span>
              <span>C <b style={tone(up)}>{fmtPrice(shown.close, digits)}</b></span>
              {change != null && <b style={tone(change >= 0)}>{change >= 0 ? '+' : ''}{change.toFixed(2)}%</b>}
            </div>
            {full && showMA && (
              <div className="flex gap-3" style={{ color: c.muted }}>
                <span style={{ color: c.ma20 }}>MA 20</span>
                <span style={{ color: c.ma50 }}>MA 50</span>
                <span style={{ color: c.rsi }}>RSI 14 ↓</span>
              </div>
            )}
          </div>
        )}

        {(loading || bars.length === 0) && (
          <div className="absolute inset-0 z-[4] flex flex-col items-center justify-center gap-2 text-center" style={{ background: c.veil }}>
            {loading ? (
              <>
                <div className="h-8 w-8 animate-spin rounded-full border-2" style={{ borderColor: c.spinTrack, borderTopColor: c.spinHead }} />
                <p className="text-sm" style={{ color: c.soft }}>Connecting to the market feed…</p>
              </>
            ) : (
              <>
                <p className="text-sm font-semibold" style={{ color: c.fg }}>No trading activity yet</p>
                <p className="max-w-xs text-xs" style={{ color: c.muted }}>Candles appear as soon as icaneracoin moves — nothing here is simulated.</p>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default IcanTradingChart;
