import React from 'react';
import { RefreshCw } from 'lucide-react';

// Small building blocks for the franchise developer tab. They use the developer panel's own
// theme variables (--dp-*), so they follow its dark/light toggle without any extra wiring.

// NOTE on styling: the app paints every <button>, <input> and <select> with an !important background-colour
// and text colour (index.css), which silently erases any state shown through background-color. State here
// is therefore carried by border-colour, an inset shadow and a background-IMAGE tint, none of which that
// rule touches (the developer panel's own tab bar uses border-colour and a tinted span for the same reason).
export const ACCENT = '#0284c7';
export const tint = (rgb, a = 0.16) => `linear-gradient(rgba(${rgb}, ${a}), rgba(${rgb}, ${a}))`;
export const selectedStyle = { backgroundImage: tint('2,132,199', 0.22), borderColor: ACCENT, boxShadow: `inset 0 -2px 0 ${ACCENT}`, fontWeight: 800 };
export const idleStyle = { borderColor: 'var(--dp-pill-bd)', backgroundImage: 'none', boxShadow: 'none' };

export const card = { background: 'var(--dp-card)', borderColor: 'var(--dp-card-bd)' };
export const fieldStyle = { background: 'var(--dp-input)', borderColor: 'var(--dp-input-bd)', color: 'var(--dp-txt)' };
export const innerStyle = { background: 'var(--dp-inner)', borderColor: 'var(--dp-inner-bd)' };

export const TONE = {
  green: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-500',
  amber: 'border-amber-500/25 bg-amber-500/10 text-amber-500',
  red: 'border-red-500/25 bg-red-500/10 text-red-500',
  blue: 'border-sky-500/25 bg-sky-500/10 text-sky-500',
  slate: 'border-slate-500/25 bg-slate-500/10 text-slate-400',
  violet: 'border-violet-500/25 bg-violet-500/10 text-violet-400',
};

export const Badge = ({ tone = 'slate', children, title }) => (
  <span title={title} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${TONE[tone] || TONE.slate}`}>{children}</span>
);

export const Tile = ({ label, value, sub, color }) => (
  <div className="rounded-2xl border p-4" style={card}>
    <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--dp-muted)' }}>{label}</p>
    <p className="mt-1 text-xl font-black" style={{ color: color || 'var(--dp-txt)' }}>{value}</p>
    {sub && <p className="mt-0.5 text-[11px]" style={{ color: 'var(--dp-sub)' }}>{sub}</p>}
  </div>
);

export const Field = ({ label, hint, children, className = '' }) => (
  <label className={`block ${className}`}>
    <span className="mb-1 block text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--dp-muted)' }}>{label}</span>
    {children}
    {hint && <span className="mt-1 block text-[10px]" style={{ color: 'var(--dp-muted)' }}>{hint}</span>}
  </label>
);

export const Input = React.forwardRef(function Input(props, ref) {
  return <input ref={ref} {...props} className={`w-full rounded-xl border px-3 py-2 text-sm outline-none ${props.className || ''}`} style={{ ...fieldStyle, ...(props.style || {}) }} />;
});
export const Select = ({ children, className = '', ...rest }) => (
  <select {...rest} className={`rounded-xl border px-3 py-2 text-xs outline-none ${className}`} style={fieldStyle}>{children}</select>
);
export const Textarea = (props) => (
  <textarea {...props} className={`w-full rounded-xl border px-3 py-2 text-sm outline-none ${props.className || ''}`} style={fieldStyle} />
);

export const Toggle = ({ label, hint, checked, onChange }) => (
  <div className="flex items-start justify-between gap-3">
    <div>
      <p className="text-xs font-bold" style={{ color: 'var(--dp-txt)' }}>{label}</p>
      {hint && <p className="text-[10px]" style={{ color: 'var(--dp-muted)' }}>{hint}</p>}
    </div>
    <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)}
      className="relative h-6 w-11 shrink-0 rounded-full border transition"
      style={{ backgroundImage: checked ? 'linear-gradient(#10b981, #10b981)' : tint('100,116,139', 0.55), borderColor: checked ? '#059669' : 'rgba(100,116,139,0.7)' }}>
      <span className="absolute top-0.5 h-5 w-5 rounded-full shadow transition-all" style={{ left: checked ? 22 : 2, background: '#ffffff' }} />
    </button>
  </div>
);

const BTN = {
  primary: { backgroundImage: 'linear-gradient(135deg,#06b6d4,#0284c7)', color: '#fff', borderColor: 'transparent' },
  green: { backgroundImage: 'linear-gradient(135deg,#10b981,#059669)', color: '#fff', borderColor: 'transparent' },
  danger: { backgroundImage: tint('239,68,68', 0.14), color: '#ef4444', borderColor: 'rgba(239,68,68,0.6)' },
  quiet: { backgroundImage: 'none', color: 'var(--dp-sub)', borderColor: 'var(--dp-pill-bd)' },
};
export const Btn = ({ kind = 'quiet', busy, disabled, children, ...rest }) => (
  <button type="button" disabled={disabled || busy} {...rest}
    className="inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-bold transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
    style={BTN[kind]}>
    {busy ? <RefreshCw size={11} className="animate-spin" /> : null}{children}
  </button>
);

export const Empty = ({ children }) => (
  <div className="rounded-2xl border p-8 text-center text-xs" style={{ ...card, color: 'var(--dp-muted)' }}>{children}</div>
);

export const Section = ({ title, hint, right, children }) => (
  <div className="rounded-2xl border p-5" style={card}>
    <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--dp-muted)' }}>{title}</p>
        {hint && <p className="mt-0.5 text-[11px]" style={{ color: 'var(--dp-sub)' }}>{hint}</p>}
      </div>
      {right}
    </div>
    {children}
  </div>
);

export const fmtDate = (d) => (d ? new Date(d).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : '-');
export const fmtDateTime = (d) => (d ? new Date(d).toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '-');
export const toDateInput = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');
export const ymd = (d) => d.toISOString().slice(0, 10);

/** Run an async action with a busy flag and a flash message for the result. */
export function useAction(flash) {
  const [busy, setBusy] = React.useState(null);
  const run = React.useCallback(async (key, fn, okMsg) => {
    setBusy(key);
    try {
      const out = await fn();
      if (okMsg) flash(typeof okMsg === 'function' ? okMsg(out) : okMsg);
      return { ok: true, data: out };
    } catch (e) {
      flash(e?.message || 'Something went wrong.', true);
      return { ok: false, error: e };
    } finally {
      setBusy(null);
    }
  }, [flash]);
  return [busy, run];
}
