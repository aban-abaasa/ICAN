import React, { useEffect, useState } from 'react';
import { CheckCircle2, Copy, ExternalLink, Lock, Mail, Plus, Share2, Wallet, X } from 'lucide-react';
import { supabase } from '../lib/supabase/client';
import cmmsServiceProviderContractsService from '../services/cmmsServiceProviderContractsService';
import { approveBusinessWalletTransaction, transferFromBusinessWallet, ugxToICAN } from '../services/icanWalletService';

/**
 * Lives inside the Tasks -> Assign tab (CMSSModule.jsx), gated by
 * hasToolAction('tasks', 'publish_contract') -- same tool the Assign form
 * above it uses, but a separate action so a role can assign internal tasks
 * without also being trusted to publish a public contract link (and its
 * payment records) to an outside contractor. See
 * backend/CMMS_SERVICE_PROVIDER_CONTRACTS.sql for the full data-isolation
 * story: this feature only ever touches its own three tables, never
 * payroll or inventory.
 *
 * Payments are real (backend/CMMS_SERVICE_PROVIDER_CONTRACT_REAL_PAYMENTS.
 * sql): cash is recorded here and the provider confirms receipt themselves
 * from their own contract link; wallet payments only unlock once the
 * provider has signed up/in and linked their own IcanEra Wallet from that
 * same link, then move through the exact same pitchin_business_wallet_
 * transfer() RPC (transferFromBusinessWallet) CMMSPayrollPanel.jsx already
 * uses to pay salary from this company's Pichin business wallet.
 */
