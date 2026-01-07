/**
 * MemberApprovalPanel - Admin interface for approving members
 * 60% voting system for democratic membership
 */

import React, { useState } from 'react'
import { CheckCircle, XCircle, Users, Loader } from 'lucide-react'
import { approveMember } from '../../services/saccoService'
import { useAuth } from '../../context/AuthContext'

export default function MemberApprovalPanel({ pendingMembers, saccoId, onApproved }) {
  const { user } = useAuth()
  const [voting, setVoting] = useState({})
  const [loading, setLoading] = useState({})

  const handleVote = async (memberId, approve) => {
    setLoading({ ...loading, [memberId]: true })
    try {
      const result = await approveMember(memberId, saccoId, user.id, approve)
      setVoting({ ...voting, [memberId]: result })

      // Reload after a short delay
      setTimeout(onApproved, 1000)
    } catch (err) {
      console.error('Error voting:', err)
    } finally {
      setLoading({ ...loading, [memberId]: false })
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-bold text-white flex items-center gap-2">
          <Users className="w-5 h-5 text-emerald-400" />
          Pending Membership Requests
        </h3>
        <span className="px-3 py-1 rounded-full bg-orange-500/20 text-orange-400 text-sm font-medium">
          {pendingMembers.length} pending
        </span>
      </div>

      {pendingMembers.length === 0 ? (
        <div className="text-center py-8 text-slate-400">
          No pending requests
        </div>
      ) : (
        <div className="space-y-3">
          {pendingMembers.map(member => (
            <div
              key={member.id}
              className="p-4 rounded-lg bg-gradient-to-r from-slate-800 to-slate-900 border border-slate-700 hover:border-emerald-500/30 transition-all"
            >
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-white font-medium">Member Request #{member.id.slice(0, 8)}</p>
                  <p className="text-xs text-slate-400">
                    Requested {new Date(member.created_at).toLocaleDateString()}
                  </p>
                </div>
                {voting[member.id] && (
                  <div className={`text-xs font-medium px-3 py-1 rounded-full ${
                    voting[member.id].status === 'approved'
                      ? 'bg-emerald-500/20 text-emerald-400'
                      : 'bg-orange-500/20 text-orange-400'
                  }`}>
                    {voting[member.id].message}
                  </div>
                )}
              </div>

              {/* Voting Info */}
              <div className="mb-4 p-3 rounded-lg bg-slate-700/30 border border-slate-600/50">
                <p className="text-xs text-slate-300 mb-2">
                  <strong>{member.approved_by_count}</strong> members approved so far
                </p>
                <div className="w-full h-2 rounded-full bg-slate-700 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-emerald-500 to-teal-600 transition-all"
                    style={{ width: `${Math.min((member.approved_by_count / 10) * 100, 100)}%` }}
                  />
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-3">
                <button
                  onClick={() => handleVote(member.id, true)}
                  disabled={loading[member.id] || voting[member.id]}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-500/20 border border-emerald-500/50 text-emerald-400 font-medium hover:bg-emerald-500/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading[member.id] ? (
                    <Loader className="w-4 h-4 animate-spin" />
                  ) : (
                    <CheckCircle className="w-4 h-4" />
                  )}
                  Approve
                </button>
                <button
                  onClick={() => handleVote(member.id, false)}
                  disabled={loading[member.id] || voting[member.id]}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-red-500/20 border border-red-500/50 text-red-400 font-medium hover:bg-red-500/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading[member.id] ? (
                    <Loader className="w-4 h-4 animate-spin" />
                  ) : (
                    <XCircle className="w-4 h-4" />
                  )}
                  Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Voting Rules Info */}
      <div className="mt-6 p-4 rounded-lg bg-blue-500/20 border border-blue-500/50">
        <p className="text-blue-300 font-medium mb-2">🗳️ Democratic Approval Process</p>
        <ul className="text-sm text-slate-300 space-y-1">
          <li>✓ Each member gets one vote per applicant</li>
          <li>✓ Requires 60% majority approval</li>
          <li>✓ Admin can verify member details before voting</li>
          <li>✓ Members cannot vote twice (auto-prevented)</li>
        </ul>
      </div>
    </div>
  )
}
