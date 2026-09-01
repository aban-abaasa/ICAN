import React, { useEffect, useState, useMemo, useCallback, useRef } from "react";
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ComposedChart,
  ReferenceLine,
  Bar,
  ResponsiveContainer,
} from "recharts";

const BUY_COLOR = "#34d399";     // emerald-400 — executed buys
const SELL_COLOR = "#fb7185";    // rose-400 — executed sells
const BOOKING_COLOR = "#f59e0b"; // amber-500 — open/pending booked orders
const LIVE_COLOR = "#38bdf8";    // sky-400 — current live price (where an instant buy/sell executes)

const CandlestickChart = React.memo(({
  candleData = [],
  priceUSD = 0.00036,
  loading = false,
  settings = {},
  buyMarkers = [],
  sellMarkers = [],
  bookingOrders = [],
  orderPlacementEnabled = false,
  onPlaceOrderClick,
  showLivePrice = true,
  onLineSelect,
}) => {
  const [displayData, setDisplayData] = useState([]);
  const [analysis, setAnalysis] = useState(null);
  const [prevDataLength, setPrevDataLength] = useState(0);
  const [zoomLevel, setZoomLevel] = useState(1); // higher = more zoomed in (fewer, bigger candles)
  const [panOffset, setPanOffset] = useState(0); // candles back from the live edge
  const [containerWidth, setContainerWidth] = useState(0);
  const [placementMode, setPlacementMode] = useState(false); // "tap chart to book" toggle
  const [hover, setHover] = useState(null); // { y, price } while hovering in placement mode
  const [hoverLine, setHoverLine] = useState(null); // the Live/Buy/Sell/Booking line nearest the cursor, if any
  const chartContainerRef = useRef(null);
  const plotRef = useRef(null); // wraps just the SVG canvas, no padding — used for click/hover → price math
  const gestureRef = useRef({
    dragging: false,
    startX: 0,
    startY: 0,
    startPanOffset: 0,
    pinching: false,
    startDistance: 0,
    startZoom: 1,
  });
  const displayDataLengthRef = useRef(0);
  const visibleCandleCountRef = useRef(50);
  const panOffsetRef = useRef(0);

  const defaultSettings = {
    upColor: "#10b981",
    downColor: "#ef4444",
    wickColor: "#808080",
    showVolume: true,
    selectedTimeframe: "7s",
  };

  const chartSettings = useMemo(() => ({ ...defaultSettings, ...settings }), [settings]);

  const calculateIndicators = useCallback((data) => {
    if (!data || data.length < 2) return null;

    const closes = data.map((d) => parseFloat(d.close));
    const highs = data.map((d) => parseFloat(d.high));
    const lows = data.map((d) => parseFloat(d.low));

    const rsiPeriod = Math.min(14, data.length - 1);
    let gains = 0, losses = 0;
    for (let i = 1; i <= rsiPeriod; i++) {
      const change = closes[closes.length - i] - closes[closes.length - i - 1];
      if (change > 0) gains += change;
      else losses += Math.abs(change);
    }

    const avgGain = gains / rsiPeriod;
    const avgLoss = losses / rsiPeriod;
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    const rsi = 100 - 100 / (1 + rs);

    const ma20 = data.length >= 20
      ? (data.slice(-20).reduce((sum, d) => sum + parseFloat(d.close), 0) / 20).toFixed(8)
      : closes[closes.length - 1].toFixed(8);

    const ma50 = data.length >= 50
      ? (data.slice(-50).reduce((sum, d) => sum + parseFloat(d.close), 0) / 50).toFixed(8)
      : closes[closes.length - 1].toFixed(8);

    const highPrice = Math.max(...highs).toFixed(8);
    const lowPrice = Math.min(...lows).toFixed(8);
    const currentPrice = closes[closes.length - 1].toFixed(8);

    const resistance = (parseFloat(highPrice) + parseFloat(currentPrice)) / 2;
    const support = (parseFloat(lowPrice) + parseFloat(currentPrice)) / 2;

    const priceChange = closes[closes.length - 1] - closes[0];
    let trend = "Neutral", trendColor = "#eab308";
    if (priceChange > 0) {
      trend = "Bullish 📈";
      trendColor = "#10b981";
    } else if (priceChange < 0) {
      trend = "Bearish 📉";
      trendColor = "#ef4444";
    }

    const volatility = ((Math.max(...highs) - Math.min(...lows)) / Math.min(...lows)).toFixed(2);
    const momentum = ((priceChange / closes[0]) * 100).toFixed(2);

    return {
      rsi: rsi.toFixed(2),
      ma20,
      ma50,
      resistance: resistance.toFixed(8),
      support: support.toFixed(8),
      currentPrice,
      highPrice,
      lowPrice,
      trend,
      trendColor,
      volatility,
      momentum,
    };
  }, []);

  // Track the chart's real on-screen width so candle count/sizing adapts to phones vs desktop
  useEffect(() => {
    const container = chartContainerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect?.width;
      if (width) setContainerWidth(width);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const isCompact = containerWidth > 0 && containerWidth < 480;

  // Must mirror the <ComposedChart margin={...}> prop below exactly — it's
  // how pixelYToPrice maps a click back to a price without needing to reach
  // into Recharts' internal scale.
  const chartMargin = useMemo(() => (
    isCompact
      ? { top: 12, bottom: 28 }
      : { top: 20, bottom: 50 }
  ), [isCompact]);

  useEffect(() => {
    if (!orderPlacementEnabled) {
      setPlacementMode(false);
      setHover(null);
    }
  }, [orderPlacementEnabled]);

  // How many candles fit at 1x zoom - target a legible pixel width per candle
  // instead of a fixed desktop count, so phones show fewer, bigger candles.
  const baseCandleCount = useMemo(() => {
    if (!containerWidth) return 50;
    const targetPxPerCandle = isCompact ? 10 : 6;
    return Math.max(12, Math.min(60, Math.floor(containerWidth / targetPxPerCandle)));
  }, [containerWidth, isCompact]);

  // Calculate how many candles to show based on zoom level - higher zoom = fewer, bigger candles
  const visibleCandleCount = useMemo(() => {
    return Math.max(8, Math.min(150, Math.round(baseCandleCount / zoomLevel)));
  }, [baseCandleCount, zoomLevel]);

  // Slice data based on zoom + pan - panOffset shifts the window back from the live edge
  const zoomedDisplayData = useMemo(() => {
    if (displayData.length === 0) return [];
    const maxPanOffset = Math.max(0, displayData.length - visibleCandleCount);
    const clampedOffset = Math.min(panOffset, maxPanOffset);
    const endIndex = displayData.length - clampedOffset;
    const startIndex = Math.max(0, endIndex - visibleCandleCount);
    return displayData.slice(startIndex, endIndex);
  }, [displayData, visibleCandleCount, panOffset]);

  // Price axis domain: driven only by real price data (candle highs/lows) plus
  // any buy/sell/booking lines, so an unrelated series (volume, which is
  // counted in coins/UGX-equivalent units, not price) can never blow out the
  // scale and flatten every candle into a hairline — that was the bug behind
  // the chart previously rendering as a single flat dash.
  const priceDomain = useMemo(() => {
    if (zoomedDisplayData.length === 0) return ['auto', 'auto'];
    const prices = zoomedDisplayData.flatMap(c => [c.high, c.low]);
    [...buyMarkers, ...sellMarkers, ...bookingOrders].forEach(m => {
      const p = parseFloat(m.price ?? m.target_price_ugx);
      if (Number.isFinite(p)) prices.push(p);
    });
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const pad = Math.max((max - min) * 0.08, Math.max(Math.abs(max), 1) * 0.002, 1);
    return [min - pad, max + pad];
  }, [zoomedDisplayData, buyMarkers, sellMarkers, bookingOrders]);

  // Convert a click/hover's viewport Y into a price, using the same domain
  // and margins the chart itself is rendered with — so "tap to book" always
  // reads the price actually under the cursor. Declared before the gesture
  // handlers below since several of them depend on it.
  const pixelYToPrice = useCallback((clientY) => {
    if (!plotRef.current) return null;
    const [domainMin, domainMax] = priceDomain;
    if (typeof domainMin !== 'number' || typeof domainMax !== 'number') return null;

    const rect = plotRef.current.getBoundingClientRect();
    const plotTop = chartMargin.top;
    const plotBottom = rect.height - chartMargin.bottom;
    const plotHeight = Math.max(1, plotBottom - plotTop);
    const relY = Math.min(Math.max(clientY - rect.top, plotTop), plotBottom);
    const frac = (relY - plotTop) / plotHeight;
    return domainMax - frac * (domainMax - domainMin);
  }, [priceDomain, chartMargin]);

  // Where an instant Buy/Sell would execute right now — always the latest
  // close, regardless of how far the chart is currently panned/zoomed.
  const livePrice = displayData.length > 0 ? displayData[displayData.length - 1].close : null;

  // Inverse of pixelYToPrice — a price's Y position relative to plotRef's
  // own top (not the viewport), so it's directly comparable to a click's
  // local Y for line hit-testing.
  const priceToPixelY = useCallback((price) => {
    if (!plotRef.current) return null;
    const [domainMin, domainMax] = priceDomain;
    if (typeof domainMin !== 'number' || typeof domainMax !== 'number') return null;
    const rect = plotRef.current.getBoundingClientRect();
    const plotTop = chartMargin.top;
    const plotBottom = rect.height - chartMargin.bottom;
    const plotHeight = Math.max(1, plotBottom - plotTop);
    const frac = (domainMax - price) / (domainMax - domainMin || 1);
    return plotTop + frac * plotHeight;
  }, [priceDomain, chartMargin]);

  // Every selectable line currently drawn on the chart, so a click can be
  // matched to the specific Live/Buy/Sell/Booking line nearest the cursor.
  const candidateLines = useMemo(() => {
    const lines = [];
    if (showLivePrice && livePrice != null) lines.push({ type: 'live', price: livePrice });
    buyMarkers.forEach((m, i) => {
      const p = parseFloat(m.price);
      if (Number.isFinite(p)) lines.push({ type: 'buy', price: p, index: i, marker: m });
    });
    sellMarkers.forEach((m, i) => {
      const p = parseFloat(m.price);
      if (Number.isFinite(p)) lines.push({ type: 'sell', price: p, index: i, marker: m });
    });
    bookingOrders.forEach((o) => {
      const p = parseFloat(o.target_price_ugx);
      if (Number.isFinite(p)) lines.push({ type: 'booking', price: p, order: o });
    });
    return lines;
  }, [showLivePrice, livePrice, buyMarkers, sellMarkers, bookingOrders]);

  const LINE_HIT_TOLERANCE_PX = 10;

  const findLineAt = useCallback((localY) => {
    let best = null;
    let bestDist = Infinity;
    for (const line of candidateLines) {
      const y = priceToPixelY(line.price);
      if (y == null) continue;
      const dist = Math.abs(y - localY);
      if (dist <= LINE_HIT_TOLERANCE_PX && dist < bestDist) {
        best = line;
        bestDist = dist;
      }
    }
    return best;
  }, [candidateLines, priceToPixelY]);

  // Keep refs in sync so gesture handlers (bound once) always see fresh values
  useEffect(() => {
    displayDataLengthRef.current = displayData.length;
    visibleCandleCountRef.current = visibleCandleCount;
    panOffsetRef.current = panOffset;
  }, [displayData.length, visibleCandleCount, panOffset]);

  // Clamp panOffset back into range whenever data/zoom shrink the valid window
  useEffect(() => {
    const maxPanOffset = Math.max(0, displayData.length - visibleCandleCount);
    setPanOffset(prev => Math.min(prev, maxPanOffset));
  }, [displayData.length, visibleCandleCount]);

  useEffect(() => {
    if (!candleData || candleData.length === 0) {
      if (displayData.length > 0 || analysis !== null) {
        setDisplayData([]);
        setAnalysis(null);
        setPrevDataLength(0);
      }
      return;
    }

    // Only update if data length actually changed (prevents unnecessary recalculations)
    if (candleData.length === prevDataLength && displayData.length > 0) {
      return;
    }

    const processed = candleData.map((candle, index) => {
      const open = parseFloat(candle.open_price || candle.open);
      const close = parseFloat(candle.close_price || candle.close);
      const high = parseFloat(candle.high_price || candle.high);
      const low = parseFloat(candle.low_price || candle.low);
      return {
        time: candle.time || `Candle ${index}`,
        open,
        high,
        low,
        close,
        range: [low, high],
        volume: parseFloat(candle.trading_volume || candle.volume || 0),
        isUp: close >= open,
      };
    });

    setDisplayData(processed);
    setAnalysis(calculateIndicators(processed));
    setPrevDataLength(candleData.length);
  }, [candleData, prevDataLength, calculateIndicators]);

  // Memoize tooltip content
  const renderTooltip = useCallback(({ active, payload }) => {
    if (active && payload && payload[0]) {
      const d = payload[0].payload;
      return (
        <div className="text-xs space-y-1.5 bg-slate-900 p-3 rounded-lg border border-slate-700">
          <p className="text-amber-400 font-semibold border-b border-slate-700 pb-1.5 mb-1.5">{d.time}</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            <p className="text-slate-400">Open:</p>
            <p className="text-emerald-400 font-mono">UGX {d.open.toLocaleString(undefined, { maximumFractionDigits: 2 })}</p>
            <p className="text-slate-400">High:</p>
            <p className="text-blue-400 font-mono">UGX {d.high.toLocaleString(undefined, { maximumFractionDigits: 2 })}</p>
            <p className="text-slate-400">Low:</p>
            <p className="text-rose-400 font-mono">UGX {d.low.toLocaleString(undefined, { maximumFractionDigits: 2 })}</p>
            <p className="text-slate-400">Close:</p>
            <p className="text-amber-400 font-mono">UGX {d.close.toLocaleString(undefined, { maximumFractionDigits: 2 })}</p>
            <p className="text-slate-400">Volume:</p>
            <p className="text-purple-400 font-mono">{d.volume.toFixed(2)}</p>
          </div>
        </div>
      );
    }
    return null;
  }, []);

  const ZOOM_MIN = 1;
  const ZOOM_MAX = 6;

  const clampPan = useCallback((offset) => {
    const maxPanOffset = Math.max(0, displayDataLengthRef.current - visibleCandleCountRef.current);
    return Math.max(0, Math.min(offset, maxPanOffset));
  }, []);

  // Wheel = zoom (desktop). Scroll up zooms in, scroll down zooms out.
  const handleMouseWheel = useCallback((e) => {
    if (chartContainerRef.current && chartContainerRef.current.contains(e.target)) {
      e.preventDefault();
      if (e.deltaY < 0) {
        setZoomLevel(prev => Math.min(prev + 0.15, ZOOM_MAX));
      } else {
        setZoomLevel(prev => Math.max(prev - 0.15, ZOOM_MIN));
      }
    }
  }, []);

  // Mouse drag = pan directly on the chart, no buttons
  const handleMouseDown = useCallback((e) => {
    gestureRef.current.dragging = true;
    gestureRef.current.startX = e.clientX;
    gestureRef.current.startY = e.clientY;
    gestureRef.current.startPanOffset = panOffsetRef.current;
  }, []);

  const handleMouseMove = useCallback((e) => {
    if (!gestureRef.current.dragging || !chartContainerRef.current) return;
    const containerWidth = chartContainerRef.current.getBoundingClientRect().width || 1;
    const candleWidthPx = containerWidth / Math.max(1, visibleCandleCountRef.current);
    const deltaX = e.clientX - gestureRef.current.startX;
    const candleDelta = deltaX / candleWidthPx;
    setPanOffset(clampPan(gestureRef.current.startPanOffset + candleDelta));
  }, [clampPan]);

  // A "click" (near-zero movement) either selects the Live/Buy/Sell/Booking
  // line nearest the cursor (always available), or — only in placement mode,
  // and only when no existing line was hit — books a brand new order at that
  // price. Anything past the threshold was a pan/drag, not a tap.
  const CLICK_MOVE_THRESHOLD_PX = 6;

  const handleMouseUp = useCallback((e) => {
    const wasDragging = gestureRef.current.dragging;
    gestureRef.current.dragging = false;
    if (!wasDragging || !e || !plotRef.current) return;

    const moved = Math.abs(e.clientX - gestureRef.current.startX) + Math.abs(e.clientY - gestureRef.current.startY);
    if (moved > CLICK_MOVE_THRESHOLD_PX) return;

    const rect = plotRef.current.getBoundingClientRect();
    const hitLine = findLineAt(e.clientY - rect.top);
    if (hitLine) {
      if (onLineSelect) onLineSelect(hitLine);
      return;
    }

    if (placementMode && onPlaceOrderClick) {
      const price = pixelYToPrice(e.clientY);
      if (price != null) onPlaceOrderClick(price);
    }
  }, [placementMode, onPlaceOrderClick, pixelYToPrice, findLineAt, onLineSelect]);

  // Always track which line (if any) is under the cursor, so it can be
  // highlighted and the cursor can hint it's clickable — independent of
  // placement mode, which only gates the crosshair for booking a NEW order.
  const handleHoverMove = useCallback((e) => {
    if (!plotRef.current) return;
    const rect = plotRef.current.getBoundingClientRect();
    const localY = e.clientY - rect.top;
    setHoverLine(findLineAt(localY));

    if (!placementMode) {
      setHover(null);
      return;
    }
    const y = Math.min(Math.max(localY, chartMargin.top), rect.height - chartMargin.bottom);
    const price = pixelYToPrice(e.clientY);
    if (price != null) setHover({ y, price });
  }, [placementMode, pixelYToPrice, chartMargin, findLineAt]);

  const handleHoverLeave = useCallback(() => {
    setHover(null);
    setHoverLine(null);
  }, []);

  // Touch: one finger pans, two fingers pinch-zoom - all directly on-screen
  const getTouchDistance = (touches) => {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const handleTouchStart = useCallback((e) => {
    if (e.touches.length === 2) {
      gestureRef.current.pinching = true;
      gestureRef.current.dragging = false;
      gestureRef.current.startDistance = getTouchDistance(e.touches);
      gestureRef.current.startZoom = zoomLevel;
    } else if (e.touches.length === 1) {
      gestureRef.current.dragging = true;
      gestureRef.current.pinching = false;
      gestureRef.current.startX = e.touches[0].clientX;
      gestureRef.current.startY = e.touches[0].clientY;
      gestureRef.current.startPanOffset = panOffsetRef.current;
    }
  }, [zoomLevel]);

  const handleTouchMove = useCallback((e) => {
    if (!chartContainerRef.current) return;
    if (gestureRef.current.pinching && e.touches.length === 2) {
      e.preventDefault();
      const newDistance = getTouchDistance(e.touches);
      const ratio = newDistance / (gestureRef.current.startDistance || newDistance);
      const newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, gestureRef.current.startZoom * ratio));
      setZoomLevel(newZoom);
    } else if (gestureRef.current.dragging && e.touches.length === 1) {
      e.preventDefault();
      const containerWidth = chartContainerRef.current.getBoundingClientRect().width || 1;
      const candleWidthPx = containerWidth / Math.max(1, visibleCandleCountRef.current);
      const deltaX = e.touches[0].clientX - gestureRef.current.startX;
      const candleDelta = deltaX / candleWidthPx;
      setPanOffset(clampPan(gestureRef.current.startPanOffset + candleDelta));
    }
  }, [clampPan]);

  const handleTouchEnd = useCallback((e) => {
    if (e.touches.length === 0) {
      const wasTap = gestureRef.current.dragging && !gestureRef.current.pinching;
      gestureRef.current.dragging = false;
      gestureRef.current.pinching = false;

      if (wasTap && e.changedTouches?.[0] && plotRef.current) {
        const t = e.changedTouches[0];
        const moved = Math.abs(t.clientX - gestureRef.current.startX) + Math.abs(t.clientY - gestureRef.current.startY);
        if (moved <= CLICK_MOVE_THRESHOLD_PX) {
          const rect = plotRef.current.getBoundingClientRect();
          const hitLine = findLineAt(t.clientY - rect.top);
          if (hitLine) {
            if (onLineSelect) onLineSelect(hitLine);
          } else if (placementMode && onPlaceOrderClick) {
            const price = pixelYToPrice(t.clientY);
            if (price != null) onPlaceOrderClick(price);
          }
        }
      }
    } else if (e.touches.length === 1) {
      // Dropped from pinch to a single finger - restart as a pan
      gestureRef.current.pinching = false;
      gestureRef.current.dragging = true;
      gestureRef.current.startX = e.touches[0].clientX;
      gestureRef.current.startPanOffset = panOffsetRef.current;
    }
  }, [placementMode, onPlaceOrderClick, pixelYToPrice, findLineAt, onLineSelect]);

  // Wire up all gesture listeners directly on the chart container - no icons/buttons involved
  useEffect(() => {
    const container = chartContainerRef.current;
    if (!container) return;
    container.addEventListener('wheel', handleMouseWheel, { passive: false });
    container.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    container.addEventListener('touchstart', handleTouchStart, { passive: true });
    container.addEventListener('touchmove', handleTouchMove, { passive: false });
    container.addEventListener('touchend', handleTouchEnd, { passive: true });
    container.addEventListener('mousemove', handleHoverMove);
    container.addEventListener('mouseleave', handleHoverLeave);
    return () => {
      container.removeEventListener('wheel', handleMouseWheel);
      container.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
      container.removeEventListener('mousemove', handleHoverMove);
      container.removeEventListener('mouseleave', handleHoverLeave);
    };
  }, [handleMouseWheel, handleMouseDown, handleMouseMove, handleMouseUp, handleTouchStart, handleTouchMove, handleTouchEnd, handleHoverMove, handleHoverLeave]);

  // One candle per shape invocation, positioned using the SAME y-scale Recharts
  // computed for the "range" ([low, high]) bar — so wicks/bodies always line up
  // exactly with the shared price axis instead of a hand-rolled scale that can
  // drift out of sync with it (e.g. get squashed flat by an unrelated series).
  const CandlestickShape = useCallback((props) => {
    const { x, y, width, height, payload } = props;
    if (!payload) return null;

    const { open, close, high, low } = payload;
    const isUp = close >= open;
    const bodyColor = isUp ? chartSettings.upColor : chartSettings.downColor;
    const priceRange = high - low;

    const priceToY = (price) => (priceRange > 0 ? y + height * (high - price) / priceRange : y + height / 2);
    const openY = priceToY(open);
    const closeY = priceToY(close);

    const candleBodyWidth = Math.max(2, Math.min(width * 0.82, 24));
    const candleX = x + width / 2;
    const bodyTop = Math.min(openY, closeY);
    const bodyHeight = Math.max(Math.abs(closeY - openY), 1.5);

    return (
      <g>
        <line x1={candleX} x2={candleX} y1={y} y2={y + height} stroke={bodyColor} strokeWidth={1} />
        <rect
          x={candleX - candleBodyWidth / 2}
          y={bodyTop}
          width={candleBodyWidth}
          height={bodyHeight}
          fill={bodyColor}
        />
      </g>
    );
  }, [chartSettings.upColor, chartSettings.downColor]);

  const volumeDomain = useMemo(() => {
    if (zoomedDisplayData.length === 0) return [0, 'auto'];
    const maxVol = Math.max(...zoomedDisplayData.map(c => c.volume || 0), 0);
    // 4x headroom keeps the volume bars confined to roughly the bottom
    // quarter of the plot instead of sharing the price scale.
    return [0, maxVol > 0 ? maxVol * 4 : 1];
  }, [zoomedDisplayData]);

  const showVolume = chartSettings.showVolume && !isCompact;
  const showLegend = buyMarkers.length > 0 || sellMarkers.length > 0 || bookingOrders.length > 0 || (showLivePrice && livePrice != null);

  if (loading) {
    return (
      <div className="w-full h-96 bg-slate-900 rounded-xl flex flex-col items-center justify-center border border-slate-800">
        <div className="w-16 h-16 rounded-2xl bg-slate-800 flex items-center justify-center mb-4">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-amber-500"></div>
        </div>
        <p className="text-slate-400 font-medium">Loading Chart Data...</p>
        <p className="text-slate-500 text-sm mt-1">Connecting to market feed</p>
      </div>
    );
  }

  if (!displayData || displayData.length === 0) {
    return (
      <div className="w-full h-96 bg-slate-900 rounded-xl flex flex-col items-center justify-center border border-slate-800">
        <div className="w-16 h-16 rounded-2xl bg-slate-800 flex items-center justify-center mb-4">
          <span className="text-3xl">📊</span>
        </div>
        <p className="text-slate-400 font-medium">No Market Data</p>
        <p className="text-slate-500 text-sm mt-1">Waiting for price updates...</p>
      </div>
    );
  }

  return (
    <div className={`bg-slate-900 rounded-xl h-full w-full flex flex-col ${isCompact ? 'p-1' : 'p-2'}`}>
      {showLegend && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-2 pb-1.5 text-[11px] text-slate-400">
          {showLivePrice && livePrice != null && (
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-0.5 rounded" style={{ backgroundColor: LIVE_COLOR }} />
              Live price
            </span>
          )}
          {buyMarkers.length > 0 && (
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-0.5 rounded" style={{ backgroundColor: BUY_COLOR }} />
              Buy
            </span>
          )}
          {sellMarkers.length > 0 && (
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-0.5 rounded" style={{ backgroundColor: SELL_COLOR }} />
              Sell
            </span>
          )}
          {bookingOrders.length > 0 && (
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-0.5 rounded border-t border-dashed" style={{ borderColor: BOOKING_COLOR }} />
              Booked (pending)
            </span>
          )}
        </div>
      )}
      <div
        ref={chartContainerRef}
        className={`relative bg-slate-950 rounded-lg border border-slate-800 ${hoverLine ? 'cursor-pointer' : placementMode ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing'} overflow-hidden flex-1 flex flex-col min-h-0 select-none ${isCompact ? 'p-1' : 'p-3'}`}
        style={{ touchAction: 'none' }}
      >
        {orderPlacementEnabled && (
          <button
            type="button"
            onMouseDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); setPlacementMode(p => !p); }}
            className={`absolute top-1.5 right-1.5 z-10 px-2 py-1 rounded-md text-[10px] font-semibold border transition-colors ${
              placementMode
                ? 'bg-amber-500 text-slate-900 border-amber-400'
                : 'bg-slate-800/90 text-slate-300 border-slate-700 hover:text-white'
            }`}
          >
            {isCompact
              ? (placementMode ? '🎯 Booking…' : '🎯 Book')
              : (placementMode ? '🎯 Tap chart to book — tap again to cancel' : '🎯 Tap chart to book')}
          </button>
        )}
        <div ref={plotRef} className="relative flex-1 min-h-0">
          {placementMode && hover && (
            <div
              className="absolute left-0 right-0 border-t border-dashed pointer-events-none z-10"
              style={{ top: hover.y, borderColor: BOOKING_COLOR }}
            >
              <span
                className="absolute right-1 -translate-y-1/2 px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold text-slate-900"
                style={{ backgroundColor: BOOKING_COLOR }}
              >
                UGX {hover.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </span>
            </div>
          )}
          {hoverLine && (() => {
            const y = priceToPixelY(hoverLine.price);
            if (y == null) return null;
            const color = hoverLine.type === 'live' ? LIVE_COLOR
              : hoverLine.type === 'buy' ? BUY_COLOR
              : hoverLine.type === 'sell' ? SELL_COLOR
              : BOOKING_COLOR;
            const label = hoverLine.type === 'live' ? '👆 Tap to trade at LIVE price'
              : hoverLine.type === 'buy' ? '👆 Tap to re-book this Buy price'
              : hoverLine.type === 'sell' ? '👆 Tap to re-book this Sell price'
              : '👆 Tap to manage this booked order';
            return (
              <div
                className="absolute left-1 -translate-y-1/2 px-1.5 py-0.5 rounded text-[10px] font-semibold text-slate-900 pointer-events-none z-20 whitespace-nowrap"
                style={{ top: y, backgroundColor: color }}
              >
                {label}
              </div>
            );
          })()}
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={zoomedDisplayData}
            margin={
              isCompact
                ? { ...chartMargin, right: 4, left: 2 }
                : { ...chartMargin, right: 55, left: 10 }
            }
          >
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.08)" />
            <XAxis
              dataKey="time"
              tick={{ fill: "#64748b", fontSize: isCompact ? 9 : 10 }}
              tickFormatter={(value) => {
                if (!isCompact || typeof value !== 'string') return value;
                // Trim "10:15:32 PM" down to "15:32" so labels fit narrow screens
                const parts = value.split(':');
                if (parts.length < 3) return value;
                return `${parts[1]}:${parts[2].replace(/\s?[AP]M/i, '')}`;
              }}
              angle={isCompact ? -60 : -45}
              textAnchor="end"
              height={isCompact ? 28 : 60}
              interval={Math.max(0, Math.floor(zoomedDisplayData.length / (isCompact ? 5 : 10)))}
              axisLine={{ stroke: '#334155' }}
              tickLine={{ stroke: '#334155' }}
            />
            <YAxis
              yAxisId="price"
              tick={{ fill: "#64748b", fontSize: isCompact ? 9 : 10 }}
              width={isCompact ? 34 : 55}
              orientation="right"
              domain={priceDomain}
              axisLine={{ stroke: '#334155' }}
              tickLine={{ stroke: '#334155' }}
            />

            {showVolume && (
              <YAxis yAxisId="volume" domain={volumeDomain} hide />
            )}

            {analysis && (
              <>
                <ReferenceLine yAxisId="price" y={parseFloat(analysis.resistance)} stroke="#ef4444" strokeOpacity={0.5} strokeDasharray="5 5" />
                <ReferenceLine yAxisId="price" y={parseFloat(analysis.support)} stroke="#10b981" strokeOpacity={0.5} strokeDasharray="5 5" />
              </>
            )}

            {showLivePrice && livePrice != null && (
              <ReferenceLine
                yAxisId="price"
                y={livePrice}
                stroke={LIVE_COLOR}
                strokeWidth={hoverLine?.type === 'live' ? 3 : 1.5}
                label={{
                  value: `● LIVE ${livePrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}`,
                  position: 'insideTopRight',
                  fill: LIVE_COLOR,
                  fontSize: 10,
                }}
              />
            )}

            {buyMarkers.map((m, i) => (
              <ReferenceLine
                key={`buy-${i}`}
                yAxisId="price"
                y={parseFloat(m.price)}
                stroke={BUY_COLOR}
                strokeDasharray="4 3"
                strokeWidth={hoverLine?.type === 'buy' && hoverLine.index === i ? 2.5 : 1.25}
              />
            ))}
            {sellMarkers.map((m, i) => (
              <ReferenceLine
                key={`sell-${i}`}
                yAxisId="price"
                y={parseFloat(m.price)}
                stroke={SELL_COLOR}
                strokeDasharray="4 3"
                strokeWidth={hoverLine?.type === 'sell' && hoverLine.index === i ? 2.5 : 1.25}
              />
            ))}
            {bookingOrders.map((o) => (
              <ReferenceLine
                key={`book-${o.id}`}
                yAxisId="price"
                y={parseFloat(o.target_price_ugx)}
                stroke={BOOKING_COLOR}
                strokeDasharray="2 4"
                strokeWidth={hoverLine?.type === 'booking' && hoverLine.order?.id === o.id ? 2.75 : 1.5}
                label={{
                  value: `📌 ${o.order_type === 'buy' ? 'Buy' : 'Sell'} @ ${parseFloat(o.target_price_ugx).toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
                  position: 'insideBottomLeft',
                  fill: BOOKING_COLOR,
                  fontSize: 10,
                }}
              />
            ))}

            <Tooltip
              content={renderTooltip}
              cursor={{ stroke: 'rgba(148, 163, 184, 0.3)', strokeWidth: 1 }}
              isAnimationActive={false}
            />

            {showVolume && (
              <Bar yAxisId="volume" dataKey="volume" fill="rgba(168,85,247,0.15)" isAnimationActive={false} />
            )}

            {/* Real OHLC candlesticks, scaled by the shared price axis */}
            <Bar
              yAxisId="price"
              dataKey="range"
              fill="transparent"
              isAnimationActive={false}
              shape={CandlestickShape}
            />
          </ComposedChart>
        </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
});

export default CandlestickChart;
