/**
 * MySACCOs - List of user's joined SACCOs
 */

import React, { useState, useEffect } from 'react'
import { Users, Loader, AlertCircle } from 'lucide-react'
import { getMySaccos } from '../../services/saccoService'
import { useAuth } from '../../context/AuthContext'

export default function MySACCOs({ onSelect }) {
  const { user } = useAuth()
  const [saccos, setSaccos] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    loadMySaccos()
  }, [])

  const loadMySaccos = async () => {
    try {
      setLoading(true)
      const data = await getMySaccos(user.id)
      setSaccos(data)
    } catch (err) {
      setError('Failed to load your SACCOs')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center">
          <Loader className="w-8 h-8 text-emerald-400 animate-spin mx-auto mb-4" />
          <p className="text-slate-400">Loading your SACCOs...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-center py-20">
        <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
        <p className="text-red-400 mb-4">{error}</p>
        <button
          onClick={loadMySaccos}
          className="px-4 py-2 rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 transition-colors"
        >
          Retry
        </button>
      </div>
    )
  }

  if (saccos.length === 0) {
    return (
      <div className="text-center py-20">
        <Users className="w-16 h-16 text-slate-600 mx-auto mb-4" />
        <p className="text-slate-400 mb-4">You haven't joined any SACCOs yet</p>
        <p className="text-slate-500 text-sm">Explore available SACCOs and request to join</p>
      </div>
    )
  }

  return (
    <div className="w-full">
      {/* Header */}
      <div className="mb-6 sm:mb-8">
        <h2 className="text-xl sm:text-2xl font-bold text-white mb-1 sm:mb-2">👥 My Trusts</h2>
        <p className="text-xs sm:text-sm text-slate-400">Collaborate, contribute, and grow wealth together</p>
      </div>

      {/* Trust Tabs - Simple Clean List */}
      <div className="flex flex-wrap gap-2 sm:gap-3">
        {saccos.map((sacco) => (
          <button
            key={sacco.id}
            onClick={() => onSelect(sacco.id)}
            className="px-4 sm:px-5 py-3 sm:py-3 rounded-lg sm:rounded-xl bg-slate-800 border border-slate-700 hover:border-emerald-500 text-white font-medium text-sm sm:text-base whitespace-nowrap truncate transition-all hover:bg-slate-700 hover:shadow-lg hover:shadow-emerald-500/20"
          >
            {sacco.name}
          </button>
        ))}
      </div>

      {/* Quick Navigation at bottom */}
      <div className="mt-6 sm:mt-8 grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-3">
        <button className="hidden sm:block py-3 px-2 rounded-lg bg-slate-800 border border-slate-700 hover:border-blue-500/50 text-center text-xs font-medium text-slate-300 hover:text-blue-400 transition-colors">
          🔍 Explore
        </button>
        <button className="py-3 px-2 rounded-lg bg-slate-800 border border-slate-700 hover:border-purple-500/50 text-center text-xs font-medium text-slate-300 hover:text-purple-400 transition-colors">
          ✨ Create
        </button>
        <button className="py-3 px-2 rounded-lg bg-slate-800 border border-slate-700 hover:border-green-500/50 text-center text-xs font-medium text-slate-300 hover:text-green-400 transition-colors">
          📊 Dashboard
        </button>
      </div>
    </div>
  )
}
