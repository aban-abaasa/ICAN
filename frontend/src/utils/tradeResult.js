// Pure helpers for trading through public.ican_trade_execute (the atomic, idempotent server-side buy / sell).
// No network and no React, so the rules are testable.

// A request id is the server's idempotency key: the same id never executes twice. It must match
// ^[A-Za-z0-9:_.-]+$ and be 8-100 characters long.
export const newRequestId = (prefix = 'trade') => {
  let unique;
  try {
    unique = globalThis.crypto.randomUUID();
  } catch {
    unique = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  }
  return `${String(prefix).replace(/[^A-Za-z0-9:_.-]/g, '').slice(0, 24) || 'trade'}-${unique}`;
};

// One id per user ACTION, not per click. A double tap, a retry after a lost response or a second submit of the same
// form reuses the id (the server then answers "already done" instead of trading twice); changing what is being
// traded starts a new action and a new id; success ends the action. Keep one store per form.
export const makeRequestIdStore = (prefix = 'trade') => {
  let current = null; // { key, id }
  return {
    idFor(key) {
      if (!current || current.key !== key) current = { key, id: newRequestId(prefix) };
      return current.id;
    },
    clear() { current = null; },
  };
};

// The server said no (success:false) or the call itself failed. `error` is a sentence the screen can show as is.
export const tradeFailure = (data, fallback = 'Trade failed') => ({
  success: false,
  error: (data && data.error) || fallback,
  code: (data && data.code) || undefined,
  // present when the price moved while the user was trading, so the screen can show the new price
  priceUgx: data && data.price_ugx != null ? Number(data.price_ugx) : undefined,
});

// ican_trade_execute's answer -> the shape icanCoinService.buyIcanCoins / sellIcanCoins have always returned, so every
// screen that reads `result.icanAmount`, `result.newWalletBalance`, `result.transaction.id` keeps working.
export const mapTradeResult = (data) => {
  if (!data || data.success !== true) return tradeFailure(data);
  const num = (v) => (v == null ? null : Number(v));
  return {
    success: true,
    icanAmount: num(data.ican_amount),
    localAmount: num(data.local_amount),
    currency: data.currency,
    pricePerCoin: num(data.price_per_coin),
    totalValue: num(data.total_ugx),
    newIcanBalance: num(data.new_ican_balance),
    newWalletBalance: num(data.new_local_balance),
    transaction: data.transaction_id ? { id: data.transaction_id, reference_id: data.request_id } : null,
    requestId: data.request_id,
    // true when this was a retry of something that had already gone through (nothing moved a second time)
    duplicate: data.duplicate === true,
  };
};

// A dropped connection, as opposed to the server answering. Safe to retry with the SAME request id: if the first
// attempt did reach the server, the retry just returns its result.
export const isTransientNetworkError = (error) => {
  if (!error) return false;
  if (error.code && String(error.code).length > 0) return false; // PostgREST / Postgres answered
  return /failed to fetch|network|load failed|timeout|timed out|connection|ECONN|ETIMEDOUT/i.test(String(error.message || error));
};
