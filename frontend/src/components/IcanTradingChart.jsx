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
import { TIMEFRAMES, toSeries, fillGaps, aggregateSeries, smaSeries, rsiSeries, trendChannel, channelValue } from '../utils/candleSeries';
import DiamondChartBackdrop from './DiamondChartBackdrop';
import { CHART_PALETTES as PALETTES } from './chartPalettes';
import { LineStyleEditor } from './chartLineStyles';
import { sanitizeLineStyles } from '../utils/lineStyles';

// The icaneracoin trading chart: true OHLC candlesticks (body + wicks) on a TradingView-style canvas, with a
// crosshair and OHLC read-out, volume histogram, 20/50 moving-average overlays, an RSI pane, timeframe
// roll-ups (5m to 1D), a live candle countdown and a dashed Resistance / Support trend channel, all drawn over
// the IcanEra blockchain-diamond backdrop (slim green/red candles, like a broker's chart). Read-only: it draws
// the public candle feed and never places an order. `variant="compact"` is the landing-page version.
// `theme` is "dark" or "light". Colours are plain hex / inline styles on purpose: the app's ThemeContext repaints
// stock Tailwind colour classes, which would wash the legend out on the landing page.

const DASH = { solid: LineStyle.Solid, dashed: LineStyle.Dashed, dotted: LineStyle.Dotted, long: LineStyle.LargeDashed };
const LINE_HIT_PX = 12; // how close a tap must be to a trading line to select it
const LINE_EXTEND_BARS = 8; // the channel runs on past the last candle, like a hand-drawn trend line

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
// `extras` are the visitor's own lines as { price, reach }: a line is kept in view when it is within `reach` (a
// fraction of the price) of the market -- a booking or draft order you just placed always is; an old buy or sell
// price only when it is close. A line far away (an old buy 9% below) must not stretch the scale until the candles
// flatten into a hairline; it stays reachable by scrolling the price axis.
const withMinimumSpan = (original, extras = []) => {
  const res = original();
  if (!res || !res.priceRange) return res;
  let { minValue, maxValue } = res.priceRange;
  const mid = (minValue + maxValue) / 2;
  for (const { price, reach } of extras) {
    if (Number.isFinite(price) && Math.abs(price - mid) <= Math.abs(mid) * reach) {
      minValue = Math.min(minValue, price);
      maxValue = Math.max(maxValue, price);
    }
  }
  const centre = (minValue + maxValue) / 2;
  const minSpan = Math.abs(centre) * 0.004;
  if (maxValue - minValue >= minSpan) return { ...res, priceRange: { minValue, maxValue } };
  return { ...res, priceRange: { minValue: centre - minSpan / 2, maxValue: centre + minSpan / 2 } };
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

const NO_LINES = [];

// True on a phone-width screen: the legend condenses there so it never covers the first candles.
const useNarrow = () => {
  const query = '(max-width: 639px)';
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(query).matches);
  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const mq = window.matchMedia(query);
    const onChange = () => setNarrow(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return narrow;
};
const IcanTradingChart = ({
  rows, loading = false, variant = 'full', theme = 'dark',
  // Trading overlay (full variant): the visitor's own lines and how to react to taps on the chart.
  orders = NO_LINES, buyMarkers = NO_LINES, sellMarkers = NO_LINES, draftPrice = null, lineStyles = null,
  onLineStyleChange, onLineStylesReset, placement = false, onPickPrice, onLineSelect,
  // On a page that scrolls (the dashboard) the wheel should scroll the page, not zoom the chart under the mouse.
  wheelZoom = true,
  // Shows a "tap to book" switch in the toolbar (the wallet's chart). A page that drives placement itself passes `placement`.
  allowPlacement = false,
}) => {
  const looks = useMemo(() => sanitizeLineStyles(lineStyles), [lineStyles]);
  const narrow = useNarrow();
  const full = variant === 'full';
  const c = PALETTES[theme] || PALETTES.dark;
  const paletteRef = useRef(c);
  paletteRef.current = c;

  const containerRef = useRef(null);
  const apiRef = useRef(null); // { chart, candles, volume, ma20, ma50, rsi, resistance, support }
  const viewKeyRef = useRef('');
  const channelRef = useRef(null);
  const placeRef = useRef(() => {});
  const extraRef = useRef([]); // prices of the visitor's lines, kept in view by autoscale
  const hitRef = useRef([]); // { kind, price, order? } for every trading line currently drawn
  const tapRef = useRef({});
  const [toolsOpen, setToolsOpen] = useState(false);
  const [placeInternal, setPlaceInternal] = useState(false);
  const placing = placement || placeInternal;
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
    return full ? (narrow ? 48 : 120) : (narrow ? 40 : 80);
  };

  const tf = TIMEFRAMES.find((t) => t.id === tfId) || TIMEFRAMES[0];
  // A steady 5-minute grid: quiet windows (the feed only stores candles where the price ticked) become flat candles.
  const base = useMemo(() => fillGaps(toSeries(rows)), [rows]);
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
      handleScale: { axisPressedMouseMove: true, mouseWheel: wheelZoom },
      // A vertical swipe on a phone scrolls the PAGE instead of being swallowed by the chart (the chart still
      // pans sideways and pinch-zooms), so the content below the chart stays reachable.
      handleScroll: { vertTouchDrag: false, mouseWheel: wheelZoom },
    });

    const candles = chart.addSeries(CandlestickSeries, {
      priceLineStyle: LineStyle.Dashed,
      autoscaleInfoProvider: (original) => withMinimumSpan(original, extraRef.current),
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

    // A tap either selects the trading line nearest to it, or -- in "place order" mode -- picks a price.
    chart.subscribeClick((param) => {
      if (!param.point || (param.paneIndex || 0) > 0) return;
      const y = param.point.y;
      let hit = null;
      let best = LINE_HIT_PX;
      for (const line of hitRef.current) {
        const ly = candles.priceToCoordinate(line.price);
        if (ly == null) continue;
        const dist = Math.abs(ly - y);
        if (dist <= best) { best = dist; hit = line; }
      }
      if (hit) { tapRef.current.endPlacement?.(); tapRef.current.onLineSelect?.(hit); return; }
      if (!tapRef.current.placing) return;
      const price = candles.coordinateToPrice(y);
      if (price != null && Number.isFinite(price)) {
        tapRef.current.endPlacement?.();
        tapRef.current.onPickPrice?.(Math.round(price * 100) / 100);
      }
    });

    apiRef.current = { chart, candles, volume, ma20, ma50, rsi, resistance, support };
    applyPalette(apiRef.current, p);
    return () => {
      apiRef.current = null;
      chart.remove();
    };
  }, [full, wheelZoom]);

  useEffect(() => {
    if (apiRef.current) applyPalette(apiRef.current, c);
  }, [c]);

  tapRef.current = { onPickPrice, onLineSelect, placing, endPlacement: () => setPlaceInternal(false) };

  // The visitor's own trading lines: prices they bought and sold at, their booked orders, and the order they are
  // drafting. Redrawn whenever any of those, or the chosen look, changes.
  useEffect(() => {
    const api = apiRef.current;
    if (!api || !full) return undefined;
    const drawn = [];
    const hits = [];
    const add = (kind, price, title, extra = {}) => {
      if (!Number.isFinite(price)) return;
      const look = looks[kind === 'draft' ? 'booking' : kind];
      drawn.push(api.candles.createPriceLine({
        price,
        color: kind === 'draft' ? c.strong : look.color,
        lineWidth: kind === 'draft' ? 2 : look.width,
        lineStyle: kind === 'draft' ? LineStyle.Dashed : DASH[look.style],
        axisLabelVisible: true,
        title,
      }));
      // `type` mirrors `kind`: the wallet's chart handlers were written against that name.
      if (kind !== 'draft') hits.push({ kind, type: kind, price, ...extra });
    };
    buyMarkers.forEach((m) => add('buy', m.price, 'Buy'));
    sellMarkers.forEach((m) => add('sell', m.price, 'Sell'));
    orders.forEach((o) => {
      const amount = Number(o.ican_amount);
      add('booking', parseFloat(o.target_price_ugx), `${o.order_type === 'buy' ? 'Buy' : 'Sell'} ${Number.isFinite(amount) ? amount : ''}`.trim(), { order: o });
    });
    if (draftPrice != null) add('draft', Number(draftPrice), 'New order');
    // The live price line is tappable too (the wallet uses it for "trade now at the live price").
    if (last) hits.push({ kind: 'live', type: 'live', price: last.close });
    hitRef.current = hits;
    extraRef.current = [
      ...orders.map((o) => ({ price: parseFloat(o.target_price_ugx), reach: 0.1 })),
      { price: draftPrice == null ? NaN : Number(draftPrice), reach: 0.1 },
      ...buyMarkers.map((m) => ({ price: m.price, reach: 0.03 })),
      ...sellMarkers.map((m) => ({ price: m.price, reach: 0.03 })),
    ];
    return () => {
      hitRef.current = [];
      extraRef.current = [];
      drawn.forEach((line) => { try { api.candles.removePriceLine(line); } catch { /* the chart was already torn down */ } });
    };
  }, [orders, buyMarkers, sellMarkers, draftPrice, looks, c, full, last?.close]); // eslint-disable-line react-hooks/exhaustive-deps

  // The live price line's look (colour, dashes, thickness).
  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    api.candles.applyOptions({ priceLineColor: looks.live.color, priceLineStyle: DASH[looks.live.style], priceLineWidth: looks.live.width });
  }, [looks.live, c]);

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

  const resetView = () => {
    if (apiRef.current) apiRef.current.chart.timeScale().setVisibleLogicalRange({ from: Math.max(-2, bars.length - framedBars()), to: bars.length + LINE_EXTEND_BARS + 4 });
    setToolsOpen(false);
  };

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
          className="relative z-10 flex flex-nowrap items-center gap-x-2 whitespace-nowrap border-b px-2 py-2 text-xs backdrop-blur-sm sm:gap-x-3 sm:px-3"
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
          <div className="hidden shrink-0 items-center gap-1.5 sm:flex">
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
          {allowPlacement && (
            <button
              type="button"
              aria-pressed={placeInternal}
              onClick={() => setPlaceInternal((v) => !v)}
              className="shrink-0 rounded-md border px-2.5 py-1 font-semibold"
              style={placeInternal ? { background: c.tabOnBg, color: c.tabOnText, borderColor: c.tabOnBg } : chip(false)}
              title="Tap the chart to book an order at that price"
            >
              🎯 <span className="hidden min-[430px]:inline">{placeInternal ? 'Tap the chart…' : 'Tap to book'}</span><span className="min-[430px]:hidden">Book</span>
            </button>
          )}
          <button
            type="button"
            onClick={resetView}
            className="hidden shrink-0 rounded-md border px-2.5 py-1 font-semibold sm:block"
            style={{ borderColor: c.chipOffBorder, color: c.soft }}
          >
            Reset view
          </button>
          <button
            type="button"
            aria-expanded={toolsOpen}
            aria-haspopup="dialog"
            onClick={() => setToolsOpen((v) => !v)}
            className="shrink-0 rounded-md border px-2.5 py-1 font-semibold"
            style={chip(toolsOpen)}
          >
            ⚙ Tools
          </button>
          <div className="ml-auto flex shrink-0 items-center gap-1.5 pl-1 text-[11px] sm:gap-2 sm:pl-2" style={{ color: c.soft }}>
            <span className="relative flex h-2 w-2" aria-hidden="true">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ background: c.live }} />
              <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: c.live }} />
            </span>
            <span className="hidden font-semibold uppercase tracking-wide sm:inline" style={{ color: c.liveText }}>Live</span>
            <span className="hidden tabular-nums min-[400px]:inline"><span className="hidden sm:inline">candle closes in </span>{countdown(secondsLeft)}</span>
          </div>
        </div>
      )}

      <div className="relative min-h-0 flex-1">
        <div ref={containerRef} className="absolute inset-0 z-[1]" style={placing ? { cursor: 'crosshair' } : undefined} />

        {placing && (
          <div className="pointer-events-none absolute left-1/2 top-2 z-[5] -translate-x-1/2 rounded-full px-3 py-1 text-[11px] font-semibold shadow" style={{ background: c.tabOnBg, color: c.tabOnText }}>
            Tap the chart to set your price
          </div>
        )}

        {labels && showTrend && (
          <>
            {labels.res != null && (
              // Above its line, unless the line is up under the legend, where it would print over it: then just below.
              <span className={`pointer-events-none absolute z-[2] text-[11px] font-semibold tracking-wide ${labels.res < 60 ? 'pt-1' : '-translate-y-full pb-1'}`} style={{ left: labels.x, top: labels.res < 60 ? Math.max(labels.res, narrow ? 28 : 52) : labels.res, color: c.caption, textShadow: c.captionShadow }}>
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
            {narrow && !hover ? (
              // Phone: just the symbol and the close, so the first candles stay clear. Touch a candle for the full OHLC.
              <div className="flex flex-wrap items-center gap-x-2">
                <span className="font-bold" style={{ color: c.strong }}>ICAN / UGX</span>
                <span style={{ color: c.muted }}>{tf.label}</span>
                <b style={tone(up)}>{fmtPrice(shown.close, digits)}</b>
                {change != null && <b style={tone(change >= 0)}>{change >= 0 ? '+' : ''}{change.toFixed(2)}%</b>}
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0">
                <span className="font-bold" style={{ color: c.strong }}>ICAN / UGX</span>
                <span style={{ color: c.muted }}>{tf.label}</span>
                <span>O <b style={tone(up)}>{fmtPrice(shown.open, digits)}</b></span>
                <span>H <b style={tone(up)}>{fmtPrice(shown.high, digits)}</b></span>
                <span>L <b style={tone(up)}>{fmtPrice(shown.low, digits)}</b></span>
                <span>C <b style={tone(up)}>{fmtPrice(shown.close, digits)}</b></span>
                {change != null && <b style={tone(change >= 0)}>{change >= 0 ? '+' : ''}{change.toFixed(2)}%</b>}
              </div>
            )}
            {full && showMA && !narrow && (
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
      {full && toolsOpen && (
        <>
          <div className="absolute inset-0 z-[19]" onClick={() => setToolsOpen(false)} aria-hidden="true" />
          <div
            role="dialog"
            aria-label="Chart tools"
            className="absolute right-2 top-[46px] z-20 max-h-[calc(100%-56px)] w-[min(23rem,calc(100%-1rem))] overflow-y-auto rounded-xl border p-3 shadow-xl"
            style={{ background: c.card, borderColor: c.cardBorder, color: c.fg }}
          >
            <div className="mb-3 flex flex-wrap gap-1.5 sm:hidden">
              <button type="button" aria-pressed={showMA} onClick={() => setShowMA((v) => !v)} className="rounded-md border px-2.5 py-1.5 text-xs font-semibold" style={chip(showMA)}>
                <span style={{ color: c.ma20 }}>MA20</span> <span style={{ color: c.ma50 }}>MA50</span>
              </button>
              <button type="button" aria-pressed={showVolume} onClick={() => setShowVolume((v) => !v)} className="rounded-md border px-2.5 py-1.5 text-xs font-semibold" style={chip(showVolume)}>Volume</button>
              <button type="button" aria-pressed={showTrend} onClick={() => setShowTrend((v) => !v)} className="rounded-md border px-2.5 py-1.5 text-xs font-semibold" style={chip(showTrend)}>Trend lines</button>
              <button type="button" onClick={resetView} className="rounded-md border px-2.5 py-1.5 text-xs font-semibold" style={{ borderColor: c.chipOffBorder, color: c.soft }}>Reset view</button>
            </div>
            {onLineStyleChange && (
              <>
                <p className="mb-2 text-xs font-bold uppercase tracking-wide" style={{ color: c.muted }}>Trading lines</p>
                <LineStyleEditor lineStyles={looks} onChange={onLineStyleChange} onReset={onLineStylesReset} c={c} />
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default IcanTradingChart;
