import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Lock, X, AlertCircle, Eye, EyeOff } from 'lucide-react';
import universalTransactionService from '../services/universalTransactionService';
import PINRecoveryModal from './PINRecoveryModal';
import './UnifiedApprovalModal.css';

/**
 * 🔐 UNIFIED APPROVAL MODAL
 * 
 * Appears for ANY transaction requiring approval:
 * - Send, Receive, Withdraw, Deposit
 * - Cash-In, Cash-Out, Top-Up
 * - PIN entry only, typed on the phone's own numeric keyboard (no custom pad)
 * - Classic, mobile-first layout
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
  attemptsRemaining = 3
}) => {
  const [pin, setPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [rememberPin, setRememberPin] = useState(false);
  const [localError, setLocalError] = useState(error);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPINRecovery, setShowPINRecovery] = useState(false);
  const pinInputRef = useRef(null);
  // A failed PIN attempt sets localError (line ~191) without ever touching
  // the error prop, since that only flows down from the parent's own state.
  // Checking error alone here missed the lock message entirely — the text
  // rendered (localError || error, below) and the lock check must agree.
  const displayedError = localError || error;
  const isAccountLocked = displayedError && displayedError.toLowerCase().includes('account locked');

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

  // Bring up the device's numeric keyboard as soon as the sheet opens.
  useEffect(() => {
    if (!isOpen) return undefined;
    const t = setTimeout(() => pinInputRef.current?.focus(), 250);
    return () => clearTimeout(t);
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

  // Handle approval
  const handleApprove = async () => {
    if (pin.length !== 4) {
      setLocalError('PIN must be 4 digits');
      return;
    }

    setIsSubmitting(true);
    try {
      // Save PIN if user wants to remember it
      if (rememberPin) {
        try {
          localStorage.setItem('ican_wallet_pin', pin);
          localStorage.setItem('ican_wallet_remember_pin', 'true');
        } catch (err) {
          console.warn('Could not save PIN:', err);
        }
      }

      // Special handling for confirmCashIn - bypass universal service
      if (transactionType === 'confirmCashIn') {
        // Call parent's onApprove directly without universal service processing
        await onApprove(pin, 'pin', { success: true, message: 'Ready to confirm' });
        setPin('');
        return;
      }

      // Call universal transaction service for other types
      const result = await universalTransactionService.processTransaction({
        transactionType,
        userId,
        agentId: null,
        pin,
        currency,
        amount,
        metadata
      });

      if (result.success) {
        // Call parent's onApprove with result
        await onApprove(pin, 'pin', result);
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
    onCancel();
  };

  const busy = isSubmitting || isLoading;

  // Portaled to <body>: rendered in place it inherits the wallet page's stacking
  // context, so the fixed bottom tab bar (z-50 in MobileView) paints over the sheet.
  return createPortal(
    <div className="unified-approval-overlay" onClick={() => { if (!isSubmitting) handleCancel(); }}>
      <div className="uam-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="uam-header">
          <button
            type="button"
            className="uam-close"
            onClick={handleCancel}
            disabled={isSubmitting}
            aria-label="Close"
          >
            <X size={20} />
          </button>
          <h2 className="uam-title">Confirm Transaction</h2>
        </div>

        <form
          className="uam-body"
          onSubmit={(e) => {
            e.preventDefault();
            if (pin.length === 4 && !busy) handleApprove();
          }}
        >
          <div className="uam-summary">
            <div className="uam-row">
              <span className="uam-label">Type</span>
              <span className="uam-value">
                {transactionIcons[transactionType] || '💰'} {transactionLabels[transactionType] || 'Transaction'}
              </span>
            </div>
            <div className="uam-row">
              <span className="uam-label">Amount</span>
              <span className="uam-amount">{amount} {currency}</span>
            </div>
            {recipient && (
              <div className="uam-row">
                <span className="uam-label">To</span>
                <span className="uam-value">{recipient}</span>
              </div>
            )}
            {description && (
              <div className="uam-row">
                <span className="uam-label">Note</span>
                <span className="uam-value">{description}</span>
              </div>
            )}
          </div>

          <div className="uam-pin-block">
            <p className="uam-pin-title">Enter your 4-digit PIN</p>
            <div className="uam-pin-wrap">
              <div className="uam-pin-boxes" aria-hidden="true">
                {[0, 1, 2, 3].map((index) => (
                  <div
                    key={index}
                    className={`uam-pin-box${index < pin.length ? ' filled' : ''}${index === pin.length ? ' active' : ''}`}
                  >
                    {pin[index] ? (showPin ? pin[index] : '•') : ''}
                  </div>
                ))}
              </div>
              {/* The real field: invisible, sits over the boxes so a tap opens the phone's numeric keyboard */}
              <input
                ref={pinInputRef}
                className="uam-pin-input"
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="one-time-code"
                maxLength={4}
                value={pin}
                onChange={handlePinChange}
                disabled={isSubmitting}
                aria-label="Transaction PIN"
              />
            </div>
            <button
              type="button"
              className="uam-toggle"
              onClick={() => setShowPin(!showPin)}
            >
              {showPin ? <EyeOff size={16} /> : <Eye size={16} />}
              {showPin ? 'Hide PIN' : 'Show PIN'}
            </button>
          </div>

          {(localError || error) && (
            <div className="uam-error">
              <AlertCircle size={16} />
              <div>
                <p>{localError || error}</p>
                {attemptsRemaining && (
                  <p className="uam-attempts">Attempts remaining: {attemptsRemaining}</p>
                )}
              </div>
            </div>
          )}

          {isAccountLocked && (
            <button
              type="button"
              onClick={() => setShowPINRecovery(true)}
              className="uam-reset"
            >
              <Lock size={16} />
              Reset PIN - Unlock Account
            </button>
          )}

          <div className="uam-secure">
            <Lock size={13} />
            <span>Your transaction is protected with end-to-end encryption</span>
          </div>

          <div className="uam-actions">
            <button
              type="button"
              className="uam-btn uam-btn-cancel"
              onClick={handleCancel}
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="uam-btn uam-btn-approve"
              disabled={pin.length !== 4 || busy}
            >
              {busy ? (
                <>
                  <span className="uam-spinner" />
                  Verifying...
                </>
              ) : (
                'Approve'
              )}
            </button>
          </div>
        </form>

        {isOpen && (
          <PINRecoveryModal
            isOpen={showPINRecovery}
            onClose={() => setShowPINRecovery(false)}
            userId={userId}
            userEmail={userEmail}
          />
        )}
      </div>
    </div>,
    document.body
  );
};

export default UnifiedApprovalModal;
