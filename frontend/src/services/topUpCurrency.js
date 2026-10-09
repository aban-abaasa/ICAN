import { supabase } from '../lib/supabase/client';

// What a customer can be charged in when topping up, and which Flutterwave payment methods each
// currency offers. A customer is charged in their own country's currency (the one the server
// prices coins in for them, see get_my_ican_trading_info) when Flutterwave can collect it, and in
// USD by card otherwise -- which works everywhere. The PRICE is never kept here: it is always the
// server's live coin price in that currency (ican_live_price_in_currency).
export const TOPUP_CURRENCIES = {
  UGX: { options: 'card,mobilemoneyuganda,account', label: 'Mobile Money, card or bank' },
  KES: { options: 'card,mpesa', label: 'M-Pesa or card' },
  TZS: { options: 'card,mobilemoneytanzania', label: 'Mobile Money or card' },
  RWF: { options: 'card,mobilemoneyrwanda', label: 'Mobile Money or card' },
  GHS: { options: 'card,mobilemoneyghana', label: 'Mobile Money or card' },
  NGN: { options: 'card,banktransfer,ussd', label: 'card, bank transfer or USSD' },
  ZAR: { options: 'card', label: 'card' },
  EGP: { options: 'card', label: 'card' },
  USD: { options: 'card', label: 'card' },
  EUR: { options: 'card', label: 'card' },
  GBP: { options: 'card', label: 'card' },
};

const TWO_DECIMALS = new Set(['USD', 'EUR', 'GBP']);
export const decimalsFor = (currency) => (TWO_DECIMALS.has(currency) ? 2 : 0);

// Round up to a friendly figure (1, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10 x a power of ten).
export function niceCeil(x) {
  if (!(x > 0)) return 0;
  const mag = 10 ** Math.floor(Math.log10(x));
  const n = x / mag;
  const step = [1, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10].find((v) => n <= v + 1e-9) || 10;
  return step * mag;
}

// Smallest top-up: one fifth of a coin at the live price, never under 1 for two-decimal currencies.
export function minTopUp(currency, price) {
  const m = niceCeil((Number(price) || 0) * 0.2);
  return decimalsFor(currency) ? Math.max(1, m) : Math.max(1, Math.ceil(m));
}

export function formatMoney(amount, currency) {
  const d = decimalsFor(currency);
  return `${currency} ${Number(amount || 0).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d })}`;
}

// A charge is only offered when the deployed verify function says it checks against the live
// price -- otherwise a customer could be charged in a currency it cannot verify. Cached per page.
let probe;
const serverChecksLivePrice = () => {
  if (!probe) {
    probe = supabase.functions.invoke('verify-flutterwave-payment', { body: { probe: true } })
      .then(({ data, error }) => !error && data?.probe === true && data.live_pricing === true)
      .catch(() => false);
  }
  return probe;
};

async function livePrice(currency) {
  const { data, error } = await supabase.rpc('ican_live_price_in_currency', { p_currency: currency });
  if (error || !(Number(data) > 0)) throw new Error('The live coin price is unavailable right now. Please try again in a moment.');
  return Number(data);
}

/**
 * The live quote for this customer: { currency, price } = what ONE coin costs right now in the
 * currency they will be charged in. Their own country's currency (from the country they chose when
 * they signed up) when it can be collected, USD otherwise; UGX if this deployment can't yet verify
 * anything else. Fetched fresh every call -- it is the price, not a cached rate.
 */
export async function getTopUpQuote() {
  const { data: info, error } = await supabase.rpc('get_my_ican_trading_info');
  if (error || !info?.currency) throw new Error('Could not read your wallet currency. Please try again.');

  let currency = String(info.currency).toUpperCase();
  let price = Number(info.price_per_ican);
  if (!TOPUP_CURRENCIES[currency] || !(price > 0)) {
    currency = 'USD';
    price = await livePrice('USD');
  }
  if (currency !== 'UGX' && !(await serverChecksLivePrice())) {
    // Older server: it can only verify UGX, so charge UGX (still at the live UGX price).
    currency = 'UGX';
    price = await livePrice('UGX');
  }
  return { currency, price };
}
