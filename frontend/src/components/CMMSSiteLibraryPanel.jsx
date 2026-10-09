import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle, Briefcase, CheckCircle2, ExternalLink, FileText, FolderOpen, KeyRound, Link2, Loader, Lock,
  Pencil, Plus, RefreshCw, Star, Trash2, Users, X,
} from 'lucide-react';
import siteLibraryService, { LINK_KINDS, LOCK_LABELS } from '../services/siteLibraryService';

/**
 * Lives inside the Jobs & Announcements panel (CMMSAnnouncementsPanel.jsx) as its "Library" sub-tab: curates the
 * Library tab of the company's public website (/notices/<company>?tab=library).
 *
 * Nothing is published automatically. Share links made in other CMMS tools (reports, report exports, consultation
 * forms, service-provider contracts) show up under "Ready to add"; the team picks which ones go on the website,
 * and can also add any other link by hand, optionally behind a PIN. Locked links stay locked on the website:
 * visitors must already know the password / PIN / invited email to open them.
 * Visible to anyone who can edit the board (the same rule the database enforces).
 */

const KIND_ICONS = {
  report: FileText,
  report_export: FolderOpen,
  consultation_form: Users,
  service_contract: Briefcase,
  custom: Link2,
};

const STATUS_NOTES = {
  expired_or_revoked: 'Not showing: this link expired or was revoked',
  missing: 'Not showing: the original link no longer exists',
};

const inputClass = 'w-full rounded bg-slate-900 border border-white/20 px-3 py-2 text-white text-sm';

const LockChip = ({ lock }) => (lock && lock !== 'none' ? (
  <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border bg-amber-500/15 text-amber-300 border-amber-400/30">
    <Lock className="w-3 h-3" /> {LOCK_LABELS[lock] || 'Protected'}
  </span>
) : null);

const emptyForm = { title: '', description: '', url: '', pin: '', clearPin: false, featured: false };

/** Add / edit form. custom = manual link (address + optional PIN); otherwise only title + description are editable. */
const LinkForm = ({ custom, hasPin, initial, busy, error, onSubmit, onCancel }) => {
  const [form, setForm] = useState({ ...emptyForm, ...initial });
  const set = (patch) => setForm((prev) => ({ ...prev, ...patch }));
  const editing = Boolean(initial?.id);

  const submit = (e) => {
    e.preventDefault();
    onSubmit(form);
  };

  return (
    <form onSubmit={submit} className="cmms-classic-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="font-semibold text-white text-sm">
          {editing ? 'Edit library item' : 'Add a link to your library'}
        </p>
        <button type="button" onClick={onCancel} aria-label="Cancel" className="cmms-classic-muted hover:text-white"><X className="w-4 h-4" /></button>
      </div>

      <div>
        <label className="block text-xs cmms-classic-muted mb-1" htmlFor="lib-title">Title{custom ? '' : ' (leave blank to use the original name)'}</label>
        <input id="lib-title" className={inputClass} value={form.title} maxLength={120} required={custom}
               onChange={(e) => set({ title: e.target.value })} placeholder={custom ? 'e.g. Price list 2026' : initial?.defaultTitle || ''} />
      </div>

      <div>
        <label className="block text-xs cmms-classic-muted mb-1" htmlFor="lib-desc">Short description (optional)</label>
        <input id="lib-desc" className={inputClass} value={form.description} maxLength={300}
               onChange={(e) => set({ description: e.target.value })} placeholder="What will people find here?" />
      </div>

      {custom && (
        <>
          <div>
            <label className="block text-xs cmms-classic-muted mb-1" htmlFor="lib-url">Web address</label>
            <input id="lib-url" className={inputClass} value={form.url} maxLength={1000} required type="url" inputMode="url"
                   onChange={(e) => set({ url: e.target.value })} placeholder="https://..." />
          </div>
          <div>
            <label className="block text-xs cmms-classic-muted mb-1" htmlFor="lib-pin">
              <KeyRound className="w-3 h-3 inline -mt-0.5" /> PIN (optional) -- {editing && hasPin ? 'leave blank to keep the current PIN' : 'only people who know it can open the link'}
            </label>
            <input id="lib-pin" className={inputClass} value={form.pin} maxLength={100} type="text" autoComplete="off"
                   disabled={form.clearPin} onChange={(e) => set({ pin: e.target.value })}
                   placeholder={editing && hasPin ? 'New PIN (4+ characters)' : 'At least 4 characters'} />
            <p className="text-[11px] cmms-classic-muted mt-1">
              With a PIN, the address is never sent to the visitor's browser until they type it correctly. Share the PIN with the right people yourself.
            </p>
            {editing && hasPin && (
              <label className="flex items-center gap-2 text-xs text-slate-300 mt-2">
                <input type="checkbox" checked={form.clearPin} onChange={(e) => set({ clearPin: e.target.checked, pin: '' })} />
                Remove the PIN (anyone can then open it)
              </label>
            )}
          </div>
        </>
      )}

      <label className="flex items-center gap-2 text-sm text-slate-200">
        <input type="checkbox" checked={form.featured} onChange={(e) => set({ featured: e.target.checked })} />
        <Star className="w-3.5 h-3.5 text-amber-300" /> Feature at the top of the library
      </label>

      {error && <p className="text-sm text-rose-300 flex items-start gap-1.5" role="alert"><AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" /> {error}</p>}

      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onCancel} className="cmms-classic-btn-secondary px-4 py-2 text-sm">Cancel</button>
        <button type="submit" disabled={busy} className="cmms-classic-btn-primary px-4 py-2 text-sm disabled:opacity-50 inline-flex items-center gap-1.5">
          {busy && <Loader className="w-4 h-4 animate-spin" />} {editing ? 'Save' : 'Add to library'}
        </button>
      </div>
    </form>
  );
};

