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

const CandlestickChart = React.memo(({ candleData = [], priceUSD = 0.00036, loading = false, settings = {} }) => {
  const [displayData, setDisplayData] = useState([]);
  const [analysis, setAnalysis] = useState(null);
  const [prevDataLength, setPrevDataLength] = useState(0);
  const [zoomLevel, setZoomLevel] = useState(1); // higher = more zoomed in (fewer, bigger candles)
  const [panOffset, setPanOffset] = useState(0); // candles back from the live edge
  const [containerWidth, setContainerWidth] = useState(0);
  const chartContainerRef = useRef(null);
  const gestureRef = useRef({
    dragging: false,
    startX: 0,
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
      return {
        time: candle.time || `Candle ${index}`,
        open,
        high: parseFloat(candle.high_price || candle.high),
        low: parseFloat(candle.low_price || candle.low),
        close,
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
            <p className="text-emerald-400 font-mono">${d.open.toFixed(8)}</p>
            <p className="text-slate-400">High:</p>
            <p className="text-blue-400 font-mono">${d.high.toFixed(8)}</p>
            <p className="text-slate-400">Low:</p>
            <p className="text-rose-400 font-mono">${d.low.toFixed(8)}</p>
            <p className="text-slate-400">Close:</p>
            <p className="text-amber-400 font-mono">${d.close.toFixed(8)}</p>
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

  const handleMouseUp = useCallback(() => {
    gestureRef.current.dragging = false;
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
      gestureRef.current.dragging = false;
      gestureRef.current.pinching = false;
    } else if (e.touches.length === 1) {
      // Dropped from pinch to a single finger - restart as a pan
      gestureRef.current.pinching = false;
      gestureRef.current.dragging = true;
      gestureRef.current.startX = e.touches[0].clientX;
      gestureRef.current.startPanOffset = panOffsetRef.current;
    }
  }, []);

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
    return () => {
      container.removeEventListener('wheel', handleMouseWheel);
      container.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
    };
  }, [handleMouseWheel, handleMouseDown, handleMouseMove, handleMouseUp, handleTouchStart, handleTouchMove, handleTouchEnd]);

  // Creative Candlestick Component - Transforms from Trend Line to Full Candlesticks
  const CandlestickRender = ({ x, y, width, height, payload, displayData, upColor, downColor, wickColor }) => {
    if (!displayData || displayData.length === 0) return null;

    // Memoize min/max calculation
    const prices = displayData.flatMap(c => [c.high, c.low]);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const priceRange = maxPrice - minPrice || 1;

    // Color scheme: Green for winning (bullish), Red for losing (bearish)
    const upColor_candlestick = '#10b981'; // Green for bullish
    const downColor_candlestick = '#ef4444'; // Red for bearish

    // Always render real OHLC candlesticks - width scales with zoom/candle density
    return (
      <g>
        {displayData.map((candle, index) => {
          if (!candle) return null;

          const isUp = candle.close >= candle.open;

          // Dynamic sizing - scales with available per-candle width
          const candleBodyWidth = Math.max(2, Math.min(width * 0.7, 20));
          const candleX = x + (index * width) + width / 2;

          // Normalize prices to chart coordinates
          const highY = y + height * (1 - (candle.high - minPrice) / priceRange);
          const lowY = y + height * (1 - (candle.low - minPrice) / priceRange);
          const openY = y + height * (1 - (candle.open - minPrice) / priceRange);
          const closeY = y + height * (1 - (candle.close - minPrice) / priceRange);

          const bodyTop = Math.min(openY, closeY);
          const bodyHeight = Math.max(Math.abs(closeY - openY), 1.5);

          // Color selection: green for up, red for down
          const bodyFill = isUp ? upColor_candlestick : downColor_candlestick;

          // Wick color with transparency
          const wickStroke = isUp ? `rgba(16, 185, 129, 0.8)` : `rgba(239, 68, 68, 0.8)`;

          return (
            <g key={`candlestick-${index}`}>
              {/* Wick - extended line from high to low showing price range */}
              <line
                x1={candleX}
                y1={highY}
                y2={lowY}
                x2={candleX}
                stroke={wickStroke}
                strokeWidth={Math.max(1, width * 0.12)}
                strokeLinecap="round"
                opacity={0.9}
              />

              {/* Body - main candlestick rectangle showing open/close */}
              <rect
                x={candleX - candleBodyWidth / 2}
                y={bodyTop}
                width={candleBodyWidth}
                height={bodyHeight}
                fill={bodyFill}
                stroke={bodyFill}
                strokeWidth={Math.max(0.5, width * 0.06)}
                opacity={0.92}
              />

              {/* Inner highlight for 3D effect */}
              {bodyHeight > 3 && candleBodyWidth > 5 && (
                <rect
                  x={candleX - candleBodyWidth / 2 + 0.5}
                  y={bodyTop + 0.5}
                  width={Math.max(1, candleBodyWidth / 2 - 1)}
                  height={Math.max(1, bodyHeight - 1)}
                  fill="white"
                  opacity={0.25}
                  pointerEvents="none"
                />
              )}

              {/* Outer shadow for depth and dimension */}
              {bodyHeight > 3 && candleBodyWidth > 5 && (
                <rect
                  x={candleX}
                  y={bodyTop + 0.5}
                  width={Math.max(1, candleBodyWidth / 2 - 0.5)}
                  height={Math.max(1, bodyHeight - 1)}
                  fill="black"
                  opacity={0.15}
                  pointerEvents="none"
                />
              )}
            </g>
          );
        })}
      </g>
    );
  };

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
      <div
        ref={chartContainerRef}
        className={`bg-slate-950 rounded-lg border border-slate-800 cursor-grab active:cursor-grabbing overflow-hidden flex-1 flex flex-col min-h-0 select-none ${isCompact ? 'p-1' : 'p-3'}`}
        style={{ touchAction: 'none' }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={zoomedDisplayData}
            margin={
              isCompact
                ? { top: 12, right: 4, left: 2, bottom: 28 }
                : { top: 20, right: 30, left: 50, bottom: 50 }
            }
          >
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.1)" />
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
              tick={{ fill: "#64748b", fontSize: isCompact ? 9 : 10 }}
              width={isCompact ? 34 : 55}
              orientation={isCompact ? 'right' : 'left'}
              mirror={isCompact}
              domain={["dataMin - 0.000001", "dataMax + 0.000001"]}
              axisLine={{ stroke: '#334155' }}
              tickLine={{ stroke: '#334155' }}
            />

            {analysis && (
              <>
                <ReferenceLine y={parseFloat(analysis.resistance)} stroke="#ef4444" strokeDasharray="5 5" />
                <ReferenceLine y={parseFloat(analysis.support)} stroke="#10b981" strokeDasharray="5 5" />
              </>
            )}

            <Tooltip
              content={renderTooltip}
              cursor={{ stroke: 'rgba(148, 163, 184, 0.3)', strokeWidth: 1 }}
              isAnimationActive={false}
            />

            {chartSettings.showVolume && !isCompact && (
              <Bar dataKey="volume" fill="rgba(168,85,247,0.15)" isAnimationActive={false} />
            )}

            {/* Beautiful Candlesticks */}
            <Bar
              dataKey="close"
              fill="transparent"
              isAnimationActive={false}
              shape={<CandlestickRender displayData={zoomedDisplayData} upColor={chartSettings.upColor} downColor={chartSettings.downColor} wickColor={chartSettings.wickColor} />}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
});

export default CandlestickChart;
