import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase/client';
import { useAuth } from '../context/AuthContext';
import { getBalance, getOrCreateWallet } from '../services/icanWalletService';
import { topUpIcanWallet } from '../services/walletTopUpService';
import { getTopUpQuote } from '../services/topUpCurrency';
import icanCoinService from '../services/icanCoinService';
import icanOrderService from '../services/icanOrderService';
import icanCoinBlockchainService from '../services/icanCoinBlockchainService';
import { CountryService } from '../services/countryService';
import { friendlyTradeError, orderCrossed, validateBooking, validateSell, validateWalletBuy } from '../utils/tradeRules';
import { makeRequestIdStore } from '../utils/tradeResult';

// Everything the public /icaneracoin trade panel does for a signed-in visitor. It invents no money logic: coins are
// bought through the Flutterwave top-up (the server verifies the charge and credits the wallet at the live price),
// and selling, booking, filling and cancelling go through the same services the wallet's own Trade > Chart tab uses.
//
// A visitor who came in with Google gets their IcanEra wallet created here on first sight (get_or_create_ican_wallet),
// so there is nothing separate to set up before topping up.

const POLL_MS = 15_000;
const RETRY_AFTER_FAILURE_MS = 5 * 60_000;
const NONE = [];

const fullName = (user) => user?.user_metadata?.full_name || user?.user_metadata?.name || (user?.email ? user.email.split('@')[0] : '');

