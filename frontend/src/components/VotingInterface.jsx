/**
 * VotingInterface Component
 * Members & Admins vote on pending membership applications
 * Auto-approves when 60% threshold is reached
 */

import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  CheckCircle,
  XCircle,
  Users,
  TrendingUp,
  AlertCircle,
  ThumbsUp,
  ThumbsDown,
  Zap,
  Award,
  Vote
} from 'lucide-react';
import {
  getVotingApplicationsForMember,
  userHasVoted,
  submitVote,
  getVotingDetails
} from '../services/trustService';

const VotingInterface = ({ applications: initialApps, onVoteComplete }) => {
  const { user } = useAuth();
  const [applications, setApplications] = useState(initialApps || []);
  const [loading, setLoading] = useState(!initialApps);
  const [voting, setVoting] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });
  const [votingDetails, setVotingDetails] = useState({});
  const [userVotes, setUserVotes] = useState({});
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (!initialApps) {
      loadApplications();
    } else {
      loadVotingDetails();
    }
    // Poll for updates every 10 seconds
    const interval = setInterval(() => {
      if (initialApps) {
        loadVotingDetails();
      }
    }, 10000);
    return () => clearInterval(interval);
  }, [initialApps, user?.id]);

  const loadVotingDetails = async () => {
    if (!applications || applications.length === 0 || !user?.id) return;

    try {
      const details = {};
      const votes = {};

      for (const app of applications) {
        if (app.status === 'voting_in_progress') {
          try {
            const detail = await getVotingDetails(app.id);
            if (detail) {
              details[app.id] = detail;
            }
            const hasVoted = await userHasVoted(app.id, user.id);
            votes[app.id] = hasVoted;
          } catch (err) {
            console.error(`Error loading details for app ${app.id}:`, err);
          }
        }
      }

      setVotingDetails(details);
      setUserVotes(votes);
      console.log('Loaded voting details:', { details, votes });
    } catch (error) {
      console.error('Error loading voting details:', error);
    }
  };

  const loadApplications = async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      // This would be called from parent if needed
      // For now, voting details are loaded when apps passed as prop
    } catch (error) {
      console.error('Error loading applications:', error);
      setMessage({ type: 'error', text: 'Failed to load applications' });
    } finally {
      setLoading(false);
    }
  };

  const handleVote = async (applicationId, vote) => {
    if (!user?.id) {
      setMessage({ type: 'error', text: 'Please log in to vote' });
      return;
    }

    setVoting(true);
    setMessage({ type: '', text: '' });
    try {
      const result = await submitVote(applicationId, user.id, vote);

      if (result.success) {
        setUserVotes(prev => ({ ...prev, [applicationId]: true }));
        
        if (result.thresholdReached) {
          setMessage({
            type: 'success',
            text: '🎉 Your vote counted! Applicant auto-approved at 60% threshold!'
          });
        } else {
          setMessage({
            type: 'success',
            text: '✓ Your vote has been recorded'
          });
        }

        // Reload voting details after a moment
        setTimeout(() => {
          loadVotingDetails();
          if (onVoteComplete) onVoteComplete();
        }, 1500);
      } else {
        setMessage({ type: 'error', text: result.error || 'Failed to submit vote' });
      }
    } catch (error) {
      console.error('Error voting:', error);
      setMessage({ type: 'error', text: error.message || 'Error submitting vote' });
    } finally {
      setVoting(false);
    }
  };

  if (loading) {
    return (
      <div className="text-center py-12">
        <div className="w-12 h-12 bg-blue-500 rounded-full animate-spin mx-auto"></div>
        <p className="text-gray-400 mt-4">Loading voting applications...</p>
      </div>
    );
  }

  if (!applications || applications.length === 0) {
    return (
      <div className="text-center py-12 bg-slate-800/50 border border-slate-700 rounded-lg">
        <Vote className="w-12 h-12 text-gray-500 mx-auto mb-4" />
        <p className="text-gray-400 font-semibold">No active voting</p>
        <p className="text-sm text-gray-500 mt-2">Applications will appear here when admins start voting</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Message Alert */}
      {message.text && (
        <div
          className={`p-4 rounded-lg ${
            message.type === 'success'
              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-400/50'
              : 'bg-red-500/20 text-red-400 border border-red-400/50'
          }`}
        >
          {message.text}
        </div>
      )}

      {/* Voting Info */}
      <div className="bg-purple-500/20 border border-purple-400/40 p-4 rounded-lg flex items-start gap-3">
        <Vote className="w-5 h-5 text-purple-400 mt-0.5 flex-shrink-0" />
        <div className="text-sm text-purple-300">
          <strong className="text-purple-200">How to Vote:</strong> Click <span className="font-semibold">Approve</span> or <span className="font-semibold">Reject</span>. 
          Applicants are auto-approved at <span className="text-green-400 font-bold">60% approval</span> from members.
        </div>
      </div>
{/* Voting Applications */}
      {applications.map((app) => {
        const details = votingDetails[app.id];
        const hasVoted = userVotes[app.id];

        return (
          <div
            key={app.id}
            className="bg-gradient-to-br from-slate-800 to-slate-900 border-2 border-purple-500/40 rounded-xl p-6 hover:border-purple-500/60 transition-all"
          >
            {/* Applicant Header */}
            <div className="flex items-start justify-between mb-4">
              <div>
                {app.trust_groups && (
                  <p className="text-xs text-purple-400 font-semibold mb-2">🏢 {app.trust_groups.name}</p>
                )}
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-3 h-3 rounded-full bg-purple-400 animate-pulse"></div>
                  <h3 className="text-xl font-bold text-white">{app.user_email}</h3>
                </div>
                <p className="text-xs text-gray-500">📅 Applied {new Date(app.created_at).toLocaleDateString()}</p>
              </div>
              {hasVoted && (
                <div className="flex items-center gap-2 bg-blue-500/20 px-3 py-1.5 rounded-lg">
                  <CheckCircle className="w-4 h-4 text-blue-400" />
                  <span className="text-xs font-bold text-blue-400">YOUR VOTE</span>
                </div>
              )}
            </div>

            {/* Application Text */}
            <div className="bg-slate-700/50 rounded-lg p-4 mb-5 border-l-4 border-l-blue-500">
              <p className="text-xs uppercase tracking-widest text-gray-500 font-semibold mb-2">📝 Application</p>
              <p className="text-sm text-gray-200">"{app.application_text}"</p>
            </div>

            {/* Voting Stats */}
            {details && (
              <div className="space-y-4 mb-5">
                {/* Progress Bar */}
                <div>
                  <div className="flex items-center justify-between text-sm mb-3">
                    <span className="text-gray-300 font-semibold flex items-center gap-2">
                      <TrendingUp className="w-4 h-4" />
                      Approval Progress
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
                    <span className="font-semibold text-green-400">60% needed</span>
                    <span>100%</span>
                  </div>
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
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

                {!details.thresholdReached && !hasVoted && (
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

            {/* Vote Buttons */}
            {!hasVoted && !details?.thresholdReached && (
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => handleVote(app.id, 'yes')}
                  disabled={voting}
                  className="py-3 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 disabled:from-gray-600 disabled:to-gray-700 text-white rounded-lg font-bold transition-all transform hover:scale-105 active:scale-95 flex items-center justify-center gap-2 shadow-lg"
                >
                  <ThumbsUp className="w-5 h-5" />
                  Approve
                </button>
                <button
                  onClick={() => handleVote(app.id, 'no')}
                  disabled={voting}
                  className="py-3 bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-700 hover:to-rose-700 disabled:from-gray-600 disabled:to-gray-700 text-white rounded-lg font-bold transition-all transform hover:scale-105 active:scale-95 flex items-center justify-center gap-2 shadow-lg"
                >
                  <ThumbsDown className="w-5 h-5" />
                  Reject
                </button>
              </div>
            )}

            {hasVoted && !details?.thresholdReached && (
              <div className="p-3 bg-blue-500/20 border-2 border-blue-400/50 rounded-lg text-blue-300 text-sm font-semibold flex items-center justify-center gap-2">
                <CheckCircle className="w-4 h-4" />
                ✓ You voted on this application
              </div>
            )}

            {details?.thresholdReached && (
              <div className="p-3 bg-green-500/20 border-2 border-green-400/50 rounded-lg text-green-300 text-sm font-semibold flex items-center justify-center gap-2">
                <Award className="w-4 h-4" />
                ✓ Applicant Approved
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default VotingInterface;
