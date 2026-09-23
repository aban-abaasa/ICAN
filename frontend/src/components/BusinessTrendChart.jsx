import React, { useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { TrendingUp, TrendingDown, Minus, LineChart as LineChartIcon, ShieldCheck } from 'lucide-react';

// Same clean-abbreviation rule as the CMMS activity widget: K/M/B/T, no
// trailing ".0" on round values, never CSS-truncated.
const fmtUgx = (n) => {
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

const fmtDay = (isoDate) => new Date(isoDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  const price = payload[0]?.value || 0;
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-md px-3 py-2 shadow-lg text-xs">
      <p className="text-slate-400 font-semibold mb-1">{fmtDay(label)}</p>
      <p className="text-rose-300">Share price: UGX {fmtUgx(price)}</p>
    </div>
  );
};

/**
 * Real daily business trend chart, fed by Pitchin's
 * pitchin_share_value_snapshots via getSharePriceHistory() — one point per
 * day the business's live valuation was actually computed. Never fabricated:
 * shows an honest empty state until snapshots exist for this business.
 * Wine/burgundy accent -- ownership & equity, distinct from CMMS's indigo
 * and the ledger chart's navy, on the same flat dark-panel design used
 * across the dashboard's stat cards.
 */
export default function BusinessTrendChart({ data = [], loading = false, businessName = 'Business' }) {
  const { latest, changePct, verified, hasData } = useMemo(() => {
    if (!data.length) return { latest: null, changePct: 0, verified: false, hasData: false };
    const last = data[data.length - 1];
    return {
      latest: last.share_price_ugx,
      changePct: last.price_change_pct || 0,
      verified: Boolean(last.blockchain_verified),
      hasData: true,
    };
  }, [data]);

  const chartData = useMemo(
    () => data.map((d) => ({ date: d.snapshot_date, price: Number(d.share_price_ugx) || 0 })),
    [data]
  );

  return (
    // dash-card-pink (see index.css) instead of a flat bg-slate-900 --
    // plain slate classes get force-flattened to one color by
    // ThemeContext's dynamic override stylesheet, which is why this used
    // to render as a colorless white/gray box in every theme.
    <div className="dash-card dash-card-pink" style={{ paddingTop: 0 }}>
      <div className="flex items-center justify-between gap-2 px-4 pt-3.5 pb-3 border-b" style={{ borderColor: 'var(--color-border)' }}>
        <div className="flex items-center gap-2 min-w-0">
          <LineChartIcon className="w-4 h-4 flex-shrink-0" style={{ color: '#ec4899' }} />
          <h3 className="text-[11px] font-semibold uppercase tracking-wide truncate" style={{ color: 'var(--color-textSecondary)' }}>{businessName} — Share Trend</h3>
        </div>
        {hasData && (
          <span className={`flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded border flex-shrink-0 ${
            changePct > 0 ? 'text-emerald-400 border-emerald-500/30' : changePct < 0 ? 'text-red-400 border-red-500/30' : 'text-slate-400 border-slate-600'
          }`}>
            {changePct > 0 ? <TrendingUp className="w-3 h-3" /> : changePct < 0 ? <TrendingDown className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
            {changePct > 0 ? '+' : ''}{changePct.toFixed(1)}%
          </span>
        )}
      </div>

      <div className="px-4 py-4">
        {loading ? (
          <div className="h-40 flex items-center justify-center text-slate-500 text-xs">Loading valuation history…</div>
        ) : !hasData ? (
          <div className="h-40 flex flex-col items-center justify-center gap-2 text-center px-4">
            <LineChartIcon className="w-8 h-8 text-slate-700" />
            <p className="text-xs text-slate-500">No daily valuation snapshots yet for this business — the trend will appear once Pitchin computes its first live share value.</p>
          </div>
        ) : (
          <>
            <div className="flex items-baseline gap-2 mb-2 min-w-0">
              <span className="text-xl font-bold text-white leading-none tabular-nums whitespace-nowrap">UGX {fmtUgx(latest)}</span>
              <span className="text-[11px] text-slate-400">per share</span>
              {verified && (
                <span className="ml-auto flex items-center gap-1 text-[10px] text-emerald-400 flex-shrink-0">
                  <ShieldCheck className="w-3 h-3" /> Verified
                </span>
              )}
            </div>
            <div className="h-32">
              <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 320, height: 128 }}>
                <AreaChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="businessTrendFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#e11d48" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#e11d48" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={fmtDay}
                    interval={Math.max(0, Math.floor(chartData.length / 5) - 1)}
                    tick={{ fill: '#64748b', fontSize: 10 }}
                    axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                    tickLine={false}
                  />
                  <YAxis tickFormatter={fmtUgx} tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} width={44} domain={['auto', 'auto']} />
                  <Tooltip content={<CustomTooltip />} cursor={{ stroke: 'rgba(255,255,255,0.15)' }} />
                  <Area type="monotone" dataKey="price" stroke="#e11d48" strokeWidth={2} fill="url(#businessTrendFill)" dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
