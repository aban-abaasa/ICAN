import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Video, FileUp, Eye, Heart, Loader, AlertCircle, ExternalLink, Sparkles, Lock, FileText } from 'lucide-react';
import { supabase } from '../lib/supabase/client';
import { uploadToR2 } from '../services/r2StorageService';
import { brandPitchDeck } from '../utils/pptxBranding';
import PitchVideoRecorder from './PitchVideoRecorder';
import PrivatePitchInviteModal from './PrivatePitchInviteModal';
import {
  getPitchesByBusinessProfileId,
  createManagedPitch,
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

/**
 * CMMS "Investor pitch" tab (CMMSAnnouncementsPanel.jsx) -- lets a company
 * admin create a real Pitchin investor pitch for the business linked via the
 * "Board profile" tab, without leaving CMMS. Reuses PitchVideoRecorder as-is
 * (the same business-plan/financials/value-proposition/MOU/share-terms
 * documents wizard + video recorder Pitchin.jsx itself uses), so the
 * pitch-deck feel and auto-fill from those documents come for free -- this
 * panel only supplies the business profile and a create/upload handler that
 * goes through the co-owner-aware RPCs in pitchingService.js instead of the
 * owner-only ones Pitchin.jsx uses directly.
 */
const CMMSInvestorPitchPanel = ({ businessProfileId }) => {
  const [profile, setProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [pitches, setPitches] = useState([]);
  const [pitchesLoading, setPitchesLoading] = useState(true);
  const [showRecorder, setShowRecorder] = useState(false);
  const [creating, setCreating] = useState(false);
  const [importingDeck, setImportingDeck] = useState(false);
  const [invitePitch, setInvitePitch] = useState(null);

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
    // ShareSigningFlow.jsx already uses -- no dedicated "get one profile"
    // service function exists yet, so this mirrors that precedent rather
    // than inventing a new one.
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

  // Ported from Pitchin.jsx's handleCreatePitch -- same insert -> upload
  // video -> attach video_url -> delete-on-failure flow, just calling the
  // co-owner-aware managed-pitch functions instead of the owner-only ones,
  // and skipping Pitchin's own follow-up SmartContractGenerator step (that's
  // a separate Pitchin-specific flow, not part of "publish a pitch").
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

  // No documents wizard/video required here -- a business that already has
  // a real pitch deck shouldn't have to redo it as a video. Brands the deck
  // with the business's name + IcanEra (pptxBranding.js), uploads it, then
  // creates a lightweight pitch pointed at it, same create -> upload ->
  // attach shape as the video path above.
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
      <div className="glass-card p-5 border border-white/10 flex items-start gap-3">
        <AlertCircle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-white font-semibold mb-1">Link a business profile first</p>
          <p className="text-sm text-gray-400">
            Investor pitches are created for the ICANera business profile linked in the "Board profile" tab.
            Link one there, then come back here to create a pitch.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="glass-card p-5 border border-white/10">
        <h3 className="text-white font-semibold mb-1 flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-purple-300" /> Investor pitch for {profile.business_name}
        </h3>
        <p className="text-sm text-gray-400 mb-4">
          Record a pitch video and complete the business plan, financials, value proposition, MOU, and share
          terms -- the same guided flow Pitchin uses -- auto-filled from this business's own profile, or import
          an existing pitch deck instead. Either one (or both) publishes to your public board's Pitches tab,
          automatically branded with "{profile.business_name} · via IcanEra".
        </p>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => setShowRecorder(true)}
            disabled={creating}
            className="px-4 py-2.5 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-sm font-semibold flex items-center gap-2"
          >
            <Video className="w-4 h-4" /> Create investor pitch
          </button>
          <label className={`px-4 py-2.5 rounded-lg bg-white/10 hover:bg-white/15 text-white text-sm font-semibold flex items-center gap-2 cursor-pointer ${importingDeck ? 'opacity-50 pointer-events-none' : ''}`}>
            {importingDeck ? <Loader className="w-4 h-4 animate-spin" /> : <FileUp className="w-4 h-4" />}
            {importingDeck ? 'Importing…' : 'Import pitch deck (.pptx)'}
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

      <div className="glass-card p-5 border border-white/10">
        <h4 className="text-white font-semibold mb-3 text-sm">Pitches</h4>
        {pitchesLoading ? (
          <div className="flex justify-center py-6"><Loader className="w-5 h-5 animate-spin text-gray-500" /></div>
        ) : pitches.length === 0 ? (
          <p className="text-sm text-gray-500">No pitches published yet.</p>
        ) : (
          <div className="space-y-2.5">
            {pitches.map((pitch) => (
              <div key={pitch.id} className="flex items-center gap-3 p-3 rounded-lg bg-white/5 border border-white/10">
                {pitch.thumbnail_url ? (
                  <img src={pitch.thumbnail_url} alt="" className="w-14 h-14 rounded-md object-cover flex-shrink-0" />
                ) : (
                  <div className="w-14 h-14 rounded-md bg-purple-900/40 flex items-center justify-center flex-shrink-0">
                    {pitch.deck_url && !pitch.video_url
                      ? <FileText className="w-5 h-5 text-purple-300" />
                      : <Video className="w-5 h-5 text-purple-300" />}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-semibold truncate">{pitch.title}</p>
                  <div className="flex items-center gap-3 text-xs text-gray-400 mt-0.5">
                    <span className="capitalize">{pitch.status}</span>
                    <span className="flex items-center gap-1"><Eye className="w-3 h-3" /> {fmtCount(pitch.views_count)}</span>
                    <span className="flex items-center gap-1"><Heart className="w-3 h-3" /> {fmtCount(pitch.likes_count)}</span>
                  </div>
                </div>
                <button
                  onClick={() => setInvitePitch(pitch)}
                  className="flex-shrink-0 p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/10"
                  title="Share privately (PIN + time-limited)"
                >
                  <Lock className="w-4 h-4" />
                </button>
                <a
                  href={`/pitchin/${pitch.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex-shrink-0 p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/10"
                  title="Open in Pitchin"
                >
                  <ExternalLink className="w-4 h-4" />
                </a>
              </div>
            ))}
          </div>
        )}
      </div>

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
