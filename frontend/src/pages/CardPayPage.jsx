import React, { useEffect, useState } from 'react';
import { Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { getCardQrInfo, submitCardQrRequest, payWithCardPin, getCardQrAccountName, listUgandaBanks } from '../services/digitalCardService';
import { detectUgandaMobileNetwork } from '../services/icanWalletService';

/**
 * Public page opened by scanning someone's ICANera card QR. No account needed.
 * Works like a card terminal: the card owner types their transaction PIN right
 * here and the payout is approved on the spot (no phone of their own needed).
 * If the owner turned PIN approval off, or they don't have the PIN, this falls
 * back to sending them a request they confirm later in their wallet.
 * Route: /card-pay/:token
 */
const CardPayPage = ({ token }) => {
  const [info, setInfo] = useState(undefined); // undefined = loading, null = invalid
  const [form, setForm] = useState({ name: '', phone: '', network: '', amount: '', note: '', pin: '', bankCode: '', beneficiary: '' });
  const [dest, setDest] = useState('momo'); // 'momo' | 'icanera' | 'bank' (PIN mode only)
  const [banks, setBanks] = useState([]);
  const [acctName, setAcctName] = useState(null); // masked ICANera holder name, null = unknown
  const [mode, setMode] = useState('pin'); // 'pin' | 'request'
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null); // { kind: 'paid' | 'requested', amount }

  useEffect(() => {
    getCardQrInfo(token).then((i) => {
      setInfo(i);
      if (i && !i.pin_pay_enabled) setMode('request');
    }).catch(() => setInfo(null));
  }, [token]);

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
    if (useDest === 'icanera' && !acctName) { setError('Enter a valid 16-digit ICANera account number'); return; }
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
            <p className="text-sm text-gray-400 mt-1">{done.amount.toLocaleString()} UGX {done.dest === 'icanera' ? `is already in ICANera account ${form.phone}.` : `is on its way to ${form.phone}. It is refunded to the card owner automatically if it is rejected.`}</p>
          </div>
        )}
        {info && done?.kind === 'requested' && (
          <div className="text-center py-6">
            <CheckCircle2 className="w-10 h-10 text-green-400 mx-auto mb-3" />
            <p className="font-semibold">Request sent to {info.holder_first_name}</p>
            <p className="text-sm text-gray-400 mt-1">They must confirm it in their wallet before any money is sent to {form.phone}.</p>
          </div>
        )}
        {info && !done && (
          <form onSubmit={submit} className="space-y-3">
            <div>
              <h1 className="text-lg font-bold">{pinMode ? `Pay with ${info.holder_first_name}'s card` : `Request money from ${info.holder_first_name}`}</h1>
              <p className="text-xs text-gray-400">
                ICANera card ending {info.last4}. {pinMode ? 'The card owner approves by entering their PIN below.' : 'Money is only sent if they approve.'}
              </p>
            </div>
            {!pinMode && <input className={input} placeholder="Your name" value={form.name} onChange={set('name')} required />}
            {pinMode && (
              <div className="grid grid-cols-3 gap-1">
                {[['momo', 'Mobile money'], ['icanera', 'ICANera'], ['bank', 'Bank']].map(([k, label]) => (
                  <button type="button" key={k} onClick={() => { setDest(k); setError(null); setForm((f) => ({ ...f, phone: '' })); }}
                    className={`py-2 rounded-lg text-xs font-semibold border ${dest === k ? 'border-blue-400 bg-blue-500/20' : 'border-slate-600'}`}>{label}</button>
                ))}
              </div>
            )}
            <input className={input}
              placeholder={!pinMode || dest === 'momo' ? 'Mobile money number (07…)' : dest === 'icanera' ? 'ICANera account number (16 digits)' : 'Bank account number'}
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
                {acctName ? `✓ Account holder: ${acctName}` : 'No personal ICANera account found with this number'}
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
