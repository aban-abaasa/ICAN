import React, { useEffect, useState } from 'react';
import {
  Link2, Copy, Eye, Plus, Trash2, Edit2, RefreshCw, Upload, ShieldCheck,
  Briefcase, Award, GraduationCap, FolderKanban, Rocket, FlaskConical, Presentation,
  Loader2, Check, X as XIcon, Users, ExternalLink,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import {
  getMyPortfolio, upsertPortfolio, setHandle as setHandleRemote,
  getPortfolioItems, addPortfolioItem, updatePortfolioItem, deletePortfolioItem,
  getPortfolioReferences, addPortfolioReference, updatePortfolioReference, deletePortfolioReference,
  isCmmsMember, syncCmmsPortfolioItems,
  uploadVerificationDocument, getMyVerifications,
  getReviewableVerifications, reviewVerification,
} from '../../services/portfolioService';
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
  const { user, profile, getAvatarUrl } = useAuth();

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
  const [reviewQueue, setReviewQueue] = useState([]);

  const [showPreview, setShowPreview] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const load = async () => {
    if (!user?.id) return;
    setIsLoading(true);
    try {
      const [{ portfolio, handle: h }, portfolioItems, portfolioReferences, memberCheck, myDocs, reviewable] = await Promise.all([
        getMyPortfolio(user.id),
        getPortfolioItems(user.id),
        getPortfolioReferences(user.id),
        isCmmsMember(user.email),
        getMyVerifications(user.id),
        getReviewableVerifications().catch(() => []),
      ]);

      setHandleState(h || '');
      setHandleInput(h || '');
      setForm({
        headline: portfolio?.headline || '',
        summary: portfolio?.summary || '',
        skills: (portfolio?.skills || []).join(', '),
        links: portfolio?.links || {},
        location: portfolio?.location || '',
        phone: portfolio?.phone || '',
        contactEmail: portfolio?.contact_email || '',
      });
      setLinksList(Object.entries(portfolio?.links || {}).map(([label, url]) => ({ label, url })));
      setItems(portfolioItems);
      setReferences(portfolioReferences);
      setCmmsMember(memberCheck);
      setVerifications(myDocs);
      setReviewQueue(reviewable);

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
        await updatePortfolioItem(editingItemId, itemForm);
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
    try {
      await deletePortfolioItem(itemId);
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
        await updatePortfolioReference(editingReferenceId, referenceForm);
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
    try {
      await deletePortfolioReference(referenceId);
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

  const decideReview = async (docId, approve) => {
    try {
      await reviewVerification(docId, approve);
      setReviewQueue(await getReviewableVerifications());
    } catch (err) {
      console.error('Error reviewing document:', err);
    }
  };

  if (isLoading) {
    return <div className="py-16 text-center text-amber-200/70">Loading your resume &amp; portfolio...</div>;
  }

  return (
    <div className="space-y-5">
      {/* Handle + share link */}
      <div className="bg-slate-900/50 border border-amber-700/30 rounded-xl p-4">
        <h3 className="text-white font-semibold mb-2 flex items-center gap-2">
          <Link2 className="w-4 h-4 text-amber-400" /> Your public link
        </h3>
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="flex-1 flex items-center bg-slate-950/50 border border-slate-700 rounded-lg px-3 py-2 text-sm text-gray-300">
            <span className="text-gray-500 mr-1">{window.location.origin}/portfolio/</span>
            <input
              value={handleInput}
              onChange={(e) => setHandleInput(e.target.value)}
              placeholder="yourname"
              className="bg-transparent outline-none flex-1 text-white min-w-0"
            />
          </div>
          <button
            onClick={saveHandle}
            disabled={savingHandle || handleInput === handle}
            className="px-4 py-2 bg-gradient-to-r from-amber-700 to-purple-600 hover:from-amber-600 hover:to-purple-500 text-white rounded-lg text-sm font-medium disabled:opacity-50"
          >
            {savingHandle ? 'Saving...' : handleSaved ? 'Saved!' : 'Save'}
          </button>
        </div>
        {handleError && <p className="text-xs text-red-400 mt-1.5">{handleError}</p>}

        {handle && (
          <div className="flex items-center gap-2 mt-3">
            <button
              onClick={copyShareLink}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white text-xs rounded-lg"
            >
              <Copy className="w-3.5 h-3.5" /> Copy Link
            </button>
            <button
              onClick={() => setShowPreview(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white text-xs rounded-lg"
            >
              <Eye className="w-3.5 h-3.5" /> Preview Public Page
            </button>
            {typeof navigator !== 'undefined' && navigator.share && (
              <button
                onClick={() => navigator.share({ title: 'My IcanEra Portfolio', url: shareUrl })}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white text-xs rounded-lg"
              >
                Share
              </button>
            )}
          </div>
        )}
      </div>

      {/* Headline / summary / skills */}
      <div className="bg-slate-900/50 border border-purple-700/30 rounded-xl p-4 space-y-3">
        <h3 className="text-white font-semibold">Resume Details</h3>
        <input
          value={form.headline}
          onChange={(e) => setForm((f) => ({ ...f, headline: e.target.value }))}
          placeholder="Headline (e.g. Senior Accountant | CMMS Certified)"
          maxLength={160}
          className="w-full px-3 py-2 bg-slate-950/50 border border-slate-700 rounded-lg text-white placeholder-gray-500 text-sm"
        />
        <textarea
          value={form.summary}
          onChange={(e) => setForm((f) => ({ ...f, summary: e.target.value }))}
          placeholder="Professional summary — a few sentences on your background, strengths and what you're driven by..."
          rows={4}
          className="w-full px-3 py-2 bg-slate-950/50 border border-slate-700 rounded-lg text-white placeholder-gray-500 text-sm resize-none"
        />
        <textarea
          value={form.skills}
          onChange={(e) => setForm((f) => ({ ...f, skills: e.target.value }))}
          placeholder="Core competencies & technical skills, comma separated (e.g. Electro-Mechanical Troubleshooting, CAD/SolidWorks, Project Management)"
          rows={2}
          className="w-full px-3 py-2 bg-slate-950/50 border border-slate-700 rounded-lg text-white placeholder-gray-500 text-sm resize-none"
        />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <input
            value={form.location}
            onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
            placeholder="Location (e.g. Kampala, Uganda)"
            className="w-full px-3 py-2 bg-slate-950/50 border border-slate-700 rounded-lg text-white placeholder-gray-500 text-sm"
          />
          <input
            value={form.phone}
            onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
            placeholder="Public phone (optional)"
            className="w-full px-3 py-2 bg-slate-950/50 border border-slate-700 rounded-lg text-white placeholder-gray-500 text-sm"
          />
          <input
            value={form.contactEmail}
            onChange={(e) => setForm((f) => ({ ...f, contactEmail: e.target.value }))}
            placeholder="Public email (optional)"
            className="w-full px-3 py-2 bg-slate-950/50 border border-slate-700 rounded-lg text-white placeholder-gray-500 text-sm"
          />
        </div>
        <p className="text-[11px] text-gray-500">
          Location/phone/email above are shown on your public page only if you fill them in — leave blank to keep them private.
        </p>

        <div className="pt-1">
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-xs font-medium text-gray-300 flex items-center gap-1.5">
              <ExternalLink className="w-3.5 h-3.5 text-amber-400" /> Links (LinkedIn, website, GitHub, etc.)
            </p>
            <button onClick={addLinkRow} className="flex items-center gap-1 px-2 py-1 bg-slate-800 hover:bg-slate-700 text-white text-xs rounded-lg">
              <Plus className="w-3 h-3" /> Add Link
            </button>
          </div>
          <div className="space-y-1.5">
            {linksList.map((row, i) => (
              <div key={i} className="flex gap-1.5">
                <input
                  value={row.label}
                  onChange={(e) => updateLinkRow(i, 'label', e.target.value)}
                  placeholder="Label (e.g. LinkedIn)"
                  className="w-32 flex-shrink-0 px-2 py-1.5 bg-slate-950/50 border border-slate-700 rounded-lg text-white placeholder-gray-500 text-xs"
                />
                <input
                  value={row.url}
                  onChange={(e) => updateLinkRow(i, 'url', e.target.value)}
                  placeholder="https://..."
                  className="flex-1 min-w-0 px-2 py-1.5 bg-slate-950/50 border border-slate-700 rounded-lg text-white placeholder-gray-500 text-xs"
                />
                <button onClick={() => removeLinkRow(i)} className="p-1.5 hover:bg-slate-800 rounded text-red-400 flex-shrink-0">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
            {linksList.length === 0 && <p className="text-xs text-gray-500">No links added yet.</p>}
          </div>
        </div>

        <button
          onClick={saveProfileForm}
          disabled={isSavingProfile}
          className="px-4 py-2 bg-gradient-to-r from-amber-700 to-purple-600 hover:from-amber-600 hover:to-purple-500 text-white rounded-lg text-sm font-medium disabled:opacity-50"
        >
          {isSavingProfile ? 'Saving...' : profileSaved ? 'Saved!' : 'Save Details'}
        </button>
        {profileError && <p className="text-xs text-red-400">{profileError}</p>}
      </div>

      {/* Verification */}
      <div className="bg-slate-900/50 border border-emerald-700/30 rounded-xl p-4">
        <h3 className="text-white font-semibold mb-2 flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-emerald-400" /> Verification
        </h3>
        <p className="text-xs text-gray-400 mb-3">
          {profile?.is_verified
            ? 'Your profile is verified.'
            : 'Upload an ID or certificate. Your firm (if you\'re a CMMS member) or the IcanEra team can confirm it.'}
        </p>
        <label className="inline-flex items-center gap-2 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white text-xs rounded-lg cursor-pointer">
          <Upload className="w-3.5 h-3.5" />
          {isUploadingDoc ? 'Uploading...' : 'Upload Document'}
          <input type="file" accept="image/*,.pdf" className="hidden" onChange={uploadDoc} disabled={isUploadingDoc} />
        </label>

        {verifications.length > 0 && (
          <div className="mt-3 space-y-1.5">
            {verifications.map((v) => (
              <div key={v.id} className="flex items-center justify-between text-xs bg-slate-950/40 rounded px-2.5 py-1.5">
                <span className="text-gray-300">{v.document_type} · {new Date(v.created_at).toLocaleDateString()}</span>
                <span className={
                  v.status === 'approved' ? 'text-emerald-400' : v.status === 'rejected' ? 'text-red-400' : 'text-yellow-400'
                }>
                  {v.status}
                </span>
              </div>
            ))}
          </div>
        )}

        {reviewQueue.length > 0 && (
          <div className="mt-4 pt-4 border-t border-slate-700/50">
            <p className="text-xs font-semibold text-amber-300 mb-2">Pending verifications for your review</p>
            <div className="space-y-2">
              {reviewQueue.map((doc) => (
                <div key={doc.id} className="flex items-center justify-between bg-slate-950/40 rounded-lg px-3 py-2">
                  <span className="text-xs text-gray-300">{doc.profile?.full_name || doc.profile?.email}</span>
                  <div className="flex gap-1.5">
                    <button onClick={() => decideReview(doc.id, true)} className="p-1.5 bg-emerald-600/20 hover:bg-emerald-600/40 rounded text-emerald-400">
                      <Check className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => decideReview(doc.id, false)} className="p-1.5 bg-red-600/20 hover:bg-red-600/40 rounded text-red-400">
                      <XIcon className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Timeline */}
      <div className="bg-slate-900/50 border border-amber-700/30 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-white font-semibold">Experience &amp; Achievements</h3>
          <div className="flex gap-2">
            {cmmsMember && (
              <button onClick={refreshCmms} disabled={isSyncing} className="p-1.5 bg-slate-800 hover:bg-slate-700 rounded-lg text-amber-300">
                <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
              </button>
            )}
            <button onClick={openAddItem} className="flex items-center gap-1 px-2.5 py-1.5 bg-purple-600 hover:bg-purple-500 text-white text-xs rounded-lg">
              <Plus className="w-3.5 h-3.5" /> Add
            </button>
          </div>
        </div>

        {!cmmsMember && (
          <p className="text-xs text-gray-400 mb-3">
            Add your work history manually below. Active CMMS team members get this auto-tracked.
          </p>
        )}

        {itemForm && (
          <div className="mb-3 p-3 bg-slate-950/50 border border-purple-600/30 rounded-lg space-y-2">
            <select
              value={itemForm.itemType}
              onChange={(e) => setItemForm((f) => ({ ...f, itemType: e.target.value }))}
              className="w-full px-2 py-1.5 bg-slate-900 border border-slate-700 rounded text-white text-xs"
            >
              {Object.entries(ITEM_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            <input
              value={itemForm.title}
              onChange={(e) => setItemForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="Title (e.g. Operations Manager)"
              className="w-full px-2 py-1.5 bg-slate-900 border border-slate-700 rounded text-white text-xs"
            />
            <input
              value={itemForm.orgName}
              onChange={(e) => setItemForm((f) => ({ ...f, orgName: e.target.value }))}
              placeholder="Organization"
              className="w-full px-2 py-1.5 bg-slate-900 border border-slate-700 rounded text-white text-xs"
            />
            <textarea
              value={itemForm.description}
              onChange={(e) => setItemForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Description"
              rows={2}
              className="w-full px-2 py-1.5 bg-slate-900 border border-slate-700 rounded text-white text-xs resize-none"
            />
            <div className="flex gap-2">
              <input
                type="date"
                value={itemForm.startDate}
                onChange={(e) => setItemForm((f) => ({ ...f, startDate: e.target.value }))}
                className="flex-1 px-2 py-1.5 bg-slate-900 border border-slate-700 rounded text-white text-xs"
              />
              <input
                type="date"
                value={itemForm.endDate}
                onChange={(e) => setItemForm((f) => ({ ...f, endDate: e.target.value }))}
                className="flex-1 px-2 py-1.5 bg-slate-900 border border-slate-700 rounded text-white text-xs"
              />
            </div>
            <div className="flex gap-2">
              <button onClick={saveItemForm} className="px-3 py-1.5 bg-purple-600 hover:bg-purple-500 text-white text-xs rounded-lg">
                Save
              </button>
              <button onClick={() => { setItemForm(null); setItemError(null); }} className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white text-xs rounded-lg">
                Cancel
              </button>
            </div>
            {itemError && <p className="text-xs text-red-400">{itemError}</p>}
          </div>
        )}

        <div className="space-y-2">
          {[...cmmsItems, ...manualItems].map((item) => {
            const Icon = ITEM_ICONS[item.item_type] || Briefcase;
            return (
              <div key={item.id} className="flex items-start gap-3 p-2.5 bg-slate-950/30 rounded-lg">
                <Icon className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm text-white font-medium">{item.title}</p>
                    {item.source === 'cmms' && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30">
                        Auto · CMMS
                      </span>
                    )}
                  </div>
                  {item.org_name && <p className="text-xs text-amber-200/70">{item.org_name}</p>}
                  {item.description && <p className="text-xs text-gray-400 mt-0.5">{item.description}</p>}
                </div>
                {item.source === 'manual' && (
                  <div className="flex gap-1 flex-shrink-0">
                    <button onClick={() => openEditItem(item)} className="p-1.5 hover:bg-slate-800 rounded text-gray-400">
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => removeItem(item.id)} className="p-1.5 hover:bg-slate-800 rounded text-red-400">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
          {items.length === 0 && !itemForm && (
            <p className="text-sm text-gray-500 text-center py-4">No entries yet — add your first one.</p>
          )}
        </div>
      </div>

      {/* References */}
      <div className="bg-slate-900/50 border border-purple-700/30 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-white font-semibold flex items-center gap-2">
            <Users className="w-4 h-4 text-purple-400" /> References
          </h3>
          <button onClick={openAddReference} className="flex items-center gap-1 px-2.5 py-1.5 bg-purple-600 hover:bg-purple-500 text-white text-xs rounded-lg">
            <Plus className="w-3.5 h-3.5" /> Add
          </button>
        </div>

        {referenceForm && (
          <div className="mb-3 p-3 bg-slate-950/50 border border-purple-600/30 rounded-lg space-y-2">
            <input
              value={referenceForm.name}
              onChange={(e) => setReferenceForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Full name (e.g. Prof. John Baptist Kirabira)"
              className="w-full px-2 py-1.5 bg-slate-900 border border-slate-700 rounded text-white text-xs"
            />
            <input
              value={referenceForm.title}
              onChange={(e) => setReferenceForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="Title / role (e.g. Professor, Department of Mechanical Engineering)"
              className="w-full px-2 py-1.5 bg-slate-900 border border-slate-700 rounded text-white text-xs"
            />
            <input
              value={referenceForm.organization}
              onChange={(e) => setReferenceForm((f) => ({ ...f, organization: e.target.value }))}
              placeholder="Organization"
              className="w-full px-2 py-1.5 bg-slate-900 border border-slate-700 rounded text-white text-xs"
            />
            <div className="flex gap-2">
              <input
                value={referenceForm.email}
                onChange={(e) => setReferenceForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="Email (optional)"
                className="flex-1 px-2 py-1.5 bg-slate-900 border border-slate-700 rounded text-white text-xs"
              />
              <input
                value={referenceForm.phone}
                onChange={(e) => setReferenceForm((f) => ({ ...f, phone: e.target.value }))}
                placeholder="Phone (optional)"
                className="flex-1 px-2 py-1.5 bg-slate-900 border border-slate-700 rounded text-white text-xs"
              />
            </div>
            <div className="flex gap-2">
              <button onClick={saveReferenceForm} className="px-3 py-1.5 bg-purple-600 hover:bg-purple-500 text-white text-xs rounded-lg">
                Save
              </button>
              <button onClick={() => { setReferenceForm(null); setReferenceError(null); }} className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white text-xs rounded-lg">
                Cancel
              </button>
            </div>
            {referenceError && <p className="text-xs text-red-400">{referenceError}</p>}
          </div>
        )}

        <div className="space-y-2">
          {references.map((ref) => (
            <div key={ref.id} className="flex items-start gap-3 p-2.5 bg-slate-950/30 rounded-lg">
              <Users className="w-4 h-4 text-purple-400 mt-0.5 flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-white font-medium">{ref.name}</p>
                {(ref.title || ref.organization) && (
                  <p className="text-xs text-amber-200/70">{[ref.title, ref.organization].filter(Boolean).join(' — ')}</p>
                )}
                {(ref.email || ref.phone) && (
                  <p className="text-xs text-gray-400 mt-0.5">{[ref.email, ref.phone].filter(Boolean).join(' · ')}</p>
                )}
              </div>
              <div className="flex gap-1 flex-shrink-0">
                <button onClick={() => openEditReference(ref)} className="p-1.5 hover:bg-slate-800 rounded text-gray-400">
                  <Edit2 className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => removeReference(ref.id)} className="p-1.5 hover:bg-slate-800 rounded text-red-400">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
          {references.length === 0 && !referenceForm && (
            <p className="text-sm text-gray-500 text-center py-4">No references yet — add someone who can vouch for your work.</p>
          )}
        </div>
      </div>

      <div className="text-center text-xs text-amber-200/50 pt-2">
        Powered by <span className="font-semibold text-amber-300">IcanEra</span>
      </div>

      {showPreview && handle && <PublicPortfolioPage handle={handle} onClose={() => setShowPreview(false)} />}
    </div>
  );
}
