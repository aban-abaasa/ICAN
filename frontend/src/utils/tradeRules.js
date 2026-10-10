// Pure rules for the public icaneracoin trade panel. No network, no React: the money itself only ever moves
// through the existing, server-verified services; these decide what to ask them and when.

export const MAX_COIN_DECIMALS = 8;

const round8 = (n) => Math.floor(n * 1e8) / 1e8;

// A booked order is due when the live price has reached it: a buy once the price is at or below the target, a
// sell once it is at or above. Same rule as icanOrderService.tryFillOpenOrders, so both agree on what is "due".
export const orderCrossed = (order, priceUgx) => {
  const price = Number(priceUgx);
  const target = parseFloat(order && order.target_price_ugx);
  if (!(price > 0) || !(target > 0)) return false;
  return order.order_type === 'buy' ? price <= target : price >= target;
};

// How far a target sits from the live price, in percent (positive = above the market).
export const distanceFromMarketPct = (targetPrice, livePrice) => {
  const t = Number(targetPrice);
  const p = Number(livePrice);
  if (!(t > 0) || !(p > 0)) return null;
  return ((t - p) / p) * 100;
};

// Checks a booking form. `balance` is the visitor's coin balance (selling more than they own is refused up
// front). Returns an error string, or null when it is fine to submit.
export const validateBooking = ({ side, amount, price, balance }) => {
  const a = Number(amount);
  const p = Number(price);
  if (side !== 'buy' && side !== 'sell') return 'Choose buy or sell.';
  if (!(a > 0)) return 'Enter how many coins.';
  if (!(p > 0)) return 'Enter the price you want, or tap the chart.';
  if (side === 'sell' && Number.isFinite(balance) && a > balance + 1e-9) return 'You do not have that many coins to sell.';
  return null;
};

// Validates a sell amount against the balance and returns { ok, amount } or { ok:false, error }.
export const validateSell = (amount, balance) => {
  const a = round8(Number(amount));
  if (!(a > 0)) return { ok: false, error: 'Enter how many coins to sell.' };
  if (Number.isFinite(balance) && a > balance + 1e-9) return { ok: false, error: 'You do not have that many coins.' };
  return { ok: true, amount: a };
};

// What a top-up buys at the live price, rounded down to 8 decimals exactly like walletTopUpService, so the
// preview never promises more coins than the server will credit.
export const coinsForMoney = (localAmount, pricePerCoin) => {
  const amount = Number(localAmount);
  const price = Number(pricePerCoin);
  if (!(amount > 0) || !(price > 0)) return 0;
  return round8(amount / price);
};

// Quick-pick amounts for the Buy tab: friendly multiples of the smallest allowed top-up.
export const quickTopUpAmounts = (minimum) => {
  const m = Number(minimum);
  if (!(m > 0)) return [];
  return [1, 2, 5, 10].map((x) => Math.ceil(m * x));
};

// Turns the raw error from the existing buy/sell services into something a new visitor can act on.
export const friendlyTradeError = (message) => {
  const text = String(message || '');
  if (/No wallet found for currency/i.test(text)) {
    return 'Your cash wallet is not set up yet. Open your IcanEra wallet once to create it (it takes a minute), then come back to sell or fill orders here.';
  }
  if (/Insufficient balance/i.test(text)) return 'Your cash wallet balance is too low for this order.';
  if (/Insufficient IcanEra balance/i.test(text)) return 'You do not have enough coins for this.';
  return text || 'Something went wrong. Please try again.';
};
