/**
 * One-to-many "Go Live" video broadcast — YouTube-Live style: one
 * broadcaster's camera, any number of read-only viewers. Same signaling
 * mechanism as useDirectCall.js/LiveBoardroom.jsx (Supabase Realtime
 * broadcast channel, STUN-only RTCPeerConnection, pending-ICE queue), but
 * star-shaped instead of 1:1 or full-mesh: the broadcaster holds one
 * send-only RTCPeerConnection per viewer, each viewer holds exactly one
 * receive-only RTCPeerConnection back to the broadcaster.
 *
 * Originally built for the Community tab (public, `scope: 'community'`) and
 * reused as-is for the CMMS/Trust & SACCO "video group call" buttons in
 * ChatWidget.jsx — those pass a company/group-scoped `scope`
 * (`cmms:<companyId>`, `trust:<groupId>`) instead of going through
 * LiveBoardroom's ring/accept/start flow, so a teammate can go live to their
 * team the same one-tap way a Community broadcaster goes live to visitors.
 * `scope` is what makes visibility exclusive to that audience: presence and
 * signaling channel names are namespaced by it, so a CMMS company's stream
 * never shows up as "live" to Trust members, Community visitors, or anyone
 * outside that scope, and vice versa.
 *
 * "Who is live right now" and the live viewer count are derived from a
 * single shared Supabase Realtime *presence* channel (per scope) that every
 * widget instance in that scope joins (broadcaster tracks a 'broadcaster'
 * presence row, each watcher tracks a 'viewer' row) — that channel is joined
 * unconditionally (even for guests just browsing Community) so a "live"
 * indicator can show without anyone having pressed anything yet. Actual
 * video only flows once a viewer calls watch().
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { getSupabaseClient } from '../lib/supabase/client';

const supabase = getSupabaseClient();

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

const presenceChannelFor = (scope) => `ican-live-presence:${scope}`;
const signalChannelName = (streamId) => `ican-live-signal:${streamId}`;

export const useCommunityLive = ({ selfId, selfName, canBroadcast, scope = 'community' }) => {
  const [liveInfo, setLiveInfo] = useState(null); // { streamId, broadcasterId, broadcasterName, startedAt } | null
  const [viewerCount, setViewerCount] = useState(0);
  const [role, setRole] = useState('idle'); // idle | broadcasting | watching
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState('');
  const [endReason, setEndReason] = useState(''); // 'ended' | 'error' | ''

  const roleRef = useRef('idle');
  const selfIdRef = useRef(selfId);
  const selfNameRef = useRef(selfName);
  const scopeRef = useRef(scope);
  const streamIdRef = useRef('');
  const broadcasterIdRef = useRef('');
  const localStreamRef = useRef(null);
  const peerConnectionsRef = useRef(new Map()); // broadcaster: viewerId -> pc
  const viewerPcRef = useRef(null); // viewer: pc to the broadcaster
  const pendingIceRef = useRef(new Map()); // peerId -> candidate[]
  const presenceChannelRef = useRef(null);
  const signalChannelRef = useRef(null);
  const elapsedTimerRef = useRef(null);

  useEffect(() => { roleRef.current = role; }, [role]);
  useEffect(() => { selfIdRef.current = selfId; }, [selfId]);
  useEffect(() => { selfNameRef.current = selfName; }, [selfName]);
  useEffect(() => { scopeRef.current = scope; }, [scope]);

  const clearElapsedTimer = () => {
    if (elapsedTimerRef.current) { clearInterval(elapsedTimerRef.current); elapsedTimerRef.current = null; }
  };

  const closeSignalChannel = useCallback(() => {
    if (signalChannelRef.current) {
      supabase.removeChannel(signalChannelRef.current);
      signalChannelRef.current = null;
    }
  }, []);

  const teardownMedia = useCallback(() => {
    peerConnectionsRef.current.forEach((pc) => { try { pc.close(); } catch (_) { /* already closed */ } });
    peerConnectionsRef.current.clear();
    if (viewerPcRef.current) { try { viewerPcRef.current.close(); } catch (_) { /* already closed */ } viewerPcRef.current = null; }
    if (localStreamRef.current) { localStreamRef.current.getTracks().forEach((t) => t.stop()); localStreamRef.current = null; }
    pendingIceRef.current.clear();
    setLocalStream(null);
    setRemoteStream(null);
  }, []);

  const untrackSelfPresence = useCallback(async () => {
    try { await presenceChannelRef.current?.untrack(); } catch (_) { /* not tracked */ }
  }, []);

  const resetToIdle = useCallback((reason = '') => {
    clearElapsedTimer();
    teardownMedia();
    closeSignalChannel();
    untrackSelfPresence();
    streamIdRef.current = '';
    broadcasterIdRef.current = '';
    setElapsed(0);
    setEndReason(reason);
    setRole('idle');
  }, [teardownMedia, closeSignalChannel, untrackSelfPresence]);

  // --- Presence: who is live + how many are watching -----------------------
  useEffect(() => {
    if (!selfId || !scope) return undefined;
    const channel = supabase.channel(presenceChannelFor(scope), { config: { presence: { key: selfId } } });

    const syncFromState = () => {
      const state = channel.presenceState();
      let broadcaster = null;
      let watching = 0;
      Object.values(state).forEach((entries) => {
        const entry = entries?.[0];
        if (!entry) return;
        if (entry.role === 'broadcaster') broadcaster = entry;
        else if (entry.role === 'viewer' && broadcaster && entry.streamId === broadcaster.streamId) watching += 1;
      });
      // A watcher entry can sync in before its broadcaster's does — recount below once both are known.
      if (broadcaster) {
        watching = Object.values(state).reduce((count, entries) => {
          const entry = entries?.[0];
          return entry?.role === 'viewer' && entry.streamId === broadcaster.streamId ? count + 1 : count;
        }, 0);
        setLiveInfo({ streamId: broadcaster.streamId, broadcasterId: broadcaster.userId, broadcasterName: broadcaster.name, startedAt: broadcaster.startedAt });
        setViewerCount(watching);
      } else {
        setLiveInfo(null);
        setViewerCount(0);
        // The broadcaster vanished (crash/close-tab) without sending stream-ended.
        if (roleRef.current === 'watching') resetToIdle('ended');
      }
    };

    channel.on('presence', { event: 'sync' }, syncFromState).subscribe();
    presenceChannelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      if (presenceChannelRef.current === channel) presenceChannelRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selfId, scope]);

  const send = useCallback((event, payload) => {
    if (!signalChannelRef.current) return;
    signalChannelRef.current.send({ type: 'broadcast', event, payload: { from: selfIdRef.current, ...payload } });
  }, []);

  const createBroadcasterPeer = useCallback((viewerId) => {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pc.onicecandidate = (event) => {
      if (event.candidate) send('ice', { target: viewerId, candidate: event.candidate });
    };
    pc.onconnectionstatechange = () => {
      if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) {
        peerConnectionsRef.current.delete(viewerId);
      }
    };
    const stream = localStreamRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => pc.addTransceiver(track, { direction: 'sendonly', streams: [stream] }));
    }
    peerConnectionsRef.current.set(viewerId, pc);
    return pc;
  }, [send]);

  const flushPendingIce = useCallback(async (pc, peerId) => {
    const queued = pendingIceRef.current.get(peerId) || [];
    pendingIceRef.current.delete(peerId);
    for (const candidate of queued) {
      try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch (_) { /* stale candidate */ }
    }
  }, []);

  // --- Broadcaster -----------------------------------------------------------
  const goLive = useCallback(async () => {
    if (!canBroadcast || roleRef.current !== 'idle' || !selfIdRef.current || !scopeRef.current) return;
    if (liveInfo) { setError('Someone is already live right now.'); return; }
    setError('');
    setEndReason('');

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: true });
    } catch (err) {
      setError(err?.name === 'NotAllowedError' ? 'Camera/microphone permission denied' : 'Could not access camera/microphone');
      return;
    }
    localStreamRef.current = stream;
    setLocalStream(stream);
    setMicOn(true);
    setCamOn(true);

    const streamId = `${scopeRef.current}:${selfIdRef.current}:${Date.now()}`;
    streamIdRef.current = streamId;
    broadcasterIdRef.current = selfIdRef.current;

    const channel = supabase.channel(signalChannelName(streamId), { config: { broadcast: { self: false } } });
    channel
      .on('broadcast', { event: 'viewer-join' }, ({ payload }) => {
        if (!payload?.from) return;
        const pc = createBroadcasterPeer(payload.from);
        (async () => {
          try {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            send('offer', { target: payload.from, sdp: offer });
          } catch (err) { console.warn('[useCommunityLive] failed to offer viewer:', err); }
        })();
      })
      .on('broadcast', { event: 'answer' }, async ({ payload }) => {
        if (!payload || payload.target !== selfIdRef.current) return;
        const pc = peerConnectionsRef.current.get(payload.from);
        if (!pc) return;
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
          await flushPendingIce(pc, payload.from);
        } catch (err) { console.warn('[useCommunityLive] failed to apply viewer answer:', err); }
      })
      .on('broadcast', { event: 'ice' }, async ({ payload }) => {
        if (!payload || payload.target !== selfIdRef.current || !payload.candidate) return;
        const pc = peerConnectionsRef.current.get(payload.from);
        if (pc?.remoteDescription) {
          try { await pc.addIceCandidate(new RTCIceCandidate(payload.candidate)); } catch (_) { /* stale candidate */ }
        } else {
          const queued = pendingIceRef.current.get(payload.from) || [];
          queued.push(payload.candidate);
          pendingIceRef.current.set(payload.from, queued);
        }
      })
      .on('broadcast', { event: 'viewer-leave' }, ({ payload }) => {
        const pc = peerConnectionsRef.current.get(payload?.from);
        if (pc) { try { pc.close(); } catch (_) { /* already closed */ } peerConnectionsRef.current.delete(payload.from); }
      })
      .subscribe(async (status) => {
        if (status !== 'SUBSCRIBED') return;
        signalChannelRef.current = channel;
        await presenceChannelRef.current?.track({
          userId: selfIdRef.current,
          name: selfNameRef.current || 'Someone',
          role: 'broadcaster',
          streamId,
          startedAt: new Date().toISOString(),
        });
        setRole('broadcasting');
        elapsedTimerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
        // Best-effort: push a "X is live" alert to everyone's phone. Never
        // block/fail the broadcast itself on this - notification delivery
        // is a nice-to-have, going live is the point. Only the public
        // Community scope has a push fan-out set up (see
        // ICAN_COMMUNITY_LIVE_PUSH_SETUP.sql) — CMMS/Trust scopes rely on
        // the in-widget "live now" banner + pulsing tab dot instead, since
        // their audience is already inside the app.
        if (scopeRef.current === 'community') {
          try {
            await supabase.rpc('ican_notify_community_live', { p_broadcaster_name: selfNameRef.current || 'Someone' });
          } catch (err) { console.warn('[useCommunityLive] failed to notify:', err); }
        }
      });
  }, [canBroadcast, liveInfo, createBroadcasterPeer, send, flushPendingIce]);

  const stopLive = useCallback(() => {
    if (roleRef.current !== 'broadcasting') return;
    send('stream-ended', {});
    resetToIdle('ended');
  }, [send, resetToIdle]);

  // --- Viewer ------------------------------------------------------------
  const watch = useCallback(() => {
    if (roleRef.current !== 'idle' || !liveInfo || !selfIdRef.current) return;
    setError('');
    setEndReason('');
    const { streamId, broadcasterId, broadcasterName } = liveInfo;
    streamIdRef.current = streamId;
    broadcasterIdRef.current = broadcasterId;

    const channel = supabase.channel(signalChannelName(streamId), { config: { broadcast: { self: false } } });
    channel
      .on('broadcast', { event: 'offer' }, async ({ payload }) => {
        if (!payload || payload.target !== selfIdRef.current) return;
        const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
        viewerPcRef.current = pc;
        pc.onicecandidate = (event) => {
          if (event.candidate) send('ice', { target: broadcasterId, candidate: event.candidate });
        };
        pc.ontrack = (event) => { const [s] = event.streams; if (s) setRemoteStream(s); };
        pc.onconnectionstatechange = () => {
          if (['failed', 'disconnected', 'closed'].includes(pc.connectionState) && roleRef.current === 'watching') {
            resetToIdle('ended');
          }
        };
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
          await flushPendingIce(pc, broadcasterId);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          send('answer', { target: broadcasterId, sdp: answer });
        } catch (err) { console.warn('[useCommunityLive] failed to answer broadcaster:', err); }
      })
      .on('broadcast', { event: 'ice' }, async ({ payload }) => {
        if (!payload || payload.target !== selfIdRef.current || !payload.candidate) return;
        const pc = viewerPcRef.current;
        if (pc?.remoteDescription) {
          try { await pc.addIceCandidate(new RTCIceCandidate(payload.candidate)); } catch (_) { /* stale candidate */ }
        } else {
          const queued = pendingIceRef.current.get(broadcasterId) || [];
          queued.push(payload.candidate);
          pendingIceRef.current.set(broadcasterId, queued);
        }
      })
      .on('broadcast', { event: 'stream-ended' }, () => {
        resetToIdle('ended');
      })
      .subscribe(async (status) => {
        if (status !== 'SUBSCRIBED') return;
        signalChannelRef.current = channel;
        await presenceChannelRef.current?.track({ userId: selfIdRef.current, name: selfNameRef.current || 'Someone', role: 'viewer', streamId });
        send('viewer-join', {});
        setRole('watching');
        elapsedTimerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
        void broadcasterName; // kept in liveInfo for the UI; nothing further to do with it here
      });
  }, [liveInfo, send, flushPendingIce, resetToIdle]);

  const stopWatching = useCallback(() => {
    if (roleRef.current !== 'watching') return;
    send('viewer-leave', {});
    resetToIdle('ended');
  }, [send, resetToIdle]);

  const toggleMic = useCallback(() => {
    setMicOn((prev) => {
      const next = !prev;
      localStreamRef.current?.getAudioTracks().forEach((t) => { t.enabled = next; });
      return next;
    });
  }, []);

  const toggleCam = useCallback(() => {
    setCamOn((prev) => {
      const next = !prev;
      localStreamRef.current?.getVideoTracks().forEach((t) => { t.enabled = next; });
      return next;
    });
  }, []);

  // Full cleanup on unmount.
  useEffect(() => () => {
    clearElapsedTimer();
    teardownMedia();
    closeSignalChannel();
    untrackSelfPresence();
  }, [teardownMedia, closeSignalChannel, untrackSelfPresence]);

  return {
    liveInfo,
    viewerCount,
    role,
    localStream,
    remoteStream,
    micOn,
    camOn,
    elapsed,
    error,
    endReason,
    canBroadcast: Boolean(canBroadcast) && role === 'idle',
    canWatch: Boolean(liveInfo && selfId) && role === 'idle',
    isSelfBroadcaster: Boolean(liveInfo && selfId && liveInfo.broadcasterId === selfId),
    goLive,
    stopLive,
    watch,
    stopWatching,
    toggleMic,
    toggleCam,
  };
};

export default useCommunityLive;
