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

// STUN alone frequently can't punch a direct peer-to-peer path through
// carrier-grade NAT on mobile data (and plenty of corporate/hotel wifi) —
// that's the #1 cause of a phone broadcaster never connecting to a desktop
// viewer, or the call dying the moment either side's network blips. TURN
// relays the media through a server instead of relying on a direct path.
// openrelay.metered.ca is a free, intentionally-public demo relay — fine for
// getting real reliability today, but it's rate-limited with no SLA, so
// swap in a paid TURN provider (Twilio Network Traversal, Cloudflare Calls,
// metered.ca's paid tier, etc.) before this carries real production load.
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
];

// Static capability check (doesn't change at runtime) — Safari/iOS still
// don't implement getDisplayMedia, so the share-screen control stays hidden
// there instead of showing a button that always fails.
const canShareScreen = typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getDisplayMedia);

// How long a 'disconnected' peer connection (a network blip WebRTC can often
// recover from on its own) is given before it's treated as dead. 'failed' is
// still terminal immediately — only 'disconnected' gets this grace period.
const RECONNECT_GRACE_MS = 8000;

// Shared prefix (not app-specific) so a scope like 'community' is the same
// Realtime room across ICAN, digital-city-era, and mybodaguy — they already
// share one Supabase project and one landing_messages table for chat; this
// makes the "who's live" presence/signaling match that.
const presenceChannelFor = (scope) => `live-presence:${scope}`;
const signalChannelName = (streamId) => `live-signal:${streamId}`;

