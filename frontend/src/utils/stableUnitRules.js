// Pure rules for the in-system ICEC-S screen. No network, no React, no clock. The money itself only ever moves through
// public.ican_stable_swap, which prices, converts and checks everything on the server; these helpers decide what to ASK it,
// what to PREVIEW and how to describe what it answered. Every preview rounds DOWN exactly as the server does, so the
// screen never promises more than a swap will give.

const scaled = (n) => Number((Number(n) * 1e8).toFixed(4));
export const floor8 = (n) => Math.floor(scaled(n)) / 1e8;
const floorDp = (n, dp) => { const k = 10 ** dp; return Math.floor(Number((Number(n) * k).toFixed(4))) / k; };
const positive = (n) => Number.isFinite(Number(n)) && Number(n) > 0;

export const trim = (n, max = 6) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return v.toLocaleString('en-US', { maximumFractionDigits: max, minimumFractionDigits: 0 });
};

// The decimal places a currency really has (the database cuts amounts the same way): yen, won, dong, rupiah and the CFA francs
// have none, dinars have three, everything else two (UGX stays at two, as the wallets already hold it).
const NO_DECIMALS = new Set(['JPY', 'KRW', 'VND', 'IDR', 'CLP', 'PYG', 'ISK', 'XAF', 'XOF', 'XPF', 'RWF', 'BIF', 'DJF', 'GNF', 'KMF', 'VUV']);
const THREE_DECIMALS = new Set(['KWD', 'BHD', 'OMR', 'JOD', 'TND', 'IQD', 'LYD']);
export const currencyDecimals = (code) => {
  const c = String(code || '').toUpperCase();
  return NO_DECIMALS.has(c) ? 0 : THREE_DECIMALS.has(c) ? 3 : 2;
};

// Money as a person reads it, in their own currency: the right symbol and decimals (a value under one shows four places, so a
// pound's worth of ICEC-S reads 0.7562, not 0.76). Falls back to "1,234.50 XYZ" for a code the browser does not know.
export const fmtMoney = (amount, currency, { precise = false, tidy = false } = {}) => {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '—';
  const dp = currencyDecimals(currency);
  // `tidy` (for totals and balances): a thousand or more needs no cents, so UGX 198,999.99 reads UGX 199,000 and fits
  const places = tidy && Math.abs(n) >= 1000 ? 0 : precise && Math.abs(n) < 100 ? Math.max(dp, 4) : dp;
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: String(currency).toUpperCase(), minimumFractionDigits: places, maximumFractionDigits: places }).format(n);
  } catch {
    return `${trim(n, places)} ${currency}`;
  }
};

// ICEC-S units as a person reads them: four places, trimmed (49.468, not 49.46800762); a tiny amount keeps six so it never reads 0.
export const fmtUnits = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return trim(v, Math.abs(v) > 0 && Math.abs(v) < 0.01 ? 6 : 4);
};

// UGX per 1 of a currency, from the quote (the unit's price in UGX and in that currency). null when unknown.
export const rateToUgx = (quote, currency) => {
  if (!quote || !positive(quote.unit_ugx)) return null;
  if (currency === 'UGX') return 1;
  const price = Number(quote.currencies?.[currency]);
  return positive(price) ? Number(quote.unit_ugx) / price : null;
};

// What a BUY of `amount` (in `currency`) gives: there is NO fee for buying, so all of it becomes ICEC-S at the unit's value.
export const previewBuy = ({ amount, currency, quote }) => {
  const rate = rateToUgx(quote, currency);
  if (!positive(amount) || rate == null) return null;
  const local = floorDp(amount, currencyDecimals(currency));
  const gross = floor8(local * rate);
  const fee = 0;
  const net = gross;
  const units = floor8(net / Number(quote.unit_ugx));
  return { local, gross, fee, net, units };
};

// What a SELL of `units` pays into the wallet in `currency`.
export const previewSell = ({ units, currency, quote }) => {
  const rate = rateToUgx(quote, currency);
  if (!positive(units) || rate == null) return null;
  const u = floor8(units);
  const gross = floor8(u * Number(quote.unit_ugx));
  const fee = floor8((gross * Number(quote.sell_fee_bps ?? quote.fee_bps ?? 0)) / 10000);   // the cash-out fee
  const net = gross - fee;
  return { units: u, gross, fee, net, local: floorDp(net / rate, currencyDecimals(currency)) };
};

