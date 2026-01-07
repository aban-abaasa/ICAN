/**
 * ContributionModal - Allow users to contribute money to group
 * Integrates with blockchain smart contracts
 */

import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  X,
  Send,
  Wallet,
  Zap,
  CheckCircle,
  AlertCircle
} from 'lucide-react';
import {
  recordGroupContribution,
  createSmartContractTransaction
} from '../services/trustService';

const ContributionModal = ({ group, onClose, onContributionSuccess }) => {
  const { user } = useAuth();
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });
  const [txHash, setTxHash] = useState(null);

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
        type: 'contribution'
      });

      if (blockchainTx?.hash) {
        setTxHash(blockchainTx.hash);
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
        blockchainHash: blockchainTx?.hash
      });

      if (result.success) {
        setMessage({
          type: 'success',
          text: `✅ Contributed $${contribution.toFixed(2)} to ${group.name}!`
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

  const quickAmounts = [50, 100, 250, 500];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-gradient-to-b from-slate-900 to-slate-800 rounded-xl p-8 max-w-md w-full border border-slate-700">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <Wallet className="w-6 h-6 text-emerald-400" />
            <h2 className="text-2xl font-black text-white">Contribute</h2>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-700 rounded-lg">
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        {/* Group Info */}
        <div className="bg-slate-800/50 rounded-lg p-3 mb-6 border border-slate-700">
          <p className="text-xs text-gray-400">Contributing to</p>
          <h3 className="text-lg font-bold text-white">{group.name}</h3>
          <p className="text-xs text-gray-500 mt-1">Monthly: ${group.monthly_contribution}</p>
        </div>

        {/* Message Alert */}
        {message.text && (
          <div
            className={`p-3 rounded-lg mb-4 flex items-start gap-2 ${
              message.type === 'success'
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/50'
                : 'bg-red-500/20 text-red-300 border border-red-400/50'
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

        {/* Amount Input */}
        <div className="mb-4">
          <label className="text-sm font-semibold text-gray-300 mb-2 block">
            Contribution Amount ($)
          </label>
          <div className="relative">
            <span className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400">$</span>
            <input
              type="number"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={loading}
              className="w-full pl-8 pr-4 py-3 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-gray-500 focus:border-emerald-500 focus:outline-none disabled:opacity-50"
            />
          </div>
        </div>

        {/* Quick Amount Buttons */}
        <div className="grid grid-cols-4 gap-2 mb-6">
          {quickAmounts.map((amt) => (
            <button
              key={amt}
              onClick={() => setAmount(amt.toString())}
              disabled={loading}
              className="py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm font-semibold rounded-lg transition-all disabled:opacity-50"
            >
              ${amt}
            </button>
          ))}
        </div>

        {/* Blockchain Info */}
        {txHash && (
          <div className="bg-blue-500/20 border border-blue-400/50 rounded-lg p-3 mb-4">
            <div className="flex items-center gap-2 mb-1">
              <Zap className="w-4 h-4 text-blue-400" />
              <p className="text-xs font-semibold text-blue-300">Blockchain Verified</p>
            </div>
            <p className="text-xs text-blue-200 break-all">Hash: {txHash}</p>
          </div>
        )}

        {/* Summary */}
        {amount && !isNaN(amount) && parseFloat(amount) > 0 && (
          <div className="bg-slate-800/50 rounded-lg p-3 mb-6 border border-slate-700">
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-400">Amount:</span>
                <span className="font-semibold text-white">${parseFloat(amount).toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Annual Interest (10%):</span>
                <span className="font-semibold text-emerald-300">
                  ${(parseFloat(amount) * 0.1).toFixed(2)}/year
                </span>
              </div>
              <div className="border-t border-slate-700 pt-2 flex justify-between">
                <span className="text-gray-400">Daily Growth:</span>
                <span className="font-semibold text-emerald-300">
                  ${(parseFloat(amount) * 0.1 / 365).toFixed(2)}/day
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex gap-3">
          <button
            onClick={handleContribute}
            disabled={loading || !amount}
            className="flex-1 py-3 bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-700 hover:to-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-semibold transition-all flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <Send className="w-5 h-5" />
                Contribute Now
              </>
            )}
          </button>
          <button
            onClick={onClose}
            disabled={loading}
            className="flex-1 py-3 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white rounded-lg font-semibold transition-all"
          >
            Cancel
          </button>
        </div>

        {/* Blockchain Notice */}
        <p className="text-xs text-gray-500 text-center mt-4">
          🔗 All contributions are recorded on blockchain for transparency & security
        </p>
      </div>
    </div>
  );
};

export default ContributionModal;
