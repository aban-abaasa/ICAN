/**
 * SACCODetails - Full SACCO view with member dashboard and management
 * Shows contributions, loans, members, and privacy controls
 */

import React, { useState, useEffect } from 'react'
import {
  ArrowLeft,
  Users,
  TrendingUp,
  DollarSign,
  Send,
  Eye,
  EyeOff,
  Clock,
  FileText,
  CheckCircle,
  AlertCircle,
  Loader,
  BarChart3,
  PieChart,
  Target
} from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import {
  getMemberDashboard,
  makeContribution,
  requestLoan,
  getMemberLoans,
  approveMember,
  getPendingMembers,
  updatePrivacySettings,
  getSaccoMembers
} from '../../services/saccoService'
import ContributionForm from './ContributionForm'
import LoanForm from './LoanForm'
import MemberApprovalPanel from './MemberApprovalPanel'

export default function SACCODetails({ saccoId, onBack }) {
  const { user } = useAuth()
  const [dashboard, setDashboard] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeSection, setActiveSection] = useState('overview') // overview, contribute, loan, members, admin
  const [showContributeForm, setShowContributeForm] = useState(false)
  const [showLoanForm, setShowLoanForm] = useState(false)
  const [privacyEnabled, setPrivacyEnabled] = useState(false)
  const [members, setMembers] = useState([])
  const [pendingMembers, setPendingMembers] = useState([])

  useEffect(() => {
    loadDashboard()
  }, [])

  const loadDashboard = async () => {
    try {
      setLoading(true)
      const data = await getMemberDashboard(user.id, saccoId)
      setDashboard(data)
      setPrivacyEnabled(data.member.show_profile)

      // Load members if member exists
      if (data.member) {
        try {
          const membersList = await getSaccoMembers(saccoId, user.id)
          setMembers(membersList)
        } catch (err) {
          console.error('Error loading members:', err)
        }

        // Load pending members if admin
        if (data.member.role === 'admin') {
          try {
            const pending = await getPendingMembers(saccoId, user.id)
            setPendingMembers(pending)
          } catch (err) {
            console.error('Error loading pending members:', err)
          }
        }
      }
    } catch (err) {
      setError(err.message)
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const handleContribution = async (amount, description) => {
    try {
      await makeContribution(saccoId, user.id, amount, description)
      setShowContributeForm(false)
      loadDashboard()
    } catch (err) {
      alert('Error: ' + err.message)
    }
  }

  const handleLoanRequest = async (principal, interestRate, durationMonths) => {
    try {
      await requestLoan(saccoId, user.id, principal, interestRate, durationMonths)
      setShowLoanForm(false)
      loadDashboard()
    } catch (err) {
      alert('Error: ' + err.message)
    }
  }

  const handlePrivacyToggle = async () => {
    try {
      await updatePrivacySettings(user.id, saccoId, !privacyEnabled)
      setPrivacyEnabled(!privacyEnabled)
    } catch (err) {
      alert('Error: ' + err.message)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader className="w-8 h-8 text-emerald-400 animate-spin" />
      </div>
    )
  }

  if (error || !dashboard) {
    return (
      <div className="text-center py-20">
        <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
        <p className="text-red-400 mb-4">{error || 'SACCO not found'}</p>
        <button
          onClick={onBack}
          className="px-4 py-2 rounded-lg bg-slate-700 text-white hover:bg-slate-600 transition-colors"
        >
          Go Back
        </button>
      </div>
    )
  }

  const { member, sacco, stats, contributions, loans } = dashboard
  const isAdmin = member.role === 'admin'
  const activeLoan = loans.find(l => l.status === 'active')

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
          Back
        </button>
        <div>
          <h1 className="text-3xl font-bold text-white">{sacco.name}</h1>
          <p className="text-slate-400 text-sm">{sacco.description}</p>
        </div>
        <div className="text-right">
          <button
            onClick={handlePrivacyToggle}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-all ${
              privacyEnabled
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/50'
                : 'bg-slate-700/50 text-slate-400 border border-slate-600'
            }`}
          >
            {privacyEnabled ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
            <span className="text-sm font-medium">{privacyEnabled ? 'Visible' : 'Private'}</span>
          </button>
        </div>
      </div>

      {/* Stats Overview */}
      <div className="grid md:grid-cols-4 gap-4">
        <StatCard
          icon={<DollarSign className="w-6 h-6" />}
          label="Your Balance"
          value={`$${stats.currentBalance.toFixed(2)}`}
          color="emerald"
        />
        <StatCard
          icon={<TrendingUp className="w-6 h-6" />}
          label="Interest Earned"
          value={`$${stats.interestEarned.toFixed(2)}`}
          color="teal"
        />
        <StatCard
          icon={<BarChart3 className="w-6 h-6" />}
          label="Group Pool"
          value={`$${stats.groupPoolSize.toFixed(2)}`}
          color="blue"
        />
        <StatCard
          icon={<Users className="w-6 h-6" />}
          label="Members"
          value={`${stats.memberCount}/30`}
          color="purple"
        />
      </div>

      {/* Navigation Tabs */}
      <div className="flex gap-2 flex-wrap">
        {[
          { id: 'overview', label: 'Overview', icon: <BarChart3 className="w-4 h-4" /> },
          { id: 'contribute', label: 'Contribute', icon: <Send className="w-4 h-4" /> },
          { id: 'loan', label: 'Loans', icon: <Target className="w-4 h-4" /> },
          { id: 'members', label: 'Members', icon: <Users className="w-4 h-4" /> },
          ...(isAdmin ? [{ id: 'admin', label: 'Admin Panel', icon: <FileText className="w-4 h-4" /> }] : [])
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveSection(tab.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all ${
              activeSection === tab.id
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/50'
                : 'bg-slate-700/50 text-slate-400 border border-slate-600 hover:border-emerald-500/30'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content Sections */}
      {activeSection === 'overview' && (
        <OverviewSection
          dashboard={dashboard}
          onContribute={() => setShowContributeForm(true)}
          onRequestLoan={() => setShowLoanForm(true)}
        />
      )}

      {activeSection === 'contribute' && (
        <ContributionSection
          contributions={contributions}
          onAddContribution={() => setShowContributeForm(true)}
        />
      )}

      {activeSection === 'loan' && (
        <LoanSection
          loans={loans}
          activeLoan={activeLoan}
          onRequestLoan={() => setShowLoanForm(true)}
        />
      )}

      {activeSection === 'members' && (
        <MembersSection members={members} />
      )}

      {activeSection === 'admin' && isAdmin && (
        <AdminPanel
          sacco={sacco}
          pendingMembers={pendingMembers}
          onMemberApproved={loadDashboard}
        />
      )}

      {/* Forms */}
      {showContributeForm && (
        <ContributionForm
          onSubmit={handleContribution}
          onClose={() => setShowContributeForm(false)}
        />
      )}

      {showLoanForm && (
        <LoanForm
          currentBalance={stats.currentBalance}
          onSubmit={handleLoanRequest}
          onClose={() => setShowLoanForm(false)}
        />
      )}
    </div>
  )
}

// Stat Card Component
function StatCard({ icon, label, value, color }) {
  const colors = {
    emerald: 'from-emerald-500/20 to-emerald-600/20 border-emerald-500/30 text-emerald-400',
    teal: 'from-teal-500/20 to-teal-600/20 border-teal-500/30 text-teal-400',
    blue: 'from-blue-500/20 to-blue-600/20 border-blue-500/30 text-blue-400',
    purple: 'from-purple-500/20 to-purple-600/20 border-purple-500/30 text-purple-400'
  }

  return (
    <div className={`p-5 rounded-xl bg-gradient-to-br ${colors[color]} border`}>
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm text-slate-400 font-medium">{label}</p>
        {icon}
      </div>
      <p className="text-2xl font-bold text-white">{value}</p>
    </div>
  )
}

// Overview Section
function OverviewSection({ dashboard, onContribute, onRequestLoan }) {
  return (
    <div className="space-y-6">
      {/* Action Buttons */}
      <div className="grid md:grid-cols-2 gap-4">
        <button
          onClick={onContribute}
          className="p-4 rounded-xl bg-gradient-to-br from-emerald-500/20 to-emerald-600/20 border border-emerald-500/50 hover:border-emerald-400 transition-all hover:shadow-lg hover:shadow-emerald-500/20"
        >
          <Send className="w-6 h-6 text-emerald-400 mb-2" />
          <p className="text-white font-medium">Make Contribution</p>
          <p className="text-xs text-slate-400">Add funds to group pool</p>
        </button>

        <button
          onClick={onRequestLoan}
          className="p-4 rounded-xl bg-gradient-to-br from-teal-500/20 to-teal-600/20 border border-teal-500/50 hover:border-teal-400 transition-all hover:shadow-lg hover:shadow-teal-500/20"
        >
          <Target className="w-6 h-6 text-teal-400 mb-2" />
          <p className="text-white font-medium">Request Loan</p>
          <p className="text-xs text-slate-400">Borrow from group savings</p>
        </button>
      </div>

      {/* Recent Activity */}
      <div className="p-5 rounded-xl bg-slate-800/50 border border-slate-700/50">
        <h3 className="text-white font-bold mb-4 flex items-center gap-2">
          <Clock className="w-5 h-5 text-emerald-400" />
          Recent Activity
        </h3>
        <div className="space-y-3">
          {dashboard.contributions.length > 0 ? (
            dashboard.contributions.map((contrib, i) => (
              <div key={i} className="flex items-center justify-between p-3 bg-slate-700/50 rounded-lg">
                <div>
                  <p className="text-white font-medium">Contribution</p>
                  <p className="text-xs text-slate-400">
                    {new Date(contrib.contribution_date).toLocaleDateString()}
                  </p>
                </div>
                <p className="text-emerald-400 font-bold">+${contrib.amount.toFixed(2)}</p>
              </div>
            ))
          ) : (
            <p className="text-slate-400 text-sm">No contributions yet</p>
          )}
        </div>
      </div>
    </div>
  )
}

// Contribution Section
function ContributionSection({ contributions, onAddContribution }) {
  return (
    <div className="space-y-4">
      <button
        onClick={onAddContribution}
        className="w-full px-4 py-3 rounded-lg bg-emerald-500 text-white font-medium hover:bg-emerald-600 transition-colors"
      >
        + Add Contribution
      </button>

      <div className="space-y-3">
        {contributions.length > 0 ? (
          contributions.map((contrib) => (
            <div key={contrib.id} className="p-4 rounded-lg bg-slate-800/50 border border-slate-700/50">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-white font-medium">{contrib.description || 'Contribution'}</p>
                  <p className="text-sm text-slate-400">
                    {new Date(contrib.contribution_date).toLocaleDateString()}
                  </p>
                </div>
                <p className="text-emerald-400 font-bold text-lg">${contrib.amount.toFixed(2)}</p>
              </div>
            </div>
          ))
        ) : (
          <p className="text-slate-400 text-center py-8">No contributions yet. Start saving!</p>
        )}
      </div>
    </div>
  )
}

// Loan Section
function LoanSection({ loans, activeLoan, onRequestLoan }) {
  return (
    <div className="space-y-4">
      <button
        onClick={onRequestLoan}
        className="w-full px-4 py-3 rounded-lg bg-teal-500 text-white font-medium hover:bg-teal-600 transition-colors"
      >
        + Request Loan
      </button>

      {activeLoan && (
        <div className="p-4 rounded-lg bg-gradient-to-br from-teal-500/20 to-teal-600/20 border border-teal-500/50">
          <p className="text-teal-400 font-medium mb-3">Active Loan</p>
          <div className="space-y-2 text-sm text-slate-300">
            <div className="flex justify-between">
              <span>Principal:</span>
              <span className="text-white font-medium">${activeLoan.principal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span>Repaid:</span>
              <span className="text-emerald-400">${activeLoan.amount_repaid.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span>Due:</span>
              <span>{new Date(activeLoan.due_date).toLocaleDateString()}</span>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {loans.map((loan) => (
          <div key={loan.id} className="p-4 rounded-lg bg-slate-800/50 border border-slate-700/50">
            <div className="flex items-center justify-between mb-2">
              <p className="text-white font-medium">Loan Request</p>
              <span className={`text-xs font-medium px-2 py-1 rounded ${
                loan.status === 'active' ? 'bg-teal-500/20 text-teal-400' : 'bg-slate-700 text-slate-400'
              }`}>
                {loan.status}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-slate-400">Amount</p>
                <p className="text-white font-medium">${loan.principal.toFixed(2)}</p>
              </div>
              <div>
                <p className="text-slate-400">Interest Rate</p>
                <p className="text-white font-medium">{loan.interest_rate}%</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// Members Section
function MembersSection({ members }) {
  return (
    <div className="space-y-3">
      {members.length > 0 ? (
        members.map((member) => (
          <div key={member.id} className="p-4 rounded-lg bg-slate-800/50 border border-slate-700/50">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-emerald-400" />
                <p className="text-white font-medium">Member #{member.id.slice(0, 8)}</p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <p className="text-slate-400">Contributed</p>
                <p className="text-emerald-400 font-medium">${member.total_contributed.toFixed(2)}</p>
              </div>
              <div>
                <p className="text-slate-400">Balance</p>
                <p className="text-teal-400 font-medium">${member.current_balance.toFixed(2)}</p>
              </div>
              <div>
                <p className="text-slate-400">Interest</p>
                <p className="text-blue-400 font-medium">${member.interest_earned.toFixed(2)}</p>
              </div>
            </div>
          </div>
        ))
      ) : (
        <p className="text-slate-400 text-center py-8">No members to display</p>
      )}
    </div>
  )
}

// Admin Panel
function AdminPanel({ sacco, pendingMembers, onMemberApproved }) {
  return (
    <div className="space-y-6">
      <div className="p-5 rounded-xl bg-blue-500/20 border border-blue-500/50">
        <p className="text-blue-300 font-medium mb-2">👑 Administrator Controls</p>
        <p className="text-sm text-slate-400">Manage membership requests and group settings</p>
      </div>

      {pendingMembers.length > 0 ? (
        <MemberApprovalPanel
          pendingMembers={pendingMembers}
          saccoId={sacco.id}
          onApproved={onMemberApproved}
        />
      ) : (
        <p className="text-slate-400 text-center py-8">No pending member requests</p>
      )}
    </div>
  )
}
