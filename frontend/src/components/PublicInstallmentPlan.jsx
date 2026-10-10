import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Loader, AlertCircle, CheckCircle, Store, Wallet, Smartphone, Package, Truck, Navigation, Clock, Bike, X, CalendarClock,
  ShieldCheck, MapPin, ArrowLeft, QrCode, Plane, ExternalLink, Globe,
} from 'lucide-react';
import { QRCodeCanvas } from 'qrcode.react';
import { useAuth } from '../context/AuthContext';
import { AuthPage } from './auth';
import { PLAN_NOTICE_KEY } from './InstallmentOffer';
import ContinueWithGoogle from './ContinueWithGoogle';
import {
  getInstallmentPlan, payInstallmentFromWallet, payInstallmentWithFlutterwave, resumePendingInstallmentPayment,
  chooseInstallmentPickup, quoteInstallmentDelivery, chooseInstallmentDelivery, clearInstallmentDelivery, cancelInstallmentPlan,
  chooseInstallmentShipping, confirmInstallmentReceived, reportInstallmentProblem,
  formatMoney, formatCoins, formatCoinAmount, coinsFor, cleanAmountInput, unitDecimals,
  COIN_RECOMMENDATION, STATUS_LABELS, FREQUENCY_LABELS, getWalletCoins,
} from '../services/installmentService';
import { getPublicAppUrl } from '../utils/publicAppUrl';
import LoadingPage from './LoadingPage';

const DELIVERY_WINDOWS = [
  { hours: 1, label: 'Within 1 hour' }, { hours: 2, label: 'Within 2 hours' }, { hours: 4, label: 'Within 4 hours' },
  { hours: 8, label: 'Within 8 hours' }, { hours: 24, label: 'Within 24 hours' }, { hours: 48, label: 'Within 2 days' },
];
const VEHICLES = [
  { value: null, label: 'Any' }, { value: 'motorcycle', label: '🏍️ Boda' }, { value: 'car', label: '🚗 Car' }, { value: 'van', label: '🚐 Van' },
];
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const DONE_PAYING = ['pickup_ready', 'dispatched', 'shipping_pending', 'shipped', 'disputed'];
const WAITING = ['awaiting_deposit', 'active', 'pickup_ready', 'dispatched', 'shipping_pending', 'shipped', 'disputed'];

const statusTone = (status) => ({
  ready: 'bg-emerald-500/15 text-emerald-300', pickup_ready: 'bg-emerald-500/15 text-emerald-300', completed: 'bg-emerald-500/15 text-emerald-300',
  dispatched: 'bg-sky-500/15 text-sky-300', shipping_pending: 'bg-amber-500/15 text-amber-300', shipped: 'bg-sky-500/15 text-sky-300', disputed: 'bg-red-500/15 text-red-300', active: 'bg-indigo-500/15 text-indigo-300', awaiting_deposit: 'bg-amber-500/15 text-amber-300',
  cancelled: 'bg-slate-500/20 text-slate-300', lapsed: 'bg-red-500/15 text-red-300',
}[status] || 'bg-slate-500/20 text-slate-300');

const Card = ({ children, className = '' }) => (
  <div className={`rounded-2xl border border-slate-800 bg-slate-900/70 p-4 ${className}`}>{children}</div>
);

/**
 * /plan/<code> — one instalment plan: what is paid and owed, pay more (wallet
 * or Mobile Money / card / bank), and — once the items are paid in full —
 * collect them at the store or have them delivered. Visible only to the
 * customer who owns the plan and to the seller's team.
 */
