import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Wallet, Smartphone, Banknote, Lock, Check, AlertCircle, Users } from 'lucide-react';
import ChurchPicker, { saveLastChurch } from './ChurchPicker';
import { getSupabaseClient } from '../lib/supabase/client';
import {
  GIVING_TYPES, MIN_GIFT_UGX, confirmWalletPin, giveToChurch, giveToChurchWithFlutterwave,
  getMyChurches, getReceivedTithes, confirmCashReceived, setAcceptsTithe,
} from '../services/churchTitheService';

const QUICK_AMOUNTS = [5000, 10000, 20000, 50000, 100000];
const fmt = (n) => Number(n || 0).toLocaleString();

const PAY_METHODS = [
  { id: 'wallet', label: 'IcanEra Wallet', sub: 'PIN required', Icon: Wallet },
  { id: 'flutterwave', label: 'Mobile Money / Card', sub: 'MTN · Airtel · Visa', Icon: Smartphone },
  { id: 'cash', label: 'Cash', sub: 'Given by hand', Icon: Banknote },
];


/**
 * Give to a church registered on IcanEra: search (or optionally load them all), choose how to give
 * — IcanEra wallet (PIN), mobile money / card (Flutterwave) or cash — and send.
 *
 * Props: askPin (from usePinPrompt), onGiven(payment) after a successful gift, and optionally
 * walletBalance (when the host page already tracks it; otherwise the IcanEra wallet balance is read here).
 */
