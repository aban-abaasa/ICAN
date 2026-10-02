import React, { useEffect, useRef, useState } from 'react';
import { downloadInvestmentAgreementPdf } from '../services/investmentAgreementPdf';
import { Clock, FileText, Download, CheckCircle, XCircle, ChevronDown, ChevronUp, Loader } from 'lucide-react';
import { getSupabase } from '../services/pitchingService';

const money = (currency, value) => `${currency || ''} ${Number(value || 0).toLocaleString()}`.trim();

const timeLeft = (deadline) => {
  if (!deadline) return null;
  const ms = new Date(deadline).getTime() - Date.now();
  if (ms <= 0) return 'Deadline passed';
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  return d > 0 ? `${d}d ${h}h left` : `${h}h left`;
};

// Progress is always measured against REAL registered members (people with an
// account who can actually approve), never expected/unregistered owners.
const ProgressBar = ({ signed, total, percent, sealed }) => (
  <div className="bg-slate-900/60 border border-slate-700 rounded-lg p-3">
    <div className="flex justify-between text-sm text-slate-300 mb-2">
      <span>{signed} of {total} registered {total === 1 ? 'member' : 'members'} approved</span>
      <span className="font-bold text-white">{Math.round(sealed ? 100 : percent)}%</span>
    </div>
    <div className="relative w-full h-2.5 bg-slate-700 rounded-full overflow-hidden">
      <div
        className={`h-full transition-all ${sealed ? 'bg-green-500' : 'bg-amber-500'}`}
        style={{ width: `${Math.min(100, sealed ? 100 : percent)}%` }}
      />
      <div className="absolute top-0 bottom-0 w-px bg-white/60" style={{ left: '60%' }} title="60% needed" />
    </div>
    <p className="text-[11px] text-slate-500 mt-1.5">60% of registered members must approve to release the funds.</p>
  </div>
);

