import React, { useEffect, useState } from 'react';
import { X, Clock, CheckCircle, RotateCcw, ChevronRight, Loader, Download } from 'lucide-react';
import { downloadInvestmentAgreementPdf } from '../services/investmentAgreementPdf';
import { getSupabase } from '../services/pitchingService';

// Every investment the signed-in user has paid for, newest first, with its
// live status. Tapping one opens InvestmentProgressView (via onSelect) for the
// shareholder-approval progress and, once sealed, the MOU download.
const STATUS = {
  signing: { label: 'Awaiting approval', cls: 'bg-yellow-500/15 text-yellow-300 border-yellow-500/40', Icon: Clock },
  sealed: { label: 'Sealed', cls: 'bg-green-500/15 text-green-300 border-green-500/40', Icon: CheckCircle },
  expired: { label: 'Refunded', cls: 'bg-red-500/15 text-red-300 border-red-500/40', Icon: RotateCcw },
  cancelled: { label: 'Cancelled', cls: 'bg-slate-500/15 text-slate-300 border-slate-500/40', Icon: RotateCcw },
};

const timeLeft = (deadline) => {
  if (!deadline) return null;
  const ms = new Date(deadline).getTime() - Date.now();
  if (ms <= 0) return 'Deadline passed';
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  return `${d}d ${h}h left`;
};