export default function CMMSSiteLibraryPanel({ companyId, onCountChange }) {
  const [listed, setListed] = useState([]);
  const [available, setAvailable] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);
  // null | { custom: bool, initial: {...} } -- the open add/edit form
  const [formState, setFormState] = useState(null);
  const [formBusy, setFormBusy] = useState(false);
  const [formError, setFormError] = useState('');

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    const result = await siteLibraryService.getOverview(companyId);
    if (result.success) {
      setListed(result.data?.listed || []);
      setAvailable(result.data?.available || []);
      setError('');
      onCountChange?.((result.data?.listed || []).length);
    } else {
      setError(result.error || 'Could not load the library.');
    }
    setLoading(false);
  }, [companyId, onCountChange]);

  useEffect(() => { load(); }, [load]);

  const run = async (id, action, failure) => {
    setBusyId(id);
    const result = await action();
    setBusyId(null);
    if (!result.success) { setError(result.error || failure); return false; }
    setError('');
    await load({ quiet: true });
    return true;
  };

  const addSource = (item) => run(`${item.kind}:${item.source_id}`,
    () => siteLibraryService.listLink(companyId, { kind: item.kind, sourceId: item.source_id }),
    'Could not add this link.');

  // Reports and forms are fine to add in bulk; contracts are private agreements with one contractor, so each
  // one is a deliberate click.
  const bulkAddable = available.filter((item) => item.kind !== 'service_contract');
  const addAll = async () => {
    if (!window.confirm(`Add ${bulkAddable.length} link${bulkAddable.length === 1 ? '' : 's'} to your website's library? Links that need a password or PIN stay locked.`)) return;
    setBusyId('all');
    for (const item of bulkAddable) {
      // eslint-disable-next-line no-await-in-loop
      const result = await siteLibraryService.listLink(companyId, { kind: item.kind, sourceId: item.source_id });
      if (!result.success) { setError(result.error || 'Could not add every link.'); break; }
    }
    setBusyId(null);
    load({ quiet: true });
  };

  const remove = async (link) => {
    const note = link.kind === 'custom' ? 'The link is deleted.' : 'The original share link is not affected.';
    if (!window.confirm(`Remove "${link.title || link.default_title || 'this link'}" from your website's library? ${note}`)) return;
    run(link.id, () => siteLibraryService.removeLink(link.id), 'Could not remove this link.');
  };

  const toggleFeatured = (link) => run(link.id, () => siteLibraryService.setFeatured(link.id, !link.featured), 'Could not update this link.');

  const openForm = (custom, initial = {}) => { setFormError(''); setFormState({ custom, initial }); };

  const submitForm = async (form) => {
    setFormBusy(true);
    setFormError('');
    const { custom, initial } = formState;
    let result;
    if (custom) {
      if (form.pin && form.pin.length < 4) { setFormBusy(false); setFormError('A PIN needs at least 4 characters.'); return; }
      // undefined keeps the current PIN, '' removes it
      const pin = form.clearPin ? '' : (form.pin ? form.pin : (initial.id ? undefined : ''));
      result = await siteLibraryService.saveCustomLink(companyId, {
        id: initial.id || null, title: form.title, description: form.description, url: form.url, pin, featured: form.featured,
      });
    } else {
      result = await siteLibraryService.listLink(companyId, {
        kind: initial.kind, sourceId: initial.sourceId, title: form.title, description: form.description, featured: form.featured,
      });
    }
    setFormBusy(false);
    if (!result.success) { setFormError(result.error || 'Could not save.'); return; }
    setFormState(null);
    load({ quiet: true });
  };

  const editListed = (link) => {
    if (link.kind === 'custom') {
      openForm(true, { id: link.id, title: link.title || '', description: link.description || '', url: link.url || '', featured: link.featured, hasPin: link.lock === 'pin' });
    } else {
      openForm(false, { id: link.id, kind: link.kind, sourceId: link.source_id, title: link.title || '', description: link.description || '', featured: link.featured, defaultTitle: link.default_title });
    }
  };

  const siteUrl = `${window.location.origin}/notices/${companyId}?tab=library`;

  return (
    <div className="space-y-4">
      <div className="cmms-classic-card p-3 text-sm cmms-classic-muted flex items-start gap-2">
        <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0 text-emerald-400" />
        <span>
          Your website's <b className="text-slate-200">Library</b> tab gathers the public links you choose: shared reports, forms, contracts and any link you add.
          Nothing appears until you add it here. Links that need a password, PIN or invited email stay locked, so visitors must already have that from you.
          {listed.length > 0 && (
            <> <a href={siteUrl} target="_blank" rel="noreferrer" className="underline text-slate-200 inline-flex items-center gap-1">View it live <ExternalLink className="w-3 h-3" /></a></>
          )}
        </span>
      </div>

      {error && <p className="text-sm text-rose-300" role="alert">{error}</p>}

      {formState && (
        <LinkForm
          key={formState.initial.id || 'new'}
          custom={formState.custom}
          hasPin={formState.initial.hasPin}
          initial={formState.initial}
          busy={formBusy}
          error={formError}
          onSubmit={submitForm}
          onCancel={() => setFormState(null)}
        />
      )}

      {loading ? (
        <div className="flex justify-center py-10"><Loader className="w-6 h-6 text-purple-400 animate-spin" /></div>
      ) : (
        <>
          <section className="space-y-2">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-white text-sm flex-1">On your website ({listed.length})</h3>
              <button type="button" onClick={() => load()} className="cmms-classic-btn-secondary !h-auto !min-h-0 px-2.5 py-1.5" title="Refresh"><RefreshCw className="w-3.5 h-3.5" /></button>
              <button type="button" onClick={() => openForm(true)} className="cmms-classic-btn-primary !h-auto !min-h-0 px-3 py-1.5 text-xs inline-flex items-center gap-1">
                <Plus className="w-3.5 h-3.5" /> Add a link
              </button>
            </div>
            {listed.length === 0 ? (
              <div className="cmms-classic-card p-6 text-center cmms-classic-muted text-sm">
                <FolderOpen className="w-9 h-9 mx-auto mb-2 opacity-50" />
                Your library is empty, so the tab is hidden on your website. Add a link below to switch it on.
              </div>
            ) : listed.map((link) => {
              const Icon = KIND_ICONS[link.kind] || Link2;
              const note = STATUS_NOTES[link.status];
              return (
                <div key={link.id} className={`cmms-classic-card p-3 flex items-center gap-3 ${note ? 'opacity-70' : ''}`}>
                  <Icon className="w-5 h-5 flex-shrink-0 text-purple-300" />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-white truncate">{link.title || link.default_title || 'Untitled'}</p>
                    <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                      <span className="text-[11px] cmms-classic-muted">{LINK_KINDS[link.kind]?.label || 'Link'}</span>
                      <LockChip lock={link.lock} />
                    </div>
                    {note && <p className="text-[11px] text-amber-300 mt-1">{note}</p>}
                  </div>
                  {busyId === link.id ? <Loader className="w-4 h-4 animate-spin text-purple-300" /> : (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button type="button" onClick={() => toggleFeatured(link)} aria-label={link.featured ? 'Remove from featured' : 'Feature at the top'} title={link.featured ? 'Featured' : 'Feature at the top'}
                              className="p-1.5 rounded hover:bg-white/10"><Star className={`w-4 h-4 ${link.featured ? 'text-amber-300 fill-amber-300' : 'cmms-classic-muted'}`} /></button>
                      <button type="button" onClick={() => editListed(link)} aria-label="Edit" title="Edit" className="p-1.5 rounded hover:bg-white/10 cmms-classic-muted"><Pencil className="w-4 h-4" /></button>
                      <button type="button" onClick={() => remove(link)} aria-label="Remove from website" title="Remove from website" className="p-1.5 rounded hover:bg-white/10 text-rose-300"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  )}
                </div>
              );
            })}
          </section>

          <section className="space-y-2">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-white text-sm flex-1">Ready to add ({available.length})</h3>
              {bulkAddable.length > 1 && (
                <button type="button" onClick={addAll} disabled={busyId === 'all'} className="cmms-classic-btn-secondary !h-auto !min-h-0 px-3 py-1.5 text-xs disabled:opacity-50 inline-flex items-center gap-1">
                  {busyId === 'all' ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Add all reports & forms
                </button>
              )}
            </div>
            <p className="text-xs cmms-classic-muted">Public links already created in your reports, forms and contracts. Revoked or expired ones are not shown.</p>
            {available.length === 0 ? (
              <div className="cmms-classic-card p-5 text-center cmms-classic-muted text-sm">
                Nothing else to add. Share a report or switch on a consultation form's link and it will appear here.
              </div>
            ) : available.map((item) => {
              const Icon = KIND_ICONS[item.kind] || Link2;
              const key = `${item.kind}:${item.source_id}`;
              return (
                <div key={key} className="cmms-classic-card p-3 flex items-center gap-3">
                  <Icon className="w-5 h-5 flex-shrink-0 cmms-classic-muted" />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-white truncate">{item.default_title || 'Untitled'}</p>
                    <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                      <span className="text-[11px] cmms-classic-muted">{LINK_KINDS[item.kind]?.label}</span>
                      <LockChip lock={item.lock} />
                      {item.expires_at && <span className="text-[11px] cmms-classic-muted">expires {new Date(item.expires_at).toLocaleDateString()}</span>}
                    </div>
                  </div>
                  <button type="button" onClick={() => addSource(item)} disabled={busyId === key || busyId === 'all'}
                          className="cmms-classic-btn-secondary !h-auto !min-h-0 px-3 py-1.5 text-xs flex-shrink-0 disabled:opacity-50 inline-flex items-center gap-1">
                    {busyId === key ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Add
                  </button>
                </div>
              );
            })}
          </section>
        </>
      )}
    </div>
  );
}
