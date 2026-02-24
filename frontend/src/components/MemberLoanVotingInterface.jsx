/**
 * Member Loan Voting Interface
 * For group members to vote on loan applications
 */

import React, { useState } from 'react';
import { Vote, CheckCircle, MessageSquare, AlertCircle } from 'lucide-react';

const MemberLoanVotingInterface = ({ groupId, userId, user, loansForVoting = [], onVoteSubmitted }) => {
  const [selectedLoanId, setSelectedLoanId] = useState(null);
  const [voteChoice, setVoteChoice] = useState(null); // 'yes', 'no', 'abstain'
  const [voteReason, setVoteReason] = useState('');
  const [votedLoans, setVotedLoans] = useState({}); // Track which loans user has voted on
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState(null);

  // ===== SUBMIT VOTE =====
  const handleSubmitVote = async (loanId) => {
    if (!voteChoice) {
      alert('Please select yes, no, or abstain');
      return;
    }

    setSubmitting(true);
    try {
      const vote_value = voteChoice === 'yes' ? 'yes' : voteChoice === 'no' ? 'no' : 'abstain';

      const response = await supabase.rpc('member_vote_on_loan', {
        p_loan_application_id: loanId,
        p_member_id: userId,
        p_vote: vote_value,
        p_reason: voteReason
      });

      if (response.error) throw response.error;

      setMessage({ type: 'success', text: '✅ Your vote has been recorded!' });
      setVotedLoans({...votedLoans, [loanId]: voteChoice});
      setSelectedLoanId(null);
      setVoteChoice(null);
      setVoteReason('');

      if (onVoteSubmitted) onVoteSubmitted();
    } catch (error) {
      console.error('Error submitting vote:', error);
      setMessage({ type: 'error', text: `❌ Error: ${error.message}` });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
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

      {/* Empty State */}
      {loansForVoting.length === 0 ? (
        <div className="text-center py-12 bg-slate-800/50 rounded-lg border border-slate-700">
          <Vote className="w-12 h-12 text-gray-500 mx-auto mb-3" />
          <p className="text-gray-400">No loans currently under voting</p>
        </div>
      ) : (
        /* Voting List */
        <div className="space-y-3">
          {loansForVoting.map(loan => {
            const applicantIsUser = loan.applicant_id === userId;
            const userHasVoted = votedLoans[loan.id];
            const approvalPercentage = loan.total_votes_for && loan.total_votes_against
              ? (loan.total_votes_for / (loan.total_votes_for + loan.total_votes_against)) * 100
              : 0;

            return (
              <div
                key={loan.id}
                className={`bg-gradient-to-r from-slate-800 to-slate-900 border rounded-lg p-5 transition-all ${
                  applicantIsUser
                    ? 'border-gray-600 opacity-75 cursor-not-allowed'
                    : 'border-purple-500/30 cursor-pointer hover:border-purple-500/50'
                } ${selectedLoanId === loan.id ? 'ring-2 ring-purple-500' : ''}`}
              >
                {/* Header */}
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <h4 className="text-lg font-bold text-white">
                      {loan.applicant_name}
                    </h4>
                    <p className="text-xs text-gray-400">{loan.applicant_email}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {applicantIsUser && (
                      <span className="px-2 py-1 bg-gray-600/50 text-gray-300 text-xs font-bold rounded-full">
                        🚫 Can't Vote
                      </span>
                    )}
                    {userHasVoted && (
                      <span className="px-2 py-1 bg-green-600/50 text-green-300 text-xs font-bold rounded-full">
                        ✅ Voted {userHasVoted.toUpperCase()}
                      </span>
                    )}
                    {!userHasVoted && !applicantIsUser && (
                      <span className="px-2 py-1 bg-yellow-600/50 text-yellow-300 text-xs font-bold rounded-full">
                        🗳️ Awaiting Vote
                      </span>
                    )}
                  </div>
                </div>

                {/* Loan Details */}
                <div className="bg-slate-900/50 rounded-lg p-3 mb-4 space-y-2">
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-400">💰 Requesting:</span>
                    <span className="font-bold text-green-400">{loan.loan_amount} ICAN</span>
                  </div>
                  <div>
                    <span className="text-sm text-gray-400">📝 Purpose:</span>
                    <p className="text-sm text-gray-300 mt-1">{loan.loan_purpose}</p>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-400">⏱️ Repayment:</span>
                    <span className="text-sm text-gray-300">
                      {loan.repayment_duration_months} months (~{(loan.loan_amount / loan.repayment_duration_months).toFixed(2)}/month)
                    </span>
                  </div>
                </div>

                {/* Voting Progress */}
                <div className="bg-slate-800/50 rounded-lg p-3 mb-4">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-sm font-semibold text-gray-300">Vote Tally</span>
                    <span className="text-xs text-gray-400">
                      {loan.total_members_voted || 0} of {loan.total_group_members || '?'} members voted
                    </span>
                  </div>

                  {/* Vote Count */}
                  <div className="flex gap-3 mb-2 text-xs">
                    <div className="flex-1 bg-green-900/30 border border-green-600/50 rounded px-2 py-1 text-center">
                      <div className="text-green-400 font-bold">{loan.total_votes_for || 0}</div>
                      <div className="text-gray-400">✅ Yes</div>
                    </div>
                    <div className="flex-1 bg-red-900/30 border border-red-600/50 rounded px-2 py-1 text-center">
                      <div className="text-red-400 font-bold">{loan.total_votes_against || 0}</div>
                      <div className="text-gray-400">❌ No</div>
                    </div>
                    <div className="flex-1 bg-slate-700/50 border border-slate-600/50 rounded px-2 py-1 text-center">
                      <div className="text-gray-300 font-bold">{loan.total_votes_abstain || 0}</div>
                      <div className="text-gray-400">🤷 Abstain</div>
                    </div>
                  </div>

                  {/* Progress Bar */}
                  <div className="w-full bg-slate-700 rounded-full h-2 overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-green-500 to-emerald-500 transition-all"
                      style={{ width: `${Math.min(100, approvalPercentage)}%` }}
                    ></div>
                  </div>

                  {/* Approval Status */}
                  <div className="flex justify-between items-center mt-2 text-xs">
                    <span className="text-gray-400">
                      {approvalPercentage >= 65
                        ? '✅ On track for approval'
                        : '❌ Below 65% threshold'}
                    </span>
                    <span className="text-gray-400 font-semibold">
                      {approvalPercentage.toFixed(1)}%
                    </span>
                  </div>
                </div>

                {/* Voting Controls */}
                {!applicantIsUser && !userHasVoted && (
                  <div className="space-y-3">
                    {selectedLoanId !== loan.id ? (
                      <button
                        onClick={() => setSelectedLoanId(loan.id)}
                        className="w-full py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-bold transition-all flex items-center justify-center gap-2"
                      >
                        <Vote className="w-4 h-4" />
                        Cast Your Vote
                      </button>
                    ) : (
                      /* Vote Form */
                      <div className="space-y-2">
                        {/* Vote Options */}
                        <div className="space-y-2">
                          <label className="text-sm font-semibold text-gray-300">Choose your vote:</label>
                          <div className="grid grid-cols-3 gap-2">
                            <button
                              onClick={() => setVoteChoice('yes')}
                              className={`py-2 rounded-lg font-bold text-sm transition-all ${
                                voteChoice === 'yes'
                                  ? 'bg-green-600 text-white border-2 border-green-400'
                                  : 'bg-green-900/30 text-green-300 border border-green-600/50 hover:bg-green-900/50'
                              }`}
                            >
                              ✅ YES
                            </button>
                            <button
                              onClick={() => setVoteChoice('no')}
                              className={`py-2 rounded-lg font-bold text-sm transition-all ${
                                voteChoice === 'no'
                                  ? 'bg-red-600 text-white border-2 border-red-400'
                                  : 'bg-red-900/30 text-red-300 border border-red-600/50 hover:bg-red-900/50'
                              }`}
                            >
                              ❌ NO
                            </button>
                            <button
                              onClick={() => setVoteChoice('abstain')}
                              className={`py-2 rounded-lg font-bold text-sm transition-all ${
                                voteChoice === 'abstain'
                                  ? 'bg-slate-600 text-white border-2 border-slate-400'
                                  : 'bg-slate-700/50 text-gray-300 border border-slate-600/50 hover:bg-slate-700'
                              }`}
                            >
                              🤷 ABSTAIN
                            </button>
                          </div>
                        </div>

                        {/* Reason Textarea */}
                        <div>
                          <label className="text-xs font-semibold text-gray-400 block mb-1">
                            <MessageSquare className="inline mr-1 w-3 h-3" />
                            Reason (optional)
                          </label>
                          <textarea
                            value={voteReason}
                            onChange={(e) => setVoteReason(e.target.value)}
                            placeholder="Why are you voting this way?"
                            rows="2"
                            className="w-full px-2 py-1 text-xs bg-slate-700 border border-slate-600 rounded text-gray-200 placeholder-gray-500 focus:border-purple-500 focus:outline-none"
                          />
                        </div>

                        {/* Submit/Cancel Buttons */}
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleSubmitVote(loan.id)}
                            disabled={submitting || !voteChoice}
                            className="flex-1 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-bold text-sm transition-all"
                          >
                            {submitting ? '⏳ Submitting...' : '📨 Submit Vote'}
                          </button>
                          <button
                            onClick={() => {
                              setSelectedLoanId(null);
                              setVoteChoice(null);
                              setVoteReason('');
                            }}
                            disabled={submitting}
                            className="px-3 py-2 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-gray-300 rounded-lg font-bold text-sm transition-all"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default MemberLoanVotingInterface;