const MyInvestmentsList = ({ currentUser, onClose, onSelect }) => {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('mine');
  const [received, setReceived] = useState([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = getSupabase();
        supabase.rpc('fn_get_business_investments').then(({ data, error: rErr }) => {
          if (!cancelled && !rErr) setReceived(data || []);
        });
        const { data: agreements, error: agErr } = await supabase
          .from('investment_agreements')
          .select('id, status, pitch_id, business_profile_id, investment_type, shares_amount, total_investment, escrow_id, approval_deadline, created_at, sealed_at')
          .eq('investor_id', currentUser.id)
          .order('created_at', { ascending: false });
        if (agErr) throw agErr;

        const pitchIds = [...new Set((agreements || []).map((a) => a.pitch_id).filter(Boolean))];
        let pitchMap = {};
        if (pitchIds.length) {
          const { data: pitches } = await supabase
            .from('pitches')
            .select('*, business_profiles(business_name)')
            .in('id', pitchIds);
          pitchMap = Object.fromEntries((pitches || []).map((p) => [p.id, p]));
        }
        if (!cancelled) setRows((agreements || []).map((a) => ({ agreement: a, pitch: pitchMap[a.pitch_id] || { id: a.pitch_id } })));
      } catch (err) {
        if (!cancelled) setError(err?.message || 'Could not load your investments');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [currentUser?.id]);

  // A business owner who has never invested themselves lands on what they received.
  useEffect(() => {
    if (!loading && rows.length === 0 && received.length > 0) setTab('received');
  }, [loading, rows.length, received.length]);

  const active = rows.filter((r) => r.agreement.status === 'signing' || r.agreement.status === 'sealed');
  const totalInvested = active.reduce((sum, r) => sum + (parseFloat(r.agreement.total_investment) || 0), 0);

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg max-h-[90vh] flex flex-col relative">
        <div className="p-5 pb-3 border-b border-slate-800">
          <button onClick={onClose} className="absolute top-4 right-4 text-slate-400 hover:text-white transition" aria-label="Close">
            <X className="w-6 h-6" />
          </button>
          <h2 className="text-xl font-bold text-white">Investments</h2>
          {received.length > 0 && (
            <div className="flex gap-1 mt-3 bg-slate-800 rounded-lg p-1 text-xs font-semibold">
              {[['mine', 'I invested'], ['received', `Received (${received.length})`]].map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => setTab(k)}
                  className={`flex-1 py-1.5 rounded-md transition ${tab === k ? 'bg-slate-600 text-white' : 'text-slate-400 hover:text-white'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          {tab === 'mine' && !loading && active.length > 0 && (
            <p className="text-sm text-slate-400 mt-1">
              {active.length} active · {totalInvested.toFixed(2)} IcanEra committed
            </p>
          )}
        </div>

        <div className="overflow-y-auto p-4 space-y-3">
          {tab === 'received' ? (
            received.map((r) => {
              const s = STATUS[r.status] || STATUS.signing;
              const pct = r.status === 'sealed' ? 100 : r.total_shareholders > 0 ? Math.min(100, (r.signed_count / r.total_shareholders) * 100) : 0;
              const remaining = r.status === 'signing' ? timeLeft(r.approval_deadline) : null;
              return (
                <div key={r.agreement_id} className="bg-slate-800 border border-slate-700 rounded-xl p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-white font-semibold truncate">{r.investor_name}</p>
                      <p className="text-xs text-slate-400 truncate">invested in {r.business_name}{r.pitch_title ? ` · ${r.pitch_title}` : ''}</p>
                    </div>
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border flex-shrink-0 ${s.cls}`}>
                      <s.Icon className="w-3 h-3" /> {s.label}
                    </span>
                  </div>
                  <p className="text-lg font-bold text-slate-100 mt-3">{(parseFloat(r.total_investment) || 0).toFixed(2)} <span className="text-xs font-semibold text-slate-400">IcanEra</span></p>
                  <div className="w-full h-2 bg-slate-700 rounded-full overflow-hidden mt-2">
                    <div className={`h-full ${r.status === 'sealed' ? 'bg-green-500' : 'bg-yellow-500'}`} style={{ width: `${pct}%` }} />
                  </div>
                  <div className="flex justify-between mt-1 text-xs text-slate-500">
                    <span>{r.signed_count} of {r.total_shareholders} shareholders approved</span>
                    {remaining && <span className="text-yellow-400 font-semibold">⏳ {remaining}</span>}
                  </div>
                  <button
                    onClick={() => downloadInvestmentAgreementPdf({
                      businessName: r.business_name, pitchTitle: r.pitch_title, investorName: r.investor_name,
                      investmentType: r.investment_type, shares: parseFloat(r.shares_amount) || 0, sharePrice: r.share_price,
                      totalInvestment: r.total_investment, status: r.status, reference: r.escrow_id,
                      createdAt: r.created_at, sealedAt: r.sealed_at, signedCount: r.signed_count,
                      totalShareholders: r.total_shareholders, mouContent: r.mou_content,
                    })}
                    className="w-full mt-3 flex items-center justify-center gap-2 bg-gradient-to-br from-purple-600 to-purple-700 hover:from-purple-500 hover:to-purple-600 text-white text-sm font-bold py-2.5 rounded-lg transition"
                  >
                    <Download className="w-4 h-4" /> {r.status === 'sealed' ? 'Download agreement (PDF)' : 'Download draft agreement'}
                  </button>
                </div>
              );
            })
          ) : loading ? (
            <div className="flex justify-center py-10 text-slate-400"><Loader className="w-6 h-6 animate-spin" /></div>
          ) : error ? (
            <p className="text-red-300 text-sm text-center py-8">{error}</p>
          ) : rows.length === 0 ? (
            <p className="text-slate-400 text-sm text-center py-10">You haven't invested in any pitch yet.</p>
          ) : (
            rows.map(({ agreement, pitch }) => {
              const s = STATUS[agreement.status] || STATUS.signing;
              const remaining = agreement.status === 'signing' ? timeLeft(agreement.approval_deadline) : null;
              return (
                <button
                  key={agreement.id}
                  onClick={() => onSelect({ pitch, agreement })}
                  className="w-full text-left bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl p-4 transition"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-white font-semibold truncate">{pitch.business_profiles?.business_name || pitch.title || 'Investment'}</p>
                      {pitch.title && pitch.business_profiles?.business_name && (
                        <p className="text-xs text-slate-400 truncate">{pitch.title}</p>
                      )}
                    </div>
                    <ChevronRight className="w-5 h-5 text-slate-500 flex-shrink-0" />
                  </div>
                  <div className="flex items-center justify-between mt-3 text-sm">
                    <span className="text-slate-200 font-bold">{(parseFloat(agreement.total_investment) || 0).toFixed(2)} IcanEra</span>
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border ${s.cls}`}>
                      <s.Icon className="w-3 h-3" /> {s.label}
                    </span>
                  </div>
                  <div className="flex justify-between mt-2 text-xs text-slate-500">
                    <span>
                      {agreement.shares_amount > 0 ? `${agreement.shares_amount} shares` : agreement.investment_type === 'guarantor' ? 'Guarantee' : 'Partnership'}
                      {' · '}{new Date(agreement.created_at).toLocaleDateString()}
                    </span>
                    {remaining && <span className="text-yellow-400 font-semibold">⏳ {remaining}</span>}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

export default MyInvestmentsList;
