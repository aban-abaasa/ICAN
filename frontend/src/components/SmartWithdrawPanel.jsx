import React, { useEffect, useMemo, useState } from 'react';
import { Upload, Phone, Banknote, Store, Wallet, AlertCircle, Zap } from 'lucide-react';
import {
  ICAN_TO_UGX,
  detectUgandaMobileNetwork,
  getBalance,
  getLiveUgxPrice,
  isBusinessWalletAdmin,
  requestIcanPayout,
  sendFiatToBank,
  sendFiatToMobileMoney,
  sendFromBusinessWallet,
} from '../services/icanWalletService';
import { listUgandaBanks } from '../services/digitalCardService';
import { walletAccountService } from '../services/walletAccountService';
import {
  COIN_PAYOUT_FEE_RATE,
  maskDestination,
  planWithdrawalSource,
  quoteWithdrawal,
  rememberDestination,
} from '../utils/walletRouting';
import { UNLOADED_FEE_RATES, describeRate, feeRateKey, rateFor } from '../utils/feeRates';

const inputCls = 'w-full px-4 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-400 focus:border-orange-400 focus:outline-none transition-all';
const chipCls = (on) => `px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${on ? 'bg-orange-500/30 border-orange-400 text-orange-200' : 'bg-white/5 border-white/20 text-gray-300 hover:border-orange-400/60'}`;
const ugx = (n) => `UGX ${Math.round(Number(n) || 0).toLocaleString()}`;
const QUICK_UGX = [20000, 50000, 100000, 500000];

const savedKey = (userId) => `ican_withdraw_destinations_${userId}`;
const readSaved = (userId) => {
  try { return JSON.parse(localStorage.getItem(savedKey(userId)) || '[]'); } catch { return []; }
};
const writeSaved = (userId, list) => {
  try { localStorage.setItem(savedKey(userId), JSON.stringify(list)); } catch { /* private mode — remembering is a convenience only */ }
};

/**
 * Cash out of the IcanEra wallet to mobile money or a bank account.
 *
 * "Smart" because the person only says how much and where: the panel picks the
 * balance that pays it with the lowest fee (wallet money or IcanEra coin - both
 * 3% unless a developer has changed the rates in public.ican_fee_rates, and the
 * wallet balance wins a tie), detects MTN/Airtel from the number, offers the
 * destinations they have used before, and shows exactly what lands before any
 * PIN is asked for.
 *
 * A business withdraws too: its administrator moves the coin into their own
 * wallet (business-wallet PIN) and it is cashed out straight away (wallet PIN).
 * Both PINs are collected before any money moves, so cancelling the second
 * prompt never leaves funds half-moved. If the cash-out step then fails, the
 * coin is safe in the personal IcanEra balance and the message says so.
 */
