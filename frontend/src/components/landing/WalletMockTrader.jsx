import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Wallet, ArrowLeftRight } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import { useMarketSnapshot } from '../../hooks/useIcanPrice';
import { getOrCreateGuestLikeKey } from '../../services/landingMessagesService';
import { recordMockTrade, fetchRecentMockTrades, subscribeToMockTrades } from '../../services/landingMockTradeService';
import { fmtRelativeTime } from './relativeTime';

const FALLBACK_PRICE_UGX = 5000;

const WalletMockTrader = ({ onGetStarted, authId = null }) => {
  const { actualTheme } = useTheme();
  const isDarkTheme = actualTheme === 'dark';
  const { snapshot, loading } = useMarketSnapshot();
  const [mode, setMode] = useState('buy'); // buy | sell
  const [amount, setAmount] = useState('');
  const [result, setResult] = useState(null);
  const [activity, setActivity] = useState([]);
  const guestKey = useMemo(() => getOrCreateGuestLikeKey(), []);

  const priceUgx = snapshot?.price_ugx || FALLBACK_PRICE_UGX;

  const loadActivity = useCallback(() => {
    fetchRecentMockTrades(6)
      .then((rows) => setActivity(rows.filter((r) => r.kind === 'wallet_buy' || r.kind === 'wallet_sell')))
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadActivity();
    return subscribeToMockTrades((row) => {
      if (row.kind === 'wallet_buy' || row.kind === 'wallet_sell') {
        setActivity((prev) => [row, ...prev].slice(0, 6));
      }
    });
  }, [loadActivity]);

  const handleCalculate = () => {
    const value = Number(amount);
    if (!value || value <= 0) return;

    const computedResult = mode === 'buy'
      ? { icanAmount: value / priceUgx, ugxAmount: value, priceUgxAtTrade: priceUgx }
      : { icanAmount: value, ugxAmount: value * priceUgx, priceUgxAtTrade: priceUgx };
    setResult(computedResult);

    recordMockTrade({
      kind: mode === 'buy' ? 'wallet_buy' : 'wallet_sell',
      targetType: 'ican_coin',
      guestKey,
      authId,
      inputAmount: value,
      computedResult,
    });
  };

  return (
    <section id="wallet-mock-trader" className="relative py-10 md:py-16 lg:py-20 2xl:py-24 px-4 sm:px-6 lg:px-8 2xl:px-16">
      <div className="max-w-3xl 2xl:max-w-4xl mx-auto">
        <div className="text-center mb-8 md:mb-12">
          <div className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-full border text-xs md:text-sm font-bold mb-4 ${isDarkTheme ? 'border-cyan-300/40 bg-cyan-900/25 text-cyan-200' : 'border-cyan-400/50 bg-cyan-100 text-cyan-800'}`}>
            <Wallet className="w-4 h-4" />
            ICAN Wallet
          </div>
          <h2 className={`text-2xl md:text-4xl font-black ${isDarkTheme ? 'text-white' : 'text-slate-900'}`}>Try a Mock Trade</h2>
          <p className={`mt-2 text-sm md:text-base ${isDarkTheme ? 'text-slate-400' : 'text-slate-600'}`}>
            Live ICAN price: {loading ? '…' : `${priceUgx.toLocaleString()} UGX`}
            {snapshot?.appreciation_pct != null && ` (+${Number(snapshot.appreciation_pct).toFixed(1)}% since floor)`}
            — this calculator doesn't touch a real wallet.
          </p>
        </div>

        <div className={`rounded-2xl border p-6 ${isDarkTheme ? 'border-slate-700/40 bg-slate-900/60' : 'border-slate-200 bg-white'}`}>
          <div className="flex items-center gap-2 mb-4">
            <button
              onClick={() => { setMode('buy'); setResult(null); }}
              className={`flex-1 rounded-lg py-2 text-sm font-bold transition-colors ${mode === 'buy' ? 'bg-cyan-600 text-white' : isDarkTheme ? 'bg-slate-800 text-slate-400' : 'bg-slate-100 text-slate-500'}`}
            >
              Buy ICAN
            </button>
            <button
              onClick={() => { setMode('sell'); setResult(null); }}
              className={`flex-1 rounded-lg py-2 text-sm font-bold transition-colors ${mode === 'sell' ? 'bg-cyan-600 text-white' : isDarkTheme ? 'bg-slate-800 text-slate-400' : 'bg-slate-100 text-slate-500'}`}
            >
              Sell ICAN
            </button>
          </div>

          <label className={`block text-xs font-bold uppercase tracking-wide mb-1 ${isDarkTheme ? 'text-slate-400' : 'text-slate-500'}`}>
            {mode === 'buy' ? 'Amount to spend (UGX)' : 'Amount to sell (ICAN)'}
          </label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min="1"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={mode === 'buy' ? 'e.g. 50000' : 'e.g. 10'}
              className={`w-full rounded-lg border px-3 py-2.5 text-sm ${isDarkTheme ? 'border-slate-700 bg-slate-800 text-white placeholder:text-slate-500' : 'border-slate-300 bg-white text-slate-900 placeholder:text-slate-400'}`}
            />
            <button
              onClick={handleCalculate}
              className="shrink-0 flex items-center gap-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 px-4 py-2.5 text-sm font-bold text-white transition-colors"
            >
              <ArrowLeftRight className="w-4 h-4" />
              Calculate
            </button>
          </div>

          {result && (
            <div className={`mt-4 rounded-lg border p-3 text-sm ${isDarkTheme ? 'border-cyan-400/30 bg-cyan-400/10 text-cyan-200' : 'border-cyan-300 bg-cyan-50 text-cyan-800'}`}>
              {mode === 'buy'
                ? <>≈ {result.icanAmount.toFixed(4)} ICAN for {Number(result.ugxAmount).toLocaleString()} UGX at today's price</>
                : <>≈ {Number(result.ugxAmount).toLocaleString()} UGX for {result.icanAmount} ICAN at today's price</>}
            </div>
          )}

          <button
            onClick={() => onGetStarted?.('signin')}
            className={`mt-4 text-xs font-bold underline decoration-dotted ${isDarkTheme ? 'text-slate-400 hover:text-white' : 'text-slate-500 hover:text-slate-900'}`}
          >
            Sign in to {mode} for real →
          </button>
        </div>

        {activity.length > 0 && (
          <div className={`mt-6 rounded-2xl border p-4 ${isDarkTheme ? 'border-slate-700/40 bg-slate-900/40' : 'border-slate-200 bg-slate-50'}`}>
            <p className={`text-xs font-bold uppercase tracking-wide mb-2 ${isDarkTheme ? 'text-slate-400' : 'text-slate-500'}`}>Recent simulated trades</p>
            <div className="flex flex-wrap gap-2">
              {activity.map((row) => (
                <span key={row.id} className={`text-[11px] px-2.5 py-1 rounded-full ${isDarkTheme ? 'bg-slate-800 text-slate-300' : 'bg-white text-slate-600 border border-slate-200'}`}>
                  Someone simulated a {row.kind === 'wallet_buy' ? 'buy' : 'sell'} · {fmtRelativeTime(row.created_at)}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
};

export default WalletMockTrader;
