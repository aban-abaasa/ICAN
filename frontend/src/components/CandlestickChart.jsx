import React, { useEffect, useState } from "react";
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ComposedChart,
  ReferenceLine,
  Line,
  Bar,
} from "recharts";

const CandlestickChart = ({ candleData = [], priceUSD = 0.00036, loading = false, settings = {} }) => {
  const [displayData, setDisplayData] = useState([]);
  const [analysis, setAnalysis] = useState(null);

  const defaultSettings = {
    upColor: "#10b981",
    downColor: "#ef4444",
    wickColor: "#808080",
    showVolume: true,
    selectedTimeframe: "7s",
  };

  const chartSettings = { ...defaultSettings, ...settings };

  const calculateIndicators = (data) => {
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
  };

  useEffect(() => {
    if (!candleData || candleData.length === 0) {
      setDisplayData([]);
      setAnalysis(null);
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
  }, [candleData]);

  const priceChangePercent = displayData.length >= 2
    ? (((displayData[displayData.length - 1].close - displayData[0].open) / displayData[0].open) * 100).toFixed(2)
    : 0;

  if (loading) {
    return (
      <div className="w-full h-96 bg-white/5 rounded-lg flex items-center justify-center border border-white/10">
        <p className="text-gray-400">⏳ Loading...</p>
      </div>
    );
  }

  if (!displayData || displayData.length === 0) {
    return (
      <div className="w-full h-96 bg-white/5 rounded-lg flex items-center justify-center border border-white/10">
        <p className="text-gray-400">📊 No data</p>
      </div>
    );
  }

  return (
    <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-2xl p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-white">📊 ICAN Price Chart</h2>
        <span className="text-sm text-gray-400">Real-time candlestick chart - Updates every 7 seconds</span>
      </div>

      {analysis && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-blue-500/20 rounded-lg p-4 border border-blue-500/50">
            <h4 className="text-sm font-bold text-blue-300 mb-3">📊 Trend Analysis</h4>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between">
                <span>Status:</span>
                <span style={{ color: analysis.trendColor }}>{analysis.trend}</span>
              </div>
              <div className="flex justify-between">
                <span>RSI (14):</span>
                <span>{analysis.rsi}</span>
              </div>
              <div className="flex justify-between">
                <span>Volatility:</span>
                <span>{analysis.volatility}%</span>
              </div>
            </div>
          </div>

          <div className="bg-purple-500/20 rounded-lg p-4 border border-purple-500/50">
            <h4 className="text-sm font-bold text-purple-300 mb-3">🎯 Support & Resistance</h4>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between">
                <span>Resistance:</span>
                <span className="text-red-400">${analysis.resistance}</span>
              </div>
              <div className="flex justify-between">
                <span>Current:</span>
                <span className="text-yellow-400">${analysis.currentPrice}</span>
              </div>
              <div className="flex justify-between">
                <span>Support:</span>
                <span className="text-green-400">${analysis.support}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white/5 rounded-lg p-4 border border-white/10 overflow-x-auto">
        <ComposedChart width={1000} height={400} data={displayData} margin={{ top: 20, right: 30, left: 60, bottom: 60 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
          <XAxis
            dataKey="time"
            tick={{ fill: "#999", fontSize: 11 }}
            angle={-45}
            textAnchor="end"
            height={80}
            interval={Math.max(0, Math.floor(displayData.length / 8))}
          />
          <YAxis tick={{ fill: "#999", fontSize: 11 }} width={60} domain={["dataMin - 0.000001", "dataMax + 0.000001"]} />

          {analysis && (
            <>
              <ReferenceLine y={parseFloat(analysis.resistance)} stroke="#ef4444" strokeDasharray="5 5" />
              <ReferenceLine y={parseFloat(analysis.support)} stroke="#10b981" strokeDasharray="5 5" />
            </>
          )}

          <Tooltip
            contentStyle={{
              backgroundColor: "rgba(0,0,0,0.9)",
              border: "2px solid #fbbf24",
              borderRadius: "8px",
              padding: "12px",
            }}
            content={({ active, payload }) => {
              if (active && payload && payload[0]) {
                const d = payload[0].payload;
                return (
                  <div className="text-xs space-y-1">
                    <p className="text-yellow-400">{d.time}</p>
                    <p className="text-green-400">O: ${d.open.toFixed(8)}</p>
                    <p className="text-blue-400">H: ${d.high.toFixed(8)}</p>
                    <p className="text-red-400">L: ${d.low.toFixed(8)}</p>
                    <p className="text-yellow-400">C: ${d.close.toFixed(8)}</p>
                    <p className="text-gray-300">V: {d.volume.toFixed(2)}</p>
                  </div>
                );
              }
              return null;
            }}
          />

          {chartSettings.showVolume && (
            <Bar dataKey="volume" fill="rgba(251,191,36,0.2)" isAnimationActive={false} yAxisId="left" />
          )}

          <Line
            dataKey="close"
            stroke={chartSettings.upColor}
            strokeWidth={2}
            dot={(props) => {
              const { cx, cy, payload } = props;
              if (!payload) return null;
              return (
                <circle
                  cx={cx}
                  cy={cy}
                  r={2.5}
                  fill={payload.isUp ? chartSettings.upColor : chartSettings.downColor}
                  opacity={0.7}
                />
              );
            }}
            isAnimationActive={false}
          />
        </ComposedChart>
      </div>

      <div className="bg-white/5 rounded p-3 border border-white/10 text-xs text-gray-400">
        <p>🎨 Colors | 📈 7-Second Candlesticks | {displayData.length} Data Points</p>
      </div>
    </div>
  );
};

export default CandlestickChart;
