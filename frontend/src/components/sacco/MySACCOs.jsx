/**
 * MySACCOs - List of user's joined SACCOs
 */

import React, { useState, useEffect } from 'react'
import { TrendingUp, Users, Lock, Loader, AlertCircle, ChevronRight } from 'lucide-react'
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
    <div>
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-white mb-2">My SACCOs</h2>
        <p className="text-slate-400">Manage your savings groups and track progress</p>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {saccos.map((sacco) => {
          const memberData = sacco.memberData
          const growthRate = sacco.total_pool > 0
            ? ((sacco.total_interest_generated / sacco.total_pool) * 100).toFixed(1)
            : 0

          return (
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
                    <p className="text-xs text-emerald-400 mt-0.5">✓ Member</p>
                  </div>
                  <ChevronRight className="w-5 h-5 text-slate-600 group-hover:text-emerald-400 group-hover:translate-x-1 transition-all" />
                </div>

                {/* Your Stats */}
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div className="p-2.5 rounded-lg bg-emerald-500/20 border border-emerald-500/30">
                    <p className="text-xs text-slate-400">Your Balance</p>
                    <p className="text-sm font-bold text-emerald-400">
                      ${memberData.current_balance.toFixed(2)}
                    </p>
                  </div>
                  <div className="p-2.5 rounded-lg bg-teal-500/20 border border-teal-500/30">
                    <p className="text-xs text-slate-400">Interest</p>
                    <p className="text-sm font-bold text-teal-400">
                      ${memberData.interest_earned.toFixed(2)}
                    </p>
                  </div>
                </div>

                {/* Group Stats */}
                <div className="space-y-2 mb-4 pb-4 border-b border-slate-700/50">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400">Group Pool</span>
                    <span className="text-white font-medium">${(sacco.total_pool / 1000).toFixed(1)}K</span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400">Members</span>
                    <span className="text-white font-medium">{sacco.member_count}/30</span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400">Growth Rate</span>
                    <span className="text-emerald-400 font-medium">{growthRate}%</span>
                  </div>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between pt-2">
                  <div className="flex items-center gap-2 text-xs text-slate-400">
                    <Lock className="w-4 h-4" />
                    Privacy Protected
                  </div>
                  <span className={`text-xs font-medium px-2 py-1 rounded ${
                    memberData.show_profile
                      ? 'bg-emerald-500/20 text-emerald-400'
                      : 'bg-slate-700/50 text-slate-400'
                  }`}>
                    {memberData.show_profile ? 'Visible' : 'Private'}
                  </span>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
