import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BadgeCheck, Brain, Loader, Pencil, Pin, PinOff, Plus, RefreshCw, Save, ThumbsDown, ThumbsUp, Trash2, VolumeX, Volume2, X, Zap } from 'lucide-react';
import businessChatService from '../services/businessChatService';

/**
 * Lives inside the Inquiries sub-tab (CMMSInquiriesPanel.jsx) as "Learned answers": what the "Ask us" assistant on the company's
 * public website has remembered. Every question the AI answers is stored, and the next visitor who asks nearly the same thing gets
 * that answer at once (api/_lib/chatMemory.js). Here the team stays in charge of it:
 *   - Edit an answer to put it in your own words: it is then PINNED, always served, never expires and can't be muted by votes.
 *   - Mute an answer that is wrong: it is never served again (the AI answers fresh instead).
 *   - Delete it, or teach the assistant a new question and answer straight away.
 * Learned answers retire by themselves when the page's hours, prices, jobs or news change, and after 14 days.
 */

const STATUS = {
  pinned: { label: 'Team answer', style: 'bg-emerald-500/15 text-emerald-300 border-emerald-400/30', icon: BadgeCheck },
  learned: { label: 'Learned', style: 'bg-sky-500/15 text-sky-300 border-sky-400/30', icon: Brain },
  muted: { label: 'Muted', style: 'bg-slate-500/20 text-slate-300 border-slate-400/30', icon: VolumeX },
};

const timeAgo = (iso) => {
  if (!iso) return 'never';
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
};

