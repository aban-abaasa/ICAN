import React, { useEffect, useState } from 'react';
import { Briefcase, Loader2, X as XIcon } from 'lucide-react';
import cmmsBusinessOpportunitiesService from '../../services/cmmsBusinessOpportunitiesService';

/**
 * "Bid for work" section on the resume/portfolio owner's own editor page
 * (PortfolioTab.jsx) -- lets a signed-in ICAN user browse open business
 * opportunities (posted from a CMMS company's Jobs & Announcements ->
 * Opportunities tab, see CMMSBusinessOpportunitiesPanel.jsx) and submit a
 * bid as themselves. See backend/CMMS_BUSINESS_OPPORTUNITIES_AND_BIDS.sql
 * -- bids are private, so this only ever sees the caller's own bids.
 */
const ResumeOpportunityBidsPanel = ({ userId, displayName }) => {
  const [loading, setLoading] = useState(true);
  const [opportunities, setOpportunities] = useState([]);
  const [myBids, setMyBids] = useState([]);
  const [bidTarget, setBidTarget] = useState(null);
  const [bidFields, setBidFields] = useState({ bidderName: '', bidderContact: '', amount: '', proposal: '' });
  const [saving, setSaving] = useState(false);

  const load = async () => {
    if (!userId) return;
    setLoading(true);
    const [openResult, bidsResult] = await Promise.all([
      cmmsBusinessOpportunitiesService.getOpenOpportunities(),
      cmmsBusinessOpportunitiesService.getMyIndividualBids(userId),
    ]);
    setOpportunities(openResult.data || []);
    setMyBids(bidsResult.data || []);
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [userId]);

  const openBidForm = (opportunity) => {
    setBidTarget(opportunity);
    setBidFields({ bidderName: displayName || '', bidderContact: '', amount: '', proposal: '' });
  };

  const submitBid = async () => {
    if (!bidFields.bidderName.trim() || !bidFields.proposal.trim()) return;
    setSaving(true);
    const result = await cmmsBusinessOpportunitiesService.submitBidAsIndividual(bidTarget.id, userId, bidFields);
    setSaving(false);
    if (result.success) { setBidTarget(null); load(); } else alert(result.error);
  };

  const withdraw = async (bidId) => {
    if (!window.confirm('Withdraw this bid?')) return;
    await cmmsBusinessOpportunitiesService.withdrawBid(bidId);
    load();
  };

  const bidStatusColor = { submitted: 'text-slate-300', selected: 'text-emerald-400', rejected: 'text-red-400', withdrawn: 'text-slate-500' };

  return (
    <div className="bg-slate-900/50 border border-purple-700/30 rounded-xl p-4">
      <h3 className="text-white font-semibold flex items-center gap-2 mb-1">
        <Briefcase className="w-4 h-4 text-purple-400" /> Bid for Work
      </h3>
      <p className="text-xs text-gray-400 mb-3">Open opportunities posted by businesses on IcanEra. Submit a bid as yourself -- only that business sees it.</p>

      {loading ? (
        <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 text-purple-400 animate-spin" /></div>
      ) : opportunities.length === 0 ? (
        <p className="text-sm text-gray-500 text-center py-4">No open opportunities right now.</p>
      ) : (
        <div className="space-y-2">
          {opportunities.map((o) => {
            const myBid = myBids.find((b) => b.opportunity_id === o.id);
            return (
              <div key={o.id} className="bg-slate-800/60 rounded-lg p-3 border border-slate-700 flex items-center justify-between gap-3">
                <div>
                  <p className="text-white text-sm font-medium">{o.title}</p>
                  <p className="text-gray-400 text-xs">{o.cmms_company_profiles?.company_name}{o.budget_hint ? ` · ${o.budget_hint}` : ''}{o.deadline ? ` · closes ${new Date(o.deadline).toLocaleDateString()}` : ''}</p>
                  {o.description && <p className="text-gray-500 text-xs mt-1 line-clamp-2">{o.description}</p>}
                </div>
                {myBid ? (
                  <div className="text-right shrink-0">
                    <p className={`text-xs font-semibold ${bidStatusColor[myBid.status]}`}>{myBid.status}</p>
                    {myBid.status === 'submitted' && (
                      <button onClick={() => withdraw(myBid.id)} className="text-xs text-red-400 hover:text-red-300 mt-1">Withdraw</button>
                    )}
                  </div>
                ) : (
                  <button onClick={() => openBidForm(o)} className="shrink-0 text-xs bg-purple-600 hover:bg-purple-500 text-white rounded px-3 py-1.5 font-semibold">
                    Bid
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {bidTarget && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-start justify-center p-4 overflow-y-auto">
          <div className="bg-slate-900 border border-purple-700/40 rounded-xl w-full max-w-lg p-6 my-8">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-white">Bid on: {bidTarget.title}</h3>
              <button onClick={() => setBidTarget(null)} className="text-gray-400 hover:text-white"><XIcon className="w-5 h-5" /></button>
            </div>
            <div className="space-y-3">
              <input value={bidFields.bidderName} onChange={(e) => setBidFields({ ...bidFields, bidderName: e.target.value })} placeholder="Your name" className="w-full px-3 py-2 rounded bg-white/10 text-white border border-white/20" />
              <input value={bidFields.bidderContact} onChange={(e) => setBidFields({ ...bidFields, bidderContact: e.target.value })} placeholder="Contact (phone or email)" className="w-full px-3 py-2 rounded bg-white/10 text-white border border-white/20" />
              <input type="number" value={bidFields.amount} onChange={(e) => setBidFields({ ...bidFields, amount: e.target.value })} placeholder="Bid amount (optional)" className="w-full px-3 py-2 rounded bg-white/10 text-white border border-white/20" />
              <textarea value={bidFields.proposal} onChange={(e) => setBidFields({ ...bidFields, proposal: e.target.value })} placeholder="Why you / your proposal" rows={4} className="w-full px-3 py-2 rounded bg-white/10 text-white border border-white/20" />
              <div className="flex justify-end gap-2">
                <button onClick={() => setBidTarget(null)} className="px-4 py-2 rounded text-gray-300 hover:text-white">Cancel</button>
                <button disabled={saving || !bidFields.bidderName.trim() || !bidFields.proposal.trim()} onClick={submitBid} className="px-4 py-2 rounded bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-semibold">
                  {saving ? 'Submitting…' : 'Submit Bid'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ResumeOpportunityBidsPanel;