const ShareholderPendingSignatures = ({ onApprovalComplete, focusId = null }) => {
  const [requests, setRequests] = useState([]);
  const [activeTab, setActiveTab] = useState('pending');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [expanded, setExpanded] = useState({});
  const [confirmDecline, setConfirmDecline] = useState(null);
  const [banner, setBanner] = useState(null);
  const focusRef = useRef(null);
  const didFocus = useRef(false);

  const pending = requests.filter((r) => !r.decided);
  const sealed = requests.filter((r) => r.my_decision === 'approved' && r.agreement_status === 'sealed');
  const history = requests.filter((r) => r.decided && !(r.my_decision === 'approved' && r.agreement_status === 'sealed'));

  useEffect(() => {
    load(true);
    const interval = setInterval(() => load(false), 8000);
    return () => clearInterval(interval);
  }, []);

  // Opened straight from a notification: scroll to that request and expand it.
  useEffect(() => {
    if (!focusId || didFocus.current || requests.length === 0) return;
    const target = requests.find((r) => r.notification_id === focusId);
    if (!target) return;
    didFocus.current = true;
    setActiveTab(target.decided ? (target.agreement_status === 'sealed' ? 'sealed' : 'history') : 'pending');
    setExpanded((prev) => ({ ...prev, [focusId]: true }));
    setTimeout(() => focusRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 150);
  }, [focusId, requests]);

  const load = async (initial = false) => {
    try {
      if (initial) setLoading(true);
      const supabase = getSupabase();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setError('Please sign in to see your approvals.');
        return;
      }
      setCurrentUser(user);
      const { data, error: rpcError } = await supabase.rpc('fn_get_my_approval_requests');
      if (rpcError) throw rpcError;
      setRequests(data || []);
      setError(null);
    } catch (err) {
      console.error('Error loading approvals:', err);
      setError(err?.message || 'Could not load your approvals');
    } finally {
      setLoading(false);
    }
  };

  const decide = async (request, approve) => {
    try {
      setBusyId(request.notification_id);
      setBanner(null);
      const supabase = getSupabase();
      const { data, error: rpcError } = await supabase.rpc('fn_shareholder_decide_investment', {
        p_notification_id: request.notification_id,
        p_approve: approve,
        p_reason: approve ? null : 'Declined by shareholder',
        // Where the signature was made (device time zone, no permission needed)
        p_location: (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch { return null; } })(),
      });
      if (rpcError) throw rpcError;
      const r = Array.isArray(data) ? data[0] : data;

      if (!approve) {
        setBanner({ kind: 'info', text: 'Your decision to decline has been recorded.' });
      } else if (r?.sealed) {
        setBanner({ kind: 'success', text: `Approved. ${r.signed_count} of ${r.total_members} members have approved, so the agreement is sealed and the funds are released. Its MOU is now under Sealed.` });
        setActiveTab('sealed');
      } else {
        const need = Math.max(0, Math.ceil((r?.total_members || 0) * 0.6) - (r?.signed_count || 0));
        setBanner({ kind: 'success', text: `Approved. ${r?.signed_count ?? 0} of ${r?.total_members ?? 0} members have approved${need > 0 ? `, ${need} more needed.` : '.'}` });
      }

      setConfirmDecline(null);
      await load(false);
      if (onApprovalComplete) onApprovalComplete();
    } catch (err) {
      console.error('Error recording decision:', err);
      setBanner({ kind: 'error', text: err?.message || 'Could not record your decision. Please try again.' });
    } finally {
      setBusyId(null);
    }
  };

  const downloadMou = async (request) => {
    try {
      const supabase = getSupabase();
      const { data: docs } = await supabase
        .from('business_documents')
        .select('mou_content')
        .eq('business_profile_id', request.business_profile_id)
        .maybeSingle();

      // Same sealed certificate everyone else gets: real signature list,
      // SEALED stamp and verification QR.
      await downloadInvestmentAgreementPdf({
        agreementId: request.agreement_id,
        businessName: request.business_name,
        pitchTitle: null,
        investorName: request.investor_name || request.investor_email,
        investmentType: Number(request.investment_shares) > 0 ? 'equity' : 'partnership',
        shares: Number(request.investment_shares) || 0,
        totalInvestment: request.investment_amount,
        status: request.agreement_status,
        createdAt: request.created_at,
        signedCount: request.signed_count,
        totalShareholders: request.total_members,
        mouContent: docs?.mou_content || request.notification_message,
      });
    } catch (err) {
      console.error('Error downloading MOU:', err);
      setBanner({ kind: 'error', text: 'Could not download the MOU: ' + (err?.message || 'Unknown error') });
    }
  };

  const renderCard = (r, mode) => {
    const isOpen = !!expanded[r.notification_id];
    const isBusy = busyId === r.notification_id;
    const isSealed = r.agreement_status === 'sealed';
    const left = mode === 'pending' ? timeLeft(r.approval_deadline) : null;
    const isFocus = focusId === r.notification_id;

    return (
      <div
        key={r.notification_id}
        ref={isFocus ? focusRef : null}
        className={`bg-slate-800/70 border rounded-xl overflow-hidden ${
          isFocus ? 'border-amber-400 shadow-lg shadow-amber-500/10' : 'border-slate-700'
        }`}
      >
        <div className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-wide text-slate-400">Investment in</p>
              <h3 className="text-lg font-bold text-white truncate">{r.business_name || 'Business'}</h3>
              <p className="text-sm text-slate-400 truncate">
                From <span className="text-slate-200 font-medium">{r.investor_name || r.investor_email || 'Investor'}</span>
              </p>
            </div>
            <span
              className={`shrink-0 text-[11px] font-bold px-2.5 py-1 rounded-full border ${
                mode === 'pending'
                  ? 'bg-amber-500/15 text-amber-300 border-amber-500/40'
                  : r.my_decision === 'rejected'
                    ? 'bg-red-500/15 text-red-300 border-red-500/40'
                    : isSealed
                      ? 'bg-green-500/15 text-green-300 border-green-500/40'
                      : 'bg-blue-500/15 text-blue-300 border-blue-500/40'
              }`}
            >
              {mode === 'pending' ? 'Needs you' : r.my_decision === 'rejected' ? 'Declined' : isSealed ? 'Sealed' : 'You approved'}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3 mt-4">
            <div className="bg-slate-900/60 rounded-lg p-3">
              <p className="text-[11px] uppercase text-slate-400">Amount</p>
              <p className="text-white font-bold">{money(r.investment_currency, r.investment_amount)}</p>
            </div>
            <div className="bg-slate-900/60 rounded-lg p-3">
              <p className="text-[11px] uppercase text-slate-400">Shares</p>
              <p className="text-white font-bold">{r.investment_shares || 'N/A'}</p>
            </div>
          </div>

          <div className="mt-3">
            <ProgressBar signed={r.signed_count} total={r.total_members} percent={Number(r.percent || 0)} sealed={isSealed} />
            {left && <p className="text-xs text-amber-400 mt-2 font-semibold">{left} to reach 60%, or it is refunded.</p>}
          </div>

          <button
            onClick={() => setExpanded((p) => ({ ...p, [r.notification_id]: !isOpen }))}
            className="mt-3 flex items-center gap-1 text-xs font-semibold text-blue-400 hover:text-blue-300"
          >
            {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            {isOpen ? 'Hide details' : 'View details'}
          </button>

          {isOpen && (
            <div className="mt-3 text-sm text-slate-300 bg-slate-900/50 border border-slate-700 rounded-lg p-3 space-y-2">
              <p className="whitespace-pre-wrap leading-relaxed">{r.notification_message}</p>
              <p className="text-xs text-slate-500">Investor email: {r.investor_email || 'N/A'}</p>
              <p className="text-xs text-slate-500">Received: {new Date(r.created_at).toLocaleString()}</p>
            </div>
          )}
        </div>

        {mode === 'pending' && (
          <div className="border-t border-slate-700 bg-slate-900/40 p-3">
            {confirmDecline === r.notification_id ? (
              <div>
                <p className="text-sm text-slate-300 mb-2">Decline this investment? Your decision is recorded.</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setConfirmDecline(null)}
                    className="flex-1 py-3 rounded-lg bg-slate-700 hover:bg-slate-600 text-white font-semibold"
                  >
                    Keep it open
                  </button>
                  <button
                    onClick={() => decide(r, false)}
                    disabled={isBusy}
                    className="flex-1 py-3 rounded-lg bg-red-600 hover:bg-red-500 disabled:opacity-60 text-white font-semibold"
                  >
                    {isBusy ? 'Saving…' : 'Yes, decline'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2">
                <button
                  onClick={() => setConfirmDecline(r.notification_id)}
                  disabled={isBusy}
                  className="flex-1 py-3 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-700 font-semibold flex items-center justify-center gap-1.5"
                >
                  <XCircle className="w-4 h-4" /> Decline
                </button>
                <button
                  onClick={() => decide(r, true)}
                  disabled={isBusy}
                  className="flex-[2] py-3 rounded-lg bg-green-600 hover:bg-green-500 disabled:opacity-60 text-white font-bold flex items-center justify-center gap-1.5"
                >
                  {isBusy ? <Loader className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                  {isBusy ? 'Approving…' : 'Approve'}
                </button>
              </div>
            )}
          </div>
        )}

        {mode === 'sealed' && (
          <div className="border-t border-slate-700 bg-slate-900/40 p-3">
            <button
              onClick={() => downloadMou(r)}
              className="w-full flex items-center justify-center gap-2 bg-purple-600 hover:bg-purple-500 text-white font-bold py-3 rounded-lg transition"
            >
              <Download className="w-5 h-5" /> Download MOU (PDF)
            </button>
          </div>
        )}
      </div>
    );
  };

  const Empty = ({ icon: Icon, title, text }) => (
    <div className="bg-slate-800/60 border border-slate-700 text-slate-300 px-6 py-10 rounded-xl text-center">
      <Icon className="w-10 h-10 mx-auto mb-3 opacity-50" />
      <p className="font-semibold">{title}</p>
      <p className="text-sm text-slate-400 mt-1">{text}</p>
    </div>
  );

  if (loading) {
    return (
      <div className="w-full max-w-3xl mx-auto p-4">
        <div className="p-10 text-center bg-slate-800/60 border border-slate-700 rounded-xl">
          <Loader className="w-10 h-10 animate-spin mx-auto mb-3 text-blue-400" />
          <p className="text-slate-300 font-semibold">Loading your approvals…</p>
        </div>
      </div>
    );
  }

  const tabs = [
    ['pending', 'To approve', pending.length],
    ['sealed', 'Sealed', sealed.length],
    ['history', 'History', history.length],
  ];
  const list = activeTab === 'pending' ? pending : activeTab === 'sealed' ? sealed : history;

  return (
    <div className="w-full max-w-3xl mx-auto p-3 sm:p-4 pb-28 md:pb-4">
      <div className="mb-4">
        <h2 className="text-2xl font-bold text-white">Investment approvals</h2>
        <p className="text-sm text-slate-400">Approve or decline investments made in businesses you own shares in.</p>
      </div>

      <div className="flex gap-1 mb-4 border-b border-slate-700 overflow-x-auto">
        {tabs.map(([key, label, count]) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`px-4 py-2.5 text-sm font-semibold whitespace-nowrap border-b-2 transition ${
              activeTab === key ? 'text-white border-amber-500' : 'text-slate-400 border-transparent hover:text-slate-200'
            }`}
          >
            {label}
            {count > 0 && (
              <span className={`ml-2 text-xs font-bold px-1.5 py-0.5 rounded-full ${key === 'pending' ? 'bg-red-600 text-white' : 'bg-slate-700 text-slate-200'}`}>
                {count}
              </span>
            )}
          </button>
        ))}
      </div>

      {banner && (
        <div
          className={`mb-4 px-4 py-3 rounded-lg text-sm border flex justify-between gap-3 ${
            banner.kind === 'success'
              ? 'bg-green-500/10 border-green-500/40 text-green-300'
              : banner.kind === 'error'
                ? 'bg-red-500/10 border-red-500/40 text-red-300'
                : 'bg-slate-700/50 border-slate-600 text-slate-200'
          }`}
        >
          <span>{banner.text}</span>
          <button onClick={() => setBanner(null)} className="opacity-70 hover:opacity-100" aria-label="Dismiss">✕</button>
        </div>
      )}

      {error && (
        <div className="bg-red-500/10 border border-red-500/40 text-red-300 px-4 py-3 rounded-lg mb-4 text-sm">
          {error}
        </div>
      )}

      {list.length === 0 ? (
        activeTab === 'pending' ? (
          <Empty icon={CheckCircle} title="You're all caught up" text="No investments need your approval right now." />
        ) : activeTab === 'sealed' ? (
          <Empty icon={FileText} title="No sealed agreements yet" text="Once an investment reaches 60% approval its MOU can be downloaded here." />
        ) : (
          <Empty icon={Clock} title="Nothing here yet" text="Investments you declined or that are still waiting on others appear here." />
        )
      ) : (
        <div className="space-y-4">
          {list.map((r) => renderCard(r, activeTab))}
        </div>
      )}

      <p className="mt-6 text-xs text-slate-500 text-center">
        Signed in as <span className="text-slate-300">{currentUser?.email}</span>
      </p>
    </div>
  );
};

export default ShareholderPendingSignatures;