const CMMSServiceProviderContractPanel = ({ companyId, currentUser, businessProfileId }) => {
  const [myCmmsUserId, setMyCmmsUserId] = useState(null);
  const [jobAssignments, setJobAssignments] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState(null);

  const [form, setForm] = useState({
    providerName: '', providerContact: '', title: '', scopeOfWork: '', rate: '', terms: '',
    validDays: 30, jobAssignmentId: '', accessMode: 'pin', pin: '', allowedEmail: '',
  });
  const [publishedLink, setPublishedLink] = useState(null);
  const [publishedTitle, setPublishedTitle] = useState('');

  const resetForm = () => setForm({
    providerName: '', providerContact: '', title: '', scopeOfWork: '', rate: '', terms: '',
    validDays: 30, jobAssignmentId: '', accessMode: 'pin', pin: '', allowedEmail: '',
  });

  const loadAll = async () => {
    if (!companyId) return;
    setLoading(true);
    const [contractsResult, assignmentsResult] = await Promise.all([
      cmmsServiceProviderContractsService.getServiceProviderContractsForCompany(companyId),
      supabase.from('cmms_job_assignments').select('id, job_title').eq('company_id', companyId).order('created_at', { ascending: false }).limit(100),
    ]);
    setContracts(contractsResult.success ? contractsResult.data : []);
    setJobAssignments(assignmentsResult.data || []);
    setLoading(false);
  };

  useEffect(() => {
    const resolveMyCmmsUserId = async () => {
      if (!companyId || !currentUser?.email) return;
      const { data } = await supabase
        .from('cmms_users')
        .select('id')
        .eq('cmms_company_id', companyId)
        .ilike('email', currentUser.email)
        .maybeSingle();
      setMyCmmsUserId(data?.id || null);
    };
    resolveMyCmmsUserId();
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, currentUser?.email]);

  const handlePublish = async () => {
    if (!form.providerName.trim() || !form.title.trim()) return;
    if (form.accessMode === 'pin' && form.pin.trim().length < 4) { setError('PIN must be at least 4 characters.'); return; }
    if (form.accessMode === 'email' && !form.allowedEmail.trim()) { setError('Enter the email allowed to open this contract.'); return; }
    setSaving(true);
    setError('');
    const published = await cmmsServiceProviderContractsService.publishServiceProviderContract(companyId, {
      providerName: form.providerName,
      providerContact: form.providerContact,
      title: form.title,
      jobAssignmentId: form.jobAssignmentId || null,
      content: { scope_of_work: form.scopeOfWork, rate: form.rate, terms: form.terms },
      accessMode: form.accessMode,
      pin: form.pin,
      allowedEmail: form.allowedEmail,
      validDays: Number(form.validDays) || 30,
    });
    setSaving(false);
    if (!published.success) { setError(published.error); return; }

    setPublishedLink(cmmsServiceProviderContractsService.buildServiceProviderContractUrl(published.data.access_token));
    setPublishedTitle(form.title);
    resetForm();
    await loadAll();
  };

  const handleCopyLink = (accessToken) => {
    navigator.clipboard?.writeText(cmmsServiceProviderContractsService.buildServiceProviderContractUrl(accessToken));
  };

  const handleShareLink = async (link, title) => {
    if (navigator.share) {
      try { await navigator.share({ title, url: link }); return; } catch { /* user cancelled */ return; }
    }
    navigator.clipboard?.writeText(link);
  };

  const handleRevoke = async (contractId) => {
    if (!window.confirm('Revoke this contract? The provider link will stop working immediately.')) return;
    await cmmsServiceProviderContractsService.revokeServiceProviderContract(contractId);
    await loadAll();
  };

  const handleExtend = async (contract) => {
    const days = window.prompt('Extend access by how many days from today?', '30');
    if (!days || Number.isNaN(Number(days))) return;
    const newValidUntil = new Date(Date.now() + Number(days) * 24 * 60 * 60 * 1000).toISOString();
    await cmmsServiceProviderContractsService.extendServiceProviderContractAccess(contract.id, newValidUntil);
    await loadAll();
  };

  const statusColor = { published: 'text-emerald-400', revoked: 'text-red-400' };

  return (
    <div className="glass-card p-4 md:p-6 border border-slate-700">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg md:text-xl font-bold text-white flex items-center gap-2">📄 Service Provider Contracts</h3>
        <button
          onClick={() => { setShowForm((v) => !v); setPublishedLink(null); setError(''); }}
          className="flex items-center gap-1 text-xs md:text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded px-3 py-1.5 font-semibold"
        >
          {showForm ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          {showForm ? 'Cancel' : 'Publish Contract'}
        </button>
      </div>

      <p className="text-slate-400 text-xs md:text-sm mb-4">
        Publish a simple, time-limited public link for an outside service provider (no CMMS login needed) to view their contract, post task follow-ups, and see payments recorded for their work. The link is private -- it needs the PIN or email you set below to open. Payments are real: cash needs the provider's own confirmation from that link, and wallet payments send directly to the provider's IcanEra Wallet once they sign up and link it there.
      </p>

      {showForm && publishedLink && (
        <div className="bg-emerald-900/30 border border-emerald-700 rounded-lg p-3 mb-4 relative">
          <button onClick={() => setPublishedLink(null)} title="Dismiss" className="absolute top-2 right-2 p-1 rounded hover:bg-emerald-800/60">
            <X className="w-3.5 h-3.5 text-emerald-300" />
          </button>
          <p className="text-emerald-300 text-xs font-semibold mb-1 pr-6">Contract published. Share this link plus the PIN/email separately with the provider:</p>
          <div className="flex gap-2">
            <input readOnly value={publishedLink} className="flex-1 bg-slate-800 text-slate-300 text-xs rounded px-2 py-1.5 border border-slate-700" onFocus={(e) => e.target.select()} />
            <button onClick={() => navigator.clipboard?.writeText(publishedLink)} title="Copy link" className="text-xs px-2 py-1.5 rounded bg-emerald-700 hover:bg-emerald-600 text-white">Copy</button>
            <button onClick={() => handleShareLink(publishedLink, publishedTitle)} title="Share link" className="p-1.5 rounded bg-emerald-700 hover:bg-emerald-600 text-white"><Share2 className="w-3.5 h-3.5" /></button>
            <a href={publishedLink} target="_blank" rel="noreferrer" title="Open" className="p-1.5 rounded bg-emerald-700 hover:bg-emerald-600 text-white"><ExternalLink className="w-3.5 h-3.5" /></a>
          </div>
        </div>
      )}

      {showForm && (
        <div className="space-y-3 bg-slate-800/60 rounded-lg p-4 border border-slate-700 mb-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-300 mb-1">Provider Name *</label>
              <input type="text" value={form.providerName} onChange={(e) => setForm({ ...form, providerName: e.target.value })}
                className="w-full bg-slate-700 text-white text-xs rounded px-2 py-2 border border-slate-600" placeholder="e.g. John's Electrical Services" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-300 mb-1">Provider Contact</label>
              <input type="text" value={form.providerContact} onChange={(e) => setForm({ ...form, providerContact: e.target.value })}
                className="w-full bg-slate-700 text-white text-xs rounded px-2 py-2 border border-slate-600" placeholder="Phone or email" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-300 mb-1">Contract Title *</label>
            <input type="text" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="w-full bg-slate-700 text-white text-xs rounded px-2 py-2 border border-slate-600" placeholder="e.g. Generator Repair Contract" />
          </div>

          {jobAssignments.length > 0 && (
            <div>
              <label className="block text-xs font-semibold text-gray-300 mb-1">Link to Task (optional)</label>
              <select value={form.jobAssignmentId} onChange={(e) => setForm({ ...form, jobAssignmentId: e.target.value })}
                className="w-full bg-slate-700 text-white text-xs rounded px-2 py-2 border border-slate-600">
                <option value="">No linked task</option>
                {jobAssignments.map((j) => <option key={j.id} value={j.id}>{j.job_title}</option>)}
              </select>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-gray-300 mb-1">Scope of Work</label>
            <textarea value={form.scopeOfWork} onChange={(e) => setForm({ ...form, scopeOfWork: e.target.value })}
              className="w-full bg-slate-700 text-white text-xs rounded px-2 py-2 border border-slate-600 h-16 resize-none" placeholder="What the provider is being contracted to do" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-300 mb-1">Rate</label>
              <input type="text" value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })}
                className="w-full bg-slate-700 text-white text-xs rounded px-2 py-2 border border-slate-600" placeholder="e.g. UGX 500,000" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-300 mb-1">Access Valid For (days)</label>
              <input type="number" min="1" value={form.validDays} onChange={(e) => setForm({ ...form, validDays: e.target.value })}
                className="w-full bg-slate-700 text-white text-xs rounded px-2 py-2 border border-slate-600" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-300 mb-1">Terms</label>
            <textarea value={form.terms} onChange={(e) => setForm({ ...form, terms: e.target.value })}
              className="w-full bg-slate-700 text-white text-xs rounded px-2 py-2 border border-slate-600 h-16 resize-none" placeholder="Any other simple terms" />
          </div>

          <div className="bg-slate-900/60 rounded-lg p-3 border border-slate-700">
            <label className="block text-xs font-semibold text-gray-300 mb-2">Keep it private -- require *</label>
            <div className="flex gap-2 mb-2">
              <button type="button" onClick={() => setForm({ ...form, accessMode: 'pin' })}
                className={`flex-1 flex items-center justify-center gap-1.5 text-xs py-2 rounded border ${form.accessMode === 'pin' ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-slate-700 border-slate-600 text-slate-300'}`}>
                <Lock className="w-3.5 h-3.5" /> Secret PIN
              </button>
              <button type="button" onClick={() => setForm({ ...form, accessMode: 'email' })}
                className={`flex-1 flex items-center justify-center gap-1.5 text-xs py-2 rounded border ${form.accessMode === 'email' ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-slate-700 border-slate-600 text-slate-300'}`}>
                <Mail className="w-3.5 h-3.5" /> Their Email
              </button>
            </div>
            {form.accessMode === 'pin' ? (
              <input type="text" value={form.pin} onChange={(e) => setForm({ ...form, pin: e.target.value })}
                className="w-full bg-slate-700 text-white text-xs rounded px-2 py-2 border border-slate-600" placeholder="e.g. 4821 (min 4 characters, tell the provider separately)" />
            ) : (
              <input type="email" value={form.allowedEmail} onChange={(e) => setForm({ ...form, allowedEmail: e.target.value })}
                className="w-full bg-slate-700 text-white text-xs rounded px-2 py-2 border border-slate-600" placeholder="provider@example.com -- only this address can open the link" />
            )}
            <p className="text-slate-500 text-[11px] mt-1.5">The link alone will not open the contract -- whoever opens it must also know this {form.accessMode === 'pin' ? 'PIN' : 'email address'}.</p>
          </div>

          {error && <p className="text-red-400 text-xs">{error}</p>}

          <button onClick={handlePublish} disabled={saving || !form.providerName.trim() || !form.title.trim()}
            className="w-full py-2 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 disabled:opacity-50 text-white text-xs md:text-sm rounded font-bold">
            {saving ? '⏳ Publishing...' : '✓ Publish & Get Link'}
          </button>
        </div>
      )}

      {loading ? (
        <p className="text-slate-400 text-sm">Loading...</p>
      ) : contracts.length === 0 ? (
        <p className="text-slate-500 text-sm">No service provider contracts published yet.</p>
      ) : (
        <div className="space-y-2">
          {contracts.map((c) => (
            <ContractRow
              key={c.id}
              contract={c}
              expanded={expandedId === c.id}
              onToggle={() => setExpandedId(expandedId === c.id ? null : c.id)}
              onCopyLink={() => handleCopyLink(c.access_token)}
              onShareLink={() => handleShareLink(cmmsServiceProviderContractsService.buildServiceProviderContractUrl(c.access_token), c.title)}
              onRevoke={() => handleRevoke(c.id)}
              onExtend={() => handleExtend(c)}
              statusColor={statusColor}
              myCmmsUserId={myCmmsUserId}
              companyId={companyId}
              businessProfileId={businessProfileId}
              onChanged={loadAll}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const ContractRow = ({ contract, expanded, onToggle, onCopyLink, onShareLink, onRevoke, onExtend, statusColor, myCmmsUserId, companyId, businessProfileId, onChanged }) => {
  const [followups, setFollowups] = useState([]);
  const [payments, setPayments] = useState([]);
  const [note, setNote] = useState('');
  const [paymentForm, setPaymentForm] = useState({ amount: '', method: 'cash', reference: '', pin: '' });
  const [payBusy, setPayBusy] = useState(false);
  const [payError, setPayError] = useState('');
  const [approvingId, setApprovingId] = useState(null);
  const [approvePin, setApprovePin] = useState('');

  const walletLinked = Boolean(contract.provider_wallet_user_id);

  const reloadPayments = () => cmmsServiceProviderContractsService.getPaymentsForContract(contract.id).then((r) => setPayments(r.data || []));

  useEffect(() => {
    if (!expanded) return;
    cmmsServiceProviderContractsService.getFollowupsForContract(contract.id).then((r) => setFollowups(r.data || []));
    reloadPayments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, contract.id]);

  const handleAddNote = async () => {
    if (!note.trim()) return;
    await cmmsServiceProviderContractsService.addStaffFollowup(contract.id, note, myCmmsUserId);
    setNote('');
    cmmsServiceProviderContractsService.getFollowupsForContract(contract.id).then((r) => setFollowups(r.data || []));
  };

  const handleAddPayment = async () => {
    if (!paymentForm.amount) return;
    setPayError('');

    if (paymentForm.method === 'wallet') {
      if (!walletLinked) { setPayError("This provider hasn't linked an IcanEra Wallet yet -- ask them to open their contract link and sign up, or record this as cash."); return; }
      if (!businessProfileId) { setPayError('Link this company to its Pichin business profile before paying by wallet.'); return; }
      if (!paymentForm.pin) { setPayError('Enter the business-wallet PIN.'); return; }
      setPayBusy(true);
      try {
        const transfer = await transferFromBusinessWallet({
          businessProfileId,
          recipientUserId: contract.provider_wallet_user_id,
          amount: ugxToICAN(Number(paymentForm.amount)),
          note: `${contract.title} -- ${paymentForm.reference || 'contract payment'}`,
          referenceId: contract.id,
          pin: paymentForm.pin,
        });
        await cmmsServiceProviderContractsService.recordServiceProviderPayment(contract.id, companyId, {
          amount: paymentForm.amount,
          method: 'IcanEra Wallet',
          paymentMethod: 'wallet',
          walletTransactionId: transfer.transaction_id || transfer.id || null,
          reference: paymentForm.reference,
        }, myCmmsUserId);
        setPaymentForm({ amount: '', method: 'wallet', reference: '', pin: '' });
        await reloadPayments();
      } catch (err) {
        setPayError(err.message || 'Wallet payment failed.');
      }
      setPayBusy(false);
      return;
    }

    setPayBusy(true);
    await cmmsServiceProviderContractsService.recordServiceProviderPayment(contract.id, companyId, {
      amount: paymentForm.amount, method: 'Cash', paymentMethod: 'cash', reference: paymentForm.reference,
    }, myCmmsUserId);
    setPaymentForm({ amount: '', method: 'cash', reference: '', pin: '' });
    await reloadPayments();
    setPayBusy(false);
  };

  // transferFromBusinessWallet only ever queues a pending_approval request
  // (pitchin_business_wallet_transfer) -- no ICAN actually moves, and the
  // provider can't validly confirm receipt, until the business administrator
  // approves it here with the wallet PIN. Same RPC ICANWalletInbox.jsx uses,
  // just reachable without leaving this panel.
  const handleApproveWalletPayment = async (payment) => {
    if (!approvePin) { setPayError('Enter the business-wallet PIN to approve this transfer.'); return; }
    setApprovingId(payment.id);
    setPayError('');
    try {
      await approveBusinessWalletTransaction(payment.wallet_transaction_id, 'approved', approvePin);
      setApprovePin('');
      await reloadPayments();
    } catch (err) {
      setPayError(err.message || 'Could not approve this transfer.');
    }
    setApprovingId(null);
  };

  return (
    <div className="bg-slate-800/50 rounded-lg border border-slate-700 p-3">
      <div className="flex items-center justify-between gap-2 cursor-pointer" onClick={onToggle}>
        <div>
          <p className="text-white text-sm font-semibold">{contract.title}</p>
          <p className="text-slate-400 text-xs">{contract.provider_name} · <span className={statusColor[contract.status]}>{contract.status}</span>
            {contract.valid_until && ` · valid until ${new Date(contract.valid_until).toLocaleDateString()}`}
            {' · '}
            <span className={walletLinked ? 'text-emerald-400' : 'text-slate-500'}>{walletLinked ? 'Wallet linked' : 'No wallet linked'}</span>
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
          {contract.status !== 'revoked' && (
            <>
              <button onClick={onCopyLink} title="Copy link" className="p-1.5 rounded bg-slate-700 hover:bg-slate-600"><Copy className="w-3.5 h-3.5 text-slate-300" /></button>
              <button onClick={onShareLink} title="Share link" className="p-1.5 rounded bg-slate-700 hover:bg-slate-600"><Share2 className="w-3.5 h-3.5 text-slate-300" /></button>
              <a href={`/service-provider-contract?token=${contract.access_token}`} target="_blank" rel="noreferrer" title="Open" className="p-1.5 rounded bg-slate-700 hover:bg-slate-600"><ExternalLink className="w-3.5 h-3.5 text-slate-300" /></a>
              <button onClick={onExtend} className="text-xs px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-300">Extend</button>
              <button onClick={onRevoke} className="text-xs px-2 py-1 rounded bg-red-900/50 hover:bg-red-900 text-red-300">Revoke</button>
            </>
          )}
        </div>
      </div>

      {expanded && (
        <div className="mt-3 pt-3 border-t border-slate-700 space-y-3">
          <div>
            <p className="text-xs font-semibold text-slate-300 mb-1 flex items-center gap-1"><Wallet className="w-3.5 h-3.5" /> Payments</p>
            {payments.map((p) => {
              const needsApproval = p.payment_method === 'wallet' && p.wallet_status && p.wallet_status !== 'completed';
              return (
                <div key={p.id} className="text-xs text-slate-400 py-1 border-b border-slate-800/60 last:border-0">
                  <div className="flex justify-between items-center">
                    <span>
                      {new Date(p.payment_date).toLocaleDateString()}{p.method ? ` · ${p.method}` : ''}
                      {needsApproval && <span className="ml-1 text-amber-400">({p.wallet_status.replace('_', ' ')})</span>}
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="text-white">{p.currency} {Number(p.amount).toLocaleString()}</span>
                      {p.confirmed_at ? (
                        <span title={`Provider confirmed ${new Date(p.confirmed_at).toLocaleString()}`} className="flex items-center gap-0.5 text-emerald-400"><CheckCircle2 className="w-3.5 h-3.5" /> Confirmed</span>
                      ) : needsApproval ? (
                        <span className="text-amber-400">Not sent yet</span>
                      ) : (
                        <span className="text-amber-400">Pending confirmation</span>
                      )}
                    </span>
                  </div>
                  {needsApproval && p.wallet_status === 'pending_approval' && (
                    <div className="flex gap-1.5 mt-1">
                      <input type="password" placeholder="Wallet PIN to approve" value={approvePin} onChange={(e) => setApprovePin(e.target.value)}
                        className="flex-1 bg-slate-700 text-white text-[11px] rounded px-2 py-1 border border-slate-600" />
                      <button onClick={() => handleApproveWalletPayment(p)} disabled={approvingId === p.id}
                        className="text-[11px] px-2 py-1 rounded bg-indigo-700 hover:bg-indigo-600 text-white disabled:opacity-50">
                        {approvingId === p.id ? 'Approving...' : 'Approve & send'}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
            <div className="space-y-1.5 mt-2">
              <div className="flex gap-1.5">
                <input type="number" placeholder="Amount (UGX)" value={paymentForm.amount} onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })}
                  className="w-28 bg-slate-700 text-white text-xs rounded px-2 py-1 border border-slate-600" />
                <select value={paymentForm.method} onChange={(e) => setPaymentForm({ ...paymentForm, method: e.target.value })}
                  className="bg-slate-700 text-white text-xs rounded px-2 py-1 border border-slate-600">
                  <option value="cash">Cash</option>
                  <option value="wallet">IcanEra Wallet</option>
                </select>
                <input type="text" placeholder="Reference" value={paymentForm.reference} onChange={(e) => setPaymentForm({ ...paymentForm, reference: e.target.value })}
                  className="flex-1 bg-slate-700 text-white text-xs rounded px-2 py-1 border border-slate-600" />
              </div>
              {paymentForm.method === 'wallet' && (
                <input type="password" placeholder="Business-wallet PIN" value={paymentForm.pin} onChange={(e) => setPaymentForm({ ...paymentForm, pin: e.target.value })}
                  className="w-full bg-slate-700 text-white text-xs rounded px-2 py-1 border border-slate-600" />
              )}
              {payError && <p className="text-red-400 text-[11px]">{payError}</p>}
              <button onClick={handleAddPayment} disabled={payBusy || !paymentForm.amount}
                className="text-xs px-2 py-1 rounded bg-emerald-700 hover:bg-emerald-600 text-white disabled:opacity-50">
                {payBusy ? 'Sending...' : paymentForm.method === 'wallet' ? 'Send via IcanEra Wallet' : 'Record cash payment'}
              </button>
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold text-slate-300 mb-1">Follow-ups</p>
            {followups.map((f) => (
              <div key={f.id} className="text-xs text-slate-400 py-0.5">
                <span className={f.author_type === 'provider' ? 'text-indigo-300' : 'text-emerald-300'}>{f.author_type === 'provider' ? 'Provider' : 'Staff'}:</span> {f.note}
              </div>
            ))}
            <div className="flex gap-1.5 mt-2">
              <input type="text" placeholder="Add a note..." value={note} onChange={(e) => setNote(e.target.value)}
                className="flex-1 bg-slate-700 text-white text-xs rounded px-2 py-1 border border-slate-600" />
              <button onClick={handleAddNote} className="text-xs px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-300">Post</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CMMSServiceProviderContractPanel;
