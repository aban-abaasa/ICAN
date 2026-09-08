import React, { useEffect, useState } from 'react';
import { Award, Briefcase, Check, Copy, FileText, Image as ImageIcon, Loader, Plus, Share2, Video, X } from 'lucide-react';
import cmmsBusinessOpportunitiesService from '../services/cmmsBusinessOpportunitiesService';
import cmmsInterviewService from '../services/cmmsInterviewService';
import cmmsServiceProviderContractsService from '../services/cmmsServiceProviderContractsService';
import { uploadToR2 } from '../services/r2StorageService';
import { supabase } from '../lib/supabase/client';
import LiveBoardroom from './LiveBoardroom';

const MAX_POSTER_BYTES = 6 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

// 'selected' is deliberately excluded -- that transition only ever happens
// through the atomic "Select Winner" action (fn_select_opportunity_bid),
// never through this plain status dropdown. See
// backend/CMMS_OPPORTUNITY_BID_PIPELINE.sql.
const bidStatusOptions = [
  { id: 'submitted', label: 'Submitted' },
  { id: 'under_review', label: 'Under review' },
  { id: 'shortlisted', label: 'Shortlisted' },
  { id: 'interview', label: 'Interview' },
  { id: 'rejected', label: 'Rejected' },
  { id: 'withdrawn', label: 'Withdrawn' },
];

/**
 * Lives inside the Jobs & Announcements panel (CMMSAnnouncementsPanel.jsx)
 * as its "Opportunities" sub-tab. Two views:
 *  - "Our Opportunities": this company posts an open call for bids and
 *    (if canManage) screens bids through the same status/interview pipeline
 *    job applications use, then picks a winner. Bids are private -- only
 *    visible here if canViewBids/canManage is true (see backend RLS).
 *  - "Browse & Bid": any member of this company can browse OTHER
 *    companies' open opportunities and submit a bid as this business --
 *    no special permission needed, matches
 *    backend/CMMS_BUSINESS_OPPORTUNITIES_AND_BIDS.sql's bidding policy.
 */