const SmartWithdrawPanel = ({ userId, ownPhone = '', fiatUgx = 0, businesses = [], feeRates = UNLOADED_FEE_RATES, askPin, onChanged }) => {
  const [coinIcan, setCoinIcan] = useState(0);
  // A cash-out is paid at the coin's LIVE UGX price (never below the 5,000 floor), so
  // the preview must use it too — the flat floor would under-quote what lands.
  const [rate, setRate] = useState(ICAN_TO_UGX);
  useEffect(() => { getLiveUgxPrice().then(setRate); }, []);
  const [sourceId, setSourceId] = useState('personal');
  const [admins, setAdmins] = useState({});
  const [channel, setChannel] = useState('mobile');
  const [account, setAccount] = useState(ownPhone || '');
  const [pickedNetwork, setPickedNetwork] = useState(null);
  const [banks, setBanks] = useState([]);
  const [bankCode, setBankCode] = useState('');
  const [beneficiary, setBeneficiary] = useState('');
  const [amount, setAmount] = useState('');
  const [saved, setSaved] = useState(() => readSaved(userId));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const business = businesses.find((b) => b.id === sourceId) || null;
  const businessIcan = Number(business?.ican_wallet?.ican_balance || 0);

  const refreshCoin = () => {
    if (!userId) return;
    getBalance(userId).then((b) => setCoinIcan(Number(b.ican) || 0)).catch(() => setCoinIcan(0));
  };
  useEffect(refreshCoin, [userId]);
  useEffect(() => { setSaved(readSaved(userId)); }, [userId]);
  useEffect(() => { if (ownPhone && !account) setAccount(ownPhone); }, [ownPhone]);

  // Bank list is only fetched the first time the Bank option is opened.
  useEffect(() => {
    if (channel !== 'bank' || banks.length) return;
    listUgandaBanks().then(setBanks).catch(() => setResult({ success: false, message: 'Could not load the bank list. Check your connection and try again.' }));
  }, [channel, banks.length]);

  // Only a business administrator can approve a business-wallet payment.
  useEffect(() => {
    if (!business || admins[business.id] !== undefined) return;
    isBusinessWalletAdmin(business.id, { ownerUserId: business.user_id, currentUserId: userId })
      .then((ok) => setAdmins((prev) => ({ ...prev, [business.id]: ok })));
  }, [business?.id]);

  const amountNum = parseFloat(amount);
  const detectedNetwork = channel === 'mobile' && account.trim() ? detectUgandaMobileNetwork(account) : null;
  const network = detectedNetwork || pickedNetwork;

  // What the wallet-money route charges. The server decides which rate from what it can verify - a bank account
  // is always the bank rate, your own registered number the withdrawal rate, any other number the mobile-money
  // send rate - and so does this (utils/feeRates.js). The coin route pays the coin cash-out rate, which
  // COIN_PAYOUT_FEE_RATE follows once the rates are read.
  const toOwnNumber = channel === 'mobile' && !!ownPhone && account.trim() === ownPhone;
  const fiatFeeRate = rateFor(feeRates, feeRateKey({ isBank: channel === 'bank', toOwnNumber }));

  // What can pay this, and what lands.
  const plan = business
    ? (businessIcan * rate >= amountNum
      ? { source: 'coin', maxUgx: businessIcan * rate }
      : { source: null, maxUgx: businessIcan * rate, reason: `${business.business_name} has IcanEra ${businessIcan.toLocaleString(undefined, { maximumFractionDigits: 4 })} (about ${ugx(businessIcan * rate)}).` })
    : planWithdrawalSource({ amountUgx: amountNum, fiatUgx, coinIcan, rate, fiatFeeRate });
  const quote = useMemo(
    () => quoteWithdrawal({ amountUgx: amountNum, source: plan.source || 'fiat', rate, fiatFeeRate }),
    [amountNum, plan.source, rate, fiatFeeRate, COIN_PAYOUT_FEE_RATE],
  );

  const appliedRate = plan.source === 'coin' ? COIN_PAYOUT_FEE_RATE : fiatFeeRate;

  const destinationOk = channel === 'mobile'
    ? account.replace(/\D/g, '').length >= 9 && !!network
    : /^\d{5,20}$/.test(account.replace(/\s/g, '')) && !!bankCode && beneficiary.trim().length >= 2;
  const blockedForBusiness = business && admins[business.id] === false;
  const canSubmit = !busy && amountNum > 0 && !!plan.source && destinationOk && !blockedForBusiness;

  const maxUgx = Math.floor(plan.maxUgx || 0);
  const destLabel = channel === 'mobile'
    ? `${account.trim()} (${network || 'mobile money'})`
    : `${beneficiary.trim()}, ${(banks.find((b) => b.code === bankCode) || {}).name || 'bank'}, account ${account.replace(/\s/g, '')}`;

  const switchChannel = (next) => {
    if (next === channel) return;
    setChannel(next);
    setPickedNetwork(null);
    setAccount(next === 'mobile' ? (ownPhone || '') : '');
  };

  const applySaved = (dest) => {
    setChannel(dest.channel);
    setAccount(dest.account);
    setPickedNetwork(dest.network || null);
    setBankCode(dest.bankCode || '');
    setBeneficiary(dest.name || '');
  };

  const submit = async () => {
    setBusy(true);
    setResult(null);
    let movedFromBusiness = false;
    let touched = false; // set once money may have moved, so a cancelled PIN doesn't reload everything
    try {
      // Collect and check every PIN before any money moves.
      let businessPin = null;
      if (business) {
        businessPin = await askPin({
          title: 'Business wallet PIN',
          message: `Move ${ugx(quote.gross)} out of ${business.business_name} so it can be withdrawn.`,
        });
        if (businessPin === null) return;
        const businessCheck = await walletAccountService.verifyBusinessWalletPin(business.id, businessPin);
        if (!businessCheck.success) {
          setResult({ success: false, message: businessCheck.error || 'Incorrect business-wallet PIN. Nothing was moved.' });
          return;
        }
      }
      const pin = await askPin({
        title: 'Confirm withdrawal',
        message: `Withdraw ${ugx(quote.gross)} to ${destLabel}.${quote.fee > 0 ? ` After the ${describeRate(appliedRate)} fee you receive ${ugx(quote.net)}.` : ''}`,
      });
      if (pin === null) return;
      const pinCheck = await walletAccountService.verifyUserPIN(userId, pin);
      if (!pinCheck?.success) {
        setResult({ success: false, message: pinCheck?.error || 'Incorrect transaction PIN. Withdrawal cancelled.' });
        return;
      }

      touched = true;
      // A business's coin is first moved into the administrator's own wallet.
      if (business) {
        const moved = await sendFromBusinessWallet({
          businessProfileId: business.id,
          recipientUserId: userId,
          amount: quote.icanDebit,
          note: 'Withdrawal to personal wallet',
          pin: businessPin,
          isAdmin: true,
        });
        if (moved.status !== 'completed') {
          setResult({ success: false, message: 'The business payment is waiting for approval, so nothing was withdrawn yet.' });
          return;
        }
        movedFromBusiness = true;
      }

      let outcome;
      if (plan.source === 'fiat') {
        outcome = channel === 'mobile'
          ? await sendFiatToMobileMoney({ amount: quote.gross, currency: 'UGX', recipientPhone: account.trim(), network, note: 'Withdrawal', purpose: 'withdraw' })
          : await sendFiatToBank({ amount: quote.gross, currency: 'UGX', accountNumber: account.replace(/\s/g, ''), bankCode, beneficiaryName: beneficiary.trim(), note: 'Withdrawal' });
      } else {
        outcome = await requestIcanPayout({
          icanAmount: quote.icanDebit,
          channel: channel === 'mobile' ? 'mobilemoneyuganda' : 'bank',
          phoneNumber: channel === 'mobile' ? account.trim() : undefined,
          network: channel === 'mobile' ? network : undefined,
          accountNumber: channel === 'bank' ? account.replace(/\s/g, '') : undefined,
          bankCode: channel === 'bank' ? bankCode : undefined,
          beneficiaryName: channel === 'bank' ? beneficiary.trim() : undefined,
        });
      }

      const received = Number(outcome.ugx_net ?? outcome.net_amount ?? quote.net);
      setResult({
        success: true,
        message: `Withdrawal submitted: ${ugx(received)} to ${destLabel}. It is being confirmed now — if it fails you are refunded automatically.`,
        reference: outcome.reference,
      });
      const next = rememberDestination(saved, {
        channel,
        account: account.trim(),
        network: channel === 'mobile' ? network : undefined,
        bankCode: channel === 'bank' ? bankCode : undefined,
        name: channel === 'bank' ? beneficiary.trim() : undefined,
        label: channel === 'bank' ? (banks.find((b) => b.code === bankCode) || {}).name : network,
      });
      setSaved(next);
      writeSaved(userId, next);
      setAmount('');
    } catch (error) {
      const message = /own phone number/i.test(error.message || '')
        ? 'Your wallet balance cannot be paid to your own registered number until the payout service is updated. Withdraw from IcanEra coin, or use another number.'
        : (error.message || 'Withdrawal failed');
      setResult({
        success: false,
        message: movedFromBusiness
          ? `The business funds reached your personal IcanEra balance, but the cash-out failed: ${message} Your coin is safe — withdraw it again from "My wallet".`
          : message,
      });
    } finally {
      setBusy(false);
      if (touched) {
        refreshCoin();
        onChanged?.({ business: Boolean(business) });
      }
    }
  };

  const personalSourceNote = !business && plan.source
    ? (plan.source === 'fiat'
      ? (fiatFeeRate > 0 ? `Paid from your wallet balance — ${describeRate(fiatFeeRate)} fee, taken out of the amount.` : 'Paid from your wallet balance — no fee.')
      : `Paid from your IcanEra coin — ${describeRate(COIN_PAYOUT_FEE_RATE)} cash-out fee.`)
    : null;

  return (
    <div className="glass-card p-6 mb-6">
      <h3 className="text-lg font-semibold text-white mb-1 flex items-center gap-2">
        <Upload className="w-5 h-5 text-orange-400" />
        Withdraw to Mobile Money or Bank
      </h3>
      <p className="text-gray-400 text-sm mb-5">Say how much and where. We pick the cheapest balance that covers it.</p>

      <div className="grid grid-cols-2 gap-3 mb-5">
        <div className="p-3 rounded-lg bg-white/5 border border-white/10">
          <p className="text-xs text-gray-400 flex items-center gap-1"><Wallet className="w-3 h-3" /> Wallet balance</p>
          <p className="text-white font-semibold text-sm">{ugx(fiatUgx)}</p>
        </div>
        <div className="p-3 rounded-lg bg-white/5 border border-white/10">
          <p className="text-xs text-gray-400 flex items-center gap-1"><Zap className="w-3 h-3" /> IcanEra coin</p>
          <p className="text-white font-semibold text-sm">{coinIcan.toLocaleString(undefined, { maximumFractionDigits: 4 })}</p>
          <p className="text-[11px] text-gray-500">about {ugx(coinIcan * rate)}</p>
        </div>
      </div>

      {businesses.length > 0 && (
        <div className="mb-5">
          <p className="text-xs uppercase tracking-wider text-gray-400 mb-2">Withdraw from</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={chipCls(!business)} onClick={() => setSourceId('personal')}>My wallet</button>
            {businesses.map((b) => (
              <button key={b.id} type="button" className={chipCls(sourceId === b.id)} onClick={() => setSourceId(b.id)}>
                <Store className="w-3 h-3 inline mr-1" />{b.business_name}
              </button>
            ))}
          </div>
          {business && (
            <p className="mt-2 text-xs text-gray-400">
              {blockedForBusiness
                ? 'Only the business administrator can withdraw from a business wallet. Ask them to withdraw, or send a payment request from Send.'
                : `Paid from ${business.business_name}'s IcanEra coin (${describeRate(COIN_PAYOUT_FEE_RATE)} cash-out fee). It moves into your wallet first, then out to your destination.`}
            </p>
          )}
        </div>
      )}

      {saved.length > 0 && (
        <div className="mb-4">
          <p className="text-xs uppercase tracking-wider text-gray-400 mb-2">Recent destinations</p>
          <div className="flex flex-wrap gap-2">
            {saved.map((d) => (
              <button key={`${d.channel}|${d.bankCode || ''}|${d.account}`} type="button" className={chipCls(false)} onClick={() => applySaved(d)}>
                {d.channel === 'mobile' ? <Phone className="w-3 h-3 inline mr-1" /> : <Banknote className="w-3 h-3 inline mr-1" />}
                {d.label ? `${d.label} ` : ''}{maskDestination(d.account)}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 mb-3">
        <button type="button" className={chipCls(channel === 'mobile')} onClick={() => switchChannel('mobile')}>
          <Phone className="w-3 h-3 inline mr-1" />Mobile Money
        </button>
        <button type="button" className={chipCls(channel === 'bank')} onClick={() => switchChannel('bank')}>
          <Banknote className="w-3 h-3 inline mr-1" />Bank
        </button>
      </div>

      <div className="space-y-3">
        {channel === 'bank' && (
          <select value={bankCode} onChange={(e) => setBankCode(e.target.value)} className={inputCls}>
            <option value="" className="bg-slate-800">{banks.length ? 'Choose bank' : 'Loading banks…'}</option>
            {banks.map((b) => <option key={b.code} value={b.code} className="bg-slate-800">{b.name}</option>)}
          </select>
        )}
        <input
          type="text"
          inputMode={channel === 'mobile' ? 'tel' : 'numeric'}
          autoComplete="off"
          placeholder={channel === 'mobile' ? 'Phone number, e.g. +256701234567' : 'Bank account number'}
          value={account}
          onChange={(e) => { setAccount(e.target.value); setPickedNetwork(null); }}
          className={inputCls}
        />
        {channel === 'mobile' && account.trim() && (
          detectedNetwork ? (
            <p className="text-xs font-medium text-green-400">● Detected network: {detectedNetwork}</p>
          ) : (
            <div>
              <p className="text-xs text-gray-400 mb-2">We could not tell the network from this number — pick it.</p>
              <div className="flex gap-2">
                {['MTN', 'AIRTEL'].map((n) => (
                  <button key={n} type="button" className={chipCls(pickedNetwork === n)} onClick={() => setPickedNetwork(n)}>{n === 'AIRTEL' ? 'Airtel' : n}</button>
                ))}
              </div>
            </div>
          )
        )}
        {channel === 'bank' && (
          <input
            type="text"
            autoComplete="off"
            maxLength={80}
            placeholder="Account holder name"
            value={beneficiary}
            onChange={(e) => setBeneficiary(e.target.value)}
            className={inputCls}
          />
        )}

        <div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              inputMode="numeric"
              placeholder="Amount in UGX"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className={inputCls}
            />
            <button type="button" className={chipCls(false)} disabled={!maxUgx} onClick={() => setAmount(String(maxUgx))}>Max</button>
          </div>
          <div className="flex flex-wrap gap-2 mt-2">
            {QUICK_UGX.map((q) => (
              <button key={q} type="button" className={chipCls(amountNum === q)} onClick={() => setAmount(String(q))}>{q.toLocaleString()}</button>
            ))}
          </div>
        </div>
      </div>

      {amountNum > 0 && (
        <div className={`mt-4 p-3 rounded-lg border text-sm ${plan.source ? 'bg-orange-500/10 border-orange-500/30 text-orange-100' : 'bg-red-500/10 border-red-500/40 text-red-200'}`}>
          {plan.source ? (
            <>
              <div className="flex justify-between"><span>You withdraw</span><span>{ugx(quote.gross)}</span></div>
              {quote.fee > 0 && <div className="flex justify-between"><span>Fee ({describeRate(appliedRate)})</span><span>− {ugx(quote.fee)}</span></div>}
              <div className="flex justify-between font-semibold"><span>You receive</span><span>{ugx(quote.net)}</span></div>
              {plan.source === 'coin' && <div className="flex justify-between text-xs opacity-80"><span>IcanEra coin used</span><span>{quote.icanDebit.toLocaleString(undefined, { maximumFractionDigits: 8 })}</span></div>}
              {personalSourceNote && <p className="mt-2 text-xs opacity-80">{personalSourceNote}</p>}
            </>
          ) : (
            <p className="flex items-start gap-2"><AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />{plan.reason}</p>
          )}
        </div>
      )}

      {result && (
        <div className={`mt-4 p-3 rounded-lg border ${result.success ? 'bg-green-500/20 border-green-500/50' : 'bg-red-500/20 border-red-500/50'}`}>
          <p className={`text-sm font-medium ${result.success ? 'text-green-400' : 'text-red-400'}`}>{result.message}</p>
          {result.reference && <p className="text-xs text-gray-400 mt-1 break-all">Ref: {result.reference}</p>}
        </div>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={!canSubmit}
        className="mt-4 w-full px-4 py-3 bg-gradient-to-r from-orange-500 to-orange-600 text-white rounded-lg font-semibold hover:shadow-lg hover:shadow-orange-500/30 disabled:opacity-40 transition-all"
      >
        {busy ? 'Processing…' : amountNum > 0 ? `Withdraw ${ugx(amountNum)}` : 'Withdraw'}
      </button>
    </div>
  );
};

export default SmartWithdrawPanel;
