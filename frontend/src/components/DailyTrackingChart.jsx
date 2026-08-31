import React, { useMemo } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { TrendingUp, TrendingDown, Minus, Activity, ChevronLeft, ZoomOut } from 'lucide-react';

const fmtShort = (n) => {
  const v = Math.abs(n || 0);
  if (v >= 1_000_000) return `${n < 0 ? '-' : ''}${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${n < 0 ? '-' : ''}${(v / 1_000).toFixed(0)}K`;
  return `${n < 0 ? '-' : ''}${v.toFixed(0)}`;
};

// Bucket-key → axis tick / tooltip label, shaped by the chart's current
// granularity so a 5-year "All" view reads in years while a drilled-in week
// still reads in days.
const fmtLabel = (key, granularity) => {
  if (!key) return '';
  if (granularity === 'yearly') return key;
  if (granularity === 'monthly') {
    const [y, m] = key.split('-');
    return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
  }
  const d = new Date(key);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

export const PRESETS = [
  { id: '1m', label: '1M' },
  { id: '3m', label: '3M' },
  { id: '1y', label: '1Y' },
  { id: '5y', label: '5Y' },
  { id: 'all', label: 'All' },
];

const CHART_COLORS = {
  income: '#22c55e',   // classic green
  expense: '#eab308',  // gold / yellow
  net: '#a5f3fc',       // diamond classic (icy blue-white)
};

const DiamondDot = ({ cx, cy }) => {
  if (cx == null || cy == null) return null;
  const r = 4;
  return (
    <path
      d={`M ${cx} ${cy - r} L ${cx + r} ${cy} L ${cx} ${cy + r} L ${cx - r} ${cy} Z`}
      fill={CHART_COLORS.net}
      stroke="#ffffff"
      strokeWidth={0.75}
    />
  );
};

const CustomTooltip = ({ active, payload, label, granularity }) => {
  if (!active || !payload?.length) return null;
  const income = payload.find((p) => p.dataKey === 'income')?.value || 0;
  const expense = payload.find((p) => p.dataKey === 'expense')?.value || 0;
  const net = payload.find((p) => p.dataKey === 'net')?.value ?? income - expense;
  return (
    <div className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 shadow-xl text-xs">
      <p className="text-gray-300 font-semibold mb-1">{fmtLabel(label, granularity)}</p>
      <p style={{ color: CHART_COLORS.income }}>Income: {fmtShort(income)}</p>
      <p style={{ color: CHART_COLORS.expense }}>Expense: {fmtShort(expense)}</p>
      <p style={{ color: CHART_COLORS.net }}>Net: {net >= 0 ? '+' : ''}{fmtShort(net)}</p>
    </div>
  );
};

/**
 * Real income/expense/net cash-flow chart, fed by VelocityEngine.getRangeSeries()
 * — a zero-filled continuous timeline, never synthesized data. Bucket size
 * (day/week/month/year) adapts to how wide the selected range is, so the same
 * chart works whether it's showing a week or five years of history. Tapping a
 * point on a zoomed-out view drills into that bucket at finer granularity.
 */
export default function DailyTrackingChart({
  data = [],
  loading = false,
  title = 'Financial Trends',
  granularity = 'daily',
  activePreset = null,
  onPresetChange = null,
  rangeLabel = null,
  canGoBack = false,
  onBack = null,
  onReset = null,
  onDrill = null,
}) {
  const { totalIncome, totalExpense, totalNet, trendPct, hasActivity } = useMemo(() => {
    const inc = data.reduce((s, d) => s + (d.income || 0), 0);
    const exp = data.reduce((s, d) => s + (d.expense || 0), 0);
    const half = Math.floor(data.length / 2);
    const firstHalfNet = data.slice(0, half).reduce((s, d) => s + (d.net || 0), 0);
    const secondHalfNet = data.slice(half).reduce((s, d) => s + (d.net || 0), 0);
    const pct = firstHalfNet !== 0 ? ((secondHalfNet - firstHalfNet) / Math.abs(firstHalfNet)) * 100 : (secondHalfNet > 0 ? 100 : 0);
    return {
      totalIncome: inc,
      totalExpense: exp,
      totalNet: inc - exp,
      trendPct: pct,
      hasActivity: inc > 0 || exp > 0,
    };
  }, [data]);

  const drillable = typeof onDrill === 'function' && granularity !== 'daily';

  const handleChartClick = (chartState) => {
    if (!drillable) return;
    const point = chartState?.activePayload?.[0]?.payload;
    if (point?.bucketStart) onDrill(point);
  };

  return (
    <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 min-w-0">
          {canGoBack && (
            <button
              type="button"
              onClick={onBack}
              className="shrink-0 p-1 -ml-1 rounded-lg hover:bg-white/10 text-gray-300"
              aria-label="Back"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
          )}
          <Activity className="w-4 h-4 text-blue-400 shrink-0" />
          <h3 className="text-sm font-bold text-white truncate">{title}</h3>
        </div>
        {hasActivity && (
          <div className={`flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full shrink-0 ${
            trendPct > 0 ? 'bg-emerald-500/15 text-emerald-400' : trendPct < 0 ? 'bg-red-500/15 text-red-400' : 'bg-gray-500/15 text-gray-400'
          }`}>
            {trendPct > 0 ? <TrendingUp className="w-3 h-3" /> : trendPct < 0 ? <TrendingDown className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
            {Math.abs(trendPct).toFixed(0)}%
          </div>
        )}
      </div>

      {/* Range presets — years of history, one tap away */}
      {onPresetChange && (
        <div className="flex items-center gap-1.5 mb-3">
          <div className="flex items-center gap-1 bg-white/5 border border-white/10 rounded-lg p-0.5 flex-1">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => onPresetChange(p.id)}
                className={`flex-1 py-1 rounded-md text-[10px] font-bold transition ${
                  activePreset === p.id ? 'bg-blue-600 text-white shadow' : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          {canGoBack && onReset && (
            <button
              type="button"
              onClick={onReset}
              className="shrink-0 p-1.5 rounded-lg bg-white/5 border border-white/10 text-gray-300 hover:bg-white/10"
              aria-label="Zoom out to full range"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      {rangeLabel && (
        <p className="text-[10px] text-gray-500 mb-2 -mt-1">
          {rangeLabel}
          {drillable && ' · tap a point to zoom in'}
        </p>
      )}

      {loading ? (
        <div className="h-48 flex items-center justify-center text-gray-500 text-xs">Loading activity…</div>
      ) : !hasActivity ? (
        <div className="h-48 flex flex-col items-center justify-center gap-2 text-center">
          <Activity className="w-8 h-8 text-gray-600" />
          <p className="text-xs text-gray-500">No transactions recorded in this period yet.</p>
        </div>
      ) : (
        <>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={data}
                margin={{ top: 4, right: 4, left: -16, bottom: 0 }}
                onClick={handleChartClick}
                style={drillable ? { cursor: 'pointer' } : undefined}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
                <XAxis
                  dataKey="date"
                  tickFormatter={(key) => fmtLabel(key, granularity)}
                  interval={Math.max(0, Math.floor(data.length / 6) - 1)}
                  tick={{ fill: '#9ca3af', fontSize: 10 }}
                  axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                  tickLine={false}
                />
                <YAxis tickFormatter={fmtShort} tick={{ fill: '#9ca3af', fontSize: 10 }} axisLine={false} tickLine={false} width={40} />
                <Tooltip content={<CustomTooltip granularity={granularity} />} cursor={{ stroke: 'rgba(255,255,255,0.15)' }} />
                <Legend
                  wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
                  formatter={(value) => <span className="text-gray-300">{value}</span>}
                />
                <Line type="monotone" dataKey="income" name="Income" stroke={CHART_COLORS.income} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                <Line type="monotone" dataKey="expense" name="Expense" stroke={CHART_COLORS.expense} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                <Line type="monotone" dataKey="net" name="Net" stroke={CHART_COLORS.net} strokeWidth={2} dot={<DiamondDot />} activeDot={{ r: 5 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-slate-700/50">
            <div className="text-center">
              <p className="font-bold text-sm" style={{ color: CHART_COLORS.income }}>{fmtShort(totalIncome)}</p>
              <p className="text-[10px] text-gray-500">Income</p>
            </div>
            <div className="text-center">
              <p className="font-bold text-sm" style={{ color: CHART_COLORS.expense }}>{fmtShort(totalExpense)}</p>
              <p className="text-[10px] text-gray-500">Expense</p>
            </div>
            <div className="text-center">
              <p className="font-bold text-sm" style={{ color: CHART_COLORS.net }}>
                {totalNet >= 0 ? '+' : ''}{fmtShort(totalNet)}
              </p>
              <p className="text-[10px] text-gray-500">Net</p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
