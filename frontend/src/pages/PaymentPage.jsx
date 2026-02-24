/**
 * Payment Page Component
 * Displayed when user scans QR code to send money
 * Route: /pay/:paymentCode
 */

import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowRight, Loader, AlertCircle } from 'lucide-react';
import paymentRequestService from '../services/paymentRequestService';
import { walletTransactionService } from '../services/walletTransactionService';
import { useAuth } from '../context/AuthContext';

const PaymentPage = () => {
  const { paymentCode } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [paymentRequest, setPaymentRequest] = useState(null);
  const [error, setError] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    loadPaymentRequest();
  }, [paymentCode]);

  const loadPaymentRequest = async () => {
    try {
      setLoading(true);
      const result = await paymentRequestService.getPaymentRequest(paymentCode);

      if (!result.success) {
        setError(result.message || 'Payment request not found or expired');
        return;
      }

      setPaymentRequest(result.data);
    } catch (err) {
      console.error('Error loading payment request:', err);
      setError('Failed to load payment request');
    } finally {
      setLoading(false);
    }
  };

  const handleSendPayment = async () => {
    if (!user) {
      navigate('/login');
      return;
    }

    try {
      setProcessing(true);
      setError(null);

      // Verify payment request still valid
      if (paymentRequest.status !== 'pending') {
        setError('This payment request has already been completed');
        return;
      }

      if (new Date(paymentRequest.expires_at) < new Date()) {
        setError('This payment request has expired');
        return;
      }

      // Create transaction (simplified - integrate with your actual payment flow)
      const transactionResult = await walletTransactionService.saveTransaction({
        sender_id: user.id,
        recipient_id: paymentRequest.user_id,
        amount: paymentRequest.amount,
        currency: paymentRequest.currency,
        transaction_type: 'transfer',
        description: `Payment for: ${paymentRequest.description || 'Service'}`,
        payment_request_id: paymentRequest.id,
        status: 'pending'
      });

      if (transactionResult.success) {
        // Mark payment request as completed
        await paymentRequestService.completePaymentRequest(
          paymentCode,
          user.id,
          transactionResult.data.id
        );

        setSuccess(true);
        setPaymentRequest({
          ...paymentRequest,
          status: 'completed',
          payer_user_id: user.id
        });

        // Redirect after success
        setTimeout(() => {
          navigate('/wallet');
        }, 2000);
      } else {
        setError(transactionResult.message || 'Failed to process payment');
      }
    } catch (err) {
      console.error('Error sending payment:', err);
      setError(err.message || 'Failed to process payment');
    } finally {
      setProcessing(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center p-4">
        <div className="text-center">
          <Loader className="w-12 h-12 animate-spin text-cyan-400 mx-auto mb-4" />
          <p className="text-white font-medium">Loading payment request...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Success State */}
        {success && (
          <div className="glass-card p-8 text-center">
            <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="text-4xl">✓</span>
            </div>
            <h1 className="text-2xl font-bold text-white mb-2">Payment Sent!</h1>
            <p className="text-gray-400 mb-6">
              Your payment of {paymentRequest?.amount} {paymentRequest?.currency} has been sent successfully.
            </p>
            <p className="text-sm text-gray-500">Redirecting to wallet...</p>
          </div>
        )}

        {/* Error State */}
        {error && !success && (
          <div className="glass-card p-8">
            <div className="flex items-center gap-3 mb-4">
              <AlertCircle className="w-8 h-8 text-red-400" />
              <h1 className="text-2xl font-bold text-white">Payment Issue</h1>
            </div>
            <p className="text-gray-400 mb-6">{error}</p>
            <button
              onClick={() => navigate('/wallet')}
              className="w-full px-4 py-3 bg-cyan-500 hover:bg-cyan-600 text-white rounded-lg font-semibold transition-all"
            >
              Return to Wallet
            </button>
          </div>
        )}

        {/* Normal State - Show Payment Details */}
        {paymentRequest && !error && !success && (
          <div className="glass-card p-8 space-y-6">
            {/* Payment Amount */}
            <div className="text-center">
              <p className="text-gray-400 text-sm mb-2">You're sending</p>
              <div className="text-5xl font-bold text-cyan-400 mb-2">
                {paymentRequest.amount}
              </div>
              <p className="text-2xl text-white">{paymentRequest.currency}</p>
            </div>

            {/* Receiver Info */}
            <div className="bg-white/10 rounded-lg p-4 space-y-2">
              <p className="text-sm text-gray-400">To</p>
              <p className="text-white font-semibold">Payment Request</p>
              {paymentRequest.description && (
                <div className="pt-2 border-t border-white/20">
                  <p className="text-xs text-gray-400">For</p>
                  <p className="text-white">{paymentRequest.description}</p>
                </div>
              )}
            </div>

            {/* Request Status */}
            <div className="bg-white/5 rounded-lg p-3 text-xs">
              <div className="flex justify-between mb-1">
                <span className="text-gray-400">Status</span>
                <span className="text-cyan-400 font-semibold">{paymentRequest.status}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Expires</span>
                <span className="text-gray-300">
                  {new Date(paymentRequest.expires_at).toLocaleString()}
                </span>
              </div>
            </div>

            {/* User Login Check */}
            {!user ? (
              <button
                onClick={() => navigate('/login')}
                className="w-full px-4 py-3 bg-cyan-500 hover:bg-cyan-600 text-white rounded-lg font-semibold transition-all flex items-center justify-center gap-2"
              >
                Login to Pay
              </button>
            ) : (
              <>
                {/* Send Button */}
                <button
                  onClick={handleSendPayment}
                  disabled={processing || paymentRequest.status !== 'pending'}
                  className="w-full px-4 py-3 bg-gradient-to-r from-cyan-500 to-cyan-600 hover:shadow-lg hover:shadow-cyan-500/30 disabled:opacity-50 text-white rounded-lg font-semibold transition-all flex items-center justify-center gap-2"
                >
                  {processing ? (
                    <>
                      <Loader className="w-5 h-5 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    <>
                      Send Payment
                      <ArrowRight className="w-5 h-5" />
                    </>
                  )}
                </button>

                {/* Cancel Button */}
                <button
                  onClick={() => navigate('/wallet')}
                  disabled={processing}
                  className="w-full px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg font-medium transition-all disabled:opacity-50"
                >
                  Cancel
                </button>
              </>
            )}

            {/* Security Notice */}
            <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3">
              <p className="text-xs text-blue-300">
                🔒 This payment is secure. Only send to verified payment requests.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default PaymentPage;
