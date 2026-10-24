import React, { useEffect, useState } from 'react';
import { AlertCircle, ArrowLeft, Film, Loader, Tag } from 'lucide-react';
import PitchBadgeManager from './PitchBadgeManager';
import { getPitchesByBusinessProfileId } from '../services/pitchingService';

/**
 * Lives inside the Jobs & Announcements panel (CMMSAnnouncementsPanel.jsx) as its "Video badges" sub-tab: advertise the business's products
 * inside its PitchIn videos. Pick a video, add the products you sell, choose the seconds each appears, and publish. Viewers see the product's
 * name and price over the video and tap it to shop.
 *
 * Same rule as the rest of the board: anyone who can edit the company's announcements can prepare badges (the database enforces it). While
 * the service is free staff can publish too; once a developer switches it to Charged only the business owner can pay for a badge.
 * Needs the company linked to its business (Board profile tab), because the videos and the products belong to the business.
 */
export default function CMMSPitchBadgesPanel({ businessProfileId }) {
  const [state, setState] = useState({ loading: true, pitches: [] });
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    if (!businessProfileId) { setState({ loading: false, pitches: [] }); return undefined; }
    let cancelled = false;
    setState({ loading: true, pitches: [] });
    getPitchesByBusinessProfileId(businessProfileId, 50).then((all) => {
      if (!cancelled) setState({ loading: false, pitches: all.filter((p) => p.video_url) });
    });
    return () => { cancelled = true; };
  }, [businessProfileId]);

  if (!businessProfileId) {
    return (
      <div className="cmms-classic-card p-6 text-sm text-slate-200 flex items-start gap-3">
        <AlertCircle className="w-5 h-5 text-amber-300 flex-shrink-0 mt-0.5" />
        <p>Link this company to its business first (Board profile tab). The videos and the products you advertise belong to that business.</p>
      </div>
    );
  }

  if (selected) {
    return (
      <div className="cmms-classic-card p-4 sm:p-5 space-y-4">
        <button type="button" onClick={() => setSelected(null)} className="inline-flex items-center gap-1.5 text-sm text-slate-300 hover:text-white">
          <ArrowLeft className="w-4 h-4" /> All videos
        </button>
        <h3 className="text-base font-semibold text-white">{selected.title}</h3>
        <PitchBadgeManager pitch={selected} businessProfileId={businessProfileId} />
      </div>
    );
  }

  return (
    <div className="cmms-classic-card p-4 sm:p-5 space-y-4">
      <div className="flex items-start gap-3">
        <span className="w-9 h-9 rounded-lg bg-pink-500/20 text-pink-300 flex items-center justify-center flex-shrink-0"><Tag className="w-5 h-5" /></span>
        <div>
          <h3 className="text-base font-semibold text-white">Video badges</h3>
          <p className="text-sm text-slate-300 mt-0.5">
            Advertise your products inside your PitchIn videos: at the moment you talk about one, its name and price appear over the video and viewers tap to shop.
          </p>
        </div>
      </div>

      {state.loading ? (
        <div className="flex justify-center py-8"><Loader className="w-6 h-6 animate-spin text-slate-400" /></div>
      ) : state.pitches.length === 0 ? (
        <p className="text-sm text-slate-300 text-center py-6">This business has no PitchIn videos yet. Record or upload one in PitchIn, then come back to add product badges.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {state.pitches.map((pitch) => (
            <li key={pitch.id}>
              <button type="button" onClick={() => setSelected(pitch)} className="w-full text-left rounded-xl border border-white/10 bg-slate-800/60 hover:border-pink-400/50 overflow-hidden transition">
                <div className="relative aspect-video bg-black">
                  <video src={pitch.video_url} poster={pitch.thumbnail_url || undefined} muted playsInline preload="metadata" className="w-full h-full object-cover" />
                  <span className="absolute left-2 top-2 inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-black/60 text-white"><Film className="w-3 h-3" />Video</span>
                </div>
                <p className="p-3 text-sm font-semibold text-white truncate">{pitch.title}</p>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
