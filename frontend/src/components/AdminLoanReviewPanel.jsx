/**
 * Admin Loan Review Panel
 * For group admins to approve/reject/finalize loans
 */

import React, { useState } from 'react';
import { CheckCircle, XCircle, AlertCircle, TrendingUp } from 'lucide-react';

const AdminLoanReviewPanel = ({ groupId, user, loans = [], onReviewComplete }) => {
  const [reviewingLoanId, setReviewingLoanId] = useState(null);
  const [rejectionReasons, setRejectionReasons] = useState({});
  const [processing, setProcessing] = useState(false);
  const [message, setMessage] = useState(null);

  // Check if user is admin
  const isAdmin = user?.role === 'admin' || user?.is_creator;

  // ===== APPROVE LOAN =====
  const handleApproveLoan = async (loanId) => {
    setProcessing(true);
    try {
      const response = await supabase.rpc('admin_review_loan', {
        p_loan_application_id: loanId,
        p_decision: 'approved',
        p_rejection_reason: null
      });

      if (response.error) throw response.error;

      setMessage({ type: 'success', text: '✅ Loan approved! Moving to member voting.' });
      setReviewingLoanId(null);

      if (onReviewComplete) onReviewComplete();
    } catch (error) {
      console.error('Error approving loan:', error);
      setMessage({ type: 'error', text: `❌ Error: ${error.message}` });
    } finally {
      setProcessing(false);
    }
  };

  // ===== REJECT LOAN =====
  const handleRejectLoan = async (loanId) => {
    const reason = rejectionReasons[loanId];
    if (!reason) {
      alert('Please provide a rejection reason');
      return;
    }

    setProcessing(true);
    try {
      const response = await supabase.rpc('admin_review_loan', {
        p_loan_application_id: loanId,
        p_decision: 'rejected',
        p_rejection_reason: reason
      });

      if (response.error) throw response.error;

      setMessage({ type: 'success', text: '✅ Loan rejected.' });
      setReviewingLoanId(null);
      setRejectionReasons({...rejectionReasons, [loanId]: ''});

      if (onReviewComplete) onReviewComplete();
    } catch (error) {
      console.error('Error rejecting loan:', error);
      setMessage({ type: 'error', text: `❌ Error: ${error.message}` });
    } finally {
      setProcessing(false);
    }
  };

  // ===== FINALIZE VOTING =====
  const handleFinalizeVoting = async (loanId) => {
    setProcessing(true);
    try {
      const response = await supabase.rpc('finalize_loan_voting', {
        p_loan_application_id: loanId
      });

      if (response.error) throw response.error;

      setMessage({ type: 'success', text: '✅ Voting finalized!' });
      setReviewingLoanId(null);

      if (onReviewComplete) onReviewComplete();
    } catch (error) {
      console.error('Error finalizing voting:', error);
      setMessage({ type: 'error', text: `❌ Error: ${error.message}` });
    } finally {
      setProcessing(false);
    }
  };

  if (!isAdmin) {
    return (
      <div className="bg-red-900/20 border border-red-500/50 rounded-lg p-4 text-red-300 text-center">
        <AlertCircle className="inline mr-2 w-5 h-5" />
        Only group admins can review loans
      </div>
    );
  }

  const pendingAdminReview = loans.filter(l => l.status === 'pending_admin');
  const votingCompleted = loans.filter(l => l.status === 'voting_in_progress' && l.voting_completed);

  return (
    <div className="space-y-6">
      {/* Message */}
      {message && (
        <div
          className={`p-4 rounded-lg ${
            message.type === 'success'
              ? 'bg-green-900/30 border border-green-500/50 text-green-300'
              : 'bg-red-900/30 border border-red-500/50 text-red-300'
          }`}
        >
          {message.text}
        </div>
      )}

      {/* Section: Pending Admin Review */}
      {pendingAdminReview.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-yellow-500" />
            Pending Your Review ({pendingAdminReview.length})
          </h3>

          {pendingAdminReview.map(loan => (
            <div
              key={loan.id}
              className={`bg-gradient-to-r from-slate-800 to-slate-900 border border-yellow-500/30 rounded-lg p-5 transition-all ${
                reviewingLoanId === loan.id ? 'ring-2 ring-yellow-500' : ''
              }`}
            >
              {/* Loan Header */}
              <div className="flex justify-between items-start mb-3">
                <div>
                  <h4 className="text-lg font-bold text-white">{loan.applicant_name}</h4>
                  <p className="text-xs text-gray-400">{loan.applicant_email}</p>
                </div>
                <span className="px-2 py-1 bg-yellow-600/50 text-yellow-300 text-xs font-bold rounded-full">
                  ⏳ Awaiting Decision
                </span>
              </div>

              {/* Loan Details */}
              <div className="bg-slate-900/50 rounded-lg p-3 mb-4 space-y-2">
                <div className="flex justify-between">
                  <span className="text-sm text-gray-400">💰 Amount Requested:</span>
                  <span className="font-bold text-green-400">{loan.loan_amount} ICAN</span>
                </div>
                <div>
                  <span className="text-sm text-gray-400">📝 Purpose:</span>
                  <p className="text-sm text-gray-300 mt-1">{loan.loan_purpose}</p>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-gray-400">⏱️ Repayment:</span>
                  <span className="text-sm text-gray-300">{loan.repayment_duration_months} months (~{(loan.loan_amount / loan.repayment_duration_months).toFixed(2)}/month)</span>
                </div>
                <div className="flex justify-between text-xs text-gray-500">
                  <span>Applied: {new Date(loan.requested_at).toLocaleDateString()}</span>
                </div>
              </div>

              {/* Action Buttons */}
              {reviewingLoanId !== loan.id ? (
                <button
                  onClick={() => setReviewingLoanId(loan.id)}
                  className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold transition-all"
                >
                  📋 Review Application
                </button>
              ) : (
                <div className="space-y-3">
                  {/* Rejection reason textarea */}
                  <div className="mb-3">
                    <label className="text-xs font-semibold text-gray-400 block mb-1">
                      Rejection Reason (if rejecting)
                    </label>
                    <textarea
                      value={rejectionReasons[loan.id] || ''}
                      onChange={(e) => setRejectionReasons({...rejectionReasons, [loan.id]: e.target.value})}
                      placeholder="Explain why you're rejecting this loan..."
                      rows="2"
                      className="w-full px-2 py-1 text-xs bg-slate-700 border border-slate-600 rounded text-gray-200 placeholder-gray-500 focus:border-blue-500 focus:outline-none"
                    />
                  </div>

                  {/* Decision Buttons */}
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleApproveLoan(loan.id)}
                      disabled={processing}
                      className="flex-1 py-2 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 disabled:opacity-50 text-white rounded-lg font-bold text-sm transition-all"
                    >
                      <CheckCircle className="inline mr-1 w-4 h-4" />
                      {processing ? 'Processing...' : 'Approve'}
                    </button>
                    <button
                      onClick={() => handleRejectLoan(loan.id)}
                      disabled={processing}
                      className="flex-1 py-2 bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-700 hover:to-rose-700 disabled:opacity-50 text-white rounded-lg font-bold text-sm transition-all"
                    >
                      <XCircle className="inline mr-1 w-4 h-4" />
                      {processing ? 'Processing...' : 'Reject'}
                    </button>
                    <button
                      onClick={() => setReviewingLoanId(null)}
                      disabled={processing}
                      className="px-3 py-2 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-gray-300 rounded-lg font-bold text-sm transition-all"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Section: Finalize Voting */}
      {votingCompleted.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-purple-500" />
            Finalize Voting ({votingCompleted.length})
          </h3>

          {votingCompleted.map(loan => {
            const approvalPercentage = loan.total_votes_for / (loan.total_votes_for + loan.total_votes_against) * 100;
            const isApproved = approvalPercentage >= 65;

            return (
              <div
                key={loan.id}
                className="bg-gradient-to-r from-slate-800 to-slate-900 border border-purple-500/30 rounded-lg p-5"
              >
                {/* Header */}
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <h4 className="text-lg font-bold text-white">{loan.applicant_name}</h4>
                    <p className="text-xs text-gray-400">{loan.applicant_email}</p>
                  </div>
                  <span
                    className={`px-2 py-1 text-xs font-bold rounded-full ${
                      isApproved
                        ? 'bg-green-600/50 text-green-300'
                        : 'bg-red-600/50 text-red-300'
                    }`}
                  >
                    {isApproved ? '✅ Approved' : '❌ Rejected'}
                  </span>
                </div>

                {/* Voting Results */}
                <div className="bg-slate-900/50 rounded-lg p-3 mb-4">
                  <div className="flex justify-between text-sm mb-2">
                    <span className="text-gray-400">Voting Results:</span>
                    <span className="text-gray-300">
                      {loan.total_votes_for} ✅ vs {loan.total_votes_against} ❌ ({approvalPercentage.toFixed(1)}%)
                    </span>
                  </div>
                  <div className="w-full bg-slate-700 rounded-full h-3 overflow-hidden">
                    <div
                      className={`h-full transition-all ${
                        isApproved
                          ? 'bg-gradient-to-r from-green-500 to-emerald-500'
                          : 'bg-gradient-to-r from-red-500 to-rose-500'
                      }`}
                      style={{ width: `${Math.min(100, approvalPercentage)}%` }}
                    ></div>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    {isApproved ? '✅ Exceeds 65% threshold' : '❌ Below 65% threshold'}
                  </p>
                </div>

                {/* Finalize Button */}
                <button
                  onClick={() => handleFinalizeVoting(loan.id)}
                  disabled={processing}
                  className="w-full py-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 disabled:opacity-50 text-white rounded-lg font-bold transition-all"
                >
                  {processing ? '⏳ Finalizing...' : '🏁 Finalize Voting'}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Empty State */}
      {pendingAdminReview.length === 0 && votingCompleted.length === 0 && (
        <div className="text-center py-12 bg-slate-800/50 rounded-lg border border-slate-700">
          <CheckCircle className="w-12 h-12 text-gray-500 mx-auto mb-3" />
          <p className="text-gray-400">No loans to review</p>
        </div>
      )}
    </div>
  );
};

export default AdminLoanReviewPanel;
