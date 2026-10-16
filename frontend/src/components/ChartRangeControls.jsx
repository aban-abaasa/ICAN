import React, { useCallback, useEffect, useRef, useState } from 'react';
import { monthEnabled, monthName } from '../utils/chartRanges';

// Controls for the trading chart's period buttons, built for a 320px-wide phone:
//  - ChartScrollStrip: one row that scrolls sideways (swipe or drag) instead of overflowing the screen, fades at whichever
//    edge has more, and keeps the chosen button centred so it is never hidden off-screen.
//  - ChartPeriodPicker: "which year?" -- big tap targets for every year with data, then the whole year or one month of it.
// Colours come in as the chart's palette `c` (plain hex), like the rest of the chart.

export const ChartScrollStrip = ({ activeKey, children, className = '' }) => {
  const ref = useRef(null);
  const [edge, setEdge] = useState({ left: false, right: false });

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const left = el.scrollLeft > 2;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
    setEdge((prev) => (prev.left === left && prev.right === right ? prev : { left, right }));
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    let ro = null;
    if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(measure); ro.observe(el); }
    return () => { el.removeEventListener('scroll', measure); if (ro) ro.disconnect(); };
  }, [measure]);

  // Bring the chosen button to the middle of the strip.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const active = el.querySelector('[data-active="true"]');
    if (active && typeof el.scrollTo === 'function') {
      const left = active.offsetLeft - (el.clientWidth - active.offsetWidth) / 2;
      el.scrollTo({ left: Math.max(0, left), behavior: 'smooth' });
    }
    measure();
  }, [activeKey, measure]);

  const fade = `linear-gradient(to right, ${edge.left ? 'transparent 0, #000 18px' : '#000 0'}, ${edge.right ? '#000 calc(100% - 22px), transparent 100%' : '#000 100%'})`;
  return (
    <div
      ref={ref}
      className={`scrollbar-none relative overflow-x-auto overscroll-x-contain ${className}`}
      style={{ WebkitMaskImage: fade, maskImage: fade, WebkitOverflowScrolling: 'touch' }}
    >
      {children}
    </div>
  );
};

// `active` is the key of the chosen range ('y2025', 'm2025-03', ...). onPick receives ('year', year) or ('month', year, month).
export const ChartPeriodPicker = ({ c, years, firstTime, active, onPick, onClose, now = Date.now() }) => {
  const activeYear = (() => {
    const m = /^[ym](\d{4})/.exec(active || '');
    return m ? Number(m[1]) : null;
  })();
  const [focus, setFocus] = useState(activeYear || years[0]);
  const btn = (on, off) => ({
    borderColor: on ? c.chipOnBorder : c.chipOffBorder,
    background: on ? c.tabOnBg : 'transparent',
    color: on ? c.tabOnText : off ? c.chipOffText : c.fg,
    opacity: off ? 0.45 : 1,
  });
  const wholeYearOn = active === `y${focus}`;

  return (
    <>
      <div className="absolute inset-0 z-[19]" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-label="Pick a year or month"
        className="absolute left-2 top-[52px] z-20 max-h-[calc(100%-60px)] w-[min(24rem,calc(100%-1rem))] overflow-y-auto rounded-xl border p-3 shadow-xl"
        style={{ background: c.sheet, borderColor: c.cardBorder, color: c.fg }}
      >
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-bold uppercase tracking-wide" style={{ color: c.muted }}>Year</p>
          <button type="button" onClick={onClose} className="-mr-1 min-h-[36px] rounded-md px-3 text-xs font-semibold" style={{ color: c.soft }}>Done</button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {years.map((y) => (
            <button
              key={y}
              type="button"
              aria-pressed={focus === y}
              onClick={() => { setFocus(y); onPick('year', y); }}
              className="min-h-[44px] min-w-[68px] rounded-md border px-3 text-sm font-semibold tabular-nums"
              style={btn(focus === y && activeYear === y)}
            >
              {y}
            </button>
          ))}
        </div>

        <p className="mb-2 mt-4 text-xs font-bold uppercase tracking-wide" style={{ color: c.muted }}>{focus} by month</p>
        <div className="grid grid-cols-4 gap-1.5">
          <button
            type="button"
            onClick={() => onPick('year', focus)}
            className="col-span-4 min-h-[44px] rounded-md border px-3 text-sm font-semibold"
            style={btn(wholeYearOn)}
          >
            Whole year {focus}
          </button>
          {Array.from({ length: 12 }, (_, m) => {
            const ok = monthEnabled(focus, m, firstTime, now);
            return (
              <button
                key={m}
                type="button"
                disabled={!ok}
                aria-pressed={active === `m${focus}-${String(m + 1).padStart(2, '0')}`}
                onClick={() => onPick('month', focus, m)}
                className="min-h-[44px] rounded-md border px-1 text-sm font-semibold"
                style={btn(active === `m${focus}-${String(m + 1).padStart(2, '0')}`, !ok)}
              >
                {monthName(m)}
              </button>
            );
          })}
        </div>
        <p className="mt-3 text-[11px] leading-4" style={{ color: c.muted }}>
          Candle size fits your screen: a year reads best in daily or weekly candles, a month in hourly or 4-hour ones. Months with no data are greyed out.
        </p>
      </div>
    </>
  );
};