export const validateBuy = ({ amount, balance, quote, currency }) => {
  if (!positive(amount)) return 'Enter how much to spend.';
  if (Number.isFinite(balance) && Number(amount) > balance + 1e-9) return 'You do not have enough in that wallet.';
  const p = previewBuy({ amount, currency, quote });
  if (!p || p.units <= 0) return 'That amount is too small.';
  if (positive(quote?.max_trade_ugx) && p.gross > Number(quote.max_trade_ugx) + 1e-9) return `The most you can swap at once is UGX ${trim(quote.max_trade_ugx, 0)}.`;
  return null;
};

export const validateSell = ({ units, held, quote, currency }) => {
  if (!positive(units)) return 'Enter how many ICEC-S to sell.';
  if (Number.isFinite(held) && floor8(units) > Number(held) + 1e-9) return 'You do not hold that many.';
  const p = previewSell({ units, currency, quote });
  if (!p || p.local <= 0) return 'That is too small to sell.';
  if (positive(quote?.max_trade_ugx) && p.gross > Number(quote.max_trade_ugx) + 1e-9) return `The most you can swap at once is UGX ${trim(quote.max_trade_ugx, 0)}. Sell in smaller parts.`;
  return null;
};

const MESSAGES = {
  not_signed_in: 'Please sign in.',
  trading_paused: 'ICEC-S is not open for swaps yet.',
  rates_stale: 'The live exchange rates are updating. Please try again in a few minutes.',
  capacity_reached: 'ICEC-S is at capacity right now. Please try again later or with a smaller amount.',
  vault_insufficient: 'ICEC-S cannot pay this out right now. Nothing was sold; please try again later.',
  insufficient_funds: 'You do not have enough in that wallet.',
  insufficient_units: 'You do not hold that many ICEC-S.',
  no_cash_wallet: 'You do not have a wallet in that currency.',
  rate_limited: 'Too many swaps in a minute. Please wait a moment.',
};
export const friendlyStableError = (result) => {
  if (!result) return 'The swap failed. Please try again.';
  if (result.code === 'price_moved') {
    return result.unit_ugx != null
      ? `The value moved to UGX ${trim(result.unit_ugx, 2)} while you were swapping. Review it and try again.`
      : 'The value moved while you were swapping. Review it and try again.';
  }
  return result.error || MESSAGES[result.code] || 'The swap failed. Please try again.';
};

export const mapSwapResult = (data) => {
  if (!data || data.success !== true) {
    return { success: false, code: data?.code, error: data?.error || 'Swap failed', unit_ugx: data?.unit_ugx != null ? Number(data.unit_ugx) : undefined };
  }
  const num = (v) => (v == null ? null : Number(v));
  return {
    success: true, side: data.side, units: num(data.units), unitUgx: num(data.unit_ugx), grossUgx: num(data.gross_ugx), feeUgx: num(data.fee_ugx),
    netUgx: num(data.net_ugx), payCurrency: data.pay_currency, payAmount: num(data.pay_amount), newUnits: num(data.new_units),
    newLocalBalance: num(data.new_local_balance), duplicate: data.duplicate === true,
  };
};

// The recorded values of one ICEC-S, a point a minute for the last day then a point an hour (newest first, { t, v }) -> rows the
// analysis chart reads (oldest first). Each point opens where the last one closed, so the chart is continuous; a point that is
// not a positive number is dropped, not drawn.
export const historyToRows = (history) => {
  const pts = [...(history || [])].reverse()
    .map((h) => ({ t: h?.t, v: Number(h?.v) }))
    .filter((h) => h.t && Number.isFinite(Date.parse(h.t)) && h.v > 0);
  return pts.map((p, i) => {
    const open = i === 0 ? p.v : pts[i - 1].v;
    return { open_time: p.t, open_price: open, high_price: Math.max(open, p.v), low_price: Math.min(open, p.v), close_price: p.v, trading_volume: 0 };
  });
};

// How old the rates are, in words, and whether that is too old to trade on.
export const rateAge = (updatedAt, now = Date.now()) => {
  const ms = now - Date.parse(updatedAt);
  if (!Number.isFinite(ms) || ms < 0) return 'just now';
  const m = Math.round(ms / 60000);
  if (m < 2) return 'just now';
  if (m < 90) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 36 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
};
