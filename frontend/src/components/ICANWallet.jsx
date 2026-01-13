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
    <div className="w-full min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-4 md:p-8">
      {/* Header */}
      <div className="max-w-6xl mx-auto mb-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-3 rounded-lg bg-green-500/30 border border-green-400/50">
            <Wallet className="w-6 h-6 text-green-400" />
          </div>
          <div>
            <h1 className="text-3xl md:text-4xl font-bold text-white">ICAN Wallet</h1>
            <p className="text-slate-400">Your mobile money platform with multi-currency support</p>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Balance Card */}
        <div className="lg:col-span-2">
          <div className="bg-gradient-to-br from-green-500 to-emerald-600 rounded-2xl p-8 text-white shadow-2xl mb-6">
            {/* Balance Section */}
            <div className="mb-8">
              <p className="text-green-100 mb-2 text-sm font-medium">Total Balance</p>
              <div className="flex items-center gap-4 mb-6">
                <div className="text-5xl font-bold">
                  {showBalance ? `${currentWallet.flag} ${currentWallet.balance.toLocaleString()}` : '••••••••'}
                </div>
                <button
                  onClick={() => setShowBalance(!showBalance)}
                  className="p-3 rounded-lg bg-white/20 hover:bg-white/30 transition"
                >
                  {showBalance ? <Eye className="w-5 h-5" /> : <EyeOff className="w-5 h-5" />}
                </button>
              </div>
              <p className="text-green-100 text-lg font-semibold">{currentWallet.currency}</p>
            </div>

            {/* Action Buttons */}
            <div className="grid grid-cols-3 gap-3">
              <button 
                onClick={() => setActiveModal('send')}
                className="bg-white/20 hover:bg-white/30 rounded-lg py-3 px-4 flex flex-col items-center gap-2 transition"
              >
                <Send className="w-5 h-5" />
                <span className="text-sm font-medium">Send</span>
              </button>
              <button 
                onClick={() => setActiveModal('receive')}
                className="bg-white/20 hover:bg-white/30 rounded-lg py-3 px-4 flex flex-col items-center gap-2 transition"
              >
                <ArrowDownLeft className="w-5 h-5" />
                <span className="text-sm font-medium">Receive</span>
              </button>
              <button 
                onClick={() => setActiveModal('topup')}
                className="bg-white/20 hover:bg-white/30 rounded-lg py-3 px-4 flex flex-col items-center gap-2 transition"
              >
                <Plus className="w-5 h-5" />
                <span className="text-sm font-medium">Top Up</span>
              </button>
            </div>
          </div>

          {/* Currency Selector Dropdown - Compact */}
          <div className="relative mb-6" ref={dropdownRef}>
            <button
              onClick={() => setShowCurrencyDropdown(!showCurrencyDropdown)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-800/50 border border-slate-700 hover:border-slate-600 text-white transition"
            >
              <span className="text-2xl">{currentWallet.flag}</span>
              <span className="font-semibold">{selectedCurrency}</span>
              <ChevronDown className={`w-4 h-4 transition-transform ${showCurrencyDropdown ? 'rotate-180' : ''}`} />
            </button>

            {/* Dropdown Menu */}
            {showCurrencyDropdown && (
              <div className="absolute top-full left-0 mt-2 w-64 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl z-50 animate-in fade-in slide-in-from-top-2">
                <div className="p-3 space-y-2 max-h-96 overflow-y-auto">
                  {/* East Africa */}
                  <div>
                    <p className="text-slate-400 text-xs font-semibold px-3 py-2 uppercase">East Africa</p>
                    {['KES', 'UGX'].map((currency) => (
                      <button
                        key={currency}
                        onClick={() => {
                          setSelectedCurrency(currency);
                          setShowCurrencyDropdown(false);
                        }}
                        className={`w-full px-3 py-2.5 rounded-lg flex items-center gap-3 transition ${
                          selectedCurrency === currency
                            ? 'bg-green-500/30 text-green-400 border border-green-400'
                            : 'text-slate-300 hover:bg-slate-800'
                        }`}
                      >
                        <span className="text-xl">{walletData[currency].flag}</span>
                        <div className="text-left flex-1">
                          <p className="font-semibold">{currency}</p>
                          <p className="text-xs text-slate-400">{walletData[currency].country}</p>
                        </div>
                      </button>
                    ))}
                  </div>

                  {/* North America */}
                  <div>
                    <p className="text-slate-400 text-xs font-semibold px-3 py-2 uppercase mt-2">North America</p>
                    <button
                      onClick={() => {
                        setSelectedCurrency('USD');
                        setShowCurrencyDropdown(false);
                      }}
                      className={`w-full px-3 py-2.5 rounded-lg flex items-center gap-3 transition ${
                        selectedCurrency === 'USD'
                          ? 'bg-green-500/30 text-green-400 border border-green-400'
                          : 'text-slate-300 hover:bg-slate-800'
                      }`}
                    >
                      <span className="text-xl">🇺🇸</span>
                      <div className="text-left flex-1">
                        <p className="font-semibold">USD</p>
                        <p className="text-xs text-slate-400">United States</p>
                      </div>
                    </button>
                  </div>

                  {/* Europe */}
                  <div>
                    <p className="text-slate-400 text-xs font-semibold px-3 py-2 uppercase mt-2">Europe</p>
                    {['GBP', 'EUR'].map((currency) => (
                      <button
                        key={currency}
                        onClick={() => {
                          setSelectedCurrency(currency);
                          setShowCurrencyDropdown(false);
                        }}
                        className={`w-full px-3 py-2.5 rounded-lg flex items-center gap-3 transition ${
                          selectedCurrency === currency
                            ? 'bg-green-500/30 text-green-400 border border-green-400'
                            : 'text-slate-300 hover:bg-slate-800'
                        }`}
                      >
                        <span className="text-xl">{walletData[currency].flag}</span>
                        <div className="text-left flex-1">
                          <p className="font-semibold">{currency}</p>
                          <p className="text-xs text-slate-400">{walletData[currency].country}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Tabs */}
          <div className="flex gap-4 mb-6 border-b border-slate-700">
            {['overview', 'transactions', 'settings'].map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-3 font-medium capitalize border-b-2 transition ${
                  activeTab === tab
                    ? 'text-green-400 border-green-400'
                    : 'text-slate-400 border-transparent hover:text-slate-300'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          {/* Tab Content */}
          {activeTab === 'transactions' && (
            <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6">
              <div className="flex items-center gap-2 mb-6">
                <History className="w-5 h-5 text-purple-400" />
                <h3 className="text-xl font-bold text-white">Recent Transactions</h3>
              </div>
              <div className="space-y-3">
                {currentWallet.transactions.map((tx) => (
                  <div
                    key={tx.id}
                    className="bg-slate-700/30 hover:bg-slate-700/50 rounded-lg p-4 flex items-center justify-between transition"
                  >
                    <div className="flex items-center gap-4">
                      <div className={`p-3 rounded-full ${tx.type === 'send' ? 'bg-red-500/20' : 'bg-green-500/20'}`}>
                        {tx.type === 'send' ? (
                          <ArrowUpRight className={`w-5 h-5 ${tx.type === 'send' ? 'text-red-400' : 'text-green-400'}`} />
                        ) : (
                          <ArrowDownLeft className="w-5 h-5 text-green-400" />
                        )}
                      </div>
                      <div>
                        <p className="text-white font-medium capitalize">
                          {tx.type === 'send' ? `Sent to ${tx.to}` : `Received from ${tx.from}`}
                        </p>
                        <p className="text-slate-400 text-sm">{tx.date}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className={`text-lg font-bold ${tx.type === 'send' ? 'text-red-400' : 'text-green-400'}`}>
                        {tx.type === 'send' ? '-' : '+'}
                        {tx.amount.toLocaleString()} {currentWallet.currency}
                      </p>
                      <p className="text-xs text-slate-400 capitalize">{tx.status}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'overview' && (
            <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div className="bg-slate-700/30 rounded-lg p-4">
                  <p className="text-slate-400 text-sm mb-2">Monthly Sent</p>
                  <p className="text-2xl font-bold text-red-400">-250 {currentWallet.currency}</p>
                </div>
                <div className="bg-slate-700/30 rounded-lg p-4">
                  <p className="text-slate-400 text-sm mb-2">Monthly Received</p>
                  <p className="text-2xl font-bold text-green-400">+1,500 {currentWallet.currency}</p>
                </div>
                <div className="bg-slate-700/30 rounded-lg p-4">
                  <p className="text-slate-400 text-sm mb-2">Total Transactions</p>
                  <p className="text-2xl font-bold text-blue-400">24</p>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'settings' && (
            <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6">
              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 bg-slate-700/30 rounded-lg">
                  <div className="flex items-center gap-3">
                    <CreditCard className="w-5 h-5 text-purple-400" />
                    <div>
                      <p className="text-white font-medium">Linked Cards</p>
                      <p className="text-slate-400 text-sm">Manage your payment methods</p>
                    </div>
                  </div>
                  <span className="text-slate-400">2</span>
                </div>
                <div className="flex items-center justify-between p-4 bg-slate-700/30 rounded-lg">
                  <div className="flex items-center gap-3">
                    <Banknote className="w-5 h-5 text-purple-400" />
                    <div>
                      <p className="text-white font-medium">Transaction Limits</p>
                      <p className="text-slate-400 text-sm">Set daily transaction limits</p>
                    </div>
                  </div>
                  <span className="text-slate-400">Edit</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Sidebar Stats */}
        <div className="space-y-6">
          {/* Quick Stats */}
          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6">
            <div className="flex items-center gap-2 mb-6">
              <TrendingUp className="w-5 h-5 text-purple-400" />
              <h3 className="text-lg font-bold text-white">Quick Stats</h3>
            </div>
            <div className="space-y-4">
              <div>
                <p className="text-slate-400 text-sm mb-2">Wallet Score</p>
                <div className="w-full bg-slate-700 rounded-full h-2">
                  <div className="bg-gradient-to-r from-green-400 to-emerald-500 h-2 rounded-full w-4/5"></div>
                </div>
                <p className="text-green-400 font-bold mt-1">85/100</p>
              </div>
            </div>
          </div>

          {/* Security Status */}
          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6">
            <div className="flex items-center gap-2 mb-4">
              <Settings className="w-5 h-5 text-purple-400" />
              <h3 className="text-lg font-bold text-white">Security</h3>
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-slate-400 text-sm">2FA Enabled</span>
                <span className="text-green-400 font-medium">✓</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400 text-sm">Verified Account</span>
                <span className="text-green-400 font-medium">✓</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400 text-sm">KYC Complete</span>
                <span className="text-green-400 font-medium">✓</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 📤 SEND MONEY MODAL */}
      {activeModal === 'send' && (
        <div className="fixed inset-0 bg-black bg-opacity-50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-8 max-w-md w-full shadow-2xl">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-3 rounded-lg bg-red-500/30 border border-red-400/50">
                <Send className="w-6 h-6 text-red-400" />
              </div>
              <h2 className="text-2xl font-bold text-white">Send Money</h2>
            </div>

            {transactionResult && transactionResult.type === 'send' ? (
              <div className="text-center py-6">
                <div className="text-5xl mb-4">✅</div>
                <p className="text-white font-bold text-lg mb-2">Success!</p>
                <p className="text-slate-300 mb-4">{transactionResult.message}</p>
                <button
                  onClick={() => {
                    setActiveModal(null);
                    setTransactionResult(null);
                  }}
                  className="w-full bg-green-500 hover:bg-green-600 text-white py-3 rounded-lg font-medium transition"
                >
                  Done
                </button>
              </div>
            ) : (
              <form onSubmit={handleSendMoney} className="space-y-4">
                <div>
                  <label className="block text-slate-400 text-sm font-medium mb-2">Recipient Address or Phone</label>
                  <input
                    type="text"
                    value={sendForm.recipient}
                    onChange={(e) => setSendForm({ ...sendForm, recipient: e.target.value })}
                    placeholder="Enter recipient details"
                    className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-green-500"
                  />
                </div>

                <div>
                  <label className="block text-slate-400 text-sm font-medium mb-2">Amount ({selectedCurrency})</label>
                  <input
                    type="number"
                    value={sendForm.amount}
                    onChange={(e) => setSendForm({ ...sendForm, amount: e.target.value })}
                    placeholder="0.00"
                    className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-green-500"
                  />
                </div>

                <div>
                  <label className="block text-slate-400 text-sm font-medium mb-2">Description (Optional)</label>
                  <input
                    type="text"
                    value={sendForm.description}
                    onChange={(e) => setSendForm({ ...sendForm, description: e.target.value })}
                    placeholder="Payment for..."
                    className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-green-500"
                  />
                </div>

                <div className="flex gap-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setActiveModal(null)}
                    className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-medium transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={transactionInProgress}
                    className="flex-1 px-4 py-2 bg-red-500 hover:bg-red-600 disabled:bg-red-600 disabled:opacity-50 text-white rounded-lg font-medium transition"
                  >
                    {transactionInProgress ? 'Sending...' : 'Send'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* 📥 RECEIVE MONEY MODAL */}
      {activeModal === 'receive' && (
        <div className="fixed inset-0 bg-black bg-opacity-50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-8 max-w-md w-full shadow-2xl">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-3 rounded-lg bg-green-500/30 border border-green-400/50">
                <ArrowDownLeft className="w-6 h-6 text-green-400" />
              </div>
              <h2 className="text-2xl font-bold text-white">Receive Money</h2>
            </div>

            {transactionResult && transactionResult.type === 'receive' ? (
              <div className="text-center py-6">
                <div className="text-5xl mb-4">✅</div>
                <p className="text-white font-bold text-lg mb-2">Payment Link Ready!</p>
                <p className="text-slate-300 mb-4">{transactionResult.message}</p>
                <div className="bg-slate-800 rounded-lg p-4 mb-4 break-all">
                  <p className="text-xs text-slate-400 mb-1">Share this link:</p>
                  <p className="text-green-400 font-mono text-sm">{transactionResult.paymentLink}</p>
                </div>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(transactionResult.paymentLink);
                    alert('Payment link copied!');
                  }}
                  className="w-full bg-blue-500 hover:bg-blue-600 text-white py-2 rounded-lg font-medium transition mb-2"
                >
                  Copy Link
                </button>
                <button
                  onClick={() => {
                    setActiveModal(null);
                    setTransactionResult(null);
                  }}
                  className="w-full bg-slate-700 hover:bg-slate-600 text-white py-2 rounded-lg font-medium transition"
                >
                  Done
                </button>
              </div>
            ) : (
              <form onSubmit={handleReceiveMoney} className="space-y-4">
                <div>
                  <label className="block text-slate-400 text-sm font-medium mb-2">Amount to Receive ({selectedCurrency})</label>
                  <input
                    type="number"
                    value={receiveForm.amount}
                    onChange={(e) => setReceiveForm({ ...receiveForm, amount: e.target.value })}
                    placeholder="0.00"
                    className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-green-500"
                  />
                </div>

                <div>
                  <label className="block text-slate-400 text-sm font-medium mb-2">Description (Optional)</label>
                  <input
                    type="text"
                    value={receiveForm.description}
                    onChange={(e) => setReceiveForm({ ...receiveForm, description: e.target.value })}
                    placeholder="Payment for..."
                    className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-green-500"
                  />
                </div>

                <div className="flex gap-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setActiveModal(null)}
                    className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-medium transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={transactionInProgress}
                    className="flex-1 px-4 py-2 bg-green-500 hover:bg-green-600 disabled:bg-green-600 disabled:opacity-50 text-white rounded-lg font-medium transition"
                  >
                    {transactionInProgress ? 'Creating...' : 'Create Link'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* 💰 TOP UP MODAL */}
      {activeModal === 'topup' && (
        <div className="fixed inset-0 bg-black bg-opacity-50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-8 max-w-md w-full shadow-2xl">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-3 rounded-lg bg-blue-500/30 border border-blue-400/50">
                <Plus className="w-6 h-6 text-blue-400" />
              </div>
              <h2 className="text-2xl font-bold text-white">Top Up Wallet</h2>
            </div>

            {transactionResult && transactionResult.type === 'topup' ? (
              <div className="text-center py-6">
                <div className={`text-5xl mb-4 ${transactionResult.success ? '✅' : '❌'}`}>
                  {transactionResult.success ? '✅' : '❌'}
                </div>
                <p className={`text-white font-bold text-lg mb-2 ${transactionResult.success ? 'text-green-400' : 'text-red-400'}`}>
                  {transactionResult.success ? 'Success!' : 'Failed'}
                </p>
                <p className="text-slate-300 mb-4">{transactionResult.message}</p>
                {transactionResult.transactionId && (
                  <div className="bg-slate-800 rounded-lg p-3 mb-4 text-xs space-y-2">
                    <div>
                      <p className="text-slate-400">Transaction ID:</p>
                      <p className="text-green-400 font-mono break-all">{transactionResult.transactionId}</p>
                    </div>
                    {transactionResult.activeKey && (
                      <div>
                        <p className="text-slate-400">API Key Used:</p>
                        <p className={`font-mono break-all ${transactionResult.activeKey.includes('SECONDARY') ? 'text-yellow-400' : 'text-green-400'}`}>
                          {transactionResult.activeKey}
                        </p>
                      </div>
                    )}
                  </div>
                )}
                <button
                  onClick={() => {
                    setActiveModal(null);
                    setTransactionResult(null);
                  }}
                  className={`w-full ${transactionResult.success ? 'bg-blue-500 hover:bg-blue-600' : 'bg-red-500 hover:bg-red-600'} text-white py-3 rounded-lg font-medium transition`}
                >
                  Done
                </button>
              </div>
            ) : (
              <form onSubmit={handleTopUp} className="space-y-4">
                <div>
                  <label className="block text-slate-400 text-sm font-medium mb-2">Amount ({selectedCurrency})</label>
                  <input
                    type="text"
                    value={topupForm.amount}
                    onChange={(e) => setTopupForm({ ...topupForm, amount: e.target.value })}
                    placeholder="Enter amount"
                    className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-green-500"
                  />
                </div>

                <div className="relative">
                  {/* Collapsed Payment Method Section */}
                  <div className="flex items-center gap-3 mb-4">
                    <label className="block text-slate-400 text-sm font-medium">Payment:</label>
                    <button
                      type="button"
                      onClick={() => setShowPaymentPicker(!showPaymentPicker)}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 hover:border-blue-500 text-white transition"
                    >
                      {detectedPaymentMethod ? (
                        <>
                          <span className="text-lg">{detectedPaymentMethod.icon}</span>
                          <span className="text-sm font-medium">{detectedPaymentMethod.name}</span>
                        </>
                      ) : (
                        <>
                          <span className="text-lg">💳</span>
                          <span className="text-sm text-slate-400">Select</span>
                        </>
                      )}
                      <span className="ml-2 text-slate-400 text-xs">{showPaymentPicker ? '▲' : '▼'}</span>
                    </button>
                  </div>

                  {/* Expanded Payment Method Picker */}
                  {showPaymentPicker && (
                    <div className="absolute top-12 left-0 right-0 z-10 bg-slate-900 border border-slate-700 rounded-lg p-4 shadow-xl">
                      <p className="text-xs text-slate-500 mb-3">✨ Magic Detection: Type card, phone, or USSD code</p>
                      
                      <input
                        type="text"
                        value={topupForm.paymentInput}
                        onChange={handlePaymentInputChange}
                        placeholder="💳 Card / 📱 Phone / ⚡ USSD"
                        className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-green-500 mb-3"
                        autoFocus
                      />
                      
                      {/* Detection Feedback */}
                      {detectedPaymentMethod && (
                        <div className={`p-3 rounded-lg border-2 flex items-center gap-3 mb-3 ${
                          detectedPaymentMethod.confidence === 'high' 
                            ? 'bg-green-500/10 border-green-400/50' 
                            : 'bg-yellow-500/10 border-yellow-400/50'
                        }`}>
                          <span className="text-2xl">{detectedPaymentMethod.icon}</span>
                          <div className="flex-1">
                            <p className={`font-semibold ${
                              detectedPaymentMethod.confidence === 'high' 
                                ? 'text-green-400' 
                                : 'text-yellow-400'
                            }`}>
                              {detectedPaymentMethod.name}
                            </p>
                            <p className="text-xs text-slate-400">
                              {detectedPaymentMethod.provider} • {detectedPaymentMethod.confidence} confidence
                            </p>
                          </div>
                        </div>
                      )}
                      
                      {/* No Detection */}
                      {topupForm.paymentInput && !detectedPaymentMethod && (
                        <div className="p-3 rounded-lg border-2 bg-red-500/10 border-red-400/50 text-red-400 text-sm mb-3">
                          ❌ Payment method not recognized. Check your input.
                        </div>
                      )}

                      {/* Manual Method Selection */}
                      {!topupForm.paymentInput && (
                        <div className="mb-3">
                          <p className="font-semibold text-slate-300 mb-2 text-xs">Or Select Manually:</p>
                          <div className="grid grid-cols-2 gap-2">
                            {/* Visa */}
                            <button
                              type="button"
                              onClick={() => {
                                const visa = { method: 'visa', name: 'Visa Card', type: 'card', icon: '💳', confidence: 'high', provider: 'Flutterwave' };
                                setDetectedPaymentMethod(visa);
                                setTopupForm(prev => ({ ...prev, paymentInput: '4111111111111111', detectedMethod: visa }));
                              }}
                              className="flex flex-col items-center gap-2 p-3 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-blue-400 transition text-white"
                            >
                              <span className="text-2xl">💳</span>
                              <span className="text-xs font-medium">Visa Card</span>
                            </button>

                            {/* Mastercard */}
                            <button
                              type="button"
                              onClick={() => {
                                const mc = { method: 'mastercard', name: 'Mastercard', type: 'card', icon: '💳', confidence: 'high', provider: 'Flutterwave' };
                                setDetectedPaymentMethod(mc);
                                setTopupForm(prev => ({ ...prev, paymentInput: '5555555555554444', detectedMethod: mc }));
                              }}
                              className="flex flex-col items-center gap-2 p-3 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-blue-400 transition text-white"
                            >
                              <span className="text-2xl">💳</span>
                              <span className="text-xs font-medium">Mastercard</span>
                            </button>

                            {/* MTN */}
                            <button
                              type="button"
                              onClick={() => {
                                const mtn = { method: 'mtn', name: 'MTN Mobile Money', type: 'mobile', icon: '📱', confidence: 'high', provider: 'MOMO' };
                                setDetectedPaymentMethod(mtn);
                                setTopupForm(prev => ({ ...prev, paymentInput: '+256701234567', detectedMethod: mtn }));
                              }}
                              className="flex flex-col items-center gap-2 p-3 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-green-400 transition text-white"
                            >
                              <span className="text-2xl">📱</span>
                              <span className="text-xs font-medium">MTN</span>
                            </button>

                            {/* Airtel */}
                            <button
                              type="button"
                              onClick={() => {
                                const airtel = { method: 'airtel', name: 'Airtel Money', type: 'mobile', icon: '📱', confidence: 'high', provider: 'Airtel' };
                                setDetectedPaymentMethod(airtel);
                                setTopupForm(prev => ({ ...prev, paymentInput: '+256700123456', detectedMethod: airtel }));
                              }}
                              className="flex flex-col items-center gap-2 p-3 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-green-400 transition text-white"
                            >
                              <span className="text-2xl">📱</span>
                              <span className="text-xs font-medium">Airtel</span>
                            </button>

                            {/* USSD */}
                            <button
                              type="button"
                              onClick={() => {
                                const ussd = { method: 'ussd', name: 'USSD Code', type: 'code', icon: '⚡', confidence: 'high', provider: 'Flutterwave' };
                                setDetectedPaymentMethod(ussd);
                                setTopupForm(prev => ({ ...prev, paymentInput: '*136#', detectedMethod: ussd }));
                              }}
                              className="flex flex-col items-center gap-2 p-3 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-yellow-400 transition text-white"
                            >
                              <span className="text-2xl">⚡</span>
                              <span className="text-xs font-medium">USSD</span>
                            </button>

                            {/* Bank Transfer */}
                            <button
                              type="button"
                              onClick={() => {
                                const bank = { method: 'bank', name: 'Bank Transfer', type: 'bank', icon: '🏦', confidence: 'high', provider: 'Flutterwave' };
                                setDetectedPaymentMethod(bank);
                                setTopupForm(prev => ({ ...prev, paymentInput: 'bank_transfer', detectedMethod: bank }));
                              }}
                              className="flex flex-col items-center gap-2 p-3 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-purple-400 transition text-white"
                            >
                              <span className="text-2xl">🏦</span>
                              <span className="text-xs font-medium">Bank</span>
                            </button>
                          </div>
                        </div>
                      )}
                      
                      <button
                        type="button"
                        onClick={() => setShowPaymentPicker(false)}
                        className="w-full mt-3 px-3 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm rounded-lg transition"
                      >
                        Close
                      </button>
                    </div>
                  )}
                </div>

                <div className="flex gap-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setActiveModal(null)}
                    className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-medium transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={transactionInProgress || !detectedPaymentMethod}
                    className="flex-1 px-4 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-blue-600 disabled:opacity-50 text-white rounded-lg font-medium transition"
                  >
                    {transactionInProgress ? 'Processing...' : 'Top Up'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default ICANWallet;
