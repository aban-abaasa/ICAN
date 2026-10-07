import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './pitchin-classic.css';
import { X, Sparkles } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { AuthPage } from './auth';
import PublicPitchViewer from './PublicPitchViewer';
import PublicStatusViewer from './PublicStatusViewer';
import ShareExploreSheet from './share/ShareExploreSheet';
import { useShareFlowFeed } from './share/useShareFlowFeed';

// A visitor who has seen this many different items without an account gets a
// gentle, dismissible invitation to join -- never a gate.
const NUDGE_AFTER_ITEMS = 3;
const NUDGE_DISMISSED_KEY = 'shareFlowNudgeDismissed';

const pathFor = (kind, id) => (kind === 'pitch' ? `/pitchin/${id}` : `/status/${id}`);

const parseShareLocation = () => {
  const pitch = window.location.pathname.match(/^\/pitchin\/([^/]+)/);
  if (pitch) return { kind: 'pitch', id: pitch[1] };
  const status = window.location.pathname.match(/^\/status\/([^/]+)/);
  if (status) return { kind: 'status', id: status[1] };
  return null;
};

// Rendered instead of the normal authenticated app (see main.jsx) for a shared
// Pitchin (/pitchin/:id) or update (/status/:id) link. The link still opens the
// exact item it points to with no login, but it is now the first step of a
// flow rather than the whole experience: the visitor can swipe on to the next
// pitch, tap through other live updates like stories, or open Explore -- and
// the browser's Back button walks the same path. Account creation stays an
// invitation (a nudge after a few items, a button in Explore), never a wall.
const PublicShareFlow = ({ kind: initialKind, id: initialId }) => {
  const { user, loading: authLoading } = useAuth();
  const feed = useShareFlowFeed();
  // `nav` bumps on every deliberate jump so the viewer remounts with fresh
  // state (comments, likes, not-found, ...) instead of leaking the last item's.
  const [current, setCurrent] = useState({ kind: initialKind, id: initialId, nav: 0 });
  const [explore, setExplore] = useState({ open: false, mode: 'explore' });
  const [showAuth, setShowAuth] = useState(false);
  const [seenCount, setSeenCount] = useState(1);
  const [nudgeDismissed, setNudgeDismissed] = useState(() => {
    try { return sessionStorage.getItem(NUDGE_DISMISSED_KEY) === '1'; } catch { return false; }
  });
  const seenIds = useRef(new Set([initialId]));

  const markSeen = useCallback((id) => {
    if (seenIds.current.has(id)) return;
    seenIds.current.add(id);
    setSeenCount(seenIds.current.size);
  }, []);

  const go = useCallback((nextKind, nextId) => {
    window.history.pushState({ shareFlow: true }, '', pathFor(nextKind, nextId));
    setCurrent((c) => ({ kind: nextKind, id: nextId, nav: c.nav + 1 }));
    setExplore((e) => ({ ...e, open: false }));
    markSeen(nextId);
  }, [markSeen]);

  // Back/forward inside the flow. Leaving it (e.g. back to the page the link
  // was opened from) reloads so main.jsx routes whatever URL that is.
  useEffect(() => {
    const onPop = () => {
      const loc = parseShareLocation();
      if (!loc) { window.location.reload(); return; }
      setCurrent((c) => ({ ...loc, nav: c.nav + 1 }));
      setExplore((e) => ({ ...e, open: false }));
      markSeen(loc.id);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [markSeen]);

  // The status viewer pages through updates internally (story-style) without
  // remounting; it reports where it is so the address bar -- and therefore
  // Share / copy-link -- always points at the update on screen.
  const onStatusPosition = useCallback((id) => {
    window.history.replaceState(window.history.state, '', pathFor('status', id));
    markSeen(id);
  }, [markSeen]);

  const openExplore = useCallback(() => setExplore({ open: true, mode: 'explore' }), []);
  const openEnd = useCallback(() => setExplore({ open: true, mode: 'end' }), []);
  const closeExplore = useCallback(() => setExplore((e) => ({ ...e, open: false })), []);

  const enterApp = useCallback(() => {
    window.history.replaceState({}, '', '/');
    window.location.href = '/';
  }, []);

  const join = useCallback(() => {
    setExplore((e) => ({ ...e, open: false }));
    setShowAuth(true);
  }, []);

  const dismissNudge = () => {
    setNudgeDismissed(true);
    try { sessionStorage.setItem(NUDGE_DISMISSED_KEY, '1'); } catch { /* storage unavailable */ }
  };

  // Pitch order for swiping: the feed, skipping what's on screen. A pitch that
  // isn't in the feed (older than the window, or still loading) simply starts
  // the sequence from the top.
  const pitchIdx = useMemo(
    () => feed.pitches.findIndex((p) => p.id === current.id),
    [feed.pitches, current.id]
  );
  const nextPitch = current.kind === 'pitch'
    ? (pitchIdx === -1 ? feed.pitches[0] : feed.pitches[pitchIdx + 1]) || null
    : null;
  const prevPitch = current.kind === 'pitch' && pitchIdx > 0 ? feed.pitches[pitchIdx - 1] : null;

  const goNextPitch = useCallback(() => {
    if (nextPitch) go('pitch', nextPitch.id);
    else openEnd();
  }, [nextPitch, go, openEnd]);
  const goPrevPitch = useCallback(() => { if (prevPitch) go('pitch', prevPitch.id); }, [prevPitch, go]);

  const explorePitches = useMemo(
    () => feed.pitches.filter((p) => !(current.kind === 'pitch' && p.id === current.id)),
    [feed.pitches, current.kind, current.id]
  );

  const showNudge = !authLoading && !user && !nudgeDismissed && seenCount >= NUDGE_AFTER_ITEMS && !explore.open && !showAuth;

  return (
    <>
      {current.kind === 'pitch' ? (
        <PublicPitchViewer
          key={`pitch-${current.id}-${current.nav}`}
          pitchId={current.id}
          nextPitch={nextPitch}
          hasPrev={Boolean(prevPitch)}
          onNext={goNextPitch}
          onPrev={goPrevPitch}
          onExplore={openExplore}
        />
      ) : (
        <PublicStatusViewer
          key={`status-${current.id}-${current.nav}`}
          statusId={current.id}
          feedStatuses={feed.statuses}
          onPosition={onStatusPosition}
          onEnd={openEnd}
          onExplore={openExplore}
        />
      )}

      <ShareExploreSheet
        open={explore.open}
        mode={explore.mode}
        onClose={closeExplore}
        pitches={explorePitches}
        statuses={feed.statuses}
        loading={feed.loading}
        currentStatusId={current.kind === 'status' ? current.id : null}
        onOpenPitch={(id) => go('pitch', id)}
        onOpenStatus={(id) => go('status', id)}
        signedIn={Boolean(user)}
        onJoin={join}
        onEnterApp={enterApp}
      />

      {showNudge && (
        <div className="pitchin-classic fixed top-[5.5rem] left-1/2 -translate-x-1/2 z-[52] w-[calc(100%-2rem)] max-w-sm">
          <div className="flex items-center gap-3 rounded-2xl border border-white/15 bg-slate-900/90 backdrop-blur-md p-3 pl-4 shadow-xl">
            <Sparkles className="w-5 h-5 text-pink-400 flex-shrink-0" />
            <p className="flex-1 text-xs text-white/90 leading-snug">Enjoying the flow? Join to invest, comment and post your own updates.</p>
            <button type="button" onClick={join} className="icon-btn-transparent rounded-full bg-pink-500 hover:bg-pink-400 px-3 py-1.5 text-xs font-bold text-white transition flex-shrink-0">
              Join
            </button>
            <button type="button" onClick={dismissNudge} aria-label="Dismiss" className="icon-btn-transparent p-1 text-white/50 hover:text-white flex-shrink-0">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {showAuth && (
        <div className="fixed inset-0 z-[60] overflow-y-auto">
          <button onClick={() => setShowAuth(false)} className="icon-btn-transparent fixed top-4 right-4 text-white/80 hover:text-white p-2 rounded-full bg-black/40 z-10" aria-label="Close">
            <X className="w-6 h-6" />
          </button>
          <AuthPage initialView="signup" onAuthSuccess={() => setShowAuth(false)} />
        </div>
      )}
    </>
  );
};

export default PublicShareFlow;