export default function ChurchTitheGiving({ askPin, walletBalance: balanceProp, onGiven }) {
  const [ownBalance, setOwnBalance] = useState(0);
  const walletBalance = balanceProp ?? ownBalance;
  const refreshBalance = useCallback(async () => {
    try {
      const { data } = await getSupabaseClient().from('wallet_accounts').select('balance').eq('currency', 'UGX').maybeSingle();
      if (data) setOwnBalance(Number(data.balance) || 0);
    } catch { /* balance is only a convenience; the server re-checks it */ }
  }, []);
  useEffect(() => { if (balanceProp === undefined) refreshBalance(); }, [balanceProp, refreshBalance]);

  const [church, setChurch] = useState(null);

  const [givingType, setGivingType] = useState('tithe');
  const [amount, setAmount] = useState('');
  const [income, setIncome] = useState('');
  const [method, setMethod] = useState('wallet');
  const [anonymous, setAnonymous] = useState(false);
  const [message, setMessage] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null); // { type: 'ok'|'err', text }

  const amountNum = Math.floor(Number(amount) || 0);
  const tenPercent = Math.round((Number(income) || 0) * 0.1);
  const walletShort = method === 'wallet' && amountNum > walletBalance;

  const pick = (c) => { setChurch(c); setMsg(null); };

  const give = async () => {
    if (!church) return setMsg({ type: 'err', text: 'Choose a church first' });
    if (amountNum < MIN_GIFT_UGX) return setMsg({ type: 'err', text: `The smallest gift is UGX ${fmt(MIN_GIFT_UGX)}` });
    if (walletShort) return setMsg({ type: 'err', text: `Your wallet has UGX ${fmt(walletBalance)}. Top up, or give by mobile money / cash.` });

    setBusy(true); setMsg(null);
    try {
      let titheId; let churchName = church.name; let paidMessage = '';
      if (method === 'wallet') {
        const pin = await confirmWalletPin(askPin, {
          title: 'Confirm with your PIN',
          message: `Send UGX ${fmt(amountNum)} to ${church.name} from your IcanEra wallet.`,
        });
        if (!pin.ok) { setMsg({ type: 'err', text: pin.error }); return; }
        ({ titheId, churchName, message: paidMessage } = await giveToChurch({ churchId: church.id, amount: amountNum, givingType, method: 'wallet', isAnonymous: anonymous, message }));
      } else if (method === 'cash') {
        ({ titheId, churchName } = await giveToChurch({ churchId: church.id, amount: amountNum, givingType, method: 'cash', isAnonymous: anonymous, message }));
      } else {
        const res = await giveToChurchWithFlutterwave({ church, amount: amountNum, givingType, isAnonymous: anonymous, message, phone });
        if (res.cancelled) { setMsg({ type: 'err', text: 'Payment cancelled — you were not charged.' }); return; }
        ({ titheId, churchName, message: paidMessage } = res);
      }
      saveLastChurch(church);
      if (balanceProp === undefined) refreshBalance();
      const label = GIVING_TYPES.find((g) => g.id === givingType)?.label || 'Tithe';
      setMsg({ type: 'ok', text: `🙌 ${label} of UGX ${fmt(amountNum)} — ${paidMessage || `received by ${churchName}`}. God bless your giving.` });
      onGiven?.({
        id: titheId, amount: amountNum, date: new Date(), givingType, recipientType: 'church', paymentMethod: method,
        titheType: 'personal', isAnonymous: anonymous, description: `${label} to ${churchName}`, method,
      });
      setAmount(''); setMessage('');
    } catch (e) {
      setMsg({ type: 'err', text: e.message || 'Could not send the tithe' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* 1 — find your church */}
      <section className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-xl p-5 border border-purple-500/30">
        <h3 className="text-lg font-bold text-white flex items-center gap-2 mb-1"><span aria-hidden="true">⛪</span> Find a church or business</h3>
        <p className="text-xs text-gray-400 mb-3">Any business registered on IcanEra can receive your payment directly — churches are listed first.</p>

        <ChurchPicker value={church} onChange={pick} />
      </section>

      {/* 2 — give */}
      {church && (
        <section className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-xl p-5 border border-amber-500/30">
          <div className="flex items-start justify-between gap-3 mb-4">
            <div>
              <p className="text-[11px] uppercase tracking-wider text-amber-400">Giving to</p>
              <h3 className="text-xl font-bold text-white">{church.isChurch === false ? '🏢' : '⛪'} {church.name}</h3>
            </div>
            <button type="button" onClick={() => setChurch(null)} className="text-xs text-gray-400 hover:text-white underline">Change</button>
          </div>

          <div className="grid grid-cols-3 sm:grid-cols-7 gap-2 mb-4">
            {GIVING_TYPES.map((g) => (
              <button key={g.id} type="button" onClick={() => setGivingType(g.id)} title={g.hint}
                className={`rounded-lg border px-2 py-2 text-center text-[11px] font-semibold transition ${givingType === g.id ? 'bg-purple-600 border-purple-400 text-white' : 'bg-slate-700/40 border-slate-600 text-gray-300 hover:border-purple-400'}`}>
                <span className="block text-lg" aria-hidden="true">{g.icon}</span>{g.label}
              </button>
            ))}
          </div>

          <label className="block text-xs font-medium text-gray-300 mb-1" htmlFor="church-amount">Amount (UGX)</label>
          <input id="church-amount" type="number" inputMode="numeric" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0"
            className="w-full bg-slate-700/50 border border-purple-500/30 rounded-lg px-4 py-2 text-white text-lg font-bold focus:outline-none focus:border-purple-500" />
          <div className="flex flex-wrap gap-2 mt-2">
            {QUICK_AMOUNTS.map((q) => (
              <button key={q} type="button" onClick={() => setAmount(String(q))}
                className="text-xs px-3 py-1 rounded-full bg-slate-700/60 border border-slate-600 text-gray-200 hover:border-amber-400">{fmt(q)}</button>
            ))}
          </div>

          {givingType === 'tithe' && (
            <div className="mt-3 rounded-lg bg-slate-900/60 border border-slate-700 p-3">
              <label className="text-[11px] text-gray-400" htmlFor="church-income">Not sure how much? Enter this month’s income and I’ll work out 10%</label>
              <div className="flex gap-2 mt-1">
                <input id="church-income" type="number" inputMode="numeric" min="0" value={income} onChange={(e) => setIncome(e.target.value)} placeholder="Income (UGX)"
                  className="flex-1 bg-slate-700/50 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none" />
                <button type="button" disabled={tenPercent <= 0} onClick={() => setAmount(String(tenPercent))}
                  className="text-xs font-semibold px-3 rounded-lg bg-amber-500/20 border border-amber-500/40 text-amber-200 disabled:opacity-40">
                  {tenPercent > 0 ? `Use ${fmt(tenPercent)}` : '10%'}
                </button>
              </div>
            </div>
          )}

          <p className="text-xs font-medium text-gray-300 mt-4 mb-2">How would you like to give?</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {PAY_METHODS.map(({ id, label, sub, Icon }) => (
              <button key={id} type="button" onClick={() => setMethod(id)}
                className={`rounded-lg border px-3 py-2 text-left transition ${method === id ? 'bg-purple-600/30 border-purple-400' : 'bg-slate-700/40 border-slate-600 hover:border-purple-400'}`}>
                <Icon className="w-4 h-4 text-amber-300 mb-1" />
                <p className="text-sm font-semibold text-white">{label}</p>
                <p className="text-[11px] text-gray-400 flex items-center gap-1">{id === 'wallet' && <Lock className="w-3 h-3" />}{id === 'wallet' ? `UGX ${fmt(walletBalance)} · PIN required` : sub}</p>
              </button>
            ))}
          </div>
          {walletShort && <p className="text-xs text-rose-400 mt-2">Exceeds your wallet balance (UGX {fmt(walletBalance)}). Pick mobile money or cash.</p>}
          {method === 'flutterwave' && (
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Mobile money number (optional, e.g. 0772…)" inputMode="tel"
              className="w-full mt-2 bg-slate-700/50 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none" />
          )}
          {method === 'cash' && <p className="text-xs text-gray-400 mt-2">Recorded in your giving history now. {church.name} confirms once the cash reaches them. Your wallet isn’t touched.</p>}

          <textarea value={message} onChange={(e) => setMessage(e.target.value.slice(0, 500))} rows={2} placeholder="A note or prayer request for the church (optional)"
            className="w-full mt-4 bg-slate-700/50 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none" />
          <label className="flex items-center gap-2 text-xs text-gray-300 mt-2 cursor-pointer">
            <input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} /> Give anonymously — the church sees the gift, not your name
          </label>

          {msg && (
            <p role={msg.type === 'err' ? 'alert' : 'status'} className={`mt-4 text-sm rounded-lg px-3 py-2 flex items-start gap-2 ${msg.type === 'ok' ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30' : 'bg-rose-500/15 text-rose-300 border border-rose-500/30'}`}>
              {msg.type === 'ok' ? <Check className="w-4 h-4 mt-0.5 flex-shrink-0" /> : <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />}{msg.text}
            </p>
          )}

          <button type="button" onClick={give} disabled={busy || amountNum <= 0 || walletShort}
            className="w-full mt-4 py-3 rounded-lg font-bold text-white bg-gradient-to-r from-purple-600 to-amber-600 disabled:opacity-50 disabled:cursor-not-allowed">
            {busy ? '⏳ Sending…' : `🙏 Give UGX ${fmt(amountNum)}${method === 'wallet' ? ' · confirm with PIN' : ''}`}
          </button>
        </section>
      )}

      <MyChurchInbox />
    </div>
  );
}

