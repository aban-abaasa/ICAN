/**
 * Receive Money Modal Component
 * Displays QR code, payment link, and handles payment requests
 */

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Copy, Download, Loader } from 'lucide-react';
import { QRCodeCanvas as QRCode } from 'qrcode.react';
import paymentRequestService from '../services/paymentRequestService';
import { getSupabaseClient } from '../lib/supabase/client';
import { getAllAccessibleBusinessProfiles } from '../services/pitchingService';

const ReceiveMoneyModal = ({ 
  isOpen, 
  onClose, 
  userId,
  selectedCurrency = 'USD',
  onSuccess = null 
}) => {
  const initialFormData = {
    amount: '',
    description: ''
  };

  const [step, setStep] = useState('form'); // 'form', 'qrcode', 'active' - REMOVED 'choice', 'pay', 'scanner'
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);
  
  // Form state
  const [formData, setFormData] = useState(initialFormData);
  const [paymentMethod, setPaymentMethod] = useState('ican');
  const [recipientClassification, setRecipientClassification] = useState('personal');
  const [businessProfiles, setBusinessProfiles] = useState([]);
  const [recipientBusinessProfileId, setRecipientBusinessProfileId] = useState('');
  const [loadingBusinesses, setLoadingBusinesses] = useState(false);
  // Kept null so a stale receipt view can never be shown; cash receipts are
  // issued only to the payer after they scan and confirm this QR.
  const [cashReceipt] = useState(null);

  // QR Code state
  const [qrData, setQrData] = useState(null);
  const [paymentLink, setPaymentLink] = useState('');
  const [activeRequests, setActiveRequests] = useState([]);

  const resetModalState = () => {
    setStep('form');
    setLoading(false);
    setError(null);
    setSuccessMessage(null);
    setFormData(initialFormData);
    setPaymentMethod('ican');
    setRecipientClassification('personal');
    setRecipientBusinessProfileId('');
    setQrData(null);
    setPaymentLink('');
    setActiveRequests([]);
  };

  const handleCloseModal = () => {
    resetModalState();
    onClose();
  };

  useEffect(() => {
    if (!isOpen) return undefined;

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        handleCloseModal();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      resetModalState();
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && step === 'active') {
      loadActiveRequests();
    }
  }, [isOpen, step]);

  useEffect(() => {
    if (!isOpen || recipientClassification !== 'business' || !userId) return undefined;
    let cancelled = false;
    const loadBusinesses = async () => {
      setLoadingBusinesses(true);
      const supabase = getSupabaseClient();
      if (!supabase) { setLoadingBusinesses(false); return; }
      try {
        // Use the same authority-aware source as Pay: it includes owned,
        // delegated and co-owned businesses permitted to this account.
        const { data: { user } } = await supabase.auth.getUser();
        const profiles = await getAllAccessibleBusinessProfiles(userId, user?.email);
        if (!cancelled) {
          setBusinessProfiles(profiles || []);
          setRecipientBusinessProfileId((current) => current || (profiles?.length === 1 ? profiles[0].id : ''));
        }
      } catch (err) {
        console.error('Unable to load receiving businesses:', err);
        if (!cancelled) setBusinessProfiles([]);
      } finally {
        if (!cancelled) setLoadingBusinesses(false);
      }
    };
    loadBusinesses();
    return () => { cancelled = true; };
  }, [isOpen, recipientClassification, userId]);

  const loadActiveRequests = async () => {
    try {
      const result = await paymentRequestService.getActivePaymentRequests(userId);
      if (result.success) {
        setActiveRequests(result.data);
      }
    } catch (err) {
      console.error('Error loading active requests:', err);
    }
  };

  const handleGenerateQR = async (e) => {
    e.preventDefault();
    
    if (!formData.amount || parseFloat(formData.amount) <= 0) {
      setError('Please enter a valid amount');
      return;
    }
    if (recipientClassification === 'business' && !recipientBusinessProfileId) {
      setError('Choose the business that will receive this payment');
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // Create payment request
      const result = await paymentRequestService.createPaymentRequest(
        userId,
        formData.amount,
        selectedCurrency,
        formData.description,
        paymentMethod,
        { classification: recipientClassification, businessProfileId: recipientBusinessProfileId || null }
      );

      if (result.success) {
        setQrData(result.data);
        setPaymentLink(result.paymentLink);
        setSuccessMessage(`${paymentMethod === 'cash' ? 'Cash' : 'Wallet'} payment request created for ${formData.amount} ${selectedCurrency}`);
        setStep('qrcode');
      }
    } catch (err) {
      setError(err.message || 'Failed to generate QR code');
      console.error('Error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(paymentLink);
    setSuccessMessage('Payment link copied to clipboard!');
    setTimeout(() => setSuccessMessage(null), 2000);
  };

  const handleDownloadQR = () => {
    const qrCodeElement = document.getElementById('qr-code-download');
    if (qrCodeElement) {
      const link = document.createElement('a');
      link.href = qrCodeElement.toDataURL('image/png');
      link.download = `payment-qr-${qrData.payment_code}.png`;
      link.click();
    }
  };

  const handleDeleteRequest = async (paymentCode) => {
    try {
      const result = await paymentRequestService.deletePaymentRequest(paymentCode);
      if (result.success) {
        setSuccessMessage('Payment request deleted');
        loadActiveRequests();
      }
    } catch (err) {
      setError('Failed to delete request');
    }
  };

  if (!isOpen) return null;

  const GOLD_C = '#c4a052';
  const T = 'var(--color-text)';
  const T2 = 'var(--color-textSecondary)';
  const labelCls = 'block text-[11px] uppercase tracking-[0.16em] font-semibold mb-2';
  const field = {
    background: 'var(--color-bg)',
    border: '1px solid rgba(196,160,82,0.55)',
    color: T,
    borderRadius: 10
  };
  const pill = (on) => ({
    background: on ? 'rgba(196,160,82,0.16)' : 'transparent',
    border: on ? `1.5px solid ${GOLD_C}` : '1px solid rgba(196,160,82,0.35)',
    color: T,
    boxShadow: on ? '0 0 0 3px rgba(196,160,82,0.14)' : 'none'
  });
  const stepTitle = step === 'qrcode' ? 'Your QR Code' : step === 'active' ? 'Active Requests' : step === 'receipt' ? 'Cash Receipt' : 'Receive Money';

  return createPortal(
    <div
      className="fixed inset-0 z-[10000] bg-black/60 backdrop-blur-sm sm:flex sm:items-center sm:justify-center sm:p-4"
      onClick={handleCloseModal}
    >
      <div
        className="w-full h-full sm:h-auto sm:max-w-md sm:max-h-[calc(100dvh-3rem)] flex flex-col sm:rounded-2xl overflow-hidden shadow-2xl"
        style={{ background: 'var(--color-bg)', border: '1px solid rgba(196,160,82,0.45)', color: T }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header (always visible) */}
        <div
          className="flex items-center gap-3 px-4 py-3.5 shrink-0"
          style={{ background: 'var(--color-bgSecondary)', borderBottom: '1px solid rgba(196,160,82,0.45)' }}
        >
          <button
            type="button"
            onClick={handleCloseModal}
            aria-label="Back"
            className="p-2 -ml-2 rounded-lg shrink-0 hover:bg-black/5 active:bg-black/10"
            style={{ color: T }}
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="min-w-0">
            <h3 className="text-lg leading-tight" style={{ color: T, fontFamily: '"Playfair Display", Georgia, serif', fontWeight: 600 }}>
              {stepTitle}
            </h3>
            <p className="text-[11px] uppercase tracking-[0.16em]" style={{ color: GOLD_C }}>Get paid by QR or link</p>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="p-4 sm:p-5">

        {/* Step 1: Generate Form (for Receive) */}
        {step === 'form' && (
          <form onSubmit={handleGenerateQR} className="space-y-5">
            <div>
              <label className={labelCls} style={{ color: T2 }}>Receiving as</label>
              <div className="grid grid-cols-2 gap-2.5">
                {[{ value: 'personal', label: 'Personal' }, { value: 'business', label: 'Business' }].map(option => (
                  <button key={option.value} type="button" onClick={() => setRecipientClassification(option.value)}
                    aria-pressed={recipientClassification === option.value}
                    className="py-3 rounded-xl text-sm font-semibold transition-all active:scale-[0.98]"
                    style={pill(recipientClassification === option.value)}>
                    {option.label}
                  </button>
                ))}
              </div>
              {recipientClassification === 'business' && (
                loadingBusinesses ? <p className="mt-2 text-xs" style={{ color: T2 }}>Loading your businesses…</p> : businessProfiles.length ? (
                  <select value={recipientBusinessProfileId} onChange={(e) => setRecipientBusinessProfileId(e.target.value)}
                    className="mt-2 w-full px-3.5 py-3 text-base focus:outline-none" style={field}>
                    <option value="">Select receiving business</option>
                    {businessProfiles.map((business) => <option key={business.id} value={business.id}>{business.business_name}</option>)}
                  </select>
                ) : <p className="mt-2 text-xs" style={{ color: '#b45309' }}>No accessible business profile was found.</p>
              )}
              <p className="text-xs mt-1.5" style={{ color: T2 }}>The QR records a verified {recipientClassification} receiving destination.</p>
            </div>

            <div>
              <label className={labelCls} style={{ color: T2 }}>Receive method</label>
              <div className="grid grid-cols-2 gap-2.5">
                {[{ value: 'ican', label: '💠 IcanEra Wallet' }, { value: 'cash', label: '💵 Cash' }].map(option => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setPaymentMethod(option.value)}
                    aria-pressed={paymentMethod === option.value}
                    className="py-3 rounded-xl text-sm font-semibold transition-all active:scale-[0.98]"
                    style={pill(paymentMethod === option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              {paymentMethod === 'cash' && <p className="text-xs mt-2" style={{ color: '#b45309' }}>Show this QR to the payer. They scan it to record the cash payment and download their proof receipt. No IcanEra balance changes.</p>}
            </div>

            <div>
              <label className={labelCls} style={{ color: T2 }}>Amount</label>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-bold pointer-events-none" style={{ color: '#8a6a1f' }}>
                  {selectedCurrency}
                </span>
                <input
                  type="number"
                  inputMode="decimal"
                  placeholder="0.00"
                  step="0.01"
                  min="0"
                  value={formData.amount}
                  onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                  className="w-full pl-16 pr-3 py-3 text-2xl font-semibold text-right placeholder-gray-400 focus:outline-none"
                  style={field}
                />
              </div>
            </div>

            <div>
              <label className={labelCls} style={{ color: T2 }}>
                Note <span className="normal-case tracking-normal font-normal">(optional)</span>
              </label>
              <input
                type="text"
                placeholder="Invoice #123 - Product delivery"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="w-full px-3.5 py-3 text-base placeholder-gray-400 focus:outline-none"
                style={field}
              />
              <p className="text-xs mt-1.5" style={{ color: T2 }}>
                Help the payer understand what this payment is for
              </p>
            </div>

            {error && (
              <div className="p-3 rounded-xl" style={{ background: 'rgba(220,38,38,0.10)', border: '1px solid rgba(220,38,38,0.5)' }}>
                <p className="text-sm font-medium" style={{ color: '#b91c1c' }}>❌ {error}</p>
              </div>
            )}

            {successMessage && (
              <div className="p-3 rounded-xl" style={{ background: 'rgba(47,158,114,0.12)', border: '1px solid rgba(47,158,114,0.55)' }}>
                <p className="text-sm font-medium" style={{ color: '#1f7a5a' }}>✅ {successMessage}</p>
              </div>
            )}

            {/* Action bar sticks to the bottom of the scroll area so it is never cut off */}
            <div
              className="sticky bottom-0 -mx-4 sm:-mx-5 -mb-4 sm:-mb-5 flex gap-3 px-4 sm:px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
              style={{ background: 'var(--color-bgSecondary)', borderTop: '1px solid rgba(196,160,82,0.45)' }}
            >
              <button
                type="button"
                onClick={handleCloseModal}
                className="flex-1 py-3 rounded-xl font-medium"
                style={{ border: '1px solid rgba(196,160,82,0.55)', color: T, background: 'transparent' }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="flex-[1.6] py-3 rounded-xl font-semibold tracking-wide disabled:opacity-50 hover:brightness-110 flex items-center justify-center gap-2"
                style={{ background: 'linear-gradient(135deg, #b8862e, #8a6a1f)', color: '#ffffff', boxShadow: '0 8px 22px rgba(138,106,31,0.30)' }}
              >
                {loading && <Loader className="w-4 h-4 animate-spin" />}
                {loading ? 'Generating…' : 'Generate QR Code'}
              </button>
            </div>
          </form>
        )}

        {step === 'receipt' && cashReceipt && (
          <div className="space-y-4">
            <div className="rounded-xl border border-emerald-400/40 bg-emerald-500/10 p-5 text-center">
              <div className="text-4xl mb-2">✅</div>
              <h4 className="text-xl font-bold text-emerald-300">Digital cash receipt</h4>
              <p className="text-sm text-gray-300 mt-1">No IcanEra balance was changed.</p>
            </div>
            <div className="rounded-lg bg-white/10 p-4 space-y-2 text-sm text-gray-200">
              <div className="flex justify-between"><span>Receipt</span><strong>{cashReceipt.receiptNumber}</strong></div>
              <div className="flex justify-between"><span>Amount</span><strong>{cashReceipt.amount.toLocaleString()} {cashReceipt.currency}</strong></div>
              <div className="flex justify-between"><span>Method</span><strong>Cash</strong></div>
              <div><span className="text-gray-400">Description</span><p>{cashReceipt.description}</p></div>
              <div className="text-xs text-gray-400">{new Date(cashReceipt.receivedAt).toLocaleString()}</div>
            </div>
            <div className="flex gap-3">
              <button onClick={downloadCashReceipt} className="flex-1 px-4 py-2 bg-cyan-500/20 text-cyan-200 rounded-lg font-semibold">Download Receipt</button>
              <button onClick={handleCloseModal} className="flex-1 px-4 py-2 bg-white/10 text-white rounded-lg">Done</button>
            </div>
          </div>
        )}

        {/* Step 3: QR Code Display */}
        {step === 'qrcode' && qrData && (
          <div className="space-y-4">
            {/* QR Code */}
            <div className="flex justify-center p-4 bg-white/10 rounded-lg">
              <QRCode
                id="qr-code-download"
                value={paymentLink}
                size={256}
                level="H"
                includeMargin={true}
              />
            </div>

            {/* Payment Details */}
            <div className="bg-white/10 rounded-lg p-4 space-y-2">
              <div className="rounded-lg border border-cyan-400/30 bg-cyan-500/10 px-3 py-2 text-center">
                <p className="text-xs font-semibold uppercase tracking-wide text-cyan-300">Receiver credential proof</p>
                <p className="mt-1 font-semibold text-slate-900 dark:text-white">{qrData.recipient_name || (recipientClassification === 'business' ? 'Verified business receiver' : 'Verified personal receiver')}</p>
                <p className="text-xs text-gray-400">{qrData.recipient_classification || recipientClassification} receiving account</p>
              </div>
              <div className="text-center">
                <p className="text-sm text-gray-400">Payment Amount</p>
                <p className="text-2xl font-bold text-cyan-400">
                  {qrData.amount} {qrData.currency}
                </p>
              </div>
              {qrData.description && (
                <div className="text-center">
                  <p className="text-sm text-gray-400">For</p>
                  <p className="text-white font-medium">{qrData.description}</p>
                </div>
              )}
              <div className="text-center text-xs text-gray-500 pt-2 border-t border-white/20">
                <p>Code: {qrData.payment_code}</p>
              </div>
            </div>

            {/* Payment Link */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-300">Payment Link</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={paymentLink}
                  readOnly
                  className="flex-1 px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white text-xs truncate"
                />
                <button
                  onClick={handleCopyLink}
                  className="px-3 py-2 bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/50 rounded-lg text-cyan-400 transition-all"
                  title="Copy link"
                >
                  <Copy className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Sharing Options */}
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={handleDownloadQR}
                className="px-3 py-2 bg-white/10 hover:bg-white/20 border border-white/20 rounded-lg text-white text-sm font-medium transition-all flex items-center justify-center gap-1"
              >
                <Download className="w-4 h-4" />
                Download QR
              </button>
              <button
                onClick={() => {
                  // Share via WhatsApp, copy, etc
                  const text = `Pay me ${qrData.amount} ${qrData.currency}${qrData.description ? ` for ${qrData.description}` : ''}. Tap to pay: ${paymentLink}`;
                  if (navigator.share) {
                    navigator.share({ title: 'Payment Request', text });
                  }
                }}
                className="px-3 py-2 bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/50 rounded-lg text-cyan-400 text-sm font-medium transition-all"
              >
                📤 Share
              </button>
            </div>

            <div className="flex gap-3 pt-4">
              <button
                onClick={() => setStep('form')}
                className="flex-1 px-4 py-2 bg-white/10 text-white rounded-lg hover:bg-white/20 transition-all"
              >
                Back
              </button>
              <button
                onClick={() => setStep('active')}
                className="flex-1 px-4 py-2 bg-white/10 text-white rounded-lg hover:bg-white/20 transition-all"
              >
                View Active
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Active Requests */}
        {step === 'active' && (
          <div className="space-y-4">
            <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-lg p-3">
              <p className="text-cyan-400 text-xs font-semibold">📋 ACTIVE REQUESTS</p>
              <p className="text-gray-300 text-sm mt-1">Your pending payment requests</p>
            </div>

            {activeRequests.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-gray-400">No active payment requests</p>
                <button
                  onClick={() => setStep('form')}
                  className="mt-4 px-4 py-2 bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/50 rounded-lg text-cyan-400 text-sm"
                >
                  Create New
                </button>
              </div>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {activeRequests.map((req) => (
                  <div
                    key={req.id}
                    className="p-3 bg-white/10 border border-white/20 rounded-lg"
                  >
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <p className="font-semibold text-white">
                          {req.amount} {req.currency}
                        </p>
                        <p className="text-xs text-cyan-300">{req.recipient_name || 'Verified receiver'} · {req.recipient_classification || 'personal'}</p>
                        {req.description && (
                          <p className="text-xs text-gray-400">{req.description}</p>
                        )}
                      </div>
                      <span className="text-xs bg-cyan-500/20 text-cyan-400 px-2 py-1 rounded">
                        {req.status}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mb-2">
                      Expires: {new Date(req.expires_at).toLocaleString()}
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(req.payment_code);
                          setSuccessMessage('Code copied!');
                          setTimeout(() => setSuccessMessage(null), 2000);
                        }}
                        className="flex-1 px-2 py-1 bg-white/10 hover:bg-white/20 text-white text-xs rounded transition-all"
                      >
                        Copy Code
                      </button>
                      <button
                        onClick={() => handleDeleteRequest(req.payment_code)}
                        className="flex-1 px-2 py-1 bg-red-500/20 hover:bg-red-500/30 text-red-400 text-xs rounded transition-all"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {successMessage && (
              <div className="p-3 bg-green-500/20 border border-green-500/50 rounded-lg">
                <p className="text-sm text-green-400">✅ {successMessage}</p>
              </div>
            )}

            <div className="flex gap-3 pt-4">
              <button
                onClick={() => setStep('form')}
                className="flex-1 px-4 py-2 bg-white/10 text-white rounded-lg hover:bg-white/20 transition-all"
              >
                New Request
              </button>
              <button
                onClick={() => setStep('form')}
                className="flex-1 px-4 py-2 bg-gradient-to-r from-cyan-500 to-cyan-600 text-white rounded-lg hover:shadow-lg hover:shadow-cyan-500/30 transition-all font-semibold"
              >
                Back
              </button>
            </div>
          </div>
        )}
        </div>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default ReceiveMoneyModal;
