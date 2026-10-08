import React, { useEffect, useMemo, useState } from 'react';
import { CalendarClock, ChevronDown, Loader, Lock, Wallet, Smartphone } from 'lucide-react';
import ContinueWithGoogle from './ContinueWithGoogle';
import {
  quoteInstallments, getBusinessSiteInfo, createInstallmentPlan, payInstallmentWithFlutterwave, getWalletCoins,
  formatMoney, formatCoins, formatCoinAmount, coinsFor, cleanAmountInput, unitDecimals, COIN_RECOMMENDATION, previewSchedule, FREQUENCY_LABELS,
} from '../services/installmentService';

// Two looks for the same panel: the dark storefront (/store/<id>) and the
// business website's own palette (/notices/<id>, the "nb" classes).
const SKINS = {
  slate: {
    card: 'rounded-xl border border-slate-800 bg-slate-900/60 p-3 space-y-3',
    title: 'text-white', muted: 'text-slate-400', faint: 'text-slate-500', good: 'text-emerald-400', err: 'text-xs text-red-400',
    input: 'w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500',
    on: 'border-indigo-500 bg-indigo-500/10 text-white', off: 'border-slate-800 bg-slate-900 text-slate-400 hover:bg-slate-800',
    primary: 'w-full py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-semibold transition flex items-center justify-center gap-2',
    secondary: 'w-full py-2.5 rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-semibold transition flex items-center justify-center gap-2',
    rule: 'border-slate-800',
  },
  nb: {
    card: 'rounded-xl border nb-border nb-surface-alt p-3 space-y-3',
    title: 'nb-text', muted: 'nb-text-muted', faint: 'nb-text-faint', good: 'nb-text', err: 'nb-error-text text-xs',
    input: 'w-full px-3 py-2 rounded-xl nb-input text-sm',
    on: 'nb-option-selected', off: 'nb-option',
    primary: 'w-full py-2.5 rounded-xl nb-btn-primary disabled:opacity-50 text-sm font-semibold transition flex items-center justify-center gap-2',
    secondary: 'w-full py-2.5 rounded-xl nb-btn-secondary disabled:opacity-50 text-sm font-semibold transition flex items-center justify-center gap-2',
    rule: 'nb-border',
  },
};

const fmtDate = (d) => d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
export const PLAN_NOTICE_KEY = 'icanera_plan_notice';

/**
 * "Pay in instalments" for a cart on a storefront or business website.
 *
 * The buyer chooses a deposit, how many payments after it and how often; the
 * items are then reserved for them, and once everything is paid they collect
 * the order or have it delivered. A plan needs a (free) IcanEra account so the
 * balance and receipts stay theirs: signed-out visitors are sent to create one
 * in place, with the cart left intact.
 */
