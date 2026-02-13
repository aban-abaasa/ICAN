/**
 * ContributionModal - Allow users to contribute money to group
 * Integrates with blockchain smart contracts + Country-based currency detection
 */

import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  X,
  Send,
  Wallet,
  Zap,
  CheckCircle,
  AlertCircle,
  Globe,
  CreditCard,
  Shield,
  TrendingUp
} from 'lucide-react';
import {
  recordGroupContribution,
  createSmartContractTransaction
} from '../services/trustService';
import CountryService from '../services/countryService';
import { supabase } from '../lib/supabase/client';
import icanCoinService from '../services/icanCoinService';

const ContributionModal = ({ group, onClose, onContributionSuccess }) => {
  const { user } = useAuth();
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });
  const [txHash, setTxHash] = useState(null);
  const [paymentMethod, setPaymentMethod] = useState('ican');
  const [userCountry, setUserCountry] = useState(null);
  const [userCountryCode, setUserCountryCode] = useState('US');
  const [userCurrency, setUserCurrency] = useState('USD');
  const [currencySymbol, setCurrencySymbol] = useState('$');
  const [showBlockchainInfo, setShowBlockchainInfo] = useState(false);

  // Load user country and currency exactly like ICANWallet
  useEffect(() => {
    const loadUserCountry = async () => {
      try {
        // Method 1: Get from user metadata (fastest)
        let userCountryCodeValue = user?.user_metadata?.country;
        
        // Method 2: Fallback to database if not in metadata
        if (!userCountryCodeValue && user?.id) {
          const countryData = await icanCoinService.getUserCountry(user.id);
          userCountryCodeValue = countryData || 'US';
        }

        // Default fallback
        if (!userCountryCodeValue) {
          userCountryCodeValue = 'US';
        }

        // Get all country info
        const countryInfo = CountryService.getCountry(userCountryCodeValue);
        const currencyCode = CountryService.getCurrencyCode(userCountryCodeValue);
        const currencySymbol = CountryService.getCurrencySymbol(userCountryCodeValue);
        
        setUserCountryCode(userCountryCodeValue);
        setUserCountry(countryInfo?.name || 'United States');
        setUserCurrency(currencyCode || 'USD');
        setCurrencySymbol(currencySymbol || '$');
        
        console.log(`✅ Contribution Modal - Country: ${userCountryCodeValue}, Currency: ${currencyCode}, Symbol: ${currencySymbol}`);
      } catch (error) {
        console.log('Could not detect country, using default USD');
        setUserCountryCode('US');
        setUserCountry('United States');
        setUserCurrency('USD');
        setCurrencySymbol('$');
      }
    };

    if (user?.id) {
      loadUserCountry();
    }
  }, [user?.id]);

  const handleContribute = async () => {
    if (!amount || isNaN(amount) || parseFloat(amount) <= 0) {
      setMessage({ type: 'error', text: 'Please enter a valid amount' });
      return;
    }

    setLoading(true);
    try {
      const contribution = parseFloat(amount);

      // 1. Create blockchain transaction (smart contract)
      const blockchainTx = await createSmartContractTransaction({
        groupId: group.id,
        userId: user.id,
        amount: contribution,
        type: 'contribution',
        currency: userCurrency,
        paymentMethod: paymentMethod
      });

      if (blockchainTx?.hash) {
        setTxHash(blockchainTx.hash);
        setShowBlockchainInfo(true);
        setMessage({
          type: 'success',
          text: `Blockchain transaction created: ${blockchainTx.hash.slice(0, 10)}...`
        });
      }

      // 2. Record contribution in database
      const result = await recordGroupContribution({
        groupId: group.id,
        userId: user.id,
        userEmail: user.email,
        amount: contribution,
        currency: userCurrency,
        paymentMethod: paymentMethod,
        blockchainHash: blockchainTx?.hash
      });

      if (result.success) {
        setMessage({
          type: 'success',
          text: `✅ Contributed ${currencySymbol}${contribution.toFixed(2)} to ${group.name}!`
        });
        setAmount('');
        setTimeout(() => {
          onContributionSuccess?.();
          onClose();
        }, 2000);
      }
    } catch (error) {
      console.error('Error processing contribution:', error);
      setMessage({
        type: 'error',
        text: error.message || 'Failed to process contribution'
      });
    } finally {
      setLoading(false);
    }
  };

  const quickAmounts = [0.5, 1, 2.5, 5]; // ICAN coins
  const paymentMethods = [
    { id: 'ican', label: 'ICAN Account', icon: '💳', description: 'Send ICAN coins from your wallet' }
  ];

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-50 p-4">
      {/* Main Modal Card - Creative Design */}
      <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-black rounded-2xl max-w-2xl w-full border border-purple-500/20 shadow-2xl overflow-hidden">
        
        {/* Top Gradient Bar */}
        <div className="h-1 bg-gradient-to-r from-purple-600 via-blue-600 to-cyan-600"></div>

        {/* Header Section */}
        <div className="relative p-6 bg-gradient-to-r from-slate-900/80 to-purple-900/20 border-b border-purple-500/10">
          <button 
            onClick={onClose} 
            className="absolute top-4 right-4 p-2 hover:bg-slate-700/50 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-400" />
          </button>
          
          <div className="flex items-center gap-3 mb-4">
            <div className="p-3 bg-gradient-to-br from-purple-600 to-blue-600 rounded-full">
              <Wallet className="w-6 h-6 text-white" />
            </div>
            <div>
              <h2 className="text-3xl font-black text-white">Make a Contribution</h2>
              <p className="text-sm text-gray-400 mt-1">Verified & Recorded on Blockchain</p>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-6">
          
          {/* Group & Country Info Cards - Side by Side */}
          <div className="grid md:grid-cols-2 gap-4">
            {/* Group Card */}
            <div className="bg-gradient-to-br from-amber-600/20 to-amber-500/10 border border-amber-500/30 rounded-xl p-4">
              <p className="text-xs text-amber-300 font-semibold uppercase tracking-wider mb-1">📊 Group</p>
              <h3 className="text-xl font-bold text-white mb-2">{group?.name || 'Group'}</h3>
              <p className="text-sm text-amber-200/70">Monthly Target: <span className="font-semibold text-amber-300">₿{group?.monthly_contribution || '1'} ICAN</span></p>
            </div>

            {/* ICAN Coin Card */}
            <div className="bg-gradient-to-br from-orange-600/20 to-amber-500/10 border border-amber-500/30 rounded-xl p-4">
              <p className="text-xs text-amber-300 font-semibold uppercase tracking-wider mb-1">� Cryptocurrency</p>
              <h3 className="text-xl font-bold text-white mb-2 flex items-center gap-2">
                <span className="text-2xl">₿</span>
                ICAN Coin
              </h3>
              <p className="text-sm text-amber-200/70">
                <span className="font-semibold text-amber-300 text-base">1 ICAN</span> = ~5,000 UGX
              </p>
              <p className="text-xs text-amber-200/50 mt-2">Your country: {userCountry || userCountryCode}</p>
            </div>
          </div>

          {/* Message Alert */}
          {message.text && (
            <div
              className={`p-4 rounded-xl flex items-start gap-3 border ${
                message.type === 'success'
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-400/50'
                  : 'bg-red-500/20 text-red-300 border-red-400/50'
              }`}
            >
              {message.type === 'success' ? (
                <CheckCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
              )}
              <span className="text-sm">{message.text}</span>
            </div>
          )}

          {/* Amount Input Section */}
          <div>
            <label className="text-sm font-bold text-gray-300 mb-3 block flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-amber-400" />
              Contribution Amount (ICAN Coins)
            </label>
            <div className="relative mb-4">
              <span className="absolute left-4 top-1/2 transform -translate-y-1/2 text-amber-400 text-2xl font-bold">₿</span>
              <input
                type="number"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                disabled={loading}
                min="0.1"
                step="0.01"
                className="w-full pl-12 pr-4 py-4 bg-slate-800/50 border-2 border-amber-500/30 rounded-xl text-white text-xl placeholder-gray-600 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20 disabled:opacity-50 transition-all"
              />
            </div>

            {/* Quick Amount Buttons */}
            <div className="grid grid-cols-4 gap-2">
              {quickAmounts.map((amt) => (
                <button
                  key={amt}
                  onClick={() => setAmount(amt.toString())}
                  disabled={loading}
                  className="py-3 bg-gradient-to-b from-amber-600/40 to-amber-600/20 hover:from-amber-600/60 hover:to-amber-600/40 border border-amber-500/40 hover:border-amber-500/70 text-white font-bold rounded-lg transition-all disabled:opacity-50 text-sm"
                >
                  ₿{amt}
                </button>
              ))}
            </div>
          </div>

          {/* Payment Method Section - ICAN Account Only */}
          <div>
            <label className="text-sm font-bold text-gray-300 mb-3 block flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-blue-400" />
              Payment Method
            </label>
            
            {/* ICAN Account Card - Single Option */}
            <div className="bg-gradient-to-br from-blue-600/30 to-cyan-600/30 border-2 border-blue-500/60 rounded-xl p-5 shadow-lg shadow-blue-500/20">
              <div className="flex items-start gap-4">
                <div className="text-4xl">💳</div>
                <div className="flex-1">
                  <h3 className="text-lg font-bold text-white mb-1">ICAN Account</h3>
                  <p className="text-sm text-blue-200/80 mb-2">Send money directly from your ICAN Wallet</p>
                  <div className="inline-flex items-center gap-2 px-3 py-1 bg-blue-600/40 border border-blue-400/50 rounded-full">
                    <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                    <span className="text-xs font-semibold text-blue-300">Available & Secure</span>
                  </div>
                </div>
                <div className="flex items-center justify-center w-6 h-6 rounded-full bg-blue-600/50 border border-blue-400/70">
                  <div className="w-4 h-4 rounded-full bg-blue-400 shadow-lg shadow-blue-500/50"></div>
                </div>
              </div>
            </div>

            {/* Info Box */}
            <div className="bg-cyan-600/20 border border-cyan-500/30 rounded-lg p-3 mt-3 flex gap-2">
              <Shield className="w-5 h-5 text-cyan-400 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-cyan-200/80">
                <span className="font-semibold">Secure ICAN Transfer:</span> Your contribution will be deducted directly from your ICAN wallet balance and recorded on the blockchain.
              </p>
            </div>
          </div>

          {/* Summary Section */}
          {amount && !isNaN(amount) && parseFloat(amount) > 0 && (
            <div className="bg-gradient-to-br from-slate-700/40 to-slate-800/40 border border-slate-600/30 rounded-xl p-5 space-y-3">
              <div className="flex justify-between items-center pb-3 border-b border-slate-600/30">
                <span className="text-gray-400 flex items-center gap-2"><span className="text-lg">💰</span> Your Contribution</span>
                <span className="font-bold text-white text-lg">₿{parseFloat(amount).toFixed(2)} ICAN</span>
              </div>
              <div className="flex justify-between items-center pb-3 border-b border-slate-600/30">
                <span className="text-gray-400 flex items-center gap-2"><span className="text-lg">📈</span> Annual Interest (10%)</span>
                <span className="font-bold text-emerald-300">₿{(parseFloat(amount) * 0.1).toFixed(2)} ICAN</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-400 flex items-center gap-2"><span className="text-lg">📊</span> Daily Growth</span>
                <span className="font-bold text-cyan-300">₿{(parseFloat(amount) * 0.1 / 365).toFixed(4)} ICAN/day</span>
              </div>
            </div>
          )}

          {/* Blockchain Info Box */}
          <div className="bg-gradient-to-r from-blue-600/20 to-cyan-600/20 border border-blue-500/40 rounded-xl p-4 flex items-start gap-3">
            <Shield className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-blue-300 mb-1">🔐 Blockchain Security</p>
              <p className="text-xs text-blue-200/80">This contribution will be verified and recorded on the blockchain for complete transparency and immutability.</p>
            </div>
          </div>

          {/* Blockchain Transaction Hash Display */}
          {txHash && showBlockchainInfo && (
            <div className="bg-gradient-to-r from-purple-600/30 to-pink-600/30 border border-purple-500/50 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <Zap className="w-5 h-5 text-purple-400" />
                <p className="text-sm font-bold text-purple-300">✅ Blockchain Verified</p>
              </div>
              <p className="text-xs text-purple-200/70 break-all font-mono bg-black/30 p-2 rounded border border-purple-500/20">
                TX: {txHash}
              </p>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-3 pt-4">
            <button
              onClick={handleContribute}
              disabled={loading || !amount}
              className="flex-1 py-4 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl font-bold transition-all flex items-center justify-center gap-2 shadow-lg shadow-purple-500/30 disabled:shadow-none text-lg"
            >
              {loading ? (
                <>
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <Send className="w-5 h-5" />
                  Confirm Contribution
                </>
              )}
            </button>
            <button
              onClick={onClose}
              disabled={loading}
              className="flex-1 py-4 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white rounded-xl font-bold transition-all"
            >
              Cancel
            </button>
          </div>
        </div>

        {/* Bottom Footer */}
        <div className="px-6 py-4 bg-slate-950/50 border-t border-slate-700/50 text-center">
          <p className="text-xs text-gray-500 flex items-center justify-center gap-2">
            <Zap className="w-3 h-3" />
            Powered by Blockchain • Instant Settlement • 24/7 Access
          </p>
        </div>
      </div>
    </div>
  );
};

export default ContributionModal;