const CMMSBusinessOpportunitiesPanel = ({ companyId, companyName, myCmmsUserId, companyStaff = [], canManage, canViewBids }) => {
  const [view, setView] = useState('mine');
  const [loading, setLoading] = useState(true);

  const [opportunities, setOpportunities] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', budgetHint: '', deadline: '' });
  const [posterFile, setPosterFile] = useState(null);
  const [posterPreview, setPosterPreview] = useState('');
  const [documentFile, setDocumentFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [copiedShareId, setCopiedShareId] = useState(null);

  const [openOpportunities, setOpenOpportunities] = useState([]);
  const [myBids, setMyBids] = useState([]);
  const [bidTarget, setBidTarget] = useState(null);
  const [bidFields, setBidFields] = useState({ bidderName: '', bidderContact: '', amount: '', proposal: '' });
  const [bidSaving, setBidSaving] = useState(false);

  const resetForm = () => {
    if (posterPreview) URL.revokeObjectURL(posterPreview);
    setForm({ title: '', description: '', budgetHint: '', deadline: '' });
    setPosterFile(null);
    setPosterPreview('');
    setDocumentFile(null);
  };

  const handlePosterSelect = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) { alert('Please choose an image file (PNG, JPG, or WEBP) for the poster.'); return; }
    if (file.size > MAX_POSTER_BYTES) { alert('Poster image is too large. Please use an image under 6MB.'); return; }
    if (posterPreview) URL.revokeObjectURL(posterPreview);
    setPosterFile(file);
    setPosterPreview(URL.createObjectURL(file));
  };

  const handleDocumentSelect = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.type !== 'application/pdf') { alert('Please attach a PDF document.'); return; }
    if (file.size > MAX_DOCUMENT_BYTES) { alert('Document is too large. Please attach a PDF under 10MB.'); return; }
    setDocumentFile(file);
  };

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
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const accessToken = session?.access_token;

      let posterUpload = null;
      if (posterFile) {
        if (!accessToken) throw new Error('Could not verify your session to upload the poster.');
        const result = await uploadToR2({ file: posterFile, folder: 'cmms-announcements', accessToken });
        if (!result.success) throw new Error(result.error || 'Poster upload failed');
        posterUpload = { url: result.url, key: result.key };
      }

      let documentUpload = null;
      if (documentFile) {
        if (!accessToken) throw new Error('Could not verify your session to upload the document.');
        const result = await uploadToR2({ file: documentFile, folder: 'cmms-announcements', accessToken });
        if (!result.success) throw new Error(result.error || 'Document upload failed');
        documentUpload = { url: result.url, key: result.key };
      }

      const result = await cmmsBusinessOpportunitiesService.createOpportunity(companyId, {
        ...form,
        posterUrl: posterUpload?.url || null,
        posterPath: posterUpload?.key || null,
        documentUrl: documentUpload?.url || null,
        documentPath: documentUpload?.key || null,
      }, myCmmsUserId);
      if (!result.success) throw new Error(result.error);
      resetForm();
      setShowForm(false);
      loadMine();
    } catch (err) {
      alert(`❌ ${err.message || 'Failed to post opportunity'}`);
    } finally {
      setSaving(false);
    }
  };

  // Hands the opportunity off to whatever the device's own share sheet
  // offers (WhatsApp, email, SMS, etc.) -- same pattern as
  // CMMSAnnouncementsPanel's sharePost. Falls back to copying the link when
  // the Web Share API isn't available (most desktop browsers).
  const shareOpportunity = async (opportunity) => {
    const link = cmmsBusinessOpportunitiesService.buildPublicOpportunityLink(companyId, opportunity.id);
    const shareData = { title: opportunity.title, text: opportunity.description || opportunity.title, url: link };
    try {
      if (navigator.share && (!navigator.canShare || navigator.canShare(shareData))) {
        await navigator.share(shareData);
        return;
      }
    } catch (err) {
      if (err?.name === 'AbortError') return;
    }
    try {
      await navigator.clipboard.writeText(link);
      setCopiedShareId(opportunity.id);
      setTimeout(() => setCopiedShareId(null), 2000);
    } catch {
      window.prompt('Copy this link:', link);
    }
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
          <p className="text-xs text-gray-400">
            Open opportunities are visible with no login at your public board's Opportunities tab (same link as your notices/jobs board) — share the link below on any open opportunity.
          </p>
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
              <div className="grid md:grid-cols-2 gap-4 border-t border-white/10 pt-3">
                <div>
                  <p className="text-sm font-semibold text-white mb-2 flex items-center gap-1"><ImageIcon className="w-4 h-4" /> Poster image (optional)</p>
                  {posterPreview && (
                    <img src={posterPreview} alt="Poster preview" className="w-full h-28 object-cover rounded-lg border border-white/10 mb-2" />
                  )}
                  <label className="block text-xs text-gray-400 cursor-pointer">
                    <span className="inline-block px-3 py-1.5 rounded bg-white/10 hover:bg-white/20 text-white">Choose image</span>
                    <input type="file" accept="image/*" onChange={handlePosterSelect} className="hidden" />
                  </label>
                </div>
                <div>
                  <p className="text-sm font-semibold text-white mb-2 flex items-center gap-1"><FileText className="w-4 h-4" /> PDF document (optional)</p>
                  {documentFile && <p className="text-xs text-blue-300 mb-2 truncate">{documentFile.name}</p>}
                  <label className="block text-xs text-gray-400 cursor-pointer">
                    <span className="inline-block px-3 py-1.5 rounded bg-white/10 hover:bg-white/20 text-white">Choose PDF</span>
                    <input type="file" accept="application/pdf" onChange={handleDocumentSelect} className="hidden" />
                  </label>
                </div>
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
                companyId={companyId}
                companyStaff={companyStaff}
                myCmmsUserId={myCmmsUserId}
                canManage={canManage}
                canViewBids={canViewBids}
                onCancel={() => handleCancel(o.id)}
                onSelectWinner={handleSelectWinner}
                onBidsChanged={loadMine}
                onShare={shareOpportunity}
                copiedShareId={copiedShareId}
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

const OpportunityRow = ({ opportunity, expanded, onToggle, companyId, companyStaff, myCmmsUserId, canManage, canViewBids, onCancel, onSelectWinner, onBidsChanged, onShare, copiedShareId }) => {
  const [bids, setBids] = useState([]);
  const [bidsLoading, setBidsLoading] = useState(false);

  const loadBids = () => {
    setBidsLoading(true);
    cmmsBusinessOpportunitiesService.getBidsForOpportunity(opportunity.id).then((r) => {
      setBids(r.data || []);
      setBidsLoading(false);
    });
  };

  useEffect(() => {
    if (!expanded || !(canManage || canViewBids)) return;
    loadBids();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, opportunity.id, canManage, canViewBids]);

  const refreshBids = () => { loadBids(); onBidsChanged?.(); };

  const statusColor = { open: 'text-emerald-400', awarded: 'text-blue-400', closed: 'text-slate-400', cancelled: 'text-red-400' };

  return (
    <div className="glass-card border border-white/10 p-4">
      <div className="flex items-start justify-between gap-3 cursor-pointer" onClick={onToggle}>
        <div className="flex gap-3 min-w-0">
          {opportunity.poster_url && (
            <img src={opportunity.poster_url} alt="" className="w-16 h-16 object-cover rounded-lg border border-white/10 flex-shrink-0" />
          )}
          <div className="min-w-0">
            <p className="text-white font-semibold">{opportunity.title}</p>
            <p className="text-gray-400 text-xs">
              <span className={statusColor[opportunity.status]}>{opportunity.status}</span>
              {opportunity.budget_hint ? ` · ${opportunity.budget_hint}` : ''}
              {opportunity.deadline ? ` · closes ${new Date(opportunity.deadline).toLocaleDateString()}` : ''}
            </p>
            {opportunity.document_url && (
              <a href={opportunity.document_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 text-xs text-blue-300 hover:text-blue-200 mt-1">
                <FileText className="w-3.5 h-3.5" /> Document
              </a>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          {opportunity.status === 'open' && (
            <button onClick={(e) => { e.stopPropagation(); onShare(opportunity); }} className="text-xs text-purple-300 hover:text-purple-200 flex items-center gap-1">
              {copiedShareId === opportunity.id ? <><Check className="w-3.5 h-3.5" /> Link copied</> : <><Share2 className="w-3.5 h-3.5" /> Share</>}
            </button>
          )}
          {canManage && opportunity.status === 'open' && (
            <button onClick={(e) => { e.stopPropagation(); onCancel(); }} className="text-xs px-2 py-1 rounded bg-red-900/50 hover:bg-red-900 text-red-300">Cancel</button>
          )}
        </div>
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
                <BidCard
                  key={b.id}
                  bid={b}
                  opportunity={opportunity}
                  companyId={companyId}
                  companyStaff={companyStaff}
                  myCmmsUserId={myCmmsUserId}
                  canManage={canManage}
                  onSelectWinner={onSelectWinner}
                  onChanged={refreshBids}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const bidStatusColor = {
  submitted: 'text-slate-300',
  under_review: 'text-amber-300',
  shortlisted: 'text-blue-300',
  interview: 'text-sky-300',
  selected: 'text-emerald-400',
  rejected: 'text-red-400',
  withdrawn: 'text-slate-500',
};

/**
 * One bid, with the same status/interview pipeline job applications get
 * (ApplicationRow/ApplicationPipelineControls in CMMSAnnouncementsPanel.jsx)
 * plus, once selected, the "convert to a Service Provider Contract" step
 * that turns a won bid into an actual task (see
 * backend/CMMS_OPPORTUNITY_BID_PIPELINE.sql).
 */
const BidCard = ({ bid, opportunity, companyId, companyStaff, myCmmsUserId, canManage, onSelectWinner, onChanged }) => {
  const [status, setStatus] = useState(bid.status);
  const [note, setNote] = useState(bid.status_note || '');
  const [savingStatus, setSavingStatus] = useState(false);
  const dirty = status !== bid.status || note !== (bid.status_note || '');

  const [interviews, setInterviews] = useState([]);
  const [showScheduler, setShowScheduler] = useState(false);
  const [scheduleForm, setScheduleForm] = useState({ scheduledAt: '', durationMinutes: 30, interviewerIds: [], notes: '' });
  const [scheduling, setScheduling] = useState(false);
  const [joiningInterviewId, setJoiningInterviewId] = useState(null);
  const [boardroomAccess, setBoardroomAccess] = useState(null);
  const [copiedLink, setCopiedLink] = useState('');

  const [showContractForm, setShowContractForm] = useState(false);
  const [contractForm, setContractForm] = useState(null);
  const [contractSaving, setContractSaving] = useState(false);
  const [contractError, setContractError] = useState('');
  const [publishedContractLink, setPublishedContractLink] = useState('');

  const canInterview = bid.bidder_type === 'individual';

  const loadInterviews = () => {
    cmmsInterviewService.getInterviewsForBid(bid.id).then((r) => { if (r.success) setInterviews(r.data); });
  };

  useEffect(() => {
    if (canInterview) loadInterviews();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bid.id]);

  const saveStatus = async () => {
    setSavingStatus(true);
    const result = await cmmsBusinessOpportunitiesService.updateBidStatus(bid.id, status, note, myCmmsUserId);
    setSavingStatus(false);
    if (!result.success) { alert(`❌ ${result.error}`); return; }
    onChanged?.();
  };

  const copyLink = async (link) => {
    try { await navigator.clipboard.writeText(link); setCopiedLink(link); setTimeout(() => setCopiedLink(''), 2000); }
    catch { alert(link); }
  };

  const toggleInterviewer = (userId) => setScheduleForm((current) => ({
    ...current,
    interviewerIds: current.interviewerIds.includes(userId) ? current.interviewerIds.filter((id) => id !== userId) : [...current.interviewerIds, userId],
  }));

  const submitSchedule = async () => {
    if (!scheduleForm.scheduledAt) { alert('Choose a date and time for the interview.'); return; }
    setScheduling(true);
    const result = await cmmsInterviewService.scheduleInterviewForBid(companyId, bid, scheduleForm, myCmmsUserId);
    setScheduling(false);
    if (!result.success) { alert(`❌ ${result.error}`); return; }
    setShowScheduler(false);
    setScheduleForm({ scheduledAt: '', durationMinutes: 30, interviewerIds: [], notes: '' });
    loadInterviews();
    onChanged?.();
    await copyLink(cmmsInterviewService.buildCandidateInterviewLink(result.data.id));
  };

  const cancelInterview = async (schedule) => {
    if (!window.confirm('Cancel this scheduled interview?')) return;
    const result = await cmmsInterviewService.cancelInterview(schedule.id);
    if (!result.success) { alert(`❌ ${result.error}`); return; }
    loadInterviews();
  };

  const joinInterview = async (interview) => {
    setJoiningInterviewId(interview.id);
    const result = await cmmsInterviewService.canJoinInterview(interview.id);
    setJoiningInterviewId(null);
    if (!result.success || !result.data?.can_join) {
      alert(`❌ ${result.data?.status === 'cancelled' ? 'This interview has been cancelled.' : (result.error || 'You are not authorized to join this interview.')}`);
      return;
    }
    setBoardroomAccess(result.data);
  };

  const openContractForm = () => {
    setContractError('');
    setPublishedContractLink('');
    setContractForm({
      providerName: bid.bidder_name || '',
      providerContact: bid.bidder_contact || '',
      title: opportunity.title,
      scopeOfWork: bid.proposal || '',
      rate: bid.amount ? String(bid.amount) : '',
      validDays: 30,
      accessMode: 'pin',
      pin: '',
      allowedEmail: '',
    });
    setShowContractForm(true);
  };

  const publishContract = async () => {
    if (!contractForm.providerName.trim() || !contractForm.title.trim()) return;
    if (contractForm.accessMode === 'pin' && contractForm.pin.trim().length < 4) { setContractError('PIN must be at least 4 characters.'); return; }
    if (contractForm.accessMode === 'email' && !contractForm.allowedEmail.trim()) { setContractError('Enter the email allowed to open this contract.'); return; }
    setContractSaving(true);
    setContractError('');
    const result = await cmmsServiceProviderContractsService.publishServiceProviderContract(companyId, {
      providerName: contractForm.providerName,
      providerContact: contractForm.providerContact,
      title: contractForm.title,
      content: { scope_of_work: contractForm.scopeOfWork, rate: contractForm.rate },
      accessMode: contractForm.accessMode,
      pin: contractForm.pin,
      allowedEmail: contractForm.allowedEmail,
      validDays: Number(contractForm.validDays) || 30,
      opportunityBidId: bid.id,
    });
    setContractSaving(false);
    if (!result.success) { setContractError(result.error); return; }
    setPublishedContractLink(cmmsServiceProviderContractsService.buildServiceProviderContractUrl(result.data.access_token));
    onChanged?.();
  };

  return (
    <div className="bg-white/5 rounded-lg p-2.5 border border-white/10">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-white text-sm">{bid.bidder_name} <span className="text-gray-500 text-xs">({bid.bidder_type === 'anonymous' ? 'no ICAN account' : bid.bidder_type})</span></p>
          {bid.bidder_contact && <p className="text-gray-500 text-xs">{bid.bidder_contact}</p>}
          {bid.bidder_type === 'anonymous' && bid.reference_code && <p className="text-gray-600 text-[11px] font-mono">{bid.reference_code}</p>}
          {bid.amount && <p className="text-gray-400 text-xs">Amount: {Number(bid.amount).toLocaleString()}</p>}
          <p className="text-gray-400 text-xs">{bid.proposal}</p>
          <p className={`text-xs mt-1 ${bidStatusColor[bid.status]}`}>{bid.status.replace('_', ' ')}</p>
        </div>
        {canManage && opportunity.status === 'open' && !['selected', 'rejected', 'withdrawn'].includes(bid.status) && (
          <button onClick={() => onSelectWinner(bid.id)} className="shrink-0 text-xs px-2 py-1 rounded bg-emerald-700 hover:bg-emerald-600 text-white">Select Winner</button>
        )}
      </div>

      {canManage && !['selected', 'rejected', 'withdrawn'].includes(bid.status) && (
        <div className="mt-2 pt-2 border-t border-white/10 flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="text-xs rounded bg-slate-900 border border-white/20 px-2 py-1 text-white">
              {bidStatusOptions.map((opt) => <option key={opt.id} value={opt.id}>{opt.label}</option>)}
            </select>
            <button disabled={!dirty || savingStatus} onClick={saveStatus} className="px-2 py-1 rounded bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white text-xs font-semibold">
              {savingStatus ? 'Saving…' : 'Save status'}
            </button>
            {canInterview && (
              <button onClick={() => setShowScheduler((v) => !v)} className="px-2 py-1 rounded bg-sky-600/80 hover:bg-sky-500 text-white text-xs font-semibold flex items-center gap-1">
                <Video className="w-3.5 h-3.5" /> Schedule interview
              </button>
            )}
          </div>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" rows={2} className="text-xs rounded bg-white/10 border border-white/20 px-2 py-1.5 text-white" />
        </div>
      )}

      {canInterview && interviews.filter((i) => i.status === 'scheduled').map((interview) => (
        <div key={interview.id} className="mt-2 flex items-center gap-2 text-xs text-gray-400">
          <Video className="w-3.5 h-3.5 text-sky-300" />
          Interview: {new Date(interview.scheduled_at).toLocaleString()} ({interview.duration_minutes} min)
          <button onClick={() => joinInterview(interview)} disabled={joiningInterviewId === interview.id} className="text-emerald-300 hover:text-emerald-200 disabled:opacity-50">
            {joiningInterviewId === interview.id ? 'Checking…' : 'Join call'}
          </button>
          <button onClick={() => copyLink(cmmsInterviewService.buildCandidateInterviewLink(interview.id))} className="text-blue-300 hover:text-blue-200">Copy link</button>
          {canManage && <button onClick={() => cancelInterview(interview)} className="text-red-300 hover:text-red-200">Cancel</button>}
        </div>
      ))}

      {copiedLink && <p className="mt-1 text-xs text-emerald-300 flex items-center gap-1"><Copy className="w-3 h-3" /> Link copied</p>}

      {showScheduler && canManage && (
        <div className="mt-2 p-3 rounded bg-white/5 border border-white/10 space-y-2">
          <p className="text-sm font-semibold text-white">Schedule a live video interview</p>
          <div className="grid md:grid-cols-2 gap-2">
            <input type="datetime-local" value={scheduleForm.scheduledAt} onChange={(e) => setScheduleForm((c) => ({ ...c, scheduledAt: e.target.value }))} className="px-2 py-1.5 rounded bg-slate-900 text-white border border-white/20 text-sm" />
            <input type="number" min="5" value={scheduleForm.durationMinutes} onChange={(e) => setScheduleForm((c) => ({ ...c, durationMinutes: e.target.value }))} placeholder="Duration (minutes)" className="px-2 py-1.5 rounded bg-white/10 text-white border border-white/20 text-sm" />
          </div>
          <div>
            <p className="text-xs text-gray-400 mb-1">Interviewer(s)</p>
            <div className="flex flex-wrap gap-2">
              {companyStaff.map((s) => (
                <label key={s.id} className="flex items-center gap-1 text-xs text-gray-300">
                  <input type="checkbox" checked={scheduleForm.interviewerIds.includes(s.id)} onChange={() => toggleInterviewer(s.id)} />
                  {s.full_name || s.user_name || s.email}
                </label>
              ))}
            </div>
          </div>
          <textarea value={scheduleForm.notes} onChange={(e) => setScheduleForm((c) => ({ ...c, notes: e.target.value }))} placeholder="Notes for interviewers (optional)" rows={2} className="w-full px-2 py-1.5 rounded bg-white/10 text-white border border-white/20 text-sm" />
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowScheduler(false)} className="px-3 py-1.5 text-xs text-gray-300 hover:text-white">Cancel</button>
            <button disabled={scheduling} onClick={submitSchedule} className="px-3 py-1.5 rounded bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold">{scheduling ? 'Scheduling…' : 'Schedule & get link'}</button>
          </div>
        </div>
      )}

      {boardroomAccess && (
        <div className="fixed inset-0 z-[90] bg-black">
          <LiveBoardroom
            groupId={boardroomAccess.room_id}
            groupName={`Interview — ${boardroomAccess.candidate_name}`}
            members={boardroomAccess.is_interviewer ? [{ id: boardroomAccess.candidate_ican_user_id, email: boardroomAccess.candidate_name }] : (boardroomAccess.members || [])}
            creatorId={null}
            context="cmms-interview"
            onClose={() => setBoardroomAccess(null)}
            autoStart
          />
        </div>
      )}

      {canManage && bid.status === 'selected' && (
        bid.converted_contract_id ? (
          <p className="mt-2 text-xs text-emerald-400 flex items-center gap-1"><Briefcase className="w-3.5 h-3.5" /> Converted to a task (Service Provider Contract)</p>
        ) : (
          <div className="mt-2">
            {!showContractForm ? (
              <button onClick={openContractForm} className="px-2 py-1 rounded bg-amber-600/80 hover:bg-amber-500 text-white text-xs font-semibold flex items-center gap-1">
                <Briefcase className="w-3.5 h-3.5" /> Create Service Provider Contract
              </button>
            ) : (
              <div className="p-3 rounded bg-white/5 border border-amber-400/30 space-y-2">
                <p className="text-sm font-semibold text-white">Turn this won bid into a task</p>
                {publishedContractLink ? (
                  <div className="bg-emerald-900/30 border border-emerald-700 rounded p-2">
                    <p className="text-emerald-300 text-xs mb-1">Contract published. Share this link plus the PIN/email separately with the provider:</p>
                    <div className="flex gap-2">
                      <input readOnly value={publishedContractLink} className="flex-1 bg-slate-800 text-slate-300 text-xs rounded px-2 py-1.5 border border-slate-700" onFocus={(e) => e.target.select()} />
                      <button onClick={() => navigator.clipboard?.writeText(publishedContractLink)} className="text-xs px-2 py-1.5 rounded bg-emerald-700 hover:bg-emerald-600 text-white">Copy</button>
                    </div>
                    <div className="flex justify-end mt-2">
                      <button onClick={() => setShowContractForm(false)} className="px-3 py-1.5 text-xs text-gray-300 hover:text-white">Done</button>
                    </div>
                  </div>
                ) : (
                  <>
                    {contractError && <p className="text-red-300 text-xs">{contractError}</p>}
                    <div className="grid md:grid-cols-2 gap-2">
                      <input value={contractForm.providerName} onChange={(e) => setContractForm({ ...contractForm, providerName: e.target.value })} placeholder="Provider name" className="px-2 py-1.5 rounded bg-white/10 text-white border border-white/20 text-sm" />
                      <input value={contractForm.providerContact} onChange={(e) => setContractForm({ ...contractForm, providerContact: e.target.value })} placeholder="Contact (phone or email)" className="px-2 py-1.5 rounded bg-white/10 text-white border border-white/20 text-sm" />
                    </div>
                    <input value={contractForm.title} onChange={(e) => setContractForm({ ...contractForm, title: e.target.value })} placeholder="Contract title" className="w-full px-2 py-1.5 rounded bg-white/10 text-white border border-white/20 text-sm" />
                    <textarea value={contractForm.scopeOfWork} onChange={(e) => setContractForm({ ...contractForm, scopeOfWork: e.target.value })} placeholder="Scope of work" rows={2} className="w-full px-2 py-1.5 rounded bg-white/10 text-white border border-white/20 text-sm" />
                    <div className="grid grid-cols-2 gap-2">
                      <input value={contractForm.rate} onChange={(e) => setContractForm({ ...contractForm, rate: e.target.value })} placeholder="Rate" className="px-2 py-1.5 rounded bg-white/10 text-white border border-white/20 text-sm" />
                      <input type="number" min="1" value={contractForm.validDays} onChange={(e) => setContractForm({ ...contractForm, validDays: e.target.value })} placeholder="Valid for (days)" className="px-2 py-1.5 rounded bg-white/10 text-white border border-white/20 text-sm" />
                    </div>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => setContractForm({ ...contractForm, accessMode: 'pin' })} className={`flex-1 text-xs py-1.5 rounded border ${contractForm.accessMode === 'pin' ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-white/5 border-white/20 text-gray-300'}`}>Secret PIN</button>
                      <button type="button" onClick={() => setContractForm({ ...contractForm, accessMode: 'email' })} className={`flex-1 text-xs py-1.5 rounded border ${contractForm.accessMode === 'email' ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-white/5 border-white/20 text-gray-300'}`}>Their email</button>
                    </div>
                    {contractForm.accessMode === 'pin' ? (
                      <input value={contractForm.pin} onChange={(e) => setContractForm({ ...contractForm, pin: e.target.value })} placeholder="PIN (min 4 characters)" className="w-full px-2 py-1.5 rounded bg-white/10 text-white border border-white/20 text-sm" />
                    ) : (
                      <input value={contractForm.allowedEmail} onChange={(e) => setContractForm({ ...contractForm, allowedEmail: e.target.value })} placeholder="Allowed email" className="w-full px-2 py-1.5 rounded bg-white/10 text-white border border-white/20 text-sm" />
                    )}
                    <div className="flex justify-end gap-2">
                      <button onClick={() => setShowContractForm(false)} className="px-3 py-1.5 text-xs text-gray-300 hover:text-white">Cancel</button>
                      <button disabled={contractSaving || !contractForm.providerName.trim() || !contractForm.title.trim()} onClick={publishContract} className="px-3 py-1.5 rounded bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-xs font-semibold">
                        {contractSaving ? 'Publishing…' : 'Publish contract'}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )
      )}
    </div>
  );
};

export default CMMSBusinessOpportunitiesPanel;