export const useCommunityLive = ({ selfId, selfName, canBroadcast, scope = 'community' }) => {
  // Any number of people can broadcast to the same scope at once — this is
  // every currently-live broadcaster (not just one), oldest-started-first so
  // the newest live lands last, same "latest at the bottom" ordering as the
  // chat feed itself (see groupedCommunityFeed in ChatWidget.jsx).
  const [liveStreams, setLiveStreams] = useState([]); // { streamId, broadcasterId, broadcasterName, startedAt, viewerCount }[]
  const [activeStreamId, setActiveStreamId] = useState(''); // the stream I'm broadcasting or watching, if any
  const [role, setRole] = useState('idle'); // idle | broadcasting | watching
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [facingMode, setFacingMode] = useState('user');
  const [canSwitchCamera, setCanSwitchCamera] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState('');
  const [endReason, setEndReason] = useState(''); // 'ended' | 'error' | ''

  const roleRef = useRef('idle');
  const selfIdRef = useRef(selfId);
  const selfNameRef = useRef(selfName);
  const scopeRef = useRef(scope);
  const streamIdRef = useRef('');
  const broadcasterIdRef = useRef('');
  const liveStreamsRef = useRef([]); // mirrors liveStreams state — watch() needs the latest list without becoming stale in its own closure
  const localStreamRef = useRef(null); // always the camera+mic stream, even while screen-sharing (so stopping the share can revert to it)
  const screenStreamRef = useRef(null); // set only while screen-sharing
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
  useEffect(() => { liveStreamsRef.current = liveStreams; }, [liveStreams]);

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
    if (screenStreamRef.current) { screenStreamRef.current.getTracks().forEach((t) => t.stop()); screenStreamRef.current = null; }
    if (localStreamRef.current) { localStreamRef.current.getTracks().forEach((t) => t.stop()); localStreamRef.current = null; }
    pendingIceRef.current.clear();
    setLocalStream(null);
    setRemoteStream(null);
    setFacingMode('user');
    setCanSwitchCamera(false);
    setIsScreenSharing(false);
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
    setActiveStreamId('');
  }, [teardownMedia, closeSignalChannel, untrackSelfPresence]);

  // --- Presence: who is live + how many are watching each stream -----------
  // Any number of broadcaster presence rows can be live at once now (one per
  // person who's gone live), each with its own viewer count — this used to
  // track a single implicit broadcaster, which is what made a second person
  // going live blocked/overwrite the first.
  useEffect(() => {
    if (!selfId || !scope) return undefined;
    const channel = supabase.channel(presenceChannelFor(scope), { config: { presence: { key: selfId } } });

    const syncFromState = () => {
      const state = channel.presenceState();
      const broadcasters = new Map(); // streamId -> presence entry
      Object.values(state).forEach((entries) => {
        const entry = entries?.[0];
        if (entry?.role === 'broadcaster') broadcasters.set(entry.streamId, entry);
      });
      const viewerCounts = new Map(); // streamId -> count
      Object.values(state).forEach((entries) => {
        const entry = entries?.[0];
        if (entry?.role === 'viewer' && broadcasters.has(entry.streamId)) {
          viewerCounts.set(entry.streamId, (viewerCounts.get(entry.streamId) || 0) + 1);
        }
      });

      const streams = Array.from(broadcasters.values())
        .map((b) => ({
          streamId: b.streamId,
          broadcasterId: b.userId,
          broadcasterName: b.name,
          startedAt: b.startedAt,
          viewerCount: viewerCounts.get(b.streamId) || 0,
        }))
        // Oldest-started-first, so the newest live lands last — same
        // "latest at the bottom" ordering as the chat feed itself.
        .sort((a, b) => new Date(a.startedAt) - new Date(b.startedAt));

      setLiveStreams(streams);

      // The stream I was watching vanished (broadcaster crashed/closed the
      // tab without sending stream-ended) — everyone else stays live.
      if (roleRef.current === 'watching' && streamIdRef.current && !broadcasters.has(streamIdRef.current)) {
        resetToIdle('ended');
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
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        peerConnectionsRef.current.delete(viewerId);
      } else if (pc.connectionState === 'disconnected') {
        // Common on mobile (wifi<->cellular handoff, a moment of weak
        // signal) and often self-heals — don't drop the viewer instantly.
        setTimeout(() => {
          if (peerConnectionsRef.current.get(viewerId) === pc && pc.connectionState === 'disconnected') {
            try { pc.close(); } catch (_) { /* already closed */ }
            peerConnectionsRef.current.delete(viewerId);
          }
        }, RECONNECT_GRACE_MS);
      }
    };
    const stream = localStreamRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => {
        // A viewer who joins mid-screen-share still needs to see the shared
        // screen, not the camera underneath it — seed their video
        // transceiver with whichever track is actually the live outgoing
        // one right now.
        const outgoing = track.kind === 'video' ? (screenStreamRef.current?.getVideoTracks()[0] || track) : track;
        pc.addTransceiver(outgoing, { direction: 'sendonly', streams: [stream] });
      });
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
    // Any number of people can be live at once now — this only guards
    // against starting a second broadcast of my own on top of one already
    // running, not against anyone else's stream already being live.
    if (!canBroadcast || roleRef.current !== 'idle' || !selfIdRef.current || !scopeRef.current) return;
    setError('');
    setEndReason('');

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'user' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: true,
      });
    } catch (err) {
      setError(err?.name === 'NotAllowedError' ? 'Camera/microphone permission denied' : 'Could not access camera/microphone');
      return;
    }
    localStreamRef.current = stream;
    setLocalStream(stream);
    setMicOn(true);
    setCamOn(true);
    setFacingMode('user');
    // Only offer the flip-camera control when there's actually more than one
    // camera to flip to (front+back phone, not a single desktop webcam).
    // Device labels are only populated after permission is granted, which it
    // just was, so this enumerate call will see them.
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      setCanSwitchCamera(devices.filter((d) => d.kind === 'videoinput').length > 1);
    } catch (_) { /* leave canSwitchCamera false — button just stays hidden */ }

    const streamId = `${scopeRef.current}:${selfIdRef.current}:${Date.now()}`;
    streamIdRef.current = streamId;
    broadcasterIdRef.current = selfIdRef.current;
    setActiveStreamId(streamId);

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
  }, [canBroadcast, createBroadcasterPeer, send, flushPendingIce]);

  const stopLive = useCallback(() => {
    if (roleRef.current !== 'broadcasting') return;
    send('stream-ended', {});
    resetToIdle('ended');
  }, [send, resetToIdle]);

  // --- Viewer ------------------------------------------------------------
  // Takes which stream to join — with several people live at once there's no
  // longer a single implicit one, so the caller (the picker list, or an
  // auto-join that only fires when there's exactly one candidate) has to say.
  const watch = useCallback((streamId) => {
    const target = liveStreamsRef.current.find((s) => s.streamId === streamId);
    if (roleRef.current !== 'idle' || !target || !selfIdRef.current) return;
    setError('');
    setEndReason('');
    const { broadcasterId, broadcasterName } = target;
    streamIdRef.current = streamId;
    broadcasterIdRef.current = broadcasterId;
    setActiveStreamId(streamId);

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
          if (roleRef.current !== 'watching') return;
          if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
            resetToIdle('ended');
          } else if (pc.connectionState === 'disconnected') {
            // Give a flaky mobile network a chance to recover before we tell
            // the viewer the stream ended out from under them.
            setError('Connection unstable — reconnecting…');
            setTimeout(() => {
              if (viewerPcRef.current !== pc || roleRef.current !== 'watching') return;
              if (pc.connectionState === 'disconnected') resetToIdle('ended');
              else if (pc.connectionState === 'connected') setError('');
            }, RECONNECT_GRACE_MS);
          } else if (pc.connectionState === 'connected') {
            setError('');
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
        void broadcasterName; // kept in liveStreams/activeStream for the UI; nothing further to do with it here
      });
  }, [send, flushPendingIce, resetToIdle]);

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

  // Flip between front/back camera mid-broadcast. Grabs a fresh video-only
  // track for the other camera, swaps it into the existing local stream (so
  // the broadcaster's own preview updates immediately — the video element is
  // already bound to that same MediaStream object), then hands the new track
  // to every connected viewer's peer connection via replaceTrack. replaceTrack
  // pushes the new frames without renegotiating the whole connection, so
  // viewers see the flip seamlessly instead of the call briefly dropping.
  const switchCamera = useCallback(async () => {
    if (roleRef.current !== 'broadcasting' || !localStreamRef.current) return;
    const nextFacing = facingMode === 'user' ? 'environment' : 'user';
    let newStream;
    try {
      newStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: nextFacing }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
    } catch (err) {
      setError('Could not switch camera');
      return;
    }
    const newTrack = newStream.getVideoTracks()[0];
    if (!newTrack) return;
    newTrack.enabled = camOn;

    const oldTrack = localStreamRef.current.getVideoTracks()[0];
    if (oldTrack) {
      localStreamRef.current.removeTrack(oldTrack);
      oldTrack.stop();
    }
    localStreamRef.current.addTrack(newTrack);

    // While screen-sharing, viewers are receiving the screen track, not the
    // camera — don't push the flipped camera over it. It's already swapped
    // into localStreamRef, so it'll take over as soon as sharing stops.
    if (!screenStreamRef.current) {
      peerConnectionsRef.current.forEach((pc) => {
        const sender = pc.getSenders().find((s) => s.track && s.track.kind === 'video');
        if (sender) sender.replaceTrack(newTrack).catch(() => {});
      });
    }

    setFacingMode(nextFacing);
  }, [facingMode, camOn]);

  // Revert every viewer's video sender back to the camera and stop the
  // display-capture track. Also fires when the user stops sharing via the
  // browser/OS's own "Stop sharing" control rather than our button, since
  // that only stops the track (screenTrack.onended, wired below) — this is
  // the one place that undoes everything else a share touched.
  const stopScreenShare = useCallback(() => {
    if (!screenStreamRef.current) return;
    screenStreamRef.current.getTracks().forEach((t) => { try { t.stop(); } catch (_) { /* already stopped */ } });
    screenStreamRef.current = null;

    const cameraStream = localStreamRef.current;
    const cameraTrack = cameraStream?.getVideoTracks()?.[0] || null;
    if (cameraTrack) {
      peerConnectionsRef.current.forEach((pc) => {
        const sender = pc.getSenders().find((s) => s.track && s.track.kind === 'video');
        if (sender) sender.replaceTrack(cameraTrack).catch(() => {});
      });
    }

    setLocalStream(cameraStream || null);
    setIsScreenSharing(false);
  }, []);

  // Shares a window/tab/whole screen instead of the camera — reuses the same
  // getDisplayMedia + replaceTrack approach as LiveBoardroom.jsx's group
  // calls. Unlike LiveBoardroom (full mesh, every peer's own sender), this
  // hook already keeps one RTCPeerConnection per viewer in
  // peerConnectionsRef, so pushing the screen out is just a replaceTrack per
  // viewer — no renegotiation, no visible glitch for anyone already watching.
  const startScreenShare = useCallback(async () => {
    if (roleRef.current !== 'broadcasting' || screenStreamRef.current) return;
    let displayStream;
    try {
      displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 15 }, cursor: 'always' },
        audio: false,
      });
    } catch (err) {
      // NotAllowedError/AbortError = the user cancelled the share picker — not an error.
      if (err?.name !== 'NotAllowedError' && err?.name !== 'AbortError') {
        setError(err?.name === 'NotSupportedError' ? 'Screen sharing is not supported in this browser' : 'Could not start screen sharing');
      }
      return;
    }
    const screenTrack = displayStream.getVideoTracks()[0];
    if (!screenTrack) { displayStream.getTracks().forEach((t) => t.stop()); return; }

    screenStreamRef.current = displayStream;
    peerConnectionsRef.current.forEach((pc) => {
      const sender = pc.getSenders().find((s) => s.track && s.track.kind === 'video');
      if (sender) sender.replaceTrack(screenTrack).catch(() => {});
    });
    // Covers the OS/browser's own "Stop sharing" bar/button, not just ours.
    screenTrack.onended = () => stopScreenShare();

    setLocalStream(displayStream);
    setIsScreenSharing(true);
  }, [stopScreenShare]);

  const toggleScreenShare = useCallback(() => {
    if (isScreenSharing) stopScreenShare();
    else startScreenShare();
  }, [isScreenSharing, startScreenShare, stopScreenShare]);

  // Full cleanup on unmount.
  useEffect(() => () => {
    clearElapsedTimer();
    teardownMedia();
    closeSignalChannel();
    untrackSelfPresence();
  }, [teardownMedia, closeSignalChannel, untrackSelfPresence]);

  // The stream I'm currently broadcasting or watching, if any — looked up
  // live out of liveStreams (rather than kept as its own copy) so its
  // viewerCount stays in sync with presence without an extra effect.
  const activeStream = liveStreams.find((s) => s.streamId === activeStreamId) || null;

  return {
    liveStreams,
    activeStream,
    // Kept for the pieces of the UI (CommunityLiveStage's top-right badge)
    // that only ever care about "the stream I'm in right now", not the full list.
    viewerCount: activeStream?.viewerCount || 0,
    role,
    localStream,
    remoteStream,
    micOn,
    camOn,
    facingMode,
    canSwitchCamera,
    isScreenSharing,
    canShareScreen,
    elapsed,
    error,
    endReason,
    canBroadcast: Boolean(canBroadcast) && role === 'idle',
    // Generic "is there anything to watch" gate. Callers deciding whether to
    // *auto*-join should check liveStreams.length === 1 instead — forcing a
    // visitor into one of several concurrent streams would be picking for
    // them; the picker list is what handles the ambiguous case.
    canWatch: Boolean(selfId) && role === 'idle' && liveStreams.length > 0,
    isSelfBroadcaster: role === 'broadcasting',
    goLive,
    stopLive,
    watch,
    stopWatching,
    toggleMic,
    toggleCam,
    switchCamera,
    toggleScreenShare,
  };
};

export default useCommunityLive;
