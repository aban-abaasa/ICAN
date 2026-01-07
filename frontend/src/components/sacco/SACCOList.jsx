/**
 * SACCOList - Browse and join available SACCOs
 */

import React, { useState, useEffect } from 'react'
import { Users, TrendingUp, Lock, ChevronRight, Loader } from 'lucide-react'
import { getSaccos } from '../../services/saccoService'

export default function SACCOList({ onSelect }) {
  const [saccos, setSaccos] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    loadSaccos()
  }, [])

  const loadSaccos = async () => {
    try {
      setLoading(true)
      const data = await getSaccos()
      setSaccos(data)
    } catch (err) {
      setError('Failed to load SACCOs')
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
          <p className="text-slate-400">Loading SACCOs...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-center py-20">
        <p className="text-red-400 mb-4">{error}</p>
        <button
          onClick={loadSaccos}
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
        <p className="text-slate-400 mb-4">No SACCOs available yet</p>
        <p className="text-slate-500 text-sm">Be the first to create one!</p>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-white mb-2">Explore SACCOs</h2>
        <p className="text-slate-400">Join a savings group and start building wealth together</p>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {saccos.map((sacco) => (
          <div
            key={sacco.id}
            onClick={() => onSelect(sacco.id)}
            className="group cursor-pointer"
          >
            <div className="h-full p-5 rounded-xl bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-700 hover:border-emerald-500/50 transition-all hover:shadow-lg hover:shadow-emerald-500/20">
              {/* Header */}
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1">
                  <h3 className="text-lg font-bold text-white group-hover:text-emerald-400 transition-colors">
                    {sacco.name}
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">{sacco.description || 'No description'}</p>
                </div>
                <ChevronRight className="w-5 h-5 text-slate-600 group-hover:text-emerald-400 group-hover:translate-x-1 transition-all" />
              </div>

              {/* Stats Grid */}
              <div className="grid grid-cols-3 gap-3 mb-4">
                <div className="p-2.5 rounded-lg bg-slate-700/50 border border-slate-600">
                  <p className="text-xs text-slate-400">Members</p>
                  <p className="text-lg font-bold text-emerald-400">{sacco.member_count}/30</p>
                </div>
                <div className="p-2.5 rounded-lg bg-slate-700/50 border border-slate-600">
                  <p className="text-xs text-slate-400">Pool</p>
                  <p className="text-lg font-bold text-teal-400">
                    ${(sacco.total_pool / 1000).toFixed(1)}K
                  </p>
                </div>
                <div className="p-2.5 rounded-lg bg-slate-700/50 border border-slate-600">
                  <p className="text-xs text-slate-400">Interest</p>
                  <p className="text-lg font-bold text-blue-400">
                    ${(sacco.total_interest_generated / 1000).toFixed(1)}K
                  </p>
                </div>
              </div>

              {/* Progress Bar */}
              <div className="mb-4">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs text-slate-400">Capacity</p>
                  <p className="text-xs font-medium text-emerald-400">
                    {Math.round((sacco.member_count / 30) * 100)}%
                  </p>
                </div>
                <div className="w-full h-2 rounded-full bg-slate-700/50 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-emerald-500 to-teal-600 transition-all"
                    style={{ width: `${(sacco.member_count / 30) * 100}%` }}
                  />
                </div>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between pt-3 border-t border-slate-700/50">
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <Lock className="w-4 h-4" />
                  Privacy Protected
                </div>
                <button className="px-3 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-400 text-xs font-medium hover:bg-emerald-500/30 transition-colors">
                  Join Now
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
