import React, { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';

const ShareholderPendingSignatures = () => {
  const [pendingApprovals, setPendingApprovals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [approvingId, setApprovingId] = useState(null);
  const [slideProgress, setSlideProgress] = useState({});

  useEffect(() => {
    loadPendingApprovals();
    const interval = setInterval(loadPendingApprovals, 5000); // Refresh every 5 seconds
    return () => clearInterval(interval);
  }, []);

  const loadPendingApprovals = async () => {
    try {
      setLoading(true);
      const { getSupabase } = await import('../services/pitchingService');
      const supabase = getSupabase();
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        setError('Not authenticated');
        return;
      }

      setCurrentUser(user);

      console.log(`🔍 Looking for pending approvals for: ${user.email}`);

      // Fetch pending shareholder approval notifications
      // Try first by shareholder_id, then fallback to shareholder_email
      let approvals;
      let fetchError;

      // First attempt: Query by shareholder_id
      const { data: byId, error: errorById } = await supabase
        .from('shareholder_notifications')
        .select('*')
        .eq('shareholder_id', user.id)
        .is('read_at', null)
        .order('created_at', { ascending: false });

      if (!errorById && byId && byId.length > 0) {
        console.log(`   ✅ Found ${byId.length} pending approvals by shareholder_id`);
        approvals = byId;
        fetchError = null;
      } else {
        // Fallback: Query by shareholder_email
        console.log(`   ℹ️ No results by shareholder_id, trying by shareholder_email...`);
        const { data: byEmail, error: errorByEmail } = await supabase
          .from('shareholder_notifications')
          .select('*')
          .eq('shareholder_email', user.email)
          .is('read_at', null)
          .order('created_at', { ascending: false });

        approvals = byEmail;
        fetchError = errorByEmail;
        
        if (!fetchError && byEmail && byEmail.length > 0) {
          console.log(`   ✅ Found ${byEmail.length} pending approvals by shareholder_email`);
        }
      }

      if (fetchError) throw fetchError;

      console.log(`📬 Found ${approvals?.length || 0} pending approvals for shareholder ${user.email}`);
      setPendingApprovals(approvals || []);
    } catch (err) {
      console.error('Error loading pending approvals:', err);
      setError(err?.message || 'Failed to load pending approvals');
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (notificationId, notification) => {
    try {
      setApprovingId(notificationId);
      const { getSupabase } = await import('../services/pitchingService');
      const supabase = getSupabase();
      const { data: { user } } = await supabase.auth.getUser();

      console.log(`✅ Shareholder ${user.email} approved: ${notification.notification_title}`);

      // Mark notification as read (approved)
      const { error: updateError } = await supabase
        .from('shareholder_notifications')
        .update({
          read_at: new Date().toISOString()
        })
        .eq('id', notificationId);

      if (updateError) throw updateError;

      // Get the count of other shareholders who have approved
      const { data: approvedApprovals, error: countError } = await supabase
        .from('shareholder_notifications')
        .select('id', { count: 'exact' })
        .eq('business_profile_id', notification.business_profile_id)
        .not('read_at', 'is', null);

      if (!countError && approvedApprovals) {
        // Get total shareholder count  
        const { data: totalMembers } = await supabase
          .from('business_co_owners')
          .select('id', { count: 'exact' })
          .eq('business_profile_id', notification.business_profile_id)
          .in('status', ['active', null]);

        const totalCount = totalMembers?.length || 1;
        const approvedCount = (approvedApprovals?.length || 0) + 1;
        const approvalPercent = (approvedCount / totalCount) * 100;

        console.log(`📊 Approval Status: ${approvedCount}/${totalCount} shareholders (${approvalPercent.toFixed(0)}%)`);

        // Check if 60% threshold reached
        if (approvalPercent >= 60) {
          console.log('🎉 60% shareholder approval threshold reached!');
          console.log(`💰 Investment: ${notification.investment_amount} ${notification.investment_currency}`);
          console.log(`👥 Approvals: ${approvedCount}/${totalCount} shareholders`);
          
          alert(`✅ APPROVED!\n\n60% shareholder approval threshold reached!\n\n👥 ${approvedCount}/${totalCount} shareholders approved\n💰 ${notification.investment_amount} ${notification.investment_currency}\n\nFunds will be transferred to the business account.`);
        } else {
          alert(`✅ You approved the investment!\n\n👥 Progress: ${approvedCount}/${totalCount} shareholders (${approvalPercent.toFixed(0)}%)\n\nWaiting for ${Math.ceil(totalCount * 0.6) - approvedCount} more approval${Math.ceil(totalCount * 0.6) - approvedCount !== 1 ? 's' : ''}`);
        }
      }

      // Reload notifications
      await loadPendingApprovals();
      setApprovingId(null);
    } catch (err) {
      console.error('Error approving:', err);
      alert('❌ Error approving: ' + err?.message);
      setApprovingId(null);
    }
  };

  const handleReject = async (notificationId) => {
    try {
      const { getSupabase } = await import('../services/pitchingService');
      const supabase = getSupabase();
      const { data: { user } } = await supabase.auth.getUser();

      console.log(`❌ Shareholder ${user.email} rejected approval`);

      // Mark notification as read (rejected)
      const { error: updateError } = await supabase
        .from('shareholder_notifications')
        .update({
          read_at: new Date().toISOString(),
          notification_type: 'approval_rejected'
        })
        .eq('id', notificationId);

      if (updateError) throw updateError;

      alert('✓ Your rejection has been recorded');
      await loadPendingApprovals();
    } catch (err) {
      console.error('Error rejecting:', err);
      alert('❌ Error recording rejection: ' + err?.message);
    }
  };

  const handleSlideStart = (notificationId) => {
    setSlideProgress({ ...slideProgress, [notificationId]: 0 });
  };

  const handleSlideMove = (e, notificationId, notification) => {
    const slider = e.currentTarget;
    const rect = slider.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percent = Math.min(100, Math.max(0, (x / rect.width) * 100));
    setSlideProgress({ ...slideProgress, [notificationId]: percent });

    // Auto-approve when fully dragged
    if (percent >= 95) {
      handleApprove(notificationId, notification);
    }
  };

  if (loading) {
    return (
      <div className="w-full max-w-3xl mx-auto p-4">
        <div className="p-12 text-center bg-slate-800 border border-slate-700 rounded-lg">
          <Clock className="w-16 h-16 animate-spin mx-auto mb-4 text-blue-400" />
          <p className="text-slate-300 text-lg font-semibold">Loading your pending approvals...</p>
          <p className="text-slate-400 text-sm mt-2">Please wait while we fetch your investment approvals</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-3xl mx-auto p-4">
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-3xl font-bold text-white mb-2">⏳ Pending Investment Approvals</h2>
            <p className="text-slate-400">Your approval is needed for pending investments</p>
          </div>
          {pendingApprovals.length > 0 && !loading && (
            <div className="bg-red-600/20 border border-red-500 rounded-lg px-4 py-3 text-center">
              <div className="text-3xl font-bold text-red-400">{pendingApprovals.length}</div>
              <div className="text-xs text-red-300 mt-1">Awaiting approval</div>
            </div>
          )}
        </div>
      </div>
      
      {error && (
        <div className="bg-red-900 border border-red-700 text-red-100 px-4 py-4 rounded-lg mb-4">
          <p className="font-semibold">❌ Error</p>
          <p className="text-sm">{error}</p>
        </div>
      )}

      {pendingApprovals.length === 0 ? (
        <div className="bg-slate-800 border border-slate-700 text-slate-300 px-6 py-8 rounded-lg text-center">
          <Clock className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p className="font-semibold">✅ No pending approvals</p>
          <p className="text-sm">You're all caught up! No investments need your approval right now.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {pendingApprovals.map((approval, index) => (
            <div
              key={approval.id}
              className="bg-gradient-to-br from-slate-800 to-slate-900 border-2 border-yellow-500/50 rounded-lg p-6 hover:border-yellow-500 transition shadow-lg hover:shadow-yellow-500/20"
            >
              {/* Header with badge */}
              <div className="flex justify-between items-start mb-4">
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">💰</span>
                    <div>
                      <h3 className="font-bold text-xl text-white">{approval.notification_title || 'Investment Approval Required'}</h3>
                      <p className="text-sm text-slate-400 mt-1">
                        From: <span className="text-yellow-400 font-semibold">{approval.investor_name || approval.investor_email || 'Investor'}</span>
                      </p>
                    </div>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <span className="bg-yellow-500/30 border border-yellow-500/60 text-yellow-300 px-3 py-1 rounded-full text-xs font-bold animate-pulse">
                    ⚠️ PENDING
                  </span>
                  <span className="text-xs text-slate-400">Item {index + 1} of {pendingApprovals.length}</span>
                </div>
              </div>

              {/* Details */}
              <div className="bg-slate-900/50 border border-slate-700 p-4 rounded mb-4 space-y-2">
                <p className="text-slate-200 leading-relaxed whitespace-pre-wrap">{approval.notification_message}</p>
                <div className="grid grid-cols-2 gap-4 mt-3 text-sm border-t border-slate-700 pt-3">
                  <div>
                    <p className="text-slate-400 text-xs uppercase">Amount to Invest</p>
                    <p className="text-white font-bold text-lg">
                      {approval.investment_currency} {approval.investment_amount?.toLocaleString()}
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-400 text-xs uppercase">Equity Shares</p>
                    <p className="text-white font-bold text-lg">{approval.investment_shares || 'N/A'}</p>
                  </div>
                </div>
              </div>

              {/* Important info */}
              <div className="bg-blue-900/30 border border-blue-700/50 rounded p-3 mb-4">
                <p className="text-blue-300 text-sm">
                  <span className="font-bold">ℹ️ Action Required:</span> Your approval is essential. 60% of all shareholders must approve before funds are transferred.
                </p>
              </div>

              {/* Metadata - collapsed */}
              <div className="text-xs text-slate-500 mb-4 space-y-1 border-t border-slate-700 pt-3">
                <p>📧 Investor Email: {approval.investor_email}</p>
                <p>📅 Received: {new Date(approval.created_at).toLocaleString()}</p>
              </div>

              {/* IMPORTANT: Slide to Approve - Very Prominent */}
              <div className="mb-4 p-4 bg-gradient-to-r from-green-900/40 to-emerald-900/40 border border-green-700/50 rounded-lg">
                <p className="text-green-300 font-bold mb-3 text-sm">👉 APPROVE THIS INVESTMENT BY SLIDING:</p>
                <div
                  onMouseMove={(e) => handleSlideMove(e, approval.id, approval)}
                  onMouseDown={() => handleSlideStart(approval.id)}
                  className="relative w-full bg-gradient-to-r from-green-500 to-emerald-600 h-16 rounded-lg cursor-pointer overflow-hidden select-none border-2 border-green-400/50 shadow-lg shadow-green-500/50 transition-all hover:shadow-green-500/80"
                >
                  {/* Progress bar */}
                  <div
                    className="absolute top-0 left-0 h-full bg-green-700/70 transition-all"
                    style={{ width: `${slideProgress[approval.id] || 0}%` }}
                  ></div>

                  {/* Slider thumb */}
                  <div
                    className="absolute top-0 left-0 h-full w-20 bg-white rounded-lg shadow-2xl flex items-center justify-center transition-all"
                    style={{
                      transform: `translateX(${slideProgress[approval.id] || 0}%)`,
                      maxWidth: `calc(100% - 8px)`
                    }}
                  >
                    <span className="text-2xl">👉</span>
                  </div>

                  {/* Text */}
                  <div className="absolute inset-0 flex items-center justify-center text-white font-bold text-lg pointer-events-none">
                    {slideProgress[approval.id] && slideProgress[approval.id] > 50
                      ? '✅ Release to Approve'
                      : 'Slide →'}
                  </div>
                </div>
                <p className="text-green-300 text-xs mt-2">Drag the slider all the way to the right to approve</p>
              </div>

              {/* Action Buttons - Alternative method */}
              <div className="flex gap-2 mb-2">
                <button
                  onClick={() => handleApprove(approval.id, approval)}
                  disabled={approvingId === approval.id}
                  className="flex-1 bg-gradient-to-br from-green-600 to-green-700 hover:from-green-500 hover:to-green-600 disabled:from-slate-600 disabled:to-slate-700 text-white font-bold py-3 px-4 rounded-lg transition shadow-lg hover:shadow-green-500/50 text-lg"
                >
                  {approvingId === approval.id ? '⏳ Approving...' : '✅ Approve Investment'}
                </button>
                <button
                  onClick={() => handleReject(approval.id)}
                  className="flex-1 bg-gradient-to-br from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 text-white font-bold py-3 px-4 rounded-lg transition shadow-lg hover:shadow-red-500/50"
                >
                  ❌ Reject
                </button>
              </div>
              <p className="text-xs text-slate-500 text-center">Or use the slider above to approve</p>
            </div>
          ))}
        </div>
      )}

      {/* Footer */}
      <div className="mt-8 p-4 bg-gradient-to-r from-slate-800 to-slate-900 border border-slate-700 rounded-lg">
        <p className="text-sm text-slate-300 font-semibold mb-2">
          👤 Logged in as: <span className="text-blue-400">{currentUser?.email}</span>
        </p>
        <p className="text-sm text-slate-400">
          ℹ️ You are a shareholder. Your approval is <span className="font-bold text-yellow-400">required</span> before investment funds can be transferred. 60% of shareholders must approve.
        </p>
        {pendingApprovals.length > 0 && (
          <div className="mt-3 p-3 bg-yellow-900/30 border border-yellow-700/50 rounded">
            <p className="text-yellow-300 text-sm font-semibold">
              ⚠️ You have <span className="text-lg">{pendingApprovals.length}</span> pending {pendingApprovals.length === 1 ? 'approval' : 'approvals'} requiring your action.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default ShareholderPendingSignatures;
