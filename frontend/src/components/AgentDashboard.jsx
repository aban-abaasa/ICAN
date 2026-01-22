import React, { useState, useEffect } from 'react';
import { 
  DollarSign, 
  Plus, 
  Minus, 
  RefreshCw, 
  TrendingUp,
  AlertCircle,
  CheckCircle,
  Clock,
  LogOut,
  BarChart3,
  Mail,
  Lock
} from 'lucide-react';
import agentService from '../services/agentService';
import PinResetFlow from './PinResetFlow';

/**
 * 🏪 AGENT DASHBOARD
 * Dual-Currency Terminal for Cash-In, Cash-Out, and Float Management
 */
const AgentDashboard = () => {
  // ============================================
  // STATE MANAGEMENT
  // ============================================
  
  const [activeTab, setActiveTab] = useState('dashboard');
  const [usdFloat, setUsdFloat] = useState(0);
  const [ugxFloat, setUgxFloat] = useState(0);
  const [loading, setLoading] = useState(false);
  const [notification, setNotification] = useState(null);

  // Cash-In Form
  const [cashInForm, setCashInForm] = useState({
    userAccountId: '',
    amount: '',
    currency: 'USD',
    description: ''
  });

  // Cash-Out Form
  const [cashOutForm, setCashOutForm] = useState({
    userAccountId: '',
    amount: '',
    currency: 'USD',
    phoneNumber: ''
  });

  // Float Top-Up Form
  const [topUpForm, setTopUpForm] = useState({
    amount: '',
    currency: 'USD',
    phoneNumber: ''
  });

  const [recentTransactions, setRecentTransactions] = useState([]);
  const [settlementData, setSettlementData] = useState(null);
  
  // Confirmation Modal State
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [confirmationData, setConfirmationData] = useState(null);
  const [confirmationAction, setConfirmationAction] = useState(null);

  // Agent Profile Edit State
  const [showAgentEdit, setShowAgentEdit] = useState(false);
  const [agentData, setAgentData] = useState(null);
  const [agentEditForm, setAgentEditForm] = useState({
    agentName: '',
    phoneNumber: '',
    locationCity: '',
    locationName: '',
    pin: '',
    enableFingerprint: false
  });
  const [agentEditLoading, setAgentEditLoading] = useState(false);
  const [agentMessage, setAgentMessage] = useState(null);
  const [showPinInput, setShowPinInput] = useState(false);
  const [showFingerprintSetup, setShowFingerprintSetup] = useState(false);

  // State for unlock/reset modals
  const [showPinReset, setShowPinReset] = useState(false);
  const [showAccountUnlock, setShowAccountUnlock] = useState(false);

  // Collapsible Agent Info State
  const [showAgentIdCard, setShowAgentIdCard] = useState(true);
  const [collapsedAgentIdCard, setCollapsedAgentIdCard] = useState(false);
  const [collapsedAgentCodeCard, setCollapsedAgentCodeCard] = useState(false);

  // ============================================
  // LIFECYCLE
  // ============================================

  useEffect(() => {
    initializeAgent();
  }, []);

  const initializeAgent = async () => {
    setLoading(true);
    const initialized = await agentService.initialize();
    if (initialized) {
      await refreshFloatBalances();
      await refreshRecentTransactions();
      
      // Get agent details for editing
      if (agentService.agentId) {
        const details = await agentService.getAgentDetails(agentService.agentId);
        if (details) {
          setAgentData(details);
          setAgentEditForm({
            agentName: details.agent_name || '',
            phoneNumber: details.phone_number || '',
            locationCity: details.location_city || '',
            locationName: details.location_name || '',
            pin: details.pin || '',
            enableFingerprint: details.enable_fingerprint || false
          });
        }
      }
    }
    setLoading(false);
  };

  const refreshFloatBalances = async () => {
    const balances = await agentService.getFloatBalances();
    if (balances) {
      setUsdFloat(balances.USD?.current_balance || 0);
      setUgxFloat(balances.UGX?.current_balance || 0);
    }
  };

  const refreshRecentTransactions = async () => {
    const transactions = await agentService.getRecentTransactions(20);
    setRecentTransactions(transactions);
  };

  // ============================================
  // CASH-IN HANDLER
  // ============================================

  const handleCashIn = async (e) => {
    e.preventDefault();
    
    // Show confirmation modal instead of directly processing
    if (!showConfirmation) {
      try {
        // Look up customer name before showing confirmation
        const { data: userAccount, error: userError } = await agentService.supabase
          .from('user_accounts')
          .select('user_id, account_holder_name')
          .eq('account_number', cashInForm.userAccountId)
          .single();

        if (userError || !userAccount) {
          setNotification({
            type: 'error',
            title: '❌ Customer Not Found',
            message: `Account ${cashInForm.userAccountId} not found`
          });
          return;
        }

        setConfirmationData({
          type: 'cashIn',
          userAccountId: cashInForm.userAccountId,
          customerName: userAccount.account_holder_name,
          amount: cashInForm.amount,
          currency: cashInForm.currency,
          description: cashInForm.description
        });
        setConfirmationAction('cashIn');
        setShowConfirmation(true);
      } catch (error) {
        setNotification({
          type: 'error',
          title: '❌ Error',
          message: error.message
        });
      }
      return;
    }
  };

  // Process Cash-In after confirmation
  const processCashInConfirmed = async () => {
    setLoading(true);
    setNotification(null);

    try {
      // Validate PIN was entered
      if (!confirmationPin || confirmationPin.length !== 4) {
        setNotification({
          type: 'error',
          title: '❌ PIN Required',
          message: 'Please enter your 4-digit PIN'
        });
        setLoading(false);
        return;
      }

      // Look up the customer account to get their user_id
      const { data: userAccount, error: userError } = await agentService.supabase
        .from('user_accounts')
        .select('user_id')
        .eq('account_number', confirmationData.userAccountId)
        .single();

      if (userError || !userAccount) throw new Error('Customer account not found');

      // Get agent's user_id for PIN verification from agents table
      const { data: agentData, error: agentError } = await agentService.supabase
        .from('agents')
        .select('user_id')
        .eq('id', agentService.agentId)
        .single();

      if (agentError || !agentData) throw new Error('Agent account not found');

      // Use universal transaction service with PIN verification
      // Verify AGENT's PIN, but process transaction for CUSTOMER
      const universalTransactionService = (await import('../services/universalTransactionService')).default;
      
      const amount = parseFloat(confirmationData.amount);
      const currency = confirmationData.currency;
      
      const result = await universalTransactionService.processTransaction({
        transactionType: 'cashin',
        userId: userAccount.user_id,  // CUSTOMER's account
        pin_user_id: agentData.user_id,  // Verify AGENT's PIN
        agentId: agentService.agentId,
        pin: confirmationPin,
        currency: currency,
        amount: amount,
        metadata: {
          agent_name: agentData?.agent_name || 'Agent',
          description: confirmationData.description || 'Cash-in transaction'
        }
      });

      setLoading(false);
      setShowConfirmation(false);
      setConfirmationPin('');

      if (result.success) {
        setNotification({
          type: 'success',
          title: '✅ Cash-In Successful',
          message: `${amount} ${currency} received from ${confirmationData.customerName}. New agent float: ${result.agent_balance}`
        });
        setCashInForm({ userAccountId: '', amount: '', currency: 'USD', description: '' });
        await refreshFloatBalances();
        await refreshRecentTransactions();
      } else {
        setNotification({
          type: 'error',
          title: '❌ Cash-In Failed',
          message: result.message || 'Transaction failed'
        });
      }
    } catch (error) {
      setLoading(false);
      setNotification({
        type: 'error',
        title: '❌ Cash-In Error',
        message: error.message || 'An error occurred'
      });
    }
  };

  // ============================================
  // CASH-OUT HANDLER
  // ============================================
  const handleCashOut = async (e) => {
    e.preventDefault();
    
    // Show confirmation modal instead of directly processing
    if (!showConfirmation) {
      try {
        // Look up customer name before showing confirmation
        const { data: userAccount, error: userError } = await agentService.supabase
          .from('user_accounts')
          .select('user_id, account_holder_name')
          .eq('account_number', cashOutForm.userAccountId)
          .single();

        if (userError || !userAccount) {
          setNotification({
            type: 'error',
            title: '❌ Customer Not Found',
            message: `Account ${cashOutForm.userAccountId} not found`
          });
          return;
        }

        setConfirmationData({
          type: 'cashOut',
          userAccountId: cashOutForm.userAccountId,
          customerName: userAccount.account_holder_name,
          amount: cashOutForm.amount,
          currency: cashOutForm.currency
        });
        setConfirmationAction('cashOut');
        setShowConfirmation(true);
      } catch (error) {
        setNotification({
          type: 'error',
          title: '❌ Error',
          message: error.message
        });
      }
      return;
    }
  };

  // Process Cash-Out after confirmation
  const processCashOutConfirmed = async () => {
    setLoading(true);
    setNotification(null);

    try {
      // Validate PIN was entered
      if (!confirmationPin || confirmationPin.length !== 4) {
        setNotification({
          type: 'error',
          title: '❌ PIN Required',
          message: 'Please enter your 4-digit PIN'
        });
        setLoading(false);
        return;
      }

      // Look up the customer account to get their user_id
      const { data: userAccount, error: userError } = await agentService.supabase
        .from('user_accounts')
        .select('user_id, account_holder_name')
        .eq('account_number', confirmationData.userAccountId)
        .single();

      if (userError || !userAccount) throw new Error('Customer account not found');

      // Get agent's user_id for PIN verification from agents table
      const { data: agentData, error: agentError } = await agentService.supabase
        .from('agents')
        .select('user_id')
        .eq('id', agentService.agentId)
        .single();

      if (agentError || !agentData) throw new Error('Agent account not found');

      // Use universal transaction service with PIN verification
      // Verify AGENT's PIN, but process transaction for CUSTOMER
      const universalTransactionService = (await import('../services/universalTransactionService')).default;
      
      const amount = parseFloat(confirmationData.amount);
      const currency = confirmationData.currency;
      
      const result = await universalTransactionService.processTransaction({
        transactionType: 'cashout',
        userId: userAccount.user_id,  // CUSTOMER's account
        pin_user_id: agentData.user_id,  // Verify AGENT's PIN
        agentId: agentService.agentId,
        pin: confirmationPin,
        currency: currency,
        amount: amount,
        metadata: {
          commission_rate: 2.5,
          recipient_name: userAccount.account_holder_name,
          description: 'Cash-out transaction'
        }
      });

      setLoading(false);
      setShowConfirmation(false);
      setConfirmationPin('');

      if (result.success) {
        setNotification({
          type: 'success',
          title: '✅ Payment Sent to Wallet',
          message: `${amount} ${currency} sent to customer wallet. Commission earned: ${((amount * 2.5) / 100).toFixed(2)} ${currency}`
        });
        setCashOutForm({ userAccountId: '', amount: '', currency: 'USD', phoneNumber: '' });
        await refreshFloatBalances();
        await refreshRecentTransactions();
      } else {
        setNotification({
          type: 'error',
          title: '❌ Cash-Out Failed',
          message: result.message || 'Transaction failed'
        });
      }
    } catch (error) {
      console.error('❌ Cash-Out error:', error);
      setLoading(false);
      setNotification({
        type: 'error',
        title: '❌ Error',
        message: error.message
      });
    }
  };

  // ============================================
  // FLOAT TOP-UP HANDLER
  // ============================================

  const handleTopUp = async (e) => {
    e.preventDefault();
    setLoading(true);
    setNotification(null);

    const result = await agentService.processFloatTopUp({
      amount: parseFloat(topUpForm.amount),
      currency: topUpForm.currency,
      phoneNumber: topUpForm.phoneNumber
    });

    setLoading(false);

    if (result.success) {
      setNotification({
        type: 'info',
        title: '📱 MOMO Request Sent',
        message: result.message
      });
      setTopUpForm({ amount: '', currency: 'USD', phoneNumber: '' });
    } else {
      setNotification({
        type: 'error',
        title: '❌ Top-Up Failed',
        message: result.error
      });
    }
  };

  // ============================================
  // SETTLEMENT HANDLER
  // ============================================

  const handleSubmitSettlement = async () => {
    setLoading(true);
    const result = await agentService.submitSettlement({
      usdClosing: usdFloat,
      ugxClosing: ugxFloat,
      shiftNumber: 1,
      notes: settlementData?.notes || ''
    });
    setLoading(false);

    if (result.success) {
      setNotification({
        type: 'success',
        title: '✅ Settlement Submitted',
        message: 'Your shift settlement has been recorded.'
      });
    } else {
      setNotification({
        type: 'error',
        title: '❌ Settlement Failed',
        message: result.error
      });
    }
  };

  // ============================================
  // RENDER HELPERS
  // ============================================

  const renderNotification = () => {
    if (!notification) return null;

    const bgColor = {
      success: 'bg-green-900/30 border-green-500',
      error: 'bg-red-900/30 border-red-500',
      info: 'bg-blue-900/30 border-blue-500'
    }[notification.type];

    const icon = {
      success: <CheckCircle className="w-5 h-5 text-green-400" />,
      error: <AlertCircle className="w-5 h-5 text-red-400" />,
      info: <Clock className="w-5 h-5 text-blue-400" />
    }[notification.type];

    // Check if account is locked
    const isAccountLocked = notification.message && notification.message.includes('Account locked');

    return (
      <div className="space-y-4 mb-4">
        {/* Main Notification */}
        <div className={`border ${bgColor} rounded-lg p-4 flex gap-3`}>
          {icon}
          <div>
            <h3 className="font-semibold text-white">{notification.title}</h3>
            <p className="text-gray-300 text-sm">{notification.message}</p>
          </div>
        </div>

        {/* Account Unlock Actions - Show when account is locked */}
        {isAccountLocked && (
          <div className="bg-gradient-to-br from-red-900/40 to-orange-900/40 border border-orange-500/50 rounded-lg p-6">
            <div className="flex items-start gap-4 mb-4">
              <div className="text-4xl">🏪</div>
              <div className="flex-1">
                <h3 className="text-white font-bold text-lg mb-1">🔐 Account Locked</h3>
                <p className="text-gray-300 text-sm">
                  Your account has been locked due to too many failed PIN attempts. Choose an option below to unlock your account:
                </p>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="grid md:grid-cols-2 gap-3 mb-3">
              {/* Reset PIN Button */}
              <button
                onClick={() => setShowPinReset(true)}
                className="flex items-center gap-3 p-4 bg-blue-600/30 hover:bg-blue-600/50 border border-blue-500/50 rounded-lg transition-all group"
              >
                <div className="text-2xl">🔐</div>
                <div className="text-left">
                  <p className="font-semibold text-blue-300 group-hover:text-blue-200">Reset PIN</p>
                  <p className="text-xs text-gray-400">Send reset link to email</p>
                </div>
              </button>

              {/* Request Unlock Button */}
              <button
                onClick={() => setShowAccountUnlock(true)}
                className="flex items-center gap-3 p-4 bg-purple-600/30 hover:bg-purple-600/50 border border-purple-500/50 rounded-lg transition-all group"
              >
                <div className="text-2xl">🔓</div>
                <div className="text-left">
                  <p className="font-semibold text-purple-300 group-hover:text-purple-200">Request Unlock</p>
                  <p className="text-xs text-gray-400">Contact support team</p>
                </div>
              </button>
            </div>

            {/* Tip */}
            <p className="text-xs text-gray-400 bg-slate-700/30 p-3 rounded">
              💡 <strong>Tip:</strong> Have your Agent ID ready for faster verification
            </p>
          </div>
        )}
      </div>
    );
  };

  // ============================================
  // CONFIRMATION MODAL
  // ============================================
  
  const [confirmationPin, setConfirmationPin] = useState('');

  const renderConfirmationModal = () => {
    if (!showConfirmation || !confirmationData) return null;

    const isCashIn = confirmationData.type === 'cashIn';
    const title = isCashIn ? '💰 Confirm Cash-In' : '📤 Confirm Cash-Out';
    const actionColor = isCashIn ? 'from-green-600 to-green-700' : 'from-orange-600 to-orange-700';
    const actionButtonText = isCashIn ? '✅ Confirm Cash-In' : '✅ Confirm Cash-Out';

    return (
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
        <div className="bg-gradient-to-br from-slate-800 to-slate-900 border border-purple-500/30 rounded-lg p-8 max-w-md w-full">
          {/* Header */}
          <h2 className="text-2xl font-bold text-white mb-6 flex items-center gap-2">
            {isCashIn ? '💰' : '📤'} {title}
          </h2>

          {/* Confirmation Details */}
          <div className="space-y-4 mb-6">
            <div className="bg-white/10 border border-white/20 rounded-lg p-4">
              <p className="text-gray-400 text-sm mb-1">Transaction Type</p>
              <p className="text-white font-semibold text-lg">
                {isCashIn ? 'Cash-In (Transfer to User)' : 'Cash-Out (User Withdrawal)'}
              </p>
            </div>

            {confirmationData.customerName && (
              <div className="bg-blue-500/10 border border-blue-400/30 rounded-lg p-4">
                <p className="text-gray-400 text-sm mb-1">Customer Name</p>
                <p className="text-white font-semibold text-lg">
                  👤 {confirmationData.customerName}
                </p>
              </div>
            )}

            <div className="bg-white/10 border border-white/20 rounded-lg p-4">
              <p className="text-gray-400 text-sm mb-1">Amount</p>
              <p className="text-white font-bold text-2xl">
                {confirmationData.currency} {parseFloat(confirmationData.amount).toLocaleString()}
              </p>
            </div>

            <div className="bg-white/10 border border-white/20 rounded-lg p-4">
              <p className="text-gray-400 text-sm mb-1">User Account ID</p>
              <p className="text-white font-mono text-sm break-all">
                {confirmationData.userAccountId}
              </p>
            </div>

            {confirmationData.description && (
              <div className="bg-white/10 border border-white/20 rounded-lg p-4">
                <p className="text-gray-400 text-sm mb-1">Description</p>
                <p className="text-white text-sm">{confirmationData.description}</p>
              </div>
            )}

            {!isCashIn && (
              <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4">
                <p className="text-yellow-300 text-sm">
                  <strong>💡 Note:</strong> You will earn 2.5% commission on this transaction
                </p>
              </div>
            )}

            {/* PIN INPUT - REQUIRED FOR APPROVAL */}
            <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
              <label className="block text-blue-300 text-sm font-semibold mb-2">
                🔐 Enter Your PIN to Approve
              </label>
              <input
                type="password"
                placeholder="••••"
                maxLength="4"
                value={confirmationPin}
                onChange={(e) => setConfirmationPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                className="w-full px-4 py-2 bg-white/10 border border-blue-400/50 rounded-lg text-white placeholder-gray-500 text-center tracking-widest focus:outline-none focus:border-blue-400 transition-all"
              />
              <p className="text-xs text-gray-400 mt-1">Your 4-digit transaction PIN</p>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3">
            <button
              onClick={() => {
                setShowConfirmation(false);
                setConfirmationData(null);
                setConfirmationAction(null);
                setConfirmationPin('');
              }}
              disabled={loading}
              className="flex-1 px-4 py-3 bg-white/10 hover:bg-white/20 text-white rounded-lg transition-all font-medium disabled:opacity-50"
            >
              ❌ Cancel
            </button>
            <button
              onClick={isCashIn ? processCashInConfirmed : processCashOutConfirmed}
              disabled={loading || confirmationPin.length !== 4}
              className={`flex-1 px-4 py-3 bg-gradient-to-r ${actionColor} text-white rounded-lg font-medium hover:shadow-lg transition-all disabled:opacity-50`}
            >
              {loading ? '⏳ Processing...' : actionButtonText}
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ============================================
  // AGENT PROFILE EDIT HANDLER
  // ============================================

  const handleEditAgentProfile = async (e) => {
    e.preventDefault();
    setAgentEditLoading(true);
    setAgentMessage(null);

    try {
      if (!agentService.agentId) {
        setAgentMessage({
          type: 'error',
          text: 'Agent ID not found'
        });
        setAgentEditLoading(false);
        return;
      }

      const result = await agentService.updateAgentProfile(agentService.agentId, {
        agentName: agentEditForm.agentName,
        phoneNumber: agentEditForm.phoneNumber,
        locationCity: agentEditForm.locationCity,
        locationName: agentEditForm.locationName,
        pin: agentEditForm.pin,
        enableFingerprint: agentEditForm.enableFingerprint
      });

      if (!result.success) {
        setAgentMessage({
          type: 'error',
          text: `Update failed: ${result.error}`
        });
        setAgentEditLoading(false);
        return;
      }

      setAgentMessage({
        type: 'success',
        text: '✅ Profile updated successfully!'
      });

      setAgentData(result.agent);

      setTimeout(() => {
        setShowAgentEdit(false);
      }, 1500);

    } catch (error) {
      console.error('❌ Edit failed:', error);
      setAgentMessage({
        type: 'error',
        text: `Update failed: ${error.message}`
      });
    } finally {
      setAgentEditLoading(false);
    }
  };

  // ============================================
  // REQUEST ACCOUNT UNLOCK MODAL
  // ============================================

  const [unlockRequestPin, setUnlockRequestPin] = useState('');
  const [unlockRequestLoading, setUnlockRequestLoading] = useState(false);
  const [unlockRequestMessage, setUnlockRequestMessage] = useState(null);

  const handleQuickUnlock = async () => {
    if (!unlockRequestPin || unlockRequestPin.length !== 4) {
      setUnlockRequestMessage({
        type: 'error',
        text: '❌ Please enter your 4-digit PIN'
      });
      return;
    }

    setUnlockRequestLoading(true);
    setUnlockRequestMessage(null);

    try {
      // Hash PIN same way backend expects it
      const hashedPin = btoa(unlockRequestPin);

      console.log('🔓 Quick Unlock attempt...');

      // Import the existing Supabase client singleton
      const { getSupabaseClient } = await import('../lib/supabase/client.js');
      const supabase = getSupabaseClient();

      // Get the AUTHENTICATED user (from Supabase auth, not agentService)
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        throw new Error('Not authenticated. Please log in again.');
      }

      const userId = user.id;
      console.log('Using auth user ID:', userId);

      // Query user account from Supabase
      const { data: userAccounts, error: queryError } = await supabase
        .from('user_accounts')
        .select('*')
        .eq('user_id', userId);

      console.log('Query result:', { userAccounts, queryError, count: userAccounts?.length });

      if (queryError) {
        console.error('Query error:', queryError);
        throw new Error(`Query failed: ${queryError.message}`);
      }

      if (!userAccounts || userAccounts.length === 0) {
        throw new Error('User account not found in system');
      }

      const userAccount = userAccounts[0];
      console.log('User account found:', { 
        id: userAccount.id, 
        hasPin: !!userAccount.pin_hash,
        status: userAccount.status 
      });

      // Verify PIN matches
      if (userAccount.pin_hash !== hashedPin) {
        console.warn('PIN mismatch');
        throw new Error('Invalid PIN. Please try again.');
      }

      console.log('✅ PIN verified, unlocking account...');

      // PIN is correct - unlock account by clearing the lock
      const { error: updateError } = await supabase
        .from('user_accounts')
        .update({
          pin_attempts: 0,
          pin_locked_until: null,  // Clear the lock timestamp
          status: 'active',
          updated_at: new Date().toISOString()
        })
        .eq('user_id', userId);

      if (updateError) {
        throw new Error('Failed to unlock account: ' + updateError.message);
      }

      console.log('✅ Account unlocked successfully');

      setUnlockRequestMessage({
        type: 'success',
        text: '✅ Account unlocked successfully! You can now proceed with transactions.'
      });
      setTimeout(() => {
        setShowAccountUnlock(false);
        setUnlockRequestPin('');
        setUnlockRequestMessage(null);
        // Refresh to update account status
        window.location.reload();
      }, 1500);
    } catch (error) {
      console.error('Unlock error:', error);
      setUnlockRequestMessage({
        type: 'error',
        text: '❌ ' + error.message
      });
    } finally {
      setUnlockRequestLoading(false);
    }
  };

  const renderUnlockRequestModal = () => {
    if (!showAccountUnlock) return null;

    return (
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
        <div className="bg-gradient-to-br from-slate-800 to-slate-900 border border-purple-500/30 rounded-lg p-8 max-w-md w-full">
          <div className="flex items-center gap-3 mb-6">
            <Lock className="w-8 h-8 text-purple-400" />
            <h2 className="text-2xl font-bold text-white">🔓 Unlock Account</h2>
          </div>

          {unlockRequestMessage && (
            <div className={`mb-4 p-4 rounded-lg border ${
              unlockRequestMessage.type === 'success'
                ? 'bg-green-500/10 border-green-500/30 text-green-300'
                : 'bg-red-500/10 border-red-500/30 text-red-300'
            }`}>
              {unlockRequestMessage.text}
            </div>
          )}

          <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 mb-6">
            <p className="text-blue-300 text-sm mb-2">
              <strong>🔐 Verify Your Identity</strong>
            </p>
            <p className="text-blue-200 text-xs">
              Enter your 4-digit PIN to verify ownership and unlock your account immediately.
            </p>
          </div>

          <form onSubmit={(e) => { e.preventDefault(); handleQuickUnlock(); }} className="space-y-4">
            <div>
              <label className="block text-gray-300 text-sm font-semibold mb-2">
                Your 4-Digit PIN
              </label>
              <input
                type="password"
                placeholder="••••"
                maxLength="4"
                value={unlockRequestPin}
                onChange={(e) => setUnlockRequestPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-500 text-center tracking-widest text-2xl focus:outline-none focus:border-purple-400 transition-all"
                disabled={unlockRequestLoading}
              />
              <p className="text-xs text-gray-400 mt-1">
                Your transaction PIN (not your login password)
              </p>
            </div>

            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3">
              <p className="text-yellow-300 text-xs">
                ⚡ <strong>Fast Unlock:</strong> Your account will unlock instantly once PIN is verified.
              </p>
            </div>

            <div className="flex gap-3 pt-4">
              <button
                type="button"
                onClick={() => {
                  setShowAccountUnlock(false);
                  setUnlockRequestPin('');
                  setUnlockRequestMessage(null);
                }}
                disabled={unlockRequestLoading}
                className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white font-semibold rounded-lg transition-all disabled:opacity-50"
              >
                ❌ Cancel
              </button>
              <button
                type="submit"
                disabled={unlockRequestLoading || unlockRequestPin.length !== 4}
                className="flex-1 px-4 py-2 bg-gradient-to-r from-green-600 to-green-700 hover:from-green-500 hover:to-green-600 text-white font-semibold rounded-lg transition-all disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {unlockRequestLoading ? (
                  <>
                    <Clock className="w-4 h-4 animate-spin" />
                    Unlocking...
                  </>
                ) : (
                  <>
                    🔓 Unlock
                  </>
                )}
              </button>
            </div>

            {/* Alternative: Request via support */}
            <button
              type="button"
              onClick={() => {
                setShowAccountUnlock(false);
                setShowPinReset(true);
              }}
              className="w-full text-sm text-purple-400 hover:text-purple-300 mt-4 py-2 border-t border-gray-700 pt-4"
            >
              💬 Prefer to request via Support?
            </button>
          </form>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-4 md:p-8">
      <div className="max-w-7xl mx-auto">

        {/* ============================================ */}
        {/* MODALS - PIN RESET & ACCOUNT UNLOCK */}
        {/* ============================================ */}

        {showPinReset && (
          <PinResetFlow
            onSuccess={() => {
              setShowPinReset(false);
              setNotification({
                type: 'success',
                title: '✅ PIN Reset Complete',
                message: 'Check your email for the reset link. Your account will be unlocked once you reset your PIN.'
              });
            }}
            onCancel={() => setShowPinReset(false)}
          />
        )}

        {renderUnlockRequestModal()}

        {/* ============================================ */}
        {/* HEADER */}
        {/* ============================================ */}

        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-4xl font-bold text-white mb-2">🏪 Agent Terminal</h1>
              <p className="text-gray-400">Dual-Currency Bureau de Change Operations</p>
            </div>
            <button
              onClick={() => setShowAgentEdit(true)}
              className="px-4 py-2 bg-blue-600/30 hover:bg-blue-600/50 text-blue-300 rounded-lg text-sm font-medium transition-all border border-blue-500/30"
            >
              ✏️ Edit Profile
            </button>
          </div>
        </div>

        {/* ============================================ */}
        {/* NOTIFICATIONS */}
        {/* ============================================ */}

        {renderNotification()}

        {/* ============================================ */}
        {/* AGENT EDIT MODAL */}
        {/* ============================================ */}

        {showAgentEdit && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="glass-card p-8 w-full max-w-md max-h-[90vh] overflow-y-auto">
              <h2 className="text-3xl font-bold text-white mb-6 flex items-center gap-2">
                ✏️ Edit Agent Profile
              </h2>

              {agentMessage && (
                <div className={`mb-6 p-4 rounded-lg border ${
                  agentMessage.type === 'success' 
                    ? 'bg-green-500/20 border-green-500/50 text-green-400' 
                    : 'bg-red-500/20 border-red-500/50 text-red-400'
                }`}>
                  {agentMessage.text}
                </div>
              )}

              <form onSubmit={handleEditAgentProfile} className="space-y-4">
                {/* Agent Name */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Agent Name</label>
                  <input
                    type="text"
                    value={agentEditForm.agentName}
                    onChange={(e) => setAgentEditForm({ ...agentEditForm, agentName: e.target.value })}
                    placeholder="Enter agent name"
                    className="w-full px-4 py-3 bg-slate-700/50 border border-blue-500/30 hover:border-blue-500/60 rounded-lg text-white placeholder-gray-400 focus:border-blue-500 focus:outline-none transition-all"
                  />
                </div>

                {/* Phone Number */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Phone Number</label>
                  <input
                    type="tel"
                    value={agentEditForm.phoneNumber}
                    onChange={(e) => setAgentEditForm({ ...agentEditForm, phoneNumber: e.target.value })}
                    placeholder="+256..."
                    className="w-full px-4 py-3 bg-slate-700/50 border border-blue-500/30 hover:border-blue-500/60 rounded-lg text-white placeholder-gray-400 focus:border-blue-500 focus:outline-none transition-all"
                  />
                </div>

                {/* Location City */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Location City</label>
                  <input
                    type="text"
                    value={agentEditForm.locationCity}
                    onChange={(e) => setAgentEditForm({ ...agentEditForm, locationCity: e.target.value })}
                    placeholder="e.g., Kampala"
                    className="w-full px-4 py-3 bg-slate-700/50 border border-blue-500/30 hover:border-blue-500/60 rounded-lg text-white placeholder-gray-400 focus:border-blue-500 focus:outline-none transition-all"
                  />
                </div>

                {/* Location Name */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Location Name</label>
                  <input
                    type="text"
                    value={agentEditForm.locationName}
                    onChange={(e) => setAgentEditForm({ ...agentEditForm, locationName: e.target.value })}
                    placeholder="e.g., Downtown Branch"
                    className="w-full px-4 py-3 bg-slate-700/50 border border-blue-500/30 hover:border-blue-500/60 rounded-lg text-white placeholder-gray-400 focus:border-blue-500 focus:outline-none transition-all"
                  />
                </div>

                {/* Security Settings Section */}
                <div className="border-t border-blue-500/20 pt-4 mt-4">
                  <h4 className="text-sm font-semibold text-blue-300 mb-3">🔐 Security Settings</h4>

                  {/* PIN */}
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">Transaction PIN (4-6 digits)</label>
                    <div className="flex gap-2 items-center">
                      <input
                        type={showPinInput ? "text" : "password"}
                        value={agentEditForm.pin}
                        onChange={(e) => {
                          const value = e.target.value.replace(/\D/g, '');
                          if (value.length <= 6) {
                            setAgentEditForm({ ...agentEditForm, pin: value });
                          }
                        }}
                        placeholder="Enter 4-6 digit PIN"
                        maxLength="6"
                        className="flex-1 px-4 py-3 bg-slate-700/50 border border-blue-500/30 hover:border-blue-500/60 rounded-lg text-white placeholder-gray-400 focus:border-blue-500 focus:outline-none transition-all"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPinInput(!showPinInput)}
                        className="px-3 py-2 bg-slate-600/50 hover:bg-slate-600 text-gray-300 rounded-lg transition-all"
                        title={showPinInput ? "Hide PIN" : "Show PIN"}
                      >
                        {showPinInput ? "👁️" : "👁️‍🗨️"}
                      </button>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">Used to authorize transactions</p>
                  </div>

                  {/* Fingerprint Toggle */}
                  <div className="mt-4">
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={agentEditForm.enableFingerprint}
                        onChange={(e) => {
                          setAgentEditForm({ ...agentEditForm, enableFingerprint: e.target.checked });
                          if (e.target.checked) {
                            setShowFingerprintSetup(true);
                          }
                        }}
                        className="w-5 h-5 rounded border-blue-500/50 bg-slate-700/50 checked:bg-blue-600 cursor-pointer"
                      />
                      <div>
                        <p className="text-sm font-medium text-gray-300">Enable Fingerprint Sign-In</p>
                        <p className="text-xs text-gray-500">Faster authentication on this device</p>
                      </div>
                    </label>
                  </div>

                  {/* Fingerprint Setup Info */}
                  {showFingerprintSetup && agentEditForm.enableFingerprint && (
                    <div className="mt-3 p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
                      <p className="text-xs text-blue-300">
                        ✓ Fingerprint authentication will be enabled on your next login
                      </p>
                    </div>
                  )}
                </div>

                {/* Action Buttons */}
                <div className="flex gap-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setShowAgentEdit(false)}
                    disabled={agentEditLoading}
                    className="flex-1 px-4 py-3 bg-slate-600/50 hover:bg-slate-600 text-white rounded-lg font-semibold transition-all disabled:opacity-50"
                  >
                    ❌ Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={agentEditLoading}
                    className="flex-1 px-4 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-lg font-semibold transition-all disabled:opacity-50"
                  >
                    {agentEditLoading ? '⏳ Saving...' : '💾 Save Changes'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ============================================ */}
        {/* CONFIRMATION MODAL */}
        {/* ============================================ */}

        {renderConfirmationModal()}

        {/* ============================================ */}
        {/* FLOAT BALANCES - MAIN CARDS */}
        {/* ============================================ */}

        <div className="grid md:grid-cols-2 gap-4 mb-8">
          {/* USD Float */}
          <div className="bg-gradient-to-br from-emerald-900/40 to-emerald-800/20 border border-emerald-500/30 rounded-xl p-6">
            <div className="flex justify-between items-start mb-4">
              <div>
                <p className="text-emerald-300 text-sm font-semibold mb-1">USD Float Balance</p>
                <p className="text-4xl font-bold text-white">${usdFloat.toFixed(2)}</p>
              </div>
              <DollarSign className="w-10 h-10 text-emerald-400 opacity-50" />
            </div>
            <div className="space-y-2 text-sm text-gray-300">
              <div className="flex justify-between">
                <span>Available</span>
                <span className="text-emerald-400 font-semibold">${usdFloat.toFixed(2)}</span>
              </div>
              <div className="h-1 bg-emerald-900/50 rounded-full overflow-hidden">
                <div className="h-full w-3/4 bg-emerald-500"></div>
              </div>
            </div>
          </div>

          {/* UGX Float */}
          <div className="bg-gradient-to-br from-amber-900/40 to-amber-800/20 border border-amber-500/30 rounded-xl p-6">
            <div className="flex justify-between items-start mb-4">
              <div>
                <p className="text-amber-300 text-sm font-semibold mb-1">UGX</p>
                <p className="text-4xl font-bold text-white">₦{(ugxFloat / 1000).toFixed(2)}K</p>
              </div>
              <TrendingUp className="w-10 h-10 text-amber-400 opacity-50" />
            </div>
            <div className="space-y-2 text-sm text-gray-300">
              <div className="flex justify-between">
                <span>Available</span>
                <span className="text-amber-400 font-semibold">₦{ugxFloat.toLocaleString()}</span>
              </div>
              <div className="h-1 bg-amber-900/50 rounded-full overflow-hidden">
                <div className="h-full w-4/5 bg-amber-500"></div>
              </div>
            </div>
          </div>
        </div>

        {/* ============================================ */}
        {/* TAB NAVIGATION */}
        {/* ============================================ */}

        <div className="flex gap-2 mb-8 flex-wrap">
          {[
            { id: 'dashboard', label: '📊 Dashboard', icon: BarChart3 },
            { id: 'cash-in', label: '💰 Cash-In', icon: Plus },
            { id: 'cash-out', label: '💸 Cash-Out', icon: Minus },
            { id: 'topup', label: '⬆️ Top-Up', icon: RefreshCw },
            { id: 'settlement', label: '✅ Settlement', icon: CheckCircle }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg font-semibold transition ${
                activeTab === tab.id
                  ? 'bg-purple-600 text-white'
                  : 'bg-purple-900/30 text-purple-300 hover:bg-purple-900/50'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* ============================================ */}
        {/* TAB CONTENT */}
        {/* ============================================ */}

        <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-6">

          {/* DASHBOARD TAB */}
          {activeTab === 'dashboard' && (
            <div className="space-y-6">
              {/* Collapsible Agent Info Cards */}
              {showAgentIdCard && agentService.userId && (
                <div className="space-y-3">
                  {/* Agent ID Card - Collapsible */}
                  {collapsedAgentIdCard ? (
                    // Collapsed Icon View - Very Small
                    <div className="flex gap-2 items-center">
                      <button
                        onClick={() => setCollapsedAgentIdCard(false)}
                        title="Expand Agent ID"
                        className="p-1.5 bg-blue-600/30 hover:bg-blue-600/50 text-blue-300 rounded transition-all border border-blue-500/30 text-lg"
                      >
                        🆔
                      </button>
                      {agentData && agentData.agent_code && (
                        <button
                          onClick={() => setCollapsedAgentCodeCard(false)}
                          title="Expand Agent Code"
                          className="p-1.5 bg-purple-600/30 hover:bg-purple-600/50 text-purple-300 rounded transition-all border border-purple-500/30 text-lg"
                        >
                          🏷️
                        </button>
                      )}
                      <button
                        onClick={() => setShowAgentIdCard(false)}
                        title="Hide all agent info"
                        className="p-1.5 bg-red-600/30 hover:bg-red-600/50 text-red-300 rounded transition-all border border-red-500/30 ml-auto text-sm"
                      >
                        ✕
                      </button>
                    </div>
                  ) : (
                    // Expanded Card View
                    <div className="grid md:grid-cols-2 gap-4 mb-6">
                      {/* Agent ID Card */}
                      <div className="bg-gradient-to-br from-blue-900/40 to-blue-800/20 border border-blue-500/30 rounded-xl p-4">
                        <div className="flex justify-between items-start mb-2">
                          <p className="text-blue-300 text-sm font-semibold">Agent Auth User ID</p>
                          <button
                            onClick={() => setCollapsedAgentIdCard(true)}
                            title="Collapse"
                            className="text-gray-400 hover:text-gray-200 transition text-sm"
                          >
                            ▼
                          </button>
                        </div>
                        <p className="text-white font-mono text-sm break-all mb-3 p-3 bg-slate-700/50 rounded border border-slate-600/50">
                          {agentService.userId}
                        </p>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(agentService.userId);
                            setNotification({ type: 'success', text: '✅ Agent ID copied to clipboard!' });
                            setTimeout(() => setNotification(null), 2000);
                          }}
                          className="w-full px-3 py-2 bg-blue-600/30 hover:bg-blue-600/50 text-blue-300 rounded-lg text-sm font-medium transition-all border border-blue-500/30"
                        >
                          📋 Copy ID
                        </button>
                      </div>

                      {/* Agent Code Card */}
                      {agentData && agentData.agent_code && (
                        <div className="bg-gradient-to-br from-purple-900/40 to-purple-800/20 border border-purple-500/30 rounded-xl p-4">
                          <div className="flex justify-between items-start mb-2">
                            <p className="text-purple-300 text-sm font-semibold">Agent Code</p>
                            <button
                              onClick={() => setCollapsedAgentCodeCard(true)}
                              title="Collapse"
                              className="text-gray-400 hover:text-gray-200 transition text-sm"
                            >
                              ▼
                            </button>
                          </div>
                          <p className="text-white font-mono text-sm break-all mb-3 p-3 bg-slate-700/50 rounded border border-slate-600/50">
                            {agentData.agent_code}
                          </p>
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(agentData.agent_code);
                              setNotification({ type: 'success', text: '✅ Agent code copied to clipboard!' });
                              setTimeout(() => setNotification(null), 2000);
                            }}
                            className="w-full px-3 py-2 bg-purple-600/30 hover:bg-purple-600/50 text-purple-300 rounded-lg text-sm font-medium transition-all border border-purple-500/30"
                          >
                            📋 Copy Code
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Show Hidden Info Button */}
              {!showAgentIdCard && agentService.userId && (
                <button
                  onClick={() => setShowAgentIdCard(true)}
                  title="Show agent info"
                  className="p-2 bg-gray-600/30 hover:bg-gray-600/50 text-gray-300 rounded-lg transition-all border border-gray-500/30"
                >
                  👤 Show Agent Info
                </button>
              )}

              <h2 className="text-2xl font-bold text-white">Recent Settlements</h2>
              
              <div className="space-y-3 max-h-96 overflow-y-auto">
                {recentTransactions.length === 0 ? (
                  <p className="text-gray-400 text-center py-8">No transactions yet</p>
                ) : (
                  recentTransactions.map(tx => (
                    <div key={tx.id} className="bg-slate-700/50 border border-slate-600/50 rounded-lg p-4 flex justify-between items-center">
                      <div>
                        <p className="text-white font-semibold capitalize">{tx.transaction_type}</p>
                        <p className="text-gray-400 text-sm">{tx.reference_number}</p>
                      </div>
                      <div className="text-right">
                        <p className={`font-bold ${
                          tx.transaction_type === 'cash_out' ? 'text-green-400' : 'text-red-400'
                        }`}>
                          {tx.transaction_type === 'cash_out' ? '+' : '-'}{tx.amount} {tx.currency}
                        </p>
                        <p className={`text-sm ${
                          tx.status === 'completed' ? 'text-green-400' : 'text-yellow-400'
                        }`}>
                          {tx.status}
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* CASH-IN TAB */}
          {activeTab === 'cash-in' && (
            <div className="max-w-2xl">
              <h2 className="text-2xl font-bold text-white mb-6">💰 Process Cash-In</h2>
              
              <form onSubmit={handleCashIn} className="space-y-4">
                <div>
                  <label className="block text-gray-300 font-semibold mb-2">User Account ID</label>
                  <input
                    type="text"
                    placeholder="e.g., user-12345 or ACC-001"
                    value={cashInForm.userAccountId}
                    onChange={(e) => setCashInForm({...cashInForm, userAccountId: e.target.value})}
                    className="w-full bg-slate-700/50 border border-slate-600 rounded-lg px-4 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-purple-500"
                    required
                  />
                </div>

                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-gray-300 font-semibold mb-2">Currency</label>
                    <select
                      value={cashInForm.currency}
                      onChange={(e) => setCashInForm({...cashInForm, currency: e.target.value})}
                      className="w-full bg-slate-700/50 border border-slate-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-purple-500"
                    >
                      <option value="USD">🇺🇸 USD</option>
                      <option value="UGX">🇺🇬 UGX</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-gray-300 font-semibold mb-2">Amount</label>
                    <input
                      type="number"
                      step="0.01"
                      placeholder="Amount received"
                      value={cashInForm.amount}
                      onChange={(e) => setCashInForm({...cashInForm, amount: e.target.value})}
                      className="w-full bg-slate-700/50 border border-slate-600 rounded-lg px-4 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-purple-500"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-gray-300 font-semibold mb-2">Description</label>
                  <textarea
                    placeholder="Transaction note (optional)"
                    value={cashInForm.description}
                    onChange={(e) => setCashInForm({...cashInForm, description: e.target.value})}
                    className="w-full bg-slate-700/50 border border-slate-600 rounded-lg px-4 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-purple-500 h-20"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 disabled:opacity-50 text-white font-bold py-3 rounded-lg transition flex items-center justify-center gap-2"
                >
                  <Plus className="w-5 h-5" />
                  {loading ? 'Processing...' : 'Complete Cash-In'}
                </button>
              </form>
            </div>
          )}

          {/* CASH-OUT TAB */}
          {activeTab === 'cash-out' && (
            <div className="max-w-2xl">
              <h2 className="text-2xl font-bold text-white mb-6">💸 Send to ICAN User Wallet</h2>
              
              <form onSubmit={handleCashOut} className="space-y-4">
                <div>
                  <label className="block text-gray-300 font-semibold mb-2">Customer Account Number</label>
                  <input
                    type="text"
                    placeholder="e.g., ICAN-3610252715435498"
                    value={cashOutForm.userAccountId}
                    onChange={(e) => setCashOutForm({...cashOutForm, userAccountId: e.target.value})}
                    className="w-full bg-slate-700/50 border border-slate-600 rounded-lg px-4 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-purple-500"
                    required
                  />
                </div>

                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-gray-300 font-semibold mb-2">Currency</label>
                    <select
                      value={cashOutForm.currency}
                      onChange={(e) => setCashOutForm({...cashOutForm, currency: e.target.value})}
                      className="w-full bg-slate-700/50 border border-slate-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-purple-500"
                    >
                      <option value="USD">🇺🇸 USD</option>
                      <option value="UGX">🇺🇬 UGX</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-gray-300 font-semibold mb-2">Amount to Send</label>
                    <input
                      type="number"
                      step="0.01"
                      placeholder="Amount"
                      value={cashOutForm.amount}
                      onChange={(e) => setCashOutForm({...cashOutForm, amount: e.target.value})}
                      className="w-full bg-slate-700/50 border border-slate-600 rounded-lg px-4 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-purple-500"
                      required
                    />
                  </div>
                </div>

                <div className="bg-blue-900/30 border border-blue-500/30 rounded-lg p-4">
                  <p className="text-blue-300 text-sm">
                    <strong>💡 How it works:</strong>
                  </p>
                  <p className="text-blue-200 text-sm mt-2">
                    1. Enter customer's Account Number (ICAN-...)<br/>
                    2. Money deducted from your float<br/>
                    3. Amount added to customer's ICAN wallet<br/>
                    4. You earn 2.5% commission<br/>
                    5. Customer receives instant notification
                  </p>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-gradient-to-r from-green-600 to-green-500 hover:from-green-500 hover:to-green-400 disabled:opacity-50 text-white font-bold py-3 rounded-lg transition flex items-center justify-center gap-2"
                >
                  <Plus className="w-5 h-5" />
                  {loading ? 'Processing...' : 'Send to Wallet'}
                </button>
              </form>
            </div>
          )}

          {/* TOP-UP TAB */}
          {activeTab === 'topup' && (
            <div className="max-w-2xl">
              <h2 className="text-2xl font-bold text-white mb-6">⬆️ Refill Float</h2>
              
              <form onSubmit={handleTopUp} className="space-y-4">
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-gray-300 font-semibold mb-2">Currency</label>
                    <select
                      value={topUpForm.currency}
                      onChange={(e) => setTopUpForm({...topUpForm, currency: e.target.value})}
                      className="w-full bg-slate-700/50 border border-slate-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-purple-500"
                    >
                      <option value="USD">🇺🇸 USD</option>
                      <option value="UGX">🇺🇬 UGX</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-gray-300 font-semibold mb-2">Top-Up Amount</label>
                    <input
                      type="number"
                      step="0.01"
                      placeholder="Amount needed"
                      value={topUpForm.amount}
                      onChange={(e) => setTopUpForm({...topUpForm, amount: e.target.value})}
                      className="w-full bg-slate-700/50 border border-slate-600 rounded-lg px-4 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-purple-500"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-gray-300 font-semibold mb-2">MOMO Phone Number</label>
                  <input
                    type="tel"
                    placeholder="e.g., 256701234567"
                    value={topUpForm.phoneNumber}
                    onChange={(e) => setTopUpForm({...topUpForm, phoneNumber: e.target.value})}
                    className="w-full bg-slate-700/50 border border-slate-600 rounded-lg px-4 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-purple-500"
                    required
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-gradient-to-r from-purple-600 to-purple-500 hover:from-purple-500 hover:to-purple-400 disabled:opacity-50 text-white font-bold py-3 rounded-lg transition flex items-center justify-center gap-2"
                >
                  <RefreshCw className="w-5 h-5" />
                  {loading ? 'Sending MOMO...' : 'Send MOMO Request'}
                </button>
              </form>
            </div>
          )}

          {/* SETTLEMENT TAB */}
          {activeTab === 'settlement' && (
            <div>
              <h2 className="text-2xl font-bold text-white mb-6">✅ End of Shift Settlement</h2>
              
              <div className="space-y-6">
                <div className="grid md:grid-cols-2 gap-6">
                  {/* USD Settlement */}
                  <div className="bg-emerald-900/30 border border-emerald-500/30 rounded-lg p-4">
                    <h3 className="text-emerald-300 font-semibold mb-4">USD Settlement</h3>
                    <div className="space-y-3">
                      <div className="flex justify-between">
                        <span className="text-gray-400">Closing Balance</span>
                        <span className="text-white font-semibold">${usdFloat.toFixed(2)}</span>
                      </div>
                      <div className="h-1 bg-emerald-900 rounded"></div>
                      <button
                        onClick={() => setSettlementData({...settlementData, usdConfirmed: true})}
                        className="w-full bg-emerald-600 hover:bg-emerald-500 text-white py-2 rounded-lg font-semibold transition"
                      >
                        ✓ Confirm USD
                      </button>
                    </div>
                  </div>

                  {/* UGX Settlement */}
                  <div className="bg-amber-900/30 border border-amber-500/30 rounded-lg p-4">
                    <h3 className="text-amber-300 font-semibold mb-4">UGX Settlement</h3>
                    <div className="space-y-3">
                      <div className="flex justify-between">
                        <span className="text-gray-400">Closing Balance</span>
                        <span className="text-white font-semibold">₦{ugxFloat.toLocaleString()}</span>
                      </div>
                      <div className="h-1 bg-amber-900 rounded"></div>
                      <button
                        onClick={() => setSettlementData({...settlementData, ugxConfirmed: true})}
                        className="w-full bg-amber-600 hover:bg-amber-500 text-white py-2 rounded-lg font-semibold transition"
                      >
                        ✓ Confirm UGX
                      </button>
                    </div>
                  </div>
                </div>

                <button
                  onClick={handleSubmitSettlement}
                  disabled={loading}
                  className="w-full bg-gradient-to-r from-purple-600 to-purple-500 hover:from-purple-500 hover:to-purple-400 disabled:opacity-50 text-white font-bold py-3 rounded-lg transition"
                >
                  {loading ? 'Submitting...' : 'Submit Shift Settlement'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AgentDashboard;
