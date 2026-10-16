// Pure helpers for the trading chart's history ranges: which period a button means, how big a candle to draw it in so
// it stays readable on a narrow screen, and the years / months a visitor can pick. No DOM, no network.

export const DAY = 86400;

// Candle sizes the server is asked for, smallest first (5 min .. 1 week).
const BUCKETS = [300, 900, 3600, 14400, 43200, 86400, 172800, 604800];
const BUCKET_NAMES = { 60: '1m', 300: '5m', 900: '15m', 3600: '1H', 14400: '4H', 43200: '12H', 86400: '1D', 172800: '2D', 604800: '1W' };

// The smallest candle that keeps `spanSeconds` within `targetBars` candles (a phone is given fewer, so bodies stay wide
// enough to read). Never below `minBucket`.
export const bucketFor = (spanSeconds, targetBars, minBucket = 300) => {
  const span = Math.max(1, Number(spanSeconds) || 1);
  return BUCKETS.find((b) => b >= minBucket && span / b <= targetBars) || BUCKETS[BUCKETS.length - 1];
};

export const bucketName = (seconds) => BUCKET_NAMES[seconds] || `${Math.round(seconds / 60)}m`;

export const targetBars = (narrow) => (narrow ? 160 : 400);

// The rolling ranges: they always end now. `days` is the period asked for.
export const ROLLING_RANGES = [
  { key: '1w', label: '1W', title: 'Last week', days: 7 },
  { key: '1m', label: '1M', title: 'Last month', days: 30 },
  { key: '3m', label: '3M', title: 'Last 3 months', days: 90 },
  { key: '1y', label: '1Y', title: 'Last year', days: 365 },
  { key: 'all', label: 'All', title: 'Everything', days: 3650 },
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const monthName = (m) => MONTHS[m] || '';

// A range the chart can fetch: { key, label, title, from: Date, to: Date, bucket, rolling }.
// `key` is the identity of the choice ('1y', 'y2025', 'm2025-03'): it does not change as time passes.
const make = (key, label, title, from, to, rolling, narrow, minBucket) => {
  const bucket = bucketFor((to - from) / 1000, targetBars(narrow), minBucket);
  return { key, label, title, from, to, rolling, bucket };
};

export const rollingRange = (key, now = Date.now(), narrow = false, minBucket = 300) => {
  const r = ROLLING_RANGES.find((x) => x.key === key);
  if (!r) return null;
  return make(r.key, r.label, r.title, new Date(now - r.days * DAY * 1000), new Date(now), true, narrow, minBucket);
};

// A whole calendar year (to now, if it is the current one) in the visitor's own time zone.
export const yearRange = (year, now = Date.now(), narrow = false, minBucket = 300) => {
  const from = new Date(year, 0, 1);
  const end = new Date(year + 1, 0, 1);
  const to = end.getTime() > now ? new Date(now) : end;
  return make(`y${year}`, String(year), `All of ${year}`, from, to, end.getTime() > now, narrow, minBucket);
};

// One calendar month (month is 0-11).
export const monthRange = (year, month, now = Date.now(), narrow = false, minBucket = 300) => {
  const from = new Date(year, month, 1);
  const end = new Date(year, month + 1, 1);
  const to = end.getTime() > now ? new Date(now) : end;
  return make(`m${year}-${String(month + 1).padStart(2, '0')}`, `${monthName(month)} ${year}`, `${monthName(month)} ${year}`, from, to, end.getTime() > now, narrow, minBucket);
};

// Rebuild a range from the key a button stored, e.g. after the screen was resized or to refresh a rolling one.
export const rangeFromKey = (key, now = Date.now(), narrow = false, minBucket = 300) => {
  if (!key || key === 'live') return null;
  const y = /^y(\d{4})$/.exec(key);
  if (y) return yearRange(Number(y[1]), now, narrow, minBucket);
  const m = /^m(\d{4})-(\d{2})$/.exec(key);
  if (m) return monthRange(Number(m[1]), Number(m[2]) - 1, now, narrow, minBucket);
  return rollingRange(key, now, narrow, minBucket);
};

// The years that can be picked, newest first: from the first year with data to this one. Without known bounds, this
// year and the one before. Capped so a bad bound cannot print a thousand buttons.
export const yearsAvailable = (firstTime, now = Date.now()) => {
  const thisYear = new Date(now).getFullYear();
  const first = firstTime ? new Date(firstTime).getFullYear() : thisYear - 1;
  const from = Number.isFinite(first) ? Math.min(Math.max(first, thisYear - 30), thisYear) : thisYear - 1;
  const out = [];
  for (let y = thisYear; y >= from; y -= 1) out.push(y);
  return out;
};

// Which of the 12 months of `year` can be picked: not in the future, and not before the first data.
export const monthEnabled = (year, month, firstTime, now = Date.now()) => {
  const start = new Date(year, month, 1).getTime();
  if (start > now) return false;
  if (firstTime) {
    const first = new Date(firstTime);
    if (Number.isFinite(first.getTime()) && new Date(year, month + 1, 1).getTime() <= new Date(first.getFullYear(), first.getMonth(), 1).getTime()) return false;
  }
  return true;
};
