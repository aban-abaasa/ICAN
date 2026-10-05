import React, { useState, useEffect, forwardRef, useImperativeHandle } from 'react';
import {
  FileText,
  Upload,
  X,
  Check,
  AlertCircle,
  DollarSign,
  Lock,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { getSupabase } from '../services/pitchingService';


const BPD_STYLES = `
.bpd {
  --bpd-text: #1e293b; --bpd-muted: #64748b; --bpd-surface: #fffdf8; --bpd-surface-2: #f6f1e4;
  --bpd-input: #ffffff; --bpd-border: rgba(196,160,82,.35); --bpd-track: rgba(100,116,139,.2);
  --bpd-hero-a: #fff7e0; --bpd-hero-b: #f1ecff; --bpd-page: #fbf7ec; --bpd-bar: rgba(251,247,236,.92);
}
:root[data-theme="dark"] .bpd, :root[data-theme="purple"] .bpd, :root[data-theme="green"] .bpd,
:root[data-theme="ocean"] .bpd, :root[data-theme="sienna"] .bpd {
  --bpd-text: #f1f5f9; --bpd-muted: #a3b0c2; --bpd-surface: rgba(255,255,255,.05); --bpd-surface-2: rgba(255,255,255,.08);
  --bpd-input: rgba(0,0,0,.3); --bpd-border: rgba(255,255,255,.14); --bpd-track: rgba(255,255,255,.16);
  --bpd-hero-a: rgba(99,102,241,.22); --bpd-hero-b: rgba(236,72,153,.16);
  --bpd-page: linear-gradient(135deg,#0f172a,#1e1b4b 50%,#0f172a); --bpd-bar: rgba(15,23,42,.92);
}
.bpd-text { color: var(--bpd-text); }
.bpd-muted { color: var(--bpd-muted); }
.bpd-hero { background: linear-gradient(135deg, var(--bpd-hero-a), var(--bpd-hero-b)); border: 1px solid var(--bpd-border); color: var(--bpd-text); }
.bpd-card { background: var(--bpd-surface); border: 1px solid var(--bpd-border); color: var(--bpd-text); transition: border-color .25s, box-shadow .25s, transform .25s; }
.bpd-card:hover { transform: translateY(-1px); }
.bpd-card.open { border-color: var(--accent); box-shadow: 0 14px 30px -18px var(--accent); }
.bpd-input { background: var(--bpd-input); border: 1px solid var(--bpd-border); color: var(--bpd-text); outline: none; transition: border-color .2s, box-shadow .2s; }
.bpd-input::placeholder { color: var(--bpd-muted); opacity: .8; }
.bpd-input:focus { border-color: var(--accent, #6366f1); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent, #6366f1) 25%, transparent); }
.bpd-seg { background: var(--bpd-track); transition: background .4s; }
.bpd-seg.on { background: var(--c); animation: bpd-pop .45s ease; }
.bpd-bubble { background: var(--bpd-surface-2); color: var(--bpd-muted); transition: background .3s, color .3s, transform .3s; }
.bpd-bubble.active { background: var(--accent); color: #fff; animation: bpd-ring 1.8s ease-out infinite; }
.bpd-bubble.done { background: var(--accent); color: #fff; }
.bpd-bubble.done svg { animation: bpd-pop .45s ease; }
.bpd-chip { background: var(--bpd-surface-2); color: var(--bpd-muted); }
.bpd-chip.done { background: color-mix(in srgb, var(--accent) 16%, transparent); color: var(--accent); }
.bpd-body { animation: bpd-open .3s ease-out; }
.bpd-cta { background: var(--accent); color: #fff; transition: transform .2s, box-shadow .2s, filter .2s; }
.bpd-cta:hover { transform: translateY(-2px); filter: brightness(1.08); box-shadow: 0 10px 22px -12px var(--accent); }
.bpd-cta:active { transform: scale(.98); }
.bpd-cta.done { background: color-mix(in srgb, var(--accent) 14%, transparent); color: var(--accent); border: 1px solid var(--accent); }
.bpd-total { background: color-mix(in srgb, #10b981 14%, transparent); border: 1px solid #10b981; color: #059669; }
:root[data-theme="dark"] .bpd-total, :root[data-theme="purple"] .bpd-total, :root[data-theme="green"] .bpd-total, :root[data-theme="ocean"] .bpd-total, :root[data-theme="sienna"] .bpd-total { color: #6ee7b7; }
.bpd-ok { background: rgba(16,185,129,.14); color: #059669; border: 1px solid rgba(16,185,129,.4); }
.bpd-err { background: rgba(239,68,68,.12); color: #dc2626; border: 1px solid rgba(239,68,68,.4); }
.bpd-info { background: rgba(59,130,246,.12); color: #2563eb; border: 1px solid rgba(59,130,246,.4); }
.bpd-drop { border: 2px dashed var(--bpd-border); transition: border-color .2s, background .2s; }
.bpd-drop:hover, .bpd-drop.drag { border-color: var(--accent, #6366f1); background: color-mix(in srgb, var(--accent, #6366f1) 8%, transparent); }
.bpd-ghost { background: var(--bpd-surface-2); color: var(--bpd-text); transition: filter .2s; }
.bpd-ghost:hover { filter: brightness(.95); }
.bpd-main { background: linear-gradient(135deg,#7c3aed,#4f46e5); color: #fff; transition: transform .2s, box-shadow .2s; }
.bpd-main:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 10px 22px -12px #4f46e5; }
@keyframes bpd-pop { 0% { transform: scale(.6); } 60% { transform: scale(1.2); } 100% { transform: scale(1); } }
@keyframes bpd-ring { 0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent) 55%, transparent); } 100% { box-shadow: 0 0 0 10px transparent; } }
@keyframes bpd-open { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .bpd *, .bpd { animation: none !important; transition: none !important; } }
`;


const fmtUgx = (n) => `UGX ${Math.round(Number(n) || 0).toLocaleString('en-US')}`;
const LIVE_START = '— Live data';
const LIVE_END = '— End live data —';
const LIVE_RE = /— Live data[^\n]*—\n[\s\S]*?— End live data —\n?/;

// Replaces (or prepends) the auto-managed live block; everything the user typed
// outside the block is left exactly as it was.
const withLiveBlock = (text, lines, stamp) => {
  const block = `${LIVE_START} (as of ${stamp}) —\n${lines.join('\n')}\n${LIVE_END}\n`;
  const current = text || '';
  if (LIVE_RE.test(current)) return current.replace(LIVE_RE, block);
  return current ? `${block}\n${current}` : block;
};

const LIVE_CSS = `
.bpd-live { background: linear-gradient(135deg, color-mix(in srgb, #10b981 14%, transparent), color-mix(in srgb, #0ea5e9 14%, transparent)); border: 1px solid color-mix(in srgb, #10b981 45%, transparent); color: var(--bpd-text); }
.bpd-dot { width: .6rem; height: .6rem; border-radius: 9999px; background: #10b981; animation: bpd-blink 1.6s ease-in-out infinite; }
.bpd-tile { background: var(--bpd-surface); border: 1px solid var(--bpd-border); border-top: 3px solid var(--t); animation: bpd-flash .8s ease; }
.bpd-feed { animation: bpd-open .35s ease-out; }
.bpd-switch { position: relative; flex: none; width: 2.25rem; height: 1.25rem; border-radius: 9999px; background: var(--bpd-track); transition: background .25s; }
.bpd-switch.on { background: #10b981; }
.bpd-switch i { position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 9999px; background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.3); transition: transform .25s; }
.bpd-switch.on i { transform: translateX(16px); }
.bpd-row + .bpd-row { border-top: 1px dashed var(--bpd-border); }
@keyframes bpd-blink { 0%,100% { opacity: 1; box-shadow: 0 0 0 0 rgba(16,185,129,.6); } 50% { opacity: .6; box-shadow: 0 0 0 6px rgba(16,185,129,0); } }
@keyframes bpd-flash { 0% { background: color-mix(in srgb, var(--t) 28%, var(--bpd-surface)); transform: translateY(-2px); } 100% { background: var(--bpd-surface); transform: none; } }
`;

const STEP_COLORS = ['#6366f1', '#0ea5e9', '#f59e0b', '#10b981', '#ec4899'];

// A section counts as unfilled when it is blank or still holds a template placeholder such as
// "[Please describe your target market]" or "$[amount]". Real writing is never overwritten.
const isUnfilled = (value) => {
  const t = String(value || '').trim();
  return !t || /\[[^\]]{6,}\]/.test(t);
};

