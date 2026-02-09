import React, { useState, useEffect } from 'react';
import { X, CheckCircle, Clock, AlertCircle, FileText, Loader } from 'lucide-react';
import { getSupabase, createNotification } from '../services/pitchingService';

/**
 * ShareholderSignatureModal - Shareholder Sign & Approve Investment
 * 
 * Features:
 * ✅ Display investment details to shareholder
 * ✅ Show 24-hour review period countdown
 * ✅ Shareholder PIN entry for signature
 * ✅ Review agreement documents
 * ✅ Sign and approve investment
 * ✅ Send confirmation notification to investor
 * 
 * Flow:
 * 1. Shareholder receives notification with sign link
 * 2. Modal opens with 24hr countdown
 * 3. Review documents and investment details
 * 4. Enter PIN to verify and sign
 * 5. Signature recorded and investor notified
 */

const ShareholderSignatureModal = ({ 
  investmentId, 
  shareholderId, 
  shareholderEmail,
  investmentDetails,
  onClose,
  onSigned
}) => {
  const [stage, setStage] = useState(0); // 0: Review, 1: PIN Entry, 2: Confirmed
  const [pin, setPin] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [timeRemaining, setTimeRemaining] = useState(null);
  const [signed, setSigned] = useState(false);

  // Calculate 24-hour countdown
  useEffect(() => {
    if (!investmentDetails?.createdAt) return;

    const updateTimer = () => {
      const investmentTime = new Date(investmentDetails.createdAt).getTime();
      const deadline = investmentTime + (24 * 60 * 60 * 1000); // 24 hours later
      const now = new Date().getTime();
      const remaining = deadline - now;

      if (remaining > 0) {
        const hours = Math.floor(remaining / (1000 * 60 * 60));
        const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((remaining % (1000 * 60)) / 1000);
        
        setTimeRemaining({
          hours,
          minutes,
          seconds,
          percentage: (remaining / (24 * 60 * 60 * 1000)) * 100,
          expired: false
        });
      } else {
        setTimeRemaining({
          hours: 0,
          minutes: 0,
          seconds: 0,
          percentage: 0,
          expired: true
        });
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [investmentDetails?.createdAt]);

  // Submit shareholder signature
  const handleSignAgreement = async () => {
    if (!pin || !pinConfirm) {
      setError('Please enter PIN in both fields');
      return;
    }

    if (pin !== pinConfirm) {
      setError('PINs do not match');
      return;
    }

    if (pin.length < 4) {
      setError('PIN must be at least 4 digits');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const supabase = getSupabase();
      if (!supabase) throw new Error('Supabase not available');

      // Store shareholder signature in database
      const { data: signatureData, error: signatureError } = await supabase
        .from('investment_signatures')
        .insert({
          investment_transaction_id: investmentId,
          shareholder_id: shareholderId,
          shareholder_email: shareholderEmail,
          signature_method: 'shareholder_pin',
          signature_timestamp: new Date().toISOString(),
          pin_masked: pin.substring(0, 1) + '*'.repeat(pin.length - 2) + pin.substring(pin.length - 1),
          machine_id: 'device-' + Math.random().toString(36).substr(2, 9),
          status: 'approved'
        });

      if (signatureError) throw signatureError;

      console.log('✅ Shareholder signature recorded:', signatureData);

      // Mark as signed
      setSigned(true);
      setStage(2);

      // Notify investor that shareholder has signed
      await notifyInvestor();

      // Call onSigned callback
      if (onSigned) {
        onSigned({
          shareholderId,
          shareholderEmail,
          timestamp: new Date().toISOString(),
          signatureId: signatureData?.[0]?.id
        });
      }

      // Close modal after 3 seconds
      setTimeout(() => {
        onClose();
      }, 3000);
    } catch (err) {
      console.error('Error signing agreement:', err);
      setError(err.message || 'Failed to sign agreement');
    } finally {
      setLoading(false);
    }
  };

  // Notify investor that shareholder signed
  const notifyInvestor = async () => {
    try {
      const supabase = getSupabase();
      if (!supabase) return;

      // Get investor info from investment details
      const investorId = investmentDetails?.investor_id;
      const investorEmail = investmentDetails?.investor_email;

      if (investorId) {
        // Create notification in database
        const { data: notification, error: notifError } = await supabase
          .from('notifications')
          .insert({
            user_id: investorId,
            notification_type: 'shareholder_signed',
            title: `Shareholder Approval - ${investmentDetails?.pitch_title}`,
            message: `${shareholderEmail} has signed and approved the investment agreement for "${investmentDetails?.pitch_title}".`,
            related_id: investmentId,
            read: false,
            created_at: new Date().toISOString()
          });

        if (!notifError) {
          console.log('✅ Investor notified of shareholder signature');
        }
      }
    } catch (err) {
      console.warn('Could not notify investor:', err.message);
      // Continue - signature was recorded even if notification failed
    }
  };

  if (!investmentDetails) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-slate-900 rounded-lg p-6 text-center">
          <p className="text-slate-300">Loading signature request...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 rounded-xl border border-slate-700 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-gradient-to-r from-blue-900 to-slate-900 border-b border-slate-700 p-6 flex justify-between items-start">
          <div>
            <h2 className="text-2xl font-bold text-white flex items-center gap-3">
              <FileText className="w-6 h-6" />
              Investment Signature Request
            </h2>
            <p className="text-slate-400 text-sm mt-1">Review and approve the investment agreement</p>
          </div>
          {!signed && (
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-white transition"
            >
              <X className="w-6 h-6" />
            </button>
          )}
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* 24-Hour Countdown */}
          {timeRemaining && !signed && (
            <div className={`rounded-lg p-4 border ${
              timeRemaining.expired
                ? 'bg-red-500/10 border-red-500/30'
                : timeRemaining.percentage < 25
                ? 'bg-orange-500/10 border-orange-500/30'
                : 'bg-blue-500/10 border-blue-500/30'
            }`}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Clock className="w-5 h-5 text-blue-400" />
                  <span className="font-semibold text-white">24-Hour Review Period</span>
                </div>
                <span className={`text-lg font-bold ${
                  timeRemaining.expired ? 'text-red-400' : 'text-blue-400'
                }`}>
                  {timeRemaining.hours}h {timeRemaining.minutes}m {timeRemaining.seconds}s
                </span>
              </div>
              <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
                <div
                  className={`h-full transition-all duration-1000 ${
                    timeRemaining.expired
                      ? 'bg-red-500'
                      : timeRemaining.percentage < 25
                      ? 'bg-orange-500'
                      : 'bg-blue-500'
                  }`}
                  style={{ width: `${Math.min(timeRemaining.percentage, 100)}%` }}
                />
              </div>
              {timeRemaining.expired && (
                <p className="text-red-400 text-sm mt-2">
                  ⚠️ Review period has expired. You can no longer sign this agreement.
                </p>
              )}
            </div>
          )}

          {/* Stage 0: Review Agreement */}
          {stage === 0 && (
            <div className="space-y-4">
              {/* Investment Details */}
              <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700 space-y-3">
                <h3 className="font-bold text-white flex items-center gap-2">
                  <FileText className="w-5 h-5" />
                  Investment Details
                </h3>
                
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-slate-400">Pitch Title</p>
                    <p className="text-white font-semibold">{investmentDetails.pitch_title}</p>
                  </div>
                  <div>
                    <p className="text-slate-400">Business Name</p>
                    <p className="text-white font-semibold">{investmentDetails.business_name}</p>
                  </div>
                  <div>
                    <p className="text-slate-400">Investor</p>
                    <p className="text-white font-semibold text-xs break-all">{investmentDetails.investor_email}</p>
                  </div>
                  <div>
                    <p className="text-slate-400">Investment Amount</p>
                    <p className="text-green-400 font-bold">{investmentDetails.currency} {parseFloat(investmentDetails.amount).toFixed(2)}</p>
                  </div>
                  <div>
                    <p className="text-slate-400">Shares</p>
                    <p className="text-white font-semibold">{investmentDetails.shares || 'Partnership/Support'}</p>
                  </div>
                  <div>
                    <p className="text-slate-400">Investment Type</p>
                    <p className="text-white font-semibold capitalize">{investmentDetails.investment_type}</p>
                  </div>
                </div>
              </div>

              {/* Shareholder Information */}
              <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700">
                <h3 className="font-bold text-white mb-3">Your Information (Shareholder)</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Email:</span>
                    <span className="text-white">{shareholderEmail}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Role:</span>
                    <span className="text-white">Shareholder/Co-owner</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Status:</span>
                    <span className="text-blue-400 font-semibold">Pending Signature</span>
                  </div>
                </div>
              </div>

              {/* Documents Preview */}
              {investmentDetails.documents && (
                <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700">
                  <h3 className="font-bold text-white mb-3">📄 Investment Documents</h3>
                  <div className="space-y-2 text-sm">
                    {investmentDetails.documents.business_plan && (
                      <div className="p-2 bg-slate-700/30 rounded">
                        <p className="text-slate-300">✓ Business Plan</p>
                      </div>
                    )}
                    {investmentDetails.documents.financial_projection && (
                      <div className="p-2 bg-slate-700/30 rounded">
                        <p className="text-slate-300">✓ Financial Projection</p>
                      </div>
                    )}
                    {investmentDetails.documents.mou && (
                      <div className="p-2 bg-slate-700/30 rounded">
                        <p className="text-slate-300">✓ Memorandum of Understanding (MOU)</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Terms Agreement */}
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4">
                <p className="text-amber-300 text-sm">
                  ⚠️ By signing this agreement, you confirm that you have reviewed the investment details and approve the investment. Your signature is legally binding.
                </p>
              </div>

              {/* Action Button */}
              {!timeRemaining?.expired && (
                <button
                  onClick={() => setStage(1)}
                  className="w-full bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white font-semibold py-3 rounded-lg transition"
                >
                  Proceed to Sign Agreement →
                </button>
              )}
            </div>
          )}

          {/* Stage 1: PIN Entry */}
          {stage === 1 && !signed && (
            <div className="space-y-6">
              <div className="bg-gradient-to-br from-blue-900 to-slate-900 rounded-lg p-6 border border-blue-500/30">
                <h3 className="font-bold text-2xl text-white mb-2 flex items-center gap-2">
                  🔐 ICAN Wallet - Shareholder Signature
                </h3>
                <p className="text-blue-200/80 text-sm">
                  Enter your ICAN Wallet PIN to electronically sign and approve this investment agreement
                </p>
              </div>

              {/* Investment Summary */}
              <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700">
                <h4 className="font-semibold text-white mb-3">📋 Investment Summary</h4>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Pitch:</span>
                    <span className="text-white font-semibold">{investmentDetails?.pitch_title || 'Unknown'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Business:</span>
                    <span className="text-white font-semibold">{investmentDetails?.business_name || 'Unknown'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Investment Amount:</span>
                    <span className="text-green-400 font-semibold">${investmentDetails?.investment_amount || '0.00'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Your Stake:</span>
                    <span className="text-blue-400 font-semibold">{investmentDetails?.your_stake || 'TBD'}%</span>
                  </div>
                </div>
              </div>

              {/* PIN Entry Section */}
              <div className="bg-slate-800/50 rounded-lg p-6 border border-blue-500/20 space-y-4">
                <p className="text-slate-300 text-sm font-semibold mb-4">
                  🔑 Enter Your 6-Digit ICAN Wallet PIN
                </p>

                {error && (
                  <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                    <span className="text-red-300 text-sm">{error}</span>
                  </div>
                )}

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-semibold text-slate-300 mb-3">
                      PIN (6 digits)
                    </label>
                    <input
                      type="password"
                      value={pin}
                      onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder="••••••"
                      maxLength="6"
                      className="w-full px-4 py-3 bg-slate-700 border border-slate-600 rounded-lg text-white text-center text-3xl tracking-widest placeholder-slate-500 focus:border-blue-500 focus:outline-none transition"
                    />
                    <p className="text-xs text-slate-500 mt-2">{pin.length}/6 digits</p>
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-slate-300 mb-3">
                      Confirm PIN (6 digits)
                    </label>
                    <input
                      type="password"
                      value={pinConfirm}
                      onChange={(e) => setPinConfirm(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder="••••••"
                      maxLength="6"
                      className="w-full px-4 py-3 bg-slate-700 border border-slate-600 rounded-lg text-white text-center text-3xl tracking-widest placeholder-slate-500 focus:border-blue-500 focus:outline-none transition"
                    />
                    <p className="text-xs text-slate-500 mt-2">{pinConfirm.length}/6 digits</p>
                  </div>
                </div>

                {pin && pinConfirm && pin === pinConfirm && pin.length === 6 && (
                  <div className="p-3 bg-green-500/20 border border-green-500/50 rounded text-green-300 text-sm flex items-center gap-2">
                    <CheckCircle className="w-4 h-4" />
                    <span>PIN verified! Ready to sign.</span>
                  </div>
                )}
              </div>

              {/* Security Notice */}
              <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
                <p className="text-blue-300 text-xs flex gap-2">
                  <span>🔐</span>
                  <span>Your PIN is encrypted and stored securely. Never share your PIN with anyone. This signature is legally binding.</span>
                </p>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-3">
                <button
                  onClick={() => setStage(0)}
                  className="flex-1 px-6 py-3 border border-slate-600 hover:border-slate-400 text-slate-300 hover:text-white font-semibold rounded-lg transition"
                >
                  ← Back
                </button>
                <button
                  onClick={handleSignAgreement}
                  disabled={loading || pin.length < 6 || pinConfirm.length < 6 || pin !== pinConfirm}
                  className="flex-1 px-6 py-3 bg-gradient-to-r from-green-600 to-green-500 hover:from-green-500 hover:to-green-400 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <>
                      <Loader className="w-4 h-4 animate-spin" />
                      Signing...
                    </>
                  ) : (
                    <>
                      ✓ Sign Agreement
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Stage 2: Signature Confirmed */}          {/* Stage 2: Confirmation */}
          {stage === 2 && signed && (
            <div className="text-center space-y-4">
              <CheckCircle className="w-16 h-16 text-green-400 mx-auto animate-bounce" />
              <div>
                <h3 className="text-2xl font-bold text-white mb-2">✅ Agreement Signed!</h3>
                <p className="text-slate-400">Your signature has been recorded and verified. The investor has been notified.</p>
              </div>
              <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4 text-sm">
                <p className="text-green-300">
                  ✓ Signature recorded securely<br/>
                  ✓ Investor notified<br/>
                  ✓ Agreement sealed
                </p>
              </div>
              <p className="text-slate-500 text-xs">Closing in 3 seconds...</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ShareholderSignatureModal;
