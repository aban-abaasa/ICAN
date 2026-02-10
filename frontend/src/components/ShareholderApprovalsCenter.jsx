import React, { useState, useEffect } from 'react';
import { X, Bell, AlertCircle, Loader } from 'lucide-react';
import ShareholderPendingSignatures from './ShareholderPendingSignatures';
import PendingApprovalsModal from './PendingApprovalsModal';

/**
 * ShareholderApprovalsCenter - Shows both shareholder and member approvals
 * Prioritizes shareholder investment approvals since they're urgent
 */
const ShareholderApprovalsCenter = ({ businessProfileId, currentUserId, currentUserEmail, onClose }) => {
  const [tab, setTab] = useState('shareholder'); // 'shareholder' or 'member'
  const [shareholderCount, setShareholderCount] = useState(0);
  const [memberCount, setMemberCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadCounts();
  }, []);

  const loadCounts = async () => {
    try {
      const { getSupabase } = await import('../services/pitchingService');
      const supabase = getSupabase();
      const { data: { user } } = await supabase.auth.getUser();

      // Count shareholder notifications FOR CURRENT USER ONLY
      // Handle both: shareholder_id = user.id OR (shareholder_id IS NULL AND email matches)
      const { data: byId, error: err1 } = await supabase
        .from('shareholder_notifications')
        .select('id')
        .eq('shareholder_id', user.id)
        .is('read_at', null);

      const { data: byEmail, error: err2 } = await supabase
        .from('shareholder_notifications')
        .select('id')
        .eq('shareholder_email', user.email)
        .is('read_at', null)
        .is('shareholder_id', null);
      
      const totalCount = ((byId || []).length) + ((byEmail || []).length);
      setShareholderCount(totalCount);

      // Count member approvals if businessProfileId is provided
      if (businessProfileId) {
        const { memberApprovalService } = await import('../services/memberApprovalService');
        const edits = await memberApprovalService.getPendingEdits(businessProfileId);
        const pending = (edits || []).filter(edit => edit.status === 'pending').length;
        setMemberCount(pending);
      }
    } catch (error) {
      console.error('Error loading approval counts:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur flex items-center justify-center z-[70] p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-700 rounded-xl max-w-2xl w-full max-h-[90vh] flex flex-col shadow-2xl">
        {/* Header with tabs */}
        <div className="border-b border-slate-700 p-6 flex items-center justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-3">
              <Bell className="w-6 h-6 text-yellow-400" />
              <h2 className="text-2xl font-bold text-white">Approval Center</h2>
            </div>
            
            {/* Tabs */}
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => setTab('shareholder')}
                className={`px-4 py-2 rounded-lg font-semibold transition ${
                  tab === 'shareholder'
                    ? 'bg-yellow-500/30 border border-yellow-500/60 text-yellow-300'
                    : 'bg-slate-800 border border-slate-700 text-slate-400 hover:text-slate-300'
                }`}
              >
                💰 Investment Approvals
                {shareholderCount > 0 && (
                  <span className="ml-2 bg-red-600 text-white text-xs font-bold px-2 py-1 rounded-full">
                    {shareholderCount}
                  </span>
                )}
              </button>
              
              {businessProfileId && (
                <button
                  onClick={() => setTab('member')}
                  className={`px-4 py-2 rounded-lg font-semibold transition ${
                    tab === 'member'
                      ? 'bg-blue-500/30 border border-blue-500/60 text-blue-300'
                      : 'bg-slate-800 border border-slate-700 text-slate-400 hover:text-slate-300'
                  }`}
                >
                  👥 Member Approvals
                  {memberCount > 0 && (
                    <span className="ml-2 bg-red-600 text-white text-xs font-bold px-2 py-1 rounded-full">
                      {memberCount}
                    </span>
                  )}
                </button>
              )}
            </div>
          </div>

          {/* Close button */}
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white transition"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-8 text-center">
              <Loader className="w-10 h-10 animate-spin mx-auto mb-3 text-blue-400" />
              <p className="text-slate-300">Loading approvals...</p>
            </div>
          ) : tab === 'shareholder' ? (
            // Shareholder investment approvals
            <div className="p-6">
              {shareholderCount === 0 ? (
                <div className="bg-slate-800 border border-slate-700 rounded-lg p-8 text-center">
                  <AlertCircle className="w-12 h-12 mx-auto mb-3 text-green-400 opacity-50" />
                  <p className="font-semibold text-slate-300">✅ No Pending Investment Approvals</p>
                  <p className="text-sm text-slate-500 mt-2">You're all caught up! No investments need your approval.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="bg-yellow-900/30 border border-yellow-700/50 rounded-lg p-4 mb-4">
                    <p className="text-yellow-300 font-semibold">
                      ⚠️ You have {shareholderCount} pending investment {shareholderCount === 1 ? 'approval' : 'approvals'} that require your action!
                    </p>
                    <p className="text-yellow-200 text-sm mt-2">Your approval is essential for funds to be transferred.</p>
                  </div>
                  <ShareholderPendingSignatures onApprovalComplete={loadCounts} />
                </div>
              )}
            </div>
          ) : (
            // Member approval edits
            <div className="p-6">
              {memberCount === 0 ? (
                <div className="bg-slate-800 border border-slate-700 rounded-lg p-8 text-center">
                  <AlertCircle className="w-12 h-12 mx-auto mb-3 text-green-400 opacity-50" />
                  <p className="font-semibold text-slate-300">✅ No Pending Member Approvals</p>
                  <p className="text-sm text-slate-500 mt-2">All roster changes have been approved.</p>
                </div>
              ) : (
                <PendingApprovalsModal
                  businessProfileId={businessProfileId}
                  currentUserId={currentUserId}
                  onClose={() => {}} // Empty since we're already in a modal
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ShareholderApprovalsCenter;
