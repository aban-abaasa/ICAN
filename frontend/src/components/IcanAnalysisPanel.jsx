import React from 'react';
import { describeRsi } from '../utils/candleIndicators';

const fmt = (value, digits = 2) => {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: digits }) : '—';
};

const TONE = {
  up: 'text-emerald-500',
  down: 'text-red-500',
  neutral: '',
};

// The numbers behind the candlestick chart, labelled in plain words. Presentational only: pass the result of
// calculateIndicators(). `dark` picks the palette so it sits on both the dark public page and the landing page.
const IcanAnalysisPanel = ({ analysis, dark = true, compact = false }) => {
  if (!analysis) {
    return (
      <p className={`text-sm ${dark ? 'text-slate-400' : 'text-slate-500'}`}>
        Chart analysis appears once there are at least two candles.
      </p>
    );
  }

  const rsi = describeRsi(analysis.rsi);
  const momentum = Number(analysis.momentum);
  const items = [
    {
      label: 'Trend',
      value: analysis.trend.replace(/\s*[^\w\s].*$/u, '').trim(),
      color: analysis.trendColor,
    },
    { label: 'Momentum', value: `${momentum > 0 ? '+' : ''}${analysis.momentum}%`, tone: momentum > 0 ? 'up' : momentum < 0 ? 'down' : 'neutral' },
    { label: 'RSI (14)', value: analysis.rsi, hint: rsi.label, tone: rsi.tone },
    { label: 'Channel support', value: `UGX ${fmt(analysis.support)}`, tone: 'up' },
    { label: 'Channel resistance', value: `UGX ${fmt(analysis.resistance)}`, tone: 'down' },
    { label: 'MA 20', value: `UGX ${fmt(analysis.ma20)}` },
    { label: 'MA 50', value: `UGX ${fmt(analysis.ma50)}` },
    { label: 'Period high', value: `UGX ${fmt(analysis.highPrice)}` },
    { label: 'Period low', value: `UGX ${fmt(analysis.lowPrice)}` },
  ].slice(0, compact ? 5 : 9);

  return (
    <dl className={`grid gap-2 ${compact ? 'grid-cols-2 sm:grid-cols-5' : 'grid-cols-2 sm:grid-cols-3'}`}>
      {items.map((item) => (
        <div
          key={item.label}
          className={`rounded-lg border px-3 py-2.5 ${dark ? 'border-slate-700/60 bg-slate-900/70' : 'border-slate-200 bg-white'}`}
        >
          <dt className={`text-[11px] font-semibold uppercase tracking-wide ${dark ? 'text-slate-400' : 'text-slate-500'}`}>{item.label}</dt>
          <dd
            className={`mt-0.5 text-sm font-bold tabular-nums ${item.color ? '' : TONE[item.tone] || (dark ? 'text-slate-100' : 'text-slate-900')}`}
            style={item.color ? { color: item.color } : undefined}
          >
            {item.value}
            {item.hint && <span className={`ml-1.5 text-[11px] font-semibold ${dark ? 'text-slate-400' : 'text-slate-500'}`}>{item.hint}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
};

export default IcanAnalysisPanel;
