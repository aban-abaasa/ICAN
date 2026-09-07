import React, { useEffect, useState } from 'react';
import { Award, Loader, Plus, X } from 'lucide-react';
import cmmsBusinessOpportunitiesService from '../services/cmmsBusinessOpportunitiesService';

/**
 * Lives inside the Jobs & Announcements panel (CMMSAnnouncementsPanel.jsx)
 * as its "Opportunities" sub-tab. Two views:
 *  - "Our Opportunities": this company posts an open call for bids and
 *    (if canManage) picks a winner. Bids are private -- only visible here
 *    if canViewBids/canManage is true (see backend RLS).
 *  - "Browse & Bid": any member of this company can browse OTHER
 *    companies' open opportunities and submit a bid as this business --
 *    no special permission needed, matches
 *    backend/CMMS_BUSINESS_OPPORTUNITIES_AND_BIDS.sql's bidding policy.
 */
const CMMSBusinessOpportunitiesPanel = ({ companyId, companyName, myCmmsUserId, canManage, canViewBids }) => {
  const [view, setView] = useState('mine');
  const [loading, setLoading] = useState(true);

  const [opportunities, setOpportunities] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', budgetHint: '', deadline: '' });
  const [saving, setSaving] = useState(false);
  const [expandedId, setExpandedId] = useState(null);

  const [openOpportunities, setOpenOpportunities] = useState([]);
  const [myBids, setMyBids] = useState([]);
  const [bidTarget, setBidTarget] = useState(null);
  const [bidFields, setBidFields] = useState({ bidderName: '', bidderContact: '', amount: '', proposal: '' });
  const [bidSaving, setBidSaving] = useState(false);

  const resetForm = () => setForm({ title: '', description: '', budgetHint: '', deadline: '' });

  const loadMine = async () => {
    setLoading(true);
    const result = await cmmsBusinessOpportunitiesService.getOpportunitiesForCompany(companyId);
    setOpportunities(result.data || []);
    setLoading(false);
  };

  const loadBrowse = async () => {
    setLoading(true);
    const [openResult, bidsResult] = await Promise.all([
      cmmsBusinessOpportunitiesService.getOpenOpportunities(),
      cmmsBusinessOpportunitiesService.getMyCompanyBids(companyId),
    ]);
    setOpenOpportunities((openResult.data || []).filter((o) => o.cmms_company_id !== companyId));
    setMyBids(bidsResult.data || []);
    setLoading(false);
  };

  useEffect(() => {
    if (!companyId) return;
    if (view === 'mine') loadMine(); else loadBrowse();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, view]);

  const handleCreate = async () => {
    if (!form.title.trim()) return;
    setSaving(true);
    const result = await cmmsBusinessOpportunitiesService.createOpportunity(companyId, form, myCmmsUserId);
    setSaving(false);
    if (result.success) { resetForm(); setShowForm(false); loadMine(); }
  };

  const handleCancel = async (id) => {
    if (!window.confirm('Cancel this opportunity? No more bids will be accepted.')) return;
    await cmmsBusinessOpportunitiesService.setOpportunityStatus(id, 'cancelled');
    loadMine();
  };

  const handleSelectWinner = async (bidId) => {
    if (!window.confirm('Select this bid as the winner? Every other bid will be rejected and this opportunity will close.')) return;
    const result = await cmmsBusinessOpportunitiesService.selectWinningBid(bidId);
    if (result.success) loadMine(); else alert(result.error);
  };

  const openBidForm = (opportunity) => {
    setBidTarget(opportunity);
    setBidFields({ bidderName: companyName || '', bidderContact: '', amount: '', proposal: '' });
  };

  const submitBid = async () => {
    if (!bidFields.bidderName.trim() || !bidFields.proposal.trim()) return;
    setBidSaving(true);
    const result = await cmmsBusinessOpportunitiesService.submitBidAsBusiness(bidTarget.id, companyId, bidFields);
    setBidSaving(false);
    if (result.success) { setBidTarget(null); loadBrowse(); } else alert(result.error);
  };

  const tabClass = (id) => `px-4 py-2 text-sm font-semibold border-b-2 transition ${view === id ? 'border-purple-400 text-white' : 'border-transparent text-gray-400 hover:text-white'}`;

  return (
    <div className="space-y-4">
      <div className="flex gap-2 border-b border-white/10">
        <button onClick={() => setView('mine')} className={tabClass('mine')}>Our Opportunities</button>
        <button onClick={() => setView('browse')} className={tabClass('browse')}>Browse &amp; Bid</button>
      </div>

      {view === 'mine' && (
        <div className="space-y-3">
          {canManage && (
            <div className="flex justify-end">
              <button onClick={() => setShowForm((v) => !v)} className="flex items-center gap-1 text-sm bg-purple-600 hover:bg-purple-500 text-white rounded px-3 py-1.5 font-semibold">
                {showForm ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                {showForm ? 'Cancel' : 'Post Opportunity'}
              </button>
            </div>
          )}

          {showForm && (
            <div className="glass-card p-4 border border-white/10 space-y-3">
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Opportunity title (e.g. Office renovation contract)" className="w-full px-3 py-2 rounded bg-white/10 text-white border border-white/20" />
              <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="What do you need done?" rows={3} className="w-full px-3 py-2 rounded bg-white/10 text-white border border-white/20" />
              <div className="grid md:grid-cols-2 gap-3">
                <input value={form.budgetHint} onChange={(e) => setForm({ ...form, budgetHint: e.target.value })} placeholder="Budget hint (optional, e.g. UGX 5M - 10M)" className="px-3 py-2 rounded bg-white/10 text-white border border-white/20" />
                <input type="date" value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} className="px-3 py-2 rounded bg-slate-900 text-white border border-white/20" />
              </div>
              <div className="flex justify-end">
                <button disabled={saving || !form.title.trim()} onClick={handleCreate} className="px-4 py-2 rounded bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-semibold">
                  {saving ? 'Posting…' : 'Post & Open for Bids'}
                </button>
              </div>
            </div>
          )}

          {loading ? (
            <div className="flex justify-center py-8"><Loader className="w-6 h-6 text-purple-400 animate-spin" /></div>
          ) : opportunities.length === 0 ? (
            <div className="glass-card p-8 text-center text-gray-400">No opportunities posted yet.</div>
          ) : (
            opportunities.map((o) => (
              <OpportunityRow
                key={o.id}
                opportunity={o}
                expanded={expandedId === o.id}
                onToggle={() => setExpandedId(expandedId === o.id ? null : o.id)}
                canManage={canManage}
                canViewBids={canViewBids}
                onCancel={() => handleCancel(o.id)}
                onSelectWinner={handleSelectWinner}
              />
            ))
          )}
        </div>
      )}

      {view === 'browse' && (
        <div className="space-y-3">
          {loading ? (
            <div className="flex justify-center py-8"><Loader className="w-6 h-6 text-purple-400 animate-spin" /></div>
          ) : openOpportunities.length === 0 ? (
            <div className="glass-card p-8 text-center text-gray-400">No open opportunities from other businesses right now.</div>
          ) : (
            openOpportunities.map((o) => {
              const alreadyBid = myBids.some((b) => b.opportunity_id === o.id);
              return (
                <div key={o.id} className="glass-card p-4 border border-white/10 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-white font-semibold">{o.title}</p>
                    <p className="text-gray-400 text-xs">{o.cmms_company_profiles?.company_name}{o.budget_hint ? ` · ${o.budget_hint}` : ''}{o.deadline ? ` · closes ${new Date(o.deadline).toLocaleDateString()}` : ''}</p>
                    {o.description && <p className="text-gray-500 text-xs mt-1 line-clamp-2">{o.description}</p>}
                  </div>
                  {alreadyBid ? (
                    <span className="text-xs text-emerald-300 shrink-0">Bid submitted</span>
                  ) : (
                    <button onClick={() => openBidForm(o)} className="shrink-0 text-sm bg-emerald-600 hover:bg-emerald-500 text-white rounded px-3 py-1.5 font-semibold">
                      Bid as {companyName || 'this business'}
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {bidTarget && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-start justify-center p-4 overflow-y-auto">
          <div className="glass-card w-full max-w-lg p-6 my-8 border border-purple-400/30">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-white">Bid on: {bidTarget.title}</h3>
              <button onClick={() => setBidTarget(null)} className="text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-3">
              <input value={bidFields.bidderName} onChange={(e) => setBidFields({ ...bidFields, bidderName: e.target.value })} placeholder="Your business name" className="w-full px-3 py-2 rounded bg-white/10 text-white border border-white/20" />
              <input value={bidFields.bidderContact} onChange={(e) => setBidFields({ ...bidFields, bidderContact: e.target.value })} placeholder="Contact (phone or email)" className="w-full px-3 py-2 rounded bg-white/10 text-white border border-white/20" />
              <input type="number" value={bidFields.amount} onChange={(e) => setBidFields({ ...bidFields, amount: e.target.value })} placeholder="Bid amount (optional)" className="w-full px-3 py-2 rounded bg-white/10 text-white border border-white/20" />
              <textarea value={bidFields.proposal} onChange={(e) => setBidFields({ ...bidFields, proposal: e.target.value })} placeholder="Your proposal" rows={4} className="w-full px-3 py-2 rounded bg-white/10 text-white border border-white/20" />
              <div className="flex justify-end gap-2">
                <button onClick={() => setBidTarget(null)} className="px-4 py-2 rounded text-gray-300 hover:text-white">Cancel</button>
                <button disabled={bidSaving || !bidFields.bidderName.trim() || !bidFields.proposal.trim()} onClick={submitBid} className="px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold">
                  {bidSaving ? 'Submitting…' : 'Submit Bid'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const OpportunityRow = ({ opportunity, expanded, onToggle, canManage, canViewBids, onCancel, onSelectWinner }) => {
  const [bids, setBids] = useState([]);
  const [bidsLoading, setBidsLoading] = useState(false);

  useEffect(() => {
    if (!expanded || !(canManage || canViewBids)) return;
    setBidsLoading(true);
    cmmsBusinessOpportunitiesService.getBidsForOpportunity(opportunity.id).then((r) => {
      setBids(r.data || []);
      setBidsLoading(false);
    });
  }, [expanded, opportunity.id, canManage, canViewBids]);

  const statusColor = { open: 'text-emerald-400', awarded: 'text-blue-400', closed: 'text-slate-400', cancelled: 'text-red-400' };
  const bidStatusColor = { submitted: 'text-slate-300', selected: 'text-emerald-400', rejected: 'text-red-400', withdrawn: 'text-slate-500' };

  return (
    <div className="glass-card border border-white/10 p-4">
      <div className="flex items-center justify-between gap-3 cursor-pointer" onClick={onToggle}>
        <div>
          <p className="text-white font-semibold">{opportunity.title}</p>
          <p className="text-gray-400 text-xs">
            <span className={statusColor[opportunity.status]}>{opportunity.status}</span>
            {opportunity.budget_hint ? ` · ${opportunity.budget_hint}` : ''}
            {opportunity.deadline ? ` · closes ${new Date(opportunity.deadline).toLocaleDateString()}` : ''}
          </p>
        </div>
        {canManage && opportunity.status === 'open' && (
          <button onClick={(e) => { e.stopPropagation(); onCancel(); }} className="shrink-0 text-xs px-2 py-1 rounded bg-red-900/50 hover:bg-red-900 text-red-300">Cancel</button>
        )}
      </div>

      {expanded && (canManage || canViewBids) && (
        <div className="mt-3 pt-3 border-t border-white/10">
          <p className="text-xs font-semibold text-gray-300 mb-2 flex items-center gap-1"><Award className="w-3.5 h-3.5" /> Bids</p>
          {bidsLoading ? (
            <Loader className="w-4 h-4 text-purple-400 animate-spin" />
          ) : bids.length === 0 ? (
            <p className="text-gray-500 text-xs">No bids yet.</p>
          ) : (
            <div className="space-y-2">
              {bids.map((b) => (
                <div key={b.id} className="bg-white/5 rounded-lg p-2.5 border border-white/10 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-white text-sm">{b.bidder_name} <span className="text-gray-500 text-xs">({b.bidder_type})</span></p>
                    {b.amount && <p className="text-gray-400 text-xs">Amount: {Number(b.amount).toLocaleString()}</p>}
                    <p className="text-gray-400 text-xs">{b.proposal}</p>
                    <p className={`text-xs mt-1 ${bidStatusColor[b.status]}`}>{b.status}</p>
                  </div>
                  {canManage && opportunity.status === 'open' && b.status === 'submitted' && (
                    <button onClick={() => onSelectWinner(b.id)} className="shrink-0 text-xs px-2 py-1 rounded bg-emerald-700 hover:bg-emerald-600 text-white">Select Winner</button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default CMMSBusinessOpportunitiesPanel;