const PublicInstallmentPlan = ({ code }) => {
  const { user, loading: authLoading } = useAuth();
  const [data, setData] = useState(null); // { plan, terms }
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState(() => {
    try { const m = sessionStorage.getItem(PLAN_NOTICE_KEY); if (m) sessionStorage.removeItem(PLAN_NOTICE_KEY); return m || ''; } catch { return ''; }
  });
  const [flash, setFlash] = useState('');
  const busyRef = useRef(false);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const res = await getInstallmentPlan(code);
      if (res?.success) { setData({ plan: res.plan, terms: res.terms }); setLoadError(''); } else { setData(null); setLoadError(res?.error || 'Plan not found'); }
    } catch (err) {
      setLoadError(err.message || 'Could not load this plan');
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [code]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { setLoading(false); return; }
    (async () => {
      const resumed = await resumePendingInstallmentPayment(code);
      if (resumed) setFlash('Your payment was confirmed.');
      await load();
    })();
  }, [authLoading, user, code, load]);

  // The store or seller may act at any moment (a pickup scan, a cancellation): keep it fresh.
  const plan = data?.plan;
  useEffect(() => {
    if (!plan || !WAITING.includes(plan.status)) return undefined;
    const timer = setInterval(() => { if (!document.hidden && !busyRef.current) load(true); }, 15000);
    return () => clearInterval(timer);
  }, [plan, load]);

  const after = async (message) => { if (message) setFlash(message); setNotice(''); await load(true); };

  if (authLoading || loading) {
    return <LoadingPage fixed tone="ice" label="Loading your instalment plan…" />;
  }

  if (!user) {
    return (
      <div className="fixed inset-0 bg-slate-950 overflow-y-auto">
        <div className="max-w-md mx-auto px-4 pt-8 text-center">
          <ShieldCheck className="w-10 h-10 text-indigo-400 mx-auto mb-3" />
          <h1 className="text-xl font-bold text-white mb-1">Sign in to see your plan</h1>
          <p className="text-sm text-slate-400 mb-4">Your payments and receipts are tied to your IcanEra account.</p>
          <ContinueWithGoogle skin="slate" title="New? Get your free IcanEra wallet" />
          <p className="text-xs text-slate-500 mt-4">or sign in with email</p>
        </div>
        <AuthPage initialView="signin" onAuthSuccess={() => {}} />
      </div>
    );
  }

  if (!plan) {
    return (
      <div className="fixed inset-0 bg-slate-950 flex flex-col items-center justify-center gap-4 p-6 text-center">
        <AlertCircle className="w-14 h-14 text-slate-500" />
        <p className="text-white text-lg font-semibold">{loadError || 'This plan isn\'t available'}</p>
        <p className="text-sm text-slate-400 max-w-sm">It may belong to a different account. Sign in with the account you used to start it.</p>
        <a href={getPublicAppUrl('/plans')} className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-semibold transition">My plans</a>
      </div>
    );
  }

  const terms = data.terms;
  const closed = ['cancelled', 'lapsed', 'completed'].includes(plan.status);
  const money = (v) => formatMoney(v, plan.currency);
  const itemsPaidUp = plan.paid_amount >= plan.items_amount;
  const deliveryFeeDue = plan.fulfilment === 'delivery' && plan.status === 'active' && itemsPaidUp;
  const canPay = plan.status === 'awaiting_deposit' || plan.status === 'active';
  const choosing = plan.status === 'ready';
  const pct = Math.min(100, Math.round((plan.paid_amount / Math.max(plan.total_amount, 1)) * 100));
  const voided = plan.status === 'cancelled' || plan.status === 'lapsed'; // nothing is owed on these any more

  return (
    <div className="fixed inset-0 bg-slate-950 overflow-y-auto">
      <div className="sticky top-0 z-20 bg-slate-950/95 backdrop-blur border-b border-slate-800 px-4 py-3 flex items-center gap-2">
        <a href={getPublicAppUrl('/plans')} className="p-1.5 rounded-full text-slate-400 hover:text-white hover:bg-white/10" aria-label="My plans"><ArrowLeft className="w-5 h-5" /></a>
        <div className="min-w-0 flex-1">
          <p className="text-white font-semibold truncate">{plan.seller_name || 'Your order'}</p>
          <p className="text-[11px] text-slate-500 font-mono">Plan {plan.code}</p>
        </div>
        <span className={`px-2.5 py-1 rounded-full text-[11px] font-semibold ${statusTone(plan.status)}`}>{STATUS_LABELS[plan.status] || plan.status}</span>
      </div>

      <div className="max-w-lg mx-auto p-4 space-y-3 pb-24">
        {notice && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200 flex gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /><span>{notice} Your items are still held — you can pay the deposit below.</span>
          </div>
        )}
        {flash && (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200 flex gap-2">
            <CheckCircle className="w-4 h-4 mt-0.5 shrink-0" /><span>{flash}</span>
            <button className="ml-auto text-emerald-300" onClick={() => setFlash('')} aria-label="Dismiss"><X className="w-4 h-4" /></button>
          </div>
        )}

        <Card>
          <div className="flex items-end justify-between mb-2">
            <div>
              <p className="text-xs text-slate-500">{voided ? 'You had paid' : 'Paid so far'}</p>
              <p className="text-2xl font-bold text-white">{money(plan.paid_amount)}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-slate-500">{voided ? 'Returned to your wallet' : plan.balance_amount > 0 ? 'Still to pay' : 'Balance'}</p>
              <p className="text-lg font-semibold text-slate-200">{money(voided ? plan.refunded_amount : plan.balance_amount)}</p>
            </div>
          </div>
          {!voided && <div className="h-2 rounded-full bg-slate-800 overflow-hidden"><div className="h-full bg-indigo-500 transition-all" style={{ width: `${pct}%` }} /></div>}
          <p className="text-[11px] text-slate-500 mt-1.5">
            Total {money(plan.total_amount)}{plan.delivery_fee_amount > 0 ? ` (items ${money(plan.items_amount)} + delivery ${money(plan.delivery_fee_amount)})` : ''}
            {!closed && !DONE_PAYING.includes(plan.status) ? ` · due in full by ${fmtDate(plan.final_due_at)}` : ''}
          </p>
          {plan.held_ican > 0 && !closed && (
            <p className="text-[11px] text-slate-500 mt-0.5">Held for you as {formatCoinAmount(plan.held_ican)} until your order is handed over.</p>
          )}
          <div className="mt-3 space-y-1.5 border-t border-slate-800 pt-3">
            {plan.items.map((it) => (
              <div key={it.product_id} className="flex justify-between gap-2 text-sm">
                <span className="text-slate-300 truncate">{it.name} × {Number(it.quantity)}</span>
                <span className="text-slate-400 shrink-0">{money(it.line_total)}</span>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-slate-500 mt-3 flex items-start gap-1.5"><Store className="w-3.5 h-3.5 mt-0.5 shrink-0" />From {plan.store_name}{plan.store_address ? `, ${plan.store_address}` : ''}</p>
          {plan.cross_border && <p className="text-[11px] text-sky-300 mt-1.5 flex items-start gap-1.5"><Globe className="w-3.5 h-3.5 mt-0.5 shrink-0" />This shop is abroad — it ships to you once you have paid in full.</p>}
        </Card>

        {plan.status === 'cancelled' || plan.status === 'lapsed' ? (
          <Card>
            <p className="text-white font-semibold mb-1">{plan.status === 'lapsed' ? 'This plan lapsed' : 'This plan was cancelled'}</p>
            <p className="text-sm text-slate-400">{plan.cancel_reason}</p>
            <p className="text-sm text-slate-300 mt-2">
              {money(plan.refunded_amount)} was returned to your IcanEra wallet{plan.cancel_fee_amount > 0 ? `, after a ${money(plan.cancel_fee_amount)} cancel fee` : ''}.
            </p>
          </Card>
        ) : null}

        {canPay && !deliveryFeeDue && <PayBox plan={plan} terms={terms} user={user} onDone={after} busyRef={busyRef} />}

        {choosing && plan.cross_border && <ShippingForm plan={plan} onDone={after} busyRef={busyRef} />}
        {choosing && !plan.cross_border && <Fulfilment plan={plan} onDone={after} busyRef={busyRef} />}
        {['shipping_pending', 'shipped', 'disputed'].includes(plan.status) && <ShipmentCard plan={plan} onDone={after} busyRef={busyRef} />}

        {deliveryFeeDue && (
          <>
            <Card>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-white font-semibold flex items-center gap-2"><Truck className="w-4 h-4" />Delivery chosen</p>
                  <p className="text-sm text-slate-400 mt-1">To {plan.delivery?.address || 'your location'} · within {plan.delivery?.max_hours}h of dispatch</p>
                  <p className="text-sm text-slate-300 mt-1">The real rider fare is {money(plan.delivery_fee_amount)}. Pay it and a rider is booked straight away.</p>
                </div>
                <button
                  className="text-xs text-indigo-300 underline shrink-0"
                  onClick={async () => { try { await clearInstallmentDelivery(plan.code); await after('Delivery cleared — choose again.'); } catch (err) { setNotice(err.message); } }}
                >Change</button>
              </div>
            </Card>
            <PayBox plan={plan} terms={terms} user={user} onDone={after} busyRef={busyRef} feeMode />
          </>
        )}

        {plan.status === 'pickup_ready' && <PickupCard plan={plan} />}

        {plan.status === 'dispatched' && (
          <Card className="text-center">
            <Truck className="w-9 h-9 text-sky-400 mx-auto mb-2" />
            <p className="text-white font-semibold">Your order is on its way</p>
            <p className="text-sm text-slate-400 mt-1">A BodaGoera rider has been booked. The seller is only paid once the rider scans the order out of the store — track it and confirm delivery on your receipt.</p>
            {plan.verify_url && <a href={plan.verify_url} target="_blank" rel="noreferrer" className="inline-block mt-3 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold">Open delivery receipt</a>}
            <p className="text-[11px] text-slate-500 mt-2">If it misses the window you chose, you can reclaim your money from the rider on that receipt.</p>
          </Card>
        )}

        {plan.status === 'completed' && (
          <Card className="text-center">
            <CheckCircle className="w-10 h-10 text-emerald-400 mx-auto mb-2" />
            <p className="text-white font-semibold">All done — thank you!</p>
            <p className="text-sm text-slate-400 mt-1">{plan.fulfilment === 'pickup' ? 'You collected your order.' : plan.fulfilment === 'ship' ? 'You received your order.' : 'Your order was delivered.'}</p>
          </Card>
        )}

        {plan.schedule && plan.n_installments > 0 && !closed && !DONE_PAYING.includes(plan.status) && (
          <Card>
            <p className="text-sm font-semibold text-white mb-2 flex items-center gap-2"><CalendarClock className="w-4 h-4" />Schedule</p>
            <div className="space-y-1.5">
              {plan.schedule.map((row) => (
                <div key={row.n} className="flex items-center justify-between text-sm">
                  <span className="text-slate-400">{row.n === 0 ? 'Deposit' : `Payment ${row.n}`} · {fmtDate(row.due_at)}</span>
                  <span className={row.status === 'paid' ? 'text-emerald-400' : row.status === 'overdue' ? 'text-red-400' : 'text-slate-200'}>
                    {row.status === 'paid' ? `Paid ${money(row.amount)}` : `${money(row.amount - row.paid_amount)}${row.status === 'overdue' ? ' · overdue' : ''}`}
                  </span>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-slate-500 mt-2">Every {plan.frequency_days} days ({FREQUENCY_LABELS[plan.frequency_days] || ''}). Pay more or settle early whenever you like.</p>
          </Card>
        )}

        {plan.events?.length > 0 && (
          <Card>
            <p className="text-sm font-semibold text-white mb-2">History</p>
            <div className="space-y-1.5">
              {[...plan.events].reverse().map((ev, i) => (
                <div key={i} className="flex justify-between gap-2 text-xs">
                  <span className="text-slate-400">{ev.note || ev.kind}</span>
                  <span className="text-slate-500 shrink-0">{ev.amount ? `${money(ev.amount)} · ` : ''}{fmtDate(ev.at)}</span>
                </div>
              ))}
            </div>
          </Card>
        )}

        {plan.can_cancel && (
          <button
            className="w-full text-xs text-slate-500 hover:text-red-400 underline py-2"
            onClick={async () => {
              const fee = plan.cancel_fee_amount_now;
              const ok = window.confirm(plan.paid_amount > 0
                ? `Cancel this plan? ${fee > 0 ? `A ${terms.cancel_fee_pct}% fee (${money(fee)}) applies and the rest (${money(plan.paid_amount - fee)})` : `All ${money(plan.paid_amount)}`} goes back to your IcanEra wallet.`
                : 'Cancel this plan and release the items?');
              if (!ok) return;
              try { await cancelInstallmentPlan(plan.code); await after('Plan cancelled — your money is back in your wallet.'); } catch (err) { setNotice(err.message); }
            }}
          >
            Cancel this plan{plan.in_cooling_off ? ' (free for now)' : ''}
          </button>
        )}
      </div>
    </div>
  );
};

// ── Pay more ────────────────────────────────────────────────────────────────

const PayBox = ({ plan, terms, user, onDone, busyRef, feeMode = false }) => {
  const money = (v) => formatMoney(v, plan.currency);
  const nextSlot = plan.schedule?.find((r) => r.status !== 'paid');
  const unit = Number(plan.unit || 1);
  const dec = unitDecimals(unit);
  const price = Number(plan.coin_price || 0);
  const fixed = feeMode ? plan.balance_amount : plan.status === 'awaiting_deposit' ? plan.deposit_amount : null;
  const suggested = fixed ?? Math.min(plan.balance_amount, nextSlot ? Number((nextSlot.amount - nextSlot.paid_amount).toFixed(dec)) : plan.balance_amount);
  const [amount, setAmount] = useState(String(suggested));
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  const [walletCoins, setWalletCoins] = useState(null); // null = unknown
  useEffect(() => { setAmount(String(suggested)); }, [suggested]);
  useEffect(() => {
    let cancelled = false;
    getWalletCoins(user.id).then((v) => { if (!cancelled) setWalletCoins(v); });
    return () => { cancelled = true; };
  }, [user.id, plan.paid_amount]);

  const amt = fixed ?? (Number(amount) || 0);
  const minPay = Math.min(Number(terms.min_payment_amount || unit), plan.balance_amount);
  const problem = !amt ? 'Enter an amount' : amt > plan.balance_amount + 1e-9 ? `The most you can pay is ${money(plan.balance_amount)}` : amt + 1e-9 < minPay ? `The smallest payment is ${money(minPay)}` : '';
  const feePct = Number(terms.gateway_fee_pct ?? 3.5);
  const charge = amt ? Math.ceil(Number((amt / (1 - feePct / 100) / unit).toFixed(6))) * unit : 0;
  const amtCoins = coinsFor(amt, price);
  const walletShort = walletCoins !== null && amtCoins !== null && amt > 0 && walletCoins + 1e-9 < amtCoins;

  const run = async (kind) => {
    if (problem) { setError(problem); return; }
    setError(''); setBusy(kind); busyRef.current = true;
    try {
      if (kind === 'wallet') {
        const res = await payInstallmentFromWallet(plan.code, amt);
        await onDone(res.status === 'dispatched' ? 'Paid — a rider has been booked for your delivery.' : 'Payment received — thank you.');
      } else {
        const res = await payInstallmentWithFlutterwave(plan.code, amt, { name: plan.customer_name, phone: plan.customer_phone, title: plan.seller_name || 'IcanEra' });
        await onDone(res.status === 'dispatched' ? 'Paid — a rider has been booked for your delivery.' : 'Payment received — thank you.');
      }
    } catch (err) {
      setError(err.message || 'Payment failed. Please try again.');
    } finally {
      setBusy(null); busyRef.current = false;
    }
  };

  return (
    <Card>
      <p className="text-sm font-semibold text-white mb-2">{feeMode ? 'Pay the delivery fare' : plan.status === 'awaiting_deposit' ? 'Pay your deposit' : 'Make a payment'}</p>
      {fixed == null ? (
        <>
          <input
            className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2.5 text-white text-lg font-semibold"
            inputMode={dec ? 'decimal' : 'numeric'} value={fixed == null ? amount : ''} onChange={(e) => setAmount(cleanAmountInput(e.target.value, unit))} aria-label={`Amount to pay (${plan.currency})`}
          />
          <div className="flex gap-2 mt-2">
            {nextSlot && <button type="button" className="flex-1 py-1.5 rounded-lg border border-slate-800 text-xs text-slate-300 hover:bg-slate-800" onClick={() => setAmount(String(Number((nextSlot.amount - nextSlot.paid_amount).toFixed(dec))))}>Next payment</button>}
            <button type="button" className="flex-1 py-1.5 rounded-lg border border-slate-800 text-xs text-slate-300 hover:bg-slate-800" onClick={() => setAmount(String(plan.balance_amount))}>Pay it all · {money(plan.balance_amount)}</button>
          </div>
        </>
      ) : (
        <p className="text-2xl font-bold text-white">{money(fixed)}</p>
      )}
      {(error || problem) && amt > 0 && <p className="text-xs text-red-400 mt-2">{error || problem}</p>}
      <div className="space-y-2 mt-3">
        <p className="text-[11px] leading-relaxed text-emerald-400">★ {COIN_RECOMMENDATION}</p>
        <button type="button" disabled={!!busy || !!problem || walletShort} onClick={() => run('wallet')}
          className="w-full py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-semibold transition flex items-center justify-center gap-2">
          {busy === 'wallet' ? <Loader className="w-4 h-4 animate-spin" /> : <Wallet className="w-4 h-4" />}Pay {formatCoins(amt, price) || money(amt)} from IcanEra wallet
        </button>
        <button type="button" disabled={!!busy || !!problem} onClick={() => run('flutterwave')}
          className="w-full py-2.5 rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-semibold transition flex items-center justify-center gap-2">
          {busy === 'flutterwave' ? <Loader className="w-4 h-4 animate-spin" /> : <Smartphone className="w-4 h-4" />}Pay {money(charge)} with {plan.currency === 'UGX' ? 'Mobile Money, card or bank' : 'card, bank or mobile money'}
        </button>
        {walletCoins !== null && (
          <p className={`text-[11px] ${walletShort ? 'text-amber-400' : 'text-slate-500'}`}>
            {walletShort ? `Your IcanEra wallet has ${formatCoinAmount(walletCoins)} (about ${money(walletCoins * price)}) — not enough for this payment. Use card, bank or mobile money, or add to your wallet first.` : `Your IcanEra wallet: ${formatCoinAmount(walletCoins)} (about ${money(walletCoins * price)}).`}
          </p>
        )}
        <p className="text-[11px] text-slate-500">Card, bank or mobile money adds a {money(charge - amt)} processing fee; the wallet has none. Your money is held for you and is only released to the seller when you collect, it is delivered{plan.cross_border ? ', or you confirm it arrived' : ''}.</p>
      </div>
    </Card>
  );
};

// ── Collect or deliver ──────────────────────────────────────────────────────

const Fulfilment = ({ plan, onDone, busyRef }) => {
  const money = (v) => formatMoney(v, plan.currency);
  const [mode, setMode] = useState(null); // 'pickup' | 'delivery'
  const [coords, setCoords] = useState(null);
  const [locating, setLocating] = useState(false);
  const [address, setAddress] = useState('');
  const [hours, setHours] = useState(4);
  const [vehicle, setVehicle] = useState(null);
  const [quote, setQuote] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => { setQuote(null); }, [coords, vehicle]);

  const shareLocation = () => {
    if (!navigator.geolocation) { setError('Your browser can\'t share location — choose collection instead.'); return; }
    setLocating(true); setError('');
    navigator.geolocation.getCurrentPosition(
      (pos) => { setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setLocating(false); },
      () => { setError('Could not get your location — please allow location access to book delivery.'); setLocating(false); },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };

  const run = async (name, fn) => {
    setError(''); setBusy(name); busyRef.current = true;
    try { await fn(); } catch (err) { setError(err.message || 'Something went wrong. Please try again.'); } finally { setBusy(null); busyRef.current = false; }
  };

  return (
    <Card>
      <p className="text-white font-semibold flex items-center gap-2"><CheckCircle className="w-4 h-4 text-emerald-400" />Your items are paid in full</p>
      <p className="text-sm text-slate-400 mt-1 mb-3">How would you like to get them?</p>
      <div className={`grid gap-2 ${plan.delivery_available ? 'grid-cols-2' : 'grid-cols-1'}`}>
        {[['pickup', Package, 'Collect', 'at the store · free'], ['delivery', Truck, 'Delivery', 'a rider brings it']].filter(([id]) => id !== 'delivery' || plan.delivery_available).map(([id, Icon, title, sub]) => (
          <button key={id} type="button" onClick={() => { setMode(id); setError(''); }}
            className={`rounded-xl border p-3 text-center transition ${mode === id ? 'border-indigo-500 bg-indigo-500/10' : 'border-slate-800 bg-slate-900 hover:bg-slate-800'}`}>
            <Icon className="w-6 h-6 mx-auto text-indigo-300 mb-1" />
            <span className="block text-sm font-semibold text-white">{title}</span>
            <span className="block text-[11px] text-slate-400">{sub}</span>
          </button>
        ))}
      </div>

      {mode === 'pickup' && (
        <div className="mt-3 space-y-2">
          <p className="text-sm text-slate-300 flex items-start gap-2"><MapPin className="w-4 h-4 mt-0.5 shrink-0 text-slate-500" />{plan.store_name}{plan.store_address ? `, ${plan.store_address}` : ''}</p>
          <p className="text-[11px] text-slate-500">You will get a pickup code. The store scans it when it hands your items over — only then is the seller paid.</p>
          <button type="button" disabled={!!busy} onClick={() => run('pickup', async () => { await chooseInstallmentPickup(plan.code); await onDone('Ready to collect — show your pickup code at the store.'); })}
            className="w-full py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-semibold transition flex items-center justify-center gap-2">
            {busy === 'pickup' ? <Loader className="w-4 h-4 animate-spin" /> : <QrCode className="w-4 h-4" />}Get my pickup code
          </button>
        </div>
      )}

      {mode === 'delivery' && (
        <div className="mt-3 space-y-2">
          <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Delivery address (street, landmark)"
            className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500" />
          <button type="button" onClick={shareLocation} disabled={locating}
            className={`w-full flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-semibold border transition ${coords ? 'border-emerald-700 bg-emerald-500/10 text-emerald-400' : 'border-slate-800 bg-slate-900 text-slate-300 hover:bg-slate-800'}`}>
            {locating ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <Navigation className="w-3.5 h-3.5" />}{coords ? 'Delivery location shared' : 'Share my delivery location'}
          </button>
          <div>
            <label className="flex items-center gap-1.5 text-xs text-slate-400 mb-1"><Clock className="w-3.5 h-3.5" />Deliver within</label>
            <select value={hours} onChange={(e) => setHours(Number(e.target.value))} className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white">
              {DELIVERY_WINDOWS.map((w) => <option key={w.hours} value={w.hours}>{w.label}</option>)}
            </select>
            <p className="mt-1 text-[11px] text-slate-500">If the rider misses this window you can reclaim your money from their account.</p>
          </div>
          <div>
            <label className="flex items-center gap-1.5 text-xs text-slate-400 mb-1"><Bike className="w-3.5 h-3.5" />Vehicle</label>
            <div className="flex gap-1.5">
              {VEHICLES.map((v) => (
                <button key={v.value ?? 'any'} type="button" onClick={() => setVehicle(v.value)}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-semibold border transition ${vehicle === v.value ? 'border-indigo-500 bg-indigo-500/10 text-white' : 'border-slate-800 bg-slate-900 text-slate-400 hover:bg-slate-800'}`}>{v.label}</button>
              ))}
            </div>
          </div>

          {!quote ? (
            <button type="button" disabled={!coords || !!busy}
              onClick={() => run('quote', async () => { setQuote(await quoteInstallmentDelivery(plan.code, coords.lat, coords.lng, vehicle ? [vehicle] : null)); })}
              className="w-full py-2.5 rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-semibold transition flex items-center justify-center gap-2">
              {busy === 'quote' ? <Loader className="w-4 h-4 animate-spin" /> : <Truck className="w-4 h-4" />}{coords ? 'Get the delivery price' : 'Share your location first'}
            </button>
          ) : (
            <div className="rounded-lg border border-slate-800 p-3 space-y-1">
              <div className="flex justify-between text-sm"><span className="text-slate-400">Rider</span><span className="text-white">{quote.rider_name} · ~{quote.rider_eta_min} min</span></div>
              {quote.subsidy_amount > 0 && <div className="flex justify-between text-sm"><span className="text-slate-400">Covered by the seller</span><span className="text-emerald-400">-{money(quote.subsidy_amount)}</span></div>}
              <div className="flex justify-between text-base font-semibold border-t border-slate-800 pt-1"><span className="text-slate-300">Delivery fare</span><span className="text-white">{quote.delivery_fee_amount > 0 ? money(quote.delivery_fee_amount) : 'Free'}</span></div>
              <button type="button" disabled={!!busy}
                onClick={() => run('deliver', async () => {
                  const res = await chooseInstallmentDelivery(plan.code, { address, lat: coords.lat, lng: coords.lng, maxHours: hours, vehicleTypes: vehicle ? [vehicle] : null });
                  await onDone(res.status === 'dispatched' ? 'A rider has been booked — your delivery is on its way.' : 'Delivery chosen — pay the fare below and a rider is booked at once.');
                })}
                className="w-full mt-2 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-semibold transition flex items-center justify-center gap-2">
                {busy === 'deliver' ? <Loader className="w-4 h-4 animate-spin" /> : null}{quote.delivery_fee_amount > 0 ? 'Choose delivery' : 'Book my free delivery'}
              </button>
            </div>
          )}
        </div>
      )}
      {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
    </Card>
  );
};

// ── Collecting ──────────────────────────────────────────────────────────────

const PickupCard = ({ plan }) => {
  const code = plan.pickup_code || plan.receipt_code;
  const url = useMemo(() => plan.verify_url || `https://bodagoera.icanera.space/verify/${code}`, [plan.verify_url, code]);
  return (
    <Card className="text-center">
      <p className="text-white font-semibold mb-1">Show this at the store</p>
      <p className="text-sm text-slate-400 mb-3">{plan.store_name}{plan.store_address ? `, ${plan.store_address}` : ''}</p>
      <div className="inline-block bg-white p-3 rounded-xl"><QRCodeCanvas value={url} size={168} includeMargin={false} /></div>
      <p className="mt-3 font-mono text-2xl tracking-[0.25em] text-white">{code}</p>
      <p className="text-[11px] text-slate-500 mt-2">The store scans this QR (or types the code) when it hands over your items. Only then is the seller paid — until then your money is held safe.</p>
    </Card>
  );
};

// ── Shops abroad: where to send it, then follow the parcel ──────────────────

const ADDRESS_KEY = 'icanera_ship_address';
const readAddress = () => { try { return JSON.parse(localStorage.getItem(ADDRESS_KEY) || '{}') || {}; } catch { return {}; } };

const FIELDS = [
  ['name', 'Full name', 'name'], ['phone', 'Phone (with country code)', 'tel'], ['line1', 'Street address', 'address-line1'],
  ['line2', 'Apartment, landmark (optional)', 'address-line2'], ['city', 'City / town', 'address-level2'],
  ['region', 'State / region (optional)', 'address-level1'], ['postal_code', 'Postal code (optional)', 'postal-code'], ['country', 'Country', 'country-name'],
];

const ShippingForm = ({ plan, onDone, busyRef }) => {
  const [addr, setAddr] = useState(() => ({ name: plan.customer_name || '', phone: plan.customer_phone || '', ...readAddress() }));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async () => {
    setError(''); setBusy(true); busyRef.current = true;
    try {
      await chooseInstallmentShipping(plan.code, { ...addr, note });
      try { localStorage.setItem(ADDRESS_KEY, JSON.stringify(addr)); } catch { /* private mode */ }
      await onDone('Thank you — the seller has been asked to ship your order.');
    } catch (err) {
      setError(err.message || 'Could not save your address.');
    } finally {
      setBusy(false); busyRef.current = false;
    }
  };
  return (
    <Card>
      <p className="text-white font-semibold flex items-center gap-2"><CheckCircle className="w-4 h-4 text-emerald-400" />Your order is paid in full</p>
      <p className="text-sm text-slate-400 mt-1 mb-3 flex items-start gap-2"><Plane className="w-4 h-4 mt-0.5 shrink-0 text-sky-300" />Where should {plan.seller_name || 'the seller'} send it? Your money stays held and is only paid to the seller when you confirm it arrived.</p>
      <div className="grid grid-cols-1 gap-2">
        {FIELDS.map(([key, label, auto]) => (
          <input key={key} value={addr[key] || ''} onChange={(e) => setAddr((a) => ({ ...a, [key]: e.target.value }))} placeholder={label} aria-label={label} autoComplete={auto}
            className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500" />
        ))}
        <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything the courier should know (optional)" rows={2} aria-label="Note for the courier"
          className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500" />
      </div>
      {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
      <button type="button" disabled={busy} onClick={submit}
        className="w-full mt-3 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-semibold transition flex items-center justify-center gap-2">
        {busy ? <Loader className="w-4 h-4 animate-spin" /> : <Plane className="w-4 h-4" />}Ship it to me
      </button>
      <p className="text-[11px] text-slate-500 mt-2">Import duties and taxes in your country, if any, are not included in the price.</p>
    </Card>
  );
};

const ShipmentCard = ({ plan, onDone, busyRef }) => {
  const [reporting, setReporting] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const sh = plan.shipment || {};
  const to = plan.shipping || {};
  const run = async (name, fn, message) => {
    setError(''); setBusy(name); busyRef.current = true;
    try { await fn(); await onDone(message); } catch (err) { setError(err.message || 'Something went wrong. Please try again.'); } finally { setBusy(''); busyRef.current = false; }
  };
  return (
    <Card>
      {plan.status === 'shipping_pending' && (
        <>
          <p className="text-white font-semibold flex items-center gap-2"><Package className="w-4 h-4 text-amber-300" />Waiting for the seller to ship</p>
          <p className="text-sm text-slate-400 mt-1">They have your address. If it isn't shipped by {fmtDate(plan.ship_deadline_at)} your money is returned to your wallet.</p>
        </>
      )}
      {plan.status === 'shipped' && (
        <>
          <p className="text-white font-semibold flex items-center gap-2"><Plane className="w-4 h-4 text-sky-300" />On its way to you</p>
          <div className="mt-2 space-y-1 text-sm">
            <div className="flex justify-between"><span className="text-slate-400">Carrier</span><span className="text-white">{sh.carrier}</span></div>
            <div className="flex justify-between"><span className="text-slate-400">Tracking number</span><span className="text-white font-mono">{sh.tracking_no}</span></div>
            {sh.eta_days && <div className="flex justify-between"><span className="text-slate-400">Usually takes</span><span className="text-white">about {sh.eta_days} days</span></div>}
            {/^https?:\/\//i.test(sh.tracking_url || '') && <a href={sh.tracking_url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-indigo-300 underline text-sm mt-1">Track the parcel <ExternalLink className="w-3.5 h-3.5" /></a>}
          </div>
          {!reporting ? (
            <div className="mt-3 space-y-2">
              <button type="button" disabled={!!busy} onClick={() => run('received', () => confirmInstallmentReceived(plan.code), 'Thank you — the seller has been paid.')}
                className="w-full py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-semibold transition flex items-center justify-center gap-2">
                {busy === 'received' ? <Loader className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}I received it — pay the seller
              </button>
              <button type="button" onClick={() => setReporting(true)} className="w-full text-xs text-slate-400 hover:text-red-400 underline py-1">There is a problem with my order</button>
              <p className="text-[11px] text-slate-500">If you do nothing, the seller is paid automatically {plan.auto_release_at ? `on ${fmtDate(plan.auto_release_at)}` : 'after the protection period'}.</p>
            </div>
          ) : (
            <div className="mt-3 space-y-2">
              <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder="What went wrong? (it hasn't arrived, it's damaged, it's not what you ordered…)" aria-label="What went wrong"
                className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500" />
              <button type="button" disabled={!!busy} onClick={() => run('report', () => reportInstallmentProblem(plan.code, text), 'We have your report — your money stays held while support looks at it.')}
                className="w-full py-2.5 rounded-lg bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-sm font-semibold transition flex items-center justify-center gap-2">
                {busy === 'report' ? <Loader className="w-4 h-4 animate-spin" /> : null}Report the problem
              </button>
              <button type="button" onClick={() => setReporting(false)} className="w-full text-xs text-slate-400 underline py-1">Back</button>
            </div>
          )}
        </>
      )}
      {plan.status === 'disputed' && (
        <>
          <p className="text-white font-semibold flex items-center gap-2"><AlertCircle className="w-4 h-4 text-red-300" />Under review</p>
          <p className="text-sm text-slate-400 mt-1">Your report: “{plan.problem?.note}”. Your money stays held while support decides — you will get a refund or the seller is paid, based on what they find.</p>
        </>
      )}
      {(to.line1 || to.city) && (
        <p className="text-[11px] text-slate-500 mt-3 flex items-start gap-1.5"><MapPin className="w-3.5 h-3.5 mt-0.5 shrink-0" />Sending to {[to.name, to.line1, to.line2, to.city, to.region, to.postal_code, to.country].filter(Boolean).join(', ')}</p>
      )}
      {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
    </Card>
  );
};

export default PublicInstallmentPlan;