const BusinessProfileDocuments = forwardRef(({ businessProfile, onDocumentsComplete, onCancel, hideSkip = false, liveData = null, draft = null }, ref) => {
  const [documents, setDocuments] = useState({
    businessPlan: { content: '', file: null, completed: false },
    financialProjection: { content: '', file: null, completed: false },
    valueProposition: {
      content: '',
      wants: '',
      fears: '',
      needs: '',
      file: null,
      completed: false
    },
    mou: { content: '', file: null, completed: false },
    shareAllocation: {
      content: '',
      shares: '',
      sharePrice: '',
      totalAmount: '',
      file: null,
      completed: false
    }
  });

  const [noDisclosure, setNoDisclosure] = useState(false);
  const [disclosureNotes, setDisclosureNotes] = useState('');
  const [expandedSections, setExpandedSections] = useState({
    businessPlan: true,
    financialProjection: false,
    valueProposition: false,
    mou: false,
    shareAllocation: false
  });
  const [loading, setLoading] = useState(false);
  const [saveStatus, setSaveStatus] = useState('');
  const [docsLoaded, setDocsLoaded] = useState(false);
  const [liveRefs, setLiveRefs] = useState({ stamp: '', refs: {} });
  const [autoSync, setAutoSync] = useState({ businessPlan: true, financialProjection: true, valueProposition: true, mou: true, shareAllocation: true });

  // Load existing documents
  useEffect(() => {
    setDocsLoaded(false);
    Promise.resolve(loadDocuments()).finally(() => setDocsLoaded(true));
  }, [businessProfile?.id]);

  // "Fill from my idea" draft: pre-fill the written sections that are still empty.
  useEffect(() => {
    if (!draft || !docsLoaded) return;
    setDocuments((prev) => {
      const next = { ...prev };
      if (draft.businessPlan && isUnfilled(prev.businessPlan.content)) next.businessPlan = { ...prev.businessPlan, content: draft.businessPlan };
      if (draft.financials && isUnfilled(prev.financialProjection.content)) next.financialProjection = { ...prev.financialProjection, content: draft.financials };
      const vp = { ...prev.valueProposition };
      ['wants', 'fears', 'needs'].forEach((field) => {
        if (draft[field] && isUnfilled(prev.valueProposition[field])) vp[field] = draft[field];
      });
      next.valueProposition = vp;
      return next;
    });
  }, [draft, docsLoaded]);

  // Check if all documents are complete and notify parent
  useEffect(() => {
    // Helper function to check if content has meaningful text (more lenient)
    const hasMinimumContent = (text) => {
      const trimmedText = text.trim();
      // Accept content if it's longer than 10 characters and not completely empty placeholders
      return trimmedText.length > 10 && 
             !trimmedText.startsWith('[Enter ') && 
             trimmedText !== '[amount]' && 
             trimmedText !== '[percentage]' &&
             trimmedText !== '[description]' &&
             trimmedText !== '[details]' &&
             trimmedText !== '[breakdown]';
    };

    // More lenient validation - allow most auto-populated content
    const businessPlanValid = documents.businessPlan.content.trim().length > 20;
    const financialProjectionValid = documents.financialProjection.content.trim().length > 20;
    const valuePropositionWantsValid = documents.valueProposition.wants.trim().length > 10;
    const valuePropositionFearsValid = documents.valueProposition.fears.trim().length > 10;
    const valuePropositionNeedsValid = documents.valueProposition.needs.trim().length > 10;
    const mouValid = documents.mou.content.trim().length > 20;
    const shareAllocationSharesValid = documents.shareAllocation.shares !== '' && documents.shareAllocation.shares !== null;
    const shareAllocationPriceValid = documents.shareAllocation.sharePrice !== '' && documents.shareAllocation.sharePrice !== null;
    
    const allComplete = 
      businessPlanValid &&
      financialProjectionValid &&
      valuePropositionWantsValid &&
      valuePropositionFearsValid &&
      valuePropositionNeedsValid &&
      mouValid &&
      shareAllocationSharesValid &&
      shareAllocationPriceValid;

    // Debug logging to show which fields are missing
    if (!allComplete) {
      console.log('📋 Document validation status (lenient):');
      console.log('Business Plan:', businessPlanValid ? '✅' : '❌', 'Length:', documents.businessPlan.content.length, '(need >20)');
      console.log('Financial Projection:', financialProjectionValid ? '✅' : '❌', 'Length:', documents.financialProjection.content.length, '(need >20)');
      console.log('Value Proposition - Wants:', valuePropositionWantsValid ? '✅' : '❌', 'Length:', documents.valueProposition.wants.length, '(need >10)');
      console.log('Value Proposition - Fears:', valuePropositionFearsValid ? '✅' : '❌', 'Length:', documents.valueProposition.fears.length, '(need >10)');
      console.log('Value Proposition - Needs:', valuePropositionNeedsValid ? '✅' : '❌', 'Length:', documents.valueProposition.needs.length, '(need >10)');
      console.log('MOU:', mouValid ? '✅' : '❌', 'Length:', documents.mou.content.length, '(need >20)');
      console.log('Share Allocation - Shares:', shareAllocationSharesValid ? '✅' : '❌', 'Value:', documents.shareAllocation.shares);
      console.log('Share Allocation - Price:', shareAllocationPriceValid ? '✅' : '❌', 'Value:', documents.shareAllocation.sharePrice);
    } else {
      console.log('✅ All documents pass lenient validation!');
    }

    if (onDocumentsComplete) {
      if (allComplete) {
        // Pass the actual documents data when complete
        const documentsData = {
          business_profile_id: businessProfile.id,
          business_plan_content: documents.businessPlan.content,
          business_plan_completed: documents.businessPlan.completed,
          financial_projection_content: documents.financialProjection.content,
          financial_projection_completed: documents.financialProjection.completed,
          value_proposition_wants: documents.valueProposition.wants,
          value_proposition_fears: documents.valueProposition.fears,
          value_proposition_needs: documents.valueProposition.needs,
          value_proposition_completed: documents.valueProposition.completed,
          mou_content: documents.mou.content,
          mou_completed: documents.mou.completed,
          share_allocation_shares: documents.shareAllocation.shares,
          share_allocation_share_price: documents.shareAllocation.sharePrice,
          share_allocation_completed: documents.shareAllocation.completed,
          all_documents_completed: allComplete
        };
        onDocumentsComplete(documentsData);
      } else {
        onDocumentsComplete(false);
      }
    }
  }, [documents, onDocumentsComplete]);

  const loadDocuments = async () => {
    try {
      const supabase = getSupabase();
      console.log('📄 Loading documents for business profile:', businessProfile.id);
      
      if (!businessProfile?.id) {
        console.warn('⚠️ Business profile ID is missing, cannot load documents');
        return;
      }

      if (!supabase) {
        console.warn('⚠️ Supabase not available');
        return;
      }

      const { data, error } = await supabase
        .from('business_documents')
        .select('*')
        .eq('business_profile_id', businessProfile.id)
        .limit(1);  // Use limit instead of single() for better error handling

      if (error) {
        console.warn('⚠️ Load error:', error.message, error.code);
      }

      if (data && data.length > 0) {
        console.log('✅ Documents loaded successfully:', data[0]);
        setDocuments({
          businessPlan: {
            content: data[0].business_plan_content || '',
            file: null,
            completed: data[0].business_plan_completed
          },
          financialProjection: {
            content: data[0].financial_projection_content || '',
            file: null,
            completed: data[0].financial_projection_completed
          },
          valueProposition: {
            content: data[0].value_proposition_content || '',
            wants: data[0].value_proposition_wants || '',
            fears: data[0].value_proposition_fears || '',
            needs: data[0].value_proposition_needs || '',
            file: null,
            completed: data[0].value_proposition_completed
          },
          mou: {
            content: data[0].mou_content || '',
            file: null,
            completed: data[0].mou_completed
          },
          shareAllocation: {
            content: data[0].share_allocation_content || '',
            shares: data[0].share_allocation_shares || '',
            sharePrice: data[0].share_allocation_share_price || '',
            totalAmount: data[0].share_allocation_total_amount || '',
            file: null,
            completed: data[0].share_allocation_completed
          }
        });
        setNoDisclosure(data[0].no_disclosure_enabled || false);
        setDisclosureNotes(data[0].disclosure_notes || '');
      } else {
        // No existing documents - auto-populate from business profile
        console.log('No existing documents found. Auto-populating from business profile:', businessProfile);
        
        const autoPopulatedDocs = {
          businessPlan: {
            content: businessProfile.business_description 
              ? `Business Overview:\n${businessProfile.business_description}\n\nBusiness Type: ${businessProfile.business_type || 'Not specified'}\n\nTarget Market:\n[Please describe your target market and customer base]\n\nCompetitive Advantage:\n[Please describe what sets your business apart]\n\nGrowth Strategy:\n[Please outline your growth and expansion plans]`
              : `Business Plan for ${businessProfile.business_name || 'Your Business'}\n\n[Please describe your business model, target market, and growth strategy]`,
            file: null,
            completed: false
          },
          financialProjection: {
            content: businessProfile.current_revenue 
              ? `Current Financial Status:\nRevenue: ${businessProfile.current_revenue}\nFunding Stage: ${businessProfile.funding_stage || 'Seed'}\n\nProjected Revenue:\nYear 1: [Enter projected revenue]\nYear 2: [Enter projected revenue]\nYear 3: [Enter projected revenue]\n\nKey Assumptions:\n[List your financial assumptions and projections]`
              : 'Financial Projections:\n\nRevenue Projections:\nYear 1: $[amount]\nYear 2: $[amount]\nYear 3: $[amount]\n\nExpenses:\n- Personnel: $[amount]\n- Marketing: $[amount]\n- Operations: $[amount]\n- Other: $[amount]\n\nFunding Requirements:\nTotal needed: $[amount]\nUse of funds: [breakdown]',
            file: null,
            completed: false
          },
          valueProposition: {
            content: '',
            wants: businessProfile.value_proposition || '[What does your target customer want or desire?]',
            fears: '[What problems or pain points does your customer face?]',
            needs: '[What essential needs does your product/service fulfill?]',
            file: null,
            completed: false
          },
          mou: {
            content: `Memorandum of Understanding\n\nBusiness: ${businessProfile.business_name || '[Business Name]'}\nContact: ${businessProfile.contact_person || '[Contact Person]'}\nEmail: ${businessProfile.email || '[Email Address]'}\n\nInvestment Terms:\n- Investment Amount: $[amount]\n- Equity Offered: [percentage]%\n- Use of Funds: [description]\n- Expected Returns: [details]\n\nKey Terms and Conditions:\n[Please outline the key terms of the investment agreement]`,
            file: null,
            completed: false
          },
          shareAllocation: {
            content: '',
            shares: '10', // Default 10% equity
            sharePrice: '1.00', // Default $1 per share
            totalAmount: '',
            file: null,
            completed: false
          }
        };
        
        setDocuments(autoPopulatedDocs);
        console.log('✅ Auto-populated documents from business profile');
      }
    } catch (error) {
      console.log('No existing documents found', error);
    }
  };

  // Live reference: figures from the real records are kept in `liveRefs`
  // (shown as a read-only list above each text box) instead of being typed into
  // the text. They are appended to the text only when the plan is published.
  useEffect(() => {
    const L = liveData?.live;
    const v = L?.valuation;
    if (!docsLoaded || !L) return;
    const at = (liveData.updatedAt || new Date());
    const stamp = at.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const inv = L.inventory; const rep = L.reports; const tx = L.transactions;
    const n = (x) => Number(x || 0).toLocaleString('en-US');
    const setup = v && !v.needsShareSetup;
    const offered = parseFloat(documents.shareAllocation.shares) || 0;

    const refs = {
      businessPlan: [
        { label: 'Stock on hand', value: `${inv.count} items${inv.topCategories.length ? ` · ${inv.topCategories.join(', ')}` : ''}` },
        { label: 'Reports filed', value: `${rep.total} · ${rep.resolved} resolved` },
        { label: 'Transactions recorded', value: n(tx.count) },
      ],
      financialProjection: [
        ...(v ? [
          { label: 'Revenue', value: fmtUgx(v.totalRevenueUgx) },
          { label: 'Net profit', value: fmtUgx(v.netProfitUgx) },
          { label: 'Total assets', value: fmtUgx(v.totalAssetsUgx) },
          { label: 'Business value', value: fmtUgx(v.businessValueUgx) },
          { label: 'Stock cost', value: fmtUgx(v.breakdown?.ican_bought_stock) },
          { label: 'Operating', value: fmtUgx(v.breakdown?.ican_operating_exp) },
          { label: 'Salaries', value: fmtUgx(v.breakdown?.ican_salary_exp) },
          { label: 'Tax', value: fmtUgx(v.breakdown?.ican_tax_exp) },
        ] : []),
        { label: 'Inventory value', value: fmtUgx(inv.valueUgx) },
        { label: 'Net of transactions', value: fmtUgx(tx.netUgx) },
      ],
      valueProposition: [
        { field: 'wants', label: 'Supply offered', value: inv.topCategories.join(', ') },
        { field: 'fears', label: 'Open issues', value: rep.open ? `${rep.open}${rep.openCategories.length ? ` · ${rep.openCategories.join(', ')}` : ''}` : 'None' },
        { field: 'fears', label: 'Low stock', value: inv.lowStock ? `${inv.lowStock} item(s)` : '' },
        { field: 'needs', label: 'Restock', value: inv.lowItems.join(', ') },
      ].filter((r) => r.value),
      mou: setup ? [
        { label: 'Valuation', value: `${fmtUgx(v.businessValueUgx)} · ${n(v.totalShares)} shares` },
        ...(offered ? [
          { label: 'Equity offered', value: `${((offered / v.totalShares) * 100).toFixed(2)}%` },
          { label: 'Investment amount', value: fmtUgx(offered * v.sharePriceUgx) },
        ] : []),
      ] : [],
      shareAllocation: setup ? [
        { label: 'Live share price', value: fmtUgx(v.sharePriceUgx) },
        { label: 'Total shares', value: n(v.totalShares) },
        { label: 'Sold to investors', value: n(L.sharesIssued) },
        { label: 'Still available', value: n(Math.max(0, v.totalShares - (L.sharesIssued || 0))) },
      ] : [],
    };
    setLiveRefs({ stamp, refs });

    setDocuments((prev) => {
      // Clear any old in-text live block saved by an earlier version.
      const clean = (t) => (t || '').replace(LIVE_RE, '').replace(/^\n+/, '');
      const next = { ...prev };
      next.businessPlan = { ...prev.businessPlan, content: clean(prev.businessPlan.content) };
      next.financialProjection = { ...prev.financialProjection, content: clean(prev.financialProjection.content) };
      next.mou = { ...prev.mou, content: clean(prev.mou.content) };
      next.valueProposition = { ...prev.valueProposition, wants: clean(prev.valueProposition.wants), fears: clean(prev.valueProposition.fears), needs: clean(prev.valueProposition.needs) };
      if (autoSync.shareAllocation && setup) {
        const price = Math.round(v.sharePriceUgx * 100) / 100;
        const shares = parseFloat(prev.shareAllocation.shares) || 0;
        next.shareAllocation = {
          ...prev.shareAllocation,
          content: clean(prev.shareAllocation.content),
          sharePrice: String(price),
          totalAmount: shares ? String(Math.round(shares * price * 100) / 100) : prev.shareAllocation.totalAmount,
        };
      }
      return next;
    });
  }, [liveData?.tick, docsLoaded, autoSync.shareAllocation, documents.shareAllocation.shares]);

  // Text form of a section's live reference, appended on publish only.
  const liveText = (section, field) => {
    if (!autoSync[section] || !liveRefs.refs[section]) return '';
    const rows = liveRefs.refs[section].filter((r) => (field ? r.field === field : !r.field));
    if (!rows.length) return '';
    return `\n\nLive figures (as of ${liveRefs.stamp}):\n${rows.map((r) => `${r.label}: ${r.value}`).join('\n')}`;
  };

  // Accordion: opening one section closes the others so the page stays short.
  const toggleSection = (section) => {
    setExpandedSections(prev => {
      const open = !prev[section];
      return {
        businessPlan: false,
        financialProjection: false,
        valueProposition: false,
        mou: false,
        shareAllocation: false,
        [section]: open
      };
    });
  };

  const handleFileUpload = (section, file) => {
    setDocuments(prev => ({
      ...prev,
      [section]: { ...prev[section], file }
    }));
  };

  const handleContentChange = (section, value, subfield = null) => {
    if (subfield) {
      setDocuments(prev => ({
        ...prev,
        [section]: {
          ...prev[section],
          [subfield]: value
        }
      }));
    } else {
      setDocuments(prev => ({
        ...prev,
        [section]: { ...prev[section], content: value }
      }));
    }
  };

  const markComplete = (section) => {
    setDocuments(prev => ({
      ...prev,
      [section]: { ...prev[section], completed: !prev[section].completed }
    }));
  };

  const calculateShareAllocation = (shares = null, price = null) => {
    const sharesValue = shares !== null ? parseFloat(shares) : parseFloat(documents.shareAllocation.shares) || 0;
    const priceValue = price !== null ? parseFloat(price) : parseFloat(documents.shareAllocation.sharePrice) || 0;
    const total = sharesValue * priceValue;

    setDocuments(prev => ({
      ...prev,
      shareAllocation: {
        ...prev.shareAllocation,
        totalAmount: total.toFixed(2)
      }
    }));
  };

  const saveDocuments = async () => {
    setLoading(true);
    setSaveStatus('Saving...');

    try {
      const supabase = getSupabase();
      if (!supabase) {
        throw new Error('Supabase connection not available!');
      }
      if (!businessProfile?.id) {
        throw new Error('Business Profile ID is missing!');
      }

      const documentData = {
        business_profile_id: businessProfile.id,
        business_plan_content: documents.businessPlan.content,
        business_plan_completed: documents.businessPlan.completed,
        financial_projection_content: documents.financialProjection.content,
        financial_projection_completed: documents.financialProjection.completed,
        value_proposition_content: documents.valueProposition.content,
        value_proposition_wants: documents.valueProposition.wants,
        value_proposition_fears: documents.valueProposition.fears,
        value_proposition_needs: documents.valueProposition.needs,
        value_proposition_completed: documents.valueProposition.completed,
        mou_content: documents.mou.content,
        mou_completed: documents.mou.completed,
        share_allocation_content: documents.shareAllocation.content,
        share_allocation_shares: parseFloat(documents.shareAllocation.shares) || null,
        share_allocation_share_price: parseFloat(documents.shareAllocation.sharePrice) || null,
        share_allocation_total_amount: parseFloat(documents.shareAllocation.totalAmount) || null,
        share_allocation_completed: documents.shareAllocation.completed,
        no_disclosure_enabled: noDisclosure,
        disclosure_notes: disclosureNotes,
        all_documents_completed:
          documents.businessPlan.completed &&
          documents.financialProjection.completed &&
          documents.valueProposition.completed &&
          documents.mou.completed &&
          documents.shareAllocation.completed,
        completed_at: (
          documents.businessPlan.completed &&
          documents.financialProjection.completed &&
          documents.valueProposition.completed &&
          documents.mou.completed &&
          documents.shareAllocation.completed
        ) ? new Date().toISOString() : null
      };

      console.log('💾 Saving documents to database...');
      console.log('Business Profile ID:', businessProfile.id);
      console.log('Document data being saved:', documentData);

      // Check if document exists - use regular select, not single()
      console.log('🔍 Checking if documents already exist...');
      const { data: existing, error: selectError } = await supabase
        .from('business_documents')
        .select('id')
        .eq('business_profile_id', businessProfile.id);

      if (selectError) {
        console.warn('Select error (may be normal if no records):', selectError);
      } else {
        console.log('✅ Query successful. Existing records:', existing?.length || 0);
      }

      let result;
      if (existing && existing.length > 0) {
        console.log('📝 Updating existing document...');
        // Update
        const updateResult = await supabase
          .from('business_documents')
          .update(documentData)
          .eq('business_profile_id', businessProfile.id)
          .select();
        result = updateResult;
        if (updateResult.error) {
          console.error('❌ Update failed:', updateResult.error);
        } else {
          console.log('✅ Update successful:', updateResult.data);
        }
      } else {
        console.log('✨ Creating new document...');
        // Insert
        const insertResult = await supabase
          .from('business_documents')
          .insert([documentData])
          .select();
        result = insertResult;
        if (insertResult.error) {
          console.error('❌ Insert failed:', insertResult.error);
        } else {
          console.log('✅ Insert successful:', insertResult.data);
        }
      }

      if (result?.error) {
        console.error('❌ Save error:', result.error);
        console.error('Error message:', result.error.message);
        console.error('Error code:', result.error.code);
        throw result.error;
      }

      console.log('✅ Documents saved successfully to database!', result?.data);
      setSaveStatus('✅ Saved successfully! Documents stored in database.');
      setTimeout(() => setSaveStatus(''), 3000);

      if (onDocumentsComplete) {
        onDocumentsComplete(documentData);
      }

      return { success: true, data: documentData };
    } catch (error) {
      console.error('❌ Error saving documents:', error);
      setSaveStatus('❌ ERROR: ' + (error.message || 'Failed to save documents to database'));
      return { success: false, error: error.message || 'Failed to save documents to database' };
    } finally {
      setLoading(false);
    }
  };

  // Exposed so parent flows (PitchDetailsForm, PitchVideoRecorder) can force
  // a real database save before letting a pitch publish — completion in this
  // component's local state alone doesn't persist anything.
  useImperativeHandle(ref, () => ({
    saveDocuments,
    getDocumentData: () => ({ businessPlan: documents.businessPlan.content + liveText('businessPlan'), financials: documents.financialProjection.content + liveText('financialProjection'), wants: documents.valueProposition.wants + liveText('valueProposition', 'wants'), fears: documents.valueProposition.fears + liveText('valueProposition', 'fears'), needs: documents.valueProposition.needs + liveText('valueProposition', 'needs'), shares: documents.shareAllocation.shares, sharePrice: documents.shareAllocation.sharePrice, totalAmount: documents.shareAllocation.totalAmount, noDisclosure }),
    isAllComplete: () =>
      documents.businessPlan.completed &&
      documents.financialProjection.completed &&
      documents.valueProposition.completed &&
      documents.mou.completed &&
      documents.shareAllocation.completed
  }));

  const completedCount = [
    documents.businessPlan.completed,
    documents.financialProjection.completed,
    documents.valueProposition.completed,
    documents.mou.completed,
    documents.shareAllocation.completed
  ].filter(Boolean).length;

  const progressPercent = (completedCount / 5) * 100;

  return (
    <div className="bpd space-y-4">
          <style>{BPD_STYLES + LIVE_CSS}</style>
          {/* Progress Bar */}
          <div className="bpd-hero rounded-2xl p-5 shadow-sm">
            <div className="flex items-center gap-4">
              <div className="relative w-16 h-16 shrink-0">
                <svg viewBox="0 0 36 36" className="w-16 h-16 -rotate-90">
                  <circle cx="18" cy="18" r="15.5" fill="none" stroke="var(--bpd-track)" strokeWidth="3" />
                  <circle
                    cx="18" cy="18" r="15.5" fill="none" stroke={STEP_COLORS[Math.min(completedCount, 4)]} strokeWidth="3" strokeLinecap="round"
                    strokeDasharray={`${(progressPercent / 100) * 97.4} 97.4`}
                    style={{ transition: 'stroke-dasharray .5s ease, stroke .5s' }}
                  />
                </svg>
                <span className="absolute inset-0 flex items-center justify-center text-sm font-bold bpd-text">
                  {Math.round(progressPercent)}%
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold bpd-text leading-tight">
                  {completedCount === 5 ? 'Your plan is ready to publish 🎉' : 'Complete your plan'}
                </h3>
                <p className="text-sm bpd-muted mt-0.5">{completedCount} of 5 sections done</p>
              </div>
            </div>
            <div className="flex gap-1.5 mt-4">
              {[documents.businessPlan, documents.financialProjection, documents.valueProposition, documents.mou, documents.shareAllocation].map((d, i) => (
                <div key={i} className={`bpd-seg h-1.5 flex-1 rounded-full ${d.completed ? 'on' : ''}`} style={{ '--c': STEP_COLORS[i] }} />
              ))}
            </div>
          </div>

          <LivePanel liveData={liveData} />

          {/* Document Sections */}

          {/* 1. Business Plan */}
          <DocumentSection
            title="Business Plan"
            description="Your strategic foundation and business model"
            icon={<FileText className="w-5 h-5" />}
            step={1}
            isExpanded={expandedSections.businessPlan}
            onToggle={() => toggleSection('businessPlan')}
            isCompleted={documents.businessPlan.completed}
            onToggleComplete={() => markComplete('businessPlan')}
          >
            {liveData && <LiveToggle rows={liveRefs.refs.businessPlan} stamp={liveRefs.stamp} on={autoSync.businessPlan} onChange={(v) => setAutoSync((p) => ({ ...p, businessPlan: v }))} />}
            <textarea
              value={documents.businessPlan.content}
              onChange={(e) => handleContentChange('businessPlan', e.target.value)}
              placeholder="Enter your business plan or paste content..."
              className="w-full h-40 p-4 bpd-input rounded-xl  resize-none"
            />
            <FileUploadBox
              label="Or upload file"
              onChange={(file) => handleFileUpload('businessPlan', file)}
            />
          </DocumentSection>

          {/* 2. Financial Projection */}
          <DocumentSection
            title="Financial Projection"
            description="Revenue and expense estimates"
            icon={<DollarSign className="w-5 h-5" />}
            step={2}
            isExpanded={expandedSections.financialProjection}
            onToggle={() => toggleSection('financialProjection')}
            isCompleted={documents.financialProjection.completed}
            onToggleComplete={() => markComplete('financialProjection')}
          >
            {liveData && <LiveToggle rows={liveRefs.refs.financialProjection} stamp={liveRefs.stamp} on={autoSync.financialProjection} onChange={(v) => setAutoSync((p) => ({ ...p, financialProjection: v }))} />}
            <textarea
              value={documents.financialProjection.content}
              onChange={(e) => handleContentChange('financialProjection', e.target.value)}
              placeholder="Enter financial projections, growth estimates, revenue models..."
              className="w-full h-40 p-4 bpd-input rounded-xl  resize-none"
            />
            <FileUploadBox
              label="Or upload spreadsheet/document"
              onChange={(file) => handleFileUpload('financialProjection', file)}
            />
          </DocumentSection>

          {/* 3. Value Proposition */}
          <DocumentSection
            title="Value Proposition"
            description="What you offer: Wants, Fears, and Needs"
            icon={<AlertCircle className="w-5 h-5" />}
            step={3}
            isExpanded={expandedSections.valueProposition}
            onToggle={() => toggleSection('valueProposition')}
            isCompleted={documents.valueProposition.completed}
            onToggleComplete={() => markComplete('valueProposition')}
          >
            {liveData && <LiveToggle rows={liveRefs.refs.valueProposition} stamp={liveRefs.stamp} on={autoSync.valueProposition} onChange={(v) => setAutoSync((p) => ({ ...p, valueProposition: v }))} />}
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium bpd-text mb-2">
                  Wants (What customers want)
                </label>
                <textarea
                  value={documents.valueProposition.wants}
                  onChange={(e) => handleContentChange('valueProposition', e.target.value, 'wants')}
                  placeholder="List customer desires and aspirations..."
                  className="w-full h-24 p-3 bpd-input rounded-xl  resize-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium bpd-text mb-2">
                  Fears (Customer concerns)
                </label>
                <textarea
                  value={documents.valueProposition.fears}
                  onChange={(e) => handleContentChange('valueProposition', e.target.value, 'fears')}
                  placeholder="What are customer pain points and concerns?..."
                  className="w-full h-24 p-3 bpd-input rounded-xl  resize-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium bpd-text mb-2">
                  Needs (Essential requirements)
                </label>
                <textarea
                  value={documents.valueProposition.needs}
                  onChange={(e) => handleContentChange('valueProposition', e.target.value, 'needs')}
                  placeholder="What do customers absolutely need?..."
                  className="w-full h-24 p-3 bpd-input rounded-xl  resize-none"
                />
              </div>

              <FileUploadBox
                label="Or upload document"
                onChange={(file) => handleFileUpload('valueProposition', file)}
              />
            </div>
          </DocumentSection>

          {/* 4. Memorandum of Understanding (MoU) */}
          <DocumentSection
            title="Memorandum of Understanding"
            description="Legal and collaborative agreements"
            icon={<FileText className="w-5 h-5" />}
            step={4}
            isExpanded={expandedSections.mou}
            onToggle={() => toggleSection('mou')}
            isCompleted={documents.mou.completed}
            onToggleComplete={() => markComplete('mou')}
          >
            {liveData && <LiveToggle rows={liveRefs.refs.mou} stamp={liveRefs.stamp} on={autoSync.mou} onChange={(v) => setAutoSync((p) => ({ ...p, mou: v }))} />}
            <textarea
              value={documents.mou.content}
              onChange={(e) => handleContentChange('mou', e.target.value)}
              placeholder="Enter MoU terms, agreements, and collaboration details..."
              className="w-full h-40 p-4 bpd-input rounded-xl  resize-none"
            />
            <FileUploadBox
              label="Or upload MoU document"
              onChange={(file) => handleFileUpload('mou', file)}
            />
          </DocumentSection>

          {/* 5. Share Allocation */}
          <DocumentSection
            title="Share Allocation"
            description="Ownership structure and equity distribution"
            icon={<DollarSign className="w-5 h-5" />}
            step={5}
            isExpanded={expandedSections.shareAllocation}
            onToggle={() => toggleSection('shareAllocation')}
            isCompleted={documents.shareAllocation.completed}
            onToggleComplete={() => markComplete('shareAllocation')}
          >
            {liveData && <LiveToggle rows={liveRefs.refs.shareAllocation} stamp={liveRefs.stamp} on={autoSync.shareAllocation} onChange={(v) => setAutoSync((p) => ({ ...p, shareAllocation: v }))} />}
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium bpd-text mb-2">
                    Number of Shares
                  </label>
                  <input
                    type="number"
                    value={documents.shareAllocation.shares}
                    onChange={(e) => {
                      handleContentChange('shareAllocation', e.target.value, 'shares');
                      calculateShareAllocation(e.target.value, documents.shareAllocation.sharePrice);
                    }}
                    placeholder="e.g., 1000"
                    className="w-full px-4 py-2 bpd-input rounded-xl "
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium bpd-text mb-2">
                    Share Price ({liveData ? 'UGX' : '$'})
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={documents.shareAllocation.sharePrice}
                    onChange={(e) => {
                      handleContentChange('shareAllocation', e.target.value, 'sharePrice');
                      calculateShareAllocation(documents.shareAllocation.shares, e.target.value);
                    }}
                    placeholder="e.g., 1000000"
                    className="w-full px-4 py-2 bpd-input rounded-xl "
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium bpd-text mb-2">
                    Total Valuation
                  </label>
                  <div className="w-full px-4 py-2 bpd-total rounded-xl font-bold text-lg">
                    ${documents.shareAllocation.totalAmount || '0'}
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium bpd-text mb-2">
                  Additional Notes
                </label>
                <textarea
                  value={documents.shareAllocation.content}
                  onChange={(e) => handleContentChange('shareAllocation', e.target.value)}
                  placeholder="Enter share allocation details, vesting schedules, etc..."
                  className="w-full h-24 p-3 bpd-input rounded-xl  resize-none"
                />
              </div>

              <FileUploadBox
                label="Or upload share allocation document"
                onChange={(file) => handleFileUpload('shareAllocation', file)}
              />
            </div>
          </DocumentSection>

          {/* Privacy & No Disclosure */}
          <div className="bpd-card rounded-2xl p-4">
            <div className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={noDisclosure}
                onChange={(e) => setNoDisclosure(e.target.checked)}
                className="mt-1 w-4 h-4 rounded cursor-pointer"
              />
              <div className="flex-1">
                <label className="block font-semibold bpd-text mb-2 cursor-pointer flex items-center gap-2">
                  <Lock className="w-4 h-4 bpd-muted" />
                  No Disclosure - Privacy Boundary
                </label>
                <p className="text-sm bpd-muted mb-3">
                  Apply privacy restrictions to sensitive business information
                </p>
                <textarea
                  value={disclosureNotes}
                  onChange={(e) => setDisclosureNotes(e.target.value)}
                  placeholder="Add any privacy notes or restrictions..."
                  className="w-full h-24 p-3 bpd-input rounded-xl  resize-none"
                />
              </div>
            </div>
          </div>

          {/* Save Status */}
          {saveStatus && (
            <div className={`p-3 rounded-lg text-sm font-medium flex items-center gap-2 ${
              saveStatus.includes('✅')
                ? 'bpd-ok'
                : saveStatus.includes('❌')
                ? 'bpd-err'
                : 'bpd-info'
            }`}>
              {saveStatus.includes('Saving') && <div className="animate-spin">⟳</div>}
              {saveStatus}
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex flex-col-reverse sm:flex-row gap-3 sm:justify-end">
            <button
              onClick={onCancel}
              className="bpd-ghost px-6 py-3 rounded-xl font-medium"
            >
              Back
            </button>
            {!hideSkip && <button
              onClick={() => {
                // Allow skipping documents for now - they can be filled later
                console.log('⏭️ Skipping documents step - can complete later');
                if (onDocumentsComplete) {
                  onDocumentsComplete(true); // Force completion to proceed
                }
              }}
              className="px-6 py-3 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-medium transition"
            >
              ⏭️ Skip Documents (for now)
            </button>}
            <button
              onClick={saveDocuments}
              disabled={loading}
              className="bpd-main px-6 py-3 rounded-xl font-medium disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading ? 'Saving…' : 'Save draft'}
            </button>
          </div>
        </div>
      );
});

// Document Section Component
const DocumentSection = ({
  title,
  description,
  icon,
  step,
  isExpanded,
  onToggle,
  isCompleted,
  onToggleComplete,
  children
}) => {
  const accent = STEP_COLORS[(step || 1) - 1];
  return (
    <div className={`bpd-card rounded-2xl overflow-hidden ${isExpanded ? 'open' : ''}`} style={{ '--accent': accent }}>
      <button
        type="button"
        onClick={onToggle}
        className="w-full px-4 py-4 flex items-center gap-3 text-left"
        aria-expanded={isExpanded}
      >
        <span className={`bpd-bubble w-9 h-9 shrink-0 rounded-full flex items-center justify-center text-sm font-bold ${isCompleted ? 'done' : isExpanded ? 'active' : ''}`}>
          {isCompleted ? <Check className="w-4 h-4" /> : step}
        </span>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold bpd-text leading-tight">{title}</h3>
          <p className="text-xs bpd-muted mt-0.5">{description}</p>
        </div>
        <span className={`bpd-chip hidden sm:inline text-[11px] font-medium px-2 py-0.5 rounded-full ${isCompleted ? 'done' : ''}`}>
          {isCompleted ? 'Done' : 'To do'}
        </span>
        {isExpanded ? <ChevronUp className="w-5 h-5 bpd-muted shrink-0" /> : <ChevronDown className="w-5 h-5 bpd-muted shrink-0" />}
      </button>

      {isExpanded && (
        <div className="bpd-body px-4 pb-4 space-y-4">
          <div className="pt-4 space-y-4" style={{ borderTop: '1px solid var(--bpd-border)' }}>{children}</div>
          <button
            type="button"
            onClick={onToggleComplete}
            className={`bpd-cta ${isCompleted ? 'done' : ''} w-full py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2`}
          >
            <Check className="w-4 h-4" />
            {isCompleted ? 'Marked as done — tap to undo' : 'Mark this section as done'}
          </button>
        </div>
      )}
    </div>
  );
};

const LivePanel = ({ liveData }) => {
  if (!liveData) return null;
  const { loading, updatedAt, refresh } = liveData;
  return (
    <div className="bpd-live rounded-xl px-3 py-2 flex items-center gap-2">
      <span className="bpd-dot" />
      <p className="text-xs bpd-text flex-1 min-w-0 truncate">
        Figures below are checked against your live records
        {updatedAt ? ` · ${updatedAt.toLocaleTimeString('en-GB')}` : loading ? ' · loading…' : ''}
      </p>
      <button type="button" onClick={refresh} className="bpd-ghost text-[11px] px-2 py-0.5 rounded-lg shrink-0">Refresh</button>
    </div>
  );
};

const LiveToggle = ({ on, onChange, rows = [], stamp = '' }) => (
  <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--bpd-border)' }}>
    <div className="flex items-center gap-2 px-3 py-2" style={{ background: 'var(--bpd-surface-2)' }}>
      {on && <span className="bpd-dot" />}
      <p className="text-xs font-semibold bpd-text flex-1 min-w-0 truncate">
        Live reference{stamp && on ? <span className="bpd-muted font-normal"> · {stamp.split(', ').pop()}</span> : null}
      </p>
      <button
        type="button" role="switch" aria-checked={on} aria-label="Live reference"
        onClick={() => onChange(!on)}
        className={`bpd-switch ${on ? 'on' : ''}`}
      >
        <i />
      </button>
    </div>
    {on && rows.length > 0 && (
      <dl className="px-3 py-1">
        {rows.map((r, i) => (
          <div key={i} className="bpd-row flex items-baseline justify-between gap-3 py-1.5">
            <dt className="text-xs bpd-muted shrink-0">{r.label}</dt>
            <dd className="text-xs font-semibold bpd-text text-right break-words min-w-0">{r.value}</dd>
          </div>
        ))}
      </dl>
    )}
  </div>
);

// File Upload Box Component
const FileUploadBox = ({ label, onChange }) => {
  const [isDragging, setIsDragging] = useState(false);

  const handleDrag = (e) => {
    e.preventDefault();
    setIsDragging(e.type === 'dragenter' || e.type === 'dragover');
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) onChange(file);
  };

  return (
    <div
      onDragEnter={handleDrag}
      onDragOver={handleDrag}
      onDragLeave={handleDrag}
      onDrop={handleDrop}
      className={`bpd-drop rounded-xl p-4 text-center cursor-pointer ${isDragging ? 'drag' : ''}`}
    >
      <label className="flex flex-col items-center gap-2 cursor-pointer">
        <Upload className="w-5 h-5 bpd-muted" />
        <span className="text-sm bpd-muted">
          {label} or <span className="font-medium" style={{ color: "var(--accent, #6366f1)" }}>click to browse</span>
        </span>
        <input
          type="file"
          onChange={(e) => {
            if (e.target.files?.[0]) {
              onChange(e.target.files[0]);
            }
          }}
          className="hidden"
        />
      </label>
    </div>
  );
};

BusinessProfileDocuments.displayName = 'BusinessProfileDocuments';

export default BusinessProfileDocuments;
