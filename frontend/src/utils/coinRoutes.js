// The pages of /icaneracoin. Each bottom-bar icon (and each header link) opens its own page at its own address, so the
// browser's Back button, a shared link and a refresh all land where the visitor expects. Pure: no React, no window.

export const COIN_BASE = '/icaneracoin';

// view id -> address segment ('' is the chart, the page's front door)
export const COIN_VIEWS = {
  chart: '',
  analysis: 'analysis',
  sectors: 'data',
  tokens: 'stable',
  learn: 'learn',
};

const BY_SEGMENT = Object.fromEntries(Object.entries(COIN_VIEWS).map(([view, seg]) => [seg, view]));

export const pathForView = (view) => {
  const seg = COIN_VIEWS[view];
  return seg ? `${COIN_BASE}/${seg}` : COIN_BASE;
};

// '/icaneracoin/data/' -> 'sectors'; anything unknown falls back to the chart
export const viewFromPath = (pathname) => {
  const m = String(pathname || '').match(/^\/icaneracoin(?:\/([^/]+))?\/?$/i);
  return (m && BY_SEGMENT[(m[1] || '').toLowerCase()]) || 'chart';
};

// Whether an address is one of this page's own (main.jsx mounts the page for these)
export const isCoinPath = (pathname) => /^\/icaneracoin(?:\/(?:analysis|data|stable|learn))?\/?$/i.test(String(pathname || ''));

export const VIEW_TITLES = {
  chart: 'icaneracoin (ICAN) Price Chart — Live Candlestick Chart & Analysis | IcanEra',
  analysis: 'icaneracoin (ICAN) Chart Analysis — Trend, RSI & Moving Averages | IcanEra',
  sectors: 'Sector Coins — Business Data Indices on icaneracoin | IcanEra',
  tokens: 'icaneracoin on-chain & Stable Coins | IcanEra',
  learn: 'About icaneracoin (ICAN) — How It Works | IcanEra',
};
