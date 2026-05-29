import React, { useState, useEffect } from 'react';
import { Trash2, Plus, BarChart3, Lock, Eye, EyeOff, Check, AlertCircle } from 'lucide-react';
import { getSupabaseClient } from '../lib/supabase';

/**
 * TitheManager Component
 * 
 * Complete tithe lifecycle management with blockchain security:
 * - Add tithes with wallet integration
 * - Remove/clear tithes and restore wallet
 * - View tithe history with filters
 * - Analytics dashboard
 * - Blockchain audit trail verification
 * - Anonymous giving support
 */

export default function TitheManager() {
  const supabase = getSupabaseClient();
  
  // ============================================================
  // STATE
  // ============================================================
  
  // Form state
  const [formMode, setFormMode] = useState('add'); // 'add' | 'view' | 'analytics' | 'audit'
  const [form, setForm] = useState({
    amount: '',
    givingType: 'tithe',
    recipientType: 'church',
    givingDate: new Date().toISOString().split('T')[0],
    notes: '',
    isAnonymous: false,
    incomeReference: ''
  });

  // Data state
  const [tithes, setTithes] = useState([]);
  const [summary, setSummary] = useState(null);
  const [auditTrail, setAuditTrail] = useState([]);
  const [chainIntegrity, setChainIntegrity] = useState(null);
  const [selectedTithe, setSelectedTithe] = useState(null);

  // UI state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [showBalance, setShowBalance] = useState(false);
  const [walletBalance, setWalletBalance] = useState(0);

  // ============================================================
  // INITIALIZATION
  // ============================================================

  useEffect(() => {
    const init = async () => {
      await Promise.all([
        fetchTithes(),
        fetchSummary(),
        fetchWalletBalance(),
        fetchChainIntegrity()
      ]);
    };
    init();
  }, []);

  // ============================================================
  // API FUNCTIONS
  // ============================================================

  const fetchWalletBalance = async () => {
    try {
      const { data, error } = await supabase
        .from('wallet_accounts')
        .select('balance')
        .eq('currency', 'UGX')
        .maybeSingle();

      if (!error && data) {
        setWalletBalance(data.balance || 0);
      }
    } catch (err) {
      console.error('Error fetching wallet balance:', err);
    }
  };

  const fetchTithes = async (startDate = null, endDate = null, givingType = null) => {
    try {
      setLoading(true);
      const { data, error } = await supabase.rpc('fn_get_user_tithes', {
        p_start_date: startDate,
        p_end_date: endDate,
        p_giving_type: givingType,
        p_limit: 100
      });

      if (error) throw error;
      setTithes(data || []);
      setError(null);
    } catch (err) {
      setError('Failed to load tithes: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchSummary = async (startDate = null, endDate = null) => {
    try {
      const { data, error } = await supabase.rpc('fn_get_tithe_summary', {
        p_start_date: startDate,
        p_end_date: endDate
      });

      if (error) throw error;
      setSummary(data?.[0] || null);
    } catch (err) {
      console.error('Error fetching summary:', err);
    }
  };

  const fetchAuditTrail = async (titheId = null) => {
    try {
      const { data, error } = await supabase.rpc('fn_get_tithe_audit_trail', {
        p_tithe_record_id: titheId,
        p_limit: 50
      });

      if (error) throw error;
      setAuditTrail(data || []);
    } catch (err) {
      console.error('Error fetching audit trail:', err);
    }
  };

  const fetchChainIntegrity = async () => {
    try {
      const { data, error } = await supabase.rpc('fn_verify_tithe_chain_integrity');

      if (error) throw error;
      setChainIntegrity(data?.[0] || null);
    } catch (err) {
      console.error('Error verifying chain:', err);
    }
  };

  // ============================================================
  // ADD TITHE
  // ============================================================

  const handleAddTithe = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const amount = parseFloat(form.amount);
      if (!amount || amount <= 0) {
        throw new Error('Please enter a valid amount');
      }

      if (amount > walletBalance) {
        throw new Error(`Insufficient balance. You have ${walletBalance} UGX`);
      }

      const { data, error } = await supabase.rpc('fn_add_tithe', {
        p_giving_type: form.givingType,
        p_amount: amount,
        p_currency: 'UGX',
        p_recipient_type: form.recipientType,
        p_recipient_name_encrypted: null,
        p_tithe_percentage: 10.0,
        p_income_reference_amount: form.incomeReference ? parseFloat(form.incomeReference) : null,
        p_giving_date: form.givingDate,
        p_notes_encrypted: form.notes,
        p_is_anonymous: form.isAnonymous
      });

      if (error) throw error;

      const result = data?.[0];
      if (!result.success) throw new Error(result.message);

      setSuccess(`✅ Tithe recorded! ${result.message}`);
      
      // Reset form and refresh data
      setForm({
        amount: '',
        givingType: 'tithe',
        recipientType: 'church',
        givingDate: new Date().toISOString().split('T')[0],
        notes: '',
        isAnonymous: false,
        incomeReference: ''
      });

      // Refresh data
      await Promise.all([
        fetchTithes(),
        fetchSummary(),
        fetchWalletBalance()
      ]);

      // Show success for 5 seconds
      setTimeout(() => setSuccess(null), 5000);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // ============================================================
  // REMOVE TITHE
  // ============================================================

  const handleRemoveTithe = async (titheId) => {
    if (!window.confirm('Are you sure you want to remove this tithe? The amount will be restored to your wallet.')) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { data, error } = await supabase.rpc('fn_remove_tithe', {
        p_tithe_record_id: titheId,
        p_reason: 'user_removal'
      });

      if (error) throw error;

      const result = data?.[0];
      if (!result.success) throw new Error(result.message);

      setSuccess(`✅ Tithe removed! ${result.message}`);
      setSelectedTithe(null);

      // Refresh data
      await Promise.all([
        fetchTithes(),
        fetchSummary(),
        fetchWalletBalance()
      ]);

      setTimeout(() => setSuccess(null), 5000);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // ============================================================
  // RENDER FUNCTIONS
  // ============================================================

  const renderAddForm = () => (
    <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-xl p-6 border border-purple-500/30 shadow-lg">
      <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
        <Plus className="w-5 h-5 text-purple-400" />
        Add Tithe Payment
      </h3>

      <form onSubmit={handleAddTithe} className="space-y-4">
        {/* Amount */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">Amount (UGX)</label>
          <div className="relative">
            <input
              type="number"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
              placeholder="Enter amount"
              min="1"
              step="1000"
              className="w-full bg-slate-700/50 border border-purple-500/30 rounded-lg px-4 py-2 text-white placeholder-gray-400 focus:outline-none focus:border-purple-500"
            />
            <span className="absolute right-3 top-2.5 text-gray-400 text-sm">
              Balance: {showBalance ? walletBalance.toLocaleString() : '••••••'}
            </span>
          </div>
        </div>

        {/* Giving Type */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">Type of Giving</label>
          <select
            value={form.givingType}
            onChange={(e) => setForm({ ...form, givingType: e.target.value })}
            className="w-full bg-slate-700/50 border border-purple-500/30 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-purple-500"
          >
            <option value="tithe">Tithe (10%)</option>
            <option value="offering">Offering</option>
            <option value="charity">Charity</option>
            <option value="mission">Mission Fund</option>
            <option value="building_fund">Building Fund</option>
            <option value="alms">Alms/Zakat</option>
            <option value="other">Other</option>
          </select>
        </div>

        {/* Recipient Type */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">Recipient</label>
          <select
            value={form.recipientType}
            onChange={(e) => setForm({ ...form, recipientType: e.target.value })}
            className="w-full bg-slate-700/50 border border-purple-500/30 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-purple-500"
          >
            <option value="church">Church</option>
            <option value="mosque">Mosque</option>
            <option value="charity">Charity Organization</option>
            <option value="individual">Individual</option>
            <option value="organization">Organization</option>
          </select>
        </div>

        {/* Date */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">Giving Date</label>
          <input
            type="date"
            value={form.givingDate}
            onChange={(e) => setForm({ ...form, givingDate: e.target.value })}
            className="w-full bg-slate-700/50 border border-purple-500/30 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-purple-500"
          />
        </div>

        {/* Income Reference (Optional) */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">Income Reference (Optional)</label>
          <input
            type="number"
            value={form.incomeReference}
            onChange={(e) => setForm({ ...form, incomeReference: e.target.value })}
            placeholder="Amount this tithe is from"
            min="0"
            className="w-full bg-slate-700/50 border border-purple-500/30 rounded-lg px-4 py-2 text-white placeholder-gray-400 focus:outline-none focus:border-purple-500"
          />
        </div>

        {/* Notes */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">Notes (Encrypted)</label>
          <textarea
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            placeholder="Add private notes..."
            rows="2"
            className="w-full bg-slate-700/50 border border-purple-500/30 rounded-lg px-4 py-2 text-white placeholder-gray-400 focus:outline-none focus:border-purple-500"
          />
        </div>

        {/* Anonymous Checkbox */}
        <label className="flex items-center gap-2 text-gray-300 cursor-pointer">
          <input
            type="checkbox"
            checked={form.isAnonymous}
            onChange={(e) => setForm({ ...form, isAnonymous: e.target.checked })}
            className="w-4 h-4"
          />
          <span className="text-sm">Keep this giving anonymous</span>
        </label>

        {/* Submit Button */}
        <button
          type="submit"
          disabled={loading || !form.amount}
          className="w-full bg-gradient-to-r from-purple-600 to-purple-500 hover:from-purple-700 hover:to-purple-600 disabled:from-gray-600 disabled:to-gray-600 text-white font-semibold py-2 rounded-lg transition"
        >
          {loading ? '⏳ Recording Tithe...' : '✅ Record Tithe'}
        </button>
      </form>
    </div>
  );

  const renderTithesList = () => (
    <div className="space-y-3">
      <h3 className="text-lg font-bold text-white flex items-center gap-2">
        <Eye className="w-5 h-5 text-purple-400" />
        Your Tithes ({tithes.length})
      </h3>

      {tithes.length === 0 ? (
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-6 text-center text-gray-400">
          <p>No tithes recorded yet</p>
        </div>
      ) : (
        tithes.map((tithe) => (
          <div
            key={tithe.tithe_id}
            className="bg-slate-800 border border-slate-700 rounded-lg p-4 hover:border-purple-500/50 transition cursor-pointer"
            onClick={() => {
              setSelectedTithe(tithe);
              fetchAuditTrail(tithe.tithe_id);
            }}
          >
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-white font-semibold">{tithe.amount.toLocaleString()} UGX</span>
                  <span className="bg-purple-500/20 text-purple-300 text-xs px-2 py-1 rounded">
                    {tithe.giving_type}
                  </span>
                  {tithe.is_anonymous && (
                    <Lock className="w-3 h-3 text-yellow-400" title="Anonymous" />
                  )}
                </div>
                <div className="text-sm text-gray-400 mt-1">
                  {tithe.recipient_type} • {new Date(tithe.giving_date).toLocaleDateString()}
                </div>
              </div>

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleRemoveTithe(tithe.tithe_id);
                }}
                disabled={loading}
                className="text-red-400 hover:text-red-300 p-2 transition"
                title="Remove tithe"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  );

  const renderAnalytics = () => (
    <div className="space-y-4">
      <h3 className="text-lg font-bold text-white flex items-center gap-2">
        <BarChart3 className="w-5 h-5 text-purple-400" />
        Tithe Analytics
      </h3>

      {summary ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
            <p className="text-gray-400 text-sm">Total Tithes</p>
            <p className="text-2xl font-bold text-white">{summary.total_tithes}</p>
          </div>

          <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
            <p className="text-gray-400 text-sm">Total Amount</p>
            <p className="text-2xl font-bold text-green-400">{summary.total_amount?.toLocaleString()} UGX</p>
          </div>

          <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
            <p className="text-gray-400 text-sm">Average Tithe</p>
            <p className="text-2xl font-bold text-purple-400">{summary.average_amount?.toLocaleString()} UGX</p>
          </div>

          <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
            <p className="text-gray-400 text-sm">Frequency (days)</p>
            <p className="text-2xl font-bold text-blue-400">{Math.round(summary.giving_frequency_days || 0)} days</p>
          </div>

          <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
            <p className="text-gray-400 text-sm">Most Common Type</p>
            <p className="text-2xl font-bold text-amber-400 capitalize">{summary.most_common_type}</p>
          </div>

          <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
            <p className="text-gray-400 text-sm">Anonymous Gifts</p>
            <p className="text-2xl font-bold text-indigo-400">{summary.anonymous_count}</p>
          </div>

          <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
            <p className="text-gray-400 text-sm">Unique Recipients</p>
            <p className="text-2xl font-bold text-cyan-400">{summary.total_recipients}</p>
          </div>

          <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
            <p className="text-gray-400 text-sm">Blockchain Verified</p>
            <p className="text-2xl font-bold text-green-400">{summary.blockchain_verified_count}</p>
          </div>
        </div>
      ) : (
        <div className="text-gray-400 text-center py-4">Loading analytics...</div>
      )}
    </div>
  );

  const renderBlockchainAudit = () => (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold text-white flex items-center gap-2">
          <Lock className="w-5 h-5 text-green-400" />
          Blockchain Audit Trail
        </h3>
        <button
          onClick={fetchChainIntegrity}
          className="text-xs bg-purple-500/20 text-purple-300 px-3 py-1 rounded hover:bg-purple-500/30 transition"
        >
          Verify Chain
        </button>
      </div>

      {chainIntegrity && (
        <div className={`p-3 rounded-lg border ${chainIntegrity.is_chain_valid ? 'bg-green-500/10 border-green-500/30' : 'bg-red-500/10 border-red-500/30'}`}>
          <div className="flex items-center gap-2">
            {chainIntegrity.is_chain_valid ? (
              <Check className="w-5 h-5 text-green-400" />
            ) : (
              <AlertCircle className="w-5 h-5 text-red-400" />
            )}
            <div className="flex-1">
              <p className={`font-semibold ${chainIntegrity.is_chain_valid ? 'text-green-400' : 'text-red-400'}`}>
                {chainIntegrity.message}
              </p>
              <p className="text-xs text-gray-400 mt-1">
                Total Records: {chainIntegrity.total_records} | Broken Links: {chainIntegrity.broken_links}
              </p>
            </div>
          </div>
        </div>
      )}

      <h4 className="text-sm font-semibold text-gray-300">Recent Actions</h4>
      {auditTrail.length === 0 ? (
        <div className="text-gray-400 text-sm text-center py-4">No audit entries yet</div>
      ) : (
        auditTrail.map((entry) => (
          <div key={entry.audit_id} className="bg-slate-800 border border-slate-700 rounded-lg p-3 text-sm">
            <div className="flex items-center justify-between mb-1">
              <span className="font-semibold text-white capitalize">{entry.action_type.replace('_', ' ')}</span>
              <span className={`text-xs px-2 py-1 rounded ${entry.chain_verified ? 'bg-green-500/20 text-green-400' : 'bg-yellow-500/20 text-yellow-400'}`}>
                {entry.chain_verified ? '✓ Verified' : '⏳ Pending'}
              </span>
            </div>
            <p className="text-gray-400">
              {entry.amount.toLocaleString()} {entry.currency}
            </p>
            <p className="text-gray-500 text-xs mt-1">
              Hash: {entry.action_hash.substring(0, 16)}...
            </p>
            <p className="text-gray-500 text-xs">
              {new Date(entry.created_at).toLocaleString()}
            </p>
          </div>
        ))
      )}
    </div>
  );

  // ============================================================
  // MAIN RENDER
  // ============================================================

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-4xl font-bold text-white mb-2 flex items-center gap-3">
            <span className="text-3xl">⛪</span>
            Tithe Management System
          </h1>
          <p className="text-gray-400">Record, track, and manage your charitable giving with blockchain security</p>
        </div>

        {/* Messages */}
        {error && (
          <div className="mb-4 p-4 bg-red-500/10 border border-red-500/30 rounded-lg text-red-300 flex items-center gap-2">
            <AlertCircle className="w-5 h-5" />
            {error}
          </div>
        )}

        {success && (
          <div className="mb-4 p-4 bg-green-500/10 border border-green-500/30 rounded-lg text-green-300 flex items-center gap-2">
            <Check className="w-5 h-5" />
            {success}
          </div>
        )}

        {/* Navigation Tabs */}
        <div className="flex gap-2 mb-6 flex-wrap">
          {[
            { id: 'add', label: '➕ Add Tithe', icon: Plus },
            { id: 'view', label: '👁️ View Tithes', icon: Eye },
            { id: 'analytics', label: '📊 Analytics', icon: BarChart3 },
            { id: 'audit', label: '🔒 Blockchain Audit', icon: Lock }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setFormMode(tab.id)}
              className={`px-4 py-2 rounded-lg font-medium transition ${
                formMode === tab.id
                  ? 'bg-purple-600 text-white'
                  : 'bg-slate-800 text-gray-300 hover:bg-slate-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Content */}
          <div className="lg:col-span-2">
            {formMode === 'add' && renderAddForm()}
            {formMode === 'view' && renderTithesList()}
            {formMode === 'analytics' && renderAnalytics()}
            {formMode === 'audit' && renderBlockchainAudit()}
          </div>

          {/* Sidebar - Wallet & Selected Tithe */}
          <div className="space-y-4">
            {/* Wallet Status */}
            <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-xl p-5 border border-purple-500/30">
              <h3 className="text-sm font-semibold text-gray-300 mb-3">WALLET BALANCE</h3>
              <div className="flex items-center gap-3">
                <div>
                  <p className="text-3xl font-bold text-white">
                    {showBalance ? walletBalance.toLocaleString() : '••••••'}
                  </p>
                  <p className="text-xs text-gray-400">UGX</p>
                </div>
                <button
                  onClick={() => setShowBalance(!showBalance)}
                  className="ml-auto p-2 hover:bg-slate-700 rounded transition"
                >
                  {showBalance ? <Eye className="w-5 h-5 text-purple-400" /> : <EyeOff className="w-5 h-5 text-gray-400" />}
                </button>
              </div>
            </div>

            {/* Selected Tithe Details */}
            {selectedTithe && (
              <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-xl p-5 border border-purple-500/30">
                <h3 className="text-sm font-semibold text-gray-300 mb-3">TITHE DETAILS</h3>
                <div className="space-y-2 text-sm">
                  <div>
                    <p className="text-gray-400">Amount</p>
                    <p className="text-white font-semibold">{selectedTithe.amount.toLocaleString()} UGX</p>
                  </div>
                  <div>
                    <p className="text-gray-400">Type</p>
                    <p className="text-white capitalize">{selectedTithe.giving_type}</p>
                  </div>
                  <div>
                    <p className="text-gray-400">Recipient</p>
                    <p className="text-white capitalize">{selectedTithe.recipient_type}</p>
                  </div>
                  <div>
                    <p className="text-gray-400">Date</p>
                    <p className="text-white">{new Date(selectedTithe.giving_date).toLocaleDateString()}</p>
                  </div>
                  <div>
                    <p className="text-gray-400">Status</p>
                    <p className={`font-semibold ${selectedTithe.blockchain_status === 'confirmed' ? 'text-green-400' : 'text-yellow-400'}`}>
                      {selectedTithe.blockchain_status}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Quick Stats */}
            {summary && (
              <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-xl p-5 border border-purple-500/30">
                <h3 className="text-sm font-semibold text-gray-300 mb-3">QUICK STATS</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-400">Total Given</span>
                    <span className="text-green-400 font-semibold">{summary.total_amount?.toLocaleString()} UGX</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Count</span>
                    <span className="text-white">{summary.total_tithes}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Frequency</span>
                    <span className="text-white">{Math.round(summary.giving_frequency_days || 0)} days</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
