import React, { useCallback, useState } from 'react';
import { LINE_KINDS, LINE_DASHES, LINE_WIDTHS, LINE_COLORS, sanitizeLineStyles } from '../utils/lineStyles';

// How the trading lines on the icaneracoin chart look. Each kind of line -- Buy (price you bought at),
// Sell (price you sold at), Booked (your resting orders) and Live (the current price) -- can be restyled:
// colour, solid / dashed / dotted, and thickness. Saved on this device.

const KEY = 'ican_chart_lines';

const load = () => {
  try { return sanitizeLineStyles(JSON.parse(localStorage.getItem(KEY))); } catch { return sanitizeLineStyles(null); }
};

export const useLineStyles = () => {
  const [styles, setStyles] = useState(load);
  const update = useCallback((kind, patch) => {
    setStyles((prev) => {
      const next = sanitizeLineStyles({ ...prev, [kind]: { ...prev[kind], ...patch } });
      try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* not remembered */ }
      return next;
    });
  }, []);
  const reset = useCallback(() => {
    const next = sanitizeLineStyles(null);
    setStyles(next);
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  }, []);
  return { lineStyles: styles, updateLineStyle: update, resetLineStyles: reset };
};

const dashPreview = (style, color, width) => {
  const dash = { solid: 'none', dashed: '6 4', dotted: '1.5 4', long: '12 5' }[style];
  return (
    <svg width="46" height="12" aria-hidden="true">
      <line x1="2" y1="6" x2="44" y2="6" stroke={color} strokeWidth={width} strokeDasharray={dash === 'none' ? undefined : dash} strokeLinecap={style === 'dotted' ? 'round' : 'butt'} />
    </svg>
  );
};

// The editor shown in the chart's tools menu. `c` is the chart palette (light or dark).
export const LineStyleEditor = ({ lineStyles, onChange, onReset, c }) => {
  const [open, setOpen] = useState('buy');
  const chipStyle = (on) => ({
    border: `1px solid ${on ? c.chipOnBorder : c.chipOffBorder}`,
    background: on ? c.chipOnBg : 'transparent',
    color: on ? c.chipOnText : c.chipOffText,
  });
  return (
    <div className="space-y-2" aria-label="Line looks">
      {LINE_KINDS.map(({ id, label, hint }) => {
        const look = lineStyles[id];
        const isOpen = open === id;
        return (
          <div key={id} className="rounded-lg border" style={{ borderColor: c.cardBorder }}>
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() => setOpen(isOpen ? '' : id)}
              className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
            >
              {dashPreview(look.style, look.color, look.width)}
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-semibold" style={{ color: c.strong }}>{label} line</span>
                <span className="block text-[11px]" style={{ color: c.muted }}>{hint}</span>
              </span>
              <span aria-hidden="true" style={{ color: c.muted }}>{isOpen ? '▾' : '▸'}</span>
            </button>
            {isOpen && (
              <div className="space-y-2.5 border-t px-3 py-3" style={{ borderColor: c.cardBorder }}>
                <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={`${label} colour`}>
                  {LINE_COLORS.map((col) => (
                    <button
                      key={col}
                      type="button"
                      aria-label={`Colour ${col}`}
                      aria-pressed={look.color === col}
                      onClick={() => onChange(id, { color: col })}
                      className="h-7 w-7 rounded-full"
                      style={{ background: col, outline: look.color === col ? `2px solid ${c.strong}` : '1px solid rgba(148,163,184,0.5)', outlineOffset: look.color === col ? 2 : 0 }}
                    />
                  ))}
                  <label className="ml-1 inline-flex items-center gap-1 text-[11px]" style={{ color: c.muted }}>
                    <input type="color" value={look.color} onChange={(e) => onChange(id, { color: e.target.value })} aria-label={`${label} custom colour`} className="h-7 w-9 cursor-pointer rounded border-0 bg-transparent p-0" />
                    Custom
                  </label>
                </div>
                <div className="flex flex-wrap gap-1.5" role="group" aria-label={`${label} style`}>
                  {LINE_DASHES.map((d) => (
                    <button key={d.id} type="button" aria-pressed={look.style === d.id} onClick={() => onChange(id, { style: d.id })} className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-semibold" style={chipStyle(look.style === d.id)}>
                      {dashPreview(d.id, look.style === d.id ? c.chipOnText : c.chipOffText, 2)}
                      {d.label}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-1.5" role="group" aria-label={`${label} thickness`}>
                  <span className="mr-1 text-[11px]" style={{ color: c.muted }}>Thickness</span>
                  {LINE_WIDTHS.map((w) => (
                    <button key={w} type="button" aria-pressed={look.width === w} onClick={() => onChange(id, { width: w })} className="h-8 w-9 rounded-md text-[11px] font-semibold" style={chipStyle(look.width === w)}>
                      {w}px
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
      <button type="button" onClick={onReset} className="text-[11px] font-semibold underline" style={{ color: c.soft }}>Reset to default looks</button>
    </div>
  );
};
