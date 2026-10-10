// Pure data + validation for the chart-line look preferences (see components/chartLineStyles.jsx).

export const LINE_KINDS = [
  { id: 'buy', label: 'Buy', hint: 'Prices you bought at' },
  { id: 'sell', label: 'Sell', hint: 'Prices you sold at' },
  { id: 'booking', label: 'Booked', hint: 'Your waiting orders' },
  { id: 'live', label: 'Live', hint: 'The current price' },
];

export const LINE_DASHES = [
  { id: 'solid', label: 'Solid' },
  { id: 'dashed', label: 'Dashed' },
  { id: 'dotted', label: 'Dotted' },
  { id: 'long', label: 'Long' },
];

export const LINE_WIDTHS = [1, 2, 3, 4];

export const LINE_COLORS = ['#22b24c', '#e5233b', '#f59e0b', '#38bdf8', '#a78bfa', '#ec4899', '#f1f5f9', '#64748b'];

export const DEFAULT_LINE_STYLES = {
  buy: { color: '#22b24c', style: 'dashed', width: 1 },
  sell: { color: '#e5233b', style: 'dashed', width: 1 },
  booking: { color: '#f59e0b', style: 'dotted', width: 2 },
  live: { color: '#38bdf8', style: 'dashed', width: 1 },
};

// Keep only values the chart understands, so a stale or hand-edited entry can never break it.
export const sanitizeLineStyles = (raw) => {
  const out = {};
  for (const { id } of LINE_KINDS) {
    const d = DEFAULT_LINE_STYLES[id];
    const r = raw && typeof raw === 'object' ? raw[id] : null;
    out[id] = {
      color: r && /^#[0-9a-f]{6}$/i.test(r.color) ? r.color.toLowerCase() : d.color,
      style: r && LINE_DASHES.some((x) => x.id === r.style) ? r.style : d.style,
      width: r && LINE_WIDTHS.includes(Number(r.width)) ? Number(r.width) : d.width,
    };
  }
  return out;
};
