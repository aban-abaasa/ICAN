import React, { useState, useEffect } from 'react';
import { Trash2, Plus, BarChart3, Lock, Eye, EyeOff, Check, AlertCircle } from 'lucide-react';
import { getSupabaseClient } from '../lib/supabase';

/**
 * TitheManager Component
 * 
 * HIGH-LEVEL DEFINITION:
 * The Tithe Management System is a comprehensive charitable giving platform that enables
 * users to track, manage, and verify their tithes, offerings, and charitable donations
 * with complete transparency and blockchain-backed immutability. It bridges financial
 * transactions (business & personal) with spiritual/charitable giving, maintaining an
 * immutable audit trail for accountability, tax compliance, and personal record-keeping.
 * 
 * KEY CAPABILITIES:
 * ✅ Add tithes with wallet integration (business/personal filtering)
 * ✅ Pay tithes from filtered transactions (business or personal income)
 * ✅ Remove/reverse tithes and restore wallet
 * ✅ View tithe history with date & type filters
 * ✅ Analytics dashboard (frequency, recipients, totals)
 * ✅ Blockchain audit trail with SHA256 immutability verification
 * ✅ Anonymous giving support for privacy
 * ✅ Transaction categorization (business vs personal income sources)
 */

export default function TitheManager() {
  const supabase = getSupabaseClient();
  
  // ============================================================
  // STATE
  // ============================================================
  
  // Form state
  const [formMode, setFormMode] = useState('add'); // 'add' | 'settle' | 'pay' | 'view' | 'analytics' | 'audit'
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
  const [unpaidTithes, setUnpaidTithes] = useState([]);
  const [summary, setSummary] = useState(null);
  const [auditTrail, setAuditTrail] = useState([]);
  const [chainIntegrity, setChainIntegrity] = useState(null);
  const [selectedTithe, setSelectedTithe] = useState(null);
  const [selectedForPayment, setSelectedForPayment] = useState([]);

  // UI state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [showBalance, setShowBalance] = useState(false);
  const [walletBalance, setWalletBalance] = useState(0);

  // 🙏 Tithe Calculator state
  const [calcIncomeTx, setCalcIncomeTx]   = useState([]);
  const [calcTitheMap, setCalcTitheMap]   = useState({}); // txId → [{amount, giving_type, date}]
  const [calcSelected, setCalcSelected]   = useState(null); // selected transaction
  const [calcForm, setCalcForm]           = useState({ amount: '', givingType: 'tithe', recipientType: 'church', isAnonymous: false });
  const [calcLoading, setCalcLoading]     = useState(false);
  const [calcMsg, setCalcMsg]             = useState(null); // { type: 'ok'|'err', text }

  // ============================================================
  // INITIALIZATION
  // ============================================================

  useEffect(() => {
    const init = async () => {
      await Promise.all([
        fetchTithes(),
        fetchUnpaidTithes(),
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

  const fetchCurrentTitheOwed = async () => {
    try {
      const { data, error } = await supabase.rpc('fn_get_current_tithe_owed');
      
      if (error) throw error;
      
      // Update the summary with actual tithe owed from database
      if (data && data[0]) {
        const titheData = data[0];
        setSummary(prev => ({
          ...prev,
          personalTithe: titheData.personal_tithe_owed,
          businessTithe: titheData.business_tithe_owed,
          combinedTithe: titheData.combined_tithe_owed,
          totalTithe: titheData.total_tithe_owed,
          lastPaymentDate: titheData.last_payment_date
        }));
      }
    } catch (err) {
      console.error('Error fetching current tithe owed:', err);
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

  const fetchFilteredTransactions = async (type = 'all') => {
    try {
      setLoading(true);
      
      // Query ican_financial_transactions filtered by transaction_type
      let query = supabase
        .from('ican_financial_transactions')
        .select('id, amount, currency, transaction_type, description, created_at, source_type')
        .eq('transaction_status', 'completed')
        .order('created_at', { ascending: false })
        .limit(50);

      // Filter by transaction type (business or personal)
      if (type === 'business') {
        query = query.eq('transaction_type', 'business');
      } else if (type === 'personal') {
        query = query.eq('transaction_type', 'personal');
      }

      const { data, error } = await query;

      if (error) throw error;
      setFilteredTransactions(data || []);
      setError(null);
    } catch (err) {
      setError('Failed to load transactions: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchUnpaidTithes = async () => {
    try {
      // Query tithes that haven't been marked as paid yet
      const { data, error } = await supabase
        .from('ican_tithe_records')
        .select('id, tithe_id, amount, currency, giving_type, recipient_type, giving_date, created_at, is_anonymous')
        .neq('blockchain_status', 'removed')
        .eq('payment_status', 'pending')
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) {
        // If column doesn't exist, try without payment_status filter
        const { data: fallbackData, error: fallbackError } = await supabase
          .from('ican_tithe_records')
          .select('id, tithe_id, amount, currency, giving_type, recipient_type, giving_date, created_at, is_anonymous')
          .neq('blockchain_status', 'removed')
          .order('created_at', { ascending: false })
          .limit(100);

        if (fallbackError) throw fallbackError;
        setUnpaidTithes(fallbackData || []);
      } else {
        setUnpaidTithes(data || []);
      }
    } catch (err) {
      console.error('Error fetching unpaid tithes:', err);
      // If table query fails, fetch all and filter locally
      try {
        const { data } = await supabase
          .from('ican_tithe_records')
          .select('*')
          .neq('blockchain_status', 'removed')
          .limit(100);
        setUnpaidTithes(data || []);
      } catch {}
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
        fetchCurrentTitheOwed(),
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
  // PAY TITHE FROM TRANSACTION
  // ============================================================

  const handlePayTitheFromTransaction = async (e) => {
    e.preventDefault();

    if (!selectedTransaction) {
      setError('Please select a transaction to pay tithe from');
      return;
    }

    if (!form.amount || parseFloat(form.amount) <= 0) {
      setError('Please enter a valid tithe amount');
      return;
    }

    const amount = parseFloat(form.amount);
    if (amount > selectedTransaction.amount) {
      setError(`Tithe amount cannot exceed transaction amount (${selectedTransaction.amount} ${selectedTransaction.currency})`);
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const { data, error } = await supabase.rpc('fn_add_tithe', {
        p_giving_type: form.givingType,
        p_amount: amount,
        p_currency: selectedTransaction.currency,
        p_recipient_type: form.recipientType,
        p_recipient_name_encrypted: null,
        p_tithe_percentage: (amount / selectedTransaction.amount * 100).toFixed(1),
        p_income_reference_amount: selectedTransaction.amount,
        p_giving_date: form.givingDate,
        p_notes_encrypted: form.notes || `From ${transactionFilter} transaction`,
        p_is_anonymous: form.isAnonymous
      });

      if (error) throw error;

      const result = data?.[0];
      if (!result.success) throw new Error(result.message);

      setSuccess(`✅ Tithe paid! ${result.message}`);

      // Reset form and refresh
      setForm({
        amount: '',
        givingType: 'tithe',
        recipientType: 'church',
        givingDate: new Date().toISOString().split('T')[0],
        notes: '',
        isAnonymous: false,
        incomeReference: ''
      });
      setSelectedTransaction(null);

      await Promise.all([
        fetchTithes(),
        fetchSummary(),
        fetchCurrentTitheOwed(),
        fetchWalletBalance(),
        fetchFilteredTransactions(transactionFilter)
      ]);

      setTimeout(() => setSuccess(null), 5000);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // ============================================================
  // SETTLE/PAY TITHES - Clear & Record in Reports
  // ============================================================

  const handleSettleTithes = async () => {
    if (selectedForPayment.length === 0) {
      setError('Please select at least one tithe to settle');
      return;
    }

    const totalAmount = selectedForPayment.reduce((sum, tithe) => sum + tithe.amount, 0);

    if (!window.confirm(`Settle ${selectedForPayment.length} tithe(s) for total ${totalAmount.toLocaleString()} UGX? This will record them in your financial reports.`)) {
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      // Mark each tithe as paid and create report records
      const settlePromises = selectedForPayment.map(async (tithe) => {
        // Update tithe status to paid
        const { error: updateError } = await supabase
          .from('ican_tithe_records')
          .update({
            blockchain_status: 'settled',
            payment_status: 'paid',
            settled_date: new Date().toISOString()
          })
          .eq('id', tithe.id);

        if (updateError) throw updateError;

        // Create financial report entry
        const { error: reportError } = await supabase
          .from('ican_transactions')
          .insert({
            user_id: (await supabase.auth.getUser()).data.user?.id,
            amount: tithe.amount,
            currency: tithe.currency,
            transaction_type: 'tithe',
            description: `${tithe.giving_type.charAt(0).toUpperCase() + tithe.giving_type.slice(1)} to ${tithe.recipient_type}`,
            status: 'completed',
            metadata: {
              payment_type: 'personal',
              tithe_type: tithe.giving_type,
              entry_mode: 'tithe-pay-in',
              recorded_date: new Date().toISOString(),
              tithe_id: tithe.id,
              giving_type: tithe.giving_type,
              recipient_type: tithe.recipient_type,
              is_anonymous: tithe.is_anonymous,
              record_category: 'tithe'
            }
          });

        if (reportError) throw reportError;

        return { titheId: tithe.id, success: true };
      });

      await Promise.all(settlePromises);

      setSuccess(`✅ Settled ${selectedForPayment.length} tithe(s) for ${totalAmount.toLocaleString()} UGX - Recorded in reports!`);
      setSelectedForPayment([]);

      // Refresh all data including current tithe owed from database
      await Promise.all([
        fetchTithes(),
        fetchUnpaidTithes(),
        fetchSummary(),
        fetchCurrentTitheOwed(),
        fetchWalletBalance()
      ]);

      setTimeout(() => setSuccess(null), 5000);
    } catch (err) {
      setError(`Failed to settle tithes: ${err.message}`);
      console.error('Settlement error:', err);
    } finally {
      setLoading(false);
    }
  };

  // ============================================================
  // 🙏 TITHE CALCULATOR — FETCH & PAY
  // ============================================================

  const fetchCalcData = async () => {
    try {
      setCalcLoading(true);

      // 1. Income transactions from the main daily-recording table
      const { data: { user } } = await supabase.auth.getUser();
      const { data: txData } = await supabase
        .from('ican_transactions')
        .select('id, description, amount, transaction_type, record_category, metadata, created_at')
        .eq('user_id', user.id)
        .eq('transaction_type', 'income')
        .order('created_at', { ascending: false })
        .limit(200);

      setCalcIncomeTx(txData || []);

      // 2. All tithe records — parse TX:{id} from notes to build the map
      const { data: titheData } = await supabase.rpc('fn_get_user_tithes', {
        p_start_date: null, p_end_date: null, p_giving_type: null, p_limit: 500
      });

      const map = {};
      (titheData || []).forEach(t => {
        const notes = t.notes_encrypted || t.notes || '';
        const m = String(notes).match(/TX:([a-z0-9\-]+)/i);
        if (m) {
          const id = m[1];
          if (!map[id]) map[id] = [];
          map[id].push({ amount: t.amount, giving_type: t.giving_type, date: t.giving_date });
        }
      });
      setCalcTitheMap(map);
    } catch (err) {
      console.error('Calc fetch error', err);
    } finally {
      setCalcLoading(false);
    }
  };

  const handleCalcPayTithe = async () => {
    if (!calcSelected) return;
    const amount = parseFloat(calcForm.amount);
    if (!amount || amount <= 0) { setCalcMsg({ type: 'err', text: 'Enter a valid amount' }); return; }
    if (amount > calcSelected.amount) { setCalcMsg({ type: 'err', text: `Cannot exceed income amount (${calcSelected.amount?.toLocaleString()} UGX)` }); return; }

    setCalcLoading(true);
    setCalcMsg(null);
    try {
      const { data, error } = await supabase.rpc('fn_add_tithe', {
        p_giving_type: calcForm.givingType,
        p_amount: amount,
        p_currency: 'UGX',
        p_recipient_type: calcForm.recipientType,
        p_recipient_name_encrypted: null,
        p_tithe_percentage: parseFloat((amount / calcSelected.amount * 100).toFixed(1)),
        p_income_reference_amount: calcSelected.amount,
        p_giving_date: new Date(calcSelected.created_at).toISOString().split('T')[0],
        // Store transaction ID silently in notes — blockchain picks it up
        p_notes_encrypted: `TX:${calcSelected.id}|${calcSelected.description || ''}|${calcForm.givingType}`,
        p_is_anonymous: calcForm.isAnonymous
      });
      if (error) throw error;
      const result = data?.[0];
      if (!result?.success) throw new Error(result?.message || 'Failed');

      // Update local map without refetching
      setCalcTitheMap(prev => {
        const existing = prev[calcSelected.id] || [];
        return { ...prev, [calcSelected.id]: [...existing, { amount, giving_type: calcForm.givingType, date: new Date().toISOString() }] };
      });

      setCalcMsg({ type: 'ok', text: `✅ ${(amount).toLocaleString()} UGX tithe recorded — blockchain secured` });
      setCalcForm(f => ({ ...f, amount: '' }));
      setTimeout(() => { setCalcSelected(null); setCalcMsg(null); }, 2500);
    } catch (err) {
      setCalcMsg({ type: 'err', text: err.message || 'Payment failed' });
    } finally {
      setCalcLoading(false);
    }
  };

  // ============================================================
  // RENDER FUNCTIONS
  // ============================================================

  const renderSettleTithes = () => (
    <div className="space-y-4">
      <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-xl p-6 border border-purple-500/30 shadow-lg">
        <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
          <span>💰</span>
          Settle & Record Tithes
        </h3>
        <p className="text-gray-400 text-sm mb-4">
          Mark tithes as paid and record them in your financial reports for tax and accountability purposes.
        </p>

        {/* Summary */}
        {selectedForPayment.length > 0 && (
          <div className="bg-slate-700/50 rounded-lg p-4 mb-4 border border-slate-600">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-400 text-sm">Selected for Settlement</p>
                <p className="text-2xl font-bold text-green-400">{selectedForPayment.reduce((sum, t) => sum + t.amount, 0).toLocaleString()} UGX</p>
                <p className="text-xs text-gray-500 mt-1">{selectedForPayment.length} tithe(s)</p>
              </div>
              <button
                onClick={handleSettleTithes}
                disabled={loading || selectedForPayment.length === 0}
                className="px-6 py-2 bg-gradient-to-r from-green-600 to-green-500 hover:from-green-700 hover:to-green-600 disabled:from-gray-600 disabled:to-gray-600 text-white font-semibold rounded-lg transition"
              >
                {loading ? '⏳ Settling...' : '✅ Settle & Record'}
              </button>
            </div>
          </div>
        )}

        {/* Unpaid Tithes List */}
        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-gray-300 mb-3">Unpaid Tithes</h4>
          
          {unpaidTithes.length === 0 ? (
            <div className="bg-slate-700/50 rounded-lg p-6 text-center text-gray-400">
              <p>✅ All tithes settled! No unpaid tithes.</p>
            </div>
          ) : (
            unpaidTithes.map((tithe) => (
              <div
                key={tithe.id}
                onClick={() => {
                  const isSelected = selectedForPayment.some(t => t.id === tithe.id);
                  if (isSelected) {
                    setSelectedForPayment(selectedForPayment.filter(t => t.id !== tithe.id));
                  } else {
                    setSelectedForPayment([...selectedForPayment, tithe]);
                  }
                }}
                className={`p-4 rounded-lg border transition cursor-pointer ${
                  selectedForPayment.some(t => t.id === tithe.id)
                    ? 'border-green-500 bg-green-500/10'
                    : 'border-slate-700 bg-slate-700/50 hover:border-purple-500/50'
                }`}
              >
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={selectedForPayment.some(t => t.id === tithe.id)}
                    onChange={() => {}}
                    className="w-5 h-5 cursor-pointer"
                  />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-white font-semibold">{tithe.amount.toLocaleString()} {tithe.currency}</span>
                      <span className="bg-purple-500/20 text-purple-300 text-xs px-2 py-1 rounded capitalize">
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
                  <span className="text-xs bg-yellow-500/20 text-yellow-300 px-2 py-1 rounded">
                    Pending
                  </span>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Info Box */}
        <div className="mt-6 p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg">
          <p className="text-sm text-blue-300">
            <strong>📋 What happens when you settle?</strong><br />
            Selected tithes are marked as paid, recorded in your financial reports (for tax purposes), and cleared from the pending list. This creates an immutable audit trail in your reports.
          </p>
        </div>
      </div>
    </div>
  );

  const renderPayTithe = () => (
    <div className="space-y-4">
      {/* Transaction Filter */}
      <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-xl p-6 border border-purple-500/30 shadow-lg">
        <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
          <span>💳</span>
          Select Transaction to Pay Tithe From
        </h3>

        {/* Filter Tabs */}
        <div className="flex gap-2 mb-4">
          {[
            { id: 'all', label: 'All Transactions' },
            { id: 'business', label: '🏢 Business Income' },
            { id: 'personal', label: '👤 Personal Income' }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => {
                setTransactionFilter(tab.id);
                fetchFilteredTransactions(tab.id);
              }}
              className={`px-4 py-2 rounded-lg font-medium transition ${
                transactionFilter === tab.id
                  ? 'bg-purple-600 text-white'
                  : 'bg-slate-700 text-gray-300 hover:bg-slate-600'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Transactions List */}
        <div className="space-y-2 mb-4 max-h-64 overflow-y-auto">
          {filteredTransactions.length === 0 ? (
            <div className="text-gray-400 text-center py-4">No transactions found</div>
          ) : (
            filteredTransactions.map((transaction) => (
              <div
                key={transaction.id}
                onClick={() => {
                  setSelectedTransaction(transaction);
                  setForm({
                    ...form,
                    incomeReference: transaction.amount,
                    givingDate: new Date(transaction.created_at).toISOString().split('T')[0]
                  });
                }}
                className={`p-3 rounded-lg border transition cursor-pointer ${
                  selectedTransaction?.id === transaction.id
                    ? 'border-purple-500 bg-purple-500/10'
                    : 'border-slate-700 bg-slate-700/50 hover:border-purple-500/50'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <p className="text-white font-semibold">{transaction.amount.toLocaleString()} {transaction.currency}</p>
                    <p className="text-xs text-gray-400 mt-1">
                      {transaction.description || transaction.source_type} • {new Date(transaction.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded font-semibold ${
                    transaction.transaction_type === 'business'
                      ? 'bg-blue-500/20 text-blue-300'
                      : 'bg-green-500/20 text-green-300'
                  }`}>
                    {transaction.transaction_type}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Tithe Payment Form */}
      {selectedTransaction && (
        <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-xl p-6 border border-purple-500/30 shadow-lg">
          <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
            <span>✨</span>
            Calculate & Pay Tithe
          </h3>

          <form onSubmit={handlePayTitheFromTransaction} className="space-y-4">
            {/* Selected Transaction Summary */}
            <div className="bg-slate-700/50 rounded-lg p-3 border border-slate-600">
              <p className="text-xs text-gray-400 mb-1">From Selected Transaction:</p>
              <p className="text-white font-semibold">{selectedTransaction.amount.toLocaleString()} {selectedTransaction.currency}</p>
              <p className="text-xs text-gray-400 mt-1">Type: <span className="capitalize text-purple-300">{selectedTransaction.transaction_type}</span></p>
            </div>

            {/* Tithe Amount */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Tithe Amount</label>
              <div className="flex gap-2">
                <input
                  type="number"
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  placeholder="Enter tithe amount"
                  min="1"
                  max={selectedTransaction.amount}
                  step="1"
                  className="flex-1 bg-slate-700/50 border border-purple-500/30 rounded-lg px-4 py-2 text-white placeholder-gray-400 focus:outline-none focus:border-purple-500"
                />
                <button
                  type="button"
                  onClick={() => setForm({ ...form, amount: Math.round(selectedTransaction.amount * 0.1) })}
                  className="px-3 py-2 bg-purple-500/20 text-purple-300 rounded-lg hover:bg-purple-500/30 transition text-sm"
                  title="10% tithe"
                >
                  10%
                </button>
                <button
                  type="button"
                  onClick={() => setForm({ ...form, amount: selectedTransaction.amount })}
                  className="px-3 py-2 bg-purple-500/20 text-purple-300 rounded-lg hover:bg-purple-500/30 transition text-sm"
                  title="Full amount"
                >
                  100%
                </button>
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
              </select>
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
              className="w-full bg-gradient-to-r from-green-600 to-green-500 hover:from-green-700 hover:to-green-600 disabled:from-gray-600 disabled:to-gray-600 text-white font-semibold py-2 rounded-lg transition"
            >
              {loading ? '⏳ Processing...' : '✅ Pay Tithe'}
            </button>
          </form>
        </div>
      )}
    </div>
  );

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

  const renderCalculator = () => {
    const totalIncome  = calcIncomeTx.reduce((s, t) => s + (t.amount || 0), 0);
    const titheOwed    = totalIncome * 0.1;
    const tithePaid    = Object.values(calcTitheMap).flat().reduce((s, r) => s + (r.amount || 0), 0);
    const titheRemains = Math.max(0, titheOwed - tithePaid);

    const fmtUGX = (n) => `UGX ${(n || 0).toLocaleString()}`;

    // All tithe payment history
    const history = Object.entries(calcTitheMap)
      .flatMap(([txId, recs]) => recs.map(r => ({
        ...r,
        txDesc: calcIncomeTx.find(t => t.id === txId)?.description || 'Income'
      })))
      .sort((a, b) => new Date(b.date) - new Date(a.date));

    return (
      <div className="space-y-5">
        {/* ── Hero header ── */}
        <div className="rounded-2xl p-5 border border-amber-500/20" style={{ background: 'linear-gradient(135deg, #1c1008 0%, #2d1a00 100%)' }}>
          <h2 className="text-2xl font-extrabold text-amber-300 mb-0.5">🙏 Tithe Calculator</h2>
          <p className="text-xs text-amber-700/80 font-medium tracking-wide uppercase">Steward faithfully · Uganda Giving Tracker</p>

          {calcLoading && calcIncomeTx.length === 0 && (
            <p className="text-xs text-amber-500/60 mt-3 animate-pulse">Loading your income records…</p>
          )}
        </div>

        {/* ── 4 summary cards ── */}
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: 'Total Income',    value: fmtUGX(totalIncome),  sub: `${calcIncomeTx.length} records`,                 color: 'text-green-300',  border: 'border-green-500/20',  bg: 'bg-green-500/5'  },
            { label: '10% Tithe Due',   value: fmtUGX(titheOwed),    sub: 'based on all income',                            color: 'text-amber-300',  border: 'border-amber-500/20',  bg: 'bg-amber-500/5'  },
            { label: 'Total Paid',      value: fmtUGX(tithePaid),    sub: `${history.length} payment(s) recorded`,         color: 'text-purple-300', border: 'border-purple-500/20', bg: 'bg-purple-500/5' },
            { label: 'Still Owed',      value: fmtUGX(titheRemains), sub: titheRemains <= 0 ? '🎉 All clear!' : 'to give', color: titheRemains <= 0 ? 'text-green-400' : 'text-rose-300', border: titheRemains <= 0 ? 'border-green-500/20' : 'border-rose-500/20', bg: titheRemains <= 0 ? 'bg-green-500/5' : 'bg-rose-500/5' },
          ].map(c => (
            <div key={c.label} className={`rounded-xl border p-4 ${c.bg} ${c.border}`}>
              <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">{c.label}</p>
              <p className={`text-base font-bold ${c.color}`}>{c.value}</p>
              <p className="text-[10px] text-gray-600 mt-0.5">{c.sub}</p>
            </div>
          ))}
        </div>

        {/* ── Income transactions list ── */}
        <div>
          <h3 className="text-sm font-bold text-gray-300 mb-2 uppercase tracking-wider">Income Transactions</h3>

          {calcIncomeTx.length === 0 ? (
            <div className="rounded-xl border border-slate-700 bg-slate-800/40 p-6 text-center text-gray-500 text-sm">
              No income transactions found.
            </div>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto pr-0.5">
              {calcIncomeTx.map(t => {
                const paid     = calcTitheMap[t.id] || [];
                const paidAmt  = paid.reduce((s, r) => s + (r.amount || 0), 0);
                const due      = Math.round(t.amount * 0.1);
                const isSel    = calcSelected?.id === t.id;
                const isBiz    = (t.record_category || t.metadata?.record_category) === 'business';

                return (
                  <button
                    key={t.id}
                    onClick={() => {
                      setCalcSelected(isSel ? null : t);
                      setCalcForm(f => ({ ...f, amount: isSel ? '' : String(due) }));
                      setCalcMsg(null);
                    }}
                    className={`w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-all ${
                      isSel
                        ? 'border-amber-500/50 bg-amber-500/10'
                        : 'border-slate-700/40 bg-slate-800/40 hover:border-amber-500/25'
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{
                          background: isBiz ? 'rgba(59,130,246,0.15)' : 'rgba(168,85,247,0.15)',
                          color: isBiz ? '#93c5fd' : '#d8b4fe'
                        }}>
                          {isBiz ? '🏢' : '👤'}
                        </span>
                        <p className="text-sm font-semibold text-white truncate">{t.description || 'Income'}</p>
                      </div>
                      <p className="text-[10px] text-gray-500 mt-0.5">
                        {fmtUGX(t.amount)} · 10% = <span className="text-amber-400/80">{fmtUGX(due)}</span>
                        {paidAmt > 0 && <span className="text-green-400 ml-1.5">· Paid {fmtUGX(paidAmt)}</span>}
                      </p>
                    </div>
                    <span className={`text-[10px] font-bold px-2 py-1 rounded-lg flex-shrink-0 ${
                      paidAmt >= due ? 'bg-green-500/15 text-green-400' : paidAmt > 0 ? 'bg-amber-500/15 text-amber-300' : 'bg-slate-700/60 text-gray-400'
                    }`}>
                      {paidAmt >= due ? '✓ Done' : paidAmt > 0 ? 'Partial' : 'Unpaid'}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Pay form (inline, only when a transaction is selected) ── */}
        {calcSelected && (
          <div className="rounded-xl border border-amber-500/25 p-4" style={{ background: 'rgba(120,53,15,0.12)' }}>
            <p className="text-xs font-semibold text-amber-400 mb-3">
              Paying tithe from: <span className="text-white font-normal">{calcSelected.description || 'Income'} — {fmtUGX(calcSelected.amount)}</span>
            </p>

            {/* Amount + quick % buttons */}
            <div className="flex gap-2 mb-3">
              <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-xl border border-amber-500/25 bg-slate-900/60">
                <span className="text-xs text-gray-500 flex-shrink-0">UGX</span>
                <input
                  type="number"
                  value={calcForm.amount}
                  onChange={e => setCalcForm(f => ({ ...f, amount: e.target.value }))}
                  placeholder="Amount"
                  inputMode="numeric"
                  className="flex-1 bg-transparent text-sm text-white outline-none"
                />
              </div>
              <button onClick={() => setCalcForm(f => ({ ...f, amount: String(Math.round(calcSelected.amount * 0.1)) }))}
                className="px-3 py-2 rounded-xl bg-amber-500/15 text-amber-300 text-xs font-bold border border-amber-500/20 hover:bg-amber-500/25 transition">10%</button>
              <button onClick={() => setCalcForm(f => ({ ...f, amount: String(Math.round(calcSelected.amount * 0.05)) }))}
                className="px-3 py-2 rounded-xl bg-slate-700/60 text-gray-300 text-xs font-bold border border-slate-600/30 hover:bg-slate-700 transition">5%</button>
            </div>

            {/* Giving type + Recipient */}
            <div className="flex gap-2 mb-3">
              <select value={calcForm.givingType} onChange={e => setCalcForm(f => ({ ...f, givingType: e.target.value }))}
                className="flex-1 bg-slate-800/80 border border-slate-700/50 rounded-xl px-3 py-2 text-xs text-white outline-none">
                <option value="tithe">Tithe (10%)</option>
                <option value="offering">Offering</option>
                <option value="charity">Charity</option>
                <option value="mission">Mission Fund</option>
                <option value="building_fund">Building Fund</option>
                <option value="alms">Alms / Zakat</option>
              </select>
              <select value={calcForm.recipientType} onChange={e => setCalcForm(f => ({ ...f, recipientType: e.target.value }))}
                className="flex-1 bg-slate-800/80 border border-slate-700/50 rounded-xl px-3 py-2 text-xs text-white outline-none">
                <option value="church">Church</option>
                <option value="mosque">Mosque</option>
                <option value="charity">Charity Org</option>
                <option value="individual">Individual</option>
              </select>
            </div>

            {/* Anonymous toggle */}
            <label className="flex items-center gap-2 mb-3 cursor-pointer select-none">
              <div
                onClick={() => setCalcForm(f => ({ ...f, isAnonymous: !f.isAnonymous }))}
                className={`w-9 h-5 rounded-full transition-all flex items-center px-0.5 flex-shrink-0 ${calcForm.isAnonymous ? 'bg-amber-500 justify-end' : 'bg-slate-700 justify-start'}`}
              >
                <div className="w-4 h-4 rounded-full bg-white shadow" />
              </div>
              <span className="text-xs text-gray-400">Give anonymously</span>
            </label>

            {/* Feedback */}
            {calcMsg && (
              <div className={`text-xs text-center py-2 px-3 rounded-lg mb-2 font-medium ${calcMsg.type === 'ok' ? 'bg-green-500/15 text-green-300' : 'bg-red-500/15 text-red-300'}`}>
                {calcMsg.text}
              </div>
            )}

            <button
              onClick={handleCalcPayTithe}
              disabled={calcLoading || !calcForm.amount}
              className="w-full py-3 rounded-xl font-bold text-sm transition-all active:scale-95 disabled:opacity-50 text-white"
              style={{ background: 'linear-gradient(135deg, #b45309 0%, #78350f 100%)' }}
            >
              {calcLoading ? '⏳ Recording on blockchain…' : `🙏 Pay ${calcForm.amount ? `UGX ${parseFloat(calcForm.amount || 0).toLocaleString()}` : 'Tithe'}`}
            </button>
          </div>
        )}

        {/* ── Payment history ── */}
        {history.length > 0 && (
          <div>
            <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-2">Payment History</h3>
            <div className="space-y-1.5">
              {history.map((r, i) => (
                <div key={i} className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-slate-800/40 border border-slate-700/30">
                  <span className="text-base flex-shrink-0">🙏</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-white truncate">{r.txDesc}</p>
                    <p className="text-[10px] text-gray-500 capitalize mt-0.5">
                      {r.giving_type} · {new Date(r.date).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })}
                    </p>
                  </div>
                  <p className="text-sm font-bold text-amber-300 flex-shrink-0">{fmtUGX(r.amount)}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

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
            { id: 'settle', label: '💰 Settle Tithes', icon: Plus },
            { id: 'pay', label: '💳 Pay Tithe', icon: Plus },
            { id: 'view', label: '👁️ View Tithes', icon: Eye },
            { id: 'analytics', label: '📊 Analytics', icon: BarChart3 },
            { id: 'audit', label: '🔒 Blockchain Audit', icon: Lock }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => {
                setFormMode(tab.id);
                if (tab.id === 'pay') {
                  fetchFilteredTransactions(transactionFilter);
                } else if (tab.id === 'settle') {
                  fetchUnpaidTithes();
                }
              }}
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
            {formMode === 'settle' && renderSettleTithes()}
            {formMode === 'pay' && renderPayTithe()}
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
