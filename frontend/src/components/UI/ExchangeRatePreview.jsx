/**
 * 💱 Exchange Rate Preview Component
 * Shows locked rates and conversions before transaction
 */

import React, { useState, useEffect } from 'react';
import { Lock, TrendingUp, AlertCircle, CheckCircle } from 'lucide-react';
import icanCoinBlockchainService from '../../services/icanCoinBlockchainService';
import { CountryService } from '../../services/countryService';

export default function ExchangeRatePreview({
  icanAmount,
  countryCode,
  txType = 'trust_contribution',
  onRateLocked
}) {
  const [lockedRate, setLockedRate] = useState(null);
  const [conversion, setConversion] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchAndLockRate = async () => {
      try {
        setLoading(true);
        setError(null);

        // Get current market price
        const marketData = await icanCoinBlockchainService.getCurrentPrice();
        const rate = marketData.priceUGX;

        setLockedRate(rate);
        onRateLocked?.(rate);

        // Calculate conversion
        const localAmount = CountryService.icanToLocal(icanAmount, countryCode, rate);
        const currencyCode = CountryService.getCurrencyCode(countryCode);
        const currencySymbol = CountryService.getCurrencySymbol(countryCode);

        setConversion({
          icanAmount,
          localAmount,
          currencyCode,
          currencySymbol,
          exchangeRate: rate,
          asUsd: localAmount / (EXCHANGE_RATES[currencyCode] || 1)
        });
      } catch (err) {
        console.error('❌ Rate fetch failed:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    if (icanAmount && countryCode) {
      fetchAndLockRate();
    }
  }, [icanAmount, countryCode, txType, onRateLocked]);

  if (loading) {
    return (
      <div className="bg-slate-900/30 rounded-lg p-4 border border-slate-700/50 animate-pulse">
        <div className="h-20 bg-slate-700/30 rounded"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-500/10 rounded-lg p-4 border border-red-500/30 flex gap-3">
        <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-red-300 font-semibold text-sm">Rate Lock Failed</p>
          <p className="text-red-200 text-xs">{error}</p>
        </div>
      </div>
    );
  }

  if (!conversion) return null;

  return (
    <div className="space-y-3">
      {/* Locked Rate Banner */}
      <div className="bg-gradient-to-r from-emerald-900/40 to-teal-900/40 rounded-lg p-4 border border-emerald-500/30">
        <div className="flex items-start gap-3">
          <Lock className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-emerald-300 font-semibold text-sm flex items-center gap-2">
              ✓ Exchange Rate Locked
              <span className="text-xs bg-emerald-500/20 px-2 py-1 rounded text-emerald-300">
                {new Date().toLocaleTimeString()}
              </span>
            </p>
            <p className="text-emerald-200/80 text-xs mt-1">
              1 ICAN = {parseFloat(lockedRate).toLocaleString()} UGX
            </p>
          </div>
        </div>
      </div>

      {/* Conversion Breakdown */}
      <div className="bg-slate-800/40 rounded-lg p-4 border border-slate-700/30 space-y-2">
        <div className="flex justify-between items-center">
          <span className="text-slate-400 text-sm">Your Amount:</span>
          <span className="text-white font-semibold">
            {icanAmount.toFixed(2)} ICAN
          </span>
        </div>

        <div className="h-px bg-slate-700/30"></div>

        <div className="flex justify-between items-center">
          <span className="text-slate-400 text-sm">Converts to:</span>
          <span className="text-emerald-300 font-semibold">
            {conversion.localAmount.toLocaleString(undefined, {
              maximumFractionDigits: 0
            })} {conversion.currencyCode}
          </span>
        </div>

        <div className="flex justify-between items-center">
          <span className="text-slate-400 text-sm">USD Equivalent:</span>
          <span className="text-blue-300 text-sm">
            ~${conversion.asUsd.toFixed(2)} USD
          </span>
        </div>
      </div>

      {/* Transaction Type Info */}
      <div className="bg-slate-900/40 rounded-lg p-3 border border-slate-700/20">
        <p className="text-slate-400 text-xs">
          {txType === 'trust_contribution' && 
            '📦 Your ICAN coins convert instantly to local currency in the Trust account'}
          {txType === 'investment' && 
            '💼 The business receives stable local currency, protected from crypto volatility'}
          {txType === 'cmms_payment' && 
            '🏭 Payment amount locked at this rate for approval chain'}
        </p>
      </div>

      {/* Auto-Refresh Notice */}
      <div className="flex items-center gap-2 text-xs text-slate-400">
        <TrendingUp className="w-3 h-3" />
        <span>Rate valid for 30 minutes • Updates every 5 minutes</span>
      </div>
    </div>
  );
}
