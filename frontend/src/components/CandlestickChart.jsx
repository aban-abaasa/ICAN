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
  Cell,
  Line,
} from "recharts";

const CandlestickChart = React.memo(({ candleData = [], priceUSD = 0.00036, loading = false, settings = {} }) => {
  const [displayData, setDisplayData] = useState([]);
  const [analysis, setAnalysis] = useState(null);
  const [prevDataLength, setPrevDataLength] = useState(0);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [xAxisDomain, setXAxisDomain] = useState([0, 'dataMax']);
  const chartContainerRef = useRef(null);

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

  // Calculate how many candles to show based on zoom level
  const visibleCandleCount = useMemo(() => {
    const baseCount = 50; // Default number of candles visible at 1x zoom
    return Math.max(10, Math.floor(baseCount * zoomLevel));
  }, [zoomLevel]);

  // Slice data based on zoom level - show more candles when zoomed in
  const zoomedDisplayData = useMemo(() => {
    if (displayData.length === 0) return [];
    const startIndex = Math.max(0, displayData.length - visibleCandleCount);
    return displayData.slice(startIndex);
  }, [displayData, visibleCandleCount]);

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

  const priceChangePercent = useMemo(() => {
    if (displayData.length >= 2) {
      return (((displayData[displayData.length - 1].close - displayData[0].open) / displayData[0].open) * 100).toFixed(2);
    }
    return 0;
  }, [displayData]);

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

  // Zoom control handlers
  const handleZoomIn = useCallback(() => {
    setZoomLevel(prev => Math.min(prev + 0.2, 3));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoomLevel(prev => Math.max(prev - 0.2, 1));
  }, []);

  const handleResetZoom = useCallback(() => {
    setZoomLevel(1);
  }, []);

  const handlePanLeft = useCallback(() => {
    setXAxisDomain(prev => {
      const [start, end] = prev;
      const range = end - start;
      return [Math.max(0, start - range * 0.2), Math.max(end - range * 0.2, displayData.length)];
    });
  }, [displayData.length]);

  const handlePanRight = useCallback(() => {
    setXAxisDomain(prev => {
      const [start, end] = prev;
      const range = end - start;
      return [start + range * 0.2, Math.min(end + range * 0.2, displayData.length)];
    });
  }, [displayData.length]);

  // Handle mouse wheel zoom
  const handleMouseWheel = useCallback((e) => {
    if (chartContainerRef.current && chartContainerRef.current.contains(e.target)) {
      e.preventDefault();
      if (e.deltaY < 0) {
        // Scroll up - zoom in
        setZoomLevel(prev => Math.min(prev + 0.1, 3));
      } else {
        // Scroll down - zoom out
        setZoomLevel(prev => Math.max(prev - 0.1, 1));
      }
    }
  }, []);

  // Add mouse wheel listener
  useEffect(() => {
    const container = chartContainerRef.current;
    if (container) {
      container.addEventListener('wheel', handleMouseWheel, { passive: false });
      return () => container.removeEventListener('wheel', handleMouseWheel);
    }
  }, [handleMouseWheel]);

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

    // Zoom threshold: at low zoom show ONLY trend line, at high zoom show ONLY candlesticks
    const showTrendLineOnly = zoomLevel <= 1.3;
    const showCandlesticksOnly = zoomLevel > 1.3;

    // TREND LINE MODE: Show smooth cyan line at normal zoom
    if (showTrendLineOnly) {
      return (
        <polyline
          points={displayData.map((candle, index) => {
            const candleX = x + (index * width) + width / 2;
            const closeY = y + height * (1 - (candle.close - minPrice) / priceRange);
            return `${candleX},${closeY}`;
          }).join(' ')}
          fill="none"
          stroke="#06b6d4"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.85}
        />
      );
    }

    // CANDLESTICK MODE: Show full candlesticks when zoomed in
    if (showCandlesticksOnly) {
      return (
        <g>
          {displayData.map((candle, index) => {
            if (!candle) return null;
            
            const isUp = candle.close >= candle.open;
            
            // Dynamic sizing - more prominent as zoom increases
            const candleBodyWidth = Math.max(3, Math.min(width * 0.85, 20));
            const candleX = x + (index * width) + width / 2;
            
            // Normalize prices to chart coordinates
            const highY = y + height * (1 - (candle.high - minPrice) / priceRange);
            const lowY = y + height * (1 - (candle.low - minPrice) / priceRange);
            const openY = y + height * (1 - (candle.open - minPrice) / priceRange);
            const closeY = y + height * (1 - (candle.close - minPrice) / priceRange);
            
            const bodyTop = Math.min(openY, closeY);
            const bodyHeight = Math.max(Math.abs(closeY - openY), 2);
            
            // Color selection: green for up, red for down
            const bodyFill = isUp ? upColor_candlestick : downColor_candlestick;
            
            // Wick color with transparency
            const wickColor = isUp ? `rgba(16, 185, 129, 0.8)` : `rgba(239, 68, 68, 0.8)`;

            return (
              <g key={`candlestick-${index}`}>
                {/* Wick - extended line from high to low showing price range */}
                <line
                  x1={candleX}
                  y1={highY}
                  y2={lowY}
                  x2={candleX}
                  stroke={wickColor}
                  strokeWidth={Math.max(1, width * 0.15)}
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
                  strokeWidth={Math.max(0.5, width * 0.08)}
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
    }

    return null;
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
    <div className="bg-slate-900 rounded-xl p-4 md:p-6 space-y-4 h-full">
      {/* Chart Header - Compact Professional Style */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-bold text-white">ICAN/USD</h2>
            <div className={`px-2 py-1 rounded text-xs font-semibold ${
              priceChangePercent >= 0 
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' 
                : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
          }`}>
            {priceChangePercent >= 0 ? '▲' : '▼'} {Math.abs(priceChangePercent)}%
          </div>
        </div>
        <span className="text-xs text-slate-500">7-Second Intervals • {displayData.length} Candles</span>
      </div>
      </div>

      {/* Zoom & Pan Controls */}
      <div className="flex flex-wrap items-center gap-2 bg-slate-800/50 p-2.5 rounded-lg border border-slate-700">
        <button
          onClick={handlePanLeft}
          className="p-2 hover:bg-slate-700 rounded-lg transition-colors text-slate-400 hover:text-white border border-slate-700 hover:border-slate-600"
          title="Pan Left"
        >
          ◀ Pan
        </button>

        <button
          onClick={handleZoomOut}
          disabled={zoomLevel <= 1}
          className="p-2 hover:bg-slate-700 rounded-lg transition-colors text-slate-400 hover:text-white border border-slate-700 hover:border-slate-600 disabled:opacity-50 disabled:cursor-not-allowed"
          title="Zoom Out"
        >
          🔍−
        </button>

        <div className="text-xs text-slate-400 px-2 py-1 bg-slate-700/50 rounded border border-slate-700 min-w-max">
          {(zoomLevel * 100).toFixed(0)}%
        </div>

        <button
          onClick={handleZoomIn}
          disabled={zoomLevel >= 3}
          className="p-2 hover:bg-slate-700 rounded-lg transition-colors text-slate-400 hover:text-white border border-slate-700 hover:border-slate-600 disabled:opacity-50 disabled:cursor-not-allowed"
          title="Zoom In"
        >
          🔍+
        </button>

        <button
          onClick={handleResetZoom}
          disabled={zoomLevel === 1}
          className="p-2 hover:bg-slate-700 rounded-lg transition-colors text-slate-400 hover:text-white border border-slate-700 hover:border-slate-600 disabled:opacity-50 disabled:cursor-not-allowed"
          title="Reset Zoom"
        >
          ⟲ Reset
        </button>

        <button
          onClick={handlePanRight}
          className="p-2 hover:bg-slate-700 rounded-lg transition-colors text-slate-400 hover:text-white border border-slate-700 hover:border-slate-600"
          title="Pan Right"
        >
          Pan ▶
        </button>
      </div>

      {/* Technical Analysis Grid */}
      {analysis && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {/* Trend Analysis Card */}
          <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center">
                <span className="text-sm">📊</span>
              </div>
              <h4 className="text-sm font-bold text-white">Trend Analysis</h4>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="text-center">
                <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Trend</p>
                <p className="text-sm font-bold" style={{ color: analysis.trendColor }}>{analysis.trend}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">RSI (14)</p>
                <p className={`text-sm font-bold ${
                  parseFloat(analysis.rsi) > 70 ? 'text-rose-400' : 
                  parseFloat(analysis.rsi) < 30 ? 'text-emerald-400' : 'text-white'
                }`}>{analysis.rsi}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Volatility</p>
                <p className="text-sm font-bold text-amber-400">{analysis.volatility}%</p>
              </div>
            </div>
          </div>

          {/* Support & Resistance Card */}
          <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-lg bg-purple-500/20 flex items-center justify-center">
                <span className="text-sm">🎯</span>
              </div>
              <h4 className="text-sm font-bold text-white">Key Levels</h4>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="text-center">
                <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Resistance</p>
                <p className="text-sm font-bold text-rose-400 font-mono">${parseFloat(analysis.resistance).toFixed(6)}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Current</p>
                <p className="text-sm font-bold text-amber-400 font-mono">${parseFloat(analysis.currentPrice).toFixed(6)}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Support</p>
                <p className="text-sm font-bold text-emerald-400 font-mono">${parseFloat(analysis.support).toFixed(6)}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main Chart Container - Stable, no flickering */}
      <div 
        ref={chartContainerRef}
        className="bg-slate-950 rounded-lg p-3 border border-slate-800 cursor-grab active:cursor-grabbing overflow-x-auto" 
        style={{ minHeight: '350px' }}
      >
        <ResponsiveContainer width="100%" height={350}>
          <ComposedChart data={zoomedDisplayData} margin={{ top: 20, right: 30, left: 50, bottom: 50 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.1)" />
            <XAxis
              dataKey="time"
              tick={{ fill: "#64748b", fontSize: 10 }}
              angle={-45}
              textAnchor="end"
              height={60}
              interval={Math.max(0, Math.floor(zoomedDisplayData.length / (10 * zoomLevel)))}
              axisLine={{ stroke: '#334155' }}
              tickLine={{ stroke: '#334155' }}
            />
            <YAxis 
              tick={{ fill: "#64748b", fontSize: 10 }} 
              width={55} 
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

            {chartSettings.showVolume && (
              <Bar dataKey="volume" fill="rgba(168,85,247,0.15)" isAnimationActive={false} yAxisId="left" />
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

      {/* Footer Stats */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 pt-2 border-t border-slate-800">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded" style={{backgroundColor: chartSettings.upColor}}></span>
            Bullish
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded" style={{backgroundColor: chartSettings.downColor}}></span>
            Bearish
          </span>
        </div>
        <span>Auto-refresh: 7s</span>
      </div>
    </div>
  );
});

export default CandlestickChart;
