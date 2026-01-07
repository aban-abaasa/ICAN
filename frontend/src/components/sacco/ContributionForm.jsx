/**
 * ContributionForm - Modal for adding contributions to SACCO
 */

import React, { useState } from 'react'
import { X, AlertCircle } from 'lucide-react'

export default function ContributionForm({ onSubmit, onClose }) {
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    if (!amount || parseFloat(amount) <= 0) {
      setError('Please enter a valid amount')
      return
    }

    setLoading(true)
    try {
      await onSubmit(parseFloat(amount), description)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-md mx-4 rounded-2xl bg-gradient-to-b from-slate-800 to-slate-900 border border-emerald-500/30">
        <div className="flex items-center justify-between p-6 border-b border-slate-700/50">
          <h2 className="text-xl font-bold text-white">Make Contribution</h2>
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

          <div>
            <label className="block text-sm font-medium text-emerald-300 mb-2">Amount ($) *</label>
            <input
              type="number"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="w-full px-4 py-2.5 rounded-lg bg-slate-700/50 border border-slate-600 text-white focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-emerald-300 mb-2">Description</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g., Monthly savings"
              className="w-full px-4 py-2.5 rounded-lg bg-slate-700/50 border border-slate-600 text-white focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 outline-none"
            />
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 rounded-lg border border-slate-600 text-slate-300 font-medium hover:bg-slate-700/50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 px-4 py-2.5 rounded-lg bg-emerald-500 text-white font-medium hover:bg-emerald-600 transition-colors disabled:opacity-50"
            >
              {loading ? 'Processing...' : 'Contribute'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
