// Light / dark colours shared by the public icaneracoin chart and its trade panel. Plain hex on purpose:
// index.css force-maps stock Tailwind colour classes onto theme variables that these standalone pages do not
// have, so nothing here uses them.

export const CHART_PALETTES = {
  dark: {
    text: '#94a3b8', grid: 'rgba(148,163,184,0.06)', axis: 'rgba(71,85,105,0.55)',
    crossLine: 'rgba(148,163,184,0.5)', crossLabel: '#334155',
    up: '#22b24c', down: '#e5233b', upVol: 'rgba(34,178,76,0.35)', downVol: 'rgba(229,35,59,0.35)',
    ma20: '#fbbf24', ma50: '#38bdf8', rsi: '#a78bfa', trend: 'rgba(226,232,240,0.85)',
    base: '#020617', fg: '#cbd5e1', strong: '#f1f5f9', muted: '#64748b', soft: '#94a3b8',
    pos: '#4ade80', neg: '#f87171', live: '#34d399', liveText: '#6ee7b7',
    barBg: 'rgba(2,6,23,0.55)', barBorder: 'rgba(51,65,85,0.5)', tabsBg: '#0f172a', tabOnBg: '#fcd34d', tabOnText: '#020617',
    chipOnBg: '#1e293b', chipOnBorder: '#475569', chipOnText: '#ffffff', chipOffBorder: '#1e293b', chipOffText: '#64748b',
    caption: '#e2e8f0', captionShadow: '0 1px 3px #020617', veil: 'rgba(2,6,23,0.7)', spinTrack: '#334155', spinHead: '#fcd34d',
    // trade panel
    card: 'rgba(15,23,42,0.92)', cardBorder: '#1e293b', field: '#0b1220', fieldBorder: '#334155',
    buy: '#16a34a', buyText: '#ffffff', sell: '#dc2626', sellText: '#ffffff', book: '#f59e0b', bookText: '#1c1204',
    accent: '#fcd34d', accentText: '#020617', warnBg: 'rgba(245,158,11,0.12)', warnBorder: 'rgba(245,158,11,0.45)', warnText: '#fcd34d',
    errBg: 'rgba(248,113,113,0.12)', errText: '#fca5a5', okBg: 'rgba(52,211,153,0.12)', okText: '#6ee7b7', sheet: '#0b1220', scrim: 'rgba(2,6,23,0.7)',
  },
  light: {
    text: '#475569', grid: 'rgba(15,23,42,0.07)', axis: 'rgba(100,116,139,0.35)',
    crossLine: 'rgba(71,85,105,0.55)', crossLabel: '#475569',
    up: '#16a34a', down: '#dc2626', upVol: 'rgba(22,163,74,0.28)', downVol: 'rgba(220,38,38,0.28)',
    ma20: '#d97706', ma50: '#0284c7', rsi: '#7c3aed', trend: 'rgba(51,65,85,0.85)',
    base: '#f8fafc', fg: '#334155', strong: '#0f172a', muted: '#64748b', soft: '#475569',
    pos: '#15803d', neg: '#b91c1c', live: '#10b981', liveText: '#047857',
    barBg: 'rgba(255,255,255,0.7)', barBorder: 'rgba(148,163,184,0.45)', tabsBg: '#e2e8f0', tabOnBg: '#0f172a', tabOnText: '#ffffff',
    chipOnBg: '#e2e8f0', chipOnBorder: '#94a3b8', chipOnText: '#0f172a', chipOffBorder: '#cbd5e1', chipOffText: '#64748b',
    caption: '#1e293b', captionShadow: '0 1px 2px #ffffff', veil: 'rgba(248,250,252,0.75)', spinTrack: '#cbd5e1', spinHead: '#0f172a',
    card: 'rgba(255,255,255,0.96)', cardBorder: '#e2e8f0', field: '#ffffff', fieldBorder: '#cbd5e1',
    buy: '#15803d', buyText: '#ffffff', sell: '#b91c1c', sellText: '#ffffff', book: '#d97706', bookText: '#ffffff',
    accent: '#064e3b', accentText: '#ffffff', warnBg: 'rgba(217,119,6,0.1)', warnBorder: 'rgba(217,119,6,0.4)', warnText: '#92400e',
    errBg: 'rgba(220,38,38,0.08)', errText: '#b91c1c', okBg: 'rgba(22,163,74,0.1)', okText: '#15803d', sheet: '#ffffff', scrim: 'rgba(15,23,42,0.45)',
  },
};
