/**
 * 💳 Buy ICAN Component
 * Convert local currency to ICAN Coins at current market price
 */

import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import icanCoinService from '../../services/icanCoinService';
import icanCoinBlockchainService from '../../services/icanCoinBlockchainService';
import { CountryService } from '../../services/countryService';
import './IcanTrading.css';

export default function BuyIcan() {
  const { user } = useAuth();
  const [localAmount, setLocalAmount] = useState('');
  const [icanAmount, setIcanAmount] = useState(0);
  const [marketPrice, setMarketPrice] = useState(5000);
  const [country, setCountry] = useState(null);
  const [currency, setCurrency] = useState('UGX');
  const [currencySymbol, setCurrencySymbol] = useState('Sh');
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [paymentMethods, setPaymentMethods] = useState('card');
  const [priceHistory, setPriceHistory] = useState(null);
  const [percentageChange, setPercentageChange] = useState(0);

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

        // Get market price
        const marketData = await icanCoinBlockchainService.getCurrentPrice();
        setMarketPrice(marketData.priceUGX);
        setPercentageChange(marketData.percentageChange24h);

        // Get price history
        const history = await icanCoinBlockchainService.getPriceHistory('24h');
        setPriceHistory(history);
      } catch (err) {
        setError('Failed to load market data');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    if (user?.id) {
      initializeData();
    }
  }, [user]);

  // Calculate ICAN amount when local amount changes
  useEffect(() => {
    if (localAmount && country) {
      const ican = CountryService.localToIcan(
        parseFloat(localAmount),
        country,
        marketPrice
      );
      setIcanAmount(ican);
    } else {
      setIcanAmount(0);
    }
  }, [localAmount, country, marketPrice]);

  const handleAmountChange = (e) => {
    const value = e.target.value;
    setLocalAmount(value);
    setError('');
    setSuccess('');
  };

  const handleBuyIcan = async (e) => {
    e.preventDefault();
    
    if (!localAmount || parseFloat(localAmount) <= 0) {
      setError('Please enter a valid amount');
      return;
    }

    try {
      setProcessing(true);
      setError('');
      setSuccess('');

      const result = await icanCoinService.buyIcanCoins(
        user.id,
        parseFloat(localAmount),
        country,
        paymentMethods
      );

      if (result.success) {
        const newBalance = result.newIcanBalance || 0;
        const newWallet = result.newWalletBalance || 0;
        const icanAmt = result.icanAmount || parseFloat(icanAmount);
        const pricePerCoin = result.pricePerCoin || 0;
        
        const transactionDetails = `
          💚 ICAN Coin Purchase Successful!
          
          📋 Transaction Details:
          • ICAN Coins Purchased: ${icanAmt.toFixed(8)}
          • Amount Paid: ${currencySymbol}${parseFloat(localAmount).toLocaleString()}
          • Rate: 1 ICAN = ${pricePerCoin.toLocaleString()} ${currency}
          • Your New ICAN Balance: ${newBalance.toFixed(8)} coins
          • Wallet Updated: ${currencySymbol}${parseFloat(newWallet).toLocaleString()} remaining
          
          ✅ Real money has been deducted from your account.
          ✅ ICAN coins are now in your wallet and ready to invest!
        `;
        
        setSuccess(transactionDetails);
        
        // Record blockchain transaction (non-blocking)
        if (icanAmt > 0 && pricePerCoin > 0) {
          try {
            const blockchainResult = await icanCoinBlockchainService.recordBlockchainTransaction(
              user.id,
              'purchase',
              icanAmt,
              pricePerCoin,
              'completed'
            );
            if (blockchainResult.success) {
              console.log('✅ Blockchain transaction recorded');
            } else {
              console.warn('⚠️ Blockchain recording failed (non-blocking):', blockchainResult.error);
            }
          } catch (blockchainError) {
            // Log but don't fail the entire purchase if blockchain recording fails
            console.warn('⚠️ Blockchain transaction error (non-blocking):', blockchainError);
          }
        }

        // Reset form
        setLocalAmount('');
        setIcanAmount(0);
      } else {
        setError(result.error || 'Purchase failed');
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
        <div className="loading-spinner">Loading market data...</div>
      </div>
    );
  }

  return (
    <div className="ican-trading-container buy-ican">
      <div className="trading-card">
        {/* Title */}
        <div style={{ marginBottom: '24px', textAlign: 'center' }}>
          <h3 style={{ margin: '0 0 4px 0', color: '#333', fontSize: '20px' }}>💳 Buy ICAN Coins</h3>
          <p style={{ margin: 0, color: '#666', fontSize: '13px' }}>Convert your local currency to ICAN at current market price</p>
        </div>

        {/* Trading Form */}
        <form onSubmit={handleBuyIcan} className="trading-form">
          {/* Local Amount Input */}
          <div className="form-group">
            <label htmlFor="localAmount" className="form-label">
              Amount in {currency}
            </label>
            <div className="input-wrapper">
              <span className="currency-prefix">{currencySymbol}</span>
              <input
                id="localAmount"
                type="number"
                min="0"
                step="0.01"
                value={localAmount}
                onChange={handleAmountChange}
                placeholder="Enter amount"
                disabled={processing}
                className="amount-input"
              />
            </div>
          </div>

          {/* ICAN Amount Display */}
          {icanAmount > 0 && (
            <div className="conversion-display">
              <div className="conversion-item">
                <div className="conversion-label">You Pay</div>
                <div className="conversion-value">{currencySymbol}{parseFloat(localAmount).toLocaleString()}</div>
              </div>
              
              <div className="conversion-arrow">→</div>
              
              <div className="conversion-item">
                <div className="conversion-label">You Get</div>
                <div className="conversion-value highlight">{icanAmount.toFixed(2)}</div>
              </div>
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="alert alert-error">
              {error}
            </div>
          )}

          {/* Success Message */}
          {success && (
            <div className="alert alert-success" style={{ whiteSpace: 'pre-wrap' }}>
              {success}
            </div>
          )}

          {/* Buy Button */}
          <button
            type="submit"
            disabled={!localAmount || parseFloat(localAmount) <= 0 || processing}
            className="btn-primary buy-btn"
          >
            {processing ? (
              <>
                <span className="spinner"></span> Processing...
              </>
            ) : (
              <>💳 Buy Now</>
            )}
          </button>
        </form>

        {/* Info Section */}
        <div style={{ marginTop: '20px', padding: '16px', background: '#f8f9fa', borderRadius: '8px', borderLeft: '3px solid #667eea' }}>
          <p style={{ margin: '0 0 8px 0', fontSize: '12px', color: '#666', fontWeight: '600', textTransform: 'uppercase' }}>ℹ️ How it works</p>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', fontSize: '13px', color: '#666', lineHeight: '1.6' }}>
            <li style={{ marginBottom: '4px' }}>✓ Real money is deducted from your account</li>
            <li style={{ marginBottom: '4px' }}>✓ ICAN coins arrive in your wallet instantly</li>
            <li>✓ Your coins are ready to invest or trade</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
