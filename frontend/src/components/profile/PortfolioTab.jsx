import React, { useEffect, useState } from 'react';
import {
  Link2, Copy, Eye, Plus, Trash2, Edit2, RefreshCw, Upload, ShieldCheck,
  Briefcase, Award, GraduationCap, FolderKanban, Rocket, FlaskConical, Presentation,
  Loader2, Users, ExternalLink, Share2, Check, MapPin, Phone, Mail, BadgeCheck,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import {
  getMyPortfolio, upsertPortfolio, setHandle as setHandleRemote,
  getPortfolioItems, addPortfolioItem, updatePortfolioItem, deletePortfolioItem,
  getPortfolioReferences, addPortfolioReference, updatePortfolioReference, deletePortfolioReference,
  isCmmsMember, syncCmmsPortfolioItems,
  uploadVerificationDocument, getMyVerifications, deleteVerificationDocument,
} from '../../services/portfolioService';
import PortfolioMessagesInbox from './PortfolioMessagesInbox';
import CertificateRequestsInbox from './CertificateRequestsInbox';
import ResumeOpportunityBidsPanel from './ResumeOpportunityBidsPanel';
import PublicPortfolioPage from './PublicPortfolioPage';

const ITEM_ICONS = {
  experience: Briefcase,
  entrepreneurship: Rocket,
  research: FlaskConical,
  achievement: Award,
  education: GraduationCap,
  project: FolderKanban,
  presentation: Presentation,
};
const ITEM_TYPE_LABELS = {
  experience: 'Experience',
  entrepreneurship: 'Entrepreneurship',
  research: 'Research & Innovation',
  achievement: 'Achievement',
  education: 'Education',
  project: 'Project',
  presentation: 'Presentation / Competition',
};
const EMPTY_ITEM_FORM = { itemType: 'experience', title: '', orgName: '', description: '', startDate: '', endDate: '' };
const EMPTY_REFERENCE_FORM = { name: '', title: '', organization: '', email: '', phone: '' };

export default function PortfolioTab() {
  const { user, profile, getAvatarUrl, loadProfile } = useAuth();

  const [handle, setHandleState] = useState('');
  const [handleInput, setHandleInput] = useState('');
  const [savingHandle, setSavingHandle] = useState(false);
  const [handleError, setHandleError] = useState(null);
  const [handleSaved, setHandleSaved] = useState(false);

  const [form, setForm] = useState({ headline: '', summary: '', skills: '', links: {}, location: '', phone: '', contactEmail: '' });
  const [linksList, setLinksList] = useState([]); // [{ label, url }] — edited as rows, saved as a {label: url} object
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);
  const [profileError, setProfileError] = useState(null);

  const [items, setItems] = useState([]);
  const [itemForm, setItemForm] = useState(null); // null = closed, object = open (add or edit)
  const [editingItemId, setEditingItemId] = useState(null);
  const [itemError, setItemError] = useState(null);

  const [references, setReferences] = useState([]);
  const [referenceForm, setReferenceForm] = useState(null);
  const [editingReferenceId, setEditingReferenceId] = useState(null);
  const [referenceError, setReferenceError] = useState(null);

  const [cmmsMember, setCmmsMember] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  const [verifications, setVerifications] = useState([]);
  const [isUploadingDoc, setIsUploadingDoc] = useState(false);
  const [removingVerificationId, setRemovingVerificationId] = useState(null);

  const [showPreview, setShowPreview] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('profile');
  const [linkCopied, setLinkCopied] = useState(false);
  const [savedSnapshot, setSavedSnapshot] = useState('');

  const snapshotOf = (f, rows) => JSON.stringify({ f, rows });

  const load = async () => {
    if (!user?.id) return;
    setIsLoading(true);
    try {
      const [{ portfolio, handle: h }, portfolioItems, portfolioReferences, memberCheck, myDocs] = await Promise.all([
        getMyPortfolio(user.id),
        getPortfolioItems(user.id),
        getPortfolioReferences(user.id),
        isCmmsMember(user.email),
        getMyVerifications(user.id),
      ]);

      setHandleState(h || '');
      setHandleInput(h || '');
      const loadedForm = {
        headline: portfolio?.headline || '',
        summary: portfolio?.summary || '',
        skills: (portfolio?.skills || []).join(', '),
        links: portfolio?.links || {},
        location: portfolio?.location || '',
        phone: portfolio?.phone || '',
        contactEmail: portfolio?.contact_email || '',
      };
      const loadedLinks = Object.entries(portfolio?.links || {}).map(([label, url]) => ({ label, url }));
      setForm(loadedForm);
      setLinksList(loadedLinks);
      setSavedSnapshot(snapshotOf(loadedForm, loadedLinks));
      setItems(portfolioItems);
      setReferences(portfolioReferences);
      setCmmsMember(memberCheck);
      setVerifications(myDocs);

      if (memberCheck) {
        syncCmmsPortfolioItems(user.id, user.email)
          .then(() => getPortfolioItems(user.id))
          .then(setItems)
          .catch((err) => console.error('CMMS auto-sync failed:', err));
      }
    } catch (err) {
      console.error('Error loading portfolio tab:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const saveHandle = async () => {
    setSavingHandle(true);
    setHandleError(null);
    try {
      const saved = await setHandleRemote(user.id, handleInput);
      setHandleState(saved);
      setHandleInput(saved);
      setHandleSaved(true);
      setTimeout(() => setHandleSaved(false), 2500);
    } catch (err) {
      setHandleError(err.message);
    } finally {
      setSavingHandle(false);
    }
  };

  const shareUrl = handle ? `${window.location.origin}/portfolio/${handle}` : '';

  const copyShareLink = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      // clipboard API unavailable — no-op, link is still shown/selectable
    }
  };

  const saveProfileForm = async () => {
    setIsSavingProfile(true);
    setProfileError(null);
    try {
      const links = {};
      linksList.forEach(({ label, url }) => {
        if (label.trim() && url.trim()) links[label.trim()] = url.trim();
      });
      await upsertPortfolio(user.id, {
        headline: form.headline,
        summary: form.summary,
        skills: form.skills.split(',').map((s) => s.trim()).filter(Boolean),
        links,
        location: form.location,
        phone: form.phone,
        contactEmail: form.contactEmail,
      });
      setSavedSnapshot(snapshotOf(form, linksList));
      setProfileSaved(true);
      setTimeout(() => setProfileSaved(false), 2500);
    } catch (err) {
      console.error('Error saving portfolio:', err);
      setProfileError(err.message || 'Could not save — please try again.');
    } finally {
      setIsSavingProfile(false);
    }
  };

  const manualItems = items.filter((i) => i.source === 'manual');
  const cmmsItems = items.filter((i) => i.source === 'cmms');

  const openAddItem = () => {
    setEditingItemId(null);
    setItemError(null);
    setItemForm(EMPTY_ITEM_FORM);
  };

  const openEditItem = (item) => {
    setEditingItemId(item.id);
    setItemError(null);
    setItemForm({
      itemType: item.item_type,
      title: item.title,
      orgName: item.org_name || '',
      description: item.description || '',
      startDate: item.start_date || '',
      endDate: item.end_date || '',
    });
  };

  const saveItemForm = async () => {
    setItemError(null);
    try {
      if (editingItemId) {
        await updatePortfolioItem(user.id, editingItemId, itemForm);
      } else {
        await addPortfolioItem(user.id, itemForm);
      }
      setItemForm(null);
      setEditingItemId(null);
      setItems(await getPortfolioItems(user.id));
    } catch (err) {
      console.error('Error saving portfolio item:', err);
      setItemError(err.message || 'Could not save this entry — please try again.');
    }
  };

  const removeItem = async (itemId) => {
    if (!window.confirm('Remove this entry from your resume?')) return;
    try {
      await deletePortfolioItem(user.id, itemId);
      setItems(await getPortfolioItems(user.id));
    } catch (err) {
      console.error('Error deleting portfolio item:', err);
    }
  };

  const addLinkRow = () => setLinksList((rows) => [...rows, { label: '', url: '' }]);
  const updateLinkRow = (index, field, value) =>
    setLinksList((rows) => rows.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  const removeLinkRow = (index) => setLinksList((rows) => rows.filter((_, i) => i !== index));

  const openAddReference = () => {
    setEditingReferenceId(null);
    setReferenceError(null);
    setReferenceForm(EMPTY_REFERENCE_FORM);
  };

  const openEditReference = (ref) => {
    setEditingReferenceId(ref.id);
    setReferenceError(null);
    setReferenceForm({
      name: ref.name,
      title: ref.title || '',
      organization: ref.organization || '',
      email: ref.email || '',
      phone: ref.phone || '',
    });
  };

  const saveReferenceForm = async () => {
    setReferenceError(null);
    if (!referenceForm.name.trim()) {
      setReferenceError('Name is required.');
      return;
    }
    try {
      if (editingReferenceId) {
        await updatePortfolioReference(user.id, editingReferenceId, referenceForm);
      } else {
        await addPortfolioReference(user.id, referenceForm);
      }
      setReferenceForm(null);
      setEditingReferenceId(null);
      setReferences(await getPortfolioReferences(user.id));
    } catch (err) {
      console.error('Error saving reference:', err);
      setReferenceError(err.message || 'Could not save this reference — please try again.');
    }
  };

  const removeReference = async (referenceId) => {
    if (!window.confirm('Remove this reference?')) return;
    try {
      await deletePortfolioReference(user.id, referenceId);
      setReferences(await getPortfolioReferences(user.id));
    } catch (err) {
      console.error('Error deleting reference:', err);
    }
  };

  const refreshCmms = async () => {
    setIsSyncing(true);
    try {
      await syncCmmsPortfolioItems(user.id, user.email);
      setItems(await getPortfolioItems(user.id));
    } catch (err) {
      console.error('Error syncing CMMS items:', err);
    } finally {
      setIsSyncing(false);
    }
  };

  const uploadDoc = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploadingDoc(true);
    try {
      await uploadVerificationDocument(user.id, file);
      setVerifications(await getMyVerifications(user.id));
    } catch (err) {
      console.error('Error uploading verification document:', err);
    } finally {
      setIsUploadingDoc(false);
      e.target.value = '';
    }
  };

  const removeVerification = async (doc) => {
    if (doc.status === 'approved' && !window.confirm(
      "Remove this approved document? If it's your only one, your profile will no longer show as verified."
    )) {
      return;
    }

    setRemovingVerificationId(doc.id);
    try {
      await deleteVerificationDocument(doc);
      setVerifications((prev) => prev.filter((v) => v.id !== doc.id));
      if (doc.status === 'approved') {
        await loadProfile(user.id);
      }
    } catch (err) {
      console.error('Error removing verification document:', err);
    } finally {
      setRemovingVerificationId(null);
    }
  };


  if (isLoading) {
    return (
      <div className="rz py-16 flex flex-col items-center gap-3 text-center">
        <Loader2 className="w-6 h-6 animate-spin text-[#c4a052]" />
        <p className="rz-serif text-[#e6c980]">Preparing your resume…</p>
      </div>
    );
  }

  const isDirty = savedSnapshot !== snapshotOf(form, linksList);
  const displayName = profile?.full_name || user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Your Name';
  const avatarUrl = getAvatarUrl?.();
  const skillList = form.skills.split(',').map((s) => s.trim()).filter(Boolean);
  const timelineItems = [...cmmsItems, ...manualItems];
  const canShare = typeof navigator !== 'undefined' && !!navigator.share;

  // Completeness checklist — drives the meter and the "next step" nudge.
  const checklist = [
    { done: !!form.headline.trim(), label: 'Add a headline', tab: 'profile' },
    { done: form.summary.trim().length >= 40, label: 'Write a professional summary', tab: 'profile' },
    { done: skillList.length >= 3, label: 'List at least 3 skills', tab: 'profile' },
    { done: !!(form.location.trim() && (form.phone.trim() || form.contactEmail.trim())), label: 'Add location and a contact', tab: 'profile' },
    { done: linksList.some((l) => l.label.trim() && l.url.trim()), label: 'Link your LinkedIn or website', tab: 'profile' },
    { done: items.length > 0, label: 'Add your first experience', tab: 'experience' },
    { done: references.length > 0, label: 'Add a reference', tab: 'references' },
    { done: !!profile?.is_verified, label: 'Get verified', tab: 'profile' },
  ];
  const doneCount = checklist.filter((c) => c.done).length;
  const percent = Math.round((doneCount / checklist.length) * 100);
  const nextStep = checklist.find((c) => !c.done);

  const tabs = [
    { id: 'profile', label: 'Profile' },
    { id: 'experience', label: 'Experience', count: items.length },
    { id: 'references', label: 'References', count: references.length },
    { id: 'inbox', label: 'Inbox' },
    { id: 'work', label: 'Opportunities' },
  ];

  const fmtMonth = (d) => {
    if (!d) return '';
    const date = new Date(d);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
  };
  const dateRange = (item) => {
    const start = fmtMonth(item.start_date);
    const end = fmtMonth(item.end_date);
    if (!start && !end) return '';
    return `${start || '—'} – ${end || 'Present'}`;
  };

  return (
    <div className="rz max-w-3xl mx-auto space-y-4 pb-8">
      {/* Masthead — who you are, how complete the resume is, and your public link */}
      <header className="rz-card">
        <div className="flex items-center gap-4">
          {avatarUrl ? (
            <img src={avatarUrl} alt={displayName} className="w-16 h-16 sm:w-20 sm:h-20 rounded-full object-cover flex-shrink-0 border-2 border-[#c4a052]/60 shadow-lg" />
          ) : (
            <div className="rz-serif w-16 h-16 sm:w-20 sm:h-20 rounded-full flex-shrink-0 flex items-center justify-center text-2xl font-bold text-[#1c1408] bg-gradient-to-br from-[#e6c980] to-[#a17c28]">
              {displayName.charAt(0).toUpperCase()}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="rz-eyebrow">Curriculum Vitae</p>
            <h2 className="rz-serif text-xl sm:text-2xl font-bold text-white leading-tight break-words">{displayName}</h2>
            <p className="text-sm text-slate-300 mt-0.5 line-clamp-2">{form.headline || 'Add a headline to introduce yourself'}</p>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-xs text-slate-400">
              {form.location && <span className="inline-flex items-center gap-1"><MapPin className="w-3 h-3 text-[#c4a052]" />{form.location}</span>}
              {profile?.is_verified && (
                <span className="rz-badge text-emerald-300 bg-emerald-500/10 border border-emerald-500/30"><BadgeCheck className="w-3 h-3" /> Verified</span>
              )}
            </div>
          </div>
        </div>

        <div className="mt-4">
          <div className="flex items-center justify-between mb-1.5">
            <span className="rz-label !mb-0">Resume strength</span>
            <span className="text-xs font-semibold text-[#e6c980]">{percent}%</span>
          </div>
          <div className="rz-meter" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label="Resume completeness">
            <span style={{ width: `${percent}%` }} />
          </div>
          {nextStep ? (
            <button onClick={() => setActiveTab(nextStep.tab)} className="mt-2 text-xs text-slate-400 hover:text-[#e6c980] text-left transition-colors">
              Next step: <span className="text-slate-200 underline decoration-[#c4a052]/50 underline-offset-2">{nextStep.label}</span>
            </button>
          ) : (
            <p className="mt-2 text-xs text-emerald-300">Your resume is complete — nicely done.</p>
          )}
        </div>

        <div className="rz-rule" />

        <div>
          <label className="rz-label" htmlFor="rz-handle">Your public link</label>
          {handle && (
            <p className="text-sm text-slate-200 break-all mb-2.5 select-all">
              <Link2 className="w-3.5 h-3.5 text-[#c4a052] inline -mt-0.5 mr-1.5" />
              {shareUrl.replace(/^https?:\/\//, '')}
            </p>
          )}
          <div className="flex gap-2">
            <div className="flex-1 min-w-0 flex items-center rz-input !py-0">
              <span className="text-slate-500 text-sm mr-1 flex-shrink-0">/portfolio/</span>
              <input
                id="rz-handle"
                value={handleInput}
                onChange={(e) => setHandleInput(e.target.value)}
                placeholder="yourname"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className="bg-transparent outline-none flex-1 min-w-0 text-white py-2.5 text-[inherit]"
              />
            </div>
            <button onClick={saveHandle} disabled={savingHandle || !handleInput.trim() || handleInput === handle} className="rz-btn rz-btn-primary">
              {savingHandle ? 'Saving…' : handleSaved ? 'Saved' : 'Save'}
            </button>
          </div>
          {handleError && <p className="text-xs text-red-400 mt-1.5" role="alert">{handleError}</p>}

          {handle && (
            <div className="grid grid-cols-3 gap-2 mt-3">
              <button onClick={copyShareLink} className="rz-btn rz-btn-ghost rz-btn-sm !px-2">
                {linkCopied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                {linkCopied ? 'Copied' : 'Copy'}
              </button>
              <button onClick={() => setShowPreview(true)} className="rz-btn rz-btn-ghost rz-btn-sm !px-2">
                <Eye className="w-4 h-4" /> Preview
              </button>
              <button
                onClick={() => (canShare ? navigator.share({ title: 'My IcanEra Resume', url: shareUrl }).catch(() => {}) : copyShareLink())}
                className="rz-btn rz-btn-ghost rz-btn-sm !px-2"
              >
                <Share2 className="w-4 h-4" /> Share
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Section tabs */}
      <nav className="rz-tabs" role="tablist" aria-label="Resume sections">
        {tabs.map((t) => (
          <button key={t.id} role="tab" id={`rz-tab-${t.id}`} aria-selected={activeTab === t.id} aria-controls={`rz-panel-${t.id}`} className="rz-tab" onClick={() => setActiveTab(t.id)}>
            {t.label}
            {t.count > 0 && <span className="rz-tab-count">{t.count}</span>}
          </button>
        ))}
      </nav>

      <div role="tabpanel" id={`rz-panel-${activeTab}`} aria-labelledby={`rz-tab-${activeTab}`} key={activeTab} className="rz-panel space-y-4">
        {activeTab === 'profile' && (
          <>
            <section className="rz-card">
              <div className="rz-section-title"><h3>Resume Details</h3></div>
              <div className="space-y-4">
                <div>
                  <label className="rz-label" htmlFor="rz-headline">Headline</label>
                  <input
                    id="rz-headline"
                    value={form.headline}
                    onChange={(e) => setForm((f) => ({ ...f, headline: e.target.value }))}
                    placeholder="e.g. Senior Accountant | CMMS Certified"
                    maxLength={160}
                    className="rz-input"
                  />
                  <p className="rz-hint mt-1 text-right">{form.headline.length}/160</p>
                </div>
                <div>
                  <label className="rz-label" htmlFor="rz-summary">Professional summary</label>
                  <textarea
                    id="rz-summary"
                    value={form.summary}
                    onChange={(e) => setForm((f) => ({ ...f, summary: e.target.value }))}
                    placeholder="A few sentences on your background, strengths and what drives you…"
                    rows={5}
                    className="rz-input"
                  />
                </div>
                <div>
                  <label className="rz-label" htmlFor="rz-skills">Skills &amp; competencies</label>
                  <textarea
                    id="rz-skills"
                    value={form.skills}
                    onChange={(e) => setForm((f) => ({ ...f, skills: e.target.value }))}
                    placeholder="Separate with commas — e.g. Electro-Mechanical Troubleshooting, CAD/SolidWorks, Project Management"
                    rows={2}
                    className="rz-input"
                  />
                  {skillList.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2.5" aria-label="Skills preview">
                      {skillList.map((skill, i) => <span key={`${skill}-${i}`} className="rz-chip">{skill}</span>)}
                    </div>
                  )}
                </div>

                <div className="rz-rule !my-2" />

                <div>
                  <p className="rz-eyebrow mb-3">Contact · optional</p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="rz-label" htmlFor="rz-location"><MapPin className="w-3 h-3 inline -mt-0.5 mr-1" />Location</label>
                      <input id="rz-location" value={form.location} onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))} placeholder="Kampala, Uganda" className="rz-input" />
                    </div>
                    <div>
                      <label className="rz-label" htmlFor="rz-phone"><Phone className="w-3 h-3 inline -mt-0.5 mr-1" />Phone</label>
                      <input id="rz-phone" type="tel" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} placeholder="+256 700 000 000" className="rz-input" />
                    </div>
                    <div>
                      <label className="rz-label" htmlFor="rz-email"><Mail className="w-3 h-3 inline -mt-0.5 mr-1" />Email</label>
                      <input id="rz-email" type="email" value={form.contactEmail} onChange={(e) => setForm((f) => ({ ...f, contactEmail: e.target.value }))} placeholder="you@example.com" className="rz-input" />
                    </div>
                  </div>
                  <p className="rz-hint mt-2">Shown on your public page only if filled in — leave blank to keep them private.</p>
                </div>

                <div className="rz-rule !my-2" />

                <div>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <p className="rz-eyebrow flex items-center gap-1.5"><ExternalLink className="w-3.5 h-3.5" /> Links</p>
                    <button onClick={addLinkRow} className="rz-btn rz-btn-ghost rz-btn-sm"><Plus className="w-3.5 h-3.5" /> Add link</button>
                  </div>
                  <div className="space-y-2">
                    {linksList.map((row, i) => (
                      <div key={i} className="rz-link-row">
                        <div className="rz-link-fields">
                          <input value={row.label} onChange={(e) => updateLinkRow(i, 'label', e.target.value)} placeholder="Label (e.g. LinkedIn)" aria-label="Link label" className="rz-input" />
                          <input value={row.url} onChange={(e) => updateLinkRow(i, 'url', e.target.value)} placeholder="https://…" type="url" inputMode="url" autoCapitalize="none" aria-label="Link URL" className="rz-input" />
                        </div>
                        <button onClick={() => removeLinkRow(i)} className="rz-icon-btn danger" aria-label="Remove link"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    ))}
                    {linksList.length === 0 && <p className="rz-hint">No links yet — LinkedIn, GitHub or a personal site all work well.</p>}
                  </div>
                </div>

                <div className="rz-rule !my-2" />

                <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3">
                  <p className="rz-hint" aria-live="polite">
                    {profileError ? <span className="text-red-400" role="alert">{profileError}</span>
                      : isDirty ? <span className="text-amber-300">● Unsaved changes</span>
                      : profileSaved ? <span className="text-emerald-300">All changes saved</span> : ''}
                  </p>
                  <button onClick={saveProfileForm} disabled={isSavingProfile || !isDirty} className="rz-btn rz-btn-primary w-full sm:w-auto sm:min-w-[11rem]">
                    {isSavingProfile ? 'Saving…' : profileSaved ? 'Saved' : 'Save Details'}
                  </button>
                </div>
              </div>
            </section>

            <section className="rz-card">
              <div className="rz-section-title"><h3>Verification</h3></div>
              <div className="flex items-start gap-3">
                <ShieldCheck className={`w-5 h-5 mt-0.5 flex-shrink-0 ${profile?.is_verified ? 'text-emerald-400' : 'text-[#c4a052]'}`} />
                <p className="text-sm text-slate-300">
                  {profile?.is_verified
                    ? 'Your profile is verified — a badge appears on your public resume.'
                    : "Upload an ID or certificate. Your firm (if you're a CMMS member) or the IcanEra team can confirm it."}
                </p>
              </div>
              <label className={`rz-btn rz-btn-ghost rz-btn-sm mt-3 cursor-pointer ${isUploadingDoc ? 'opacity-60 pointer-events-none' : ''}`}>
                {isUploadingDoc ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                {isUploadingDoc ? 'Uploading…' : 'Upload document'}
                <input type="file" accept="image/*,.pdf" className="hidden" onChange={uploadDoc} disabled={isUploadingDoc} />
              </label>

              {verifications.length > 0 && (
                <ul className="mt-3 divide-y divide-[#c4a052]/15 border-t border-[#c4a052]/15">
                  {verifications.map((v) => (
                    <li key={v.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                      <span className="text-slate-300 min-w-0 truncate">{v.document_type} <span className="text-slate-500">· {new Date(v.created_at).toLocaleDateString()}</span></span>
                      <span className="flex items-center gap-1 flex-shrink-0">
                        <span className={`rz-badge ${v.status === 'approved' ? 'text-emerald-300 bg-emerald-500/10' : v.status === 'rejected' ? 'text-red-300 bg-red-500/10' : 'text-amber-300 bg-amber-500/10'}`}>
                          {v.status}
                        </span>
                        <button
                          onClick={() => removeVerification(v)}
                          disabled={removingVerificationId === v.id}
                          className="rz-icon-btn danger disabled:opacity-40"
                          aria-label="Remove document"
                          title={v.status === 'approved' ? 'Remove — this will un-verify your profile' : 'Remove this submission'}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}

        {activeTab === 'experience' && (
          <section className="rz-card">
            <div className="rz-section-title">
              <h3>Experience &amp; Achievements</h3>
              <div className="rz-actions">
                {cmmsMember && (
                  <button onClick={refreshCmms} disabled={isSyncing} className="rz-icon-btn" aria-label="Sync from CMMS" title="Sync from CMMS">
                    <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
                  </button>
                )}
                <button onClick={openAddItem} className="rz-btn rz-btn-primary rz-btn-sm"><Plus className="w-4 h-4" /> Add</button>
              </div>
            </div>

            {!cmmsMember && !itemForm && timelineItems.length > 0 && (
              <p className="rz-hint mb-4">Add your work history below. Active CMMS team members get this auto-tracked.</p>
            )}

            {itemForm && (
              <div className="mb-5 p-4 rounded-xl border border-[#c4a052]/40 bg-[#c4a052]/[0.05] space-y-3">
                <p className="rz-eyebrow">{editingItemId ? 'Edit entry' : 'New entry'}</p>
                <div>
                  <label className="rz-label" htmlFor="rz-item-type">Type</label>
                  <select id="rz-item-type" value={itemForm.itemType} onChange={(e) => setItemForm((f) => ({ ...f, itemType: e.target.value }))} className="rz-input">
                    {Object.entries(ITEM_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="rz-label" htmlFor="rz-item-title">Title</label>
                    <input id="rz-item-title" value={itemForm.title} onChange={(e) => setItemForm((f) => ({ ...f, title: e.target.value }))} placeholder="Operations Manager" className="rz-input" />
                  </div>
                  <div>
                    <label className="rz-label" htmlFor="rz-item-org">Organization</label>
                    <input id="rz-item-org" value={itemForm.orgName} onChange={(e) => setItemForm((f) => ({ ...f, orgName: e.target.value }))} placeholder="Company or institution" className="rz-input" />
                  </div>
                </div>
                <div>
                  <label className="rz-label" htmlFor="rz-item-desc">Description</label>
                  <textarea id="rz-item-desc" value={itemForm.description} onChange={(e) => setItemForm((f) => ({ ...f, description: e.target.value }))} placeholder="What you did and what you achieved" rows={3} className="rz-input" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="rz-label" htmlFor="rz-item-start">Start</label>
                    <input id="rz-item-start" type="date" value={itemForm.startDate} onChange={(e) => setItemForm((f) => ({ ...f, startDate: e.target.value }))} className="rz-input" />
                  </div>
                  <div>
                    <label className="rz-label" htmlFor="rz-item-end">End</label>
                    <input id="rz-item-end" type="date" value={itemForm.endDate} onChange={(e) => setItemForm((f) => ({ ...f, endDate: e.target.value }))} className="rz-input" />
                  </div>
                </div>
                <p className="rz-hint -mt-1">Leave the end date empty if you're still here — it will read “Present”.</p>
                {itemError && <p className="text-xs text-red-400" role="alert">{itemError}</p>}
                <div className="flex gap-2 justify-end">
                  <button onClick={() => { setItemForm(null); setEditingItemId(null); setItemError(null); }} className="rz-btn rz-btn-ghost">Cancel</button>
                  <button onClick={saveItemForm} className="rz-btn rz-btn-primary">Save entry</button>
                </div>
              </div>
            )}

            {timelineItems.length > 0 ? (
              <ol className="rz-timeline">
                {timelineItems.map((item) => {
                  const Icon = ITEM_ICONS[item.item_type] || Briefcase;
                  const range = dateRange(item);
                  return (
                    <li key={item.id}>
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          {range && <p className="text-[0.7rem] font-semibold tracking-wider uppercase text-[#e6c980]">{range}</p>}
                          <h4 className="rz-serif text-base font-bold text-white leading-snug break-words">{item.title}</h4>
                          {item.org_name && <p className="text-sm text-slate-300">{item.org_name}</p>}
                          <div className="flex flex-wrap items-center gap-1.5 mt-1">
                            <span className="rz-badge text-[#e6c980] bg-[#c4a052]/10 border border-[#c4a052]/25"><Icon className="w-3 h-3" />{ITEM_TYPE_LABELS[item.item_type] || 'Experience'}</span>
                            {item.source === 'cmms' && <span className="rz-badge text-blue-300 bg-blue-500/10 border border-blue-500/30">Auto · CMMS</span>}
                          </div>
                          {item.description && <p className="text-sm text-slate-400 mt-2 leading-relaxed whitespace-pre-line">{item.description}</p>}
                        </div>
                        {item.source === 'manual' && (
                          <div className="flex flex-shrink-0 -mr-1.5 -mt-1">
                            <button onClick={() => openEditItem(item)} className="rz-icon-btn" aria-label={`Edit ${item.title}`}><Edit2 className="w-4 h-4" /></button>
                            <button onClick={() => removeItem(item.id)} className="rz-icon-btn danger" aria-label={`Remove ${item.title}`}><Trash2 className="w-4 h-4" /></button>
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            ) : (
              !itemForm && (
                <div className="rz-empty">
                  <Briefcase className="w-8 h-8 mx-auto text-[#c4a052]/70" />
                  <p className="rz-serif">Your story starts here</p>
                  <p className="text-sm">Add jobs, projects, education and achievements.</p>
                  <button onClick={openAddItem} className="rz-btn rz-btn-primary mt-4"><Plus className="w-4 h-4" /> Add first entry</button>
                </div>
              )
            )}
          </section>
        )}

        {activeTab === 'references' && (
          <section className="rz-card">
            <div className="rz-section-title">
              <h3>References</h3>
              <div className="rz-actions">
                <button onClick={openAddReference} className="rz-btn rz-btn-primary rz-btn-sm"><Plus className="w-4 h-4" /> Add</button>
              </div>
            </div>

            {referenceForm && (
              <div className="mb-5 p-4 rounded-xl border border-[#c4a052]/40 bg-[#c4a052]/[0.05] space-y-3">
                <p className="rz-eyebrow">{editingReferenceId ? 'Edit reference' : 'New reference'}</p>
                <div>
                  <label className="rz-label" htmlFor="rz-ref-name">Full name</label>
                  <input id="rz-ref-name" value={referenceForm.name} onChange={(e) => setReferenceForm((f) => ({ ...f, name: e.target.value }))} placeholder="Prof. John Baptist Kirabira" className="rz-input" />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="rz-label" htmlFor="rz-ref-title">Title / role</label>
                    <input id="rz-ref-title" value={referenceForm.title} onChange={(e) => setReferenceForm((f) => ({ ...f, title: e.target.value }))} placeholder="Professor, Mechanical Engineering" className="rz-input" />
                  </div>
                  <div>
                    <label className="rz-label" htmlFor="rz-ref-org">Organization</label>
                    <input id="rz-ref-org" value={referenceForm.organization} onChange={(e) => setReferenceForm((f) => ({ ...f, organization: e.target.value }))} placeholder="Makerere University" className="rz-input" />
                  </div>
                  <div>
                    <label className="rz-label" htmlFor="rz-ref-email">Email</label>
                    <input id="rz-ref-email" type="email" value={referenceForm.email} onChange={(e) => setReferenceForm((f) => ({ ...f, email: e.target.value }))} placeholder="Optional" className="rz-input" />
                  </div>
                  <div>
                    <label className="rz-label" htmlFor="rz-ref-phone">Phone</label>
                    <input id="rz-ref-phone" type="tel" value={referenceForm.phone} onChange={(e) => setReferenceForm((f) => ({ ...f, phone: e.target.value }))} placeholder="Optional" className="rz-input" />
                  </div>
                </div>
                {referenceError && <p className="text-xs text-red-400" role="alert">{referenceError}</p>}
                <div className="flex gap-2 justify-end">
                  <button onClick={() => { setReferenceForm(null); setEditingReferenceId(null); setReferenceError(null); }} className="rz-btn rz-btn-ghost">Cancel</button>
                  <button onClick={saveReferenceForm} className="rz-btn rz-btn-primary">Save reference</button>
                </div>
              </div>
            )}

            {references.length > 0 ? (
              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {references.map((ref) => (
                  <li key={ref.id} className="p-4 rounded-xl bg-slate-950/40 border border-[#c4a052]/20">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <h4 className="rz-serif text-base font-bold text-white break-words">{ref.name}</h4>
                        {(ref.title || ref.organization) && (
                          <p className="text-sm text-[#e6c980]/90 mt-0.5">{[ref.title, ref.organization].filter(Boolean).join(' — ')}</p>
                        )}
                        <div className="mt-2 space-y-1 text-sm text-slate-400">
                          {ref.email && <a href={`mailto:${ref.email}`} className="flex items-center gap-1.5 hover:text-white break-all"><Mail className="w-3.5 h-3.5 text-[#c4a052] flex-shrink-0" />{ref.email}</a>}
                          {ref.phone && <a href={`tel:${ref.phone}`} className="flex items-center gap-1.5 hover:text-white"><Phone className="w-3.5 h-3.5 text-[#c4a052] flex-shrink-0" />{ref.phone}</a>}
                        </div>
                      </div>
                      <div className="flex flex-shrink-0 -mr-1.5 -mt-1">
                        <button onClick={() => openEditReference(ref)} className="rz-icon-btn" aria-label={`Edit ${ref.name}`}><Edit2 className="w-4 h-4" /></button>
                        <button onClick={() => removeReference(ref.id)} className="rz-icon-btn danger" aria-label={`Remove ${ref.name}`}><Trash2 className="w-4 h-4" /></button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              !referenceForm && (
                <div className="rz-empty">
                  <Users className="w-8 h-8 mx-auto text-[#c4a052]/70" />
                  <p className="rz-serif">Let others vouch for you</p>
                  <p className="text-sm">Add a lecturer, manager or client who can speak to your work.</p>
                  <button onClick={openAddReference} className="rz-btn rz-btn-primary mt-4"><Plus className="w-4 h-4" /> Add reference</button>
                </div>
              )
            )}
          </section>
        )}

        {/* Messages — direct 1:1 chats started from the public resume page */}
        {activeTab === 'inbox' && (
          <>
            <PortfolioMessagesInbox userId={user?.id} />
            {/* Certificate requests — companies asking for your academic certificate from the public resume page */}
            <CertificateRequestsInbox />
          </>
        )}

        {/* Bid for Work — browse open business opportunities and bid as yourself */}
        {activeTab === 'work' && (
          <ResumeOpportunityBidsPanel userId={user?.id} displayName={profile?.full_name || user?.email} />
        )}
      </div>

      <footer className="text-center pt-2">
        <div className="rz-rule" />
        <p className="text-xs text-slate-500">Powered by <span className="rz-serif font-bold text-[#e6c980]">IcanEra</span></p>
      </footer>

      {showPreview && handle && <PublicPortfolioPage handle={handle} onClose={() => setShowPreview(false)} />}
    </div>
  );
}
