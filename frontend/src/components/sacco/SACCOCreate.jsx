/**
 * SACCOCreate - Beautiful SACCO creation modal
 */

import React, { useState } from 'react'
import { X, AlertCircle } from 'lucide-react'
import { createSacco } from '../../services/saccoService'
import { useAuth } from '../../context/AuthContext'

export default function SACCOCreate({ onClose, onCreated }) {
  const { user } = useAuth()
  const [formData, setFormData] = useState({
    name: '',
    description: ''
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    if (!formData.name.trim()) {
      setError('SACCO name is required')
      return
    }

    if (formData.name.length < 3) {
      setError('SACCO name must be at least 3 characters')
      return
    }

    setLoading(true)
    try {
      await createSacco(formData.name, formData.description, user.id)
      onCreated()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-md mx-4 rounded-2xl bg-gradient-to-b from-slate-800 to-slate-900 border border-emerald-500/30 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-700/50">
          <h2 className="text-xl font-bold text-white">Create New SACCO</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-700/50 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-slate-400" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Error Message */}
          {error && (
            <div className="flex gap-3 p-3 rounded-lg bg-red-500/20 border border-red-500/50">
              <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-300">{error}</p>
            </div>
          )}

          {/* SACCO Name */}
          <div>
            <label className="block text-sm font-medium text-emerald-300 mb-2">
              SACCO Name *
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="e.g., Green Valley Savings Group"
              className="w-full px-4 py-2.5 rounded-lg bg-slate-700/50 border border-slate-600 text-white placeholder-slate-500 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 outline-none transition-all"
            />
            <p className="text-xs text-slate-400 mt-1">3-50 characters, unique name</p>
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-emerald-300 mb-2">
              Description
            </label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="What is your SACCO about? Your vision and goals..."
              rows="3"
              className="w-full px-4 py-2.5 rounded-lg bg-slate-700/50 border border-slate-600 text-white placeholder-slate-500 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 outline-none transition-all resize-none"
            />
          </div>

          {/* Info Box */}
          <div className="p-4 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
            <p className="text-xs text-emerald-300 font-medium mb-2">📋 Standard Settings:</p>
            <ul className="text-xs text-slate-300 space-y-1">
              <li>✓ Maximum 30 members</li>
              <li>✓ 60% majority approval required</li>
              <li>✓ You become group administrator</li>
            </ul>
          </div>

          {/* Buttons */}
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
              disabled={loading}
              className="flex-1 px-4 py-2.5 rounded-lg bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-medium hover:shadow-lg hover:shadow-emerald-500/50 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Creating...' : 'Create SACCO'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