export default function InstallmentOffer({ businessProfileId, cartItems, user, authLoading, onNeedAuth, onBeforeAuthRedirect, pendingSection = null, customerName = '', customerPhone = '', storeName = 'IcanEra order', skin = 'slate' }) {
  const k = SKINS[skin] || SKINS.slate;
  const cart = useMemo(() => cartItems.map((row) => ({ product_id: row.listing.product_id, quantity: row.qty })), [cartItems]);
  const cartKey = JSON.stringify(cart);

  const [siteInfo, setSiteInfo] = useState(null);
  const [quote, setQuote] = useState(null);
  const [open, setOpen] = useState(false);
  const [n, setN] = useState(3);
  const [freq, setFreq] = useState(7);
  const [deposit, setDeposit] = useState('');
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  const [walletCoins, setWalletCoins] = useState(null); // null = unknown

  useEffect(() => {
    if (!user?.id) { setWalletCoins(null); return undefined; }
    let cancelled = false;
    getWalletCoins(user.id).then((v) => { if (!cancelled) setWalletCoins(v); });
    return () => { cancelled = true; };
  }, [user?.id]);

  useEffect(() => {
    let cancelled = false;
    getBusinessSiteInfo(businessProfileId).then((info) => { if (!cancelled) setSiteInfo(info); });
    return () => { cancelled = true; };
  }, [businessProfileId]);

  useEffect(() => {
    setQuote(null);
    if (cart.length === 0) return undefined;
    let cancelled = false;
    const timer = setTimeout(() => {
      quoteInstallments(businessProfileId, cart).then((q) => { if (!cancelled) setQuote(q); });
    }, 350);
    return () => { cancelled = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessProfileId, cartKey]);

  const terms = quote?.terms;
  const cur = quote?.currency || terms?.currency || 'UGX';
  const price = Number(quote?.coin_price || 0);
  const unit = Number(terms?.unit || 1);
  const dec = unitDecimals(unit);
  const abroad = quote?.cross_border === true;
  const money = (v) => formatMoney(v, cur);
  const items = Number(quote?.items_amount || 0);
  const minDeposit = Number(quote?.min_deposit_amount || 0);
  const minPay = Number(terms?.min_payment_amount || unit);
  const maxN = Number(terms?.max_installments || 6);
  const maxDays = Number(terms?.max_plan_days || 90);
  const freqs = (terms?.frequencies_days || [7, 14, 30]).filter((f) => f <= maxDays);
  // 0 = pay it all today (how an order from abroad is simply bought, with the shop holding the price)
  const nChoices = [0, ...Array.from({ length: maxN }, (_, i) => i + 1).filter((v) => v * freq <= maxDays)];
  const feePct = Number(terms?.gateway_fee_pct ?? 3.5);

  // Keep the choices valid whenever the cart or the other choice changes.
  useEffect(() => {
    if (!terms) return;
    if (!freqs.includes(freq)) setFreq(freqs[0] || 7);
    if (!nChoices.includes(n)) setN(nChoices[nChoices.length - 1]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terms, freq, n]);

  const maxDeposit = n === 0 ? items : items - n * minPay;
  useEffect(() => {
    if (!items) return;
    const suggested = Math.max(minDeposit, Math.ceil((items * 0.3) / unit) * unit);
    setDeposit(String(Number(Math.min(suggested, Math.max(minDeposit, maxDeposit)).toFixed(dec))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, minDeposit]);

  const depositNum = n === 0 ? items : (Number(deposit) || 0);
  const depositProblem = !depositNum
    ? 'Enter your deposit'
    : depositNum < minDeposit ? `The deposit must be at least ${money(minDeposit)}`
      : depositNum > maxDeposit ? `That leaves too little for ${n} payment${n > 1 ? 's' : ''} — choose a smaller deposit or fewer payments` : '';
  const schedule = useMemo(
    () => (items && !depositProblem ? previewSchedule({ items, deposit: depositNum, installments: n, frequencyDays: freq, unit }) : []),
    [items, depositNum, n, freq, unit, depositProblem],
  );
  const depositCoins = coinsFor(depositNum, price);
  const walletShort = walletCoins !== null && depositCoins !== null && depositNum > 0 && walletCoins + 1e-9 < depositCoins;
  const momoCharge = depositNum ? Math.ceil(Number((depositNum / (1 - feePct / 100) / unit).toFixed(6))) * unit : 0;

  // Nothing to show: no cart, the business has accounts switched off, or the quote failed.
  if (cart.length === 0 || siteInfo?.accounts_enabled === false) return null;
  if (quote && quote.success === false) return null;
  if (!quote || !terms) {
    return <div className={`flex items-center gap-2 text-xs ${k.faint}`}><Loader className="w-3.5 h-3.5 animate-spin" />Checking instalment options…</div>;
  }
  if (!quote.eligible) {
    return <p className={`text-xs ${k.faint}`}>Pay in instalments on orders from {money(terms.min_order_amount)}.</p>;
  }

  const start = async (payWith) => {
    if (!user) { onNeedAuth?.(); return; }
    if (depositProblem) { setError(depositProblem); return; }
    setError('');
    setBusy(payWith);
    try {
      const plan = await createInstallmentPlan({
        businessProfileId, cart, installments: n, frequencyDays: freq, depositAmount: depositNum, payWith,
        customerName: customerName.trim() || null, customerPhone: customerPhone.trim() || null,
      });
      if (payWith === 'flutterwave') {
        try {
          await payInstallmentWithFlutterwave(plan.code, depositNum, { name: customerName, phone: customerPhone, title: storeName });
        } catch (err) {
          // The plan exists and holds the stock for a couple of hours: land on it so the deposit can be retried.
          try { sessionStorage.setItem(PLAN_NOTICE_KEY, err.message || 'The deposit was not completed.'); } catch { /* ignore */ }
        }
      }
      window.location.assign(`/plan/${plan.code}`);
    } catch (err) {
      setError(err.message || 'Could not start this plan. Please try again.');
      setBusy(null);
    }
  };

  return (
    <div className={k.card}>
      <button type="button" onClick={() => setOpen((v) => !v)} className="w-full flex items-center justify-between gap-2 text-left">
        <span className={`flex items-center gap-2 text-sm font-semibold ${k.title}`}><CalendarClock className="w-4 h-4" />Pay in instalments</span>
        <ChevronDown className={`w-4 h-4 ${k.faint} transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {!open && (
        <p className={`text-xs ${k.muted}`}>{abroad
          ? `This shop is abroad. Start from ${money(minDeposit)} now (or pay it all today) — once it is paid in full the seller ships it to your address, and they are only paid when you confirm it arrived.`
          : `Start from ${money(minDeposit)} now, pay the rest over weeks, then collect it or have it delivered once it is paid in full.`}</p>
      )}

      {open && (
        <>
          <p className={`text-xs ${k.muted}`}>
            Your items are reserved for you while you pay. {abroad ? 'Once the last payment is in, you give the seller your shipping address and they send it to you.' : 'Once the last instalment is in, you choose to collect them or have them delivered.'}
            {!user && ' You need a free IcanEra account so your balance and receipts stay yours.'}
          </p>

          <div>
            <label className={`block text-xs mb-1 ${k.faint}`}>{n === 0 ? `You pay today (${cur})` : `Deposit today (${cur})`}</label>
            <input
              className={k.input} inputMode={dec ? 'decimal' : 'numeric'} value={n === 0 ? String(items) : deposit} disabled={n === 0}
              onChange={(e) => setDeposit(cleanAmountInput(e.target.value, unit))} aria-label="Deposit"
            />
            {depositProblem && <p className={`${k.err} mt-1`}>{depositProblem}</p>}
          </div>

          <div>
            <label className={`block text-xs mb-1 ${k.faint}`}>{n === 0 ? 'Pay' : 'Then pay the rest in'}</label>
            <div className="flex gap-1.5 flex-wrap">
              {nChoices.map((v) => (
                <button key={v} type="button" onClick={() => setN(v)}
                  className={`min-w-[44px] px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${n === v ? k.on : k.off}`}>{v === 0 ? 'All today' : v}</button>
              ))}
              {n > 0 && <span className={`self-center text-xs ${k.faint}`}>payment{n > 1 ? 's' : ''}</span>}
            </div>
          </div>

          <div>
            {n > 0 && <label className={`block text-xs mb-1 ${k.faint}`}>How often</label>}
            <div className={n > 0 ? 'flex gap-1.5' : 'hidden'}>
              {freqs.map((f) => (
                <button key={f} type="button" onClick={() => setFreq(f)}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-semibold border transition ${freq === f ? k.on : k.off}`}>{FREQUENCY_LABELS[f] || `every ${f} days`}</button>
              ))}
            </div>
          </div>

          {schedule.length > 0 && (
            <div className={`rounded-lg border ${k.rule} p-2.5 space-y-1`}>
              {schedule.map((row) => (
                <div key={row.n} className="flex justify-between text-xs">
                  <span className={k.muted}>{row.n === 0 ? 'Today — deposit' : `Payment ${row.n} · ${fmtDate(row.due)}`}</span>
                  <span className={`font-semibold ${k.title}`}>{money(row.amount)}</span>
                </div>
              ))}
              <div className={`flex justify-between text-xs pt-1 border-t ${k.rule}`}>
                <span className={k.muted}>Total · fully paid by {fmtDate(schedule[schedule.length - 1].due)}</span>
                <span className={`font-semibold ${k.title}`}>{money(items)}</span>
              </div>
            </div>
          )}
          <p className={`text-[11px] ${k.faint}`}>
            You can pay more, or pay it all off, any time. {abroad ? 'Shipping is arranged by the seller.' : 'Delivery (if you choose it) is priced and paid at the end.'} Cancel within {terms.cooling_off_hours} hours for a full refund; after that a {terms.cancel_fee_pct}% fee applies.
          </p>

          {error && <p className={k.err}>{error}</p>}

          {!user ? (
            <div className="space-y-2">
              <p className={`text-xs flex items-center gap-1.5 ${k.muted}`}><Lock className="w-3.5 h-3.5" />Create your free IcanEra wallet to pay in instalments</p>
              <ContinueWithGoogle skin={skin} compact pendingSection={pendingSection} onUseEmail={onNeedAuth} onBeforeRedirect={onBeforeAuthRedirect} />
            </div>
          ) : (
            <div className="space-y-2">
              <p className={`text-[11px] leading-relaxed ${k.good}`}>★ {COIN_RECOMMENDATION}</p>
              <button type="button" onClick={() => start('wallet')} disabled={!!busy || !!depositProblem || walletShort} className={k.primary}>
                {busy === 'wallet' ? <Loader className="w-4 h-4 animate-spin" /> : <Wallet className="w-4 h-4" />}
                Pay {formatCoins(depositNum, price) || money(depositNum)} {n === 0 ? '' : 'deposit '}from IcanEra wallet
              </button>
              <button type="button" onClick={() => start('flutterwave')} disabled={!!busy || !!depositProblem} className={k.secondary}>
                {busy === 'flutterwave' ? <Loader className="w-4 h-4 animate-spin" /> : <Smartphone className="w-4 h-4" />}
                Pay {money(momoCharge)} with {cur === 'UGX' ? 'Mobile Money, card or bank' : 'card, bank or mobile money'}
              </button>
              {walletCoins !== null && (
                <p className={`text-[11px] ${walletShort ? k.err : k.faint}`}>
                  {walletShort
                    ? `Your IcanEra wallet has ${formatCoinAmount(walletCoins)} (about ${money(walletCoins * price)}) — not enough for this payment. Pay with card, bank or mobile money instead, or add to your wallet first.`
                    : `Your IcanEra wallet: ${formatCoinAmount(walletCoins)} (about ${money(walletCoins * price)}).`}
                </p>
              )}
              <p className={`text-[11px] ${k.faint}`}>Card, bank or mobile money adds a {money(momoCharge - depositNum)} processing fee. The wallet has none.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
