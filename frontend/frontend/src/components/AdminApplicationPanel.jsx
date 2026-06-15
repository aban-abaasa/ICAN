/**
 * AdminApplicationPanel Component
 * Group admins review pending applications and approve/reject them
 * Triggers member voting when approved
 */

import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  ArrowLeft,
  CheckCircle,
  XCircle,
  Clock,
  AlertCircle,
  Loader,
  Users,
  TrendingUp,
  MessageSquare,
  Heart,
  ThumbsUp,
  ThumbsDown,
  Zap,
  Award,
  Eye,
  Send
} from 'lucide-react';
import {
  getPendingApplicationsForAdmin,
  getAllVotingApplications,
  adminApproveApplication,
  adminRejectApplication,
  getGroupVotingStats
} from '../services/trustService';
import { supabase } from '../lib/supabase/client';

const AdminApplicationPanel = ({ groupId, onClose }) => {
  const { user } = useAuth();
  const [pendingApps, setPendingApps] = useState([]);
  const [votingApps, setVotingApps] = useState([]);
  const [pendingLoans, setPendingLoans] = useState([]);
  const [votingLoans, setVotingLoans] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [activeTab, setActiveTab] = useState('pending');
  const [message, setMessage] = useState({ type: '', text: '' });
  const [selectedLoanForVoting, setSelectedLoanForVoting] = useState(null);

  useEffect(() => {
    if (!groupId) {
      setMessage({ type: 'error', text: 'Group ID is missing' });
      return;
    }
    console.log('🔧 AdminApplicationPanel mounted for group:', groupId);
    console.log('📋 Current user:', user?.id);
    loadData();
    // Poll for updates every 10 seconds
    const interval = setInterval(loadData, 10000);
    return () => clearInterval(interval);
  }, [groupId]);

  const loadData = async () => {
    setLoading(true);
    console.log('📥 Loading admin data for group:', groupId);
    try {
      // Fetch member applications
      const [pending, voting, groupStats] = await Promise.all([
        getPendingApplicationsForAdmin(groupId),
        getAllVotingApplications(groupId),
        getGroupVotingStats(groupId)
      ]);

      // Fetch loan applications
      const [pendingLoansData, votingLoansData] = await Promise.all([
        supabase
          .from('trust_loan_applications')
          .select('*')
          .eq('group_id', groupId)
          .eq('status', 'pending_admin')
          .order('created_at', { ascending: false }),
        supabase
          .from('trust_loan_applications')
          .select('*')
          .eq('group_id', groupId)
          .eq('status', 'voting_in_progress')
          .order('created_at', { ascending: false })
      ]);

      console.log('✅ Admin data loaded:', {
        pendingCount: pending?.length,
        votingCount: voting?.length,
        pendingLoansCount: pendingLoansData?.data?.length,
        votingLoansCount: votingLoansData?.data?.length,
        stats: groupStats
      });

      setPendingApps(pending || []);
      setVotingApps(voting || []);
      setPendingLoans(pendingLoansData?.data || []);
      setVotingLoans(votingLoansData?.data || []);
      setStats(groupStats);
    } catch (error) {
      console.error('❌ Error loading data:', error);
      setMessage({ type: 'error', text: `Failed to load applications: ${error.message}` });
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (applicationId) => {
    setProcessing(true);
    setMessage({ type: '', text: '' });
    console.log('✅ Approving application:', { applicationId, groupId, adminId: user?.id });
    try {
      const result = await adminApproveApplication(applicationId, groupId, user?.id);

      console.log('📤 Approve result:', result);

      if (result.success) {
        setMessage({ type: 'success', text: result.message || '✓ Application approved! Member voting has started.' });
        setTimeout(() => loadData(), 1500);
      } else {
        setMessage({ type: 'error', text: result.error || 'Failed to approve application' });
        console.error('Approve failed:', result.error);
      }
    } catch (error) {
      console.error('❌ Error approving:', error);
      setMessage({ type: 'error', text: error.message || 'Error approving application' });
    } finally {
      setProcessing(false);
    }
  };

  const handleReject = async (applicationId) => {
    setProcessing(true);
    setMessage({ type: '', text: '' });
    console.log('❌ Rejecting application:', { applicationId, adminId: user?.id });
    try {
      const result = await adminRejectApplication(applicationId, user?.id);

      console.log('📥 Reject result:', result);

      if (result.success) {
        setMessage({ type: 'success', text: result.message || '✓ Application rejected.' });
        setTimeout(() => loadData(), 1500);
      } else {
        setMessage({ type: 'error', text: result.error || 'Failed to reject application' });
        console.error('Reject failed:', result.error);
      }
    } catch (error) {
      console.error('❌ Error rejecting:', error);
      setMessage({ type: 'error', text: error.message || 'Error rejecting application' });
    } finally {
      setProcessing(false);
    }
  };

  const handleApproveLoan = async (loanId, notes = '') => {
    setProcessing(true);
    setMessage({ type: '', text: '' });
    console.log('✅ Approving loan:', { loanId, notes });
    try {
      const { data, error } = await supabase.rpc('admin_review_loan', {
        p_loan_id: loanId,
        p_status: 'voting_in_progress',
        p_notes: notes
      });

      if (error) throw error;

      setMessage({ type: 'success', text: '✓ Loan approved! Member voting has started.' });
      setTimeout(() => loadData(), 1500);
    } catch (error) {
      console.error('❌ Error approving loan:', error);
      setMessage({ type: 'error', text: error.message || 'Error approving loan' });
    } finally {
      setProcessing(false);
    }
  };

  const handleRejectLoan = async (loanId, notes = '') => {
    setProcessing(true);
    setMessage({ type: '', text: '' });
    console.log('❌ Rejecting loan:', { loanId, notes });
    try {
      const { data, error } = await supabase.rpc('admin_review_loan', {
        p_loan_id: loanId,
        p_status: 'rejected',
        p_notes: notes
      });

      if (error) throw error;

      setMessage({ type: 'success', text: '✓ Loan rejected.' });
      setTimeout(() => loadData(), 1500);
    } catch (error) {
      console.error('❌ Error rejecting loan:', error);
      setMessage({ type: 'error', text: error.message || 'Error rejecting loan' });
    } finally {
      setProcessing(false);
    }
  };

  const handleFinalizeLoan = async (loanId) => {
    setProcessing(true);
    setMessage({ type: '', text: '' });
    console.log('🔄 Finalizing loan voting:', { loanId });
    try {
      const { data, error } = await supabase.rpc('finalize_loan_voting', {
        p_loan_id: loanId
      });

      if (error) throw error;

      setMessage({ type: 'success', text: '✓ Loan voting finalized. Result has been recorded.' });
      setTimeout(() => loadData(), 1500);
    } catch (error) {
      console.error('❌ Error finalizing loan:', error);
      setMessage({ type: 'error', text: error.message || 'Error finalizing loan voting' });
    } finally {
      setProcessing(false);
    }
  };

  if (loading && !stats) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-6">
        <div className="text-center py-12">
          <Loader className="w-12 h-12 text-blue-500 mx-auto mb-4 animate-spin" />
          <p className="text-gray-400">Loading applications...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-6">
      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <button
          onClick={onClose}
          className="p-2 hover:bg-white/10 rounded-lg transition-colors"
        >
          <ArrowLeft className="w-6 h-6 text-white" />
        </button>
        <div>
          <h1 className="text-3xl font-bold text-white">Application Management</h1>
          <p className="text-gray-400">Review and approve membership and loan applications</p>
        </div>
      </div>

      {/* Message */}
      {message.text && (
        <div
          className={`mb-6 p-4 rounded-lg ${
            message.type === 'success'
              ? 'bg-emerald-500/20 text-emerald-400'
              : 'bg-red-500/20 text-red-400'
          }`}
        >
          {message.text}
        </div>
      )}

      {/* Statistics */}
      <div className="mb-8">
        <h2 className="text-sm font-semibold text-gray-300 mb-4 flex items-center gap-2">
          <TrendingUp className="w-4 h-4" />
          Application Statistics
        </h2>
        <div className="space-y-4">
          {/* Members Statistics */}
          <div>
            <p className="text-xs text-gray-400 font-semibold mb-3 ml-1">👥 Membership Applications</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="bg-gradient-to-br from-yellow-500/20 to-yellow-600/10 border border-yellow-400/40 rounded-lg p-4 hover:border-yellow-400/60 transition-all">
                <div className="text-xs text-gray-400 flex items-center gap-1">
                  <Clock className="w-3 h-3" /> Pending
                </div>
                <div className="text-3xl font-bold text-yellow-400 mt-2">{stats?.pending || 0}</div>
              </div>
              <div className="bg-gradient-to-br from-purple-500/20 to-purple-600/10 border border-purple-400/40 rounded-lg p-4 hover:border-purple-400/60 transition-all">
                <div className="text-xs text-gray-400 flex items-center gap-1">
                  <Users className="w-3 h-3" /> Voting
                </div>
                <div className="text-3xl font-bold text-purple-400 mt-2">{stats?.voting || 0}</div>
              </div>
              <div className="bg-gradient-to-br from-green-500/20 to-green-600/10 border border-green-400/40 rounded-lg p-4 hover:border-green-400/60 transition-all">
                <div className="text-xs text-gray-400 flex items-center gap-1">
                  <Award className="w-3 h-3" /> Approved
                </div>
                <div className="text-3xl font-bold text-green-400 mt-2">{stats?.approved || 0}</div>
              </div>
              <div className="bg-gradient-to-br from-red-500/20 to-red-600/10 border border-red-400/40 rounded-lg p-4 hover:border-red-400/60 transition-all">
                <div className="text-xs text-gray-400 flex items-center gap-1">
                  <Zap className="w-3 h-3" /> Rejected
                </div>
                <div className="text-3xl font-bold text-red-400 mt-2">{stats?.rejected || 0}</div>
              </div>
            </div>
          </div>

          {/* Loan Statistics */}
          <div>
            <p className="text-xs text-gray-400 font-semibold mb-3 ml-1">💰 Loan Applications</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="bg-gradient-to-br from-amber-500/20 to-amber-600/10 border border-amber-400/40 rounded-lg p-4 hover:border-amber-400/60 transition-all">
                <div className="text-xs text-gray-400 flex items-center gap-1">
                  <Clock className="w-3 h-3" /> Pending
                </div>
                <div className="text-3xl font-bold text-amber-400 mt-2">{pendingLoans.length}</div>
              </div>
              <div className="bg-gradient-to-br from-indigo-500/20 to-indigo-600/10 border border-indigo-400/40 rounded-lg p-4 hover:border-indigo-400/60 transition-all">
                <div className="text-xs text-gray-400 flex items-center gap-1">
                  <TrendingUp className="w-3 h-3" /> Voting
                </div>
                <div className="text-3xl font-bold text-indigo-400 mt-2">{votingLoans.length}</div>
              </div>
              <div className="bg-gradient-to-br from-emerald-500/20 to-emerald-600/10 border border-emerald-400/40 rounded-lg p-4 hover:border-emerald-400/60 transition-all">
                <div className="text-xs text-gray-400 flex items-center gap-1">
                  <CheckCircle className="w-3 h-3" /> Approved
                </div>
                <div className="text-3xl font-bold text-emerald-400 mt-2">0</div>
              </div>
              <div className="bg-gradient-to-br from-rose-500/20 to-rose-600/10 border border-rose-400/40 rounded-lg p-4 hover:border-rose-400/60 transition-all">
                <div className="text-xs text-gray-400 flex items-center gap-1">
                  <XCircle className="w-3 h-3" /> Rejected
                </div>
                <div className="text-3xl font-bold text-rose-400 mt-2">0</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-8 border-b border-slate-700 flex-wrap">
        {[
          { id: 'pending-members', label: 'Pending Members', count: pendingApps.length, icon: Clock },
          { id: 'pending-loans', label: 'Pending Loans', count: pendingLoans.length, icon: Clock },
          { id: 'voting-members', label: 'Voting Members', count: votingApps.length, icon: Users },
          { id: 'voting-loans', label: 'Voting Loans', count: votingLoans.length, icon: Users }
        ].map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-5 py-3 font-semibold flex items-center gap-2 transition-all border-b-3 ${
                activeTab === tab.id
                  ? 'text-blue-400 border-blue-500 bg-blue-500/10'
                  : 'text-gray-400 border-transparent hover:text-gray-300 hover:bg-slate-800/50'
              }`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
              {tab.count > 0 && (
                <span className={`ml-2 px-3 py-1 rounded-full text-xs font-bold ${
                  activeTab === tab.id
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-700 text-gray-300'
                }`}>
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto">
        {/* Pending Member Applications */}
        {activeTab === 'pending-members' && (
          <div className="space-y-4">
            {pendingApps.length === 0 ? (
              <div className="text-center py-16 bg-gradient-to-br from-slate-800/50 to-slate-900/50 border border-dashed border-slate-600 rounded-xl">
                <Clock className="w-16 h-16 text-gray-500 mx-auto mb-4 opacity-50" />
                <p className="text-gray-400 font-semibold mb-1">No pending member applications</p>
                <p className="text-sm text-gray-500">Applications will appear here when users apply</p>
              </div>
            ) : (
              pendingApps.map((app) => (
                <div
                  key={app.id}
                  className="bg-gradient-to-br from-slate-800/80 to-slate-900/60 border-2 border-yellow-500/40 rounded-xl p-6 hover:border-yellow-500/60 transition-all shadow-lg"
                >
                  <div className="flex items-start justify-between mb-5">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <div className="w-2.5 h-2.5 rounded-full bg-yellow-400 animate-pulse"></div>
                        <h3 className="text-lg font-bold text-white">{app.user_email}</h3>
                      </div>
                      <p className="text-xs text-gray-500">
                        📅 Applied {new Date(app.created_at).toLocaleDateString()} at {new Date(app.created_at).toLocaleTimeString()}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 bg-yellow-500/20 px-3 py-1.5 rounded-lg">
                      <Clock className="w-4 h-4 text-yellow-400" />
                      <span className="text-xs font-bold text-yellow-400">AWAITING REVIEW</span>
                    </div>
                  </div>

                  <div className="bg-slate-700/50 rounded-lg p-4 mb-5 border-l-4 border-l-blue-500">
                    <p className="text-xs uppercase tracking-widest text-gray-500 font-semibold mb-2">📝 Application Message</p>
                    <p className="text-sm text-gray-200 leading-relaxed">"{app.application_text}"</p>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={() => handleApprove(app.id)}
                      disabled={processing}
                      className="py-3 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 disabled:from-gray-600 disabled:to-gray-700 text-white rounded-lg font-bold transition-all transform hover:scale-105 active:scale-95 flex items-center justify-center gap-2 shadow-lg"
                    >
                      <ThumbsUp className="w-5 h-5" />
                      Approve & Vote
                    </button>
                    <button
                      onClick={() => handleReject(app.id)}
                      disabled={processing}
                      className="py-3 bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-700 hover:to-rose-700 disabled:from-gray-600 disabled:to-gray-700 text-white rounded-lg font-bold transition-all transform hover:scale-105 active:scale-95 flex items-center justify-center gap-2 shadow-lg"
                    >
                      <ThumbsDown className="w-5 h-5" />
                      Reject
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Pending Loan Applications */}
        {activeTab === 'pending-loans' && (
          <div className="space-y-4">
            {pendingLoans.length === 0 ? (
              <div className="text-center py-16 bg-gradient-to-br from-slate-800/50 to-slate-900/50 border border-dashed border-slate-600 rounded-xl">
                <Clock className="w-16 h-16 text-gray-500 mx-auto mb-4 opacity-50" />
                <p className="text-gray-400 font-semibold mb-1">No pending loan applications</p>
                <p className="text-sm text-gray-500">Loan applications will appear here</p>
              </div>
            ) : (
              pendingLoans.map((loan) => (
                <div
                  key={loan.id}
                  className="bg-gradient-to-br from-slate-800/80 to-slate-900/60 border-2 border-amber-500/40 rounded-xl p-6 hover:border-amber-500/60 transition-all shadow-lg"
                >
                  <div className="flex items-start justify-between mb-5">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <div className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse"></div>
                        <h3 className="text-lg font-bold text-white">💰 {loan.applicant_name}</h3>
                      </div>
                      <p className="text-xs text-gray-500">
                        📅 Applied {new Date(loan.created_at).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 bg-amber-500/20 px-3 py-1.5 rounded-lg">
                      <Clock className="w-4 h-4 text-amber-400" />
                      <span className="text-xs font-bold text-amber-400">AWAITING REVIEW</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3 mb-5">
                    <div className="bg-slate-700/50 rounded-lg p-4 border-l-4 border-l-amber-500">
                      <p className="text-xs text-gray-400 mb-1">💵 Loan Amount</p>
                      <p className="text-xl font-bold text-amber-400">{loan.loan_amount} ICAN</p>
                    </div>
                    <div className="bg-slate-700/50 rounded-lg p-4 border-l-4 border-l-blue-500">
                      <p className="text-xs text-gray-400 mb-1">📋 Purpose</p>
                      <p className="text-sm text-gray-200 line-clamp-2">{loan.loan_purpose}</p>
                    </div>
                    <div className="bg-slate-700/50 rounded-lg p-4 border-l-4 border-l-purple-500">
                      <p className="text-xs text-gray-400 mb-1">📅 Repayment</p>
                      <p className="text-sm text-gray-200">{loan.repayment_months} months</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={() => handleApproveLoan(loan.id, 'Admin approved')}
                      disabled={processing}
                      className="py-3 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 disabled:from-gray-600 disabled:to-gray-700 text-white rounded-lg font-bold transition-all transform hover:scale-105 active:scale-95 flex items-center justify-center gap-2 shadow-lg"
                    >
                      <ThumbsUp className="w-5 h-5" />
                      Approve & Vote
                    </button>
                    <button
                      onClick={() => handleRejectLoan(loan.id, 'Admin rejected')}
                      disabled={processing}
                      className="py-3 bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-700 hover:to-rose-700 disabled:from-gray-600 disabled:to-gray-700 text-white rounded-lg font-bold transition-all transform hover:scale-105 active:scale-95 flex items-center justify-center gap-2 shadow-lg"
                    >
                      <ThumbsDown className="w-5 h-5" />
                      Reject
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Member Applications in Voting */}
        {activeTab === 'voting-members' && (
          <div className="space-y-4">
            {votingApps.length === 0 ? (
              <div className="text-center py-16 bg-gradient-to-br from-slate-800/50 to-slate-900/50 border border-dashed border-slate-600 rounded-xl">
                <Users className="w-16 h-16 text-gray-500 mx-auto mb-4 opacity-50" />
                <p className="text-gray-400 font-semibold mb-1">No applications in voting</p>
                <p className="text-sm text-gray-500">Voting applications will appear here</p>
              </div>
            ) : (
              votingApps.map((app) => {
                const details = app.votingDetails;

                return (
                  <div
                    key={app.id}
                    className="bg-gradient-to-br from-slate-800/80 to-slate-900/60 border-2 border-purple-500/40 rounded-xl p-6 hover:border-purple-500/60 transition-all shadow-lg"
                  >
                    <div className="flex items-start justify-between mb-5">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <div className="w-2.5 h-2.5 rounded-full bg-purple-400 animate-pulse"></div>
                          <h3 className="text-lg font-bold text-white">{app.user_email}</h3>
                        </div>
                        <p className="text-xs text-gray-500">
                          Status: {app.status === 'approved'
                            ? '✅ Approved by voting'
                            : app.status === 'rejected_by_vote'
                            ? '❌ Rejected by voting'
                            : '🗳️ Voting in progress'}
                        </p>
                      </div>
                      {app.status === 'approved' && (
                        <div className="flex items-center gap-2 bg-green-500/20 px-3 py-1.5 rounded-lg">
                          <CheckCircle className="w-4 h-4 text-green-400" />
                          <span className="text-xs font-bold text-green-400">APPROVED</span>
                        </div>
                      )}
                      {app.status === 'rejected_by_vote' && (
                        <div className="flex items-center gap-2 bg-red-500/20 px-3 py-1.5 rounded-lg">
                          <XCircle className="w-4 h-4 text-red-400" />
                          <span className="text-xs font-bold text-red-400">REJECTED</span>
                        </div>
                      )}
                      {app.status === 'voting_in_progress' && (
                        <div className="flex items-center gap-2 bg-purple-500/20 px-3 py-1.5 rounded-lg">
                          <TrendingUp className="w-4 h-4 text-purple-400" />
                          <span className="text-xs font-bold text-purple-400">VOTING</span>
                        </div>
                      )}
                    </div>

                    <div className="bg-slate-700/50 rounded-lg p-4 mb-5 border-l-4 border-l-blue-500">
                      <p className="text-xs uppercase tracking-widest text-gray-500 font-semibold mb-2">📝 Application Message</p>
                      <p className="text-sm text-gray-200 leading-relaxed">"{app.application_text}"</p>
                    </div>

                    {details && (
                      <div className="space-y-4">
                        {/* Progress Bar */}
                        <div>
                          <div className="flex items-center justify-between text-sm mb-3">
                            <span className="text-gray-300 font-semibold flex items-center gap-2">
                              <TrendingUp className="w-4 h-4" />
                              Approval Progress (60% Threshold)
                            </span>
                            <span className={`font-bold text-lg ${details.thresholdReached ? 'text-green-400' : 'text-blue-400'}`}>
                              {details.yesPercentage}%
                            </span>
                          </div>
                          <div className="w-full bg-slate-700 rounded-full h-3 overflow-hidden border border-slate-600">
                            <div
                              className={`h-full transition-all duration-500 ${details.thresholdReached ? 'bg-gradient-to-r from-green-500 to-emerald-500' : 'bg-gradient-to-r from-blue-500 to-purple-500'}`}
                              style={{ width: `${Math.min(parseFloat(details.yesPercentage), 100)}%` }}
                            />
                          </div>
                          <div className="mt-2 text-xs text-gray-400 flex justify-between">
                            <span>0%</span>
                            <span className="font-semibold text-blue-400">60% needed</span>
                            <span>100%</span>
                          </div>
                        </div>

                        {/* Vote Stats Grid */}
                        <div className="grid grid-cols-4 gap-2">
                          <div className="bg-gradient-to-br from-green-500/20 to-green-600/10 border border-green-400/30 rounded-lg p-3 text-center hover:border-green-400/60 transition-all">
                            <ThumbsUp className="w-4 h-4 text-green-400 mx-auto mb-1" />
                            <div className="text-xs text-gray-400">Yes</div>
                            <div className="text-xl font-bold text-green-400">{details.yesVotes}</div>
                          </div>
                          <div className="bg-gradient-to-br from-red-500/20 to-red-600/10 border border-red-400/30 rounded-lg p-3 text-center hover:border-red-400/60 transition-all">
                            <ThumbsDown className="w-4 h-4 text-red-400 mx-auto mb-1" />
                            <div className="text-xs text-gray-400">No</div>
                            <div className="text-xl font-bold text-red-400">{details.noVotes}</div>
                          </div>
                          <div className="bg-gradient-to-br from-blue-500/20 to-blue-600/10 border border-blue-400/30 rounded-lg p-3 text-center hover:border-blue-400/60 transition-all">
                            <Users className="w-4 h-4 text-blue-400 mx-auto mb-1" />
                            <div className="text-xs text-gray-400">Voted</div>
                            <div className="text-xl font-bold text-blue-400">{details.totalVoted}</div>
                          </div>
                          <div className="bg-gradient-to-br from-slate-600/30 to-slate-700/20 border border-slate-500/40 rounded-lg p-3 text-center hover:border-slate-500/60 transition-all">
                            <Users className="w-4 h-4 text-gray-400 mx-auto mb-1" />
                            <div className="text-xs text-gray-400">Total</div>
                            <div className="text-xl font-bold text-gray-300">{details.totalMembers}</div>
                          </div>
                        </div>

                        {/* Status Messages */}
                        {details.thresholdReached && (
                          <div className="p-4 bg-gradient-to-r from-green-500/20 to-emerald-500/20 border-2 border-green-400/50 rounded-lg flex items-start gap-3 animate-pulse">
                            <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
                            <div>
                              <p className="text-green-300 font-bold text-sm">🎉 Auto-Approved at 60% Threshold!</p>
                              <p className="text-green-300/80 text-xs mt-1">This applicant has been approved and will be added to the group.</p>
                            </div>
                          </div>
                        )}

                        {!details.thresholdReached && app.status === 'voting_in_progress' && (
                          <div className="p-4 bg-gradient-to-r from-purple-500/20 to-pink-500/20 border-2 border-purple-400/50 rounded-lg flex items-start gap-3">
                            <AlertCircle className="w-5 h-5 text-purple-400 flex-shrink-0 mt-0.5" />
                            <div>
                              <p className="text-purple-300 font-bold text-sm">⏳ Voting In Progress</p>
                              <p className="text-purple-300/80 text-xs mt-1">{details.votesNeeded} more {details.votesNeeded === 1 ? 'vote' : 'votes'} needed for auto-approval</p>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* Loans in Voting */}
        {activeTab === 'voting-loans' && (
          <div className="space-y-4">
            {votingLoans.length === 0 ? (
              <div className="text-center py-16 bg-gradient-to-br from-slate-800/50 to-slate-900/50 border border-dashed border-slate-600 rounded-xl">
                <Users className="w-16 h-16 text-gray-500 mx-auto mb-4 opacity-50" />
                <p className="text-gray-400 font-semibold mb-1">No loans in voting</p>
                <p className="text-sm text-gray-500">Loans will appear here during voting</p>
              </div>
            ) : (
              votingLoans.map((loan) => (
                <div
                  key={loan.id}
                  className="bg-gradient-to-br from-slate-800/80 to-slate-900/60 border-2 border-purple-500/40 rounded-xl p-6 hover:border-purple-500/60 transition-all shadow-lg"
                >
                  <div className="flex items-start justify-between mb-5">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <div className="w-2.5 h-2.5 rounded-full bg-purple-400 animate-pulse"></div>
                        <h3 className="text-lg font-bold text-white">💰 {loan.applicant_name}</h3>
                      </div>
                      <p className="text-xs text-gray-500">
                        🗳️ Voting in progress
                      </p>
                    </div>
                    <div className="flex items-center gap-2 bg-purple-500/20 px-3 py-1.5 rounded-lg">
                      <TrendingUp className="w-4 h-4 text-purple-400" />
                      <span className="text-xs font-bold text-purple-400">VOTING</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3 mb-5">
                    <div className="bg-slate-700/50 rounded-lg p-4 border-l-4 border-l-amber-500">
                      <p className="text-xs text-gray-400 mb-1">💵 Loan Amount</p>
                      <p className="text-xl font-bold text-amber-400">{loan.loan_amount} ICAN</p>
                    </div>
                    <div className="bg-slate-700/50 rounded-lg p-4 border-l-4 border-l-blue-500">
                      <p className="text-xs text-gray-400 mb-1">📋 Purpose</p>
                      <p className="text-sm text-gray-200 line-clamp-2">{loan.loan_purpose}</p>
                    </div>
                    <div className="bg-slate-700/50 rounded-lg p-4 border-l-4 border-l-purple-500">
                      <p className="text-xs text-gray-400 mb-1">📅 Repayment</p>
                      <p className="text-sm text-gray-200">{loan.repayment_months} months</p>
                    </div>
                  </div>

                  {/* Voting Stats */}
                  <div className="space-y-4">
                    {/* Progress Bar */}
                    <div>
                      <div className="flex items-center justify-between text-sm mb-3">
                        <span className="text-gray-300 font-semibold flex items-center gap-2">
                          <TrendingUp className="w-4 h-4" />
                          Approval Progress (65% Threshold)
                        </span>
                        <span className="font-bold text-lg text-purple-400">
                          {Math.round((loan.votes_yes / (loan.votes_yes + loan.votes_no + loan.votes_abstain || 1)) * 100) || 0}%
                        </span>
                      </div>
                      <div className="w-full bg-slate-700 rounded-full h-3 overflow-hidden border border-slate-600">
                        <div
                          className="h-full transition-all duration-500 bg-gradient-to-r from-purple-500 to-pink-500"
                          style={{ width: `${Math.round((loan.votes_yes / (loan.votes_yes + loan.votes_no + loan.votes_abstain || 1)) * 100) || 0}%` }}
                        />
                      </div>
                      <div className="mt-2 text-xs text-gray-400 flex justify-between">
                        <span>0%</span>
                        <span className="font-semibold text-purple-400">65% needed</span>
                        <span>100%</span>
                      </div>
                    </div>

                    {/* Vote Stats Grid */}
                    <div className="grid grid-cols-4 gap-2">
                      <div className="bg-gradient-to-br from-green-500/20 to-green-600/10 border border-green-400/30 rounded-lg p-3 text-center hover:border-green-400/60 transition-all">
                        <ThumbsUp className="w-4 h-4 text-green-400 mx-auto mb-1" />
                        <div className="text-xs text-gray-400">Yes</div>
                        <div className="text-xl font-bold text-green-400">{loan.votes_yes || 0}</div>
                      </div>
                      <div className="bg-gradient-to-br from-red-500/20 to-red-600/10 border border-red-400/30 rounded-lg p-3 text-center hover:border-red-400/60 transition-all">
                        <ThumbsDown className="w-4 h-4 text-red-400 mx-auto mb-1" />
                        <div className="text-xs text-gray-400">No</div>
                        <div className="text-xl font-bold text-red-400">{loan.votes_no || 0}</div>
                      </div>
                      <div className="bg-gradient-to-br from-blue-500/20 to-blue-600/10 border border-blue-400/30 rounded-lg p-3 text-center hover:border-blue-400/60 transition-all">
                        <Eye className="w-4 h-4 text-blue-400 mx-auto mb-1" />
                        <div className="text-xs text-gray-400">Abstain</div>
                        <div className="text-xl font-bold text-blue-400">{loan.votes_abstain || 0}</div>
                      </div>
                      <div className="bg-gradient-to-br from-slate-600/30 to-slate-700/20 border border-slate-500/40 rounded-lg p-3 text-center hover:border-slate-500/60 transition-all">
                        <Users className="w-4 h-4 text-gray-400 mx-auto mb-1" />
                        <div className="text-xs text-gray-400">Total</div>
                        <div className="text-xl font-bold text-gray-300">{(loan.votes_yes || 0) + (loan.votes_no || 0) + (loan.votes_abstain || 0)}</div>
                      </div>
                    </div>

                    {/* Finalize Button */}
                    <button
                      onClick={() => handleFinalizeLoan(loan.id)}
                      disabled={processing}
                      className="w-full py-3 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 disabled:from-gray-600 disabled:to-gray-700 text-white rounded-lg font-bold transition-all transform hover:scale-105 active:scale-95 flex items-center justify-center gap-2 shadow-lg"
                    >
                      <Zap className="w-5 h-5" />
                      Finalize Voting
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminApplicationPanel;
