import '../pitchin-classic.css';
import React, { useEffect } from 'react';
import { X, Play, FileText, Compass, Sparkles, ArrowRight, Loader, Briefcase } from 'lucide-react';

const CSS = `
@keyframes sf-sheet-in{from{transform:translateY(40px);opacity:0}to{transform:none;opacity:1}}
.sf-sheet{animation:sf-sheet-in .32s cubic-bezier(.2,.8,.2,1) both}
.sf-ring{background:conic-gradient(from 200deg,#f472b6,#a78bfa,#38bdf8,#f472b6)}
.sf-scroll{scrollbar-width:none}
.sf-scroll::-webkit-scrollbar{display:none}
@media (prefers-reduced-motion:reduce){.sf-sheet{animation:none}}
`;

const timeAgo = (timestamp) => {
  if (!timestamp) return 'Now';
  const minutes = Math.floor((Date.now() - new Date(timestamp).getTime()) / 60000);
  if (minutes < 1) return 'Now';
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h`;
};

const fundingPct = (pitch) => {
  const target = Number(pitch.target_funding) || 0;
  const raised = Number(pitch.raised_amount) || 0;
  return target > 0 ? Math.min(100, Math.round((raised / target) * 100)) : null;
};

const Avatar = ({ src, name, size = 'w-10 h-10' }) => (
  src ? (
    <img src={src} alt={name} className={`${size} rounded-full object-cover`} />
  ) : (
    <div className={`${size} rounded-full bg-gradient-to-br from-purple-400 to-pink-400 flex items-center justify-center text-white font-bold`}>
      {(name || 'U').charAt(0).toUpperCase()}
    </div>
  )
);

// A story-style tile for one live update: the media (or the colour card for a
// text update) with the poster's ring-avatar on top.
const UpdateTile = ({ status, active, onOpen }) => {
  const name = status.poster_full_name || 'User';
  return (
    <button
      type="button"
      onClick={() => onOpen(status.id)}
      className="icon-btn-transparent relative flex-shrink-0 w-28 h-44 rounded-2xl overflow-hidden text-left border border-white/10 transition hover:scale-[1.03] active:scale-95"
    >
      {/* The theme paints every <button>, so the tile's colour lives on a
          child instead of the button itself. */}
      <span
        className="absolute inset-0"
        style={{ backgroundColor: status.media_type === 'text' ? (status.background_color || '#6366f1') : '#0f172a' }}
      />
      {status.media_type === 'image' && status.media_url && (
        <img src={status.media_url} alt="" className="absolute inset-0 w-full h-full object-cover" loading="lazy" />
      )}
      {status.media_type === 'video' && (
        <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-slate-800 to-slate-900">
          <Play className="w-8 h-8 text-white/70" />
        </div>
      )}
      {status.media_type === 'text' && (
        <p className="absolute inset-0 p-3 pt-14 text-xs font-semibold text-white leading-snug line-clamp-5 break-words">{status.caption}</p>
      )}
      <div
        className="absolute inset-0"
        style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,.5), transparent 40%, rgba(0,0,0,.7))' }}
      />
      <div className="absolute top-2 left-2 sf-ring p-[2px] rounded-full">
        <div className="rounded-full border-2 border-slate-900">
          <Avatar src={status.poster_avatar_url} name={name} size="w-8 h-8" />
        </div>
      </div>
      <div className="absolute bottom-2 left-2 right-2">
        <p className="text-[11px] font-semibold text-white truncate">{active ? 'Watching now' : name}</p>
        <p className="text-[10px] text-white/70">{timeAgo(status.created_at)}</p>
      </div>
    </button>
  );
};

const PitchCard = ({ pitch, onOpen }) => {
  const biz = pitch.business_profiles || {};
  const bizName = biz.business_name || 'Pitcher';
  const bizPhoto = biz.avatar_url || biz.owner_avatar_url;
  const isPlan = !pitch.video_url && pitch.plan_content;
  const pct = fundingPct(pitch);
  return (
    <button
      type="button"
      onClick={() => onOpen(pitch.id)}
      className="w-full flex items-center gap-3 p-2.5 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/10 text-left transition active:scale-[0.99]"
    >
      <div className="relative w-24 h-[72px] flex-shrink-0 rounded-xl overflow-hidden bg-gradient-to-br from-purple-600 to-pink-600 flex items-center justify-center">
        {pitch.thumbnail_url ? (
          <img src={pitch.thumbnail_url} alt="" className="absolute inset-0 w-full h-full object-cover" loading="lazy" />
        ) : (
          <Avatar src={bizPhoto} name={bizName} size="w-10 h-10" />
        )}
        <span className="absolute bottom-1 left-1 inline-flex items-center gap-1 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-white">
          {isPlan ? <FileText className="w-3 h-3" /> : <Play className="w-3 h-3" />}
          {isPlan ? 'Plan' : 'Video'}
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-white truncate">{pitch.title || 'Untitled pitch'}</p>
        <p className="text-xs text-white/60 truncate">{bizName}</p>
        {pct !== null && (
          <div className="mt-1.5 flex items-center gap-2">
            <div className="h-1.5 flex-1 rounded-full bg-white/10 overflow-hidden">
              <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-sky-400" style={{ width: `${pct}%` }} />
            </div>
            <span className="text-[10px] font-semibold text-white/70">{pct}% funded</span>
          </div>
        )}
      </div>
      <ArrowRight className="w-4 h-4 text-white/40 flex-shrink-0" />
    </button>
  );
};

// The "keep going" surface of a shared pitch/update link: instead of leaving
// the visitor on a single item (or kicking them to the home page), it offers
// the rest of the flow -- live updates as story tiles, pitches as cards --
// plus the way in to IcanEra itself. `mode === 'end'` is what they see when
// they swipe past the last item.
const ShareExploreSheet = ({
  open,
  mode = 'explore',
  onClose,
  pitches,
  statuses,
  loading,
  currentStatusId,
  onOpenPitch,
  onOpenStatus,
  signedIn,
  onJoin,
  onEnterApp,
}) => {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const isEnd = mode === 'end';
  const empty = !loading && pitches.length === 0 && statuses.length === 0;

  return (
    <div className="pitchin-classic fixed inset-0 z-[55] flex items-end sm:items-center justify-center" role="dialog" aria-modal="true" aria-label="Explore IcanEra">
      <style>{CSS}</style>
      <button type="button" aria-label="Close" tabIndex={-1} onClick={onClose} className="absolute inset-0 bg-black/70 backdrop-blur-sm cursor-default" />
      <div className="sf-sheet relative w-full sm:max-w-2xl max-h-[88vh] flex flex-col rounded-t-3xl sm:rounded-3xl bg-slate-900 border border-white/10 text-white overflow-hidden">
        <div className="pt-2.5 flex justify-center sm:hidden"><span className="h-1 w-10 rounded-full bg-white/20" /></div>

        <div className="flex items-start justify-between gap-3 px-5 pt-3 pb-2">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-pink-500 to-purple-600 flex items-center justify-center">
              {isEnd ? <Sparkles className="w-5 h-5" /> : <Compass className="w-5 h-5" />}
            </div>
            <div>
              <h3 className="text-lg font-bold leading-tight">{isEnd ? "You're all caught up" : 'Keep exploring'}</h3>
              <p className="text-xs text-white/60">
                {isEnd ? 'That was the last one for now. Here is where to go next.' : 'Live updates and pitches from the IcanEra community.'}
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="icon-btn-transparent p-1.5 rounded-full text-white/70 hover:text-white hover:bg-white/10" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 pb-4 space-y-5">
          {loading && (
            <div className="flex justify-center py-10"><Loader className="w-6 h-6 text-white/50 animate-spin" /></div>
          )}

          {empty && (
            <p className="text-center text-sm text-white/60 py-10">Nothing new right now. Check back soon, or step inside IcanEra.</p>
          )}

          {statuses.length > 0 && (
            <section>
              <h4 className="text-xs font-bold tracking-wider uppercase text-white/50 mb-2">Live updates</h4>
              <div className="sf-scroll flex gap-2.5 overflow-x-auto -mx-5 px-5 pb-1">
                {statuses.map((status) => (
                  <UpdateTile key={status.id} status={status} active={status.id === currentStatusId} onOpen={onOpenStatus} />
                ))}
              </div>
            </section>
          )}

          {pitches.length > 0 && (
            <section>
              <h4 className="text-xs font-bold tracking-wider uppercase text-white/50 mb-2 flex items-center gap-1.5">
                <Briefcase className="w-3.5 h-3.5" /> Pitches to back
              </h4>
              <div className="space-y-2">
                {pitches.map((pitch) => <PitchCard key={pitch.id} pitch={pitch} onOpen={onOpenPitch} />)}
              </div>
            </section>
          )}
        </div>

        <div className="border-t border-white/10 bg-slate-950/60 px-5 py-3.5">
          {signedIn ? (
            <button type="button" onClick={onEnterApp} className="icon-btn-transparent w-full rounded-xl bg-gradient-to-r from-pink-500 to-purple-600 hover:from-pink-400 hover:to-purple-500 py-3 text-sm font-bold text-white transition flex items-center justify-center gap-2">
              Open my IcanEra <ArrowRight className="w-4 h-4" />
            </button>
          ) : (
            <div className="space-y-2">
              <button type="button" onClick={onJoin} className="icon-btn-transparent w-full rounded-xl bg-gradient-to-r from-pink-500 to-purple-600 hover:from-pink-400 hover:to-purple-500 py-3 text-sm font-bold text-white transition flex items-center justify-center gap-2">
                Join IcanEra, it's free <ArrowRight className="w-4 h-4" />
              </button>
              <p className="text-center text-xs text-white/50">Like, comment, invest and post your own updates.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ShareExploreSheet;
