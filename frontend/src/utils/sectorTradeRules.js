// Pure rules for the Sector Markets screen. No network, no React, no clock: the money itself only ever moves through
// public.ican_sector_trade, which prices, converts and checks everything on the server. These helpers decide what to
// ASK it, what to preview, and how to describe what it answered. Every preview rounds DOWN to 8 decimals exactly as
// the server does, so the screen never promises more than a trade will give.

import { isDrawableCandle } from './feedPolling.js';

export const MAX_DECIMALS = 8;
export const ICEC = 'ICEC';

// Binary floating point makes 9.9 * 1e8 = 989999999.9999999; rounding the scaled number to 4 places first removes that
// noise without ever rounding a real digit up.
const scaled = (n) => Number((Number(n) * 1e8).toFixed(4));
export const floor8 = (n) => Math.floor(scaled(n)) / 1e8;
export const round8 = (n) => Math.round(scaled(n)) / 1e8;

const positive = (n) => Number.isFinite(Number(n)) && Number(n) > 0;

// What a BUY of `amount` ICEC gives at index price `price` with a `feeBps` fee (basis points, 100 = 1 %):
// the fee comes off first, the rest becomes units. null when the inputs are unusable.
export const quoteBuy = ({ amount, price, feeBps = 0 }) => {
  if (!positive(amount) || !positive(price)) return null;
  const pay = floor8(amount);
  const fee = floor8((pay * Number(feeBps)) / 10000);
  const net = round8(pay - fee);
  const units = floor8(net / Number(price));
  return { pay, fee, net, units };
};

// What a SELL of `units` pays: units x price, less the fee. null when the inputs are unusable.
export const quoteSell = ({ units, price, feeBps = 0 }) => {
  if (!positive(units) || !positive(price)) return null;
  const u = floor8(units);
  const gross = floor8(u * Number(price));
  const fee = floor8((gross * Number(feeBps)) / 10000);
  const net = round8(gross - fee);
  return { units: u, gross, fee, net };
};

// A buy form: returns an error sentence, or null when it is fine to submit. `balance` is in the currency being paid
// with; `maxTrade` is the per-trade ceiling in ICEC (checked against the ICEC value, `payIcec`).
export const validateBuy = ({ amount, balance, payIcec, price, feeBps, maxTrade }) => {
  if (!positive(amount)) return 'Enter how much to spend.';
  if (Number.isFinite(balance) && Number(amount) > balance + 1e-9) return 'You do not have enough in that wallet.';
  const q = quoteBuy({ amount: payIcec ?? amount, price, feeBps });
  if (!q || q.units <= 0) return 'That amount is too small to buy any units.';
  if (positive(maxTrade) && q.pay > Number(maxTrade) + 1e-9) return `The most you can buy in one trade is ${trim(maxTrade)} ICEC.`;
  return null;
};

// A sell form: you cannot sell more than you hold, and what you sell must be worth something after the fee.
export const validateSell = ({ units, held, price, feeBps, maxTrade }) => {
  if (!positive(units)) return 'Enter how many units to sell.';
  if (Number.isFinite(held) && floor8(units) > Number(held) + 1e-9) return 'You do not hold that many units.';
  const q = quoteSell({ units, price, feeBps });
  if (!q || q.net <= 0) return 'That is too small to sell.';
  if (positive(maxTrade) && q.gross > Number(maxTrade) + 1e-9) return `The most you can sell in one trade is ${trim(maxTrade)} ICEC worth. Sell in smaller parts.`;
  return null;
};

