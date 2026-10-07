import React, { useEffect, useState } from 'react';
import { Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import {
  getCardQrInfo, submitCardQrRequest, payWithCardPin, getCardQrAccountName, listUgandaBanks,
  getCardPayInfo, quoteCardPayment, payCardWithFlutterwave, resumePendingCardPayment,
} from '../services/digitalCardService';
import { detectUgandaMobileNetwork } from '../services/icanWalletService';

/**
 * Public page opened by scanning someone's IcanEra card QR. No account needed.
 * Works like a card terminal: the card owner types their transaction PIN right
 * here and the payout is approved on the spot (no phone of their own needed).
 * If the owner turned PIN approval off, or they don't have the PIN, this falls
 * back to sending them a request they confirm later in their wallet.
 * Route: /card-pay/:token
 *
 * The same QR also lets the scanner PAY the card holder (personal or business card) with Mobile Money, card or
 * bank through Flutterwave — no account, no PIN. The server fixes the amount and fee, confirms the payment
 * with Flutterwave and credits the holder's wallet. That is the first option when it is available.
 */
const CardPayPage = ({ token }) => {
  const [info, setInfo] = useState(undefined); // undefined = loading, null = invalid
  const [form, setForm] = useState({ name: '', phone: '', network: '', amount: '', note: '', pin: '', bankCode: '', beneficiary: '' });
  const [dest, setDest] = useState('momo'); // 'momo' | 'icanera' | 'bank' (PIN mode only)
  const [banks, setBanks] = useState([]);
  const [acctName, setAcctName] = useState(null); // masked IcanEra holder name, null = unknown
  const [mode, setMode] = useState('pin'); // 'pay' (Flutterwave) | 'pin' | 'request'
  const [payInfo, setPayInfo] = useState(null); // { found, kind, holder_name, fee_pct, min_ugx, max_ugx }
  const [pay, setPay] = useState({ name: '', phone: '', amount: '', note: '' });
  const [quote, setQuote] = useState(null); // { amount_ugx, processing_fee_ugx, charge_ugx }
  const [quoteError, setQuoteError] = useState(null);
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

  // Show the total (amount + gateway fee) as the payer types the amount.
  useEffect(() => {
    setQuote(null);
    setQuoteError(null);
    const amount = Number(pay.amount);
    if (mode !== 'pay' || !payInfo || !amount) return undefined;
    if (amount < payInfo.min_ugx || amount > payInfo.max_ugx) {
      setQuoteError(`Amount must be between UGX ${payInfo.min_ugx.toLocaleString()} and UGX ${payInfo.max_ugx.toLocaleString()}`);
      return undefined;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      quoteCardPayment(token, amount).then((q) => { if (!cancelled) setQuote(q); })
        .catch((err) => { if (!cancelled) setQuoteError(err.message); });
    }, 400);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [mode, payInfo, pay.amount, token]);

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
    if (pay.name.trim().length < 2) { setError('Enter your name'); return; }
    if (pay.phone.replace(/[^0-9]/g, '').length < 9) { setError('Enter the phone number you will pay with'); return; }
    if (!quote) { setError(quoteError || 'Enter the amount you want to pay'); return; }
    setBusy(true);
    try {
      const r = await payCardWithFlutterwave({
        token, amount: Number(pay.amount), name: pay.name.trim(), phone: pay.phone.trim(), note: pay.note.trim(),
        holderName: payInfo.holder_name, expectedCharge: quote.charge_ugx,
      });
      setDone({ kind: 'flw', amount: r.amount_ugx, charged: r.charged_ugx, fee: r.processing_fee_ugx, code: r.code });
    } catch (err) {
      setError(err.message || 'Payment failed. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const input = 'w-full px-3 py-3 rounded-lg bg-slate-800 border border-slate-600 text-white placeholder-gray-500 focus:outline-none focus:border-blue-400';

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-slate-800/70 border border-slate-700 rounded-2xl p-6 text-white">
        {info === undefined && <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div>}
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
              UGX {Number(done.amount).toLocaleString()} has been paid to {payInfo?.holder_name || info.holder_first_name}.
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
                IcanEra {payInfo.kind === 'business' ? 'business ' : ''}card ending {info.last4}. Pay with Mobile Money, card or bank — no account needed.
              </p>
            </div>
            <input className={input} placeholder="Your name" value={pay.name} onChange={setP('name')} autoComplete="name" required />
            <input className={input} placeholder="Phone you will pay with (07…)" inputMode="tel" value={pay.phone} onChange={setP('phone')} autoComplete="tel" required />
            <input className={input} placeholder="Amount (UGX)" inputMode="numeric" type="number" min={payInfo.min_ugx} max={payInfo.max_ugx} value={pay.amount} onChange={setP('amount')} required />
            <input className={input} placeholder="What is it for? (optional)" maxLength={140} value={pay.note} onChange={setP('note')} />
            {quote && (
              <p className="text-xs text-gray-300">
                Includes a UGX {Number(quote.processing_fee_ugx).toLocaleString()} payment-processing fee. {payInfo.holder_name} receives the full UGX {Number(quote.amount_ugx).toLocaleString()}.
              </p>
            )}
            {quoteError && !error && <p className="text-xs text-amber-300">{quoteError}</p>}
            {error && <p className="text-sm text-red-400">{error}</p>}
            <button disabled={busy || !quote} className="w-full py-3 rounded-lg bg-gradient-to-r from-blue-500 to-cyan-500 font-semibold disabled:opacity-50">
              {busy ? 'Please wait…' : quote ? `Pay UGX ${Number(quote.charge_ugx).toLocaleString()}` : 'Enter an amount'}
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
    </div>
  );
};

export default CardPayPage;
