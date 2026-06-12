import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';
import { ChevronDown, ChevronUp, AlertCircle, CheckCircle, Clock, Eye, EyeOff } from 'lucide-react';

/**
 * TitheTransactionReport - Detailed view of all transactions with tithe status
 * Shows Business/Personal separation with clear transaction names and tithe tracking
 * 
 * Features:
 * - Separate tabs for Personal and Business tithes
 * - Transaction names clearly displayed
 * - Real-time tithe status (Pending/Paid/Partially Paid)
 * - Detailed breakdown of amounts
 * - Payment history linked to source transactions
 */

export function TitheTransactionReport() {
  const [activeTab, setActiveTab] = useState('personal'); // 'personal', 'business', 'combined'
  const [transactions, setTransactions] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expandedIds, setExpandedIds] = useState(new Set());
  const [filter, setFilter] = useState('all'); // 'all', 'pending', 'paid', 'partial'

  useEffect(() => {
    loadTitheTransactions();
    loadSummary();
    
    // Refresh every 10 seconds for real-time updates
    const interval = setInterval(() => {
      loadTitheTransactions();
      loadSummary();
    }, 10000);

    return () => clearInterval(interval);
  }, [activeTab, filter]);

  const loadTitheTransactions = async () => {
    try {
      setLoading(true);
      
      let query = supabase
        .from('v_transactions_with_tithe')
        .select('*')
        .order('created_at', { ascending: false });

      // Filter by tithe type
      if (activeTab === 'personal') {
        query = query.eq('tithe_type', 'personal');
      } else if (activeTab === 'business') {
        query = query.eq('tithe_type', 'business');
      }

      // Filter by status
      if (filter === 'pending') {
        query = query.eq('tithe_status', 'pending');
      } else if (filter === 'paid') {
        query = query.eq('tithe_status', 'paid');
      } else if (filter === 'partial') {
        query = query.eq('tithe_status', 'partially_paid');
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error loading tithe transactions:', error);
        return;
      }

      setTransactions(data || []);
    } catch (error) {
      console.error('Failed to load transactions:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadSummary = async () => {
    try {
      let query;

      if (activeTab === 'personal') {
        query = supabase
          .from('v_personal_tithe_tracking')
          .select('*')
          .single();
      } else {
        query = supabase
          .from('v_business_tithe_tracking')
          .select('*')
          .single();
      }

      const { data, error } = await query;

      if (error && error.code !== 'PGRST116') {
        console.error('Error loading summary:', error);
        return;
      }

      setSummary(data || null);
    } catch (error) {
      console.error('Failed to load summary:', error);
    }
  };

  const toggleExpanded = (id) => {
    const newExpanded = new Set(expandedIds);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedIds(newExpanded);
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'paid':
        return <CheckCircle className="w-5 h-5 text-green-600" />;
      case 'partially_paid':
        return <Clock className="w-5 h-5 text-yellow-600" />;
      case 'pending':
        return <AlertCircle className="w-5 h-5 text-blue-600" />;
      default:
        return <AlertCircle className="w-5 h-5 text-gray-600" />;
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'paid':
        return 'bg-green-50 border-green-200';
      case 'partially_paid':
        return 'bg-yellow-50 border-yellow-200';
      case 'pending':
        return 'bg-blue-50 border-blue-200';
      default:
        return 'bg-gray-50 border-gray-200';
    }
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'paid':
        return <span className="inline-flex items-center gap-1 px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm font-medium">
          <CheckCircle size={14} /> Paid
        </span>;
      case 'partially_paid':
        return <span className="inline-flex items-center gap-1 px-3 py-1 bg-yellow-100 text-yellow-800 rounded-full text-sm font-medium">
          <Clock size={14} /> Partially Paid
        </span>;
      case 'pending':
        return <span className="inline-flex items-center gap-1 px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm font-medium">
          <AlertCircle size={14} /> Pending
        </span>;
      default:
        return null;
    }
  };

  return (
    <div className="w-full max-w-6xl mx-auto p-4 space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-800 text-white rounded-lg p-6 shadow-lg">
        <h1 className="text-3xl font-bold mb-2">📊 Tithe Transaction Report</h1>
        <p className="text-blue-100">
          Track every transaction and its associated tithe. Business and Personal income separated for clarity.
        </p>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-4 border-b border-gray-200">
        <button
          onClick={() => setActiveTab('personal')}
          className={`px-6 py-3 font-medium border-b-2 transition-all ${
            activeTab === 'personal'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-600 hover:text-gray-900'
          }`}
        >
          👤 Personal Income
        </button>
        <button
          onClick={() => setActiveTab('business')}
          className={`px-6 py-3 font-medium border-b-2 transition-all ${
            activeTab === 'business'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-600 hover:text-gray-900'
          }`}
        >
          💼 Business Income
        </button>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white border border-gray-200 rounded-lg p-6 shadow-sm">
            <div className="text-gray-600 text-sm font-medium mb-2">Total Tithe Owed</div>
            <div className="text-3xl font-bold text-blue-600">
              {activeTab === 'personal' ? summary.personal_tithe_total : summary.business_tithe_total}
            </div>
            <div className="text-gray-500 text-xs mt-2">
              {activeTab === 'personal' ? summary.personal_pending_count : summary.business_pending_count} pending transactions
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-lg p-6 shadow-sm">
            <div className="text-gray-600 text-sm font-medium mb-2">Already Paid</div>
            <div className="text-3xl font-bold text-green-600">
              {activeTab === 'personal' ? summary.personal_tithe_paid : summary.business_tithe_paid}
            </div>
            <div className="text-gray-500 text-xs mt-2">Cleared and completed</div>
          </div>

          <div className="bg-white border border-gray-200 rounded-lg p-6 shadow-sm">
            <div className="text-gray-600 text-sm font-medium mb-2">Still Pending</div>
            <div className="text-3xl font-bold text-yellow-600">
              {activeTab === 'personal' ? summary.personal_tithe_remaining : summary.business_tithe_remaining}
            </div>
            <div className="text-gray-500 text-xs mt-2">Needs to be paid</div>
          </div>
        </div>
      )}

      {/* Filter Buttons */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setFilter('all')}
          className={`px-4 py-2 rounded-lg font-medium transition-all ${
            filter === 'all'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          All
        </button>
        <button
          onClick={() => setFilter('pending')}
          className={`px-4 py-2 rounded-lg font-medium transition-all flex items-center gap-2 ${
            filter === 'pending'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          <AlertCircle size={16} /> Pending
        </button>
        <button
          onClick={() => setFilter('partial')}
          className={`px-4 py-2 rounded-lg font-medium transition-all flex items-center gap-2 ${
            filter === 'partial'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          <Clock size={16} /> Partially Paid
        </button>
        <button
          onClick={() => setFilter('paid')}
          className={`px-4 py-2 rounded-lg font-medium transition-all flex items-center gap-2 ${
            filter === 'paid'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          <CheckCircle size={16} /> Paid
        </button>
      </div>

      {/* Transaction List */}
      <div className="space-y-3">
        {loading ? (
          <div className="flex justify-center items-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          </div>
        ) : transactions.length === 0 ? (
          <div className="text-center py-12 bg-gray-50 rounded-lg border border-gray-200">
            <AlertCircle size={48} className="mx-auto text-gray-400 mb-3" />
            <p className="text-gray-600 font-medium">No transactions found</p>
            <p className="text-gray-500 text-sm">
              {activeTab === 'personal' ? 'Record a personal income transaction to start tracking tithes.' : 'Record a business transaction to start tracking tithes.'}
            </p>
          </div>
        ) : (
          transactions.map((transaction) => (
            <div
              key={transaction.id}
              className={`border rounded-lg p-4 transition-all cursor-pointer ${getStatusColor(transaction.tithe_status)}`}
              onClick={() => toggleExpanded(transaction.id)}
            >
              {/* Main Row */}
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-4 flex-1">
                  <div className="flex-shrink-0">
                    {getStatusIcon(transaction.tithe_status)}
                  </div>
                  <div className="flex-1">
                    <h3 className="font-bold text-gray-900">
                      {transaction.description || 'Transaction'}
                    </h3>
                    <p className="text-sm text-gray-600">
                      {new Date(transaction.created_at).toLocaleDateString()} • {transaction.recipient_name || 'Church'}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  {getStatusBadge(transaction.tithe_status)}
                  <div className="text-right min-w-[150px]">
                    <div className="font-bold text-gray-900">
                      {Number(transaction.tithe_calculated || 0).toFixed(2)}
                    </div>
                    <div className="text-sm text-gray-600">
                      {Number(transaction.tithe_remaining || 0).toFixed(2)} remaining
                    </div>
                  </div>
                  <div className="flex-shrink-0">
                    {expandedIds.has(transaction.id) ? (
                      <ChevronUp className="w-5 h-5 text-gray-600" />
                    ) : (
                      <ChevronDown className="w-5 h-5 text-gray-600" />
                    )}
                  </div>
                </div>
              </div>

              {/* Expanded Details */}
              {expandedIds.has(transaction.id) && (
                <div className="mt-4 pt-4 border-t border-gray-300 space-y-3">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div className="text-xs font-medium text-gray-600 mb-1">TRANSACTION AMOUNT</div>
                      <div className="font-bold text-lg text-gray-900">{Number(transaction.amount).toFixed(2)}</div>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-gray-600 mb-1">TITHE AMOUNT (10%)</div>
                      <div className="font-bold text-lg text-blue-600">{Number(transaction.tithe_calculated).toFixed(2)}</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div className="text-xs font-medium text-gray-600 mb-1">ALREADY PAID</div>
                      <div className="font-bold text-green-600">{Number(transaction.tithe_paid || 0).toFixed(2)}</div>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-gray-600 mb-1">STILL OWED</div>
                      <div className="font-bold text-yellow-600">{Number(transaction.tithe_remaining || 0).toFixed(2)}</div>
                    </div>
                  </div>

                  <div>
                    <div className="text-xs font-medium text-gray-600 mb-1">RECIPIENT</div>
                    <div className="text-gray-900">{transaction.recipient_name || 'Church'}</div>
                  </div>

                  {transaction.payment_transaction_id && (
                    <div className="bg-green-50 border border-green-200 rounded p-3">
                      <div className="text-xs font-medium text-green-800 mb-1">✅ PAYMENT RECEIVED</div>
                      <div className="text-sm text-green-700">
                        This tithe was paid on {transaction.paid_date ? new Date(transaction.paid_date).toLocaleDateString() : 'recently'}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Help Section */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
        <h3 className="font-bold text-blue-900 mb-2">💡 How It Works</h3>
        <ul className="space-y-2 text-blue-800 text-sm">
          <li>✅ Every income transaction is automatically tithed (10% by default)</li>
          <li>✅ Business and Personal income are tracked separately</li>
          <li>✅ When you pay tithe, it clears pending amounts automatically</li>
          <li>✅ If you pay tithe on other money, your pending tithe is NOT re-tithed</li>
          <li>✅ All transactions and payments are linked and visible here</li>
          <li>✅ Updates in real-time as transactions are recorded and paid</li>
        </ul>
      </div>
    </div>
  );
}

export default TitheTransactionReport;
