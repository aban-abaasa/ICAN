/**
 * BlockchainVerificationDashboard
 * Displays Trust transaction verification and audit trail
 * Shows member joins, votes, contributions, and loans with blockchain proof
 */

import React, { useState, useEffect } from 'react'
import {
  Shield,
  CheckCircle,
  AlertCircle,
  Link2,
  TrendingUp,
  Users,
  DollarSign,
  Clock,
  Loader
} from 'lucide-react'
import {
  getTrustBlockchainAudit,
  getTrustVerificationStats,
  getTrustVotingAnalytics,
  getTrustFinancialAnalytics
} from '../../services/trustBlockchainService'

export default function BlockchainVerificationDashboard({ trustId }) {
  const [auditTrail, setAuditTrail] = useState([])
  const [stats, setStats] = useState(null)
  const [votingAnalytics, setVotingAnalytics] = useState(null)
  const [financialAnalytics, setFinancialAnalytics] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedRecord, setSelectedRecord] = useState(null)

  useEffect(() => {
    loadBlockchainData()
  }, [trustId])

  const loadBlockchainData = async () => {
    try {
      setLoading(true)
      const [audit, blockchainStats, voting, financial] = await Promise.all([
        getTrustBlockchainAudit(trustId),
        getTrustVerificationStats(trustId),
        getTrustVotingAnalytics(trustId),
        getTrustFinancialAnalytics(trustId)
      ])

      setAuditTrail(audit)
      setStats(blockchainStats)
      setVotingAnalytics(voting)
      setFinancialAnalytics(financial)
    } catch (err) {
      setError(err.message)
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader className="w-8 h-8 text-emerald-400 animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="p-5 rounded-xl bg-gradient-to-r from-blue-500/20 to-purple-600/20 border border-blue-500/50">
        <div className="flex items-center gap-3 mb-2">
          <Shield className="w-6 h-6 text-blue-400" />
          <h2 className="text-xl font-bold text-white">Blockchain Verification</h2>
        </div>
        <p className="text-sm text-slate-300">
          All transactions are cryptographically verified and stored in immutable blockchain records
        </p>
      </div>

      {/* Verification Stats */}
      {stats && (
        <div className="grid md:grid-cols-4 gap-4">
          <StatCard
            label="Total Records"
            value={stats.totalRecords}
            icon={<Clock className="w-5 h-5" />}
            color="blue"
          />
          <StatCard
            label="Verified"
            value={`${stats.verifiedRecords}/${stats.totalRecords}`}
            percentage={stats.verificationRate}
            icon={<CheckCircle className="w-5 h-5" />}
            color="emerald"
          />
          <StatCard
            label="Chain Integrity"
            value={stats.chainIntegrity ? '✓ Valid' : '✗ Invalid'}
            icon={<Link2 className="w-5 h-5" />}
            color={stats.chainIntegrity ? 'emerald' : 'red'}
          />
          <div className="p-4 rounded-lg bg-slate-800/50 border border-slate-700">
            <p className="text-sm text-slate-400 mb-2">Record Breakdown</p>
            <div className="space-y-1 text-xs text-slate-300">
              <div className="flex justify-between">
                <span>Member Joins:</span>
                <span className="font-bold text-emerald-400">{stats.recordsByType.member_joins}</span>
              </div>
              <div className="flex justify-between">
                <span>Votes:</span>
                <span className="font-bold text-teal-400">{stats.recordsByType.votes}</span>
              </div>
              <div className="flex justify-between">
                <span>Contributions:</span>
                <span className="font-bold text-blue-400">{stats.recordsByType.contributions}</span>
              </div>
              <div className="flex justify-between">
                <span>Loan Approvals:</span>
                <span className="font-bold text-purple-400">{stats.recordsByType.loan_approvals}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Analytics Grid */}
      <div className="grid md:grid-cols-2 gap-4">
        {/* Voting Analytics */}
        {votingAnalytics && (
          <div className="p-5 rounded-xl bg-slate-800/50 border border-slate-700/50">
            <h3 className="text-white font-bold mb-4 flex items-center gap-2">
              <Users className="w-5 h-5 text-teal-400" />
              Voting Analytics
            </h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Total Votes</span>
                <span className="text-white font-bold">{votingAnalytics.totalVotes}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Approvals</span>
                <span className="text-emerald-400 font-bold">{votingAnalytics.approvals}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Rejections</span>
                <span className="text-red-400 font-bold">{votingAnalytics.rejections}</span>
              </div>
              <div className="pt-2 border-t border-slate-700">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400 text-sm">Approval Rate</span>
                  <div className="flex items-center gap-2">
                    <div className="w-24 h-2 rounded-full bg-slate-700 overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-emerald-500 to-teal-600"
                        style={{ width: `${votingAnalytics.approvalRate}%` }}
                      />
                    </div>
                    <span className="text-teal-400 font-bold text-sm">{votingAnalytics.approvalRate}%</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Financial Analytics */}
        {financialAnalytics && (
          <div className="p-5 rounded-xl bg-slate-800/50 border border-slate-700/50">
            <h3 className="text-white font-bold mb-4 flex items-center gap-2">
              <DollarSign className="w-5 h-5 text-emerald-400" />
              Financial Analytics
            </h3>
            <div className="space-y-3">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-slate-400 text-sm">Total Contributed</span>
                  <span className="text-emerald-400 font-bold">
                    ${financialAnalytics.totalContributed.toFixed(2)}
                  </span>
                </div>
                <p className="text-xs text-slate-500">
                  {financialAnalytics.contributionCount} contributions
                </p>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-slate-400 text-sm">Total Loaned</span>
                  <span className="text-teal-400 font-bold">
                    ${financialAnalytics.totalLoaned.toFixed(2)}
                  </span>
                </div>
                <p className="text-xs text-slate-500">
                  {financialAnalytics.loanCount} loans approved
                </p>
              </div>

              <div className="pt-2 border-t border-slate-700 grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-slate-400 mb-1">Avg Contribution</p>
                  <p className="text-sm font-bold text-emerald-400">
                    ${financialAnalytics.averageContribution}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-400 mb-1">Avg Loan</p>
                  <p className="text-sm font-bold text-teal-400">
                    ${financialAnalytics.averageLoan}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Audit Trail */}
      <div className="p-5 rounded-xl bg-slate-800/50 border border-slate-700/50">
        <h3 className="text-white font-bold mb-4 flex items-center gap-2">
          <Shield className="w-5 h-5 text-blue-400" />
          Blockchain Audit Trail
        </h3>

        {auditTrail.length === 0 ? (
          <p className="text-slate-400 text-center py-8">No blockchain records yet</p>
        ) : (
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {auditTrail.map((record) => (
              <button
                key={record.id}
                onClick={() => setSelectedRecord(selectedRecord?.id === record.id ? null : record)}
                className="w-full p-3 rounded-lg bg-slate-700/30 border border-slate-600/50 hover:border-emerald-500/50 transition-all text-left"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    {record.verification.isValid ? (
                      <CheckCircle className="w-4 h-4 text-emerald-400" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-red-400" />
                    )}
                    <span className="text-sm font-medium text-white capitalize">
                      {record.record_type.replace('trust_', '').replace(/_/g, ' ')}
                    </span>
                  </div>
                  <span className="text-xs text-slate-400">
                    {new Date(record.created_at).toLocaleDateString()}
                  </span>
                </div>

                {/* Record Details */}
                {selectedRecord?.id === record.id && (
                  <div className="mt-3 pt-3 border-t border-slate-600 space-y-2 text-xs">
                    <div>
                      <p className="text-slate-400">Transaction Hash</p>
                      <p className="text-emerald-400 font-mono break-all">
                        {record.record_hash}
                      </p>
                    </div>
                    <div>
                      <p className="text-slate-400">Previous Hash</p>
                      <p className="text-slate-500 font-mono break-all">
                        {record.previous_hash}
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <p className="text-slate-400">Hash Valid</p>
                        <p className={record.verification.hashValid ? 'text-emerald-400' : 'text-red-400'}>
                          {record.verification.hashValid ? '✓ Valid' : '✗ Invalid'}
                        </p>
                      </div>
                      <div>
                        <p className="text-slate-400">Chain Valid</p>
                        <p className={record.verification.chainValid ? 'text-emerald-400' : 'text-red-400'}>
                          {record.verification.chainValid ? '✓ Valid' : '✗ Invalid'}
                        </p>
                      </div>
                    </div>
                    <div className="pt-2 border-t border-slate-600">
                      <p className="text-slate-400 mb-1">Data</p>
                      <pre className="bg-slate-900 p-2 rounded text-emerald-400 overflow-x-auto">
                        {JSON.stringify(record.record_data, null, 2)}
                      </pre>
                    </div>
                  </div>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function StatCard({ label, value, percentage, icon, color }) {
  const colors = {
    emerald: 'from-emerald-500/20 to-emerald-600/20 border-emerald-500/30 text-emerald-400',
    teal: 'from-teal-500/20 to-teal-600/20 border-teal-500/30 text-teal-400',
    blue: 'from-blue-500/20 to-blue-600/20 border-blue-500/30 text-blue-400',
    red: 'from-red-500/20 to-red-600/20 border-red-500/30 text-red-400'
  }

  return (
    <div className={`p-4 rounded-lg bg-gradient-to-br ${colors[color]} border`}>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-slate-400 font-medium">{label}</p>
        {icon}
      </div>
      <p className="text-2xl font-bold text-white mb-1">{value}</p>
      {percentage && (
        <p className="text-xs text-slate-400">{percentage}% verified</p>
      )}
    </div>
  )
}
