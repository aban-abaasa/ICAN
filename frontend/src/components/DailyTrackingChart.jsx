import React, { useMemo, useState, useEffect } from 'react';
import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts';
import { TrendingUp, TrendingDown, ChevronLeft, ZoomOut } from 'lucide-react';

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

// Bucket keys are LOCAL-time strings from VelocityEngine.bucketKey():
// 'YYYY' | 'YYYY-MM' | 'YYYY-MM-DD' | 'YYYY-MM-DDTHH' | 'YYYY-MM-DDTHH:mm'.
// `new Date('2026-10-03')` would parse as UTC and land on the wrong day
// west of Greenwich, so build the Date from its parts instead.
const parseKey = (key) => {
  const [datePart, timePart] = String(key).split('T');
  const [y, m = 1, d = 1] = datePart.split('-').map(Number);
  const [hh = 0, mm = 0] = (timePart || '').split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm);
};

const time = (d) => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const day = (d) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

// Short label for an axis tick, shaped by the current resolution.
const fmtTick = (key, granularity) => {
  if (!key) return '';
  const d = parseKey(key);
  if (granularity === 'yearly') return String(d.getFullYear());
  if (granularity === 'monthly') return d.toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
  if (granularity === 'hourly') return d.getHours() === 0 ? day(d) : d.toLocaleTimeString(undefined, { hour: 'numeric' });
  if (granularity === 'minutely') return time(d);
  return day(d);
};

// Long label for the readout above the graph.
const fmtFull = (key, granularity) => {
  if (!key) return '';
  const d = parseKey(key);
  if (granularity === 'yearly') return String(d.getFullYear());
  if (granularity === 'monthly') return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  if (granularity === 'hourly') return `${day(d)} · ${d.toLocaleTimeString(undefined, { hour: 'numeric' })}`;
  if (granularity === 'minutely') return `${day(d)} · ${time(d)}`;
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
};

// The resolution is the unit you read the graph in. Tapping one jumps to a
// window sized for it (see VelocityEngine.getPresetRange).
export const RESOLUTIONS = [
  { id: 'minute', label: 'Min', granularity: 'minutely' },
  { id: 'hour', label: 'Hour', granularity: 'hourly' },
  { id: 'day', label: 'Day', granularity: 'daily' },
  { id: 'month', label: 'Month', granularity: 'monthly' },
  { id: 'year', label: 'Year', granularity: 'yearly' },
];

const CHART_COLORS = {
  income: '#22c55e',   // classic green
  expense: '#eab308',  // gold / yellow
  net: '#a5f3fc',       // diamond classic (icy blue-white)
};

const DiamondDot = ({ cx, cy }) => {
  if (cx == null || cy == null) return null;
  const r = 3.5;
  return (
    <path
      d={`M ${cx} ${cy - r} L ${cx + r} ${cy} L ${cx} ${cy + r} L ${cx - r} ${cy} Z`}
      fill={CHART_COLORS.net}
      stroke="#ffffff"
      strokeWidth={0.75}
    />
  );
};

// Only draw a marker per point while there are few enough for it to read.
const MAX_DOTS = 40;

/**
 * Bare cash-flow graph — no cards, no boxes. Fed by VelocityEngine.getRangeSeries()
 * (a zero-filled continuous timeline, never synthesized data).
 *
 * Reading it:
 *  - Min / Hour / Day / Month / Year tabs set the resolution and its window.
 *  - Drag a finger across the graph and the readout above follows it.
 *  - Tap a point to pin it; tap the same point again to zoom into that bucket
 *    one level finer (year → month → day → hour → minute). Back / zoom-out
 *    arrows retrace the trail.
 */
