import React, { useEffect, useState } from 'react';
import jsPDF from 'jspdf';
import { Clock, FileText, Download } from 'lucide-react';

const ShareholderPendingSignatures = ({ onApprovalComplete }) => {
  const [pendingApprovals, setPendingApprovals] = useState([]);
  const [sealedAgreements, setSealedAgreements] = useState([]);
  const [activeTab, setActiveTab] = useState('pending');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [approvingId, setApprovingId] = useState(null);

  useEffect(() => {
    loadPendingApprovals(true);
    loadSealedAgreements();
    const interval = setInterval(() => {
      loadPendingApprovals(false);
      loadSealedAgreements();
    }, 5000); // Refresh every 5 seconds
    return () => clearInterval(interval);
  }, []);

  // Shared 60% shareholder-approval math, used both right after an approval
  // and when scanning past approvals for already-sealed agreements.
  const getApprovalStats = async (supabase, businessProfileId) => {
    const { data: approvedApprovals } = await supabase
      .from('shareholder_notifications')
      .select('id', { count: 'exact' })
      .eq('business_profile_id', businessProfileId)
      .eq('notification_type', 'investment_signed')
      .not('read_at', 'is', null);

    const { data: totalMembers } = await supabase
      .from('business_co_owners')
      .select('id', { count: 'exact' })
      .eq('business_profile_id', businessProfileId)
      .in('status', ['active', null])
      .gt('ownership_share', 0);

    const totalCount = totalMembers?.length || 1;
    const approvedCount = approvedApprovals?.length || 0;
    const percent = (approvedCount / totalCount) * 100;
    return { approvedCount, totalCount, percent };
  };

  // Scan this shareholder's own already-approved notifications for
  // investments that have crossed the 60% threshold, so the "Sealed" tab
  // stays populated across reloads/sessions -- not just right after the
  // approval action that pushed a given investment over the line.
  const loadSealedAgreements = async () => {
    try {
      const { getSupabase } = await import('../services/pitchingService');
      const supabase = getSupabase();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: approvedByMe, error: fetchError } = await supabase
        .from('shareholder_notifications')
        .select('*')
        .eq('notification_type', 'investment_signed')
        .not('read_at', 'is', null)
        .or(`shareholder_id.eq.${user.id},shareholder_email.eq.${user.email}`)
        .order('created_at', { ascending: false });

      if (fetchError || !approvedByMe) return;

      // Collapse the (possibly several) notification rows belonging to the
      // same investment event down to one entry per event.
      const groups = new Map();
      for (const n of approvedByMe) {
        const key = `${n.business_profile_id}|${n.investor_email}|${n.investment_amount}|${n.investment_shares}`;
        if (!groups.has(key)) groups.set(key, n);
      }

      const sealed = [];
      for (const notification of groups.values()) {
        const stats = await getApprovalStats(supabase, notification.business_profile_id);
        if (stats.percent >= 60) {
          sealed.push({ ...notification, ...stats });
        }
      }

      setSealedAgreements(sealed);
    } catch (err) {
      console.error('Error loading sealed agreements:', err);
    }
  };

  const downloadMou = async (agreement) => {
    try {
      const { getSupabase } = await import('../services/pitchingService');
      const supabase = getSupabase();

      const { data: business } = await supabase
        .from('business_profiles')
        .select('business_name')
        .eq('id', agreement.business_profile_id)
        .maybeSingle();

      const { data: docs } = await supabase
        .from('business_documents')
        .select('mou_content')
        .eq('business_profile_id', agreement.business_profile_id)
        .maybeSingle();

      const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 18;
      const contentWidth = pageWidth - margin * 2;
      let y = 20;

      const ensureSpace = (needed) => {
        if (y + needed > pageHeight - margin) {
          pdf.addPage();
          y = 20;
        }
      };

      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(18);
      pdf.text('Investment Agreement (MOU)', pageWidth / 2, y, { align: 'center' });
      y += 8;
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(11);
      pdf.setTextColor(90);
      pdf.text(business?.business_name || 'Business', pageWidth / 2, y, { align: 'center' });
      y += 10;
      pdf.setDrawColor(200);
      pdf.line(margin, y, pageWidth - margin, y);
      y += 9;
      pdf.setTextColor(30);

      const addField = (label, value) => {
        ensureSpace(7);
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(10);
        pdf.text(`${label}:`, margin, y);
        pdf.setFont('helvetica', 'normal');
        const valueLines = pdf.splitTextToSize(String(value ?? 'N/A'), contentWidth - 50);
        pdf.text(valueLines, margin + 50, y);
        y += 7 * valueLines.length;
      };

      addField('Investor', agreement.investor_name || agreement.investor_email);
      addField('Investment Amount', `${agreement.investment_currency} ${Number(agreement.investment_amount || 0).toLocaleString()}`);
      addField('Equity Shares', agreement.investment_shares || 'N/A');
      addField('Shareholder Approval', `${agreement.approvedCount}/${agreement.totalCount} shareholders - ${agreement.percent.toFixed(1)}% (60% required)`);
      addField('Sealed On', new Date().toLocaleString());
      y += 3;

      ensureSpace(14);
      pdf.setDrawColor(200);
      pdf.line(margin, y, pageWidth - margin, y);
      y += 9;
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(13);
      pdf.text('Memorandum of Understanding', margin, y);
      y += 8;
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(10);
      const mouLines = pdf.splitTextToSize(String(docs?.mou_content || agreement.notification_message || 'No MOU text available.'), contentWidth);
      mouLines.forEach((line) => {
        ensureSpace(5.5);
        pdf.text(line, margin, y);
        y += 5.5;
      });

      const safeName = (business?.business_name || 'agreement').trim().replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'agreement';
      pdf.save(`ican-mou-${safeName}.pdf`);
    } catch (err) {
      console.error('Error downloading MOU:', err);
      alert('❌ Error downloading MOU: ' + (err?.message || 'Unknown error'));
    }
  };

  const loadPendingApprovals = async (isInitialLoad = false) => {
    try {
      if (isInitialLoad) setLoading(true);
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
      // Scoped to investment approvals only (notification_type: 'investment_signed') so
      // unrelated member-roster-edit approval requests never show up in this list.
      const { data: byId, error: errorById } = await supabase
        .from('shareholder_notifications')
        .select('*')
        .eq('shareholder_id', user.id)
        .eq('notification_type', 'investment_signed')
        .is('read_at', null)
        .order('created_at', { ascending: false });

      if (!errorById && byId && byId.length > 0) {
        console.log(`   ✅ Found ${byId.length} pending approvals by shareholder_id`);
        approvals = byId;
        fetchError = null;
      } else {
        // Fallback: Query by shareholder_email (in case shareholder_id is NULL)
        console.log(`   ℹ️ No results by shareholder_id, trying by shareholder_email...`);
        const { data: byEmail, error: errorByEmail } = await supabase
          .from('shareholder_notifications')
          .select('*')
          .eq('shareholder_email', user.email)
          .eq('notification_type', 'investment_signed')
          .is('read_at', null)
          .is('shareholder_id', null)  // Only fetch if shareholder_id is NULL
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
      // IMPORTANT: Filter by both ID and shareholder_id to match RLS policy
      const { error: updateError } = await supabase
        .from('shareholder_notifications')
        .update({
          read_at: new Date().toISOString()
        })
        .eq('id', notificationId)
        .eq('shareholder_id', user.id);

      if (updateError) throw updateError;

      // Get shareholder approval progress -- only real shareholders (active,
      // with equity) count towards the 60% threshold.
      const { approvedCount, totalCount, percent: approvalPercent } = await getApprovalStats(supabase, notification.business_profile_id);

      console.log(`📊 Approval Status: ${approvedCount}/${totalCount} shareholders (${approvalPercent.toFixed(0)}%)`);

      // Check if 60% threshold reached
      if (approvalPercent >= 60) {
        console.log('🎉 60% shareholder approval threshold reached!');
        console.log(`💰 Investment: ${notification.investment_amount} ${notification.investment_currency}`);
        console.log(`👥 Approvals: ${approvedCount}/${totalCount} shareholders`);

        alert(`✅ APPROVED!\n\n60% shareholder approval threshold reached!\n\n👥 ${approvedCount}/${totalCount} shareholders approved\n💰 ${notification.investment_amount} ${notification.investment_currency}\n\nFunds will be transferred to the business account.\n\nYou can download the MOU any time from the "Sealed Agreements" tab.`);
      } else {
        alert(`✅ You approved the investment!\n\n👥 Progress: ${approvedCount}/${totalCount} shareholders (${approvalPercent.toFixed(0)}%)\n\nWaiting for ${Math.ceil(totalCount * 0.6) - approvedCount} more approval${Math.ceil(totalCount * 0.6) - approvedCount !== 1 ? 's' : ''}`);
      }

      // Reload notifications and refresh the sealed-agreements tab so a
      // newly-crossed 60% threshold shows up immediately.
      await loadPendingApprovals();
      await loadSealedAgreements();
      setApprovingId(null);
      
      // Notify parent component that approval is complete (so it can refresh)
      if (onApprovalComplete) {
        onApprovalComplete();
      }
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

      {/* Tabs - "Sealed Agreements" always shows once any investment has
          crossed 60% shareholder approval, so the MOU download isn't just a
          one-time alert that's gone after you dismiss it. */}
      <div className="flex gap-2 mb-6 border-b border-slate-700">
        <button
          onClick={() => setActiveTab('pending')}
          className={`px-4 py-2 font-semibold text-sm rounded-t-lg transition ${
            activeTab === 'pending'
              ? 'bg-slate-800 text-white border-b-2 border-yellow-500'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          ⏳ Pending Approvals {pendingApprovals.length > 0 && `(${pendingApprovals.length})`}
        </button>
        <button
          onClick={() => setActiveTab('sealed')}
          className={`px-4 py-2 font-semibold text-sm rounded-t-lg transition ${
            activeTab === 'sealed'
              ? 'bg-slate-800 text-white border-b-2 border-green-500'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          📄 Sealed Agreements {sealedAgreements.length > 0 && `(${sealedAgreements.length})`}
        </button>
      </div>

      {error && (
        <div className="bg-red-900 border border-red-700 text-red-100 px-4 py-4 rounded-lg mb-4">
          <p className="font-semibold">❌ Error</p>
          <p className="text-sm">{error}</p>
        </div>
      )}

      {activeTab === 'sealed' ? (
        sealedAgreements.length === 0 ? (
          <div className="bg-slate-800 border border-slate-700 text-slate-300 px-6 py-8 rounded-lg text-center">
            <FileText className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p className="font-semibold">No sealed agreements yet</p>
            <p className="text-sm">Once an investment reaches 60% shareholder approval, its MOU will be downloadable here.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {sealedAgreements.map((agreement) => (
              <div
                key={`${agreement.business_profile_id}-${agreement.investor_email}-${agreement.investment_amount}`}
                className="bg-gradient-to-br from-slate-800 to-slate-900 border-2 border-green-500/50 rounded-lg p-6"
              >
                <div className="flex justify-between items-start mb-4">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">✅</span>
                    <div>
                      <h3 className="font-bold text-xl text-white">{agreement.notification_title || 'Investment Sealed'}</h3>
                      <p className="text-sm text-slate-400 mt-1">
                        From: <span className="text-green-400 font-semibold">{agreement.investor_name || agreement.investor_email || 'Investor'}</span>
                      </p>
                    </div>
                  </div>
                  <span className="bg-green-500/30 border border-green-500/60 text-green-300 px-3 py-1 rounded-full text-xs font-bold">
                    ✅ SEALED
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-4 mb-4 text-sm">
                  <div>
                    <p className="text-slate-400 text-xs uppercase">Amount Invested</p>
                    <p className="text-white font-bold text-lg">
                      {agreement.investment_currency} {Number(agreement.investment_amount || 0).toLocaleString()}
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-400 text-xs uppercase">Shareholder Approval</p>
                    <p className="text-white font-bold text-lg">{agreement.approvedCount}/{agreement.totalCount} ({agreement.percent.toFixed(0)}%)</p>
                  </div>
                </div>

                <button
                  onClick={() => downloadMou(agreement)}
                  className="w-full flex items-center justify-center gap-2 bg-gradient-to-br from-purple-600 to-purple-700 hover:from-purple-500 hover:to-purple-600 text-white font-bold py-3 px-4 rounded-lg transition shadow-lg"
                >
                  <Download className="w-5 h-5" />
                  Download MOU (PDF)
                </button>
              </div>
            ))}
          </div>
        )
      ) : pendingApprovals.length === 0 ? (
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

              {/* Action Buttons */}
              <div className="flex gap-2 mb-2">
                <button
                  onClick={() => handleApprove(approval.id, approval)}
                  disabled={approvingId === approval.id}
                  className="flex-1 bg-gradient-to-br from-green-600 to-green-700 hover:from-green-500 hover:to-green-600 disabled:from-slate-600 disabled:to-slate-700 text-white font-bold py-3 px-4 rounded-lg transition shadow-lg hover:shadow-green-500/50 text-lg"
                >
                  {approvingId === approval.id ? '⏳ Approving...' : '✅ OK, Approve'}
                </button>
                <button
                  onClick={() => handleReject(approval.id)}
                  className="flex-1 bg-gradient-to-br from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 text-white font-bold py-3 px-4 rounded-lg transition shadow-lg hover:shadow-red-500/50"
                >
                  ❌ Reject
                </button>
              </div>
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
