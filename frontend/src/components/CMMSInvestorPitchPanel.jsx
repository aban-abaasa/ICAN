import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Video, FileUp, Eye, Heart, Loader, AlertCircle, ExternalLink, Sparkles, Lock, FileText, ArrowLeft, Globe, Pencil, Image as ImageIcon } from 'lucide-react';
import { supabase } from '../lib/supabase/client';
import { uploadToR2 } from '../services/r2StorageService';
import { brandPitchDeck } from '../utils/pptxBranding';
import PitchVideoRecorder from './PitchVideoRecorder';
import PrivatePitchInviteModal from './PrivatePitchInviteModal';
import BusinessProfileDocuments from './BusinessProfileDocuments';
import usePitchPlanLiveData from '../hooks/usePitchPlanLiveData';
import {
  getPitchesByBusinessProfileId,
  createManagedPitch,
  editManagedPitchPlan,
  updateManagedPitch,
  deleteManagedPitch,
  uploadVideo,
} from '../services/pitchingService';

const fmtCount = (n) => {
  const v = Number(n || 0);
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return `${v}`;
};

const noop = () => {};

// The wizard pre-fills its fields with "[Enter ...]" prompts; those must never
// reach the public page, so any line still holding one is dropped.
const stripPlaceholders = (text) =>
  String(text || '')
    .split('\n')
    .filter((line) => !/\[[^\]\n]*\]/.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

// Same ivory/purple look as the surrounding CMMS tabs (cap- variables come from
// the parent .cap-scope). Own prefix so nothing here can be repainted by the
// app theme.
const IP_STYLES = `
@keyframes ip-rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
@keyframes ip-sheen { from { transform: translateX(-120%); } to { transform: translateX(120%); } }
.ip-rise { animation: ip-rise .35s ease-out backwards; }
.ip-btn { position: relative; overflow: hidden; display: flex; align-items: center; justify-content: center; gap: .5rem; padding: .7rem 1rem; border-radius: .85rem; font-size: .875rem; font-weight: 600; transition: transform .2s, box-shadow .2s, background .2s; }
.ip-btn:hover:not(:disabled) { transform: translateY(-2px); }
.ip-btn:active:not(:disabled) { transform: translateY(0) scale(.98); }
.ip-btn:disabled { opacity: .55; }
.ip-btn-primary { color: #fff; background: linear-gradient(135deg, #7c3aed, #4f46e5); box-shadow: 0 8px 20px -10px rgba(79, 70, 229, .7); }
.ip-btn-primary:hover:not(:disabled) { box-shadow: 0 12px 24px -10px rgba(79, 70, 229, .85); }
.ip-btn-primary::after { content: ''; position: absolute; inset: 0; background: linear-gradient(100deg, transparent 30%, rgba(255,255,255,.28) 50%, transparent 70%); transform: translateX(-120%); }
.ip-btn-primary:hover::after { animation: ip-sheen .9s ease; }
.ip-btn-soft { color: var(--cap-text); background: var(--cap-surface); border: 1px solid var(--cap-border); box-shadow: 0 1px 2px rgba(44, 36, 22, .06); }
.ip-btn-soft:hover:not(:disabled) { background: var(--cap-surface-hover); }
.ip-row { transition: transform .2s, box-shadow .2s; }
.ip-row:hover { transform: translateY(-2px); box-shadow: 0 12px 24px -16px rgba(44, 36, 22, .35); }
.ip-icon-btn { color: var(--cap-text-muted); transition: background .2s, color .2s; }
.ip-icon-btn:hover { color: var(--cap-purple-text); background: var(--cap-surface-hover); }
@media (prefers-reduced-motion: reduce) { .ip-rise, .ip-btn, .ip-row { animation: none !important; transition: none !important; } }
`;

