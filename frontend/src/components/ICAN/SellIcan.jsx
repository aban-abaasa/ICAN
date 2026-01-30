/**
 * 💰 Sell ICAN Component
 * Convert ICAN Coins back to local currency at current market price
 */

import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import icanCoinService from '../../services/icanCoinService';
import icanCoinBlockchainService from '../../services/icanCoinBlockchainService';
import { CountryService } from '../../services/countryService';
import './IcanTrading.css';

export default function SellIcan() {
  const { user } = useAuth();
  const [icanAmount, setIcanAmount] = useState('');
  const [localAmount, setLocalAmount] = useState(0);
  const [marketPrice, setMarketPrice] = useState(5000);
  const [country, setCountry] = useState(null);
  const [currency, setCurrency] = useState('UGX');
  const [currencySymbol, setCurrencySymbol] = useState('Sh');
  const [balance, setBalance] = useState(0);
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [percentageChange, setPercentageChange] = useState(0);
  const [gainLoss, setGainLoss] = useState({ value: 0, percentage: 0, type: 'neutral' });

  // Initialize user data and market price
  useEffect(() => {
    const initializeData = async () => {
      try {
        setLoading(true);

        // Get user's country
        const userCountry = await icanCoinService.getUserCountry(user.id);
        setCountry(userCountry);
        setCurrency(CountryService.getCurrencyCode(userCountry));
        setCurrencySymbol(CountryService.getCurrencySymbol(userCountry));

        // Get ICAN balance
        const userBalance = await icanCoinService.getIcanBalance(user.id);
        setBalance(userBalance);

        // Get market price
        const marketData = await icanCoinBlockchainService.getCurrentPrice();
        setMarketPrice(marketData.priceUGX);
        setPercentageChange(marketData.percentageChange24h);
      } catch (err) {
        setError('Failed to load account data');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    if (user?.id) {
      initializeData();
    }
  }, [user]);

  // Calculate local amount and gain/loss when ICAN amount changes
  useEffect(() => {
    if (icanAmount && country) {
      const local = CountryService.icanToLocal(
        parseFloat(icanAmount),
        country,
        marketPrice
      );
      setLocalAmount(local);

      // Calculate potential gain/loss (assuming base purchase was at 5000 UGX)
      const baseRate = 5000;
      const purchaseValue = parseFloat(icanAmount) * baseRate;
      const currentValue = parseFloat(icanAmount) * marketPrice;
      const gainLossValue = currentValue - purchaseValue;
      const gainLossPercentage = (gainLossValue / purchaseValue) * 100;

      setGainLoss({
        value: gainLossValue,
        percentage: gainLossPercentage,
        type: gainLossValue >= 0 ? 'gain' : 'loss'
      });
    } else {
      setLocalAmount(0);
      setGainLoss({ value: 0, percentage: 0, type: 'neutral' });
    }
  }, [icanAmount, country, marketPrice]);

  const handleIcanChange = (e) => {
    const value = e.target.value;
    setIcanAmount(value);
    setError('');
    setSuccess('');
  };

  const handleSellIcan = async (e) => {
    e.preventDefault();

    if (!icanAmount || parseFloat(icanAmount) <= 0) {
      setError('Please enter a valid ICAN amount');
      return;
    }

    if (parseFloat(icanAmount) > balance) {
      setError(`Insufficient balance. You have ${balance.toFixed(2)} ICAN`);
      return;
    }

    try {
      setProcessing(true);
      setError('');
      setSuccess('');

      const result = await icanCoinService.sellIcanCoins(
        user.id,
        parseFloat(icanAmount),
        country
      );

      if (result.success) {
        const gainLossMsg =
          gainLoss.type === 'gain'
            ? `📈 You gained ${currencySymbol}${gainLoss.value.toFixed(2)} (${gainLoss.percentage.toFixed(2)}%)`
            : gainLoss.type === 'loss'
            ? `📉 You lost ${currencySymbol}${Math.abs(gainLoss.value).toFixed(2)} (${gainLoss.percentage.toFixed(2)}%)`
            : '➡️ No gain or loss';

        setSuccess(
          `✅ Successfully sold ${result.icanAmount.toFixed(2)} ICAN for ${currencySymbol}${result.localAmount.toLocaleString()}! ${gainLossMsg}`
        );

        // Record blockchain transaction
        await icanCoinBlockchainService.recordBlockchainTransaction(
          user.id,
          'sale',
          result.icanAmount,
          result.pricePerCoin,
          'completed'
        );

        // Update balance
        const newBalance = balance - parseFloat(icanAmount);
        setBalance(newBalance);

        // Reset form
        setIcanAmount('');
        setLocalAmount(0);
      } else {
        setError(result.error || 'Sale failed');
      }
    } catch (err) {
      setError(err.message || 'An error occurred');
      console.error(err);
    } finally {
      setProcessing(false);
    }
  };

  if (loading) {
    return (
      <div className="ican-trading-container">
        <div className="loading-spinner">Loading your account...</div>
      </div>
    );
  }

  return (
    <div className="ican-trading-container sell-ican">
      <div className="trading-card">
        {/* Trading Form */}
        <form onSubmit={handleSellIcan} className="trading-form">
          {/* ICAN Amount Input */}
          <div className="form-group">
            <label htmlFor="icanAmount" className="form-label">
              ICAN Amount to Sell
            </label>
            <div className="input-wrapper">
              <span className="currency-prefix">💎</span>
              <input
                id="icanAmount"
                type="number"
                min="0"
                step="0.01"
                value={icanAmount}
                onChange={handleIcanChange}
                placeholder="Enter ICAN amount"
                disabled={processing || balance === 0}
                className="amount-input"
                max={balance}
              />
            </div>
          </div>

          {/* Conversion Display */}
          {icanAmount > 0 && (
            <div className="conversion-display">
              <div className="conversion-item">
                <div className="conversion-label">ICAN Coins</div>
                <div className="conversion-value">{parseFloat(icanAmount).toFixed(2)}</div>
              </div>

              <div className="conversion-arrow">→</div>

              <div className="conversion-item">
                <div className="conversion-label">{currency}</div>
                <div className="conversion-value highlight">{currencySymbol}{localAmount.toLocaleString()}</div>
              </div>
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="alert alert-error">
              ❌ {error}
            </div>
          )}

          {/* Success Message */}
          {success && (
            <div className="alert alert-success">
              {success}
            </div>
          )}

          {/* Sell Button */}
          <button
            type="submit"
            disabled={!icanAmount || parseFloat(icanAmount) <= 0 || parseFloat(icanAmount) > balance || processing}
            className="btn-primary sell-btn"
          >
            {processing ? (
              <>
                <span className="spinner"></span> Processing...
              </>
            ) : (
              <>💰 Sell Now</>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