// Numbers as people read them: no trailing zeros, at most `max` decimals.
export const trim = (n, max = 6) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return v.toLocaleString('en-US', { maximumFractionDigits: max, minimumFractionDigits: 0 });
};
export const formatLevel = (level) => (level == null || !Number.isFinite(Number(level)) ? '—' : Number(level).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
export const formatPrice = (price) => (price == null || !Number.isFinite(Number(price)) ? '—' : trim(price, 4));
export const formatPct = (pct) => {
  if (pct == null || !Number.isFinite(Number(pct))) return '—';
  const v = Number(pct);
  return `${v > 0 ? '+' : ''}${v.toFixed(2)}%`;
};
export const changeTone = (pct) => (pct == null || !Number.isFinite(Number(pct)) || Number(pct) === 0 ? 'flat' : Number(pct) > 0 ? 'up' : 'down');

// How a sector describes itself to a visitor.
//   live      -> open, can be traded now
//   warming   -> not enough businesses have joined yet; nothing is published
//   paused    -> an operator (or the global switch) has stopped trading
export const sectorState = (sector, tradingEnabled = true) => {
  if (!sector) return { kind: 'paused', label: 'Unavailable', canTrade: false };
  if (sector.status === 'warming_up') {
    const have = Number(sector.contributors) || 0;
    const need = Number(sector.contributors_needed) || 0;
    // `registered` / `sharing` come from the business profiles (see 20261023100000_sector_registered_businesses.sql):
    // how many businesses on IcanEra belong to the sector, and how many of those have agreed to share their sales.
    // They are counts only. A level still comes from real sales alone, so `have` (businesses with sales) drives progress.
    const registered = Number(sector.registered) || 0;
    const sharing = Number(sector.sharing) || 0;
    return {
      kind: 'warming',
      label: need > 0 ? `Opening soon · ${have} of ${need} businesses` : 'Opening soon',
      canTrade: false,
      have,
      need,
      registered,
      sharing,
      progress: need > 0 ? Math.min(1, have / need) : 0,
      detail: registered > 0
        ? `${registered} ${registered === 1 ? 'business' : 'businesses'} on IcanEra${sharing > 0 ? ` · ${sharing} sharing sales` : ''}`
        : null,
    };
  }
  if (sector.status === 'halted') return { kind: 'paused', label: 'Paused', canTrade: false };
  if (!tradingEnabled) return { kind: 'paused', label: 'Trading paused', canTrade: false };
  if (sector.tradable === false) return { kind: 'paused', label: 'Updating…', canTrade: false };
  return { kind: 'live', label: 'Live', canTrade: true };
};

// The server's codes -> a sentence. The server already words most of them; this only fills in when it did not, and
// puts the new price in a price_moved message.
const MESSAGES = {
  not_signed_in: 'Please sign in to trade.',
  trading_paused: 'Sector trading is paused for a moment. Please try again shortly.',
  sector_not_live: 'This sector is not open for trading yet.',
  index_stale: 'The index is updating. Please try again in a moment.',
  amount_too_small: 'That amount is too small to trade.',
  trade_too_large: 'That is above the limit for a single trade.',
  position_too_large: 'That would take you above the limit for one sector.',
  insufficient_funds: 'You do not have enough in that wallet.',
  insufficient_units: 'You do not hold that many units.',
  capacity_reached: 'Sector markets are at capacity right now. Please try again later or with a smaller amount.',
  vault_insufficient: 'The market cannot pay this out right now. Nothing was sold; please try again later.',
  rate_limited: 'Too many trades in a minute. Please wait a moment.',
  no_cash_wallet: 'You do not have a wallet in that currency.',
};
export const friendlySectorError = (result) => {
  if (!result) return 'Trade failed. Please try again.';
  if (result.code === 'price_moved') {
    return result.priceIcec != null
      ? `The price moved to ${formatPrice(result.priceIcec)} ICEC while you were trading. Review it and try again.`
      : 'The price moved while you were trading. Review the new price and try again.';
  }
  return result.error || MESSAGES[result.code] || 'Trade failed. Please try again.';
};

// ican_sector_trade's answer -> the camel-case shape the screen reads.
export const mapSectorTradeResult = (data) => {
  if (!data || data.success !== true) {
    return {
      success: false,
      code: data?.code,
      error: data?.error || 'Trade failed',
      priceIcec: data?.price_icec != null ? Number(data.price_icec) : undefined,
    };
  }
  const num = (v) => (v == null ? null : Number(v));
  return {
    success: true,
    side: data.side,
    sector: data.sector,
    units: num(data.units),
    priceIcec: num(data.price_icec),
    grossIcec: num(data.gross_icec),
    feeIcec: num(data.fee_icec),
    netIcec: num(data.net_icec),
    payCurrency: data.pay_currency,
    payAmount: num(data.pay_amount),
    newUnits: num(data.new_units),
    newIcecBalance: num(data.new_ican_balance),
    newLocalBalance: num(data.new_local_balance),
    fillId: data.fill_id,
    requestId: data.request_id,
    duplicate: data.duplicate === true,
  };
};

// Feed candles ({t,o,h,l,c}, newest first, levels) -> drawable candles, oldest first, with the unix-seconds `time` a
// chart wants and the ISO `timestamp` mergeCandles keys on. A malformed row is dropped, not drawn.
export const toSectorCandles = (rows) => {
  const out = [];
  for (const r of [...(rows || [])].reverse()) {
    if (!r || !r.t) continue;
    const ms = Date.parse(r.t);
    const c = { timestamp: r.t, time: Math.floor(ms / 1000), open: Number(r.o), high: Number(r.h), low: Number(r.l), close: Number(r.c) };
    if (Number.isFinite(ms) && isDrawableCandle(c)) out.push(c);
  }
  // a chart rejects two points with the same time
  return out.filter((c, i) => i === 0 || c.time > out[i - 1].time);
};

// A holding's result, as the server reports it, for display. Positive = ahead of what was paid.
export const holdingResult = (h) => {
  if (!h) return { pnl: null, pct: null, tone: 'flat' };
  const pnl = h.pnl_icec == null ? null : Number(h.pnl_icec);
  const pct = h.pnl_pct == null ? null : Number(h.pnl_pct);
  return { pnl, pct, tone: changeTone(pnl) };
};

// Sector candles ({ timestamp, open, high, low, close }, oldest first) -> the row shape the analysis chart (IcanTradingChart)
// reads, so a sector index gets the same candles, moving averages, RSI, timeframes and trend lines as icaneracoin itself.
// An index has no traded volume, so it is 0 and the volume bars simply stay empty.
export const sectorChartRows = (candles) => (candles || []).map((c) => ({
  open_time: c.timestamp,
  open_price: c.open,
  high_price: c.high,
  low_price: c.low,
  close_price: c.close,
  trading_volume: 0,
}));
