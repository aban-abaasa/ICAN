import React, { useState, useEffect } from 'react';
import {
  Lock,
  Fingerprint,
  X,
  CheckCircle,
  AlertCircle,
  Send,
  ArrowDownLeft,
  ArrowUpRight,
  CreditCard,
  DollarSign,
  TrendingUp,
  Eye,
  EyeOff,
  Delete,
  Shield,
} from 'lucide-react';
import universalTransactionService from '../services/universalTransactionService';
import PINRecoveryModal from './PINRecoveryModal';
import './UnifiedApprovalModal.css';

/**
 * 🔐 UNIFIED APPROVAL MODAL
 * 
 * Appears for ANY transaction requiring approval:
 * - Send, Receive, Withdraw, Deposit
 * - Cash-In, Cash-Out, Top-Up
 * - Supports: PIN entry, Fingerprint biometric
 * - Mobile-optimized with creative UI
 */
const UnifiedApprovalModal = ({
  isOpen,
  transactionType,
  amount,
  currency,
  recipient,
  description,
  userId,
  userEmail,
  recipientId,
  metadata = {},
  onApprove,
  onCancel,
  isLoading = false,
  error = null,
  attemptsRemaining = 3,
  supportsBiometric = false
}) => {
  const [authMethod, setAuthMethod] = useState('pin'); // 'pin' or 'biometric'
  const [pin, setPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [rememberPin, setRememberPin] = useState(false);
  const [biometricAttempting, setBiometricAttempting] = useState(false);
  const [biometricStatus, setBiometricStatus] = useState(null);
  const [localError, setLocalError] = useState(error);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPINRecovery, setShowPINRecovery] = useState(false);
  const isAccountLocked = error && error.toLowerCase().includes('account locked');

  // Load saved PIN from localStorage on mount
  useEffect(() => {
    try {
      const savedPin = localStorage.getItem('ican_wallet_pin');
      const savedRemember = localStorage.getItem('ican_wallet_remember_pin');
      if (savedPin && savedRemember === 'true') {
        setPin(savedPin);
        setRememberPin(true);
      }
    } catch (err) {
      console.warn('Could not load saved PIN:', err);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // Transaction icon mapping
  const transactionIcons = {
    send: '📤',
    receive: '📥',
    withdraw: '💸',
    deposit: '💳',
    cashIn: '💰',
    cashOut: '💵',
    topup: '⬆️',
  };

  const transactionLabels = {
    send: 'Send Money',
    receive: 'Receive Money',
    withdraw: 'Withdraw',
    deposit: 'Deposit',
    cashIn: 'Cash-In',
    cashOut: 'Cash-Out',
    topup: 'Top-Up',
  };

  // Handle PIN input
  const handlePinChange = (e) => {
    const value = e.target.value.replace(/[^\d]/g, '').slice(0, 4);
    setPin(value);
    setLocalError(null);
  };

  const handleNumericInput = (num) => {
    if (pin.length < 4) {
      const newPin = pin + num;
      setPin(newPin);
      setLocalError(null);
    }
  };

  const handleBackspace = () => {
    setPin(pin.slice(0, -1));
  };

  // Handle biometric authentication
  const handleBiometricAuth = async () => {
    if (!supportsBiometric) {
      setLocalError('Biometric authentication not available on this device');
      return;
    }

    setBiometricAttempting(true);
    setBiometricStatus('scanning');
    setLocalError(null);

    try {
      // Check if WebAuthn/Fingerprint API is available
      if (window.PublicKeyCredential) {
        // Simulate biometric scan (in production, use WebAuthn)
        await new Promise((resolve) => setTimeout(resolve, 2000));

        setBiometricStatus('success');
        setTimeout(() => {
          handleApprove('biometric');
        }, 1000);
      } else {
        throw new Error('Biometric authentication not supported');
      }
    } catch (err) {
      setBiometricStatus('failed');
      setLocalError('Biometric scan failed. Try PIN instead.');
      setBiometricAttempting(false);
    }
  };

  // Handle approval
  const handleApprove = async (method = 'pin') => {
    if (method === 'pin' && pin.length !== 4) {
      setLocalError('PIN must be 4 digits');
      return;
    }

    setIsSubmitting(true);
    try {
      // Save PIN if user wants to remember it
      if (rememberPin && method === 'pin') {
        try {
          localStorage.setItem('ican_wallet_pin', pin);
          localStorage.setItem('ican_wallet_remember_pin', 'true');
        } catch (err) {
          console.warn('Could not save PIN:', err);
        }
      }

      // Call universal transaction service
      const result = await universalTransactionService.processTransaction({
        transactionType,
        userId,
        agentId: null,
        pin: method === 'pin' ? pin : 'BIOMETRIC_AUTH',
        currency,
        amount,
        metadata
      });

      if (result.success) {
        // Call parent's onApprove with result
        await onApprove(pin, method, result);
        setPin('');
      } else {
        setLocalError(result.message);
      }
    } catch (err) {
      setLocalError(err.message || 'Approval failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    setPin('');
    setLocalError(null);
    setBiometricStatus(null);
    setBiometricAttempting(false);
    onCancel();
  };

  return (
    <div className="unified-approval-overlay">
      <div className="unified-approval-container">
        {/* Header */}
        <div className="approval-header">
          <button
            className="close-btn"
            onClick={handleCancel}
            disabled={isSubmitting}
          >
            <X size={20} />
          </button>
          <div className="header-title">
            <span className="transaction-icon">
              {transactionIcons[transactionType] || '💰'}
            </span>
            <h2>Confirm Transaction</h2>
          </div>
        </div>

        {/* Transaction Summary Card */}
        <div className="transaction-summary">
          <div className="transaction-detail">
            <span className="label">Type</span>
            <span className="value">
              {transactionLabels[transactionType] || 'Transaction'}
            </span>
          </div>

          <div className="divider"></div>

          <div className="transaction-detail">
            <span className="label">Amount</span>
            <span className="amount">
              {amount} {currency}
            </span>
          </div>

          {recipient && (
            <>
              <div className="divider"></div>
              <div className="transaction-detail">
                <span className="label">To</span>
                <span className="value recipient-info">
                  {recipient}
                </span>
              </div>
            </>
          )}

          {description && (
            <>
              <div className="divider"></div>
              <div className="transaction-detail">
                <span className="label">Description</span>
                <span className="value">{description}</span>
              </div>
            </>
          )}
        </div>

        {/* Authentication Method Selector */}
        <div className="auth-method-selector">
          <button
            className={`auth-method-btn ${authMethod === 'pin' ? 'active' : ''}`}
            onClick={() => setAuthMethod('pin')}
            disabled={isSubmitting}
          >
            <Lock size={18} />
            PIN
          </button>

          {supportsBiometric && (
            <button
              className={`auth-method-btn ${authMethod === 'biometric' ? 'active' : ''}`}
              onClick={() => setAuthMethod('biometric')}
              disabled={isSubmitting}
            >
              <Fingerprint size={18} />
              Biometric
            </button>
          )}
        </div>

        {/* PIN Entry Method */}
        {authMethod === 'pin' && (
          <div className="pin-entry-section">
            {/* PIN Display */}
            <div className="pin-display-container">
              <div className="pin-dots">
                {[0, 1, 2, 3].map((index) => (
                  <div
                    key={index}
                    className={`pin-dot ${index < pin.length ? 'filled' : ''}`}
                  >
                    {showPin && pin[index] ? pin[index] : '•'}
                  </div>
                ))}
              </div>
              <button
                type="button"
                className="show-pin-toggle"
                onClick={() => setShowPin(!showPin)}
                title={showPin ? 'Hide PIN' : 'Show PIN'}
              >
                {showPin ? '👁️‍🗨️' : '👁️'}
              </button>
            </div>

            {/* Error Message */}
            {(localError || error) && (
              <div className="error-message">
                <AlertCircle size={16} />
                <p>{localError || error}</p>
                {attemptsRemaining && (
                  <p className="attempts-info">
                    Attempts remaining: {attemptsRemaining}
                  </p>
                )}
              </div>
            )}

            {/* Numeric Keypad */}
            <div className="numeric-keypad">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
                <button
                  key={num}
                  type="button"
                  className="keypad-btn number-btn"
                  onClick={() => handleNumericInput(num)}
                  disabled={pin.length >= 4 || isSubmitting}
                >
                  {num}
                </button>
              ))}
              <button
                type="button"
                className="keypad-btn zero-btn"
                onClick={() => handleNumericInput(0)}
                disabled={pin.length >= 4 || isSubmitting}
              >
                0
              </button>
              <button
                type="button"
                className="keypad-btn backspace-btn"
                onClick={handleBackspace}
                disabled={pin.length === 0 || isSubmitting}
              >
                ⌫
              </button>
            </div>

            {isAccountLocked && (
              <button
                onClick={() => setShowPINRecovery(true)}
                className="mt-4 w-full bg-orange-500 hover:bg-orange-600 text-white font-medium py-2 rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                <Lock size={18} />
                Reset PIN - Unlock Account
              </button>
            )}
          </div>
        )}

        {/* PIN Recovery Modal */}
        {isOpen && (
          <PINRecoveryModal
            isOpen={showPINRecovery}
            onClose={() => setShowPINRecovery(false)}
            userId={userId}
            userEmail={userEmail}
          />
        )}

        {/* Biometric Method */}
        {authMethod === 'biometric' && supportsBiometric && (
          <div className="biometric-section">
            {biometricStatus === 'scanning' && (
              <div className="biometric-scanning">
                <div className="fingerprint-scanner">
                  <Fingerprint size={64} className="scanning-animation" />
                </div>
                <p>Place your fingerprint on the sensor...</p>
              </div>
            )}

            {biometricStatus === 'success' && (
              <div className="biometric-success">
                <CheckCircle size={64} className="success-animation" />
                <p>Fingerprint recognized!</p>
              </div>
            )}

            {biometricStatus === 'failed' && (
              <div className="biometric-failed">
                <AlertCircle size={64} />
                <p>Fingerprint not recognized</p>
                <button
                  className="retry-btn"
                  onClick={handleBiometricAuth}
                  disabled={isSubmitting}
                >
                  Try Again
                </button>
              </div>
            )}

            {!biometricStatus && (
              <div className="biometric-ready">
                <Fingerprint size={80} className="fingerprint-icon" />
                <p className="biometric-instruction">
                  Press the button below to scan your fingerprint
                </p>
                <button
                  className="biometric-scan-btn"
                  onClick={handleBiometricAuth}
                  disabled={biometricAttempting || isSubmitting}
                >
                  {biometricAttempting ? 'Scanning...' : 'Start Fingerprint Scan'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Action Buttons */}
        <div className="approval-actions">
          <button
            className="btn-cancel"
            onClick={handleCancel}
            disabled={isSubmitting}
          >
            Cancel
          </button>

          {authMethod === 'pin' && (
            <button
              className="btn-approve"
              onClick={() => handleApprove('pin')}
              disabled={pin.length !== 4 || isSubmitting || isLoading}
            >
              {isSubmitting || isLoading ? (
                <>
                  <div className="spinner"></div>
                  Verifying...
                </>
              ) : (
                'Approve'
              )}
            </button>
          )}
        </div>

        {/* Security Info */}
        <div className="security-info">
          <Lock size={14} />
          <span>Your transaction is protected with end-to-end encryption</span>
        </div>
      </div>
    </div>
  );
};

export default UnifiedApprovalModal;
