import React, { useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { TrendingUp, TrendingDown, Minus, LineChart as LineChartIcon, ShieldCheck } from 'lucide-react';

const fmtUgx = (n) => {
  const v = Math.abs(n || 0);
  if (v >= 1_000_000) return `${n < 0 ? '-' : ''}${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `${n < 0 ? '-' : ''}${(v / 1_000).toFixed(1)}K`;
  return `${n < 0 ? '-' : ''}${v.toFixed(0)}`;
};

const fmtDay = (isoDate) => new Date(isoDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  const price = payload[0]?.value || 0;
  return (
    <div className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 shadow-xl text-xs">
      <p className="text-gray-300 font-semibold mb-1">{fmtDay(label)}</p>
      <p className="text-purple-300">Share price: UGX {fmtUgx(price)}</p>
    </div>
  );
};

/**
 * Real daily business trend chart, fed by Pitchin's
 * pitchin_share_value_snapshots via getSharePriceHistory() — one point per
 * day the business's live valuation was actually computed. Never fabricated:
 * shows an honest empty state until snapshots exist for this business.
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
    <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <LineChartIcon className="w-4 h-4 text-purple-400" />
          <h3 className="text-sm font-bold text-white truncate">{businessName} — Share Trend</h3>
        </div>
        {hasData && (
          <div className={`flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full flex-shrink-0 ${
            changePct > 0 ? 'bg-emerald-500/15 text-emerald-400' : changePct < 0 ? 'bg-red-500/15 text-red-400' : 'bg-gray-500/15 text-gray-400'
          }`}>
            {changePct > 0 ? <TrendingUp className="w-3 h-3" /> : changePct < 0 ? <TrendingDown className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
            {changePct > 0 ? '+' : ''}{changePct.toFixed(1)}%
          </div>
        )}
      </div>

      {loading ? (
        <div className="h-40 flex items-center justify-center text-gray-500 text-xs">Loading valuation history…</div>
      ) : !hasData ? (
        <div className="h-40 flex flex-col items-center justify-center gap-2 text-center px-4">
          <LineChartIcon className="w-8 h-8 text-gray-600" />
          <p className="text-xs text-gray-500">No daily valuation snapshots yet for this business — the trend will appear once Pitchin computes its first live share value.</p>
        </div>
      ) : (
        <>
          <div className="flex items-baseline gap-2 mb-2">
            <span className="text-xl font-bold text-white">UGX {fmtUgx(latest)}</span>
            <span className="text-xs text-gray-500">per share</span>
            {verified && (
              <span className="ml-auto flex items-center gap-1 text-[10px] text-emerald-400">
                <ShieldCheck className="w-3 h-3" /> Verified
              </span>
            )}
          </div>
          <div className="h-32">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="businessTrendFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#a855f7" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#a855f7" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
                <XAxis
                  dataKey="date"
                  tickFormatter={fmtDay}
                  interval={Math.max(0, Math.floor(chartData.length / 5) - 1)}
                  tick={{ fill: '#9ca3af', fontSize: 10 }}
                  axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                  tickLine={false}
                />
                <YAxis tickFormatter={fmtUgx} tick={{ fill: '#9ca3af', fontSize: 10 }} axisLine={false} tickLine={false} width={44} domain={['auto', 'auto']} />
                <Tooltip content={<CustomTooltip />} cursor={{ stroke: 'rgba(255,255,255,0.15)' }} />
                <Area type="monotone" dataKey="price" stroke="#a855f7" strokeWidth={2} fill="url(#businessTrendFill)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </div>
  );
}