export const usePublicTrading = (livePriceUgx) => {
  const { user, signInWithGoogle, signOut } = useAuth();
  const userId = user?.id || null;

  const [wallet, setWallet] = useState(null); // { ican, address }
  const [quote, setQuote] = useState(null); // { currency, price } -- one coin, in the visitor's own currency
  const [quoteError, setQuoteError] = useState('');
  const [country, setCountry] = useState('UG');
  const [orders, setOrders] = useState(NONE);
  const [buyMarkers, setBuyMarkers] = useState(NONE);
  const [sellMarkers, setSellMarkers] = useState(NONE);
  const [orderErrors, setOrderErrors] = useState({});
  // The visitor's cash in their IcanEra wallet, in their own currency: undefined while loading, null when they have
  // no cash wallet yet, else { currency, balance }. Buying from it needs no checkout and has no gateway fee.
  const [cash, setCash] = useState(undefined);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null); // { kind: 'ok' | 'err' | 'info', text }
  const backoff = useRef({}); // orderId -> do not retry before this time
  // One id per buy / sell ACTION: a double tap or a retry after a lost answer reuses it, so the server trades once.
  const requestIds = useRef(makeRequestIdStore('public')).current;

  const say = useCallback((kind, text) => setNotice({ kind, text }), []);

  const refreshWallet = useCallback(async () => {
    if (!userId) return;
    try {
      try { await getOrCreateWallet(userId); } catch { /* the balance read below still tells the truth */ }
      const b = await getBalance(userId);
      setWallet({ ican: Number(b.ican) || 0, address: b.address });
    } catch {
      setWallet((prev) => prev || { ican: 0, address: null });
    }
  }, [userId]);

  const refreshOrders = useCallback(async () => {
    if (!userId) return;
    setOrders(await icanOrderService.getOpenOrders(userId));
  }, [userId]);

  // Past executed trades, as the green / red lines on the chart (same query as the wallet's chart tab).
  const refreshMarkers = useCallback(async () => {
    if (!userId) return;
    const { data, error } = await supabase
      .from('ican_coin_transactions')
      .select('type, price_per_coin, timestamp')
      .eq('user_id', userId)
      .in('status', ['completed', 'confirmed', 'success'])
      .in('type', ['purchase', 'sale'])
      .order('timestamp', { ascending: false })
      .limit(20);
    if (error) return;
    const rows = data || [];
    const pick = (type) => rows.filter((r) => r.type === type).slice(0, 5).map((r) => ({ price: parseFloat(r.price_per_coin) })).filter((m) => Number.isFinite(m.price));
    setBuyMarkers(pick('purchase'));
    setSellMarkers(pick('sale'));
  }, [userId]);

  const refreshCash = useCallback(async (countryCode) => {
    if (!userId) return;
    const currency = CountryService.getCurrencyCode(countryCode);
    const { data, error } = await supabase
      .from('wallet_accounts')
      .select('balance')
      .eq('user_id', userId)
      .eq('currency', currency)
      .maybeSingle();
    if (error) { setCash(null); return; }
    setCash(data ? { currency, balance: parseFloat(data.balance) || 0 } : null);
  }, [userId]);

  // The cash balance is per currency, so it is read again whenever the visitor's country is known or changes.
  useEffect(() => { if (userId) refreshCash(country); else setCash(undefined); }, [userId, country, refreshCash]);

  // Load everything once a visitor is signed in; forget it all when they sign out.
  useEffect(() => {
    if (!userId) {
      setWallet(null); setCash(undefined); setQuote(null); setOrders(NONE); setBuyMarkers(NONE); setSellMarkers(NONE); setOrderErrors({}); setNotice(null);
      return undefined;
    }
    let cancelled = false;
    refreshWallet();
    refreshOrders();
    refreshMarkers();
    icanCoinService.getUserCountry(userId).then((cc) => { if (!cancelled && cc) setCountry(cc); }).catch(() => {});
    const loadQuote = () => getTopUpQuote()
      .then((q) => { if (!cancelled) { setQuote(q); setQuoteError(''); } })
      .catch((e) => { if (!cancelled) setQuoteError(e.message || 'The live price is unavailable right now.'); });
    loadQuote();
    const timer = setInterval(loadQuote, 60_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [userId, refreshWallet, refreshOrders, refreshMarkers]);

  // Booked orders: while this page is open, run any that the live price has reached -- the same rule and the same
  // execution as the wallet's own chart (there is no server-side matching engine). A failure is shown on that order
  // and retried in a few minutes instead of every poll.
  const ordersRef = useRef(orders);
  const countryRef = useRef(country);
  countryRef.current = country;
  ordersRef.current = orders;
  const priceRef = useRef(livePriceUgx);
  priceRef.current = livePriceUgx;
  useEffect(() => {
    if (!userId) return undefined;
    let running = false;
    const tick = async () => {
      if (running) return;
      const due = ordersRef.current.filter((o) => orderCrossed(o, priceRef.current) && !((backoff.current[o.id] || 0) > Date.now()));
      if (due.length === 0) return;
      running = true;
      try {
        let filled = 0;
        for (const order of due) {
          try {
            const result = await icanOrderService.fillOrderNow(order, userId, { enforceLimit: true }); // a resting order must not fill worse than its target
            if (result?.success) {
              filled += 1;
              setOrderErrors((prev) => { const next = { ...prev }; delete next[order.id]; return next; });
            } else if (result?.code === 'price_moved') {
              // Not a failure: the price slipped back past this order's target between the check and the fill, so the
              // order is simply not due yet. Leave it open; the next poll looks again.
            } else {
              backoff.current[order.id] = Date.now() + RETRY_AFTER_FAILURE_MS;
              setOrderErrors((prev) => ({ ...prev, [order.id]: friendlyTradeError(result?.error) }));
            }
          } catch (e) {
            backoff.current[order.id] = Date.now() + RETRY_AFTER_FAILURE_MS;
            setOrderErrors((prev) => ({ ...prev, [order.id]: friendlyTradeError(e.message) }));
          }
        }
        if (filled > 0) {
          say('ok', filled === 1 ? 'Your booked order was filled at the live price.' : `${filled} booked orders were filled at the live price.`);
          await Promise.all([refreshOrders(), refreshWallet(), refreshCash(countryRef.current), refreshMarkers()]);
        }
      } finally {
        running = false;
      }
    };
    const timer = setInterval(tick, POLL_MS);
    tick();
    return () => clearInterval(timer);
  }, [userId, say, refreshOrders, refreshWallet, refreshCash, refreshMarkers]);

  const run = async (fn) => {
    setNotice(null);
    setBusy(true);
    try { return await fn(); } finally { setBusy(false); }
  };

  // Pay with card / Mobile Money / bank. The server checks the charge before any coin is credited.
  const buyCoins = (localAmount) => run(async () => {
    try {
      const result = await topUpIcanWallet({
        amount: localAmount,
        customerEmail: user?.email || '',
        customerName: fullName(user),
        customerPhone: user?.phone || user?.user_metadata?.phone || '',
      });
      if (result.cancelled) { say('info', 'Payment cancelled. Nothing was charged.'); return result; }
      if (!result.success) { say('err', result.error || 'The payment did not go through.'); return result; }
      say('ok', `Done. ${result.icanAmount.toFixed(4)} ICAN added to your wallet.`);
      await Promise.all([refreshWallet(), refreshMarkers()]);
      return result;
    } catch (e) {
      say('err', e.message || 'The payment did not go through.');
      return { success: false, error: e.message };
    }
  });

  // Buy with the money already in the IcanEra wallet: the same call, and the same bookkeeping, as the wallet's own
  // Buy tab (icanCoinService.buyIcanCoins, then the non-blocking blockchain record).
  const buyWithWallet = (localAmount) => run(async () => {
    const check = validateWalletBuy(localAmount, cash?.balance);
    if (!check.ok) { say('err', check.error); return { success: false, error: check.error }; }
    try {
      const result = await icanCoinService.buyIcanCoins(userId, check.amount, country, 'wallet_balance',
        { requestId: requestIds.idFor(`buy|${check.amount}|${country}`), expectedPriceUgx: priceRef.current });
      if (!result?.success) { say('err', friendlyTradeError(result?.error || 'The purchase did not go through.')); return result; }
      requestIds.clear();
      if (result.icanAmount > 0 && result.pricePerCoin > 0) {
        try {
          await icanCoinBlockchainService.recordBlockchainTransaction({
            userId, type: 'purchase', icanAmount: result.icanAmount, pricePerCoin: result.pricePerCoin, totalValueUGX: result.icanAmount * result.pricePerCoin,
          });
        } catch { /* recording is best-effort: the purchase itself already went through */ }
      }
      say('ok', `Bought ${Number(result.icanAmount).toFixed(4)} ICAN from your IcanEra wallet. No checkout fee.`);
      await Promise.all([refreshWallet(), refreshCash(country), refreshMarkers()]);
      return result;
    } catch (e) {
      say('err', friendlyTradeError(e.message || 'The purchase did not go through.'));
      return { success: false, error: e.message };
    }
  });

  const sellCoins = (amount) => run(async () => {
    const check = validateSell(amount, wallet?.ican);
    if (!check.ok) { say('err', check.error); return { success: false, error: check.error }; }
    try {
      const result = await icanCoinService.sellIcanCoins(userId, check.amount, country,
        { requestId: requestIds.idFor(`sell|${check.amount}|${country}`), expectedPriceUgx: priceRef.current });
      if (!result?.success) { say('err', friendlyTradeError(result?.error || 'The sale did not go through.')); return result; }
      requestIds.clear();
      say('ok', `Sold ${check.amount} ICAN at the live price.`);
      await Promise.all([refreshWallet(), refreshCash(country), refreshMarkers()]);
      return result;
    } catch (e) {
      say('err', friendlyTradeError(e.message || 'The sale did not go through.'));
      return { success: false, error: e.message };
    }
  });

  const bookOrder = ({ side, amount, price }) => run(async () => {
    const problem = validateBooking({ side, amount, price, balance: wallet?.ican });
    if (problem) { say('err', problem); return { success: false, error: problem }; }
    try {
      await icanOrderService.createOrder({ userId, orderType: side, icanAmount: Number(amount), targetPriceUgx: Number(price), countryCode: country || 'UG' });
      say('ok', `Booked: ${side === 'buy' ? 'buy' : 'sell'} ${Number(amount)} ICAN at UGX ${Number(price).toLocaleString()}.`);
      await refreshOrders();
      return { success: true };
    } catch (e) {
      say('err', e.message || 'Could not book the order.');
      return { success: false, error: e.message };
    }
  });

  const cancelOrder = (orderId) => run(async () => {
    try {
      await icanOrderService.cancelOrder(orderId, userId);
      await refreshOrders();
    } catch (e) {
      say('err', e.message || 'Could not cancel the order.');
    }
  });

  const fillOrderNow = (order) => run(async () => {
    try {
      const result = await icanOrderService.fillOrderNow(order, userId);
      if (result?.success) {
        say('ok', 'Order filled at the live price.');
        await Promise.all([refreshOrders(), refreshWallet(), refreshCash(country), refreshMarkers()]);
      } else {
        say('err', friendlyTradeError(result?.error || 'Could not fill the order.'));
      }
    } catch (e) {
      say('err', friendlyTradeError(e.message || 'Could not fill the order.'));
    }
  });

  const continueWithGoogle = async () => {
    // Come back to this page with the trade panel open (the sign-in returns to the exact URL it started from).
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('trade', '1');
      window.history.replaceState({}, '', `${url.pathname}${url.search}`);
    } catch { /* fall back to a plain return */ }
    try {
      await signInWithGoogle();
    } catch (e) {
      say('err', e.message || 'Google sign-in could not start. Please try again.');
    }
  };

  return {
    user, signedIn: !!userId, signOut, continueWithGoogle,
    wallet, quote, quoteError, country, orders, buyMarkers, sellMarkers, orderErrors, busy, notice, clearNotice: () => setNotice(null),
    cash, buyCoins, buyWithWallet, sellCoins, bookOrder, cancelOrder, fillOrderNow, refreshWallet,
    currencyCode: CountryService.getCurrencyCode(country),
  };
};

export default usePublicTrading;
