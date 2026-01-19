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
  Zap
} from 'lucide-react';
import momoService from '../services/momoService';
import airtelMoneyService from '../services/airtelMoneyService';
import flutterwaveService from '../services/flutterwaveService';
import { walletTransactionService } from '../services/walletTransactionService';
import { cardTransactionService } from '../services/cardTransactionService';
import paymentMethodDetector from '../services/paymentMethodDetector';

const ICANWallet = () => {
  const [showBalance, setShowBalance] = useState(true);
  const [selectedCurrency, setSelectedCurrency] = useState('USD');
  const [activeTab, setActiveTab] = useState('overview');
  const [showCurrencyDropdown, setShowCurrencyDropdown] = useState(false);
  const [activeModal, setActiveModal] = useState(null); // 'send', 'receive', 'topup'
  const [sendForm, setSendForm] = useState({ recipient: '', amount: '', description: '' });
  const [receiveForm, setReceiveForm] = useState({ amount: '', description: '' });
  const [topupForm, setTopupForm] = useState({ amount: '', paymentInput: '', method: null, detectedMethod: null });
  const [detectedPaymentMethod, setDetectedPaymentMethod] = useState(null);
  const [transactionInProgress, setTransactionInProgress] = useState(false);
  const [transactionResult, setTransactionResult] = useState(null);
  const [showPaymentPicker, setShowPaymentPicker] = useState(false);
  const dropdownRef = useRef(null);

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

  // Mock wallet data with country information
  const walletData = {
    USD: {
      balance: 5420.50,
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
      balance: 680250.75,
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
      balance: 19850000.00,
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

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // 💳 SEND MONEY HANDLER
  const handleSendMoney = async (e) => {
    e.preventDefault();
    if (!sendForm.recipient || !sendForm.amount) {
      alert('Please fill in recipient and amount');
      return;
    }
    
    setTransactionInProgress(true);
    
    try {
      // Process MOMO payment
      const result = await momoService.processTransfer({
        amount: sendForm.amount,
        currency: selectedCurrency,
        recipientPhone: sendForm.recipient,
        description: sendForm.description || `Send to ${sendForm.recipient}`
      });

      if (result.success) {
        // Save transaction to Supabase
        await walletTransactionService.initialize();
        await walletTransactionService.saveSend({
          amount: sendForm.amount,
          currency: selectedCurrency,
          recipientPhone: sendForm.recipient,
          paymentMethod: 'MOMO',
          transactionId: result.transactionId,
          memoKey: result.activeKey,
          mode: result.mode,
          description: sendForm.description
        });

        setTransactionResult({
          type: 'send',
          success: true,
          message: `✅ Successfully sent ${sendForm.amount} ${selectedCurrency} to ${sendForm.recipient}`,
          amount: sendForm.amount,
          recipient: sendForm.recipient,
          transactionId: result.transactionId
        });
      } else {
        setTransactionResult({
          type: 'send',
          success: false,
          message: result.message || 'Transfer failed. Please try again.',
          error: result.error
        });
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

  return (
    <div className="w-full space-y-6">
      {/* Header Card */}
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
        <div className="text-center py-8">
          <CreditCard className="w-12 h-12 text-gray-400 mx-auto mb-3" />
          <p className="text-gray-300 mb-4">No cards linked yet</p>
          <button className="px-4 py-2 bg-gradient-to-r from-blue-500 to-cyan-500 text-white rounded-lg hover:shadow-lg hover:shadow-blue-500/30 transition-all">
            Add Payment Card
          </button>
        </div>
      </div>
      )}

      {/* Settings Tab */}
      {activeTab === 'settings' && (
      <div className="glass-card p-6">
        <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <Settings className="w-5 h-5" />
          Wallet Settings
        </h3>
        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 bg-white/5 rounded-lg border border-white/10">
            <div>
              <p className="text-white font-medium">Two-Factor Authentication</p>
              <p className="text-sm text-gray-400">Enhanced security for your account</p>
            </div>
            <input type="checkbox" className="w-5 h-5 rounded accent-green-500" />
          </div>
          <div className="flex items-center justify-between p-4 bg-white/5 rounded-lg border border-white/10">
            <div>
              <p className="text-white font-medium">Transaction Limits</p>
              <p className="text-sm text-gray-400">Set daily spending limits</p>
            </div>
            <button className="px-3 py-1 bg-white/10 hover:bg-white/20 rounded-lg text-sm text-gray-300 transition-all">Edit</button>
          </div>
        </div>
      </div>
      )}
    </div>
  );
};

export default ICANWallet;
