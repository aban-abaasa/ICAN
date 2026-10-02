import React, { useEffect, useState } from 'react';
import { Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { getCardQrInfo, submitCardQrRequest } from '../services/digitalCardService';
import { detectUgandaMobileNetwork } from '../services/icanWalletService';

/**
 * Public page opened by scanning someone's ICANera card QR. No account needed.
 * Sends a request to the card owner; money only moves if they confirm it.
 * Route: /card-pay/:token
 */
const CardPayPage = ({ token }) => {
  const [info, setInfo] = useState(undefined); // undefined = loading, null = invalid
  const [form, setForm] = useState({ name: '', phone: '', network: '', amount: '', note: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    getCardQrInfo(token).then(setInfo).catch(() => setInfo(null));
  }, [token]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const network = form.network || detectUgandaMobileNetwork(form.phone) || '';

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!network) { setError('Choose MTN or Airtel'); return; }
    setBusy(true);
    try {
      await submitCardQrRequest({ token, name: form.name, phone: form.phone, network, amount: Number(form.amount), note: form.note });
      setDone(true);
    } catch (err) {
      setError(err.message || 'Could not send your request');
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
        {info && done && (
          <div className="text-center py-6">
            <CheckCircle2 className="w-10 h-10 text-green-400 mx-auto mb-3" />
            <p className="font-semibold">Request sent to {info.holder_first_name}</p>
            <p className="text-sm text-gray-400 mt-1">They must confirm it in their wallet before any money is sent to {form.phone}.</p>
          </div>
        )}
        {info && !done && (
          <form onSubmit={submit} className="space-y-3">
            <div>
              <h1 className="text-lg font-bold">Request money from {info.holder_first_name}</h1>
              <p className="text-xs text-gray-400">ICANera card ending {info.last4}. Money is only sent if they approve.</p>
            </div>
            <input className={input} placeholder="Your name" value={form.name} onChange={set('name')} required />
            <input className={input} placeholder="Mobile money number (07…)" inputMode="tel" value={form.phone} onChange={set('phone')} required />
            <div className="grid grid-cols-2 gap-2">
              {['MTN', 'AIRTEL'].map((n) => (
                <button type="button" key={n} onClick={() => setForm((f) => ({ ...f, network: n }))}
                  className={`py-2 rounded-lg text-sm font-semibold border ${network === n ? 'border-blue-400 bg-blue-500/20' : 'border-slate-600'}`}>{n === 'MTN' ? 'MTN' : 'Airtel'}</button>
              ))}
            </div>
            <input className={input} placeholder="Amount (UGX)" inputMode="numeric" type="number" min="1000" max="5000000" value={form.amount} onChange={set('amount')} required />
            <input className={input} placeholder="Reason (optional)" maxLength={140} value={form.note} onChange={set('note')} />
            {error && <p className="text-sm text-red-400">{error}</p>}
            <button disabled={busy} className="w-full py-3 rounded-lg bg-gradient-to-r from-blue-500 to-cyan-500 font-semibold disabled:opacity-50">
              {busy ? 'Sending…' : 'Send request'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};

export default CardPayPage;