/** Shown only to people who own a registered church: switch on "accept tithe" and see what came in. */
function MyChurchInbox() {
  const [mine, setMine] = useState([]);
  const [openId, setOpenId] = useState(null);
  const [rows, setRows] = useState([]);
  const [err, setErr] = useState('');

  useEffect(() => { getMyChurches().then(setMine).catch(() => setMine([])); }, []);

  const open = async (id) => {
    setOpenId(id); setErr('');
    try { setRows(await getReceivedTithes(id)); } catch (e) { setErr(e.message); }
  };
  const toggle = async (b) => {
    try {
      await setAcceptsTithe(b.id, !b.acceptsTithe);
      setMine((m) => m.map((x) => (x.id === b.id ? { ...x, acceptsTithe: !x.acceptsTithe } : x)));
    } catch (e) { setErr(e.message); }
  };
  const confirmCash = async (id) => {
    try { await confirmCashReceived(id); setRows((r) => r.map((x) => (x.id === id ? { ...x, confirmed: true } : x))); } catch (e) { setErr(e.message); }
  };

  const total = useMemo(() => rows.filter((r) => r.confirmed).reduce((s, r) => s + r.amount, 0), [rows]);
  if (!mine.length) return null;

  return (
    <section className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-xl p-5 border border-emerald-500/30">
      <h3 className="text-lg font-bold text-white flex items-center gap-2 mb-3"><Users className="w-5 h-5 text-emerald-400" /> My church’s giving</h3>
      {mine.map((b) => (
        <div key={b.id} className="mb-2 rounded-lg border border-slate-700 bg-slate-900/50 p-3">
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm font-semibold text-white flex-1 min-w-[10rem]">{b.name}</p>
            <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer">
              <input type="checkbox" checked={b.acceptsTithe} onChange={() => toggle(b)} /> Accept tithe
            </label>
            <button type="button" onClick={() => (openId === b.id ? setOpenId(null) : open(b.id))}
              className="text-xs px-3 py-1 rounded-lg bg-emerald-600/30 border border-emerald-500/40 text-emerald-200">
              {openId === b.id ? 'Hide' : 'View received'}
            </button>
          </div>
          {openId === b.id && (
            <div className="mt-3">
              <p className="text-xs text-gray-400 mb-2">Confirmed: <span className="text-emerald-300 font-semibold">UGX {fmt(total)}</span></p>
              {rows.length === 0 && <p className="text-xs text-gray-500">Nothing received yet.</p>}
              <ul className="space-y-1 max-h-60 overflow-y-auto">
                {rows.map((r) => (
                  <li key={r.id} className="text-xs flex flex-wrap items-center gap-2 border-b border-slate-800 py-1">
                    <span className="text-white font-semibold">UGX {fmt(r.amount)}</span>
                    <span className="text-gray-400">{String(r.givingType).replace('_', ' ')} · {r.method} · {new Date(r.date).toLocaleDateString()}</span>
                    <span className="text-gray-300">from {r.giver}</span>
                    {r.message && <span className="text-gray-500 italic w-full">“{r.message}”</span>}
                    {!r.confirmed && <button type="button" onClick={() => confirmCash(r.id)} className="ml-auto px-2 py-0.5 rounded bg-amber-500/20 border border-amber-500/40 text-amber-200">Confirm cash received</button>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ))}
      {err && <p className="text-xs text-rose-400 mt-2" role="alert">{err}</p>}
    </section>
  );
}
