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
  const sign = n < 0 ? '-' : '';
  const round1 = (x) => Math.round(x * 10) / 10;
  const clean = (x) => (Number.isInteger(x) ? x.toFixed(0) : x.toFixed(1));
  if (v >= 1_000_000_000_000) return `${sign}${clean(round1(v / 1_000_000_000_000))}T`;
  if (v >= 1_000_000_000) return `${sign}${clean(round1(v / 1_000_000_000))}B`;
  if (v >= 1_000_000) return `${sign}${clean(round1(v / 1_000_000))}M`;
  if (v >= 1_000) return `${sign}${clean(round1(v / 1_000))}K`;
  return `${sign}${v.toFixed(0)}`;
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
    <div className="bg-slate-800 border border-slate-700 rounded-md px-3 py-2 shadow-lg text-xs">
      <p className="text-slate-400 font-semibold mb-1">{fmtLabel(label, granularity)}</p>
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
    // Four independent containers -- header, presets, chart, totals --
    // stacked as siblings, each carrying its own accent color
    // (blue/purple/orange/pink, see .dash-card-* in index.css) instead of
    // a single flat bg-slate-900 surface. Plain slate/gray Tailwind
    // classes get force-flattened to one color by ThemeContext's dynamic
    // override stylesheet, which is why this used to render as identical
    // colorless white/gray boxes in every theme -- dash-card tints the
    // theme's own CSS vars instead of fighting that override, so each
    // panel keeps its identity in light, dark, and every custom theme.
    // Income/expense/net keep their existing semantic colors
    // (green/gold/icy-blue) since those are meaningful, not decor.
    <div className="space-y-3">
      <div className="dash-card dash-card-blue flex items-center justify-between gap-2 px-4 py-3">
        <div className="flex items-center gap-2 min-w-0">
          {canGoBack && (
            <button
              type="button"
              onClick={onBack}
              className="shrink-0 p-1 -ml-1 rounded hover:bg-white/10 text-slate-300"
              aria-label="Back"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
          )}
          <Activity className="w-4 h-4 shrink-0" style={{ color: '#3b82f6' }} />
          <h3 className="text-[11px] font-semibold uppercase tracking-wide truncate" style={{ color: 'var(--color-textSecondary)' }}>{title}</h3>
        </div>
        {hasActivity && (
          <span className={`flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded border shrink-0 ${
            trendPct > 0 ? 'text-emerald-400 border-emerald-500/30' : trendPct < 0 ? 'text-red-400 border-red-500/30' : 'text-slate-400 border-slate-600'
          }`}>
            {trendPct > 0 ? <TrendingUp className="w-3 h-3" /> : trendPct < 0 ? <TrendingDown className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
            {Math.abs(trendPct).toFixed(0)}%
          </span>
        )}
      </div>

      {/* Range presets — years of history, one tap away */}
      {onPresetChange && (
        <div className="dash-card dash-card-purple p-3">
          <div className="flex items-center gap-1.5">
            <div className="flex items-center gap-1 bg-white/5 border border-white/10 rounded-lg p-0.5 flex-1">
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => onPresetChange(p.id)}
                  className={`flex-1 py-1 rounded-md text-[10px] font-bold transition ${
                    activePreset === p.id ? 'bg-blue-700 text-white shadow' : 'text-slate-400 hover:text-slate-200'
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
                className="shrink-0 p-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-300 hover:bg-white/10"
                aria-label="Zoom out to full range"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {rangeLabel && (
            <p className="text-[10px] text-slate-500 mt-2">
              {rangeLabel}
              {drillable && ' · tap a point to zoom in'}
            </p>
          )}
        </div>
      )}

      <div className="dash-card dash-card-orange p-4">
        {loading ? (
          <div className="h-48 flex items-center justify-center text-slate-500 text-xs">Loading activity…</div>
        ) : !hasActivity ? (
          <div className="h-48 flex flex-col items-center justify-center gap-2 text-center">
            <Activity className="w-8 h-8 text-slate-700" />
            <p className="text-xs text-slate-500">No transactions recorded in this period yet.</p>
          </div>
        ) : (
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 320, height: 192 }}>
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
                  tick={{ fill: '#64748b', fontSize: 10 }}
                  axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                  tickLine={false}
                />
                <YAxis tickFormatter={fmtShort} tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} width={40} />
                <Tooltip content={<CustomTooltip granularity={granularity} />} cursor={{ stroke: 'rgba(255,255,255,0.15)' }} />
                <Legend
                  wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
                  formatter={(value) => <span className="text-slate-300">{value}</span>}
                />
                <Line type="monotone" dataKey="income" name="Income" stroke={CHART_COLORS.income} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                <Line type="monotone" dataKey="expense" name="Expense" stroke={CHART_COLORS.expense} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                <Line type="monotone" dataKey="net" name="Net" stroke={CHART_COLORS.net} strokeWidth={2} dot={<DiamondDot />} activeDot={{ r: 5 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {hasActivity && !loading && (
        <div className="dash-card dash-card-pink grid grid-cols-3 gap-2 p-3">
          <div className="text-center min-w-0">
            <p className="font-bold text-sm tabular-nums whitespace-nowrap" style={{ color: CHART_COLORS.income }}>{fmtShort(totalIncome)}</p>
            <p className="text-[10px] text-slate-500">Income</p>
          </div>
          <div className="text-center min-w-0">
            <p className="font-bold text-sm tabular-nums whitespace-nowrap" style={{ color: CHART_COLORS.expense }}>{fmtShort(totalExpense)}</p>
            <p className="text-[10px] text-slate-500">Expense</p>
          </div>
          <div className="text-center min-w-0">
            <p className="font-bold text-sm tabular-nums whitespace-nowrap" style={{ color: CHART_COLORS.net }}>
              {totalNet >= 0 ? '+' : ''}{fmtShort(totalNet)}
            </p>
            <p className="text-[10px] text-slate-500">Net</p>
          </div>
        </div>
      )}
    </div>
  );
}