export default function CMMSLearnedAnswersPanel({ companyId }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all'); // 'all' | 'pinned' | 'learned' | 'muted'
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState('');
  const [confirmId, setConfirmId] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [teaching, setTeaching] = useState(false);
  const [newQuestion, setNewQuestion] = useState('');
  const [newReply, setNewReply] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    const result = await businessChatService.listLearnedAnswers(companyId);
    if (result.success) { setItems(result.data); setError(''); } else setError(result.error || 'Could not load the learned answers.');
    setLoading(false);
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  const stats = useMemo(() => ({
    total: items.length,
    served: items.reduce((sum, i) => sum + (i.hits || 0), 0),
    team: items.filter((i) => i.status === 'pinned').length,
  }), [items]);
  const visible = items.filter((i) => filter === 'all' || i.status === filter);

  const run = async (id, action) => {
    setBusyId(id);
    const result = await action();
    setBusyId(null);
    if (!result.success) { setError(result.error || 'That did not work. Please try again.'); return false; }
    setError('');
    await load({ quiet: true });
    return true;
  };

  const saveEdit = async (item) => {
    if (!draft.trim()) return;
    if (await run(item.id, () => businessChatService.updateLearnedAnswer(item.id, { reply: draft.trim() }))) setEditingId(null);
  };

  const teach = async (e) => {
    e.preventDefault();
    if (!newQuestion.trim() || !newReply.trim() || saving) return;
    setSaving(true);
    const result = await businessChatService.teachAnswer(companyId, newQuestion.trim(), newReply.trim());
    setSaving(false);
    if (!result.success) { setError(result.error || 'Could not save that answer.'); return; }
    setError('');
    setNewQuestion('');
    setNewReply('');
    setTeaching(false);
    load({ quiet: true });
  };

  return (
    <div className="space-y-3">
      <div className="cmms-classic-card p-3 text-sm cmms-classic-muted flex items-start gap-2">
        <Brain className="w-4 h-4 mt-0.5 flex-shrink-0 text-sky-300" />
        <span>
          When the assistant on your public page answers a question, it remembers the answer. The next visitor who asks nearly the same thing
          gets it instantly, with no waiting. Put an answer in your own words to pin it, mute one that is wrong, or teach it something new.
          Answers refresh by themselves when your hours, prices, jobs or news change.
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        {[['Answers kept', stats.total, Brain], ['Times served instantly', stats.served, Zap], ['Written by you', stats.team, BadgeCheck]].map(([label, value, Icon]) => (
          <div key={label} className="cmms-classic-card p-3">
            <Icon className="w-4 h-4 mx-auto mb-1 text-sky-300" />
            <p className="text-xl font-extrabold text-white">{value}</p>
            <p className="text-[11px] cmms-classic-muted">{label}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        {[['all', 'All'], ['pinned', 'Team answers'], ['learned', 'Learned'], ['muted', 'Muted']].map(([id, label]) => (
          <button key={id} type="button" onClick={() => setFilter(id)} className={`px-3 py-1.5 rounded-full border ${filter === id ? 'cmms-classic-btn-primary' : 'cmms-classic-btn-secondary'} !h-auto !min-h-0`}>{label}</button>
        ))}
        <button type="button" onClick={() => load()} className="cmms-classic-btn-secondary !h-auto !min-h-0 px-2.5 py-1.5 ml-auto inline-flex items-center gap-1" title="Refresh"><RefreshCw className="w-3.5 h-3.5" /></button>
        <button type="button" onClick={() => setTeaching((v) => !v)} className="cmms-classic-btn-primary !h-auto !min-h-0 px-3 py-1.5 inline-flex items-center gap-1">
          {teaching ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />} {teaching ? 'Cancel' : 'Teach an answer'}
        </button>
      </div>

      {teaching && (
        <form onSubmit={teach} className="cmms-classic-card p-3 space-y-2">
          <label className="block text-xs font-semibold text-white">
            When a visitor asks…
            <input value={newQuestion} onChange={(e) => setNewQuestion(e.target.value.slice(0, 300))} placeholder="e.g. Do you offer free delivery?" className="mt-1 w-full rounded bg-slate-900 border border-white/20 px-3 py-2 text-white text-sm font-normal" />
          </label>
          <label className="block text-xs font-semibold text-white">
            …the assistant answers
            <textarea value={newReply} onChange={(e) => setNewReply(e.target.value.slice(0, 1200))} rows={3} placeholder="Write it as you would say it to a customer." className="mt-1 w-full rounded bg-slate-900 border border-white/20 px-3 py-2 text-white text-sm font-normal resize-none" />
          </label>
          <p className="text-[11px] cmms-classic-muted">Visitors who ask the same thing in other words ("is delivery free?") get this answer too.</p>
          <button type="submit" disabled={!newQuestion.trim() || !newReply.trim() || saving} className="cmms-classic-btn-primary px-4 py-2 text-sm disabled:opacity-50 inline-flex items-center gap-1.5">
            {saving ? <Loader className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save answer
          </button>
        </form>
      )}

      {error && <p className="text-sm text-rose-300" role="alert">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-10"><Loader className="w-6 h-6 text-purple-400 animate-spin" /></div>
      ) : visible.length === 0 ? (
        <div className="cmms-classic-card p-8 text-center cmms-classic-muted">
          <Brain className="w-10 h-10 mx-auto mb-3 opacity-50" />
          {items.length === 0 ? 'Nothing learned yet. As visitors ask the assistant questions on your public page, the answers appear here.' : 'No answers in this view.'}
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map((item) => {
            const meta = STATUS[item.status] || STATUS.learned;
            const busy = busyId === item.id;
            return (
              <div key={item.id} className="cmms-classic-card p-3">
                <div className="flex items-start gap-2">
                  <p className="font-semibold text-white flex-1 min-w-0 break-words">“{item.question}”</p>
                  <span className={`flex-shrink-0 inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${meta.style}`}><meta.icon className="w-3 h-3" />{meta.label}</span>
                </div>

                {editingId === item.id ? (
                  <div className="mt-2 space-y-2">
                    <textarea value={draft} onChange={(e) => setDraft(e.target.value.slice(0, 1200))} rows={3} className="w-full rounded bg-slate-900 border border-white/20 px-3 py-2 text-white text-sm resize-none" aria-label="Answer" />
                    <div className="flex gap-2">
                      <button type="button" onClick={() => saveEdit(item)} disabled={!draft.trim() || busy} className="cmms-classic-btn-primary !h-auto !min-h-0 px-3 py-1.5 text-xs inline-flex items-center gap-1 disabled:opacity-50">
                        {busy ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Save and pin
                      </button>
                      <button type="button" onClick={() => setEditingId(null)} className="cmms-classic-btn-secondary !h-auto !min-h-0 px-3 py-1.5 text-xs">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <p className={`mt-1.5 text-sm whitespace-pre-wrap break-words ${item.status === 'muted' ? 'text-slate-400 line-through decoration-slate-600' : 'text-slate-200'}`}>{item.reply}</p>
                )}

                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] cmms-classic-muted">
                  <span className="inline-flex items-center gap-1"><Zap className="w-3 h-3" />Served {item.hits} time{item.hits === 1 ? '' : 's'}</span>
                  <span className="inline-flex items-center gap-1"><ThumbsUp className="w-3 h-3" />{item.helpful}</span>
                  <span className="inline-flex items-center gap-1"><ThumbsDown className="w-3 h-3" />{item.unhelpful}</span>
                  <span>Last used {timeAgo(item.last_hit_at)}</span>

                  <span className="ml-auto flex flex-wrap items-center gap-1.5">
                    {editingId !== item.id && (
                      <button type="button" onClick={() => { setEditingId(item.id); setDraft(item.reply); setConfirmId(null); }} className="cmms-classic-btn-secondary !h-auto !min-h-0 px-2 py-1 inline-flex items-center gap-1"><Pencil className="w-3 h-3" />Edit</button>
                    )}
                    {item.status === 'pinned' ? (
                      <button type="button" disabled={busy} onClick={() => run(item.id, () => businessChatService.updateLearnedAnswer(item.id, { status: 'learned' }))} className="cmms-classic-btn-secondary !h-auto !min-h-0 px-2 py-1 inline-flex items-center gap-1" title="Let it refresh itself like other learned answers"><PinOff className="w-3 h-3" />Unpin</button>
                    ) : (
                      <button type="button" disabled={busy} onClick={() => run(item.id, () => businessChatService.updateLearnedAnswer(item.id, { status: 'pinned' }))} className="cmms-classic-btn-secondary !h-auto !min-h-0 px-2 py-1 inline-flex items-center gap-1" title="Always serve this answer"><Pin className="w-3 h-3" />Pin</button>
                    )}
                    {item.status === 'muted' ? (
                      <button type="button" disabled={busy} onClick={() => run(item.id, () => businessChatService.updateLearnedAnswer(item.id, { status: 'learned' }))} className="cmms-classic-btn-secondary !h-auto !min-h-0 px-2 py-1 inline-flex items-center gap-1"><Volume2 className="w-3 h-3" />Unmute</button>
                    ) : item.status === 'learned' ? (
                      <button type="button" disabled={busy} onClick={() => run(item.id, () => businessChatService.updateLearnedAnswer(item.id, { status: 'muted' }))} className="cmms-classic-btn-secondary !h-auto !min-h-0 px-2 py-1 inline-flex items-center gap-1" title="Never serve this answer"><VolumeX className="w-3 h-3" />Mute</button>
                    ) : null}
                    {confirmId === item.id ? (
                      <>
                        <button type="button" disabled={busy} onClick={() => run(item.id, () => businessChatService.deleteLearnedAnswer(item.id)).then(() => setConfirmId(null))} className="px-2 py-1 rounded border border-rose-400/50 text-rose-300 inline-flex items-center gap-1"><Trash2 className="w-3 h-3" />Delete it</button>
                        <button type="button" onClick={() => setConfirmId(null)} className="cmms-classic-btn-secondary !h-auto !min-h-0 px-2 py-1">Keep</button>
                      </>
                    ) : (
                      <button type="button" onClick={() => setConfirmId(item.id)} className="cmms-classic-btn-secondary !h-auto !min-h-0 px-2 py-1 inline-flex items-center gap-1" aria-label="Delete this answer"><Trash2 className="w-3 h-3" /></button>
                    )}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
