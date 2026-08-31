import React, { useEffect, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Copy, Loader, Wallet, X } from 'lucide-react';
import {
  registerBusinessWallet,
  getBusinessWalletTransactions,
  setBusinessWalletPin,
} from '../services/icanWalletService';

const BusinessWalletModal = ({ profile, onClose }) => {
  const [wallet, setWallet] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pin, setPin] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [savingPin, setSavingPin] = useState(false);
  const [pinMessage, setPinMessage] = useState('');

  useEffect(() => {
    let active = true;
    const loadWallet = async () => {
      setLoading(true);
      setError('');
      try {
        const walletData = await registerBusinessWallet(profile.id);
        const transactionData = await getBusinessWalletTransactions(profile.id, 50);
        if (active) {
          setWallet(walletData);
          setTransactions(transactionData);
        }
      } catch (walletError) {
        if (active) setError(walletError?.message || 'Unable to open this business wallet');
      } finally {
        if (active) setLoading(false);
      }
    };
    loadWallet();
    return () => { active = false; };
  }, [profile.id]);

  const copyAddress = async () => {
    if (wallet?.wallet_address && navigator.clipboard) {
      await navigator.clipboard.writeText(wallet.wallet_address);
    }
  };

  const savePin = async (event) => {
    event.preventDefault();
    if (pin !== pinConfirm) {
      setPinMessage('PINs do not match.');
      return;
    }
    setSavingPin(true);
    setPinMessage('');
    try {
      await setBusinessWalletPin(profile.id, pin);
      setPin('');
      setPinConfirm('');
      setPinMessage('Business-wallet PIN saved.');
    } catch (pinError) {
      setPinMessage(pinError?.status === 404 || /404|not found/i.test(pinError?.message || '')
        ? 'PIN service is not installed yet. Run PITCHIN_BUSINESS_WALLET_PIN_FIX.sql in Supabase.'
        : (pinError?.message || 'Could not save the PIN.'));
    } finally {
      setSavingPin(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-hidden rounded-2xl border border-slate-700 bg-slate-950 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 p-5">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-emerald-600/20 p-2">
              <Wallet className="h-6 w-6 text-emerald-400" />
            </div>
            <div>
              <h2 className="font-bold text-white">{profile.business_name} Wallet</h2>
              <p className="text-xs text-slate-400">Dedicated iCanEra business account</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white" title="Close wallet">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="max-h-[calc(90vh-82px)] overflow-y-auto p-5">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-12 text-slate-400">
              <Loader className="h-5 w-5 animate-spin" /> Opening business wallet...
            </div>
          )}

          {!loading && error && (
            <div className="rounded-xl border border-red-700 bg-red-950/30 p-4 text-sm text-red-300">{error}</div>
          )}

          {!loading && !error && wallet && (
            <>
              <div className="rounded-2xl bg-gradient-to-br from-emerald-700 to-teal-800 p-5">
                <p className="text-sm text-emerald-100">Available IcanEra balance</p>
                <p className="mt-1 text-3xl font-bold text-white">{Number(wallet.ican_balance || 0).toLocaleString()} IcanEra</p>
                <p className="mt-1 text-sm text-emerald-100">≈ {(Number(wallet.ican_balance || 0) * 5000).toLocaleString()} UGX</p>
                <button onClick={copyAddress} className="mt-4 flex items-center gap-2 text-xs text-emerald-100 hover:text-white" title="Copy business wallet address">
                  <span className="font-mono">{wallet.wallet_address}</span><Copy className="h-3.5 w-3.5" />
                </button>
              </div>

              <form onSubmit={savePin} className="mt-5 rounded-xl border border-slate-700 bg-slate-900/70 p-4">
                <p className="font-semibold text-white">Business-wallet PIN</p>
                <p className="mt-1 text-xs text-slate-400">Required for every outgoing transaction. Large transactions also require shareholder approval.</p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <input value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="new-password" placeholder="4–6 digit PIN" className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500" />
                  <input value={pinConfirm} onChange={(event) => setPinConfirm(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="new-password" placeholder="Confirm PIN" className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500" />
                </div>
                <div className="mt-3 flex items-center justify-between gap-3">
                  <span className="text-xs text-slate-400">{pinMessage}</span>
                  <button type="submit" disabled={savingPin || pin.length < 4 || pinConfirm.length < 4} className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50">
                    {savingPin ? 'Saving…' : 'Save PIN'}
                  </button>
                </div>
              </form>

              <div className="mt-5">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="font-semibold text-white">Business wallet activity</h3>
                  <span className="text-xs text-slate-500">{transactions.length} records</span>
                </div>
                {transactions.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-slate-700 p-6 text-center text-sm text-slate-500">No business-wallet transactions yet.</p>
                ) : (
                  <div className="space-y-2">
                    {transactions.map((transaction) => {
                      const incoming = transaction.recipient_user_id && transaction.recipient_user_id !== transaction.initiated_by;
                      return (
                        <div key={transaction.id} className="flex items-center justify-between rounded-xl bg-slate-900/80 p-3">
                          <div className="flex items-center gap-3">
                            <div className={`rounded-lg p-2 ${incoming ? 'bg-blue-500/20' : 'bg-orange-500/20'}`}>
                              {incoming ? <ArrowDownLeft className="h-4 w-4 text-blue-400" /> : <ArrowUpRight className="h-4 w-4 text-orange-400" />}
                            </div>
                            <div>
                              <p className="text-sm text-white">{transaction.note || 'Business wallet transfer'}</p>
                              <p className="text-xs text-slate-500">{new Date(transaction.created_at).toLocaleString()} · {transaction.status}</p>
                            </div>
                          </div>
                          <span className={`font-semibold ${incoming ? 'text-blue-400' : 'text-orange-400'}`}>
                            {incoming ? '+' : '-'}{Number(transaction.amount_ican || 0).toLocaleString()} IcanEra
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default BusinessWalletModal;
