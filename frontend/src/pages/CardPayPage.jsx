import React, { Suspense, lazy, useEffect, useState } from 'react';
import { Loader2, AlertCircle, CheckCircle2, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  getCardQrInfo, submitCardQrRequest, payWithCardPin, getCardQrAccountName, listUgandaBanks,
  getCardPayInfo, quoteCardPayment, payCardWithFlutterwave, resumePendingCardPayment,
  quoteCardWalletPayment, payCardWithWallet,
} from '../services/digitalCardService';
import { detectUgandaMobileNetwork } from '../services/icanWalletService';
import LoadingPage from '../components/LoadingPage';

// Only loaded when a scanner chooses a wallet option and needs to sign in.
const AuthPageLazy = lazy(() => import('../components/auth').then((m) => ({ default: m.AuthPage })));

const PAY_METHODS = [
  { id: 'wallet_local', label: 'My wallet', wallet: true },
  { id: 'wallet_ican', label: 'ICAN coins', wallet: true },
  { id: 'card', label: 'Visa / Mastercard', options: 'card' },
  { id: 'momo', label: 'Mobile Money / Bank', options: 'mobilemoneyuganda,account' },
];

/**
 * Public page opened by scanning someone's IcanEra card QR. No account needed.
 * Works like a card terminal: the card owner types their transaction PIN right
 * here and the payout is approved on the spot (no phone of their own needed).
 * If the owner turned PIN approval off, or they don't have the PIN, this falls
 * back to sending them a request they confirm later in their wallet.
 * Route: /card-pay/:token
 *
 * The same QR also lets the scanner PAY the card holder (personal or business card) four ways:
 *   - IcanEra wallet in the payer's OWN currency (any country) or with ICAN coins — sign in, no fee, the
 *     amount is typed in their currency and priced at the live coin value;
 *   - Visa / Mastercard, or Mobile Money / bank, through Flutterwave — no account, no PIN. The server fixes the
 *     amount and fee, confirms the payment with Flutterwave and credits the holder's wallet.
 * That is the first option when it is available.
 */
