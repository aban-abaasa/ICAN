import React, { useState, useRef, useEffect } from 'react';
import {
  Wallet,
  Send,
  ArrowDownLeft,
  ArrowUpRight,
  Plus,
  Globe,
  DollarSign,
  TrendingUp,
  Eye,
  EyeOff,
  Settings,
  History,
  CreditCard,
  Banknote,
  ChevronDown,
  Zap,
  Download,
  Upload,
  Store,
  Lock,
  AlertCircle,
  Users,
  Phone,
  MapPin
} from 'lucide-react';
import momoService from '../services/momoService';
import airtelMoneyService from '../services/airtelMoneyService';
import flutterwaveService from '../services/flutterwaveService';
import { walletTransactionService } from '../services/walletTransactionService';
import { cardTransactionService } from '../services/cardTransactionService';
import { walletService } from '../services/walletService';
import paymentMethodDetector from '../services/paymentMethodDetector';
import agentService from '../services/agentService';
import { walletAccountService } from '../services/walletAccountService';
import { getSupabaseClient } from '../lib/supabase/client';
import AgentDashboard from './AgentDashboard';

const ICANWallet = () => {
  const [showBalance, setShowBalance] = useState(true);
  const [selectedCurrency, setSelectedCurrency] = useState('USD');
  const [activeTab, setActiveTab] = useState('overview');
  const [showCurrencyDropdown, setShowCurrencyDropdown] = useState(false);
  const [activeModal, setActiveModal] = useState(null); // 'send', 'receive', 'topup'
  const [sendForm, setSendForm] = useState({ recipient: '', amount: '', description: '' });
  const [receiveForm, setReceiveForm] = useState({ amount: '', description: '' });
  const [topupForm, setTopupForm] = useState({ amount: '', paymentInput: '', method: null, detectedMethod: null });
  const [withdrawForm, setWithdrawForm] = useState({ method: '', phoneAccount: '', amount: '', bankName: '' });
  const [detectedPaymentMethod, setDetectedPaymentMethod] = useState(null);
  const [transactionInProgress, setTransactionInProgress] = useState(false);
  const [transactionResult, setTransactionResult] = useState(null);
  const [showPaymentPicker, setShowPaymentPicker] = useState(false);
  const [isAgent, setIsAgent] = useState(false);
  const [agentCheckLoading, setAgentCheckLoading] = useState(true);
  const [showAgentRegistration, setShowAgentRegistration] = useState(false);
  const [agentRegistrationForm, setAgentRegistrationForm] = useState({
    agentName: '',
    phoneNumber: '',
    locationCity: '',
    locationName: ''
  });
  const [registrationLoading, setRegistrationLoading] = useState(false);
  const [registrationMessage, setRegistrationMessage] = useState(null);
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [agentDepositAmount, setAgentDepositAmount] = useState('');
  const [agentTransactionType, setAgentTransactionType] = useState('deposit'); // 'deposit' or 'withdraw'
  const [availableAgents, setAvailableAgents] = useState([
    { id: 1, name: 'John Kamuli', phone: '+256701234567', location: 'Kampala Downtown', rating: 4.8, transactions: 234 },
    { id: 2, name: 'Sarah Nakibuka', phone: '+256702345678', location: 'Jinja CBD', rating: 4.9, transactions: 312 },
    { id: 3, name: 'Peter Ouma', phone: '+256703456789', location: 'Fort Portal', rating: 4.7, transactions: 189 },
    { id: 4, name: 'Grace Mwangi', phone: '+256704567890', location: 'Kampala Makindye', rating: 4.85, transactions: 267 },
    { id: 5, name: 'David Ssekandi', phone: '+256705678901', location: 'Entebbe', rating: 4.6, transactions: 145 }
  ]);

  // 🎯 WALLET ACCOUNT MANAGEMENT
  const [userAccount, setUserAccount] = useState(null);
  const [accountCheckLoading, setAccountCheckLoading] = useState(true);
  const [showAccountCreation, setShowAccountCreation] = useState(false);
  const [showAccountEdit, setShowAccountEdit] = useState(false);
  const [showPinChangeSection, setShowPinChangeSection] = useState(false);
  const [showPhoneOtpSection, setShowPhoneOtpSection] = useState(false);
  const [accountCreationForm, setAccountCreationForm] = useState({
    accountHolderName: '',
    phoneNumber: '',
    email: '',
    pin: '',
    preferredCurrency: 'USD',
    fingerprintEnabled: false,
    phonePhoneEnabled: false
  });
  const [accountEditForm, setAccountEditForm] = useState({
    accountHolderName: '',
    phoneNumber: '',
    email: '',
    preferredCurrency: 'USD',
    currentPin: '',
    newPin: '',
    confirmNewPin: '',
    phoneOtp: ''
  });
  const [accountCreationLoading, setAccountCreationLoading] = useState(false);
  const [accountEditLoading, setAccountEditLoading] = useState(false);
  const [accountMessage, setAccountMessage] = useState(null);
  const [showSettingsPanel, setShowSettingsPanel] = useState(false);
  const [agentAccount, setAgentAccount] = useState(null);
  const [agentAccountLoading, setAgentAccountLoading] = useState(false);
  const [showWalletAccountNumber, setShowWalletAccountNumber] = useState(false);
  const [showAgentAccountNumber, setShowAgentAccountNumber] = useState(true);
  
  // Payment Cards State
  const [paymentCards, setPaymentCards] = useState([]);
  const [showAddCardModal, setShowAddCardModal] = useState(false);
  const [cardFormLoading, setCardFormLoading] = useState(false);
  const [cardMessage, setCardMessage] = useState(null);
  const [cardForm, setCardForm] = useState({
    cardholderName: '',
    cardNumber: '',
    expiryMonth: '',
    expiryYear: '',
    cvv: '',
    cardType: 'credit'
  });

  // 💰 Unified Transaction System (Deposit/Withdraw for Users & Agents)
  const [transactionHistory, setTransactionHistory] = useState([]);
  const [transactionInitiator, setTransactionInitiator] = useState('user'); // 'user' or 'agent'
  
  // 💵 Real Wallet Balances from Database
  const [realWalletBalances, setRealWalletBalances] = useState({
    USD: 0,
    UGX: 0,
    KES: 0
  });
  const [balancesLoading, setBalancesLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState(null);

  const dropdownRef = useRef(null);

  // Load agent account data when settings panel opens
  useEffect(() => {
    if (showSettingsPanel && isAgent && !agentAccount && !agentAccountLoading) {
      loadAgentAccount();
    }
  }, [showSettingsPanel]);

  const loadAgentAccount = async () => {
    try {
      setAgentAccountLoading(true);
      const agentData = await agentService.getAgentDetails(agentService.agentId);
      if (agentData) {
        setAgentAccount(agentData);
      }
    } catch (error) {
      console.error('Error loading agent account:', error);
    } finally {
      setAgentAccountLoading(false);
    }
  };

  // 🎯 MAGIC PAYMENT DETECTOR - Auto-detect payment method
  const handlePaymentInputChange = (e) => {
    const input = e.target.value;
    setTopupForm(prev => ({ ...prev, paymentInput: input }));

    if (!input.trim()) {
      setDetectedPaymentMethod(null);
      return;
    }

    const detected = paymentMethodDetector.detectMethod(input);
    setDetectedPaymentMethod(detected);
    
    if (detected) {
      console.log(`✨ Detected: ${detected.name} ${detected.icon}`);
      setTopupForm(prev => ({
        ...prev,
        method: detected.method,
        detectedMethod: detected
      }));
    }
  };

  // 💾 Load wallet balances from database
  const loadWalletBalances = async (userId) => {
    try {
      setBalancesLoading(true);
      const supabase = getSupabaseClient();
      
      // CRITICAL: Check authentication BEFORE querying wallet_accounts
      const { data: { user: authUser }, error: authError } = await supabase.auth.getUser();
      if (authError || !authUser) {
        console.warn('⚠️ loadWalletBalances: User not authenticated');
        setBalancesLoading(false);
        return;
      }
      
      // Try to get balances from wallet_accounts table (updated by agent transactions)
      const { data: walletAccounts, error: walletError } = await supabase
        .from('wallet_accounts')
        .select('currency, balance')
        .eq('user_id', userId);
      
      if (walletAccounts && walletAccounts.length > 0) {
        // Build balances from wallet_accounts
        const balances = { USD: 0, UGX: 0, KES: 0, GBP: 0, EUR: 0 };
        walletAccounts.forEach(account => {
          if (balances.hasOwnProperty(account.currency)) {
            balances[account.currency] = parseFloat(account.balance) || 0;
          }
        });
        
        setRealWalletBalances({
          USD: balances.USD,
          UGX: balances.UGX,
          KES: balances.KES
        });
        console.log('✅ Wallet balances loaded from wallet_accounts:', balances);
        return;
      }
      
      // Fallback: Get from user_accounts table
      const summary = await walletAccountService.getAccountSummary(userId);
      
      if (summary && summary.balances) {
        setRealWalletBalances({
          USD: summary.balances.USD || 0,
          UGX: summary.balances.UGX || 0,
          KES: summary.balances.KES || 0
        });
        console.log('✅ Wallet balances loaded from user_accounts:', summary.balances);
      } else {
        console.warn('⚠️ No wallet balances found');
        setRealWalletBalances({
          USD: 0,
          UGX: 0,
          KES: 0
        });
      }
    } catch (error) {
      console.error('❌ Error loading wallet balances:', error);
      setRealWalletBalances({
        USD: 0,
        UGX: 0,
        KES: 0
      });
    } finally {
      setBalancesLoading(false);
    }
  };

  // Build wallet data with real balances from database
  const walletData = {
    USD: {
      balance: realWalletBalances.USD,
      currency: 'USD',
      flag: '🇺🇸',
      country: 'United States',
      region: 'North America',
      transactions: [
        { id: 1, type: 'receive', amount: 500, from: 'John Doe', date: '2024-01-12', status: 'completed' },
        { id: 2, type: 'send', amount: 250, to: 'Jane Smith', date: '2024-01-11', status: 'completed' },
        { id: 3, type: 'receive', amount: 1000, from: 'ICAN Platform', date: '2024-01-10', status: 'completed' }
      ]
    },
    KES: {
      balance: realWalletBalances.KES,
      currency: 'KES',
      flag: '🇰🇪',
      country: 'Kenya',
      region: 'East Africa',
      transactions: [
        { id: 1, type: 'receive', amount: 50000, from: 'Business Partner', date: '2024-01-12', status: 'completed' },
        { id: 2, type: 'send', amount: 25000, to: 'Supplier', date: '2024-01-11', status: 'completed' },
        { id: 3, type: 'receive', amount: 100000, from: 'Investment', date: '2024-01-10', status: 'completed' }
      ]
    },
    UGX: {
      balance: realWalletBalances.UGX,
      currency: 'UGX',
      flag: '🇺🇬',
      country: 'Uganda',
      region: 'East Africa',
      transactions: [
        { id: 1, type: 'receive', amount: 1000000, from: 'Partner', date: '2024-01-12', status: 'completed' },
        { id: 2, type: 'send', amount: 500000, to: 'Vendor', date: '2024-01-11', status: 'completed' },
        { id: 3, type: 'receive', amount: 2000000, from: 'Investment', date: '2024-01-10', status: 'completed' }
      ]
    },
    GBP: {
      balance: 3250.25,
      currency: 'GBP',
      flag: '🇬🇧',
      country: 'United Kingdom',
      region: 'Europe',
      transactions: [
        { id: 1, type: 'receive', amount: 300, from: 'Partner', date: '2024-01-12', status: 'completed' },
        { id: 2, type: 'send', amount: 150, to: 'Vendor', date: '2024-01-11', status: 'completed' },
        { id: 3, type: 'receive', amount: 600, from: 'Investment', date: '2024-01-10', status: 'completed' }
      ]
    },
    EUR: {
      balance: 2980.50,
      currency: 'EUR',
      flag: '🇪🇺',
      country: 'Europe',
      region: 'Europe',
      transactions: [
        { id: 1, type: 'receive', amount: 400, from: 'Partner', date: '2024-01-12', status: 'completed' },
        { id: 2, type: 'send', amount: 200, to: 'Vendor', date: '2024-01-11', status: 'completed' },
        { id: 3, type: 'receive', amount: 800, from: 'Investment', date: '2024-01-10', status: 'completed' }
      ]
    }
  };

  const currentWallet = walletData[selectedCurrency];

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setShowCurrencyDropdown(false);
      }
    };

    // Initialize wallet service
    walletService.initialize({ id: 'user-id', name: 'ICAN User' });

    // Check if user is an agent and has wallet account
    const initializeUser = async () => {
      try {
        const supabase = getSupabaseClient();
        const { data: { user }, error } = await supabase.auth.getUser();

        if (error || !user) {
          console.log('❌ User not authenticated');
          setAccountCheckLoading(false);
          setAgentCheckLoading(false);
          return;
        }

        // Store user ID for later use
        setCurrentUserId(user.id);

        // Ensure wallet accounts exist for all currencies
        await walletAccountService.ensureWalletAccountsExist(user.id);

        // Load wallet balances
        await loadWalletBalances(user.id);

        // Check for wallet account
        setAccountCheckLoading(true);
        const account = await walletAccountService.checkUserAccount(user.id);
        
        if (account) {
          setUserAccount(account);
          console.log('✅ User wallet account found:', account.account_number);
        } else {
          setUserAccount(null);
          console.log('⚠️ User has no wallet account yet');
          setShowAccountCreation(true);
        }
        setAccountCheckLoading(false);

        // Check if user is an agent (non-blocking)
        setAgentCheckLoading(true);
        const agentStatus = await agentService.isUserAgent();
        setIsAgent(agentStatus.isAgent);
        setAgentCheckLoading(false);
        console.log('Agent status:', agentStatus);
      } catch (error) {
        console.error('❌ Error initializing user:', error);
        setAccountCheckLoading(false);
        setAgentCheckLoading(false);
      }
    };

    initializeUser();

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // 💳 SEND MONEY HANDLER - Support both ICAN users and MOMO
  const handleSendMoney = async (e) => {
    e.preventDefault();
    if (!sendForm.recipient || !sendForm.amount) {
      alert('Please fill in recipient and amount');
      return;
    }
    
    setTransactionInProgress(true);
    
    try {
      // Determine if recipient is ICAN account or phone number
      const isICANAccount = sendForm.recipient.toUpperCase().startsWith('ICAN-') || 
                            sendForm.recipient.includes('@') ||
                            sendForm.recipient.length > 16; // Likely email or account number
      
      if (isICANAccount) {
        // Send to ICAN Wallet User
        await handleSendToICANUser(sendForm.recipient, sendForm.amount, sendForm.description);
      } else {
        // Send via MOMO (phone number)
        await handleSendViaMOMO(sendForm.recipient, sendForm.amount, sendForm.description);
      }
    } catch (error) {
      console.error('❌ Send error:', error);
      setTransactionResult({
        type: 'send',
        success: false,
        message: 'An error occurred during transfer.',
        error: error.message
      });
    }
    
    setSendForm({ recipient: '', amount: '', description: '' });
    setTransactionInProgress(false);
    
    // Auto close after 3 seconds
    setTimeout(() => {
      setActiveModal(null);
      setTransactionResult(null);
    }, 3000);
  };

  // 💳 Send to ICAN Wallet User
  const handleSendToICANUser = async (recipientIdentifier, amount, description) => {
    try {
      const supabase = getSupabaseClient();

      // CRITICAL: Check authentication BEFORE querying user_accounts
      const { data: { user: authUser }, error: authError } = await supabase.auth.getUser();
      if (authError || !authUser) {
        throw new Error('User not authenticated');
      }

      // Find recipient by account number, email, or phone
      let recipientUser = null;
      let lookupError = null;
      
      if (recipientIdentifier.toUpperCase().startsWith('ICAN-')) {
        // Search by account number
        const { data, error } = await supabase
          .from('user_accounts')
          .select('user_id, account_holder_name, account_number')
          .eq('account_number', recipientIdentifier.toUpperCase())
          .single();
        recipientUser = data;
        lookupError = error;
        console.log('Search by account number:', { recipientIdentifier: recipientIdentifier.toUpperCase(), data, error });
      } else if (recipientIdentifier.includes('@')) {
        // Search by email
        const { data, error } = await supabase
          .from('user_accounts')
          .select('user_id, account_holder_name, email')
          .eq('email', recipientIdentifier.toLowerCase())
          .single();
        recipientUser = data;
        lookupError = error;
        console.log('Search by email:', { email: recipientIdentifier.toLowerCase(), data, error });
      } else {
        // Search by phone number
        const { data, error } = await supabase
          .from('user_accounts')
          .select('user_id, account_holder_name, phone_number')
          .eq('phone_number', recipientIdentifier)
          .single();
        recipientUser = data;
        lookupError = error;
        console.log('Search by phone:', { phone: recipientIdentifier, data, error });
      }

      if (!recipientUser || lookupError) {
        console.error('Recipient lookup failed:', { recipientIdentifier, lookupError, recipientUser });
        setTransactionResult({
          type: 'send',
          success: false,
          message: `Recipient not found: ${recipientIdentifier}${lookupError ? ` (${lookupError.message})` : ''}`
        });
        return;
      }

      // Prevent self-transfer
      if (recipientUser.user_id === currentUserId) {
        setTransactionResult({
          type: 'send',
          success: false,
          message: 'Cannot send money to yourself'
        });
        return;
      }

      const parsedAmount = parseFloat(amount);
      
      // Optional: Add small transaction fee (0.5% for ICAN transfers)
      const transactionFee = parsedAmount * 0.005;
      const totalDeduction = parsedAmount + transactionFee;

      // Check sender's balance
      if (totalDeduction > parseFloat(currentWallet.balance)) {
        setTransactionResult({
          type: 'send',
          success: false,
          message: `Insufficient balance. You have ${currentWallet.balance} ${currentWallet.currency}, need ${totalDeduction.toFixed(2)}`
        });
        return;
      }

      // Get wallet accounts for both users
      const { data: senderWallet, error: senderWalletError } = await supabase
        .from('wallet_accounts')
        .select('id, balance')
        .eq('user_id', currentUserId)
        .eq('currency', selectedCurrency)
        .maybeSingle();

      const { data: recipientWallet, error: recipientWalletError } = await supabase
        .from('wallet_accounts')
        .select('id, balance')
        .eq('user_id', recipientUser.user_id)
        .eq('currency', selectedCurrency)
        .maybeSingle();

      console.log('Wallet lookups:', {
        currentUserId,
        recipientUserId: recipientUser.user_id,
        selectedCurrency,
        senderWallet,
        senderWalletError,
        recipientWallet,
        recipientWalletError
      });

      // If recipient doesn't have wallet in this currency, create it using backend function
      let finalRecipientWallet = recipientWallet;
      if (!finalRecipientWallet && !recipientWalletError) {
        console.log('Creating wallet for recipient in currency:', selectedCurrency);
        const { data: walletsData, error: createError } = await supabase
          .rpc('ensure_recipient_wallet_exists', {
            p_user_id: recipientUser.user_id,
            p_curr: selectedCurrency
          });
        
        const newWallet = walletsData && walletsData.length > 0 ? walletsData[0] : null;
        
        if (createError) {
          console.error('Failed to create recipient wallet:', createError);
          setTransactionResult({
            type: 'send',
            success: false,
            message: `Failed to create wallet for recipient: ${createError.message}`
          });
          return;
        }
        
        if (!newWallet) {
          console.error('Wallet creation returned no data');
          setTransactionResult({
            type: 'send',
            success: false,
            message: 'Failed to create recipient wallet - no wallet returned'
          });
          return;
        }
        
        console.log('✅ Recipient wallet created:', newWallet);
        finalRecipientWallet = newWallet;
      }

      if (!senderWallet || !finalRecipientWallet) {
        setTransactionResult({
          type: 'send',
          success: false,
          message: `Wallet accounts not found${senderWalletError ? ` (sender: ${senderWalletError.message})` : ''}`
        });
        return;
      }

      // Deduct from sender (amount + fee)
      const { error: senderError } = await supabase
        .from('wallet_accounts')
        .update({
          balance: parseFloat(senderWallet.balance) - totalDeduction,
          updated_at: new Date().toISOString()
        })
        .eq('id', senderWallet.id);

      if (senderError) throw senderError;

      // Add to recipient (amount only, not fee) using backend function to bypass RLS
      console.log('Updating recipient wallet:', { id: finalRecipientWallet.id, currentBalance: finalRecipientWallet.balance, adding: parsedAmount });
      const { data: updatedWallets, error: recipientError } = await supabase
        .rpc('update_recipient_wallet_balance', {
          p_user_id: recipientUser.user_id,
          p_curr: selectedCurrency,
          p_amount: parsedAmount
        });

      if (recipientError) {
        console.error('❌ Recipient update failed:', recipientError);
        throw recipientError;
      }
      
      console.log('✅ Recipient wallet updated successfully', updatedWallets);

      // Record transaction
      const transactionId = `ICAN-TRANSFER-${Date.now()}`;
      const { error: txError } = await supabase
        .from('wallet_transactions')
        .insert([{
          user_id: currentUserId,
          transaction_type: 'send',
          amount: parsedAmount,
          currency: selectedCurrency,
          recipient_user_id: recipientUser.user_id,
          recipient_name: recipientUser.account_holder_name,
          payment_method: 'ICAN_WALLET',
          transaction_id: transactionId,
          description: description || `Transfer to ${recipientUser.account_holder_name}`,
          status: 'completed',
          created_at: new Date().toISOString(),
          metadata: {
            fee: transactionFee,
            total_deduction: totalDeduction
          }
        }]);

      if (txError) console.warn('Transaction record error:', txError);

      // Refresh balances
      if (currentUserId) {
        await loadWalletBalances(currentUserId);
      }

      setTransactionResult({
        type: 'send',
        success: true,
        message: `✅ Successfully sent ${parsedAmount} ${selectedCurrency} to ${recipientUser.account_holder_name}${transactionFee > 0 ? ` (Fee: ${transactionFee.toFixed(2)})` : ''}`,
        amount: parsedAmount,
        recipient: recipientUser.account_holder_name,
        transactionId: transactionId,
        fee: transactionFee
      });

      console.log('💸 ICAN transfer completed:', {
        transactionId,
        amount: parsedAmount,
        recipient: recipientUser.account_holder_name,
        fee: transactionFee
      });
    } catch (error) {
      console.error('❌ ICAN transfer failed:', error);
      setTransactionResult({
        type: 'send',
        success: false,
        message: 'Transfer to ICAN wallet user failed.',
        error: error.message
      });
    }
  };

  // 💳 Send via MOMO
  const handleSendViaMOMO = async (phoneNumber, amount, description) => {
    try {
      // Check sender's balance first
      if (parseFloat(amount) > parseFloat(currentWallet.balance)) {
        setTransactionResult({
          type: 'send',
          success: false,
          message: `Insufficient balance. You have ${currentWallet.balance} ${currentWallet.currency}`
        });
        return;
      }

      // Deduct from sender's wallet first
      const supabase = getSupabaseClient();
      
      // CRITICAL: Check authentication BEFORE querying wallet_accounts
      const { data: { user: authUser }, error: authError } = await supabase.auth.getUser();
      if (authError || !authUser) {
        throw new Error('User not authenticated');
      }

      const { data: senderWallet } = await supabase
        .from('wallet_accounts')
        .select('id, balance')
        .eq('user_id', currentUserId)
        .eq('currency', selectedCurrency)
        .single();

      if (!senderWallet) {
        setTransactionResult({
          type: 'send',
          success: false,
          message: 'Wallet account not found'
        });
        return;
      }

      // Deduct from sender's balance
      const { error: deductError } = await supabase
        .from('wallet_accounts')
        .update({
          balance: parseFloat(senderWallet.balance) - parseFloat(amount),
          updated_at: new Date().toISOString()
        })
        .eq('id', senderWallet.id);

      if (deductError) throw deductError;

      // Process MOMO payment
      const result = await momoService.processTransfer({
        amount: amount,
        currency: selectedCurrency,
        recipientPhone: phoneNumber,
        description: description || `Send to ${phoneNumber}`
      });

      if (result.success) {
        // Save transaction to Supabase
        await walletTransactionService.initialize();
        await walletTransactionService.saveSend({
          amount: amount,
          currency: selectedCurrency,
          recipientPhone: phoneNumber,
          paymentMethod: 'MOMO',
          transactionId: result.transactionId,
          memoKey: result.activeKey,
          mode: result.mode,
          description: description
        });

        // Refresh wallet balances
        if (currentUserId) {
          await loadWalletBalances(currentUserId);
        }

        setTransactionResult({
          type: 'send',
          success: true,
          message: `✅ Successfully sent ${amount} ${selectedCurrency} to ${phoneNumber}`,
          amount: amount,
          recipient: phoneNumber,
          transactionId: result.transactionId
        });

        console.log('💸 MOMO transfer completed:', result.transactionId);
      } else {
        // Refund to sender if MOMO failed
        await supabase
          .from('wallet_accounts')
          .update({
            balance: parseFloat(senderWallet.balance),
            updated_at: new Date().toISOString()
          })
          .eq('id', senderWallet.id);

        setTransactionResult({
          type: 'send',
          success: false,
          message: result.message || 'MOMO transfer failed. Balance refunded.',
          error: result.error
        });
      }
    } catch (error) {
      console.error('❌ MOMO transfer failed:', error);
      
      // Refund on error
      try {
        const supabase = getSupabaseClient();
        
        // CRITICAL: Check authentication BEFORE querying wallet_accounts
        const { data: { user: authUser }, error: authError } = await supabase.auth.getUser();
        if (!authError && authUser) {
          const { data: senderWallet } = await supabase
            .from('wallet_accounts')
            .select('id')
            .eq('user_id', currentUserId)
            .eq('currency', selectedCurrency)
            .single();

          if (senderWallet) {
            // Reload current balance and refund
            await loadWalletBalances(currentUserId);
          }
        }
      } catch (e) {
        console.warn('⚠️ Could not refund:', e);
      }

      setTransactionResult({
        type: 'send',
        success: false,
        message: 'An error occurred during MOMO transfer.',
        error: error.message
      });
    }
  };

  // 📥 RECEIVE MONEY HANDLER
  const handleReceiveMoney = async (e) => {
    e.preventDefault();
    if (!receiveForm.amount) {
      alert('Please enter an amount');
      return;
    }
    
    setTransactionInProgress(true);
    
    try {
      // Generate payment link/reference
      const paymentRef = `PAY-${Date.now()}`;
      const paymentLink = `pay.ican.io/${paymentRef}`;

      // Initialize wallet service and save receive request
      await walletTransactionService.initialize();
      const saveResult = await walletTransactionService.saveReceive({
        amount: receiveForm.amount,
        currency: selectedCurrency,
        senderPhone: 'pending', // Will be filled when actual payment comes in
        paymentMethod: 'MOMO',
        transactionId: paymentRef,
        mode: 'LIVE',
        description: receiveForm.description || 'Payment request'
      });

      setTransactionResult({
        type: 'receive',
        success: true,
        message: `✅ Payment link ready! Share this with the sender: ${paymentLink}`,
        amount: receiveForm.amount,
        paymentLink: paymentLink,
        paymentRef: paymentRef,
        saved: saveResult.success
      });
    } catch (error) {
      console.error('❌ Receive error:', error);
      setTransactionResult({
        type: 'receive',
        success: false,
        message: 'An error occurred. Please try again.',
        error: error.message
      });
    }
    
    setReceiveForm({ amount: '', description: '' });
    setTransactionInProgress(false);
    
    // Auto close after 3 seconds
    setTimeout(() => {
      setActiveModal(null);
      setTransactionResult(null);
    }, 3000);
  };

  // 💰 TOP UP HANDLER - MAGIC PAYMENT ROUTING
  const handleTopUp = async (e) => {
    e.preventDefault();
    if (!topupForm.amount || !topupForm.paymentInput) {
      alert('Please enter amount and payment details');
      return;
    }

    // Validate detected method
    if (!detectedPaymentMethod) {
      alert('Could not recognize payment method. Please check your input.');
      return;
    }

    setTransactionInProgress(true);

    try {
      let result;
      const { method, name, type, provider } = detectedPaymentMethod;

      console.log(`\n✨ MAGIC PAYMENT ROUTING ✨`);
      console.log(`📌 Method: ${name} ${detectedPaymentMethod.icon}`);
      console.log(`📌 Type: ${type}`);
      console.log(`📌 Provider: ${provider || 'N/A'}`);

      // Route to appropriate service based on detected method
      if (method === 'mtn' || method === 'vodafone') {
        // MTN/Vodafone → MOMO Service
        result = await momoService.processTopUp({
          amount: topupForm.amount,
          currency: selectedCurrency,
          phoneNumber: topupForm.paymentInput,
          description: `ICAN Wallet Top-Up via ${name}`
        });
      } else if (method === 'airtel') {
        // Airtel Money
        result = await airtelMoneyService.sendMoney({
          amount: topupForm.amount,
          currency: selectedCurrency,
          recipientPhone: topupForm.paymentInput,
          description: `ICAN Wallet Top-Up via Airtel Money`
        });
      } else if (['visa', 'mastercard', 'verve'].includes(method)) {
        // Credit/Debit Card → Flutterwave
        console.log(`💳 Processing ${name} payment via Flutterwave`);
        
        // Initialize Flutterwave SDK if not already done
        await flutterwaveService.constructor.initializeSDK();
        
        result = await flutterwaveService.processCardPayment({
          amount: topupForm.amount,
          currency: selectedCurrency,
          customerEmail: 'user@ican.io', // Get from user context
          customerName: 'ICAN Customer',
          customerPhone: '',
          description: `ICAN Wallet Top-Up via ${name}`
        });
      } else if (method === 'ussd' || method === 'bank') {
        // USSD / Bank Transfer → Flutterwave
        result = await flutterwaveService.processCardPayment({
          amount: topupForm.amount,
          currency: selectedCurrency,
          customerEmail: 'user@ican.io',
          customerName: 'ICAN Customer',
          description: `ICAN Wallet Top-Up via ${name}`
        });
      }

      if (result.success) {
        // Save transaction to appropriate service
        if (['visa', 'mastercard', 'verve'].includes(method)) {
          // Card payment
          await cardTransactionService.initialize();
          await cardTransactionService.saveCardPayment({
            amount: topupForm.amount,
            currency: selectedCurrency,
            paymentMethod: name,
            customerEmail: 'user@ican.io',
            customerName: 'ICAN Customer',
            status: 'COMPLETED',
            verificationStatus: 'VERIFIED'
          });
        } else {
          // Mobile money payment
          await walletTransactionService.initialize();
          await walletTransactionService.saveTopUp({
            amount: topupForm.amount,
            currency: selectedCurrency,
            phoneNumber: topupForm.paymentInput,
            paymentMethod: name,
            transactionId: result.transactionId,
            memoKey: result.activeKey,
            mode: result.mode
          });
        }

        // Refresh wallet balances
        if (currentUserId) {
          await loadWalletBalances(currentUserId);
        }

        setTransactionResult({
          type: 'topup',
          success: true,
          message: result.message,
          amount: topupForm.amount,
          method: name,
          icon: detectedPaymentMethod.icon,
          transactionId: result.transactionId,
          status: result.status,
          saved: true
        });
      } else {
        setTransactionResult({
          type: 'topup',
          success: false,
          message: result.message || `${name} payment failed. Please try again.`,
          error: result.error,
          method: name
        });
      }
    } catch (error) {
      console.error('❌ Top-Up error:', error);
      setTransactionResult({
        type: 'topup',
        success: false,
        message: 'An error occurred during payment. Please try again.',
        error: error.message
      });
    }
    
    setTopupForm({ amount: '', paymentInput: '', method: null, detectedMethod: null });
    setDetectedPaymentMethod(null);
    setTransactionInProgress(false);
    
    // Auto close after 3 seconds
    setTimeout(() => {
      setActiveModal(null);
      setTransactionResult(null);
    }, 3000);
  };

  // 🏪 AGENT REGISTRATION HANDLER
  const handleAgentRegistration = async (e) => {
    e.preventDefault();
    setRegistrationLoading(true);
    setRegistrationMessage(null);

    try {
      // Validate form
      if (!agentRegistrationForm.agentName || !agentRegistrationForm.phoneNumber || !agentRegistrationForm.locationCity) {
        setRegistrationMessage({
          type: 'error',
          text: 'Please fill in all required fields'
        });
        setRegistrationLoading(false);
        return;
      }

      // Generate agent code
      const agentCode = `AGENT-${agentRegistrationForm.locationCity.toUpperCase().slice(0, 3)}-${Date.now().toString().slice(-4)}`;
      
      // Generate unique agent ID (like wallet account number format)
      const agentId = `ICAN-AGENT-${Date.now().toString().slice(-8)}${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

      // Get current user
      const { data: { user } } = await agentService.supabase?.auth.getUser() || {};
      if (!user) {
        setRegistrationMessage({
          type: 'error',
          text: 'You must be logged in to create an agent account'
        });
        setRegistrationLoading(false);
        return;
      }

      // Create agent record in database
      const { data: newAgent, error: agentError } = await agentService.supabase
        .from('agents')
        .insert([{
          user_id: user.id,
          agent_name: agentRegistrationForm.agentName,
          agent_code: agentCode,
          agent_id: agentId,
          phone_number: agentRegistrationForm.phoneNumber,
          location_city: agentRegistrationForm.locationCity,
          location_name: agentRegistrationForm.locationName,
          status: 'active',
          is_verified: false,
          withdrawal_commission_percentage: 2.5,
          deposit_commission_percentage: 0,
          fx_margin_percentage: 1.5
        }])
        .select();

      if (agentError) throw agentError;

      // Initialize float accounts (USD and UGX)
      const { error: floatUSDError } = await agentService.supabase
        .from('agent_floats')
        .insert([{
          agent_id: newAgent[0].id,
          currency: 'USD',
          current_balance: 0
        }]);

      const { error: floatUGXError } = await agentService.supabase
        .from('agent_floats')
        .insert([{
          agent_id: newAgent[0].id,
          currency: 'UGX',
          current_balance: 0
        }]);

      if (floatUSDError || floatUGXError) {
        throw new Error('Failed to initialize float accounts');
      }

      // Success!
      setRegistrationMessage({
        type: 'success',
        text: `✅ Agent account created! Your Agent ID: ${agentId}`
      });

      // Reset form
      setAgentRegistrationForm({
        agentName: '',
        phoneNumber: '',
        locationCity: '',
        locationName: ''
      });

      // Close registration and refresh agent status
      setTimeout(async () => {
        setShowAgentRegistration(false);
        const agentStatus = await agentService.isUserAgent();
        setIsAgent(agentStatus.isAgent);
      }, 2000);

    } catch (error) {
      console.error('❌ Agent registration failed:', error);
      setRegistrationMessage({
        type: 'error',
        text: `Registration failed: ${error.message}`
      });
    } finally {
      setRegistrationLoading(false);
    }
  };

  // 🎯 WALLET ACCOUNT CREATION HANDLER
  const handleCreateAccount = async (e) => {
    e.preventDefault();
    setAccountCreationLoading(true);
    setAccountMessage(null);

    try {
      // Validate form
      if (!accountCreationForm.accountHolderName || !accountCreationForm.phoneNumber || !accountCreationForm.email || !accountCreationForm.pin) {
        setAccountMessage({
          type: 'error',
          text: 'Please fill in all required fields including PIN'
        });
        setAccountCreationLoading(false);
        return;
      }

      // Validate PIN
      if (!walletAccountService.validatePIN(accountCreationForm.pin)) {
        setAccountMessage({
          type: 'error',
          text: 'PIN must be 4-6 digits'
        });
        setAccountCreationLoading(false);
        return;
      }

      // Get current user
      const supabase = getSupabaseClient();
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        setAccountMessage({
          type: 'error',
          text: 'You must be logged in to create a wallet account'
        });
        setAccountCreationLoading(false);
        return;
      }

      // Create account
      const result = await walletAccountService.createUserAccount({
        userId: user.id,
        accountHolderName: accountCreationForm.accountHolderName,
        phoneNumber: accountCreationForm.phoneNumber,
        email: accountCreationForm.email,
        pin: accountCreationForm.pin,
        preferredCurrency: accountCreationForm.preferredCurrency,
        biometrics: {
          fingerprintEnabled: accountCreationForm.fingerprintEnabled || false,
          phonePhoneEnabled: accountCreationForm.phonePhoneEnabled || false
        }
      });

      if (!result.success) {
        setAccountMessage({
          type: 'error',
          text: `Account creation failed: ${result.error}`
        });
        setAccountCreationLoading(false);
        return;
      }

      // Success!
      setAccountMessage({
        type: 'success',
        text: `✅ Wallet account created! Account #: ${result.account.account_number}`
      });

      // Set user account
      setUserAccount(result.account);

      // Reset form
      setAccountCreationForm({
        accountHolderName: '',
        phoneNumber: '',
        email: '',
        pin: '',
        preferredCurrency: 'USD',
        fingerprintEnabled: false,
        phonePhoneEnabled: false
      });

      // Close modal after success
      setTimeout(() => {
        setShowAccountCreation(false);
      }, 2000);

    } catch (error) {
      console.error('❌ Account creation failed:', error);
      setAccountMessage({
        type: 'error',
        text: `Account creation failed: ${error.message}`
      });
    } finally {
      setAccountCreationLoading(false);
    }
  };

  // 🎯 WALLET ACCOUNT EDIT HANDLER
  const handleSendPhoneOtp = async () => {
    setAccountEditLoading(true);
    try {
      const supabase = getSupabaseClient();
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        setAccountMessage({
          type: 'error',
          text: 'Authentication required'
        });
        setAccountEditLoading(false);
        return;
      }

      // Call backend to send OTP to phone
      const response = await fetch('/api/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          phoneNumber: accountEditForm.phoneNumber,
          type: 'pin_change'
        })
      });

      // Handle non-JSON responses
      if (!response.ok) {
        const contentType = response.headers.get('content-type');
        let errorMessage = 'Failed to send OTP';
        
        if (contentType && contentType.includes('application/json')) {
          const data = await response.json();
          errorMessage = data.error || errorMessage;
        } else {
          errorMessage = `Server error (${response.status})`;
        }
        
        throw new Error(errorMessage);
      }

      const data = await response.json();

      setAccountMessage({
        type: 'success',
        text: '✅ OTP sent to your phone! Check SMS within 5 minutes'
      });
      setShowPhoneOtpSection(true);
    } catch (error) {
      console.error('❌ OTP send failed:', error);
      setAccountMessage({
        type: 'error',
        text: `Failed to send OTP: ${error.message}`
      });
    } finally {
      setAccountEditLoading(false);
    }
  };

  const handleVerifyPhoneOtp = async () => {
    if (!accountEditForm.phoneOtp) {
      setAccountMessage({
        type: 'error',
        text: 'Please enter the OTP from your SMS'
      });
      return;
    }

    if (accountEditForm.newPin !== accountEditForm.confirmNewPin) {
      setAccountMessage({
        type: 'error',
        text: 'New PINs do not match'
      });
      return;
    }

    if (accountEditForm.newPin.length < 4) {
      setAccountMessage({
        type: 'error',
        text: 'PIN must be at least 4 digits'
      });
      return;
    }

    setAccountEditLoading(true);
    try {
      const supabase = getSupabaseClient();
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        setAccountMessage({
          type: 'error',
          text: 'Authentication required'
        });
        return;
      }

      // Verify OTP and change PIN
      const response = await fetch('/api/auth/verify-otp-and-change-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          otp: accountEditForm.phoneOtp,
          newPin: accountEditForm.newPin
        })
      });

      // Handle non-JSON responses
      if (!response.ok) {
        const contentType = response.headers.get('content-type');
        let errorMessage = 'OTP verification failed';
        
        if (contentType && contentType.includes('application/json')) {
          const data = await response.json();
          errorMessage = data.error || errorMessage;
        } else {
          errorMessage = `Server error (${response.status})`;
        }
        
        throw new Error(errorMessage);
      }

      const data = await response.json();

      setAccountMessage({
        type: 'success',
        text: '✅ PIN changed successfully!'
      });

      // Reset PIN section
      setTimeout(() => {
        setShowPinChangeSection(false);
        setShowPhoneOtpSection(false);
        setAccountEditForm(prev => ({
          ...prev,
          currentPin: '',
          newPin: '',
          confirmNewPin: '',
          phoneOtp: ''
        }));
      }, 1500);

    } catch (error) {
      console.error('❌ PIN change failed:', error);
      setAccountMessage({
        type: 'error',
        text: `PIN change failed: ${error.message}`
      });
    } finally {
      setAccountEditLoading(false);
    }
  };

  const handleEditAccount = async (e) => {
    e.preventDefault();
    setAccountEditLoading(true);
    setAccountMessage(null);

    try {
      // Validate form
      if (!accountEditForm.accountHolderName || !accountEditForm.phoneNumber || !accountEditForm.email) {
        setAccountMessage({
          type: 'error',
          text: 'Please fill in all required fields'
        });
        setAccountEditLoading(false);
        return;
      }

      // Get current user
      const supabase = getSupabaseClient();
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        setAccountMessage({
          type: 'error',
          text: 'You must be logged in to edit account'
        });
        setAccountEditLoading(false);
        return;
      }

      // Update account
      const result = await walletAccountService.updateUserAccount(user.id, {
        accountHolderName: accountEditForm.accountHolderName,
        phoneNumber: accountEditForm.phoneNumber,
        email: accountEditForm.email,
        preferredCurrency: accountEditForm.preferredCurrency
      });

      if (!result.success) {
        setAccountMessage({
          type: 'error',
          text: `Update failed: ${result.error}`
        });
        setAccountEditLoading(false);
        return;
      }

      // Success!
      setAccountMessage({
        type: 'success',
        text: '✅ Account updated successfully!'
      });

      // Update user account state
      setUserAccount(result.account);

      // Close modal after success
      setTimeout(() => {
        setShowAccountEdit(false);
      }, 1500);

    } catch (error) {
      console.error('❌ Account edit failed:', error);
      setAccountMessage({
        type: 'error',
        text: `Update failed: ${error.message}`
      });
    } finally {
      setAccountEditLoading(false);
    }
  };

  const handleAddCard = async (e) => {
    e.preventDefault();
    setCardFormLoading(true);
    setCardMessage(null);

    try {
      // Validate form
      if (!cardForm.cardholderName || !cardForm.cardNumber || !cardForm.expiryMonth || !cardForm.expiryYear || !cardForm.cvv) {
        setCardMessage({
          type: 'error',
          text: 'Please fill in all required fields'
        });
        setCardFormLoading(false);
        return;
      }

      // Validate card number (basic validation - 13-19 digits)
      const cardNumberCleaned = cardForm.cardNumber.replace(/\s/g, '');
      if (!/^\d{13,19}$/.test(cardNumberCleaned)) {
        setCardMessage({
          type: 'error',
          text: 'Invalid card number'
        });
        setCardFormLoading(false);
        return;
      }

      // Validate CVV (3-4 digits)
      if (!/^\d{3,4}$/.test(cardForm.cvv)) {
        setCardMessage({
          type: 'error',
          text: 'Invalid CVV'
        });
        setCardFormLoading(false);
        return;
      }

      // Validate expiry
      const currentYear = new Date().getFullYear();
      const expYear = parseInt(cardForm.expiryYear);
      if (expYear < currentYear) {
        setCardMessage({
          type: 'error',
          text: 'Card has expired'
        });
        setCardFormLoading(false);
        return;
      }

      // Create new card object (masked for security)
      const lastFourDigits = cardNumberCleaned.slice(-4);
      const newCard = {
        id: Math.random().toString(36).substr(2, 9),
        cardholderName: cardForm.cardholderName,
        cardNumberMasked: `•••• •••• •••• ${lastFourDigits}`,
        lastFourDigits: lastFourDigits,
        expiryDate: `${cardForm.expiryMonth}/${cardForm.expiryYear}`,
        cardType: cardForm.cardType,
        isPrimary: paymentCards.length === 0,
        addedAt: new Date().toLocaleDateString(),
        status: 'active'
      };

      // Add card to list
      setPaymentCards([...paymentCards, newCard]);

      setCardMessage({
        type: 'success',
        text: `✅ ${cardForm.cardType === 'credit' ? 'Credit' : 'Debit'} card added successfully!`
      });

      // Reset form
      setTimeout(() => {
        setCardForm({
          cardholderName: '',
          cardNumber: '',
          expiryMonth: '',
          expiryYear: '',
          cvv: '',
          cardType: 'credit'
        });
        setShowAddCardModal(false);
      }, 1500);

    } catch (error) {
      console.error('❌ Failed to add card:', error);
      setCardMessage({
        type: 'error',
        text: `Failed to add card: ${error.message}`
      });
    } finally {
      setCardFormLoading(false);
    }
  };

  const handleRemoveCard = (cardId) => {
    const updatedCards = paymentCards.filter(card => card.id !== cardId);
    setPaymentCards(updatedCards);
    setCardMessage({
      type: 'success',
      text: '✅ Card removed successfully'
    });
  };

  const handleSetPrimaryCard = (cardId) => {
    const updatedCards = paymentCards.map(card => ({
      ...card,
      isPrimary: card.id === cardId
    }));
    setPaymentCards(updatedCards);
    setCardMessage({
      type: 'success',
      text: '✅ Primary payment card updated'
    });
  };

  // 💰 ===== UNIFIED TRANSACTION HANDLERS =====

  /**
   * Handle Deposit Transaction
   * Both agents and users can initiate deposits
   * - User deposit: Money added to wallet (from agent or mobile money)
   * - Agent deposit: Money received from user
   */
  const handleUnifiedDeposit = async (amount, sourceType, sourceDetails) => {
    try {
      setTransactionInProgress(true);
      const supabase = getSupabaseClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        setTransactionResult({
          success: false,
          message: 'Authentication required'
        });
        return;
      }

      // Create transaction record
      const transaction = {
        id: Math.random().toString(36).substr(2, 9),
        userId: user.id,
        type: 'deposit',
        amount: parseFloat(amount),
        sourceType: sourceType, // 'agent', 'momo', 'card'
        sourceDetails: sourceDetails,
        initiator: transactionInitiator, // 'user' or 'agent'
        status: 'completed',
        timestamp: new Date().toISOString(),
        date: new Date().toLocaleDateString()
      };

      // Add to transaction history
      setTransactionHistory([transaction, ...transactionHistory]);

      // Refresh wallet balances from database
      if (currentUserId) {
        await loadWalletBalances(currentUserId);
      }

      setTransactionResult({
        success: true,
        message: `✅ Deposit successful! +${amount} ${currentWallet.currency}`,
        transaction: transaction
      });

      console.log('💰 Deposit completed:', transaction);

    } catch (error) {
      console.error('❌ Deposit failed:', error);
      setTransactionResult({
        success: false,
        message: `Deposit failed: ${error.message}`
      });
    } finally {
      setTransactionInProgress(false);
    }
  };

  /**
   * Handle Withdraw Transaction
   * Both agents and users can initiate withdrawals
   * - User withdraw: Money sent from wallet (to agent or mobile money)
   * - Agent withdraw: Money sent by agent to user/wallet
   */
  const handleUnifiedWithdraw = async (amount, destinationType, destinationDetails) => {
    try {
      setTransactionInProgress(true);
      const supabase = getSupabaseClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        setTransactionResult({
          success: false,
          message: 'Authentication required'
        });
        return;
      }

      // Check sufficient balance
      if (parseFloat(amount) > parseFloat(currentWallet.balance)) {
        setTransactionResult({
          success: false,
          message: `Insufficient balance. You have ${currentWallet.balance} ${currentWallet.currency}`
        });
        setTransactionInProgress(false);
        return;
      }

      // Create transaction record
      const transaction = {
        id: Math.random().toString(36).substr(2, 9),
        userId: user.id,
        type: 'withdraw',
        amount: parseFloat(amount),
        destinationType: destinationType, // 'agent', 'momo', 'bank'
        destinationDetails: destinationDetails,
        initiator: transactionInitiator, // 'user' or 'agent'
        status: 'completed',
        timestamp: new Date().toISOString(),
        date: new Date().toLocaleDateString()
      };

      // Add to transaction history
      setTransactionHistory([transaction, ...transactionHistory]);

      // Refresh wallet balances from database
      if (currentUserId) {
        await loadWalletBalances(currentUserId);
      }

      setTransactionResult({
        success: true,
        message: `✅ Withdrawal successful! -${amount} ${currentWallet.currency}`,
        transaction: transaction
      });

      console.log('💸 Withdrawal completed:', transaction);

    } catch (error) {
      console.error('❌ Withdrawal failed:', error);
      setTransactionResult({
        success: false,
        message: `Withdrawal failed: ${error.message}`
      });
    } finally {
      setTransactionInProgress(false);
    }
  };

  /**
   * Agent Cash-In (Deposit)
   * Agent receives money, deposits to user wallet
   */
  const handleAgentCashIn = async (amount, userId, userDetails) => {
    setTransactionInitiator('agent');
    await handleUnifiedDeposit(amount, 'agent', {
      agentId: agentService.agentId,
      agentName: agentAccount?.agent_name || 'Agent',
      userId: userId,
      userDetails: userDetails
    });
    setTransactionInitiator('user');
  };

  /**
   * Agent Cash-Out (Withdraw)
   * Agent sends money from wallet
   */
  const handleAgentCashOut = async (amount, commissionPercentage = 2.5) => {
    const commission = (parseFloat(amount) * commissionPercentage) / 100;
    const netAmount = parseFloat(amount) - commission;

    setTransactionInitiator('agent');
    await handleUnifiedWithdraw(amount, 'agent', {
      agentId: agentService.agentId,
      agentName: agentAccount?.agent_name || 'Agent',
      commission: commission,
      commissionPercentage: commissionPercentage,
      netAmount: netAmount
    });
    setTransactionInitiator('user');
  };

  /**
   * User Deposit from Agent
   * User initiates deposit from selected agent
   */
  const handleUserDepositFromAgent = async (amount, agentId, agentName) => {
    setTransactionInitiator('user');
    await handleUnifiedDeposit(amount, 'agent', {
      agentId: agentId,
      agentName: agentName
    });
  };

  /**
   * User Withdraw to Agent
   * User initiates withdrawal to selected agent
   */
  const handleUserWithdrawToAgent = async (amount, agentId, agentName) => {
    setTransactionInitiator('user');
    await handleUnifiedWithdraw(amount, 'agent', {
      agentId: agentId,
      agentName: agentName
    });
  };

  return (
    <div className="w-full space-y-6">{/* Header Card */}
      <div className="glass-card p-4 md:p-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-4">
          <div className="flex items-center gap-4">
            <div className="p-3 rounded-lg bg-gradient-to-br from-green-500/30 to-emerald-500/30 border border-green-400/50">
              <Wallet className="w-6 h-6 text-green-400" />
            </div>
            <div>
              <h2 className="text-2xl md:text-3xl font-bold text-white">ICAN Wallet</h2>
              <p className="text-sm md:text-base text-gray-300">Your mobile money platform with multi-currency support</p>
            </div>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setActiveTab('overview')}
            className={`px-4 py-2 rounded-lg flex items-center gap-2 transition-all ${
              activeTab === 'overview'
                ? 'bg-gradient-to-r from-green-500 to-emerald-500 text-white shadow-lg shadow-green-500/30'
                : 'bg-white/5 text-gray-300 hover:bg-white/10'
            }`}
          >
            <Wallet className="w-4 h-4" />
            Overview
          </button>
          <button
            onClick={() => setActiveTab('transactions')}
            className={`px-4 py-2 rounded-lg flex items-center gap-2 transition-all ${
              activeTab === 'transactions'
                ? 'bg-gradient-to-r from-blue-500 to-cyan-500 text-white shadow-lg shadow-blue-500/30'
                : 'bg-white/5 text-gray-300 hover:bg-white/10'
            }`}
          >
            <History className="w-4 h-4" />
            Transactions
          </button>
          <button
            onClick={() => setActiveTab('deposit')}
            className={`px-4 py-2 rounded-lg flex items-center gap-2 transition-all ${
              activeTab === 'deposit'
                ? 'bg-gradient-to-r from-emerald-600 to-green-600 text-white shadow-lg shadow-emerald-500/30'
                : 'bg-white/5 text-gray-300 hover:bg-white/10'
            }`}
          >
            <Download className="w-4 h-4" />
            Deposit
          </button>
          <button
            onClick={() => setActiveTab('withdraw')}
            className={`px-4 py-2 rounded-lg flex items-center gap-2 transition-all ${
              activeTab === 'withdraw'
                ? 'bg-gradient-to-r from-red-600 to-pink-600 text-white shadow-lg shadow-red-500/30'
                : 'bg-white/5 text-gray-300 hover:bg-white/10'
            }`}
          >
            <Upload className="w-4 h-4" />
            Withdraw
          </button>
          {/* AGENT TERMINAL TAB - Only if user is an agent */}
          {!agentCheckLoading && isAgent ? (
            <button
              onClick={() => setActiveTab('agent')}
              className={`px-4 py-2 rounded-lg flex items-center gap-2 transition-all ${
                activeTab === 'agent'
                  ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-lg shadow-purple-500/30'
                  : 'bg-white/5 text-gray-300 hover:bg-white/10'
              }`}
            >
              <Store className="w-4 h-4" />
              🏪 Agent Terminal
            </button>
          ) : !agentCheckLoading && !isAgent ? (
            <button
              onClick={() => setActiveTab('agent')}
              title="Click to create an agent account"
              className="px-4 py-2 rounded-lg flex items-center gap-2 bg-white/5 text-gray-300 hover:bg-white/10 hover:text-white transition-all cursor-pointer"
            >
              <Lock className="w-4 h-4" />
              🔒 Agent (Locked)
            </button>
          ) : null}
          <button
            onClick={() => setActiveTab('cards')}
            className={`px-4 py-2 rounded-lg flex items-center gap-2 transition-all ${
              activeTab === 'cards'
                ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white shadow-lg shadow-purple-500/30'
                : 'bg-white/5 text-gray-300 hover:bg-white/10'
            }`}
          >
            <CreditCard className="w-4 h-4" />
            Cards
          </button>
          <button
            onClick={() => setActiveTab('settings')}
            className={`px-4 py-2 rounded-lg flex items-center gap-2 transition-all ${
              activeTab === 'settings'
                ? 'bg-gradient-to-r from-orange-500 to-red-500 text-white shadow-lg shadow-orange-500/30'
                : 'bg-white/5 text-gray-300 hover:bg-white/10'
            }`}
          >
            <Settings className="w-4 h-4" />
            Settings
          </button>
        </div>
      </div>

      {/* Overview Tab */}
      {activeTab === 'overview' && (
      <div className="space-y-6">
        {/* Balance Card */}
        <div className="glass-card p-6 bg-gradient-to-br from-green-900/40 to-emerald-900/40 border border-green-500/30">
          <div className="mb-6">
            <p className="text-gray-300 mb-2 text-sm font-medium">Total Balance</p>
            <div className="flex items-center gap-4 mb-6">
              <div className="text-5xl font-bold text-white">
                {showBalance ? `${currentWallet.flag} ${currentWallet.balance.toLocaleString()}` : '••••••••'}
              </div>
              <button
                onClick={() => setShowBalance(!showBalance)}
                className="p-3 rounded-lg bg-white/10 hover:bg-white/20 transition-all border border-white/10"
              >
                {showBalance ? <Eye className="w-5 h-5 text-gray-300" /> : <EyeOff className="w-5 h-5 text-gray-300" />}
              </button>
            </div>
            <p className="text-green-400 text-lg font-semibold">{currentWallet.currency}</p>
          </div>

          {/* Action Buttons */}
          <div className="grid grid-cols-3 gap-3">
            <button 
              onClick={() => setActiveModal('send')}
              className="bg-gradient-to-br from-blue-500/30 to-blue-600/30 border border-blue-400/50 hover:border-blue-400/80 rounded-lg py-3 px-4 flex flex-col items-center gap-2 transition-all"
            >
              <Send className="w-5 h-5 text-blue-400" />
              <span className="text-sm font-medium text-white">Send</span>
            </button>
            <button 
              onClick={() => setActiveModal('receive')}
              className="bg-gradient-to-br from-cyan-500/30 to-cyan-600/30 border border-cyan-400/50 hover:border-cyan-400/80 rounded-lg py-3 px-4 flex flex-col items-center gap-2 transition-all"
            >
              <ArrowDownLeft className="w-5 h-5 text-cyan-400" />
              <span className="text-sm font-medium text-white">Receive</span>
            </button>
            <button 
              onClick={() => setActiveModal('topup')}
              className="bg-gradient-to-br from-green-500/30 to-green-600/30 border border-green-400/50 hover:border-green-400/80 rounded-lg py-3 px-4 flex flex-col items-center gap-2 transition-all"
            >
              <Plus className="w-5 h-5 text-green-400" />
              <span className="text-sm font-medium text-white">Top Up</span>
            </button>
          </div>
        </div>

        {/* 🎯 ACCOUNT INFO CARD */}
        {userAccount && (
          <div className="glass-card p-6 border border-purple-500/30">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                💳 Account Information
              </h3>
              <button
                onClick={() => {
                  setAccountEditForm({
                    accountHolderName: userAccount.account_holder_name,
                    phoneNumber: userAccount.phone_number,
                    email: userAccount.email,
                    preferredCurrency: userAccount.preferred_currency
                  });
                  setShowAccountEdit(true);
                }}
                className="px-4 py-2 bg-purple-600/30 hover:bg-purple-600/50 text-purple-300 rounded-lg text-sm font-medium transition-all border border-purple-500/30"
              >
                ✏️ Edit
              </button>
            </div>
            <div className="space-y-3">
              {/* Account Number */}
              <div className="bg-slate-700/50 rounded-lg p-4 border border-purple-500/20">
                <p className="text-gray-400 text-sm mb-1">Account Number</p>
                <div className="flex items-center justify-between">
                  <p className="text-white font-mono text-lg font-bold">{userAccount.account_number}</p>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(userAccount.account_number);
                      alert('Account number copied!');
                    }}
                    className="px-3 py-1 bg-purple-500/30 hover:bg-purple-500/50 text-purple-300 rounded text-sm transition-all"
                  >
                    📋 Copy
                  </button>
                </div>
              </div>

              {/* Account Holder */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-slate-700/50 rounded-lg p-3 border border-purple-500/20">
                  <p className="text-gray-400 text-xs mb-1">Account Holder</p>
                  <p className="text-white font-medium">{userAccount.account_holder_name}</p>
                </div>
                <div className="bg-slate-700/50 rounded-lg p-3 border border-purple-500/20">
                  <p className="text-gray-400 text-xs mb-1">Status</p>
                  <p className="text-green-400 font-medium">✓ {userAccount.status.toUpperCase()}</p>
                </div>
              </div>

              {/* Security Info */}
              <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
                <p className="text-blue-400 font-semibold mb-3 text-sm">🔐 Security Settings</p>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-gray-300">PIN Protection</span>
                    <span className="text-green-400 font-semibold">✓ Enabled</span>
                  </div>
                  {userAccount.fingerprint_enabled && (
                    <div className="flex items-center justify-between">
                      <span className="text-gray-300">Fingerprint</span>
                      <span className="text-green-400 font-semibold">✓ Enabled</span>
                    </div>
                  )}
                  {userAccount.phone_pin_enabled && (
                    <div className="flex items-center justify-between">
                      <span className="text-gray-300">Phone PIN</span>
                      <span className="text-green-400 font-semibold">✓ Enabled</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Balances */}
              <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4">
                <p className="text-green-400 font-semibold mb-3 text-sm">💰 Balances</p>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-gray-300">USD</span>
                    <span className="text-white font-semibold">${userAccount.usd_balance.toLocaleString()}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-300">UGX</span>
                    <span className="text-white font-semibold">UGX {userAccount.ugx_balance.toLocaleString()}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-300">KES</span>
                    <span className="text-white font-semibold">KES {userAccount.kes_balance.toLocaleString()}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Currency Selector */}
        <div className="glass-card p-6">
          <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <Globe className="w-5 h-5" />
            Select Currency
          </h3>
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setShowCurrencyDropdown(!showCurrencyDropdown)}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-lg bg-white/5 border border-white/10 hover:border-white/20 text-white transition-all"
            >
              <span className="text-3xl">{currentWallet.flag}</span>
              <div className="text-left flex-1">
                <p className="font-semibold text-white">{selectedCurrency}</p>
                <p className="text-sm text-gray-400">{currentWallet.country}</p>
              </div>
              <ChevronDown className={`w-5 h-5 text-gray-400 transition-transform ${showCurrencyDropdown ? 'rotate-180' : ''}`} />
            </button>

            {/* Dropdown Menu */}
            {showCurrencyDropdown && (
              <div className="absolute top-full left-0 mt-2 w-full bg-gradient-to-br from-slate-900 to-slate-800 border border-white/10 rounded-xl shadow-2xl z-50 max-h-96 overflow-y-auto">
                <div className="p-3 space-y-2">
                  {/* East Africa */}
                  <div>
                    <p className="text-gray-400 text-xs font-semibold px-3 py-2 uppercase">East Africa</p>
                    {['KES', 'UGX'].map((currency) => (
                      <button
                        key={currency}
                        onClick={() => {
                          setSelectedCurrency(currency);
                          setShowCurrencyDropdown(false);
                        }}
                        className={`w-full px-3 py-3 rounded-lg flex items-center gap-3 transition-all ${
                          selectedCurrency === currency
                            ? 'bg-green-500/30 text-green-400 border border-green-400/50'
                            : 'text-gray-300 hover:bg-white/5'
                        }`}
                      >
                        <span className="text-2xl">{walletData[currency].flag}</span>
                        <div className="text-left flex-1">
                          <p className="font-semibold">{currency}</p>
                          <p className="text-xs text-gray-400">{walletData[currency].country}</p>
                        </div>
                      </button>
                    ))}
                  </div>

                  {/* North America */}
                  <div>
                    <p className="text-gray-400 text-xs font-semibold px-3 py-2 uppercase mt-2">North America</p>
                    <button
                      onClick={() => {
                        setSelectedCurrency('USD');
                        setShowCurrencyDropdown(false);
                      }}
                      className={`w-full px-3 py-3 rounded-lg flex items-center gap-3 transition-all ${
                        selectedCurrency === 'USD'
                          ? 'bg-green-500/30 text-green-400 border border-green-400/50'
                          : 'text-gray-300 hover:bg-white/5'
                      }`}
                    >
                      <span className="text-2xl">🇺🇸</span>
                      <div className="text-left flex-1">
                        <p className="font-semibold">USD</p>
                        <p className="text-xs text-gray-400">United States</p>
                      </div>
                    </button>
                  </div>

                  {/* Europe */}
                  <div>
                    <p className="text-gray-400 text-xs font-semibold px-3 py-2 uppercase mt-2">Europe</p>
                    {['GBP', 'EUR'].map((currency) => (
                      <button
                        key={currency}
                        onClick={() => {
                          setSelectedCurrency(currency);
                          setShowCurrencyDropdown(false);
                        }}
                        className={`w-full px-3 py-3 rounded-lg flex items-center gap-3 transition-all ${
                          selectedCurrency === currency
                            ? 'bg-green-500/30 text-green-400 border border-green-400/50'
                            : 'text-gray-300 hover:bg-white/5'
                        }`}
                      >
                        <span className="text-2xl">{walletData[currency].flag}</span>
                        <div className="text-left flex-1">
                          <p className="font-semibold">{currency}</p>
                          <p className="text-xs text-gray-400">{walletData[currency].country}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      )}

      {/* Transactions Tab */}
      {activeTab === 'transactions' && (
      <div className="glass-card p-6">
        <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <History className="w-5 h-5" />
          Recent Transactions
        </h3>
        <div className="space-y-3">
          {currentWallet.transactions.map((tx) => (
            <div key={tx.id} className="flex items-center justify-between p-4 bg-white/5 rounded-lg border border-white/10 hover:border-white/20 transition-all">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg ${tx.type === 'send' ? 'bg-blue-500/20' : 'bg-green-500/20'}`}>
                  {tx.type === 'send' ? <ArrowUpRight className="w-4 h-4 text-blue-400" /> : <ArrowDownLeft className="w-4 h-4 text-green-400" />}
                </div>
                <div>
                  <p className="text-white font-medium">{tx.type === 'send' ? 'Sent to' : 'Received from'} {tx.type === 'send' ? tx.to : tx.from}</p>
                  <p className="text-xs text-gray-400">{tx.date}</p>
                </div>
              </div>
              <p className={`font-semibold ${tx.type === 'send' ? 'text-blue-400' : 'text-green-400'}`}>
                {tx.type === 'send' ? '-' : '+'}{tx.amount.toLocaleString()} {currentWallet.currency}
              </p>
            </div>
          ))}
        </div>
      </div>
      )}

      {/* Cards Tab */}
      {activeTab === 'cards' && (
      <div className="glass-card p-6">
        <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <CreditCard className="w-5 h-5" />
          Payment Cards
        </h3>

        {cardMessage && (
          <div className={`mb-4 p-4 rounded-lg border ${
            cardMessage.type === 'success' 
              ? 'bg-green-500/20 border-green-500/50 text-green-400' 
              : 'bg-red-500/20 border-red-500/50 text-red-400'
          }`}>
            {cardMessage.text}
          </div>
        )}

        {paymentCards.length > 0 ? (
          <div className="space-y-4 mb-4">
            {paymentCards.map((card) => (
              <div 
                key={card.id}
                className={`p-4 rounded-lg border transition-all ${
                  card.isPrimary
                    ? 'bg-gradient-to-br from-blue-500/20 to-blue-400/10 border-blue-500/50'
                    : 'bg-slate-700/50 border-slate-600/50 hover:border-blue-500/50'
                }`}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3 flex-1">
                    <div className={`p-2 rounded-lg ${
                      card.cardType === 'credit'
                        ? 'bg-blue-500/20'
                        : 'bg-purple-500/20'
                    }`}>
                      <CreditCard className={`w-5 h-5 ${
                        card.cardType === 'credit'
                          ? 'text-blue-400'
                          : 'text-purple-400'
                      }`} />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-white">{card.cardholderName}</p>
                      <p className="text-xs text-gray-400">{card.cardNumberMasked}</p>
                    </div>
                  </div>
                  {card.isPrimary && (
                    <span className="px-2 py-1 bg-blue-500/30 border border-blue-500/50 text-blue-300 text-xs rounded font-semibold">
                      Primary
                    </span>
                  )}
                </div>

                <div className="flex items-center justify-between text-xs text-gray-400 mb-3">
                  <span>Expires: {card.expiryDate}</span>
                  <span>{card.status === 'active' ? '✅ Active' : '⚠️ Inactive'}</span>
                </div>

                <div className="flex gap-2">
                  {!card.isPrimary && (
                    <button
                      onClick={() => handleSetPrimaryCard(card.id)}
                      className="flex-1 px-3 py-2 text-xs bg-blue-600/50 hover:bg-blue-600 text-blue-200 rounded transition-all"
                    >
                      Set as Primary
                    </button>
                  )}
                  <button
                    onClick={() => handleRemoveCard(card.id)}
                    className="flex-1 px-3 py-2 text-xs bg-red-600/50 hover:bg-red-600 text-red-200 rounded transition-all"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8">
            <CreditCard className="w-12 h-12 text-gray-400 mx-auto mb-3" />
            <p className="text-gray-300 mb-4">No cards linked yet</p>
          </div>
        )}

        <button 
          onClick={() => setShowAddCardModal(true)}
          className="w-full px-4 py-3 bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white rounded-lg font-semibold transition-all shadow-lg shadow-blue-500/30 flex items-center justify-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Add Payment Card
        </button>
      </div>
      )}

      {/* 🎯 ADD PAYMENT CARD MODAL */}
      {showAddCardModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="glass-card p-8 w-full max-w-md max-h-[90vh] overflow-y-auto">
            <h2 className="text-3xl font-bold text-white mb-2 flex items-center gap-2">
              💳 Add Payment Card
            </h2>
            <p className="text-gray-400 mb-6">Securely add a new payment method</p>

            {cardMessage && (
              <div className={`mb-6 p-4 rounded-lg border ${
                cardMessage.type === 'success' 
                  ? 'bg-green-500/20 border-green-500/50 text-green-400' 
                  : 'bg-red-500/20 border-red-500/50 text-red-400'
              }`}>
                {cardMessage.text}
              </div>
            )}

            <form onSubmit={handleAddCard} className="space-y-4">
              {/* Cardholder Name */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Cardholder Name</label>
                <input
                  type="text"
                  value={cardForm.cardholderName}
                  onChange={(e) => setCardForm({ ...cardForm, cardholderName: e.target.value })}
                  placeholder="John Doe"
                  className="w-full px-4 py-3 bg-slate-700/50 border border-blue-500/30 hover:border-blue-500/60 rounded-lg text-white placeholder-gray-400 focus:border-blue-500 focus:outline-none transition-all"
                />
              </div>

              {/* Card Number */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Card Number</label>
                <input
                  type="text"
                  value={cardForm.cardNumber}
                  onChange={(e) => {
                    let value = e.target.value.replace(/\s/g, '');
                    value = value.replace(/(\d{4})(?=\d)/g, '$1 ');
                    setCardForm({ ...cardForm, cardNumber: value });
                  }}
                  placeholder="1234 5678 9012 3456"
                  maxLength="19"
                  className="w-full px-4 py-3 bg-slate-700/50 border border-blue-500/30 hover:border-blue-500/60 rounded-lg text-white placeholder-gray-400 focus:border-blue-500 focus:outline-none transition-all font-mono"
                />
                <p className="text-xs text-gray-500 mt-1">Enter 13-19 digit card number</p>
              </div>

              {/* Card Type */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Card Type</label>
                <select
                  value={cardForm.cardType}
                  onChange={(e) => setCardForm({ ...cardForm, cardType: e.target.value })}
                  className="w-full px-4 py-3 bg-slate-700/50 border border-blue-500/30 hover:border-blue-500/60 rounded-lg text-white focus:border-blue-500 focus:outline-none transition-all cursor-pointer"
                >
                  <option value="credit">💳 Credit Card</option>
                  <option value="debit">🏦 Debit Card</option>
                </select>
              </div>

              {/* Expiry and CVV Row */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Month</label>
                  <select
                    value={cardForm.expiryMonth}
                    onChange={(e) => setCardForm({ ...cardForm, expiryMonth: e.target.value })}
                    className="w-full px-4 py-3 bg-slate-700/50 border border-blue-500/30 rounded-lg text-white focus:border-blue-500 focus:outline-none transition-all cursor-pointer"
                  >
                    <option value="">MM</option>
                    {Array.from({ length: 12 }, (_, i) => (
                      <option key={i + 1} value={String(i + 1).padStart(2, '0')}>
                        {String(i + 1).padStart(2, '0')}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Year</label>
                  <select
                    value={cardForm.expiryYear}
                    onChange={(e) => setCardForm({ ...cardForm, expiryYear: e.target.value })}
                    className="w-full px-4 py-3 bg-slate-700/50 border border-blue-500/30 rounded-lg text-white focus:border-blue-500 focus:outline-none transition-all cursor-pointer"
                  >
                    <option value="">YYYY</option>
                    {Array.from({ length: 20 }, (_, i) => {
                      const year = new Date().getFullYear() + i;
                      return (
                        <option key={year} value={year}>
                          {year}
                        </option>
                      );
                    })}
                  </select>
                </div>
              </div>

              {/* CVV */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">CVV</label>
                <input
                  type="password"
                  value={cardForm.cvv}
                  onChange={(e) => setCardForm({ ...cardForm, cvv: e.target.value.replace(/\D/g, '').slice(0, 4) })}
                  placeholder="•••"
                  maxLength="4"
                  className="w-full px-4 py-3 bg-slate-700/50 border border-blue-500/30 hover:border-blue-500/60 rounded-lg text-white placeholder-gray-400 focus:border-blue-500 focus:outline-none transition-all font-mono text-center text-lg letter-spacing-widest"
                />
                <p className="text-xs text-gray-500 mt-1">3-4 digits on back of card</p>
              </div>

              {/* Security Info */}
              <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3">
                <p className="text-xs text-blue-300">
                  🔒 Your card information is encrypted and secure. We never store full card details.
                </p>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowAddCardModal(false);
                    setCardForm({
                      cardholderName: '',
                      cardNumber: '',
                      expiryMonth: '',
                      expiryYear: '',
                      cvv: '',
                      cardType: 'credit'
                    });
                    setCardMessage(null);
                  }}
                  disabled={cardFormLoading}
                  className="flex-1 px-4 py-3 bg-slate-600/50 hover:bg-slate-600 text-white rounded-lg font-semibold transition-all disabled:opacity-50"
                >
                  ❌ Cancel
                </button>
                <button
                  type="submit"
                  disabled={cardFormLoading}
                  className="flex-1 px-4 py-3 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 text-white rounded-lg font-semibold transition-all shadow-lg shadow-blue-500/30 disabled:opacity-50"
                >
                  {cardFormLoading ? '⏳ Adding...' : '✅ Add Card'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Settings Tab - Compact Collapsible */}
      {activeTab === 'settings' && (
        <div className="space-y-4">
        {/* Compact Accounts Header with Toggle */}
        <div className="glass-card p-4 border border-orange-500/30 cursor-pointer hover:border-orange-500/60 transition-all" onClick={() => setShowSettingsPanel(!showSettingsPanel)}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-orange-500/30">
                <Settings className="w-5 h-5 text-orange-400" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-white">My Accounts</h3>
                <p className="text-gray-400 text-xs">
                  {userAccount && isAgent ? '2 accounts' : userAccount ? '1 account' : 'No accounts'}
                </p>
              </div>
            </div>
            <div className={`p-2 rounded-lg bg-white/10 transition-transform ${showSettingsPanel ? 'rotate-180' : ''}`}>
              <ChevronDown className="w-5 h-5 text-gray-300" />
            </div>
          </div>
        </div>

        {/* Expandable Accounts Panel */}
        {showSettingsPanel && (
          <div className="space-y-4">
            {/* Wallet Account Card - Compact */}
            {userAccount && (
            <div className="glass-card p-4 border border-purple-500/30 bg-gradient-to-br from-purple-900/20 to-slate-900/20">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3 flex-1">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center flex-shrink-0">
                    <span className="text-lg">💳</span>
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white truncate">{userAccount.account_holder_name}</p>
                    <p className="text-xs text-purple-400">Wallet Account</p>
                  </div>
                </div>
                <span className="px-2 py-1 rounded-full bg-green-500/30 text-green-400 font-semibold text-xs border border-green-500/50 flex-shrink-0">ACTIVE</span>
              </div>

              {/* Account Number - Clickable with Visibility Toggle */}
              <div className="bg-slate-700/50 rounded-lg p-3 mb-3 border border-purple-500/20 group">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-gray-400 text-xs">Account Number</p>
                  <button
                    onClick={() => setShowWalletAccountNumber(!showWalletAccountNumber)}
                    className="p-1 rounded hover:bg-purple-500/20 transition-all"
                    title={showWalletAccountNumber ? 'Hide account number' : 'Show account number'}
                  >
                    {showWalletAccountNumber ? (
                      <Eye className="w-4 h-4 text-purple-400" />
                    ) : (
                      <EyeOff className="w-4 h-4 text-gray-500" />
                    )}
                  </button>
                </div>
                <p 
                  className="text-white font-mono font-bold cursor-pointer hover:text-purple-300 transition-all select-all"
                  onClick={() => { navigator.clipboard.writeText(userAccount.account_number); alert('Account number copied!'); }}
                >
                  {showWalletAccountNumber ? userAccount.account_number : '••••••••••••••••'}
                </p>
              </div>

              {/* Mini Info Grid */}
              <div className="grid grid-cols-2 gap-2 mb-3">
                <div className="bg-slate-700/30 rounded p-2">
                  <p className="text-gray-400 text-xs">Currency</p>
                  <p className="text-white text-sm font-semibold">{userAccount.preferred_currency}</p>
                </div>
                <div className="bg-slate-700/30 rounded p-2">
                  <p className="text-gray-400 text-xs">Balance</p>
                  <p className="text-green-400 text-sm font-semibold">${userAccount.usd_balance?.toLocaleString() || '0'}</p>
                </div>
              </div>

              {/* Edit Button */}
              <button
                onClick={() => {
                  setAccountEditForm({
                    accountHolderName: userAccount.account_holder_name,
                    phoneNumber: userAccount.phone_number,
                    email: userAccount.email,
                    preferredCurrency: userAccount.preferred_currency
                  });
                  setShowAccountEdit(true);
                }}
                className="w-full px-3 py-2 bg-purple-600/30 hover:bg-purple-600/50 text-purple-300 rounded-lg text-sm font-medium transition-all border border-purple-500/30"
              >
                ✏️ Edit
              </button>
            </div>
          )}

          {/* Agent Account Card - Compact (if user is agent) */}
          {isAgent && agentAccount && (
            <div className="glass-card p-4 border border-blue-500/30 bg-gradient-to-br from-blue-900/20 to-slate-900/20">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3 flex-1">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center flex-shrink-0">
                    <span className="text-lg">🏪</span>
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white truncate">{agentAccount.agent_name}</p>
                    <p className="text-xs text-blue-400">Agent Account</p>
                  </div>
                </div>
                <span className="px-2 py-1 rounded-full bg-green-500/30 text-green-400 font-semibold text-xs border border-green-500/50 flex-shrink-0">ACTIVE</span>
              </div>

              {/* Agent Account Number - Clickable with Visibility Toggle */}
              <div className="bg-slate-700/50 rounded-lg p-3 mb-3 border border-blue-500/20 group">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-gray-400 text-xs">Agent ID</p>
                  <button
                    onClick={() => setShowAgentAccountNumber(!showAgentAccountNumber)}
                    className="p-1 rounded hover:bg-blue-500/20 transition-all"
                    title={showAgentAccountNumber ? 'Hide agent ID' : 'Show agent ID'}
                  >
                    {showAgentAccountNumber ? (
                      <Eye className="w-4 h-4 text-blue-400" />
                    ) : (
                      <EyeOff className="w-4 h-4 text-gray-500" />
                    )}
                  </button>
                </div>
                <p 
                  className="text-white font-mono font-bold cursor-pointer hover:text-blue-300 transition-all select-all"
                  onClick={() => { navigator.clipboard.writeText(agentAccount.agent_id); alert('Agent ID copied!'); }}
                >
                  {showAgentAccountNumber ? agentAccount.agent_id : '••••••••••••••••'}
                </p>
              </div>

              {/* Mini Info Grid */}
              <div className="grid grid-cols-2 gap-2 mb-3">
                <div className="bg-slate-700/30 rounded p-2">
                  <p className="text-gray-400 text-xs">Location</p>
                  <p className="text-white text-sm font-semibold">{agentAccount.location_city || 'N/A'}</p>
                </div>
                <div className="bg-slate-700/30 rounded p-2">
                  <p className="text-gray-400 text-xs">Commission</p>
                  <p className="text-blue-400 text-sm font-semibold">{agentAccount.withdrawal_commission_percentage || '0'}%</p>
                </div>
              </div>

              {/* Edit Button */}
              <button
                onClick={() => setActiveTab('agent')}
                className="w-full px-3 py-2 bg-blue-600/30 hover:bg-blue-600/50 text-blue-300 rounded-lg text-sm font-medium transition-all border border-blue-500/30"
              >
                ✏️ Edit Profile
              </button>
            </div>
          )}

          {/* Settings Options - Compact */}
          <div className="glass-card p-4">
            <h4 className="text-sm font-semibold text-white mb-3">⚙️ Quick Settings</h4>
            <div className="space-y-2">
              <label className="flex items-center justify-between p-2 bg-slate-700/30 rounded-lg hover:bg-slate-700/50 transition-all cursor-pointer">
                <span className="text-sm text-gray-300">2FA Protection</span>
                <input type="checkbox" className="w-4 h-4 rounded accent-green-500" />
              </label>
              <label className="flex items-center justify-between p-2 bg-slate-700/30 rounded-lg hover:bg-slate-700/50 transition-all cursor-pointer">
                <span className="text-sm text-gray-300">Notifications</span>
                <input type="checkbox" defaultChecked className="w-4 h-4 rounded accent-green-500" />
              </label>
            </div>
          </div>
          </div>
        )}
        </div>
      )}

      {/* Deposit Tab */}
      {activeTab === 'deposit' && (
        <div className="glass-card p-6">
          <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <ArrowDownLeft className="w-5 h-5 text-green-400" />
            Deposit Money
          </h3>
          
          {/* Wallet Account Notice */}
          <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 mb-6">
            <p className="text-sm text-blue-300">
              💡 <strong>Tip:</strong> Your wallet account is your unique deposit address. Keep it safe!
            </p>
          </div>
          
          <div className="space-y-4">
            <p className="text-gray-400 mb-6">Add money to your wallet using one of these methods:</p>
            
            {/* Agent Option - Select Available Agent */}
            <button
              onClick={() => {
                setAgentTransactionType('deposit');
                setActiveModal('selectAgent');
              }}
              className="w-full p-4 bg-gradient-to-br from-purple-500/20 to-purple-600/20 border border-purple-400/50 hover:border-purple-400/80 rounded-lg transition-all text-left group"
            >
              <div className="flex items-center gap-3">
                <div className="p-3 bg-purple-500/30 rounded-lg group-hover:bg-purple-500/50 transition-all">
                  <Users className="w-5 h-5 text-purple-400" />
                </div>
                <div className="flex-1">
                  <p className="font-semibold text-white group-hover:text-purple-300 transition-all">🏪 Agent</p>
                  <p className="text-sm text-gray-400">Receive money from any agent</p>
                </div>
                <div className="text-xs bg-purple-500/30 px-3 py-1 rounded-full text-purple-300">Popular</div>
              </div>
            </button>
            
            <button
              onClick={() => setActiveModal('topup')}
              className="w-full p-4 bg-gradient-to-br from-green-500/20 to-green-600/20 border border-green-400/50 hover:border-green-400/80 rounded-lg transition-all text-left"
            >
              <div className="flex items-center gap-3">
                <div className="p-3 bg-green-500/30 rounded-lg">
                  <Plus className="w-5 h-5 text-green-400" />
                </div>
                <div>
                  <p className="font-semibold text-white">Mobile Money</p>
                  <p className="text-sm text-gray-400">MTN, Airtel, Vodafone</p>
                </div>
              </div>
            </button>

            <button
              onClick={() => setActiveModal('topup')}
              className="w-full p-4 bg-gradient-to-br from-cyan-500/20 to-cyan-600/20 border border-cyan-400/50 hover:border-cyan-400/80 rounded-lg transition-all text-left"
            >
              <div className="flex items-center gap-3">
                <div className="p-3 bg-cyan-500/30 rounded-lg">
                  <CreditCard className="w-5 h-5 text-cyan-400" />
                </div>
                <div>
                  <p className="font-semibold text-white">Debit/Credit Card</p>
                  <p className="text-sm text-gray-400">Visa, Mastercard</p>
                </div>
              </div>
            </button>

            <button
              onClick={() => setActiveModal('topup')}
              className="w-full p-4 bg-gradient-to-br from-yellow-500/20 to-yellow-600/20 border border-yellow-400/50 hover:border-yellow-400/80 rounded-lg transition-all text-left"
            >
              <div className="flex items-center gap-3">
                <div className="p-3 bg-yellow-500/30 rounded-lg">
                  <Banknote className="w-5 h-5 text-yellow-400" />
                </div>
                <div>
                  <p className="font-semibold text-white">Bank Transfer</p>
                  <p className="text-sm text-gray-400">Direct bank deposit</p>
                </div>
              </div>
            </button>
          </div>
        </div>
      )}

      {/* Withdraw Tab */}
      {activeTab === 'withdraw' && (
        <div className="glass-card p-6">
          <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <ArrowUpRight className="w-5 h-5 text-orange-400" />
            Withdraw Money
          </h3>
          
          {/* Withdrawal Tips */}
          <div className="bg-orange-500/10 border border-orange-500/30 rounded-lg p-4 mb-6">
            <p className="text-sm text-orange-300">
              ⚡ <strong>Fast withdrawals:</strong> Most methods process within 5-30 minutes
            </p>
          </div>
          
          <div className="space-y-4">
            <p className="text-gray-400 mb-6">Choose your preferred withdrawal method:</p>
            
            {/* Agent Option - Withdraw to Agent */}
            <button
              onClick={() => {
                setAgentTransactionType('withdraw');
                setActiveModal('selectAgent');
              }}
              className="w-full p-4 bg-gradient-to-br from-purple-500/20 to-purple-600/20 border border-purple-400/50 hover:border-purple-400/80 rounded-lg transition-all text-left group"
            >
              <div className="flex items-center gap-3">
                <div className="p-3 bg-purple-500/30 rounded-lg group-hover:bg-purple-500/50 transition-all">
                  <Users className="w-5 h-5 text-purple-400" />
                </div>
                <div className="flex-1">
                  <p className="font-semibold text-white group-hover:text-purple-300 transition-all">🏪 Agent</p>
                  <p className="text-sm text-gray-400">Withdraw to any agent</p>
                </div>
                <div className="text-xs bg-purple-500/30 px-3 py-1 rounded-full text-purple-300">Fast</div>
              </div>
            </button>
            
            {/* Agent Cash-Out Option (Only for Agents) */}
            {/* 
            {isAgent && (
              <button
                onClick={() => setActiveTab('agent')}
                className="w-full p-4 bg-gradient-to-br from-yellow-500/20 to-yellow-600/20 border border-yellow-400/50 hover:border-yellow-400/80 rounded-lg transition-all text-left group"
              >
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-yellow-500/30 rounded-lg group-hover:bg-yellow-500/50 transition-all">
                    <Download className="w-5 h-5 text-yellow-400" />
                  </div>
                  <div className="flex-1">
                    <p className="font-semibold text-white group-hover:text-yellow-300 transition-all">🏪 Agent Terminal</p>
                    <p className="text-sm text-gray-400">Cash-out with 2.5% commission</p>
                  </div>
                  <div className="text-xs bg-yellow-500/30 px-3 py-1 rounded-full text-yellow-300">💰 Earn</div>
                </div>
              </button>
            )}
            */}
            
            <button
              onClick={() => setActiveModal('withdraw')}
              className="w-full p-4 bg-gradient-to-br from-orange-500/20 to-orange-600/20 border border-orange-400/50 hover:border-orange-400/80 rounded-lg transition-all text-left"
            >
              <div className="flex items-center gap-3">
                <div className="p-3 bg-orange-500/30 rounded-lg">
                  <Banknote className="w-5 h-5 text-orange-400" />
                </div>
                <div>
                  <p className="font-semibold text-white">Mobile Money</p>
                  <p className="text-sm text-gray-400">MTN, Airtel, Vodafone</p>
                </div>
              </div>
            </button>

            <button
              onClick={() => setActiveModal('withdraw')}
              className="w-full p-4 bg-gradient-to-br from-red-500/20 to-red-600/20 border border-red-400/50 hover:border-red-400/80 rounded-lg transition-all text-left"
            >
              <div className="flex items-center gap-3">
                <div className="p-3 bg-red-500/30 rounded-lg">
                  <Upload className="w-5 h-5 text-red-400" />
                </div>
                <div>
                  <p className="font-semibold text-white">Bank Account</p>
                  <p className="text-sm text-gray-400">Direct to your bank</p>
                </div>
              </div>
            </button>

            <button
              onClick={() => setActiveModal('withdraw')}
              className="w-full p-4 bg-gradient-to-br from-pink-500/20 to-pink-600/20 border border-pink-400/50 hover:border-pink-400/80 rounded-lg transition-all text-left"
            >
              <div className="flex items-center gap-3">
                <div className="p-3 bg-pink-500/30 rounded-lg">
                  <Download className="w-5 h-5 text-pink-400" />
                </div>
                <div>
                  <p className="font-semibold text-white">Cash Pickup</p>
                  <p className="text-sm text-gray-400">Agent locations</p>
                </div>
              </div>
            </button>
          </div>
        </div>
      )}

      {/* MODALS */}

      {/* SELECT AGENT MODAL - For Deposit & Withdraw */}
      {activeModal === 'selectAgent' && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="glass-card p-6 w-full max-w-md max-h-[80vh] overflow-y-auto">
            <h3 className="text-xl font-bold text-white mb-2 flex items-center gap-2">
              <Users className="w-5 h-5 text-purple-400" />
              Select Agent
            </h3>
            <p className="text-gray-400 text-sm mb-6">
              {agentTransactionType === 'deposit' 
                ? '💰 Choose an agent to receive money from:' 
                : '📤 Choose an agent to send money to:'}
            </p>

            <div className="space-y-3 mb-6">
              {availableAgents.map((agent) => (
                <button
                  key={agent.id}
                  onClick={() => setSelectedAgent(agent)}
                  className={`w-full p-4 rounded-lg border transition-all text-left ${
                    selectedAgent?.id === agent.id
                      ? 'bg-purple-500/30 border-purple-400 shadow-lg shadow-purple-500/20'
                      : 'bg-white/5 border-white/20 hover:border-purple-400/50 hover:bg-white/10'
                  }`}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <p className="font-semibold text-white">{agent.name}</p>
                      <div className="flex items-center gap-1 text-xs text-gray-400 mt-1">
                        <Phone className="w-3 h-3" />
                        {agent.phone}
                      </div>
                      <div className="flex items-center gap-1 text-xs text-gray-400 mt-1">
                        <MapPin className="w-3 h-3" />
                        {agent.location}
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-yellow-400 font-semibold text-sm">⭐ {agent.rating}</p>
                      <p className="text-gray-400 text-xs">{agent.transactions} txns</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>

            {selectedAgent && (
              <div className="space-y-4">
                <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-4">
                  <p className="text-sm text-purple-300 mb-2">
                    {agentTransactionType === 'deposit' ? 'Amount to receive' : 'Amount to send'} ({selectedCurrency}):
                  </p>
                  <input
                    type="number"
                    placeholder="0.00"
                    value={agentDepositAmount}
                    onChange={(e) => setAgentDepositAmount(e.target.value)}
                    className="w-full px-4 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-400 focus:border-purple-400 focus:outline-none transition-all"
                  />
                </div>

                <div className={`p-3 rounded-lg border ${
                  agentTransactionType === 'deposit' 
                    ? 'bg-green-500/10 border-green-500/30' 
                    : 'bg-orange-500/10 border-orange-500/30'
                }`}>
                  <p className={`text-xs ${
                    agentTransactionType === 'deposit' 
                      ? 'text-green-300' 
                      : 'text-orange-300'
                  }`}>
                    {agentTransactionType === 'deposit' 
                      ? `💡 Receiving from: ${selectedAgent.name}` 
                      : `💡 Sending to: ${selectedAgent.name}`}
                  </p>
                </div>

                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setActiveModal(null);
                      setSelectedAgent(null);
                      setAgentDepositAmount('');
                    }}
                    className="flex-1 px-4 py-2 bg-white/10 text-white rounded-lg hover:bg-white/20 transition-all"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!agentDepositAmount) {
                        alert('Please enter an amount');
                        return;
                      }

                      // Use unified transaction handlers
                      if (agentTransactionType === 'deposit') {
                        handleUserDepositFromAgent(agentDepositAmount, selectedAgent.id, selectedAgent.name);
                      } else {
                        handleUserWithdrawToAgent(agentDepositAmount, selectedAgent.id, selectedAgent.name);
                      }

                      // Close modal after transaction
                      setTimeout(() => {
                        setActiveModal(null);
                        setSelectedAgent(null);
                        setAgentDepositAmount('');
                      }, 1500);
                    }}
                    disabled={transactionInProgress}
                    className={`flex-1 px-4 py-2 text-white rounded-lg hover:shadow-lg disabled:opacity-50 transition-all font-semibold ${
                      agentTransactionType === 'deposit'
                        ? 'bg-gradient-to-r from-green-500 to-green-600 hover:shadow-green-500/30'
                        : 'bg-gradient-to-r from-orange-500 to-orange-600 hover:shadow-orange-500/30'
                    }`}
                  >
                    {transactionInProgress 
                      ? 'Processing...' 
                      : agentTransactionType === 'deposit' 
                        ? '📥 Receive' 
                        : '📤 Send'}
                  </button>
                </div>
              </div>
            )}

            {transactionResult && (transactionResult.type === 'agentDeposit' || transactionResult.type === 'agentWithdraw') && (
              <div className={`mt-4 p-4 rounded-lg ${transactionResult.success ? 'bg-green-500/20 border border-green-500/50' : 'bg-red-500/20 border border-red-500/50'}`}>
                <p className={`text-sm font-medium ${transactionResult.success ? 'text-green-400' : 'text-red-400'}`}>
                  {transactionResult.message}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* SEND MODAL */}
      {activeModal === 'send' && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="glass-card p-6 w-full max-w-md">
            <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
              <Send className="w-5 h-5 text-blue-400" />
              Send Money
            </h3>

            <form onSubmit={handleSendMoney} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  👤 Recipient (ICAN Account, Phone, or Email)
                </label>
                <input
                  type="text"
                  placeholder="ICAN-1234567890123456 | +256701234567 | user@example.com"
                  value={sendForm.recipient}
                  onChange={(e) => setSendForm({ ...sendForm, recipient: e.target.value })}
                  className="w-full px-4 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-400 focus:border-blue-400 focus:outline-none transition-all"
                />
                <p className="text-xs text-gray-400 mt-1">
                  Send to ICAN account number, phone number, or email address
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Amount ({selectedCurrency})</label>
                <input
                  type="number"
                  placeholder="500"
                  value={sendForm.amount}
                  onChange={(e) => setSendForm({ ...sendForm, amount: e.target.value })}
                  className="w-full px-4 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-400 focus:border-blue-400 focus:outline-none transition-all"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Description (Optional)</label>
                <input
                  type="text"
                  placeholder="Payment for services"
                  value={sendForm.description}
                  onChange={(e) => setSendForm({ ...sendForm, description: e.target.value })}
                  className="w-full px-4 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-400 focus:border-blue-400 focus:outline-none transition-all"
                />
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setActiveModal(null);
                    setSendForm({ recipient: '', amount: '', description: '' });
                  }}
                  className="flex-1 px-4 py-2 bg-white/10 text-white rounded-lg hover:bg-white/20 transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={transactionInProgress}
                  className="flex-1 px-4 py-2 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-lg hover:shadow-lg hover:shadow-blue-500/30 disabled:opacity-50 transition-all font-semibold"
                >
                  {transactionInProgress ? 'Processing...' : '💰 Send'}
                </button>
              </div>
            </form>

            {transactionResult && transactionResult.type === 'send' && (
              <div className={`mt-4 p-4 rounded-lg ${transactionResult.success ? 'bg-green-500/20 border border-green-500/50' : 'bg-red-500/20 border border-red-500/50'}`}>
                <p className={`text-sm font-medium ${transactionResult.success ? 'text-green-400' : 'text-red-400'}`}>
                  {transactionResult.message}
                </p>
                {transactionResult.transactionId && (
                  <p className="text-xs text-gray-400 mt-2">ID: {transactionResult.transactionId}</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* RECEIVE MODAL */}
      {activeModal === 'receive' && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="glass-card p-6 w-full max-w-md">
            <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
              <ArrowDownLeft className="w-5 h-5 text-cyan-400" />
              Receive Payment
            </h3>

            <form onSubmit={handleReceiveMoney} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Amount ({selectedCurrency})</label>
                <input
                  type="number"
                  placeholder="1000"
                  value={receiveForm.amount}
                  onChange={(e) => setReceiveForm({ ...receiveForm, amount: e.target.value })}
                  className="w-full px-4 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-400 focus:border-cyan-400 focus:outline-none transition-all"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Description (Optional)</label>
                <input
                  type="text"
                  placeholder="Invoice payment"
                  value={receiveForm.description}
                  onChange={(e) => setReceiveForm({ ...receiveForm, description: e.target.value })}
                  className="w-full px-4 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-400 focus:border-cyan-400 focus:outline-none transition-all"
                />
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setActiveModal(null);
                    setReceiveForm({ amount: '', description: '' });
                  }}
                  className="flex-1 px-4 py-2 bg-white/10 text-white rounded-lg hover:bg-white/20 transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={transactionInProgress}
                  className="flex-1 px-4 py-2 bg-gradient-to-r from-cyan-500 to-cyan-600 text-white rounded-lg hover:shadow-lg hover:shadow-cyan-500/30 disabled:opacity-50 transition-all font-semibold"
                >
                  {transactionInProgress ? 'Generating...' : '🔗 Create Link'}
                </button>
              </div>
            </form>

            {transactionResult && transactionResult.type === 'receive' && (
              <div className={`mt-4 p-4 rounded-lg ${transactionResult.success ? 'bg-green-500/20 border border-green-500/50' : 'bg-red-500/20 border border-red-500/50'}`}>
                <p className={`text-sm font-medium ${transactionResult.success ? 'text-green-400' : 'text-red-400'}`}>
                  {transactionResult.success ? '✅ ' : '❌ '}{transactionResult.message}
                </p>
                {transactionResult.paymentLink && (
                  <div className="mt-2 p-2 bg-black/30 rounded text-xs text-gray-300 break-all">
                    {transactionResult.paymentLink}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TOP UP MODAL */}
      {activeModal === 'topup' && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="glass-card p-6 w-full max-w-md">
            <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
              <Plus className="w-5 h-5 text-green-400" />
              Top Up Wallet
            </h3>

            <form onSubmit={handleTopUp} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Payment Method</label>
                <select
                  value={topupForm.method || ''}
                  onChange={(e) => setTopupForm({ ...topupForm, method: e.target.value })}
                  className="w-full px-4 py-2 bg-white/10 border border-white/20 rounded-lg text-white focus:border-green-400 focus:outline-none transition-all"
                >
                  <option value="">Select method...</option>
                  <option value="mtn">MTN Mobile Money</option>
                  <option value="vodafone">Vodafone Money</option>
                  <option value="airtel">Airtel Money</option>
                  <option value="visa">Visa Card</option>
                  <option value="mastercard">MasterCard</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  {topupForm.method === 'card' ? 'Card Number' : 'Phone/Account'}
                </label>
                <input
                  type="text"
                  placeholder={topupForm.method === 'card' ? '4532015112830366' : '256701234567'}
                  value={topupForm.paymentInput}
                  onChange={handlePaymentInputChange}
                  className="w-full px-4 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-400 focus:border-green-400 focus:outline-none transition-all"
                />
                {detectedPaymentMethod && (
                  <p className="mt-2 text-xs text-green-400">
                    ✨ Detected: {detectedPaymentMethod.name} {detectedPaymentMethod.icon}
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Amount ({selectedCurrency})</label>
                <input
                  type="number"
                  placeholder="50000"
                  value={topupForm.amount}
                  onChange={(e) => setTopupForm({ ...topupForm, amount: e.target.value })}
                  className="w-full px-4 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-400 focus:border-green-400 focus:outline-none transition-all"
                />
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setActiveModal(null);
                    setTopupForm({ amount: '', paymentInput: '', method: null, detectedMethod: null });
                  }}
                  className="flex-1 px-4 py-2 bg-white/10 text-white rounded-lg hover:bg-white/20 transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={transactionInProgress}
                  className="flex-1 px-4 py-2 bg-gradient-to-r from-green-500 to-green-600 text-white rounded-lg hover:shadow-lg hover:shadow-green-500/30 disabled:opacity-50 transition-all font-semibold"
                >
                  {transactionInProgress ? 'Processing...' : '💳 Top Up'}
                </button>
              </div>
            </form>

            {transactionResult && transactionResult.type === 'topup' && (
              <div className={`mt-4 p-4 rounded-lg ${transactionResult.success ? 'bg-green-500/20 border border-green-500/50' : 'bg-red-500/20 border border-red-500/50'}`}>
                <p className={`text-sm font-medium ${transactionResult.success ? 'text-green-400' : 'text-red-400'}`}>
                  {transactionResult.message}
                </p>
                {transactionResult.transactionId && (
                  <p className="text-xs text-gray-400 mt-2">ID: {transactionResult.transactionId}</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Agent Terminal Tab */}
      {activeTab === 'agent' && (
        <div className="mt-6">
          {agentCheckLoading ? (
            <div className="glass-card p-8 text-center">
              <div className="animate-spin w-12 h-12 border-4 border-purple-500/30 border-t-purple-500 rounded-full mx-auto mb-4"></div>
              <p className="text-gray-300">Checking agent status...</p>
            </div>
          ) : isAgent ? (
            <AgentDashboard />
          ) : showAgentRegistration ? (
            // 📝 AGENT REGISTRATION FORM
            <div className="glass-card p-8">
              <div className="max-w-md mx-auto">
                <h3 className="text-2xl font-bold text-white mb-2">🏪 Create Agent Account</h3>
                <p className="text-gray-400 mb-6">Fill in your details to become an ICAN Agent</p>

                {registrationMessage && (
                  <div className={`mb-4 p-4 rounded-lg ${registrationMessage.type === 'success' ? 'bg-green-500/20 border border-green-500/50' : 'bg-red-500/20 border border-red-500/50'}`}>
                    <p className={`text-sm font-medium ${registrationMessage.type === 'success' ? 'text-green-400' : 'text-red-400'}`}>
                      {registrationMessage.text}
                    </p>
                  </div>
                )}

                <form onSubmit={handleAgentRegistration} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">Agent Name *</label>
                    <input
                      type="text"
                      placeholder="Your full name or business name"
                      value={agentRegistrationForm.agentName}
                      onChange={(e) => setAgentRegistrationForm({
                        ...agentRegistrationForm,
                        agentName: e.target.value
                      })}
                      className="w-full px-4 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-500 focus:border-purple-400 focus:outline-none transition-all"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">Phone Number *</label>
                    <input
                      type="tel"
                      placeholder="+256701234567"
                      value={agentRegistrationForm.phoneNumber}
                      onChange={(e) => setAgentRegistrationForm({
                        ...agentRegistrationForm,
                        phoneNumber: e.target.value
                      })}
                      className="w-full px-4 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-500 focus:border-purple-400 focus:outline-none transition-all"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">City/Region *</label>
                    <input
                      type="text"
                      placeholder="e.g., Kampala, Jinja, Fort Portal"
                      value={agentRegistrationForm.locationCity}
                      onChange={(e) => setAgentRegistrationForm({
                        ...agentRegistrationForm,
                        locationCity: e.target.value
                      })}
                      className="w-full px-4 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-500 focus:border-purple-400 focus:outline-none transition-all"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">Location Name (Optional)</label>
                    <input
                      type="text"
                      placeholder="e.g., Downtown Branch, Market Stall"
                      value={agentRegistrationForm.locationName}
                      onChange={(e) => setAgentRegistrationForm({
                        ...agentRegistrationForm,
                        locationName: e.target.value
                      })}
                      className="w-full px-4 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-500 focus:border-purple-400 focus:outline-none transition-all"
                    />
                  </div>

                  <div className="bg-slate-700/50 p-4 rounded-lg border border-slate-600/50">
                    <p className="text-xs font-medium text-gray-300 mb-2">💼 Agent Benefits:</p>
                    <p className="text-xs text-gray-400">✓ 2.5% commission on cash-out transactions</p>
                    <p className="text-xs text-gray-400">✓ 1.5% FX margin on foreign transfers</p>
                    <p className="text-xs text-gray-400">✓ Daily settlement reports</p>
                  </div>

                  <div className="flex gap-3 pt-4">
                    <button
                      type="button"
                      onClick={() => {
                        setShowAgentRegistration(false);
                        setRegistrationMessage(null);
                      }}
                      disabled={registrationLoading}
                      className="flex-1 px-4 py-2 bg-white/10 text-white rounded-lg hover:bg-white/20 disabled:opacity-50 transition-all"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={registrationLoading}
                      className="flex-1 px-4 py-3 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-lg font-semibold transition-all shadow-lg shadow-purple-500/30 disabled:opacity-50"
                    >
                      {registrationLoading ? '⏳ Creating...' : '✨ Create Account'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          ) : (
            // 🔒 AGENT LOCKED SCREEN (with benefits)
            <div className="glass-card p-8">
              <div className="flex flex-col items-center gap-6">
                <div className="p-4 rounded-full bg-yellow-500/20 border border-yellow-500/50">
                  <AlertCircle className="w-12 h-12 text-yellow-400" />
                </div>
                <div className="text-center max-w-md">
                  <h3 className="text-2xl font-bold text-white mb-2">🔒 Agent Access Locked</h3>
                  <p className="text-gray-400 mb-4">
                    You don't currently have an agent account. To access the Agent Terminal and start earning commissions from cash transactions, create an agent account now.
                  </p>
                  <div className="space-y-2 bg-slate-700/50 p-4 rounded-lg border border-slate-600/50 mb-6">
                    <p className="text-sm text-gray-300"><strong>✓ Cash-In:</strong> Convert physical cash to digital wallet</p>
                    <p className="text-sm text-gray-300"><strong>✓ Cash-Out:</strong> Earn 2.5% commission per transaction</p>
                    <p className="text-sm text-gray-300"><strong>✓ Float Management:</strong> Refill liquidity via MOMO</p>
                    <p className="text-sm text-gray-300"><strong>✓ Shift Settlement:</strong> Track all transactions & earnings</p>
                  </div>
                  <button
                    onClick={() => setShowAgentRegistration(true)}
                    className="w-full px-6 py-3 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-lg font-semibold transition-all shadow-lg shadow-purple-500/30"
                  >
                    Apply to Become an Agent
                  </button>
                  <p className="text-xs text-gray-500 mt-4">
                    Already have an agent account? Make sure you're logged in with the correct account.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 🎯 EDIT WALLET ACCOUNT MODAL */}
      {showAccountEdit && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="glass-card p-8 w-full max-w-md max-h-[90vh] overflow-y-auto">
            <h2 className="text-3xl font-bold text-white mb-6 flex items-center gap-2">
              ✏️ Edit Account Information
            </h2>

            {accountMessage && (
              <div className={`mb-6 p-4 rounded-lg border ${
                accountMessage.type === 'success' 
                  ? 'bg-green-500/20 border-green-500/50 text-green-400' 
                  : 'bg-red-500/20 border-red-500/50 text-red-400'
              }`}>
                {accountMessage.text}
              </div>
            )}

            <form onSubmit={handleEditAccount} className="space-y-4">
              {/* Account Holder Name */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Full Name</label>
                <input
                  type="text"
                  value={accountEditForm.accountHolderName}
                  onChange={(e) => setAccountEditForm({ ...accountEditForm, accountHolderName: e.target.value })}
                  placeholder="Enter your full name"
                  className="w-full px-4 py-3 bg-slate-700/50 border border-purple-500/30 hover:border-purple-500/60 rounded-lg text-white placeholder-gray-400 focus:border-purple-500 focus:outline-none transition-all"
                />
              </div>

              {/* Phone Number */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Phone Number</label>
                <input
                  type="tel"
                  value={accountEditForm.phoneNumber}
                  onChange={(e) => setAccountEditForm({ ...accountEditForm, phoneNumber: e.target.value })}
                  placeholder="+256..."
                  className="w-full px-4 py-3 bg-slate-700/50 border border-purple-500/30 hover:border-purple-500/60 rounded-lg text-white placeholder-gray-400 focus:border-purple-500 focus:outline-none transition-all"
                />
              </div>

              {/* Email */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Email Address</label>
                <input
                  type="email"
                  value={accountEditForm.email}
                  onChange={(e) => setAccountEditForm({ ...accountEditForm, email: e.target.value })}
                  placeholder="you@example.com"
                  className="w-full px-4 py-3 bg-slate-700/50 border border-purple-500/30 hover:border-purple-500/60 rounded-lg text-white placeholder-gray-400 focus:border-purple-500 focus:outline-none transition-all"
                />
              </div>

              {/* Preferred Currency */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Preferred Currency</label>
                <select
                  value={accountEditForm.preferredCurrency}
                  onChange={(e) => setAccountEditForm({ ...accountEditForm, preferredCurrency: e.target.value })}
                  className="w-full px-4 py-3 bg-slate-700/50 border border-purple-500/30 hover:border-purple-500/60 rounded-lg text-white focus:border-purple-500 focus:outline-none transition-all cursor-pointer"
                >
                  <option value="USD">🇺🇸 USD - US Dollar</option>
                  <option value="UGX">🇺🇬 UGX - Uganda Shilling</option>
                  <option value="KES">🇰🇪 KES - Kenya Shilling</option>
                </select>
              </div>

              {/* PIN Change Section */}
              <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 mt-6">
                <button
                  type="button"
                  onClick={() => setShowPinChangeSection(!showPinChangeSection)}
                  className="w-full flex items-center justify-between text-sm font-semibold text-blue-400 hover:text-blue-300 transition-all"
                >
                  <span>🔐 Change PIN</span>
                  <span className={`transform transition-transform ${showPinChangeSection ? 'rotate-180' : ''}`}>▼</span>
                </button>

                {showPinChangeSection && (
                  <div className="mt-4 space-y-3 border-t border-blue-500/20 pt-4">
                    {!showPhoneOtpSection ? (
                      <>
                        {/* Current PIN */}
                        <div>
                          <label className="block text-xs font-medium text-gray-300 mb-1">Current PIN</label>
                          <input
                            type="password"
                            value={accountEditForm.currentPin}
                            onChange={(e) => setAccountEditForm({ ...accountEditForm, currentPin: e.target.value })}
                            placeholder="Enter current PIN"
                            className="w-full px-3 py-2 bg-slate-700/50 border border-blue-500/30 rounded-lg text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none transition-all text-sm"
                          />
                        </div>

                        {/* New PIN */}
                        <div>
                          <label className="block text-xs font-medium text-gray-300 mb-1">New PIN (4+ digits)</label>
                          <input
                            type="password"
                            value={accountEditForm.newPin}
                            onChange={(e) => setAccountEditForm({ ...accountEditForm, newPin: e.target.value })}
                            placeholder="Enter new PIN"
                            maxLength="6"
                            className="w-full px-3 py-2 bg-slate-700/50 border border-blue-500/30 rounded-lg text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none transition-all text-sm"
                          />
                        </div>

                        {/* Confirm New PIN */}
                        <div>
                          <label className="block text-xs font-medium text-gray-300 mb-1">Confirm New PIN</label>
                          <input
                            type="password"
                            value={accountEditForm.confirmNewPin}
                            onChange={(e) => setAccountEditForm({ ...accountEditForm, confirmNewPin: e.target.value })}
                            placeholder="Confirm new PIN"
                            maxLength="6"
                            className="w-full px-3 py-2 bg-slate-700/50 border border-blue-500/30 rounded-lg text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none transition-all text-sm"
                          />
                        </div>

                        <button
                          type="button"
                          onClick={handleSendPhoneOtp}
                          disabled={accountEditLoading || !accountEditForm.newPin}
                          className="w-full mt-3 px-3 py-2 bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white rounded-lg text-sm font-semibold transition-all disabled:opacity-50"
                        >
                          {accountEditLoading ? '⏳ Sending OTP...' : '📱 Send OTP to Phone'}
                        </button>

                        <p className="text-xs text-gray-400 text-center mt-2">
                          ℹ️ We'll send a verification code to confirm your PIN change
                        </p>
                      </>
                    ) : (
                      <>
                        {/* OTP Input */}
                        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 mb-3">
                          <p className="text-xs text-yellow-400 font-medium mb-3">
                            📬 OTP Sent! Check your SMS for the 6-digit code
                          </p>
                          <input
                            type="text"
                            value={accountEditForm.phoneOtp}
                            onChange={(e) => setAccountEditForm({ ...accountEditForm, phoneOtp: e.target.value.replace(/\D/g, '').slice(0, 6) })}
                            placeholder="Enter 6-digit OTP"
                            maxLength="6"
                            className="w-full px-3 py-2 bg-slate-700/50 border border-yellow-500/30 rounded-lg text-white placeholder-gray-500 focus:border-yellow-500 focus:outline-none transition-all text-center text-lg font-mono font-bold tracking-widest"
                          />
                        </div>

                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setShowPhoneOtpSection(false);
                              setAccountEditForm(prev => ({ ...prev, phoneOtp: '' }));
                            }}
                            disabled={accountEditLoading}
                            className="flex-1 px-3 py-2 bg-slate-600/50 hover:bg-slate-600 text-white rounded-lg text-sm font-medium transition-all disabled:opacity-50"
                          >
                            Back
                          </button>
                          <button
                            type="button"
                            onClick={handleVerifyPhoneOtp}
                            disabled={accountEditLoading || accountEditForm.phoneOtp.length !== 6}
                            className="flex-1 px-3 py-2 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 text-white rounded-lg text-sm font-semibold transition-all disabled:opacity-50"
                          >
                            {accountEditLoading ? '⏳ Verifying...' : '✅ Verify & Change'}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowAccountEdit(false)}
                  disabled={accountEditLoading}
                  className="flex-1 px-4 py-3 bg-slate-600/50 hover:bg-slate-600 text-white rounded-lg font-semibold transition-all disabled:opacity-50"
                >
                  ❌ Cancel
                </button>
                <button
                  type="submit"
                  disabled={accountEditLoading}
                  className="flex-1 px-4 py-3 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white rounded-lg font-semibold transition-all disabled:opacity-50"
                >
                  {accountEditLoading ? '⏳ Saving...' : '💾 Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 🎯 CREATE WALLET ACCOUNT MODAL */}
      {showAccountCreation && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="glass-card p-8 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <h2 className="text-3xl font-bold text-white mb-2 flex items-center gap-2">
              💳 Create Your Wallet Account
            </h2>
            <p className="text-gray-400 mb-6">Set up your ICAN wallet with a secure PIN and biometric options</p>

            {accountMessage && (
              <div className={`mb-6 p-4 rounded-lg border ${
                accountMessage.type === 'success' 
                  ? 'bg-green-500/20 border-green-500/50 text-green-400' 
                  : 'bg-red-500/20 border-red-500/50 text-red-400'
              }`}>
                {accountMessage.text}
              </div>
            )}

            <form onSubmit={handleCreateAccount} className="space-y-4">
              {/* Account Holder Name */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Full Name *</label>
                <input
                  type="text"
                  value={accountCreationForm.accountHolderName}
                  onChange={(e) => setAccountCreationForm({ ...accountCreationForm, accountHolderName: e.target.value })}
                  placeholder="Enter your full name"
                  className="w-full px-4 py-3 bg-slate-700/50 border border-purple-500/30 hover:border-purple-500/60 rounded-lg text-white placeholder-gray-400 focus:border-purple-500 focus:outline-none transition-all"
                />
              </div>

              {/* Phone Number */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Phone Number *</label>
                <input
                  type="tel"
                  value={accountCreationForm.phoneNumber}
                  onChange={(e) => setAccountCreationForm({ ...accountCreationForm, phoneNumber: e.target.value })}
                  placeholder="+256..."
                  className="w-full px-4 py-3 bg-slate-700/50 border border-purple-500/30 hover:border-purple-500/60 rounded-lg text-white placeholder-gray-400 focus:border-purple-500 focus:outline-none transition-all"
                />
              </div>

              {/* Email */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Email Address *</label>
                <input
                  type="email"
                  value={accountCreationForm.email}
                  onChange={(e) => setAccountCreationForm({ ...accountCreationForm, email: e.target.value })}
                  placeholder="you@example.com"
                  className="w-full px-4 py-3 bg-slate-700/50 border border-purple-500/30 hover:border-purple-500/60 rounded-lg text-white placeholder-gray-400 focus:border-purple-500 focus:outline-none transition-all"
                />
              </div>

              {/* PIN Setup */}
              <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 mb-4">
                <h3 className="text-blue-400 font-semibold mb-3 flex items-center gap-2">
                  🔐 Set Your PIN (Required)
                </h3>
                <p className="text-gray-400 text-sm mb-3">Your 4-6 digit PIN protects your account. You'll use this for transactions.</p>
                <input
                  type="password"
                  value={accountCreationForm.pin}
                  onChange={(e) => {
                    const value = e.target.value.replace(/\D/g, '');
                    if (value.length <= 6) {
                      setAccountCreationForm({ ...accountCreationForm, pin: value });
                    }
                  }}
                  placeholder="Enter 4-6 digits"
                  maxLength="6"
                  className="w-full px-4 py-3 bg-slate-700/50 border border-blue-500/30 hover:border-blue-500/60 rounded-lg text-white placeholder-gray-400 focus:border-blue-500 focus:outline-none transition-all text-center text-2xl tracking-widest"
                />
                <p className="text-gray-500 text-xs mt-2">
                  {accountCreationForm.pin.length === 0 ? '0' : accountCreationForm.pin.length} / 6 digits
                </p>
              </div>

              {/* Biometric Options */}
              <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4">
                <h3 className="text-green-400 font-semibold mb-4 flex items-center gap-2">
                  👆 Biometric Security (Optional)
                </h3>

                {/* Fingerprint Option */}
                <div className="flex items-center gap-3 mb-4 p-3 bg-slate-700/50 rounded-lg hover:bg-slate-700/70 cursor-pointer transition-all"
                     onClick={() => setAccountCreationForm({ 
                       ...accountCreationForm, 
                       fingerprintEnabled: !accountCreationForm.fingerprintEnabled 
                     })}>
                  <input
                    type="checkbox"
                    checked={accountCreationForm.fingerprintEnabled}
                    onChange={() => {}}
                    className="w-5 h-5 rounded accent-green-500 cursor-pointer"
                  />
                  <div className="flex-1">
                    <p className="text-white font-medium">Enable Fingerprint</p>
                    <p className="text-gray-400 text-sm">Use your fingerprint to unlock transactions</p>
                  </div>
                </div>

                {/* Phone PIN Option */}
                <div className="flex items-center gap-3 p-3 bg-slate-700/50 rounded-lg hover:bg-slate-700/70 cursor-pointer transition-all"
                     onClick={() => setAccountCreationForm({ 
                       ...accountCreationForm, 
                       phonePhoneEnabled: !accountCreationForm.phonePhoneEnabled 
                     })}>
                  <input
                    type="checkbox"
                    checked={accountCreationForm.phonePhoneEnabled}
                    onChange={() => {}}
                    className="w-5 h-5 rounded accent-green-500 cursor-pointer"
                  />
                  <div className="flex-1">
                    <p className="text-white font-medium">Use Phone PIN</p>
                    <p className="text-gray-400 text-sm">Authenticate using your device's PIN or biometric</p>
                  </div>
                </div>
              </div>

              {/* Preferred Currency */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Preferred Currency</label>
                <select
                  value={accountCreationForm.preferredCurrency}
                  onChange={(e) => setAccountCreationForm({ ...accountCreationForm, preferredCurrency: e.target.value })}
                  className="w-full px-4 py-3 bg-slate-700/50 border border-purple-500/30 hover:border-purple-500/60 rounded-lg text-white focus:border-purple-500 focus:outline-none transition-all cursor-pointer"
                >
                  <option value="USD">🇺🇸 USD - US Dollar</option>
                  <option value="UGX">🇺🇬 UGX - Uganda Shilling</option>
                  <option value="KES">🇰🇪 KES - Kenya Shilling</option>
                </select>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowAccountCreation(false)}
                  disabled={accountCreationLoading}
                  className="flex-1 px-4 py-3 bg-slate-600/50 hover:bg-slate-600 text-white rounded-lg font-semibold transition-all disabled:opacity-50"
                >
                  ❌ Cancel
                </button>
                <button
                  type="submit"
                  disabled={accountCreationLoading}
                  className="flex-1 px-4 py-3 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 text-white rounded-lg font-semibold transition-all disabled:opacity-50"
                >
                  {accountCreationLoading ? '⏳ Creating Account...' : '✨ Create Account'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* WITHDRAW MODAL */}
      {activeModal === 'withdraw' && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="glass-card p-6 w-full max-w-md">
            <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
              <Upload className="w-5 h-5 text-orange-400" />
              Withdraw Money
            </h3>

            <form onSubmit={async (e) => {
              e.preventDefault();
              if (!withdrawForm.method || !withdrawForm.phoneAccount || !withdrawForm.amount) {
                alert('Please fill in all fields');
                return;
              }

              setTransactionInProgress(true);

              try {
                // Get current user
                const supabase = getSupabaseClient();
                const { data: { user } } = await supabase.auth.getUser();

                if (!user) {
                  throw new Error('Not authenticated');
                }

                // Prepare withdrawal request
                const withdrawalData = {
                  userId: user.id,
                  amount: parseFloat(withdrawForm.amount),
                  currency: selectedCurrency,
                  phoneNumber: withdrawForm.phoneAccount,
                  provider: withdrawForm.method
                };

                console.log('💸 Submitting withdrawal:', withdrawalData);

                // Call appropriate withdrawal endpoint
                let response;
                if (withdrawForm.method === 'bank') {
                  response = await fetch('http://localhost:5000/api/withdrawals/bank', {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                      userId: user.id,
                      amount: parseFloat(withdrawForm.amount),
                      currency: selectedCurrency,
                      accountNumber: withdrawForm.phoneAccount,
                      bankName: withdrawForm.bankName || 'Not specified'
                    })
                  });
                } else {
                  // Mobile money withdrawal
                  response = await fetch('http://localhost:5000/api/withdrawals/mobile-money', {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(withdrawalData)
                  });
                }

                const result = await response.json();

                if (result.success) {
                  // Update wallet balance (optional - can be fetched from backend)
                  // Commented out because setCurrentWallet is not a state hook
                  // const newBalance = parseFloat(currentWallet.balance) - parseFloat(withdrawForm.amount);
                  // setCurrentWallet({
                  //   ...currentWallet,
                  //   balance: newBalance
                  // });

                  // Add to transaction history
                  const transaction = {
                    id: result.transaction.id,
                    type: 'withdraw',
                    amount: parseFloat(withdrawForm.amount),
                    to: withdrawForm.phoneAccount,
                    date: new Date().toLocaleDateString(),
                    status: result.transaction.status,
                    provider: withdrawForm.method,
                    fee: result.transaction.fee
                  };

                  setTransactionHistory([transaction, ...transactionHistory]);

                  setTransactionResult({
                    type: 'withdraw',
                    success: true,
                    message: `✅ ${result.message}`,
                    transaction: result.transaction
                  });
                } else {
                  throw new Error(result.error || 'Withdrawal failed');
                }

              } catch (error) {
                console.error('❌ Withdrawal error:', error);
                setTransactionResult({
                  type: 'withdraw',
                  success: false,
                  message: `❌ Withdrawal failed: ${error.message}`
                });
              } finally {
                setTransactionInProgress(false);
                setTimeout(() => {
                  setActiveModal(null);
                  setTransactionResult(null);
                  setWithdrawForm({ method: '', phoneAccount: '', amount: '', bankName: '' });
                }, 3000);
              }
            }} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Withdrawal Method *</label>
                <select 
                  value={withdrawForm.method}
                  onChange={(e) => setWithdrawForm({ ...withdrawForm, method: e.target.value })}
                  className="w-full px-4 py-3 bg-gradient-to-r from-slate-700 to-slate-800 border-2 border-orange-400/50 hover:border-orange-400 rounded-lg text-white font-semibold focus:border-orange-400 focus:outline-none transition-all cursor-pointer appearance-none"
                  style={{
                    backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3e%3cpath fill='none' stroke='%23fb923c' stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M2 5l6 6 6-6'/%3e%3c/svg%3e")`,
                    backgroundRepeat: 'no-repeat',
                    backgroundPosition: 'right 0.75rem center',
                    backgroundSize: '16px 16px',
                    paddingRight: '2.5rem'
                  }}
                >
                  <option value="" className="bg-slate-800 text-white font-semibold">Select method...</option>
                  <option value="mtn" className="bg-slate-800 text-white font-semibold">🟡 MTN Mobile Money</option>
                  <option value="airtel" className="bg-slate-800 text-white font-semibold">🔴 Airtel Money</option>
                  <option value="vodafone" className="bg-slate-800 text-white font-semibold">🟣 Vodafone Money</option>
                  <option value="bank" className="bg-slate-800 text-white font-semibold">🏦 Bank Transfer</option>
                </select>
              </div>

              {withdrawForm.method && (
                <div className="p-3 bg-orange-500/10 border border-orange-500/30 rounded-lg">
                  <p className="text-sm text-orange-200">
                    {withdrawForm.method === 'mtn' && '🟡 Enter your MTN phone number (e.g., 256701234567)'}
                    {withdrawForm.method === 'airtel' && '🔴 Enter your Airtel phone number (e.g., 256701234567)'}
                    {withdrawForm.method === 'vodafone' && '🟣 Enter your Vodafone phone number (e.g., 256701234567)'}
                    {withdrawForm.method === 'bank' && '🏦 Enter your bank account number or IBAN'}
                  </p>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  {withdrawForm.method === 'bank' ? 'Account Number / IBAN *' : 'Phone Number *'}
                </label>
                <input
                  type="text"
                  placeholder={withdrawForm.method === 'bank' ? 'Your account number' : '256701234567'}
                  value={withdrawForm.phoneAccount}
                  onChange={(e) => setWithdrawForm({ ...withdrawForm, phoneAccount: e.target.value })}
                  className="w-full px-4 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-400 focus:border-orange-400 focus:outline-none transition-all"
                />
              </div>

              {withdrawForm.method === 'bank' && (
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Bank Name *</label>
                  <input
                    type="text"
                    placeholder="e.g., Stanbic Bank, Equity Bank"
                    value={withdrawForm.bankName}
                    onChange={(e) => setWithdrawForm({ ...withdrawForm, bankName: e.target.value })}
                    className="w-full px-4 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-400 focus:border-orange-400 focus:outline-none transition-all"
                  />
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Amount ({selectedCurrency}) *</label>
                <input
                  type="number"
                  placeholder="500"
                  value={withdrawForm.amount}
                  onChange={(e) => setWithdrawForm({ ...withdrawForm, amount: e.target.value })}
                  className="w-full px-4 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-400 focus:border-orange-400 focus:outline-none transition-all"
                />
              </div>

              <div className="bg-orange-500/10 border border-orange-500/30 rounded-lg p-3">
                <p className="text-xs text-orange-200">
                  ℹ️ Withdrawal fees: 1-2% depending on method. Processing time: 24-48 hours.
                </p>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setActiveModal(null);
                    setWithdrawForm({ method: '', phoneAccount: '', amount: '', bankName: '' });
                  }}
                  className="flex-1 px-4 py-2 bg-white/10 text-white rounded-lg hover:bg-white/20 transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={transactionInProgress}
                  className="flex-1 px-4 py-2 bg-gradient-to-r from-orange-500 to-orange-600 text-white rounded-lg hover:shadow-lg hover:shadow-orange-500/30 disabled:opacity-50 transition-all font-semibold"
                >
                  {transactionInProgress ? 'Processing...' : '💸 Withdraw'}
                </button>
              </div>
            </form>

            {transactionResult && transactionResult.type === 'withdraw' && (
              <div className={`mt-4 p-4 rounded-lg ${transactionResult.success ? 'bg-green-500/20 border border-green-500/50' : 'bg-red-500/20 border border-red-500/50'}`}>
                <p className={`text-sm font-medium ${transactionResult.success ? 'text-green-400' : 'text-red-400'}`}>
                  {transactionResult.success ? '✅ ' : '❌ '}{transactionResult.message}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default ICANWallet;
