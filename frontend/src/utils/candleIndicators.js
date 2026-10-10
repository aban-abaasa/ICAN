// Chart-analysis maths for the icaneracoin candlestick chart. Pure functions so the in-app chart
// (CandlestickChart), the public /icaneracoin page and the landing-page chart all read the same numbers.

// `data` is an array of { open, high, low, close } candles, oldest first. Returns null when there are
// fewer than two candles (nothing to analyse yet). Numeric fields come back as strings, as the chart
// has always consumed them.
export const calculateIndicators = (data) => {
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
  // No losses in the window: RSI is 100 if the price only rose, and a neutral 50 if it never moved (a quiet
  // market repeats the same price, which must not read as "overbought").
  const rsi = avgLoss === 0 ? (avgGain === 0 ? 50 : 100) : 100 - 100 / (1 + avgGain / avgLoss);

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
  let trend = 'Neutral', trendColor = '#eab308';
  if (priceChange > 0) {
    trend = 'Bullish 📈';
    trendColor = '#10b981';
  } else if (priceChange < 0) {
    trend = 'Bearish 📉';
    trendColor = '#ef4444';
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

// RSI read-out in plain words (the conventional 70 / 30 bands).
export const describeRsi = (rsi) => {
  const value = Number(rsi);
  if (!Number.isFinite(value)) return { label: 'n/a', tone: 'neutral' };
  if (value >= 70) return { label: 'Overbought', tone: 'down' };
  if (value <= 30) return { label: 'Oversold', tone: 'up' };
  return { label: 'Neutral', tone: 'neutral' };
};

// One honest sentence about what the numbers say, for people (and search engines) who do not read
// indicators. `windowLabel` names the span the candles cover, e.g. "the last 8 hours".
export const summarizeAnalysis = (analysis, { windowLabel = 'the loaded period', candleCount = 0 } = {}) => {
  if (!analysis) return 'There are not enough candles yet to analyse the icaneracoin chart.';
  const momentum = Number(analysis.momentum);
  const direction = momentum > 0 ? 'risen' : momentum < 0 ? 'fallen' : 'moved sideways';
  const move = momentum === 0 ? '' : ` ${Math.abs(momentum).toFixed(2)}%`;
  const rsi = describeRsi(analysis.rsi);
  const ma = Number(analysis.currentPrice) >= Number(analysis.ma20) ? 'above' : 'below';
  return `Over ${windowLabel} (${candleCount} candles) the icaneracoin price has ${direction}${move}. `
    + `RSI is ${analysis.rsi} (${rsi.label.toLowerCase()}) and the price is trading ${ma} its 20-candle moving average.`;
};

// "the last 8 hours" / "the last 45 minutes" for the span the candles cover, from their open/close times.
export const describeCandleWindow = (candles) => {
  if (!candles || candles.length === 0) return 'the loaded period';
  const start = new Date(candles[0].open_time).getTime();
  const end = new Date(candles[candles.length - 1].close_time || candles[candles.length - 1].open_time).getTime();
  const minutes = Math.round((end - start) / 60000);
  if (!Number.isFinite(minutes) || minutes < 1) return 'the loaded period';
  if (minutes < 90) return `the last ${minutes} minutes`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `the last ${hours} hours`;
  return `the last ${Math.round(hours / 24)} days`;
};
