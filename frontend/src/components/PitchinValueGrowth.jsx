/**
 * PitchinValueGrowth
 *
 * "The ledger of growth" for a PitchIn business: how the real value of one
 * share has moved over time, drawn from the daily snapshots the live valuation
 * already saves (pitchin_share_value_snapshots). Shown to the owner and to
 * shareholders inside PitchinLiveShareValue.
 *
 * - Range tabs (7D / 30D / 90D / 1Y) re-read the snapshots.
 * - The chart is a gold line over parchment with the declared price as a dashed
 *   baseline; hover or touch anywhere to read a day's price.
 * - Three figures answer "has my share actually grown?":
 *     Growth        nominal change over the range
 *     After inflation   the same change with local inflation taken out
 *                   (annual rate pro-rated over the real span — an estimate,
 *                   and labelled as one)
 *     Business value    how much the whole business moved
 * - Today's live price is always appended as the last point, so the chart ends
 *   at what the card above shows even before tonight's snapshot is saved.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { TrendingUp, TrendingDown, Minus, Loader, Sprout } from 'lucide-react';
import { getSharePriceHistory } from '../services/pitchinShareBlockchainService';

const RANGES = [
  { key: '7', label: '7D', days: 7 },
  { key: '30', label: '30D', days: 30 },
  { key: '90', label: '90D', days: 90 },
  { key: '365', label: '1Y', days: 365 }
];

const W = 640;
const H = 250;
const PAD = { top: 18, right: 14, bottom: 28, left: 14 };

const pct = (n) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(2)}%`;
const shortDate = (iso) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const longDate = (iso) => new Date(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

export default function PitchinValueGrowth({
  businessProfileId,
  current,            // { priceUgx, businessValueUgx, declaredPriceUgx }
  fmt,                // UGX -> user's local currency string
  fmtIcan,            // UGX -> "x IcanEra"
  annualInflationPct, // user's country inflation, or null
  refreshToken
}) {
  const [rangeKey, setRangeKey] = useState('30');
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [hoverIdx, setHoverIdx] = useState(null);
  const svgRef = useRef(null);
  const days = RANGES.find((r) => r.key === rangeKey).days;

  useEffect(() => {
    if (!businessProfileId) return undefined;
    let cancelled = false;
    setError('');
    getSharePriceHistory(businessProfileId, days)
      .then((data) => { if (!cancelled) setRows(data); })
      .catch((err) => { if (!cancelled) { setRows([]); setError(err.message || 'Could not load history'); } });
    return () => { cancelled = true; };
  }, [businessProfileId, days, refreshToken]);

  // Daily snapshots + today's live value as the closing point.
  const points = useMemo(() => {
    if (!rows) return [];
    const list = rows
      .map((r) => ({ date: r.snapshot_date, price: parseFloat(r.share_price_ugx), value: parseFloat(r.business_value_ugx) }))
      .filter((p) => Number.isFinite(p.price));
    const today = new Date().toISOString().split('T')[0];
    if (Number.isFinite(current?.priceUgx)) {
      const live = { date: today, price: current.priceUgx, value: Number(current.businessValueUgx) };
      if (list.length && list[list.length - 1].date === today) list[list.length - 1] = live;
      else list.push(live);
    }
    return list;
  }, [rows, current?.priceUgx, current?.businessValueUgx]);

  const stats = useMemo(() => {
    if (points.length < 2) return null;
    const first = points[0];
    const last = points[points.length - 1];
    const growth = first.price > 0 ? ((last.price - first.price) / first.price) * 100 : 0;
    const spanDays = Math.max(1, (new Date(last.date) - new Date(first.date)) / 86400000);
    let real = null;
    if (Number.isFinite(annualInflationPct)) {
      const periodInflation = Math.pow(1 + annualInflationPct / 100, spanDays / 365) - 1;
      real = ((1 + growth / 100) / (1 + periodInflation) - 1) * 100;
    }
    const valueGrowth = first.value > 0 && Number.isFinite(last.value) ? ((last.value - first.value) / first.value) * 100 : null;
    const prices = points.map((p) => p.price);
    return {
      first, last, growth, real, valueGrowth, spanDays: Math.round(spanDays),
      gainUgx: last.price - first.price,
      high: Math.max(...prices), low: Math.min(...prices)
    };
  }, [points, annualInflationPct]);

  // Chart geometry
  const geo = useMemo(() => {
    if (points.length < 2) return null;
    const declared = Number(current?.declaredPriceUgx);
    const all = points.map((p) => p.price).concat(Number.isFinite(declared) && declared > 0 ? [declared] : []);
    let min = Math.min(...all);
    let max = Math.max(...all);
    const padY = (max - min || max * 0.02 || 1) * 0.15;
    min -= padY; max += padY;
    const x = (i) => PAD.left + (i / (points.length - 1)) * (W - PAD.left - PAD.right);
    const y = (v) => PAD.top + ((max - v) / (max - min)) * (H - PAD.top - PAD.bottom);
    const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.price).toFixed(1)}`).join(' ');
    const area = `${line} L${x(points.length - 1).toFixed(1)},${H - PAD.bottom} L${x(0).toFixed(1)},${H - PAD.bottom} Z`;
    const grid = [0, 0.25, 0.5, 0.75, 1].map((t) => PAD.top + t * (H - PAD.top - PAD.bottom));
    return { x, y, line, area, grid, declaredY: Number.isFinite(declared) && declared > 0 ? y(declared) : null };
  }, [points, current?.declaredPriceUgx]);

  const onMove = (e) => {
    if (!geo || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const ratio = (clientX - rect.left) / rect.width;
    const idx = Math.round(((ratio * W - PAD.left) / (W - PAD.left - PAD.right)) * (points.length - 1));
    setHoverIdx(Math.min(points.length - 1, Math.max(0, idx)));
  };

  const up = stats ? stats.growth >= 0 : true;
  const Trend = !stats || stats.growth === 0 ? Minus : up ? TrendingUp : TrendingDown;
  const hover = hoverIdx != null ? points[hoverIdx] : null;
  const hoverLeftPct = hover && geo ? (geo.x(hoverIdx) / W) * 100 : 0;

  return (
    <section className="ls-growth" aria-label="Real value growth">
      <header className="ls-growth__head">
        <div>
          <p className="ls-eyebrow">The ledger of growth</p>
          <h3 className="ls-title">Real value growth</h3>
        </div>
        <div className="ls-tabs" role="tablist" aria-label="Range">
          {RANGES.map((r) => (
            <button
              key={r.key}
              role="tab"
              aria-selected={rangeKey === r.key}
              className={`ls-tab ${rangeKey === r.key ? 'is-active' : ''}`}
              onClick={() => { setRangeKey(r.key); setHoverIdx(null); }}
            >
              {r.label}
            </button>
          ))}
        </div>
      </header>

      {rows === null ? (
        <div className="ls-growth__empty"><Loader size={14} className="animate-spin" /> Reading the ledger…</div>
      ) : !geo || !stats ? (
        <div className="ls-growth__empty">
          <Sprout size={18} />
          <div>
            <strong>The growth line starts here.</strong>
            <span>
              A price is recorded once a day. After the next daily entry you will see how the value of one share
              has grown, before and after inflation.{error ? ` (${error})` : ''}
            </span>
          </div>
        </div>
      ) : (
        <>
          <div className="ls-growth__hero">
            <div className={`ls-growth__pct ${up ? 'is-up' : 'is-down'}`}>
              <Trend size={20} />
              {pct(stats.growth)}
            </div>
            <p className="ls-growth__sentence">
              One share was worth <strong>{fmt(stats.first.price)}</strong> on {shortDate(stats.first.date)} and is worth{' '}
              <strong>{fmt(stats.last.price)}</strong> today —{' '}
              {stats.gainUgx >= 0 ? 'a gain of ' : 'a change of '}
              <strong>{fmt(Math.abs(stats.gainUgx))}</strong> per share
              <span className="ls-muted"> ({fmtIcan(Math.abs(stats.gainUgx))})</span>.
            </p>
          </div>

          <div className="ls-chart" onMouseLeave={() => setHoverIdx(null)}>
            <svg
              ref={svgRef}
              viewBox={`0 0 ${W} ${H}`}
              className="ls-chart__svg"
              onMouseMove={onMove}
              onTouchStart={onMove}
              onTouchMove={onMove}
              role="img"
              aria-label={`Share price over the last ${stats.spanDays} days, ${pct(stats.growth)}`}
            >
              <defs>
                <linearGradient id="ls-area" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#b8913a" stopOpacity="0.34" />
                  <stop offset="100%" stopColor="#b8913a" stopOpacity="0.02" />
                </linearGradient>
              </defs>
              {geo.grid.map((gy, i) => (
                <line key={i} x1={PAD.left} x2={W - PAD.right} y1={gy} y2={gy} className="ls-chart__grid" />
              ))}
              {geo.declaredY != null && (
                <>
                  <line x1={PAD.left} x2={W - PAD.right} y1={geo.declaredY} y2={geo.declaredY} className="ls-chart__declared" />
                  <text x={W - PAD.right} y={geo.declaredY - 5} textAnchor="end" className="ls-chart__label">declared price</text>
                </>
              )}
              <path d={geo.area} fill="url(#ls-area)" />
              <path d={geo.line} className="ls-chart__line" />
              <text x={PAD.left} y={H - 8} className="ls-chart__label">{shortDate(stats.first.date)}</text>
              <text x={W - PAD.right} y={H - 8} textAnchor="end" className="ls-chart__label">Today</text>
              {(hover ? [hoverIdx] : [points.length - 1]).map((i) => (
                <g key={i}>
                  {hover && <line x1={geo.x(i)} x2={geo.x(i)} y1={PAD.top} y2={H - PAD.bottom} className="ls-chart__cross" />}
                  <circle cx={geo.x(i)} cy={geo.y(points[i].price)} r="9" className="ls-chart__halo" />
                  <circle cx={geo.x(i)} cy={geo.y(points[i].price)} r="4.5" className="ls-chart__dot" />
                </g>
              ))}
            </svg>
            {hover && (
              <div
                className="ls-chart__tip"
                style={{ left: `${Math.min(78, Math.max(22, hoverLeftPct))}%` }}
              >
                <span>{longDate(hover.date)}</span>
                <strong>{fmt(hover.price)}</strong>
                <span>{fmtIcan(hover.price)}</span>
              </div>
            )}
          </div>

          <dl className="ls-growth__stats">
            <div>
              <dt>Growth · {stats.spanDays} day{stats.spanDays === 1 ? '' : 's'}</dt>
              <dd className={up ? 'is-up' : 'is-down'}>{pct(stats.growth)}</dd>
            </div>
            <div title="Local inflation, pro-rated over this range, taken out. An estimate.">
              <dt>After inflation <em>(est.)</em></dt>
              <dd className={stats.real == null ? '' : stats.real >= 0 ? 'is-up' : 'is-down'}>
                {stats.real == null ? '—' : pct(stats.real)}
              </dd>
            </div>
            <div>
              <dt>Business value</dt>
              <dd className={stats.valueGrowth == null ? '' : stats.valueGrowth >= 0 ? 'is-up' : 'is-down'}>
                {stats.valueGrowth == null ? '—' : pct(stats.valueGrowth)}
              </dd>
            </div>
            <div>
              <dt>Highest · lowest</dt>
              <dd className="ls-small">{fmt(stats.high)}<br />{fmt(stats.low)}</dd>
            </div>
          </dl>
        </>
      )}
    </section>
  );
}
