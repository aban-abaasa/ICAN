/**
 * LoanForm - Modal for requesting loans
 */

import React, { useState } from 'react'
import { X, AlertCircle, Info } from 'lucide-react'

export default function LoanForm({ currentBalance, onSubmit, onClose }) {
  const [principal, setPrincipal] = useState('')
  const [interestRate, setInterestRate] = useState('10')
  const [durationMonths, setDurationMonths] = useState('12')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const minBalance = principal ? parseFloat(principal) * 0.2 : 0
  const requiredBalance = minBalance - currentBalance

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    if (!principal || parseFloat(principal) <= 0) {
      setError('Please enter a valid loan amount')
      return
    }

    if (currentBalance < minBalance) {
      setError(`You need at least $${minBalance.toFixed(2)} in your account`)
      return
    }

    setLoading(true)
    try {
      await onSubmit(parseFloat(principal), parseFloat(interestRate), parseInt(durationMonths))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const estimatedMonthlyPayment = principal && durationMonths
    ? ((parseFloat(principal) * (1 + parseFloat(interestRate) / 100)) / parseInt(durationMonths)).toFixed(2)
    : 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-md mx-4 rounded-2xl bg-gradient-to-b from-slate-800 to-slate-900 border border-teal-500/30 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-slate-700/50 sticky top-0 bg-slate-800/95">
          <h2 className="text-xl font-bold text-white">Request Loan</h2>
          <button onClick={onClose} className="p-2 hover:bg-slate-700/50 rounded-lg transition-colors">
            <X className="w-5 h-5 text-slate-400" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {error && (
            <div className="flex gap-3 p-3 rounded-lg bg-red-500/20 border border-red-500/50">
              <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
              <p className="text-sm text-red-300">{error}</p>
            </div>
          )}

          {/* Current Balance Info */}
          <div className="p-3 rounded-lg bg-teal-500/20 border border-teal-500/50">
            <p className="text-xs text-teal-300 font-medium">Your Current Balance</p>
            <p className="text-lg font-bold text-teal-400">${currentBalance.toFixed(2)}</p>
          </div>

          {/* Loan Amount */}
          <div>
            <label className="block text-sm font-medium text-teal-300 mb-2">Loan Amount ($) *</label>
            <input
              type="number"
              step="0.01"
              value={principal}
              onChange={(e) => setPrincipal(e.target.value)}
              placeholder="0.00"
              className="w-full px-4 py-2.5 rounded-lg bg-slate-700/50 border border-slate-600 text-white focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none"
            />
            {principal && minBalance > 0 && (
              <p className={`text-xs mt-1 ${
                currentBalance >= minBalance ? 'text-emerald-400' : 'text-red-400'
              }`}>
                {currentBalance >= minBalance
                  ? `✓ Meets minimum balance requirement`
                  : `Need $${requiredBalance.toFixed(2)} more in your account`}
              </p>
            )}
          </div>

          {/* Interest Rate */}
          <div>
            <label className="block text-sm font-medium text-teal-300 mb-2">Interest Rate (%)</label>
            <input
              type="number"
              step="0.5"
              value={interestRate}
              onChange={(e) => setInterestRate(e.target.value)}
              className="w-full px-4 py-2.5 rounded-lg bg-slate-700/50 border border-slate-600 text-white focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none"
            />
          </div>

          {/* Duration */}
          <div>
            <label className="block text-sm font-medium text-teal-300 mb-2">Duration (months)</label>
            <select
              value={durationMonths}
              onChange={(e) => setDurationMonths(e.target.value)}
              className="w-full px-4 py-2.5 rounded-lg bg-slate-700/50 border border-slate-600 text-white focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none"
            >
              {[3, 6, 12, 18, 24].map(m => <option key={m} value={m}>{m} months</option>)}
            </select>
          </div>

          {/* Estimated Payment */}
          {principal && estimatedMonthlyPayment > 0 && (
            <div className="p-3 rounded-lg bg-slate-700/50 border border-slate-600">
              <div className="flex items-start gap-2 mb-2">
                <Info className="w-4 h-4 text-slate-400 flex-shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="text-slate-300">Estimated monthly payment: <span className="font-bold text-white">${estimatedMonthlyPayment}</span></p>
                  <p className="text-xs text-slate-500 mt-1">Includes interest over {durationMonths} months</p>
                </div>
              </div>
            </div>
          )}

          {/* Terms */}
          <div className="p-3 rounded-lg bg-blue-500/20 border border-blue-500/50">
            <p className="text-xs text-blue-300 font-medium mb-2">📋 Loan Terms:</p>
            <ul className="text-xs text-slate-300 space-y-1">
              <li>✓ Minimum balance: 20% of loan amount</li>
              <li>✓ Maximum duration: 24 months</li>
              <li>✓ Interest compounds monthly</li>
              <li>✓ Early repayment allowed anytime</li>
            </ul>
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 rounded-lg border border-slate-600 text-slate-300 font-medium hover:bg-slate-700/50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || (principal && currentBalance < minBalance)}
              className="flex-1 px-4 py-2.5 rounded-lg bg-teal-500 text-white font-medium hover:bg-teal-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Processing...' : 'Request Loan'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