const CardPayPage = ({ token }) => {
  const { user } = useAuth();
  const [info, setInfo] = useState(undefined); // undefined = loading, null = invalid
  const [form, setForm] = useState({ name: '', phone: '', network: '', amount: '', note: '', pin: '', bankCode: '', beneficiary: '' });
  const [dest, setDest] = useState('momo'); // 'momo' | 'icanera' | 'bank' (PIN mode only)
  const [banks, setBanks] = useState([]);
  const [acctName, setAcctName] = useState(null); // masked IcanEra holder name, null = unknown
  const [mode, setMode] = useState('pin'); // 'pay' (Flutterwave) | 'pin' | 'request'
  const [payInfo, setPayInfo] = useState(null); // { found, kind, holder_name, fee_pct, min_ugx, max_ugx }
  const [pay, setPay] = useState({ name: '', phone: '', amount: '', note: '' });
  const [quote, setQuote] = useState(null); // Flutterwave: { amount_ugx, processing_fee_ugx, charge_ugx }; wallet: { currency, amount_local, ican_amount, amount_ugx, local_balance, ican_balance }
  const [quoteError, setQuoteError] = useState(null);
  const [payMethod, setPayMethod] = useState(null); // one of PAY_METHODS ids; null = pick a sensible default
  const [wallet, setWallet] = useState(null); // signed-in payer: { currency, price_local, local_balance, ican_balance }
  const [showAuth, setShowAuth] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null); // { kind: 'paid' | 'requested', amount }

  useEffect(() => {
    let cancelled = false;
    Promise.all([getCardQrInfo(token), getCardPayInfo(token)]).then(([i, p]) => {
      if (cancelled) return;
      setInfo(i);
      const canPay = Boolean(i && p?.found);
      setPayInfo(canPay ? p : null);
      setMode(canPay ? 'pay' : i && !i.pin_pay_enabled ? 'request' : 'pin');
    }).catch(() => { if (!cancelled) setInfo(null); });
    // Paid on an earlier scan but the tab closed before it was confirmed? Finish that first.
    resumePendingCardPayment(token).then((r) => { if (r && !cancelled) setDone({ kind: 'flw', amount: r.amount_ugx, charged: r.charged_ugx, fee: r.processing_fee_ugx, code: r.code }); });
    return () => { cancelled = true; };
  }, [token]);

  // Wallet options need the SQL (wallet_ok); until the payer picks one, a signed-in payer starts on their wallet.
  const walletOk = Boolean(payInfo?.wallet_ok);
  const methods = PAY_METHODS.filter((m) => !m.wallet || walletOk);
  const method = methods.find((m) => m.id === payMethod) || methods.find((m) => m.id === (user ? 'wallet_local' : 'momo')) || methods[0];
  const isWallet = Boolean(method?.wallet);
  const needsSignIn = isWallet && !user;
  const userId = user?.id;
  // Wallet payments are typed in the payer's own currency; Flutterwave ones are charged in UGX.
  const amountCurrency = isWallet ? (wallet?.currency || '…') : 'UGX';
  const fmtLocal = (n) => Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
  const fmtCoins = (n) => Number(n).toLocaleString(undefined, { maximumFractionDigits: 6 });

  // The payer's own currency, the live coin price in it and their balances (the server decides all of it).
  useEffect(() => {
    setWallet(null);
    if (!userId || !walletOk) return undefined;
    let cancelled = false;
    quoteCardWalletPayment(token, null).then((w) => { if (!cancelled) setWallet(w); }).catch(() => {});
    return () => { cancelled = true; };
  }, [userId, walletOk, token]);

  // The number typed means a different currency per method group — don't carry it across.
  const pickMethod = (m) => {
    if (Boolean(m.wallet) !== isWallet) setPay((f) => ({ ...f, amount: '' }));
    setPayMethod(m.id);
    setError(null);
  };

  // Show the total as the payer types the amount: amount + gateway fee for Flutterwave, the exact cost
  // in the chosen wallet (with their balance) for a wallet payment.
  useEffect(() => {
    setQuote(null);
    setQuoteError(null);
    const amount = Number(pay.amount);
    if (mode !== 'pay' || !payInfo || !amount) return undefined;
    // Wallet amounts are in the payer's own currency; the server checks their size (UGX 500 – 5,000,000 of value).
    if (!isWallet && (amount < payInfo.min_ugx || amount > payInfo.max_ugx)) {
      setQuoteError(`Amount must be between UGX ${payInfo.min_ugx.toLocaleString()} and UGX ${payInfo.max_ugx.toLocaleString()}`);
      return undefined;
    }
    if (needsSignIn) return undefined;
    let cancelled = false;
    const timer = setTimeout(() => {
      (isWallet ? quoteCardWalletPayment(token, amount) : quoteCardPayment(token, amount))
        .then((q) => { if (!cancelled) setQuote(q); })
        .catch((err) => { if (!cancelled) setQuoteError(err.message); });
    }, 400);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [mode, payInfo, pay.amount, token, isWallet, needsSignIn, userId]);

  useEffect(() => {
    if (dest !== 'bank' || banks.length) return;
    listUgandaBanks().then(setBanks).catch(() => setError('Could not load the bank list'));
  }, [dest, banks.length]);

  useEffect(() => {
    setAcctName(null);
    if (dest !== 'icanera' || !/^\d{16}$/.test(form.phone.trim())) return;
    getCardQrAccountName(token, form.phone.trim()).then(setAcctName).catch(() => setAcctName(null));
  }, [dest, form.phone, token]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const network = form.network || detectUgandaMobileNetwork(form.phone) || '';
  const pinMode = mode === 'pin';

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    const useDest = pinMode ? dest : 'momo';
    if (useDest === 'momo' && !network) { setError('Choose MTN or Airtel'); return; }
    if (useDest === 'icanera' && !acctName) { setError('Enter a valid 16-digit IcanEra account number'); return; }
    setBusy(true);
    try {
      const amount = Number(form.amount);
      if (pinMode) {
        await payWithCardPin({ token, pin: form.pin, phone: form.phone, network, amount, note: form.note,
          destType: dest, bankCode: form.bankCode, beneficiaryName: form.beneficiary });
        setDone({ kind: 'paid', amount, dest });
      } else {
        await submitCardQrRequest({ token, name: form.name, phone: form.phone, network, amount, note: form.note });
        setDone({ kind: 'requested', amount });
      }
    } catch (err) {
      setError(err.message || 'Could not complete this');
    } finally {
      setBusy(false);
      setForm((f) => ({ ...f, pin: '' })); // never keep a PIN on a shared screen
    }
  };

  const setP = (k) => (e) => setPay((f) => ({ ...f, [k]: e.target.value }));

  const submitPay = async (e) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    if (needsSignIn) { setShowAuth(true); return; }
    if (isWallet) {
      if (!quote) { setError(quoteError || 'Enter the amount you want to pay'); return; }
      const source = method.id === 'wallet_ican' ? 'ican' : 'local';
      if (source === 'local' && Number(quote.local_balance) < Number(quote.amount_local)) { setError(`Your ${quote.currency} wallet does not have enough money for this. Try ICAN coins or another way to pay.`); return; }
      if (source === 'ican' && Number(quote.ican_balance) < Number(quote.ican_amount)) { setError(`You do not have enough ICAN coins for this. Try your ${quote.currency} wallet or another way to pay.`); return; }
      setBusy(true);
      try {
        const r = await payCardWithWallet({ token, amount: Number(pay.amount), source, note: pay.note.trim() });
        setDone({ kind: 'flw', amount: r.amount_local, currency: r.currency, charged: r.amount_local, fee: 0, code: r.code, wallet: source, ican: r.ican_amount });
      } catch (err) {
        setError(err.message || 'Payment failed. Please try again.');
      } finally {
        setBusy(false);
      }
      return;
    }
    if (pay.name.trim().length < 2) { setError('Enter your name'); return; }
    if (pay.phone.replace(/[^0-9]/g, '').length < 9) { setError('Enter the phone number you will pay with'); return; }
    if (!quote) { setError(quoteError || 'Enter the amount you want to pay'); return; }
    setBusy(true);
    try {
      const r = await payCardWithFlutterwave({
        token, amount: Number(pay.amount), name: pay.name.trim(), phone: pay.phone.trim(), note: pay.note.trim(),
        holderName: payInfo.holder_name, expectedCharge: quote.charge_ugx, paymentOptions: method.options,
      });
      setDone({ kind: 'flw', amount: r.amount_ugx, charged: r.charged_ugx, fee: r.processing_fee_ugx, code: r.code });
    } catch (err) {
      setError(err.message || 'Payment failed. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const input = 'w-full px-3 py-3 rounded-lg bg-slate-800 border border-slate-600 text-white placeholder-gray-500 focus:outline-none focus:border-blue-400';

  if (info === undefined) return <LoadingPage tone="ice" label="Preparing your card payment…" />;

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-slate-800/70 border border-slate-700 rounded-2xl p-6 text-white">
        {info === null && (
          <div className="text-center py-6">
            <AlertCircle className="w-10 h-10 text-red-400 mx-auto mb-3" />
            <p className="font-semibold">This QR code is not active</p>
            <p className="text-sm text-gray-400 mt-1">Ask the card owner for a new one.</p>
          </div>
        )}
        {info && done?.kind === 'paid' && (
          <div className="text-center py-6">
            <CheckCircle2 className="w-10 h-10 text-green-400 mx-auto mb-3" />
            <p className="font-semibold">Approved</p>
            <p className="text-sm text-gray-400 mt-1">{done.amount.toLocaleString()} UGX {done.dest === 'icanera' ? `is already in IcanEra account ${form.phone}.` : `is on its way to ${form.phone}. It is refunded to the card owner automatically if it is rejected.`}</p>
          </div>
        )}
        {info && done?.kind === 'flw' && (
          <div className="text-center py-6">
            <CheckCircle2 className="w-10 h-10 text-green-400 mx-auto mb-3" />
            <p className="font-semibold">Payment received — thank you!</p>
            <p className="text-sm text-gray-400 mt-1">
              {done.currency || 'UGX'} {Number(done.amount).toLocaleString(undefined, { maximumFractionDigits: 2 })} has been paid to {payInfo?.holder_name || info.holder_first_name}
              {done.wallet === 'ican' ? ` with ${Number(done.ican).toLocaleString(undefined, { maximumFractionDigits: 6 })} ICAN coins from your wallet.`
                : done.wallet === 'local' ? ` from your ${done.currency} wallet.` : '.'}
              {done.fee > 0 ? ` Total charged UGX ${Number(done.charged).toLocaleString()} (includes a UGX ${Number(done.fee).toLocaleString()} processing fee).` : ''}
            </p>
            {done.code && <a href={`/r/${done.code}`} className="inline-block mt-3 text-sm text-blue-300 underline">View your receipt</a>}
          </div>
        )}
        {info && done?.kind === 'requested' && (
          <div className="text-center py-6">
            <CheckCircle2 className="w-10 h-10 text-green-400 mx-auto mb-3" />
            <p className="font-semibold">Request sent to {info.holder_first_name}</p>
            <p className="text-sm text-gray-400 mt-1">They must confirm it in their wallet before any money is sent to {form.phone}.</p>
          </div>
        )}
        {info && !done && payInfo && (
          <div className="grid grid-cols-2 gap-1 mb-4">
            {[['pay', `Pay ${payInfo.holder_name}`], ['other', 'Ask for money']].map(([k, label]) => {
              const on = k === 'pay' ? mode === 'pay' : mode !== 'pay';
              return (
                <button type="button" key={k} onClick={() => { setError(null); setMode(k === 'pay' ? 'pay' : (info.pin_pay_enabled ? 'pin' : 'request')); }}
                  className={`py-2 rounded-lg text-xs font-semibold border ${on ? 'border-blue-400 bg-blue-500/20' : 'border-slate-600'}`}>{label}</button>
              );
            })}
          </div>
        )}
        {info && !done && mode === 'pay' && payInfo && (
          <form onSubmit={submitPay} className="space-y-3">
            <div>
              <h1 className="text-lg font-bold">Pay {payInfo.holder_name}</h1>
              <p className="text-xs text-gray-400">
                IcanEra {payInfo.kind === 'business' ? 'business ' : ''}card ending {info.last4}.{' '}
                {walletOk ? 'Pay from your IcanEra wallet in your own currency, with ICAN coins, a Visa or Mastercard, or Mobile Money / bank.' : 'Pay with Mobile Money, card or bank — no account needed.'}
              </p>
            </div>
            {methods.length > 1 && (
              <div className="grid grid-cols-2 gap-1">
                {methods.map((m) => (
                  <button type="button" key={m.id} onClick={() => pickMethod(m)}
                    className={`py-2 rounded-lg text-xs font-semibold border ${method.id === m.id ? 'border-blue-400 bg-blue-500/20' : 'border-slate-600'}`}>
                    {m.id === 'wallet_local' && wallet?.currency ? `My wallet · ${wallet.currency}` : m.label}
                  </button>
                ))}
              </div>
            )}
            {!isWallet && (
              <>
                <input className={input} placeholder="Your name" value={pay.name} onChange={setP('name')} autoComplete="name" required />
                <input className={input} placeholder="Phone you will pay with (07…)" inputMode="tel" value={pay.phone} onChange={setP('phone')} autoComplete="tel" required />
              </>
            )}
            <input className={input} placeholder={`Amount (${amountCurrency})`} inputMode="decimal" type="number" step={isWallet ? 'any' : '1'}
              min={isWallet ? undefined : payInfo.min_ugx} max={isWallet ? undefined : payInfo.max_ugx} value={pay.amount} onChange={setP('amount')} required />
            <input className={input} placeholder="What is it for? (optional)" maxLength={140} value={pay.note} onChange={setP('note')} />
            {needsSignIn && (
              <p className="text-xs text-gray-300">Sign in to your IcanEra account to pay from your wallet in your own currency — no processing fee. No account? Use Visa / Mastercard or Mobile Money / Bank.</p>
            )}
            {!isWallet && walletOk && (
              <p className="text-xs text-gray-400">Card, Mobile Money and bank payments are charged in UGX (a card from another country is converted by its bank). Your IcanEra wallet pays in your own currency instead.</p>
            )}
            {quote && !isWallet && (
              <p className="text-xs text-gray-300">
                Includes a UGX {Number(quote.processing_fee_ugx).toLocaleString()} payment-processing fee. {payInfo.holder_name} receives the full UGX {Number(quote.amount_ugx).toLocaleString()}. Pay your IcanEra wallet to skip the fee.
              </p>
            )}
            {quote && isWallet && (
              <p className="text-xs text-gray-300">
                {method.id === 'wallet_ican'
                  ? `Costs ${fmtCoins(quote.ican_amount)} ICAN — ${quote.currency} ${fmtLocal(quote.amount_local)} at today's live value. You have ${fmtCoins(quote.ican_balance)} ICAN.`
                  : `Takes ${quote.currency} ${fmtLocal(quote.amount_local)} from your ${quote.currency} wallet (you have ${quote.currency} ${fmtLocal(quote.local_balance)}).`}
                {' '}No processing fee, and {payInfo.holder_name} receives the full value.
              </p>
            )}
            {quoteError && !error && <p className="text-xs text-amber-300">{quoteError}</p>}
            {error && <p className="text-sm text-red-400">{error}</p>}
            <button disabled={busy || (!quote && !needsSignIn)} className="w-full py-3 rounded-lg bg-gradient-to-r from-blue-500 to-cyan-500 font-semibold disabled:opacity-50">
              {busy ? 'Please wait…' : needsSignIn ? 'Sign in to pay' : quote ? (isWallet ? `Pay ${quote.currency} ${fmtLocal(quote.amount_local)}` : `Pay UGX ${Number(quote.charge_ugx).toLocaleString()}`) : 'Enter an amount'}
            </button>
          </form>
        )}
        {info && !done && mode !== 'pay' && (
          <form onSubmit={submit} className="space-y-3">
            <div>
              <h1 className="text-lg font-bold">{pinMode ? `Pay with ${info.holder_first_name}'s card` : `Request money from ${info.holder_first_name}`}</h1>
              <p className="text-xs text-gray-400">
                IcanEra card ending {info.last4}. {pinMode ? 'The card owner approves by entering their PIN below.' : 'Money is only sent if they approve.'}
              </p>
            </div>
            {!pinMode && <input className={input} placeholder="Your name" value={form.name} onChange={set('name')} required />}
            {pinMode && (
              <div className="grid grid-cols-3 gap-1">
                {[['momo', 'Mobile money'], ['icanera', 'IcanEra'], ['bank', 'Bank']].map(([k, label]) => (
                  <button type="button" key={k} onClick={() => { setDest(k); setError(null); setForm((f) => ({ ...f, phone: '' })); }}
                    className={`py-2 rounded-lg text-xs font-semibold border ${dest === k ? 'border-blue-400 bg-blue-500/20' : 'border-slate-600'}`}>{label}</button>
                ))}
              </div>
            )}
            <input className={input}
              placeholder={!pinMode || dest === 'momo' ? 'Mobile money number (07…)' : dest === 'icanera' ? 'IcanEra account number (16 digits)' : 'Bank account number'}
              inputMode={!pinMode || dest === 'momo' ? 'tel' : 'numeric'} value={form.phone} onChange={set('phone')} required />
            {(!pinMode || dest === 'momo') && (
              <div className="grid grid-cols-2 gap-2">
                {['MTN', 'AIRTEL'].map((n) => (
                  <button type="button" key={n} onClick={() => setForm((f) => ({ ...f, network: n }))}
                    className={`py-2 rounded-lg text-sm font-semibold border ${network === n ? 'border-blue-400 bg-blue-500/20' : 'border-slate-600'}`}>{n === 'MTN' ? 'MTN' : 'Airtel'}</button>
                ))}
              </div>
            )}
            {pinMode && dest === 'icanera' && /^\d{16}$/.test(form.phone.trim()) && (
              <p className={`text-xs ${acctName ? 'text-green-300' : 'text-red-300'}`}>
                {acctName ? `✓ Account holder: ${acctName}` : 'No personal IcanEra account found with this number'}
              </p>
            )}
            {pinMode && dest === 'bank' && (
              <>
                <select className={input} value={form.bankCode} onChange={set('bankCode')} required>
                  <option value="">{banks.length ? 'Choose bank' : 'Loading banks…'}</option>
                  {banks.map((b) => <option key={b.code} value={b.code}>{b.name}</option>)}
                </select>
                <input className={input} placeholder="Account holder name" maxLength={80} value={form.beneficiary} onChange={set('beneficiary')} required />
                <p className="text-xs text-amber-300">Bank account names can't be checked in advance. Double-check the number and name.</p>
              </>
            )}
            <input className={input} placeholder="Amount (UGX)" inputMode="numeric" type="number" min="1000" max="5000000" value={form.amount} onChange={set('amount')} required />
            <input className={input} placeholder="Reason (optional)" maxLength={140} value={form.note} onChange={set('note')} />
            {pinMode && (
              <input className={`${input} tracking-[0.5em] text-center`} placeholder="Card PIN" type="password" inputMode="numeric"
                autoComplete="off" pattern="[0-9]{4,6}" maxLength={6} value={form.pin} onChange={set('pin')} required />
            )}
            {error && <p className="text-sm text-red-400">{error}</p>}
            <button disabled={busy} className="w-full py-3 rounded-lg bg-gradient-to-r from-blue-500 to-cyan-500 font-semibold disabled:opacity-50">
              {busy ? 'Please wait…' : pinMode ? 'Approve with PIN' : 'Send request'}
            </button>
            {info.pin_pay_enabled && (
              <button type="button" onClick={() => { setMode(pinMode ? 'request' : 'pin'); setError(null); }}
                className="w-full text-xs text-blue-300 underline">
                {pinMode ? "Card owner isn't here? Send them a request instead" : 'I have the card PIN — approve here'}
              </button>
            )}
          </form>
        )}
      </div>
      {showAuth && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900">
          <button type="button" onClick={() => setShowAuth(false)} aria-label="Close"
            className="fixed top-3 right-3 z-[51] p-2 rounded-full bg-slate-800 border border-slate-600 text-white"><X className="w-5 h-5" /></button>
          <Suspense fallback={<div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-white" /></div>}>
            <AuthPageLazy initialView="signin" onAuthSuccess={() => setShowAuth(false)} />
          </Suspense>
        </div>
      )}
    </div>
  );
};

export default CardPayPage;