export default function DailyTrackingChart({
  data = [],
  loading = false,
  title = 'Financial Trends',
  granularity = 'daily',
  onPresetChange = null,
  rangeLabel = null,
  canGoBack = false,
  onBack = null,
  onReset = null,
  onDrill = null,
}) {
  const [hoverIdx, setHoverIdx] = useState(null);
  const [pinnedIdx, setPinnedIdx] = useState(null);

  // A new window/resolution invalidates any selected point.
  useEffect(() => {
    setHoverIdx(null);
    setPinnedIdx(null);
  }, [data]);

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

  const drillable = typeof onDrill === 'function' && granularity !== 'minutely';

  // Recharts hands mouse/touch handlers the active point as an index (v3) or
  // only as its x-axis label; resolve either to an index into `data`.
  const indexFromState = (state) => {
    const raw = state?.activeTooltipIndex ?? state?.activeIndex;
    const n = raw == null ? NaN : Number(raw);
    if (Number.isFinite(n) && data[n]) return n;
    const byLabel = data.findIndex((d) => d.date === state?.activeLabel);
    return byLabel >= 0 ? byLabel : null;
  };

  const handleMove = (state) => setHoverIdx(indexFromState(state));
  const handleLeave = () => setHoverIdx(null);

  const handleClick = (state) => {
    const idx = indexFromState(state);
    if (idx == null) return;
    if (drillable && idx === pinnedIdx && data[idx]?.bucketStart) {
      onDrill(data[idx]);
      return;
    }
    setPinnedIdx(idx);
  };

  const shownIdx = hoverIdx ?? pinnedIdx;
  const shown = shownIdx != null ? data[shownIdx] : null;
  const income = shown ? shown.income || 0 : totalIncome;
  const expense = shown ? shown.expense || 0 : totalExpense;
  const net = shown ? shown.net || 0 : totalNet;
  const readoutLabel = shown ? fmtFull(shown.date, granularity) : title;
  const hint = shown && drillable && shownIdx === pinnedIdx
    ? 'Tap again to zoom in'
    : (!shown && rangeLabel ? rangeLabel : '');

  const activeResolution = RESOLUTIONS.find((r) => r.granularity === granularity)?.id;

  return (
    <div>
      {/* Readout — plain text that follows your finger across the graph */}
      <div className="flex items-start justify-between gap-2 px-1">
        <div className="min-w-0">
          <div className="flex items-center gap-1">
            {canGoBack && (
              <button
                type="button"
                onClick={onBack}
                className="shrink-0 -ml-1 p-0.5 rounded text-slate-300 hover:bg-white/10"
                aria-label="Back"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
            )}
            <p className="text-[11px] font-semibold uppercase tracking-wide truncate" style={{ color: 'var(--color-textSecondary)' }}>
              {readoutLabel}
            </p>
          </div>
          {hasActivity && !loading && (
            <p className="mt-0.5 font-bold text-2xl tabular-nums leading-tight" style={{ color: CHART_COLORS.net }}>
              {net >= 0 ? '+' : ''}{fmtShort(net)}
            </p>
          )}
          {hasActivity && !loading && (
            <p className="mt-0.5 flex items-center gap-3 text-[11px] tabular-nums">
              <span style={{ color: CHART_COLORS.income }}>● In {fmtShort(income)}</span>
              <span style={{ color: CHART_COLORS.expense }}>● Out {fmtShort(expense)}</span>
            </p>
          )}
          {hint && <p className="mt-0.5 text-[10px] text-slate-500">{hint}</p>}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {canGoBack && onReset && (
            <button
              type="button"
              onClick={onReset}
              className="p-1 rounded text-slate-300 hover:bg-white/10"
              aria-label="Zoom out to full range"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
          )}
          {hasActivity && !loading && (
            <span className={`flex items-center gap-0.5 text-[11px] font-semibold ${
              trendPct > 0 ? 'text-emerald-400' : trendPct < 0 ? 'text-red-400' : 'text-slate-400'
            }`}>
              {trendPct > 0 && <TrendingUp className="w-3 h-3" />}
              {trendPct < 0 && <TrendingDown className="w-3 h-3" />}
              {trendPct !== 0 && `${Math.abs(trendPct).toFixed(0)}%`}
            </span>
          )}
        </div>
      </div>

      {/* The graph itself */}
      <div className="h-64 mt-2 -mx-1 select-none">
        {loading ? (
          <div className="h-full flex items-center justify-center text-slate-500 text-xs">Loading activity…</div>
        ) : !hasActivity ? (
          <div className="h-full flex items-center justify-center text-center">
            <p className="text-xs text-slate-500">No transactions recorded in this period yet.</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 320, height: 256 }}>
            <ComposedChart
              data={data}
              accessibilityLayer={false}
              margin={{ top: 8, right: 8, left: 8, bottom: 0 }}
              onMouseMove={handleMove}
              onMouseLeave={handleLeave}
              onClick={handleClick}
              style={drillable ? { cursor: 'pointer' } : undefined}
            >
              <defs>
                <linearGradient id="trendNetFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={CHART_COLORS.net} stopOpacity={0.28} />
                  <stop offset="100%" stopColor={CHART_COLORS.net} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={(key) => fmtTick(key, granularity)}
                interval="preserveStartEnd"
                minTickGap={36}
                tick={{ fill: '#64748b', fontSize: 10 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis hide domain={['auto', 'auto']} />
              <ReferenceLine y={0} stroke="rgba(255,255,255,0.12)" />
              {/* Values live in the readout above, so the tooltip draws only the cursor line + active dots */}
              <Tooltip content={() => null} cursor={{ stroke: 'rgba(255,255,255,0.25)' }} />
              <Area type="monotone" dataKey="net" stroke="none" fill="url(#trendNetFill)" isAnimationActive={false} activeDot={false} />
              <Line type="monotone" dataKey="income" name="Income" stroke={CHART_COLORS.income} strokeWidth={1.5} dot={false} activeDot={{ r: 3.5 }} />
              <Line type="monotone" dataKey="expense" name="Expense" stroke={CHART_COLORS.expense} strokeWidth={1.5} dot={false} activeDot={{ r: 3.5 }} />
              <Line
                type="monotone"
                dataKey="net"
                name="Net"
                stroke={CHART_COLORS.net}
                strokeWidth={2.5}
                dot={data.length <= MAX_DOTS ? <DiamondDot /> : false}
                activeDot={{ r: 5 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Resolution — plain text tabs, no boxes */}
      {onPresetChange && (
        <div className="flex items-center justify-between px-2 mt-1">
          {RESOLUTIONS.map((r) => {
            const active = activeResolution === r.id;
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => onPresetChange(r.id)}
                className={`flex-1 py-2 text-xs font-bold transition border-b-2 ${
                  active ? 'text-white border-sky-300' : 'text-slate-500 border-transparent hover:text-slate-300'
                }`}
              >
                {r.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
