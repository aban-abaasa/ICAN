import React, { useId } from 'react';
import {
  Sunrise, Dumbbell, Target, Users, BookOpen, ClipboardCheck, Heart, Moon, Sparkles, Plus, Minus,
} from 'lucide-react';
import {
  CATEGORIES, DAY_SHORT, PILLARS, formatClock, fromMinutes, toMinutes, formatRange,
} from '../../../utils/growthOptimizer';

export const CATEGORY_ICONS = {
  spiritual: Sunrise,
  physical: Dumbbell,
  high_value_work: Target,
  networking: Users,
  learning: BookOpen,
  review: ClipboardCheck,
  family: Heart,
  rest: Moon,
  custom: Sparkles,
};

export const pillarOf = (category) => CATEGORIES[category]?.pillar || 'none';
export const categoryLabel = (category) => CATEGORIES[category]?.label || 'Custom';

const DAY_INITIAL = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
// Monday first reads naturally for a working week.
export const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

export function ScoreRing({ value, label }) {
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - Math.min(100, Math.max(0, value)) / 100);
  return (
    <div className="gr-ring" role="img" aria-label={`${label}: ${value} out of 100`}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle className="gr-ring__track" cx="50" cy="50" r={radius} />
        <circle className="gr-ring__value" cx="50" cy="50" r={radius}
          strokeDasharray={circumference} strokeDashoffset={offset} />
      </svg>
      <div className="gr-ring__num" aria-hidden="true">{value}<small>of 100</small></div>
    </div>
  );
}

export function PillarBars({ breakdown }) {
  return (
    <div className="gr-pillars">
      {Object.entries(PILLARS).map(([key, { label }]) => (
        <div className="gr-pillar" data-pillar={key} key={key}>
          <div className="gr-pillar__name"><i className="gr-dot" /><span>{label}</span></div>
          <div className="gr-bar" role="presentation"><i style={{ width: `${breakdown[key]}%` }} /></div>
          <div className="gr-pillar__pct">{breakdown[key]}</div>
        </div>
      ))}
    </div>
  );
}

/** Seven round day toggles, Monday first. */
export function DayChips({ value, onChange, label = 'Days of the week', disabled = false }) {
  const toggle = (day) => {
    const next = value.includes(day) ? value.filter((d) => d !== day) : [...value, day];
    onChange(next.sort((a, b) => a - b));
  };
  return (
    <div className="gr-days" role="group" aria-label={label}>
      {DAY_ORDER.map((day) => (
        <button key={day} type="button" className="gr-day" aria-pressed={value.includes(day)}
          aria-label={DAY_SHORT[day]} disabled={disabled} onClick={() => toggle(day)}>
          {DAY_SHORT[day]}
        </button>
      ))}
    </div>
  );
}

/** Compact read-only strip showing which days a block runs. */
export function DayDots({ days }) {
  return (
    <span className="gr-dots" aria-label={`Runs on ${days.map((d) => DAY_SHORT[d]).join(', ')}`} role="img">
      {DAY_ORDER.map((day) => <i key={day} className={days.includes(day) ? 'on' : ''}>{DAY_INITIAL[day]}</i>)}
    </span>
  );
}

export function Field({ label, hint, children, htmlFor }) {
  return (
    <div className="gr-field">
      <label className="gr-label" htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && <p className="gr-hint">{hint}</p>}
    </div>
  );
}

/** Tap-friendly numeric control: 44px buttons either side of the value. */
export function Stepper({ label, value, onChange, min, max, step = 1, unit, hint }) {
  const id = useId();
  const clamp = (n) => Math.min(max, Math.max(min, n));
  return (
    <div className="gr-field">
      <span className="gr-label" id={`${id}-l`}>{label}</span>
      <div className="gr-stepper" role="group" aria-labelledby={`${id}-l`}>
        <button type="button" aria-label={`Decrease ${label}`} disabled={value <= min}
          onClick={() => onChange(clamp(value - step))}><Minus size={16} /></button>
        <output aria-live="polite">{value}{unit && <small> {unit}</small>}</output>
        <button type="button" aria-label={`Increase ${label}`} disabled={value >= max}
          onClick={() => onChange(clamp(value + step))}><Plus size={16} /></button>
      </div>
      {hint && <p className="gr-hint">{hint}</p>}
    </div>
  );
}

export function Switch({ checked, onChange, children }) {
  return (
    <label className="gr-switch">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <i aria-hidden="true" />
      <span>{children}</span>
    </label>
  );
}

export function Segmented({ label, value, onChange, options }) {
  return (
    <div className="gr-seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}{o.hint && <small>{o.hint}</small>}
        </button>
      ))}
    </div>
  );
}

/**
 * Seven-column week view for tablet and desktop. `blocks` need
 * { id?, title, category, startTime, durationMinutes, daysOfWeek, paused? }.
 */
export function WeekGrid({ blocks, today = new Date().getDay() }) {
  const HOUR = 38;
  const starts = blocks.map((b) => toMinutes(b.startTime));
  const ends = blocks.map((b) => toMinutes(b.startTime) + b.durationMinutes);
  if (!blocks.length) return null;
  const from = Math.max(0, Math.floor((Math.min(...starts) - 30) / 60));
  const to = Math.min(24, Math.ceil((Math.max(...ends) + 30) / 60));
  const hours = Array.from({ length: to - from + 1 }, (_, i) => from + i);
  const height = (to - from) * HOUR;
  return (
    <div className="gr-week" role="group" aria-label="Week at a glance">
      <div className="gr-week__grid" style={{ '--gr-hour': `${HOUR}px` }}>
        <div className="gr-week__head" />
        {DAY_ORDER.map((d) => (
          <div key={d} className={`gr-week__head ${d === today ? 'is-today' : ''}`}>{DAY_SHORT[d]}</div>
        ))}
        <div className="gr-week__axis" style={{ height }}>
          {hours.map((h) => (
            <span key={h} style={{ top: (h - from) * HOUR }}>{formatClock(fromMinutes(h * 60)).replace(':00', '')}</span>
          ))}
        </div>
        {DAY_ORDER.map((d) => (
          <div key={d} className={`gr-week__col ${d === today ? 'is-today' : ''}`} style={{ height }}>
            {blocks.filter((b) => b.daysOfWeek.includes(d)).map((b) => {
              const top = ((toMinutes(b.startTime) - from * 60) / 60) * HOUR;
              const h = Math.max(16, (b.durationMinutes / 60) * HOUR - 2);
              return (
                <div key={`${b.id || b.title}-${b.startTime}`} data-pillar={pillarOf(b.category)}
                  className={`gr-evt ${b.paused ? 'is-paused' : ''}`} style={{ top, height: h }}
                  title={`${b.title}, ${formatRange(b.startTime, b.durationMinutes)}`}>
                  {b.title}
                  {h > 30 && <small>{formatClock(b.startTime)}</small>}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
