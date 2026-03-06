/**
 * TRUST Loan Management Component
 * Handles loan applications, voting, and admin approvals
 */

import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase/client';
import {
  DollarSign,
  Plus
} from 'lucide-react';

const TrustLoanManagement = ({ groupId, groupName, onClose }) => {
  const { user } = useAuth();
  const [activeSubTab, setActiveSubTab] = useState('apply'); // apply only
  const [showApplicationForm, setShowApplicationForm] = useState(false);
  const [loanApplications, setLoanApplications] = useState([]);
  const [message, setMessage] = useState({ type: '', text: '' });
  
  // Form state
  const [formData, setFormData] = useState({
    loanAmount: '',
    loanPurpose: '',
    repaymentMonths: 12
  });
  const [submitting, setSubmitting] = useState(false);

  // ===== LOAN APPLICATION FORM =====
  const handleSubmitLoanApplication = async () => {
    if (!formData.loanAmount || !formData.loanPurpose) {
      setMessage({
        type: 'error',
        text: '❌ Please fill in all fields'
      });
      return;
    }

    setSubmitting(true);
    try {
      // Call RPC: submit_loan_application
      const response = await supabase.rpc('submit_loan_application', {
        p_group_id: groupId,
        p_loan_amount: parseFloat(formData.loanAmount),
        p_loan_purpose: formData.loanPurpose,
        p_repayment_months: parseInt(formData.repaymentMonths)
      });

      if (response.error) throw response.error;

      setMessage({
        type: 'success',
        text: '✅ Loan application submitted! Awaiting admin review.'
      });

      setFormData({ loanAmount: '', loanPurpose: '', repaymentMonths: 12 });
      setShowApplicationForm(false);

      // Close modal after success
      setTimeout(() => {
        if (onClose) onClose();
      }, 2000);
    } catch (error) {
      console.error('Error submitting loan:', error);
      setMessage({
        type: 'error',
        text: `❌ Error: ${error.message}`
      });
    } finally {
      setSubmitting(false);
    }
  };

  // ===== SUB-TAB: APPLY FOR LOAN =====
  const renderApplyForLoan = () => {
    return (
      <div className="space-y-4">
        {!showApplicationForm ? (
          <div className="bg-gradient-to-r from-blue-900 to-blue-950 border border-blue-500/30 rounded-lg p-6 text-center">
            <DollarSign className="w-16 h-16 text-blue-400 mx-auto mb-4" />
            <h3 className="text-2xl font-bold text-white mb-2">Apply for a Loan</h3>
            <p className="text-gray-300 mb-4">Get funds from your group with approval from admins and voting by members</p>
            
            <div className="bg-blue-900/50 border border-blue-400/30 rounded-lg p-4 mb-4 text-left">
              <h4 className="font-bold text-blue-300 mb-2">📋 Process:</h4>
              <ol className="text-sm text-gray-300 space-y-1">
                <li>✅ <strong>Step 1:</strong> Submit application to admin</li>
                <li>✅ <strong>Step 2:</strong> Admin reviews & approves loan</li>
                <li>✅ <strong>Step 3:</strong> Group members vote on application</li>
                <li>✅ <strong>Step 4:</strong> Need 65% member approval to get approved</li>
                <li>✅ <strong>Step 5:</strong> Admin disburses approved loan</li>
              </ol>
            </div>

            <button
              onClick={() => setShowApplicationForm(true)}
              className="w-full py-3 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white rounded-lg font-bold transition-all"
            >
              <Plus className="inline mr-2 w-5 h-5" />
              Apply Now
            </button>
          </div>
        ) : (
          <div className="bg-slate-800 border border-blue-500/50 rounded-lg p-6">
            <h3 className="text-xl font-bold text-white mb-4">💰 Loan Application Form</h3>
            
            <div className="space-y-4">
              {/* Loan Amount */}
              <div>
                <label className="block text-sm font-semibold text-gray-300 mb-2">
                  💵 Loan Amount (ICAN coins/USD)
                </label>
                <input
                  type="number"
                  value={formData.loanAmount}
                  onChange={(e) => setFormData({...formData, loanAmount: e.target.value})}
                  placeholder="Enter amount"
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
                />
              </div>

              {/* Loan Purpose */}
              <div>
                <label className="block text-sm font-semibold text-gray-300 mb-2">
                  📝 Purpose of Loan
                </label>
                <textarea
                  value={formData.loanPurpose}
                  onChange={(e) => setFormData({...formData, loanPurpose: e.target.value})}
                  placeholder="Describe why you need this loan (business, emergency, investment, etc.)"
                  rows="4"
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
                />
              </div>

              {/* Repayment Duration */}
              <div>
                <label className="block text-sm font-semibold text-gray-300 mb-2">
                  ⏱️ Repayment Duration (months)
                </label>
                <select
                  value={formData.repaymentMonths}
                  onChange={(e) => setFormData({...formData, repaymentMonths: e.target.value})}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white focus:border-blue-500 focus:outline-none"
                >
                  <option value="3">3 Months</option>
                  <option value="6">6 Months</option>
                  <option value="12">12 Months</option>
                  <option value="18">18 Months</option>
                  <option value="24">24 Months</option>
                </select>
              </div>

              {/* Summary */}
              {formData.loanAmount && (
                <div className="bg-blue-900/30 border border-blue-500/50 rounded-lg p-3">
                  <p className="text-sm text-gray-300">
                    <strong>Loan Summary:</strong><br/>
                    Amount: <span className="text-green-400 font-bold">{formData.loanAmount} ICAN</span><br/>
                    Repayment: <span className="text-gray-300">{formData.repaymentMonths} months</span><br/>
                    Monthly Payment: <span className="text-yellow-400">{(parseFloat(formData.loanAmount) / formData.repaymentMonths).toFixed(2)} ICAN</span>
                  </p>
                </div>
              )}

              {/* Buttons */}
              <div className="flex gap-3">
                <button
                  onClick={handleSubmitLoanApplication}
                  disabled={submitting}
                  className="flex-1 py-2 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 disabled:opacity-50 text-white rounded-lg font-bold transition-all"
                >
                  {submitting ? '⏳ Submitting...' : '✅ Submit Application'}
                </button>
                <button
                  onClick={() => {
                    setShowApplicationForm(false);
                    setFormData({ loanAmount: '', loanPurpose: '', repaymentMonths: 12 });
                  }}
                  className="flex-1 py-2 bg-slate-700 hover:bg-slate-600 text-gray-300 rounded-lg font-bold transition-all"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  // ===== SUB-TAB: PENDING ADMIN REVIEW =====
  const renderPendingReview = () => {
    const pending = loanApplications.filter(app => app.status === 'pending_admin' || app.status === 'admin_approved');
    
    return (
      <div className="space-y-4">
        {pending.length === 0 ? (
          <div className="text-center py-12 bg-slate-800/50 rounded-lg border border-slate-700">
            <Clock className="w-12 h-12 text-gray-500 mx-auto mb-3" />
            <p className="text-gray-400">No pending applications</p>
          </div>
        ) : (
          pending.map(app => (
            <div key={app.id} className="bg-gradient-to-r from-slate-800 to-slate-900 border border-yellow-500/30 rounded-lg p-5">
              <div className="flex justify-between items-start mb-3">
                <div>
                  <h3 className="text-lg font-bold text-white">{app.applicant_name}</h3>
                  <p className="text-sm text-gray-400">{app.applicant_email}</p>
                </div>
                <span className="px-3 py-1 bg-yellow-600 text-yellow-100 text-xs font-bold rounded-full">
                  ⏳ Pending Admin Review
                </span>
              </div>

              <div className="bg-slate-900/50 rounded-lg p-3 mb-3">
                <p className="text-sm text-gray-300 mb-2">
                  <strong>💰 Loan Amount:</strong> <span className="text-green-400 font-bold">{app.loan_amount} ICAN</span>
                </p>
                <p className="text-sm text-gray-300 mb-2">
                  <strong>📝 Purpose:</strong> {app.loan_purpose}
                </p>
                <p className="text-sm text-gray-300">
                  <strong>⏱️ Repayment:</strong> {app.repayment_duration_months} months (~{(app.loan_amount / app.repayment_duration_months).toFixed(2)} per month)
                </p>
              </div>

              <p className="text-xs text-gray-500">Applied: {new Date(app.requested_at).toLocaleDateString()}</p>
            </div>
          ))
        )}
      </div>
    );
  };

  // ===== SUB-TAB: MEMBER VOTING =====
  const renderVoting = () => {
    const voting = loanApplications.filter(app => app.status === 'voting_in_progress');
    
    return (
      <div className="space-y-4">
        {voting.length === 0 ? (
          <div className="text-center py-12 bg-slate-800/50 rounded-lg border border-slate-700">
            <Vote className="w-12 h-12 text-gray-500 mx-auto mb-3" />
            <p className="text-gray-400">No active voting</p>
          </div>
        ) : (
          voting.map(app => (
            <div key={app.id} className="bg-gradient-to-r from-slate-800 to-slate-900 border border-purple-500/30 rounded-lg p-5">
              <div className="flex justify-between items-start mb-3">
                <div>
                  <h3 className="text-lg font-bold text-white">{app.applicant_name}</h3>
                  <p className="text-sm text-gray-400">{app.applicant_email}</p>
                </div>
                <span className="px-3 py-1 bg-purple-600 text-purple-100 text-xs font-bold rounded-full">
                  🗳️ Voting In Progress
                </span>
              </div>

              <div className="bg-slate-900/50 rounded-lg p-3 mb-4">
                <p className="text-sm text-gray-300 mb-3">
                  <strong>💰 Requesting:</strong> <span className="text-green-400 font-bold">{app.loan_amount} ICAN</span>
                </p>
                <p className="text-sm text-gray-300 mb-3">
                  <strong>📝 Purpose:</strong> {app.loan_purpose}
                </p>

                {/* Voting Progress */}
                <div className="mb-3">
                  <div className="flex justify-between text-xs text-gray-400 mb-1">
                    <span>Votes: {app.total_votes_for || 0} ✅ vs {app.total_votes_against || 0} ❌</span>
                    <span>{app.total_members_voted || 0} members voted</span>
                  </div>
                  <div className="w-full bg-slate-700 rounded-full h-2 overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-green-500 to-emerald-500"
                      style={{
                        width: `${
                          app.total_votes_for + app.total_votes_against > 0
                            ? (app.total_votes_for / (app.total_votes_for + app.total_votes_against)) * 100
                            : 0
                        }%`
                      }}
                    ></div>
                  </div>
                </div>

                {/* Approval Threshold */}
                <p className="text-xs text-gray-400">
                  Needs 65% member approval • Voting ends: {new Date(app.voting_ended_at || Date.now()).toLocaleDateString()}
                </p>
              </div>

              {/* Vote Buttons */}
              {app.applicant_id !== user?.id && (
                <div className="flex gap-2">
                  <button className="flex-1 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-bold text-sm transition-all">
                    ✅ Approve
                  </button>
                  <button className="flex-1 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-bold text-sm transition-all">
                    ❌ Reject
                  </button>
                  <button className="flex-1 py-2 bg-slate-600 hover:bg-slate-700 text-white rounded-lg font-bold text-sm transition-all">
                    🤷 Abstain
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    );
  };

  // ===== SUB-TAB: APPROVED LOANS =====
  const renderApproved = () => {
    const approved = loanApplications.filter(app => app.status === 'approved');
    
    return (
      <div className="space-y-4">
        {approved.length === 0 ? (
          <div className="text-center py-12 bg-slate-800/50 rounded-lg border border-slate-700">
            <CheckCircle className="w-12 h-12 text-gray-500 mx-auto mb-3" />
            <p className="text-gray-400">No approved loans yet</p>
          </div>
        ) : (
          approved.map(app => (
            <div key={app.id} className="bg-gradient-to-r from-slate-800 to-slate-900 border border-green-500/30 rounded-lg p-5">
              <div className="flex justify-between items-start mb-3">
                <div>
                  <h3 className="text-lg font-bold text-white">{app.applicant_name}</h3>
                  <p className="text-sm text-gray-400">{app.applicant_email}</p>
                </div>
                <span className="px-3 py-1 bg-green-600 text-green-100 text-xs font-bold rounded-full">
                  ✅ Approved
                </span>
              </div>

              <div className="bg-slate-900/50 rounded-lg p-3">
                <p className="text-sm text-gray-300 mb-2">
                  <strong>💰 Loan Amount:</strong> <span className="text-green-400 font-bold">{app.loan_amount} ICAN</span>
                </p>
                <p className="text-sm text-gray-300 mb-2">
                  <strong>Total Votes:</strong> {app.total_votes_for} ✅ vs {app.total_votes_against} ❌
                </p>
                <p className="text-sm text-gray-300">
                  <strong>Repayment:</strong> {app.repayment_duration_months} months
                </p>
              </div>
            </div>
          ))
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Message Alert */}
      {message.text && (
        <div className={`p-3 rounded-lg ${
          message.type === 'success' ? 'bg-green-500/20 text-green-300 border border-green-400/50' :
          'bg-red-500/20 text-red-300 border border-red-400/50'
        }`}>
          {message.text}
        </div>
      )}

      {/* Apply for Loan — direct, no sub-tabs */}
      {renderApplyForLoan()}
    </div>
  );
};

export default TrustLoanManagement;
