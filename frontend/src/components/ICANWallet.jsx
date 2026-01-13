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
  ChevronDown
} from 'lucide-react';

const ICANWallet = () => {
  const [showBalance, setShowBalance] = useState(true);
  const [selectedCurrency, setSelectedCurrency] = useState('USD');
  const [activeTab, setActiveTab] = useState('overview');
  const [showCurrencyDropdown, setShowCurrencyDropdown] = useState(false);
  const dropdownRef = useRef(null);

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
              <button className="bg-white/20 hover:bg-white/30 rounded-lg py-3 px-4 flex flex-col items-center gap-2 transition">
                <Send className="w-5 h-5" />
                <span className="text-sm font-medium">Send</span>
              </button>
              <button className="bg-white/20 hover:bg-white/30 rounded-lg py-3 px-4 flex flex-col items-center gap-2 transition">
                <ArrowDownLeft className="w-5 h-5" />
                <span className="text-sm font-medium">Receive</span>
              </button>
              <button className="bg-white/20 hover:bg-white/30 rounded-lg py-3 px-4 flex flex-col items-center gap-2 transition">
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
    </div>
  );
};

export default ICANWallet;
