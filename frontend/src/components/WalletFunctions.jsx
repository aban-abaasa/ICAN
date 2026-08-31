/**
 * 💰 Wallet Functions Component
 * Example implementation of Send, Receive, and Top Up functions
 * Can be integrated into the main ICANWallet component
 */

import React, { useState } from 'react';
import { Send, ArrowDownLeft, Plus, AlertCircle, CheckCircle } from 'lucide-react';
import { walletService } from '../services/walletService';

const WalletFunctions = ({ currentUser, selectedCurrency, onTransactionComplete }) => {
  // Send state
  const [sendForm, setSendForm] = useState({
    recipient: '',
    amount: '',
    description: ''
  });

  // Receive state
  const [receiveForm, setReceiveForm] = useState({
    amount: '',
    description: ''
  });

  // Top Up state
  const [topupForm, setTopupForm] = useState({
    amount: '',
    paymentInput: '',
    paymentMethod: 'mtn'
  });

  // UI state
  const [activeFunction, setActiveFunction] = useState(null); // 'send', 'receive', 'topup'
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);
  const [transactionResult, setTransactionResult] = useState(null);

  /**
   * Initialize wallet service
   */
  const initializeWallet = async () => {
    if (!currentUser) {
      setMessage({
        type: 'error',
        text: '❌ Please log in first'
      });
      return false;
    }

    try {
      await walletService.initialize(currentUser);
      return true;
    } catch (error) {
      setMessage({
        type: 'error',
        text: `❌ Failed to initialize wallet: ${error.message}`
      });
      return false;
    }
  };

  /**
   * 📤 SEND MONEY Handler
   */
  const handleSend = async (e) => {
    e.preventDefault();

    if (!sendForm.recipient || !sendForm.amount) {
      setMessage({
        type: 'error',
        text: '❌ Please fill in recipient and amount'
      });
      return;
    }

    setLoading(true);
    setMessage(null);

    try {
      const initialized = await initializeWallet();
      if (!initialized) return;

      const result = await walletService.send({
        amount: sendForm.amount,
        currency: selectedCurrency,
        recipientPhone: sendForm.recipient,
        description: sendForm.description || `Send to ${sendForm.recipient}`,
        paymentMethod: 'MOMO'
      });

      if (result.success) {
        setTransactionResult({
          type: 'send',
          success: true,
          transactionId: result.transactionId,
          amount: result.amount,
          currency: result.currency,
          recipient: sendForm.recipient,
          message: `✅ Successfully sent ${result.amount} ${result.currency} to ${sendForm.recipient}`
        });

        // Reset form
        setSendForm({ recipient: '', amount: '', description: '' });

        // Notify parent
        if (onTransactionComplete) {
          onTransactionComplete(result);
        }
      } else {
        setMessage({
          type: 'error',
          text: `❌ Send failed: ${result.error}`
        });
      }
    } catch (error) {
      setMessage({
        type: 'error',
        text: `❌ Unexpected error: ${error.message}`
      });
    } finally {
      setLoading(false);
    }
  };

  /**
   * 📥 RECEIVE MONEY Handler
   */
  const handleReceive = async (e) => {
    e.preventDefault();

    if (!receiveForm.amount) {
      setMessage({
        type: 'error',
        text: '❌ Please enter an amount'
      });
      return;
    }

    setLoading(true);
    setMessage(null);

    try {
      const initialized = await initializeWallet();
      if (!initialized) return;

      const result = await walletService.receive({
        amount: receiveForm.amount,
        currency: selectedCurrency,
        description: receiveForm.description || `Receive request`,
        paymentMethod: 'MOMO'
      });

      if (result.success) {
        setTransactionResult({
          type: 'receive',
          success: true,
          paymentRef: result.paymentRef,
          paymentLink: result.paymentLink,
          amount: result.amount,
          currency: result.currency,
          message: `✅ Payment link ready! Copy and share: ${result.paymentLink}`
        });

        // Reset form
        setReceiveForm({ amount: '', description: '' });

        // Notify parent
        if (onTransactionComplete) {
          onTransactionComplete(result);
        }
      } else {
        setMessage({
          type: 'error',
          text: `❌ Receive setup failed: ${result.error}`
        });
      }
    } catch (error) {
      setMessage({
        type: 'error',
        text: `❌ Unexpected error: ${error.message}`
      });
    } finally {
      setLoading(false);
    }
  };

  /**
   * 💳 TOP UP Handler
   */
  const handleTopUp = async (e) => {
    e.preventDefault();

    if (!topupForm.amount || !topupForm.paymentInput) {
      setMessage({
        type: 'error',
        text: '❌ Please enter amount and payment details'
      });
      return;
    }

    setLoading(true);
    setMessage(null);

    try {
      const initialized = await initializeWallet();
      if (!initialized) return;

      const result = await walletService.topUp({
        amount: topupForm.amount,
        currency: selectedCurrency,
        paymentInput: topupForm.paymentInput,
        paymentMethod: topupForm.paymentMethod,
        paymentDetails: {
          email: currentUser?.email || 'user@ican.io',
          name: currentUser?.name || 'IcanEra Customer',
          phone: topupForm.paymentInput
        }
      });

      if (result.success) {
        setTransactionResult({
          type: 'topup',
          success: true,
          transactionId: result.transactionId,
          amount: result.amount,
          currency: result.currency,
          method: topupForm.paymentMethod,
          message: `✅ Successfully added ${result.amount} ${result.currency} to your wallet`
        });

        // Reset form
        setTopupForm({ amount: '', paymentInput: '', paymentMethod: 'mtn' });

        // Notify parent
        if (onTransactionComplete) {
          onTransactionComplete(result);
        }
      } else {
        setMessage({
          type: 'error',
          text: `❌ Top-up failed: ${result.error}`
        });
      }
    } catch (error) {
      setMessage({
        type: 'error',
        text: `❌ Unexpected error: ${error.message}`
      });
    } finally {
      setLoading(false);
    }
  };

  /**
   * Copy payment link to clipboard
   */
  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    setMessage({
      type: 'success',
      text: '✅ Copied to clipboard!'
    });
  };

  return (
    <div className="wallet-functions-container space-y-6">
      {/* Function Buttons */}
      <div className="function-buttons grid grid-cols-3 gap-4">
        <button
          onClick={() => setActiveFunction('send')}
          className={`p-4 rounded-lg border-2 transition ${
            activeFunction === 'send'
              ? 'border-blue-500 bg-blue-50'
              : 'border-gray-200 hover:border-gray-300'
          }`}
        >
          <Send className="w-6 h-6 mx-auto mb-2 text-blue-500" />
          <div className="font-semibold">Send</div>
          <div className="text-sm text-gray-600">Send money</div>
        </button>

        <button
          onClick={() => setActiveFunction('receive')}
          className={`p-4 rounded-lg border-2 transition ${
            activeFunction === 'receive'
              ? 'border-green-500 bg-green-50'
              : 'border-gray-200 hover:border-gray-300'
          }`}
        >
          <ArrowDownLeft className="w-6 h-6 mx-auto mb-2 text-green-500" />
          <div className="font-semibold">Receive</div>
          <div className="text-sm text-gray-600">Request payment</div>
        </button>

        <button
          onClick={() => setActiveFunction('topup')}
          className={`p-4 rounded-lg border-2 transition ${
            activeFunction === 'topup'
              ? 'border-purple-500 bg-purple-50'
              : 'border-gray-200 hover:border-gray-300'
          }`}
        >
          <Plus className="w-6 h-6 mx-auto mb-2 text-purple-500" />
          <div className="font-semibold">Top Up</div>
          <div className="text-sm text-gray-600">Add funds</div>
        </button>
      </div>

      {/* Messages */}
      {message && (
        <div
          className={`p-4 rounded-lg flex items-center gap-2 ${
            message.type === 'error'
              ? 'bg-red-50 text-red-700 border border-red-200'
              : 'bg-green-50 text-green-700 border border-green-200'
          }`}
        >
          {message.type === 'error' ? (
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
          ) : (
            <CheckCircle className="w-5 h-5 flex-shrink-0" />
          )}
          <span>{message.text}</span>
        </div>
      )}

      {/* SEND FORM */}
      {activeFunction === 'send' && (
        <form onSubmit={handleSend} className="space-y-4 p-6 bg-gray-50 rounded-lg">
          <h3 className="text-lg font-bold mb-4">📤 Send Money</h3>

          <div>
            <label className="block text-sm font-medium mb-1">
              Recipient Phone Number
            </label>
            <input
              type="tel"
              placeholder="256701234567"
              value={sendForm.recipient}
              onChange={(e) =>
                setSendForm({ ...sendForm, recipient: e.target.value })
              }
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              Amount ({selectedCurrency})
            </label>
            <input
              type="number"
              placeholder="500"
              value={sendForm.amount}
              onChange={(e) =>
                setSendForm({ ...sendForm, amount: e.target.value })
              }
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              Description (Optional)
            </label>
            <input
              type="text"
              placeholder="Payment for services"
              value={sendForm.description}
              onChange={(e) =>
                setSendForm({ ...sendForm, description: e.target.value })
              }
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-500 text-white py-2 rounded-lg font-semibold hover:bg-blue-600 disabled:opacity-50"
          >
            {loading ? 'Processing...' : '💰 Send Money'}
          </button>
        </form>
      )}

      {/* RECEIVE FORM */}
      {activeFunction === 'receive' && (
        <form onSubmit={handleReceive} className="space-y-4 p-6 bg-gray-50 rounded-lg">
          <h3 className="text-lg font-bold mb-4">📥 Receive Payment</h3>

          <div>
            <label className="block text-sm font-medium mb-1">
              Amount ({selectedCurrency})
            </label>
            <input
              type="number"
              placeholder="1000"
              value={receiveForm.amount}
              onChange={(e) =>
                setReceiveForm({ ...receiveForm, amount: e.target.value })
              }
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              Description (Optional)
            </label>
            <input
              type="text"
              placeholder="Invoice payment"
              value={receiveForm.description}
              onChange={(e) =>
                setReceiveForm({ ...receiveForm, description: e.target.value })
              }
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 outline-none"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-green-500 text-white py-2 rounded-lg font-semibold hover:bg-green-600 disabled:opacity-50"
          >
            {loading ? 'Processing...' : '🔗 Create Payment Link'}
          </button>
        </form>
      )}

      {/* TOP UP FORM */}
      {activeFunction === 'topup' && (
        <form onSubmit={handleTopUp} className="space-y-4 p-6 bg-gray-50 rounded-lg">
          <h3 className="text-lg font-bold mb-4">💳 Top Up Wallet</h3>

          <div>
            <label className="block text-sm font-medium mb-1">
              Payment Method
            </label>
            <select
              value={topupForm.paymentMethod}
              onChange={(e) =>
                setTopupForm({ ...topupForm, paymentMethod: e.target.value })
              }
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none"
            >
              <option value="mtn">MTN Mobile Money</option>
              <option value="vodafone">Vodafone Money</option>
              <option value="airtel">Airtel Money</option>
              <option value="visa">Visa Card</option>
              <option value="mastercard">MasterCard</option>
              <option value="ussd">USSD</option>
              <option value="bank">Bank Transfer</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              {topupForm.paymentMethod === 'bank'
                ? 'Account Number'
                : 'Phone/Card Number'}
            </label>
            <input
              type="text"
              placeholder="256701234567"
              value={topupForm.paymentInput}
              onChange={(e) =>
                setTopupForm({ ...topupForm, paymentInput: e.target.value })
              }
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              Amount ({selectedCurrency})
            </label>
            <input
              type="number"
              placeholder="50000"
              value={topupForm.amount}
              onChange={(e) =>
                setTopupForm({ ...topupForm, amount: e.target.value })
              }
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-purple-500 text-white py-2 rounded-lg font-semibold hover:bg-purple-600 disabled:opacity-50"
          >
            {loading ? 'Processing...' : '💳 Top Up Now'}
          </button>
        </form>
      )}

      {/* TRANSACTION RESULT */}
      {transactionResult && transactionResult.success && (
        <div className="p-6 bg-green-50 border border-green-200 rounded-lg space-y-4">
          <div className="flex items-center gap-2">
            <CheckCircle className="w-6 h-6 text-green-600" />
            <h4 className="text-lg font-bold text-green-900">
              {transactionResult.type === 'send'
                ? '✅ Money Sent'
                : transactionResult.type === 'receive'
                ? '✅ Payment Link Ready'
                : '✅ Wallet Topped Up'}
            </h4>
          </div>

          <div className="space-y-2 text-sm">
            <div>
              <span className="font-semibold">Amount:</span> {transactionResult.amount}{' '}
              {transactionResult.currency}
            </div>

            {transactionResult.type === 'send' && (
              <div>
                <span className="font-semibold">Recipient:</span>{' '}
                {transactionResult.recipient}
              </div>
            )}

            {transactionResult.type === 'receive' && (
              <div>
                <span className="font-semibold">Payment Link:</span>
                <div className="mt-2 p-3 bg-white rounded border border-gray-300 break-all text-blue-600">
                  {transactionResult.paymentLink}
                </div>
                <button
                  onClick={() => copyToClipboard(transactionResult.paymentLink)}
                  className="mt-2 text-blue-600 hover:underline text-sm font-semibold"
                >
                  📋 Copy Link
                </button>
              </div>
            )}

            {transactionResult.transactionId && (
              <div>
                <span className="font-semibold">Transaction ID:</span>{' '}
                {transactionResult.transactionId}
              </div>
            )}
          </div>

          <p className="text-sm text-green-700">{transactionResult.message}</p>

          <button
            onClick={() => {
              setTransactionResult(null);
              setActiveFunction(null);
            }}
            className="w-full bg-green-600 text-white py-2 rounded-lg font-semibold hover:bg-green-700"
          >
            Close
          </button>
        </div>
      )}
    </div>
  );
};

export default WalletFunctions;
