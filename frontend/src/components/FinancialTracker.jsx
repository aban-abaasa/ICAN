/**
 * FinancialTracker - Shows all transactions and financial history for a group
 * Includes blockchain verification and detailed tracking
 */

import React, { useState, useEffect } from 'react';
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  Zap,
  Calendar,
  Download,
  Filter,
  Search,
  CheckCircle,
  Clock
} from 'lucide-react';

const FinancialTracker = ({ groupId, userId, transactions = [] }) => {
  const [filteredTransactions, setFilteredTransactions] = useState(transactions);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [sortBy, setSortBy] = useState('date-desc');

  useEffect(() => {
    let filtered = transactions;

    // Filter by type
    if (filterType !== 'all') {
      filtered = filtered.filter(tx => tx.type === filterType);
    }

    // Search by description or amount
    if (searchTerm) {
      filtered = filtered.filter(
        tx =>
          tx.description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
          tx.amount.toString().includes(searchTerm)
      );
    }

    // Sort
    if (sortBy === 'date-desc') {
      filtered = filtered.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    } else if (sortBy === 'date-asc') {
      filtered = filtered.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    } else if (sortBy === 'amount-high') {
      filtered = filtered.sort((a, b) => b.amount - a.amount);
    } else if (sortBy === 'amount-low') {
      filtered = filtered.sort((a, b) => a.amount - b.amount);
    }

    setFilteredTransactions(filtered);
  }, [transactions, filterType, searchTerm, sortBy]);

  // Calculate statistics
  const stats = {
    totalContributed: transactions
      .filter(tx => tx.type === 'contribution')
      .reduce((sum, tx) => sum + tx.amount, 0),
    totalInterest: transactions
      .filter(tx => tx.type === 'interest')
      .reduce((sum, tx) => sum + tx.amount, 0),
    totalWithdrawn: transactions
      .filter(tx => tx.type === 'withdrawal')
      .reduce((sum, tx) => sum + tx.amount, 0),
    transactionCount: transactions.length
  };

  const handleExport = () => {
    const csv = [
      ['Date', 'Type', 'Amount', 'Description', 'Blockchain Hash'],
      ...filteredTransactions.map(tx => [
        new Date(tx.created_at).toLocaleString(),
        tx.type,
        `$${tx.amount.toFixed(2)}`,
        tx.description || '',
        tx.blockchain_hash ? `${tx.blockchain_hash.slice(0, 16)}...` : 'N/A'
      ])
    ]
      .map(row => row.join(','))
      .join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `financial-report-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  };

  return (
    <div className="space-y-6">
      {/* Statistics Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-gradient-to-br from-blue-500/20 to-blue-600/10 border border-blue-400/30 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <DollarSign className="w-4 h-4 text-blue-400" />
            <span className="text-xs text-gray-400">Total Contributed</span>
          </div>
          <div className="text-2xl font-bold text-blue-300">${stats.totalContributed.toFixed(2)}</div>
        </div>

        <div className="bg-gradient-to-br from-green-500/20 to-green-600/10 border border-green-400/30 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-4 h-4 text-green-400" />
            <span className="text-xs text-gray-400">Interest Earned</span>
          </div>
          <div className="text-2xl font-bold text-green-300">${stats.totalInterest.toFixed(2)}</div>
        </div>

        <div className="bg-gradient-to-br from-red-500/20 to-red-600/10 border border-red-400/30 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <TrendingDown className="w-4 h-4 text-red-400" />
            <span className="text-xs text-gray-400">Withdrawn</span>
          </div>
          <div className="text-2xl font-bold text-red-300">${stats.totalWithdrawn.toFixed(2)}</div>
        </div>

        <div className="bg-gradient-to-br from-purple-500/20 to-purple-600/10 border border-purple-400/30 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <Calendar className="w-4 h-4 text-purple-400" />
            <span className="text-xs text-gray-400">Transactions</span>
          </div>
          <div className="text-2xl font-bold text-purple-300">{stats.transactionCount}</div>
        </div>
      </div>

      {/* Controls */}
      <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4 space-y-4">
        <div className="flex flex-col md:flex-row gap-4">
          {/* Search */}
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input
              type="text"
              placeholder="Search transactions..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
            />
          </div>

          {/* Filter */}
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:border-blue-500 focus:outline-none"
          >
            <option value="all">All Types</option>
            <option value="contribution">Contributions</option>
            <option value="interest">Interest</option>
            <option value="withdrawal">Withdrawals</option>
          </select>

          {/* Sort */}
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:border-blue-500 focus:outline-none"
          >
            <option value="date-desc">Newest First</option>
            <option value="date-asc">Oldest First</option>
            <option value="amount-high">Amount: High to Low</option>
            <option value="amount-low">Amount: Low to High</option>
          </select>

          {/* Export */}
          <button
            onClick={handleExport}
            className="px-4 py-2 bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-700 hover:to-blue-600 text-white rounded-lg font-semibold transition-all flex items-center gap-2"
          >
            <Download className="w-4 h-4" />
            Export
          </button>
        </div>
      </div>

      {/* Transactions List */}
      <div className="space-y-2">
        {filteredTransactions.length === 0 ? (
          <div className="text-center py-12 bg-slate-800/50 border border-slate-700 rounded-lg">
            <DollarSign className="w-12 h-12 text-gray-500 mx-auto mb-3" />
            <p className="text-gray-400">No transactions found</p>
          </div>
        ) : (
          filteredTransactions.map((tx) => (
            <div
              key={tx.id}
              className="bg-slate-800/50 border border-slate-700 rounded-lg p-4 hover:border-slate-600 transition-all"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4 flex-1">
                  {/* Icon */}
                  <div
                    className={`w-12 h-12 rounded-lg flex items-center justify-center ${
                      tx.type === 'contribution'
                        ? 'bg-blue-500/20'
                        : tx.type === 'interest'
                        ? 'bg-green-500/20'
                        : 'bg-red-500/20'
                    }`}
                  >
                    {tx.type === 'contribution' ? (
                      <DollarSign className="w-6 h-6 text-blue-400" />
                    ) : tx.type === 'interest' ? (
                      <TrendingUp className="w-6 h-6 text-green-400" />
                    ) : (
                      <TrendingDown className="w-6 h-6 text-red-400" />
                    )}
                  </div>

                  {/* Details */}
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h4 className="font-semibold text-white capitalize">{tx.type}</h4>
                      {tx.blockchain_hash && (
                        <div
                          className="flex items-center gap-1 bg-blue-500/20 px-2 py-1 rounded text-xs"
                          title={tx.blockchain_hash}
                        >
                          <Zap className="w-3 h-3 text-blue-400" />
                          <span className="text-blue-300">
                            {tx.blockchain_hash.slice(0, 8)}...
                          </span>
                        </div>
                      )}
                    </div>
                    <p className="text-sm text-gray-400">
                      {tx.description || new Date(tx.created_at).toLocaleString()}
                    </p>
                  </div>
                </div>

                {/* Amount & Status */}
                <div className="text-right">
                  <div
                    className={`text-lg font-bold ${
                      tx.type === 'contribution' || tx.type === 'interest'
                        ? 'text-green-300'
                        : 'text-red-300'
                    }`}
                  >
                    {tx.type === 'contribution' || tx.type === 'interest' ? '+' : '-'}$
                    {tx.amount.toFixed(2)}
                  </div>
                  <div className="flex items-center gap-1 justify-end mt-1 text-xs">
                    {tx.verified ? (
                      <>
                        <CheckCircle className="w-3 h-3 text-green-400" />
                        <span className="text-green-400">Verified</span>
                      </>
                    ) : (
                      <>
                        <Clock className="w-3 h-3 text-yellow-400" />
                        <span className="text-yellow-400">Pending</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default FinancialTracker;