/**
 * CMMS "Investor pitch" tab (CMMSAnnouncementsPanel.jsx) -- lets a company
 * admin publish a Pitchin investor pitch for the business linked via the
 * "Board profile" tab, without leaving CMMS. Three ways, usable together:
 *  - Write plan: the same five documents Pitchin collects (business plan,
 *    financials, value proposition, MOU, share terms -- BusinessProfileDocuments),
 *    published as a plan card on the public board. No video needed.
 *  - Record video: PitchVideoRecorder as-is.
 *  - Import deck: a branded .pptx.
 * Everything goes through the co-owner-aware RPCs in pitchingService.js.
 */
const CMMSInvestorPitchPanel = ({ businessProfileId, cmmsCompanyId = null }) => {
  const [profile, setProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [pitches, setPitches] = useState([]);
  const [pitchesLoading, setPitchesLoading] = useState(true);
  const [showRecorder, setShowRecorder] = useState(false);
  const [creating, setCreating] = useState(false);
  const [importingDeck, setImportingDeck] = useState(false);
  const [invitePitch, setInvitePitch] = useState(null);
  const [showPlan, setShowPlan] = useState(false);
  const [publishingPlan, setPublishingPlan] = useState(false);
  // The published plan pitch being edited (null = writing a new plan).
  const [editingPitch, setEditingPitch] = useState(null);
  // Optional cover image for the written plan (stored in plan_content.image_url).
  const [planImage, setPlanImage] = useState('');
  const [uploadingImage, setUploadingImage] = useState(false);
  const docsRef = useRef(null);
  const liveData = usePitchPlanLiveData({
    businessProfileId,
    ownerUserId: profile?.user_id,
    cmmsCompanyId,
    enabled: showPlan && !!profile,
  });

  const loadPitches = async () => {
    setPitchesLoading(true);
    const data = await getPitchesByBusinessProfileId(businessProfileId, 20);
    setPitches(data || []);
    setPitchesLoading(false);
  };

  useEffect(() => {
    let cancelled = false;
    if (!businessProfileId) {
      setProfile(null);
      setProfileLoading(false);
      setPitches([]);
      setPitchesLoading(false);
      return undefined;
    }

    setProfileLoading(true);
    // Same ad hoc "one business profile by id" query pattern
    // ShareSigningFlow.jsx already uses.
    supabase
      .from('business_profiles')
      .select('id, user_id, business_name, description, business_type, business_structure, founded_year, total_capital, metadata, avatar_url, website, business_address')
      .eq('id', businessProfileId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) console.warn('Could not load business profile for pitch tab:', error.message);
        setProfile(data || null);
        setProfileLoading(false);
      });

    loadPitches();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessProfileId]);

  // BusinessProfileDocuments reads `business_description` when pre-filling.
  const docsProfile = useMemo(
    () => (profile ? { ...profile, business_description: profile.description } : null),
    [profile]
  );

  // Ported from Pitchin.jsx's handleCreatePitch -- same insert -> upload
  // video -> attach video_url -> delete-on-failure flow, calling the
  // co-owner-aware managed-pitch functions.
  const handleCreatePitch = async (pitchData) => {
    if (!profile) {
      alert('No linked business profile found.');
      return;
    }

    const parseAmount = (str) => {
      if (typeof str !== 'string') return 0;
      const match = str.match(/[\d.]+/);
      if (!match) return 0;
      let num = parseFloat(match[0]);
      if (str.includes('K')) num *= 1000;
      if (str.includes('M')) num *= 1000000;
      return num;
    };
    const parsePercent = (str) => {
      if (typeof str !== 'string') return 0;
      const match = str.match(/[\d.]+/);
      return match ? parseFloat(match[0]) : 0;
    };

    setCreating(true);
    try {
      const result = await createManagedPitch({
        business_profile_id: profile.id,
        title: pitchData.title || 'Untitled Pitch',
        description: pitchData.description || '',
        category: pitchData.category || 'Technology',
        pitch_type: pitchData.pitchType || 'Equity',
        target_funding: parseAmount(pitchData.goal),
        equity_offering: parsePercent(pitchData.equity),
        has_ip: pitchData.hasIP || false,
      });
      if (!result.success) throw new Error(result.error || 'Failed to create pitch');

      const newPitch = result.data;

      if (pitchData.videoBlob && newPitch?.id) {
        const uploadResult = await uploadVideo(pitchData.videoBlob, newPitch.id);
        if (uploadResult.success && uploadResult.url) {
          const updateResult = await updateManagedPitch(newPitch.id, { video_url: uploadResult.url });
          if (!updateResult.success) {
            alert('Warning: video uploaded but failed to link to the pitch. Please refresh and check.');
          }
        } else {
          await deleteManagedPitch(newPitch.id);
          setShowRecorder(false);
          setCreating(false);
          alert(`Video upload failed: ${uploadResult.error || 'unknown error'}\n\nThe pitch has been deleted. Please try again.`);
          return;
        }
      }

      setShowRecorder(false);
      setCreating(false);
      await loadPitches();
    } catch (error) {
      console.error('Error creating pitch from CMMS:', error);
      alert('Failed to create pitch: ' + error.message);
      setCreating(false);
    }
  };

  // Plan-only pitch: saves the five documents (best effort -- the pitch
  // itself doesn't depend on that table), then publishes the written plan on
  // the pitch row so the public board can render it. MOU text is never
  // published (it holds contact details); "No disclosure" also hides the
  // financials.
  const handlePublishPlan = async () => {
    if (!profile || !docsRef.current) return;
    const d = docsRef.current.getDocumentData();
    const plan = {
      business_plan: stripPlaceholders(d.businessPlan),
      financials: d.noDisclosure ? '' : stripPlaceholders(d.financials),
      wants: stripPlaceholders(d.wants),
      fears: stripPlaceholders(d.fears),
      needs: stripPlaceholders(d.needs),
    };
    if (plan.business_plan.length < 20) {
      alert('Add your business plan first -- at least a couple of lines.');
      return;
    }
    const shares = parseFloat(d.shares) || 0;
    const sharePrice = parseFloat(d.sharePrice) || 0;
    const total = parseFloat(d.totalAmount) || shares * sharePrice;
    const planContent = { ...plan, has_mou: true };
    if (shares) planContent.shares = shares;
    if (sharePrice) planContent.share_price = sharePrice;
    if (total) planContent.total_value = total;
    if (planImage) planContent.image_url = planImage;
    Object.keys(planContent).forEach((k) => { if (planContent[k] === '') delete planContent[k]; });

    setPublishingPlan(true);
    try {
      await docsRef.current.saveDocuments();
      const description = plan.wants.split(/\n*\s*Live figures/)[0].slice(0, 200) || profile.description || '';
      const result = editingPitch
        ? await editManagedPitchPlan(editingPitch.id, {
            description,
            target_funding: total,
            equity_offering: shares,
            plan_content: planContent,
          })
        : await createManagedPitch({
            business_profile_id: profile.id,
            title: `${profile.business_name} Business Plan`,
            description,
            category: profile.business_type || 'Technology',
            pitch_type: 'Equity',
            target_funding: total,
            equity_offering: shares,
            has_ip: false,
            plan_content: planContent,
          });
      if (!result.success) throw new Error(result.error || (editingPitch ? 'Failed to save changes' : 'Failed to publish plan'));
      setShowPlan(false);
      setEditingPitch(null);
      await loadPitches();
    } catch (error) {
      console.error('Error publishing plan-only pitch:', error);
      alert('Failed to publish plan: ' + error.message);
    } finally {
      setPublishingPlan(false);
    }
  };

  // Reuses the existing R2 presigned upload (same one the deck import uses).
  const handlePlanImage = async (file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) { alert('Please choose an image file.'); return; }
    if (file.size > 5 * 1024 * 1024) { alert('Image is too large -- 5 MB maximum.'); return; }
    setUploadingImage(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const result = await uploadToR2({ file, folder: 'pitches', accessToken: session?.access_token });
      if (!result.success) throw new Error(result.error || 'Image upload failed');
      setPlanImage(result.url);
    } catch (error) {
      alert('Failed to upload image: ' + error.message);
    } finally {
      setUploadingImage(false);
    }
  };

  // A business that already has a real pitch deck shouldn't have to redo it as
  // a video. Brands the deck with the business's name + IcanEra, uploads it,
  // then creates a lightweight pitch pointed at it.
  const handleImportDeck = async (file) => {
    if (!file || !profile) return;
    setImportingDeck(true);
    try {
      const brandedBlob = await brandPitchDeck(file, { businessName: profile.business_name });

      const createResult = await createManagedPitch({
        business_profile_id: profile.id,
        title: `${profile.business_name} Pitch Deck`,
        description: profile.description || '',
        category: profile.business_type || 'Technology',
        pitch_type: 'Equity',
        target_funding: 0,
        equity_offering: 0,
        has_ip: false,
      });
      if (!createResult.success) throw new Error(createResult.error || 'Failed to create pitch');
      const newPitch = createResult.data;

      const { data: { session } } = await supabase.auth.getSession();
      const brandedFile = new File([brandedBlob], file.name, { type: brandedBlob.type || file.type });
      const uploadResult = await uploadToR2({ file: brandedFile, folder: 'pitches', accessToken: session?.access_token });
      if (!uploadResult.success) {
        await deleteManagedPitch(newPitch.id);
        throw new Error(uploadResult.error || 'Deck upload failed');
      }

      const updateResult = await updateManagedPitch(newPitch.id, {
        deck_url: uploadResult.url,
        deck_path: uploadResult.key,
        status: 'published',
      });
      if (!updateResult.success) {
        alert('Warning: deck uploaded but failed to link to the pitch. Please refresh and check.');
      }

      await loadPitches();
    } catch (error) {
      console.error('Error importing pitch deck:', error);
      alert('Failed to import pitch deck: ' + error.message);
    } finally {
      setImportingDeck(false);
    }
  };

  if (profileLoading) {
    return (
      <div className="flex justify-center py-10">
        <Loader className="w-6 h-6 animate-spin" style={{ color: 'var(--cap-purple)' }} />
      </div>
    );
  }

  if (!businessProfileId || !profile) {
    return (
      <div className="cap-card border rounded-2xl p-5 flex items-start gap-3">
        <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: 'var(--cap-amber-text)' }} />
        <div>
          <p className="cap-text font-semibold mb-1">Link a business profile first</p>
          <p className="cap-text-muted text-sm">
            Pitches use the business linked in the "Board profile" tab. Link one there, then come back.
          </p>
        </div>
      </div>
    );
  }

  const kindOf = (pitch) => {
    if (pitch.video_url) return { Icon: Video, label: 'Video' };
    if (pitch.deck_url) return { Icon: FileText, label: 'Deck' };
    return { Icon: FileText, label: 'Plan' };
  };

  return (
    <div className="space-y-4">
      <style>{IP_STYLES}</style>

      <div className="cap-card border rounded-2xl p-5 ip-rise">
        <h3 className="cap-title text-lg font-bold mb-1 flex items-center gap-2">
          <Sparkles className="w-5 h-5" style={{ color: 'var(--cap-purple)' }} /> Investor pitch
        </h3>
        <p className="cap-text-muted text-sm mb-4">
          Shown on your public board. Plan, video, deck, or any mix.
        </p>
        <div className="grid grid-cols-2 gap-2.5">
          <button
            onClick={() => { setEditingPitch(null); setPlanImage(''); setShowPlan(true); }}
            disabled={creating || publishingPlan}
            className="ip-btn ip-btn-primary col-span-2"
          >
            <FileText className="w-4 h-4" /> Write plan
          </button>
          <button
            onClick={() => setShowRecorder(true)}
            disabled={creating}
            className="ip-btn ip-btn-soft"
          >
            <Video className="w-4 h-4" style={{ color: 'var(--cap-purple)' }} /> Record video
          </button>
          <label className={`ip-btn ip-btn-soft cursor-pointer ${importingDeck ? 'opacity-60 pointer-events-none' : ''}`}>
            {importingDeck
              ? <Loader className="w-4 h-4 animate-spin" />
              : <FileUp className="w-4 h-4" style={{ color: 'var(--cap-purple)' }} />}
            {importingDeck ? 'Importing…' : 'Import deck'}
            <input
              type="file"
              accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation"
              className="hidden"
              disabled={importingDeck}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) handleImportDeck(file);
              }}
            />
          </label>
        </div>
      </div>

      <div className="cap-card border rounded-2xl p-5 ip-rise" style={{ animationDelay: '80ms' }}>
        <h4 className="cap-text font-semibold mb-3 text-sm">Published</h4>
        {pitchesLoading ? (
          <div className="flex justify-center py-6"><Loader className="w-5 h-5 animate-spin cap-text-muted" /></div>
        ) : pitches.length === 0 ? (
          <p className="cap-text-muted text-sm">Nothing yet. Start with <span className="font-semibold">Write plan</span>.</p>
        ) : (
          <div className="space-y-2.5">
            {pitches.map((pitch, i) => {
              const { Icon, label } = kindOf(pitch);
              return (
                <div
                  key={pitch.id}
                  className="ip-row ip-rise cap-post-card border rounded-xl flex items-center gap-3 p-3"
                  style={{ animationDelay: `${Math.min(i, 8) * 50}ms` }}
                >
                  {pitch.thumbnail_url ? (
                    <img src={pitch.thumbnail_url} alt="" className="w-14 h-14 rounded-lg object-cover flex-shrink-0" />
                  ) : (
                    <div
                      className="w-14 h-14 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ background: 'linear-gradient(135deg, rgba(124,58,237,.14), rgba(79,70,229,.1))' }}
                    >
                      <Icon className="w-5 h-5" style={{ color: 'var(--cap-purple-text)' }} />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="cap-text text-sm font-semibold truncate">{pitch.title}</p>
                    <div className="flex items-center flex-wrap gap-x-3 gap-y-1 text-xs cap-text-muted mt-1">
                      <span className="cap-badge-published px-2 py-0.5 rounded-full font-semibold capitalize">{pitch.status}</span>
                      <span>{label}</span>
                      <span className="flex items-center gap-1"><Eye className="w-3 h-3" /> {fmtCount(pitch.views_count)}</span>
                      <span className="flex items-center gap-1"><Heart className="w-3 h-3" /> {fmtCount(pitch.likes_count)}</span>
                    </div>
                  </div>
                  {label === 'Plan' && (
                    <button
                      onClick={() => { setEditingPitch(pitch); setPlanImage(pitch.plan_content?.image_url || ''); setShowPlan(true); }}
                      className="ip-icon-btn flex-shrink-0 p-2 rounded-lg"
                      title="Edit plan"
                      aria-label="Edit plan"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                  )}
                  <button
                    onClick={() => setInvitePitch(pitch)}
                    className="ip-icon-btn flex-shrink-0 p-2 rounded-lg"
                    title="Share privately"
                    aria-label="Share privately"
                  >
                    <Lock className="w-4 h-4" />
                  </button>
                  <a
                    href={`/pitchin/${pitch.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="ip-icon-btn flex-shrink-0 p-2 rounded-lg"
                    title="Open"
                    aria-label="Open"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </a>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showPlan && createPortal(
        <div className="bpd fixed inset-0 z-[9999] w-screen h-screen overflow-y-auto" style={{ background: "var(--bpd-page)" }}>
          <style>{IP_STYLES}</style>
          <div className="max-w-4xl mx-auto px-4 pt-5 pb-28 ip-rise">
            <button
              onClick={() => { setShowPlan(false); setEditingPitch(null); }}
              className="flex items-center gap-1.5 text-sm bpd-muted hover:opacity-80 mb-3 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" /> Back
            </button>
            <h2 className="text-2xl font-bold bpd-text mb-1" style={{ fontFamily: '"Playfair Display", Georgia, serif' }}>
              {editingPitch ? `Edit ${profile.business_name} plan` : `${profile.business_name} plan`}
            </h2>
            <p className="text-sm bpd-muted mb-5">
              {editingPitch
                ? 'Your saved plan is loaded. Change what you need, then save. The link, likes and comments stay.'
                : 'Prefilled from your profile. Review each step, mark it done, then publish.'}
            </p>
            <div className="mb-5 flex items-center gap-3 p-3 rounded-xl border" style={{ borderColor: 'var(--bpd-border)' }}>
              {planImage ? (
                <img src={planImage} alt="" className="w-20 h-20 rounded-lg object-cover flex-shrink-0" />
              ) : (
                <div className="w-20 h-20 rounded-lg flex items-center justify-center flex-shrink-0 bpd-muted" style={{ border: '1px dashed var(--bpd-border)' }}>
                  <ImageIcon className="w-6 h-6" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold bpd-text">Plan image <span className="bpd-muted font-normal">(optional)</span></p>
                <p className="text-xs bpd-muted mb-2">Shown at the top of your plan page. Max 5 MB.</p>
                <div className="flex gap-2">
                  <label className={`ip-btn ip-btn-soft cursor-pointer ${uploadingImage ? 'opacity-60 pointer-events-none' : ''}`}>
                    {uploadingImage ? <Loader className="w-4 h-4 animate-spin" /> : <ImageIcon className="w-4 h-4" />}
                    {uploadingImage ? 'Uploading…' : planImage ? 'Change' : 'Add image'}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      disabled={uploadingImage}
                      onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) handlePlanImage(f); }}
                    />
                  </label>
                  {planImage && (
                    <button type="button" onClick={() => setPlanImage('')} className="ip-btn ip-btn-soft">Remove</button>
                  )}
                </div>
              </div>
            </div>
            <BusinessProfileDocuments
              ref={docsRef}
              businessProfile={docsProfile}
              onDocumentsComplete={noop}
              onCancel={() => { setShowPlan(false); setEditingPitch(null); }}
              hideSkip
              liveData={liveData}
            />
          </div>
          <div className="fixed bottom-0 inset-x-0 z-10 backdrop-blur px-4 py-3" style={{ background: "var(--bpd-bar)", borderTop: "1px solid var(--bpd-border)" }}>
            <div className="max-w-4xl mx-auto">
              <button
                onClick={handlePublishPlan}
                disabled={publishingPlan || uploadingImage}
                className="ip-btn ip-btn-primary w-full"
              >
                {publishingPlan ? <Loader className="w-4 h-4 animate-spin" /> : <Globe className="w-4 h-4" />}
                {publishingPlan ? (editingPitch ? 'Saving…' : 'Publishing…') : (editingPitch ? 'Save changes' : 'Publish to website')}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {showRecorder && createPortal(
        <div className="fixed inset-0 z-[9999] w-screen h-screen bg-gradient-to-br from-slate-900 via-purple-900/30 to-slate-900 overflow-hidden">
          <PitchVideoRecorder
            onPitchCreated={handleCreatePitch}
            onClose={() => setShowRecorder(false)}
            currentBusinessProfile={profile}
            businessProfiles={[profile]}
            onSelectProfile={() => {}}
            onShowProfileSelector={() => {}}
          />
        </div>,
        document.body
      )}

      {invitePitch && (
        <PrivatePitchInviteModal pitch={invitePitch} onClose={() => setInvitePitch(null)} />
      )}
    </div>
  );
};

export default CMMSInvestorPitchPanel;
