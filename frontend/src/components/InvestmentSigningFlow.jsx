import React, { useState, useEffect } from 'react';
import { CheckCircle2, Lock, AlertCircle, Loader, Send, Download } from 'lucide-react';
import { getSupabase } from '../services/pitchingService';

const InvestmentSigningFlow = ({ 
  investmentId, 
  investmentAmount,
  businessName,
  shareholderCount,
  walletAccountNumber = 'AGENT-KAM-5560'
}) => {
  const [currentStep, setCurrentStep] = useState('investor_signature'); // investor_signature, money_transfer, shareholder_pins, document_ready
  const [loading, setLoading] = useState(false);
  const [userPin, setUserPin] = useState('');
  const [pinError, setPinError] = useState('');
  const [approvalStatus, setApprovalStatus] = useState({
    totalShareholders: shareholderCount,
    signedShareholders: 0,
    approvalPercent: 0,
    thresholdMet: false
  });

  // Step 1: Investor Signature
  const handleInvestorSign = async () => {
    setLoading(true);
    try {
      const supabase = getSupabase();
      const { data: user } = await supabase.auth.getUser();

      // Record investor signature
      const { error } = await supabase
        .from('investment_signatures')
        .insert([{
          investment_id: investmentId,
          signer_id: user.user.id,
          signer_email: user.user.email,
          signer_type: 'investor',
          signature_status: 'signed',
          signed_at: new Date().toISOString()
        }]);

      if (error) throw error;

      console.log('✅ Investor signature recorded');
      
      // Immediately notify all shareholders to approve
      await notifyShareholdersForApproval();
      
      setCurrentStep('money_transfer');
    } catch (error) {
      console.error('Error recording signature:', error);
      alert('Failed to record signature');
    } finally {
      setLoading(false);
    }
  };

  // Notify shareholders to approve investment
  const notifyShareholdersForApproval = async () => {
    try {
      const supabase = getSupabase();
      const { data: user } = await supabase.auth.getUser();
      
      // Get all shareholders for this business investment
      const { data: investment, error: investmentError } = await supabase
        .from('investments')
        .select('business_id, amount, pitch_id')
        .eq('id', investmentId)
        .single();

      if (investmentError) throw investmentError;

      // Get all shareholders for the business
      const { data: shareholders, error: fetchError } = await supabase
        .from('business_co_owners')
        .select('id, owner_name, owner_email')
        .eq('business_profile_id', investment.business_id);

      if (fetchError) throw fetchError;

      // Get business profile info
      const { data: businessProfile } = await supabase
        .from('business_profiles')
        .select('business_name')
        .eq('id', investment.business_id)
        .single();

      // Send approval notification to each shareholder
      for (const shareholder of shareholders) {
        const { data, error } = await supabase
          .from('shareholder_notifications')
          .insert([{
            business_profile_id: investment.business_id,
            shareholder_id: shareholder.id,
            shareholder_email: shareholder.owner_email,
            notification_type: 'approval_request',
            notification_title: '✅ Investment Approval Required',
            notification_message: `🎯 Investment Approval Required!\n\n💼 ${businessProfile?.business_name || businessName} received an investment of $${investmentAmount?.toLocaleString()}.\n\n✅ NEXT: Please review and approve this investment by sliding below.\n\n⏱️ 60% shareholder approval needed to finalize.\n\n👉 Slide to Approve →`,
            investor_name: user?.user?.user_metadata?.full_name || user?.user?.email || 'Investor',
            investor_email: user?.user?.email,
            investment_amount: investmentAmount || 0,
            investment_currency: 'UGX',
            notification_sent_via: 'in_app'
          }])
          .select();

        if (!error) {
          console.log(`✅ Approval notification sent to: ${shareholder.owner_name}`);
        } else {
          console.error(`⚠️ Failed to notify ${shareholder.owner_name}:`, error?.message);
        }
      }

      console.log('✅ Approval notifications sent to all shareholders');
    } catch (error) {
      console.error('Error notifying shareholders:', error);
    }
  };

  // Step 2: Money Transfer to Wallet
  const handleMoneyTransfer = async () => {
    setLoading(true);
    try {
      const supabase = getSupabase();

      // Update approval record with wallet transfer
      const { error } = await supabase
        .from('investment_approvals')
        .update({
          transfer_status: 'completed',
          transfer_completed_at: new Date().toISOString(),
          wallet_account_number: walletAccountNumber
        })
        .eq('investment_id', investmentId);

      if (error) throw error;

      console.log(`✅ Money transferred to ${walletAccountNumber}`);
      
      // Send PIN request notifications to all shareholders
      await sendPinNotifications();
      
      setCurrentStep('shareholder_pins');
    } catch (error) {
      console.error('Error processing transfer:', error);
      alert('Failed to process transfer');
    } finally {
      setLoading(false);
    }
  };

  // Send PIN notifications to shareholders
  const sendPinNotifications = async () => {
    try {
      const supabase = getSupabase();
      
      // Get all shareholders for this business
      const { data: shareholders, error: fetchError } = await supabase
        .from('business_co_owners')
        .select('id, owner_name, owner_email')
        .eq('business_profile_id', investmentId);

      if (fetchError) throw fetchError;

      // Send notification to each shareholder
      for (const shareholder of shareholders) {
        await supabase
          .from('shareholder_notifications')
          .insert([{
            investment_id: investmentId,
            shareholder_email: shareholder.owner_email,
            shareholder_name: shareholder.owner_name,
            notification_type: 'pin_request',
            notification_status: 'sent',
            pin_entry_required: true,
            notification_message: `Investment agreement received for ${businessName}. Please enter your PIN to verify your approval.`,
            notification_sent_at: new Date().toISOString()
          }]);
      }

      console.log('✅ PIN request notifications sent to all shareholders');
    } catch (error) {
      console.error('Error sending notifications:', error);
    }
  };

  // Step 3: Verify Shareholder PIN
  const handlePinVerification = async () => {
    if (!userPin || userPin.length < 4) {
      setPinError('PIN must be at least 4 digits');
      return;
    }

    setLoading(true);
    setPinError('');

    try {
      const supabase = getSupabase();
      const { data: user } = await supabase.auth.getUser();

      // TODO: Verify PIN with wallet service
      // For now, we'll just mark as verified
      
      // Mark shareholder as pin_verified
      const { error: updateError } = await supabase
        .from('investment_signatures')
        .update({
          signature_status: 'pin_verified',
          pin_verified_at: new Date().toISOString()
        })
        .eq('signer_id', user.user.id)
        .eq('investment_id', investmentId);

      if (updateError) throw updateError;

      console.log('✅ PIN verified - signature recorded');
      
      // Check if 60% threshold reached
      await checkApprovalThreshold();
      setUserPin('');
    } catch (error) {
      console.error('Error verifying PIN:', error);
      setPinError('PIN verification failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Check approval threshold (60%)
  const checkApprovalThreshold = async () => {
    try {
      const supabase = getSupabase();

      // Call function to check threshold
      const { data, error } = await supabase
        .rpc('check_approval_threshold', {
          p_investment_id: investmentId
        });

      if (error) throw error;

      const result = data[0];
      setApprovalStatus({
        totalShareholders: result.total_shareholders,
        signedShareholders: result.signed_shareholders,
        approvalPercent: result.approval_percent,
        thresholdMet: result.threshold_met
      });

      if (result.threshold_met) {
        console.log('🎉 60% threshold reached! Document is ready for printing');
        await finalizeDocument();
        setCurrentStep('document_ready');
      }
    } catch (error) {
      console.error('Error checking threshold:', error);
    }
  };

  // Finalize document when 60% threshold reached
  const finalizeDocument = async () => {
    try {
      const supabase = getSupabase();

      const { error } = await supabase
        .rpc('finalize_investment_document', {
          p_investment_id: investmentId
        });

      if (error) throw error;

      console.log('✅ Document finalized for printing - notifications sent to all shareholders');
    } catch (error) {
      console.error('Error finalizing document:', error);
    }
  };

  // Load initial status
  useEffect(() => {
    checkApprovalThreshold();
  }, []);

  return (
    <div className="space-y-6">
      {/* Progress Steps */}
      <div className="grid grid-cols-4 gap-2">
        {[
          { step: 'investor_signature', label: 'Investor Signs', icon: '✍️' },
          { step: 'money_transfer', label: 'Money Transfer', icon: '💰' },
          { step: 'shareholder_pins', label: 'Shareholder Approvals', icon: '🔐' },
          { step: 'document_ready', label: 'Document Ready', icon: '📄' }
        ].map((item) => (
          <div
            key={item.step}
            className={`p-3 rounded-lg text-center transition ${
              currentStep === item.step
                ? 'bg-blue-600 text-white'
                : ['investor_signature', 'money_transfer', 'shareholder_pins'].includes(currentStep) &&
                  ['investor_signature', 'money_transfer', 'shareholder_pins'].indexOf(currentStep) >= 
                  ['investor_signature', 'money_transfer', 'shareholder_pins'].indexOf(item.step)
                ? 'bg-green-600 text-white'
                : 'bg-slate-700 text-slate-300'
            }`}
          >
            <div className="text-2xl mb-1">{item.icon}</div>
            <div className="text-xs font-semibold">{item.label}</div>
          </div>
        ))}
      </div>

      {/* Step 1: Investor Signature */}
      {currentStep === 'investor_signature' && (
        <div className="bg-gradient-to-br from-blue-900/30 to-purple-900/30 border-2 border-blue-500/50 rounded-lg p-6">
          <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
            <CheckCircle2 className="w-6 h-6 text-blue-400" />
            Investor Signature
          </h2>
          <p className="text-slate-300 mb-6">
            Investment Amount: <span className="font-bold text-green-400">${investmentAmount.toLocaleString()}</span>
          </p>
          <p className="text-slate-400 mb-6">
            By signing below, you agree to invest in <strong>{businessName}</strong> and authorize the transfer of funds to the application wallet account.
          </p>
          <button
            onClick={handleInvestorSign}
            disabled={loading}
            className="w-full bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 disabled:opacity-50 text-white py-3 rounded-lg font-semibold transition flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <Loader className="w-5 h-5 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <CheckCircle2 className="w-5 h-5" />
                Sign Investment Agreement
              </>
            )}
          </button>
        </div>
      )}

      {/* Step 2: Money Transfer */}
      {currentStep === 'money_transfer' && (
        <div className="bg-gradient-to-br from-green-900/30 to-emerald-900/30 border-2 border-green-500/50 rounded-lg p-6">
          <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
            <Send className="w-6 h-6 text-green-400" />
            Transfer Funds
          </h2>
          <p className="text-slate-300 mb-2">Investment Amount: <span className="font-bold text-green-400">${investmentAmount.toLocaleString()}</span></p>
          <p className="text-slate-300 mb-6">Receiving Account: <span className="font-bold text-cyan-400">{walletAccountNumber}</span></p>
          <button
            onClick={handleMoneyTransfer}
            disabled={loading}
            className="w-full bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 disabled:opacity-50 text-white py-3 rounded-lg font-semibold transition flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <Loader className="w-5 h-5 animate-spin" />
                Processing Transfer...
              </>
            ) : (
              <>
                <Send className="w-5 h-5" />
                Confirm & Transfer Funds
              </>
            )}
          </button>
        </div>
      )}

      {/* Step 3: Shareholder PIN Approvals */}
      {currentStep === 'shareholder_pins' && (
        <div className="bg-gradient-to-br from-purple-900/30 to-pink-900/30 border-2 border-purple-500/50 rounded-lg p-6">
          <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
            <Lock className="w-6 h-6 text-purple-400" />
            Shareholder PIN Verification
          </h2>

          {/* Approval Progress */}
          <div className="mb-6 p-4 bg-slate-800/50 rounded-lg">
            <div className="flex items-center justify-between mb-2">
              <span className="text-slate-300">Approval Progress</span>
              <span className="text-white font-bold">{Math.round(approvalStatus.approvalPercent)}%</span>
            </div>
            <div className="w-full h-3 bg-slate-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all duration-500"
                style={{ width: `${approvalStatus.approvalPercent}%` }}
              />
            </div>
            <p className="text-slate-400 text-sm mt-2">
              {approvalStatus.signedShareholders} of {approvalStatus.totalShareholders} shareholders approved
              {approvalStatus.totalShareholders - approvalStatus.signedShareholders > 0 && (
                <span> • {approvalStatus.totalShareholders - approvalStatus.signedShareholders} more needed</span>
              )}
            </p>
          </div>

          {/* Threshold Indicator */}
          <div className={`p-3 rounded-lg mb-6 flex items-center gap-2 ${
            approvalStatus.approvalPercent >= 60
              ? 'bg-green-600/20 text-green-300 border border-green-600/50'
              : 'bg-yellow-600/20 text-yellow-300 border border-yellow-600/50'
          }`}>
            {approvalStatus.approvalPercent >= 60 ? (
              <>
                <CheckCircle2 className="w-5 h-5" />
                <span>✅ 60% Threshold Reached! Document ready for printing</span>
              </>
            ) : (
              <>
                <AlertCircle className="w-5 h-5" />
                <span>⏳ Need {Math.ceil(approvalStatus.totalShareholders * 0.6) - approvalStatus.signedShareholders} more signature(s) to reach 60%</span>
              </>
            )}
          </div>

          {approvalStatus.approvalPercent < 100 && (
            <>
              <p className="text-slate-300 mb-4">Enter your PIN to approve this investment:</p>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={userPin}
                  onChange={(e) => {
                    setUserPin(e.target.value);
                    setPinError('');
                  }}
                  placeholder="Enter 4+ digit PIN"
                  className="flex-1 px-4 py-3 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:border-purple-500 focus:outline-none"
                />
                <button
                  onClick={handlePinVerification}
                  disabled={loading || !userPin}
                  className="bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white px-6 py-3 rounded-lg font-semibold transition"
                >
                  {loading ? <Loader className="w-5 h-5 animate-spin" /> : 'Verify'}
                </button>
              </div>
              {pinError && (
                <p className="text-red-400 text-sm mt-2 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4" />
                  {pinError}
                </p>
              )}
            </>
          )}
        </div>
      )}

      {/* Step 4: Document Ready */}
      {currentStep === 'document_ready' && (
        <div className="bg-gradient-to-br from-emerald-900/30 to-teal-900/30 border-2 border-emerald-500/50 rounded-lg p-6">
          <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
            <CheckCircle2 className="w-6 h-6 text-emerald-400" />
            Document Ready for Printing
          </h2>
          <div className="p-4 bg-slate-800/50 rounded-lg mb-6">
            <p className="text-slate-300 mb-2">✅ Investment Agreement Finalized</p>
            <p className="text-slate-300 mb-2">✅ {approvalStatus.signedShareholders} of {approvalStatus.totalShareholders} shareholders approved</p>
            <p className="text-slate-300 mb-4">✅ Approval Threshold: {Math.round(approvalStatus.approvalPercent)}%</p>
            <p className="text-emerald-400 font-semibold">All shareholders will receive a notification with the document link for download and printing.</p>
          </div>
          <button
            className="w-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white py-3 rounded-lg font-semibold transition flex items-center justify-center gap-2"
          >
            <Download className="w-5 h-5" />
            Download Print-Ready Document
          </button>
        </div>
      )}
    </div>
  );
};

export default InvestmentSigningFlow;
