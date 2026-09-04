/**
 * Generic 1:1 audio/video call engine over Supabase Realtime broadcast —
 * same signaling mechanism as LiveBoardroom.jsx (broadcast channel per
 * call, STUN-only RTCPeerConnection, pending-ICE-candidate queue), just
 * simplified from N-party to strictly two participants.
 *
 * Because a call room only ever has two people in it, this never needs to
 * know the peer's id up front — it treats any broadcast message that isn't
 * from `selfId` as coming from the peer, and learns their id/name from
 * whatever they send first. That's what lets the Support channel work even
 * though the widget side has no idea which developer will answer, and the
 * Dev Panel side has no real auth.uid() to identify itself with.
 *
 * `roomId` should be the caller's own stable "personal inbox" — e.g.
 * `cmms:<companyId>:<myCmmsUserId>` or `trust:<groupId>:<myAuthId>` — so
 * this hook is always listening for an incoming ring regardless of which
 * chat tab happens to be open. It has nothing to do with who the *next*
 * outgoing call goes to: pass that peer's own inbox room as `startCall`'s
 * `dialRoomId` instead, and the hook joins it for the life of that one call
 * before reverting to listening on `roomId` again. Changing `roomId`/
 * `selfId` while idle moves the hook to the new default room; changing it
 * mid-call is deferred until the call ends, so switching tabs in the UI
 * can't yank an in-progress call.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { getSupabaseClient } from '../lib/supabase/client';
import { getAudioNotificationService } from '../services/audioNotificationService';

const supabase = getSupabaseClient();

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

const RING_INTERVAL_MS = 3000;
const RING_TIMEOUT_MS = 45000;

export const useDirectCall = ({ roomId, selfId, selfName }) => {
  const [callState, setCallState] = useState('idle'); // idle | ringing-out | ringing-in | active
  const [isVideo, setIsVideo] = useState(false);
  const [peerName, setPeerName] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [error, setError] = useState('');
  const [endReason, setEndReason] = useState(''); // 'declined' | 'busy' | 'no-answer' | 'ended' | ''
  const [peerId, setPeerId] = useState('');

  const [subscribedConfig, setSubscribedConfig] = useState({ roomId: null, selfId: null, selfName: '' });

  const callStateRef = useRef(callState);
  const peerIdRef = useRef('');
  const pcRef = useRef(null);
  const localStreamRef = useRef(null);
  const pendingIceRef = useRef([]);
  const channelRef = useRef(null);
  const ringIntervalRef = useRef(null);
  const ringTimeoutRef = useRef(null);
  const elapsedTimerRef = useRef(null);
  const audioServiceRef = useRef(null);
  const micOnRef = useRef(true);
  const camOnRef = useRef(true);
  // The hook's own "at rest" room — where it listens for incoming rings when
  // nobody's mid-call. `startCall` can point `subscribedConfig` at a peer's
  // room instead for the life of one outgoing call; `resetToIdle` reads this
  // to know where to go back to listening afterward.
  const defaultRoomRef = useRef({ roomId, selfId, selfName });
  // One entry per room id we've ever subscribed to, resolved once that room's
  // channel reports SUBSCRIBED — lets `startCall` wait out the async
  // subscribe-then-tear-down-old-channel cycle triggered by switching rooms,
  // instead of racing a `ring` broadcast against a channel that isn't open yet.
  const roomReadyRef = useRef(new Map());

  useEffect(() => { callStateRef.current = callState; }, [callState]);
  useEffect(() => { micOnRef.current = micOn; }, [micOn]);
  useEffect(() => { camOnRef.current = camOn; }, [camOn]);
  useEffect(() => { defaultRoomRef.current = { roomId, selfId, selfName }; }, [roomId, selfId, selfName]);
  useEffect(() => {
    try { audioServiceRef.current = getAudioNotificationService(); } catch (_) { /* audio is optional */ }
  }, []);

  // Adopt a new room/identity only while idle, so a mid-call tab switch
  // in the surrounding UI can't tear down an active call.
  useEffect(() => {
    if (callStateRef.current === 'idle') {
      setSubscribedConfig({ roomId, selfId, selfName });
    }
  }, [roomId, selfId, selfName]);

  // Waits for the channel bound to `rid` to report SUBSCRIBED (set up by the
  // channel-setup effect below). Polls for the entry to exist first, since
  // `setSubscribedConfig` triggers that effect asynchronously (next render),
  // and gives up after ~3s so a broken room can't hang a call forever.
  const waitForRoomReady = useCallback((rid) => new Promise((resolve) => {
    let attempts = 0;
    const check = () => {
      const entry = roomReadyRef.current.get(rid);
      if (entry) { entry.promise.then(resolve); return; }
      attempts += 1;
      if (attempts > 150) { resolve(); return; }
      setTimeout(check, 20);
    };
    check();
  }), []);

  const clearRingTimers = () => {
    if (ringIntervalRef.current) { clearInterval(ringIntervalRef.current); ringIntervalRef.current = null; }
    if (ringTimeoutRef.current) { clearTimeout(ringTimeoutRef.current); ringTimeoutRef.current = null; }
  };

  const clearElapsedTimer = () => {
    if (elapsedTimerRef.current) { clearInterval(elapsedTimerRef.current); elapsedTimerRef.current = null; }
  };

  const teardownMedia = useCallback(() => {
    if (pcRef.current) {
      try { pcRef.current.close(); } catch (_) { /* already closed */ }
      pcRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    pendingIceRef.current = [];
    setLocalStream(null);
    setRemoteStream(null);
  }, []);

  const resetToIdle = useCallback((reason = '') => {
    clearRingTimers();
    clearElapsedTimer();
    teardownMedia();
    // Ringing (in or out) now loops until explicitly stopped (see
    // audioNotificationService.playRingtone) instead of a fixed rep count,
    // so every path back to idle — including a plain timeout with no
    // decline/end broadcast round-trip — must silence it here, or a ring
    // with nobody left to answer it would ring forever.
    audioServiceRef.current?.stopAllSounds();
    peerIdRef.current = '';
    setPeerId('');
    setElapsed(0);
    setEndReason(reason);
    setCallState('idle');
    // `startCall` may have pointed the channel at a peer's room for this one
    // call (see `dialRoomId`); go back to listening on our own room so the
    // next incoming ring has somewhere to arrive.
    setSubscribedConfig(defaultRoomRef.current);
  }, [teardownMedia]);

  const send = useCallback((event, payload) => {
    if (!channelRef.current) return;
    // Stamped with the identity the *active* channel is bound to
    // (subscribedConfig), not the raw `selfId` prop — they normally match,
    // but only subscribedConfig is guaranteed correct for whichever channel
    // instance is currently subscribed.
    channelRef.current.send({ type: 'broadcast', event, payload: { from: subscribedConfig.selfId, ...payload } });
  }, [subscribedConfig.selfId]);

  const ensureLocalMedia = useCallback(async (video) => {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: video ? { width: { ideal: 1280 }, height: { ideal: 720 } } : false,
      audio: true,
    });
    localStreamRef.current = stream;
    setLocalStream(stream);
    return stream;
  }, []);

  const createPeerConnection = useCallback(() => {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      send('webrtc-ice', { candidate: event.candidate });
    };

    pc.ontrack = (event) => {
      const [stream] = event.streams;
      if (stream) setRemoteStream(stream);
    };

    pc.onconnectionstatechange = () => {
      if (['failed', 'disconnected', 'closed'].includes(pc.connectionState) && callStateRef.current === 'active') {
        resetToIdle('ended');
      }
    };

    const stream = localStreamRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));
    }

    pcRef.current = pc;
    return pc;
  }, [send, resetToIdle]);

  const flushPendingIce = useCallback(async (pc) => {
    const queued = pendingIceRef.current;
    pendingIceRef.current = [];
    for (const candidate of queued) {
      try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch (_) { /* stale candidate */ }
    }
  }, []);

  // `dialRoomId` lets the caller reach into a specific peer's own room —
  // e.g. their personal CMMS/Trust/Community inbox — instead of whatever
  // room this hook is currently sitting on. Omit it (as Support does) when
  // the hook's own room is already the shared room both sides use.
  const startCall = useCallback(async (video, peerNameHint = '', dialRoomId = null) => {
    if (callStateRef.current !== 'idle') return;
    const targetRoomId = dialRoomId || subscribedConfig.roomId;
    if (!targetRoomId || !subscribedConfig.selfId) return;
    setError('');
    setEndReason('');

    if (targetRoomId !== subscribedConfig.roomId) {
      setSubscribedConfig({ roomId: targetRoomId, selfId: subscribedConfig.selfId, selfName: subscribedConfig.selfName });
      await waitForRoomReady(targetRoomId);
      // The idle check may no longer hold if something else (an incoming
      // ring, a cancel) happened while we were waiting on the channel.
      if (callStateRef.current !== 'idle') return;
    }
    if (!channelRef.current) return;

    try {
      await ensureLocalMedia(video);
    } catch (err) {
      setError(err?.name === 'NotAllowedError' ? 'Camera/microphone permission denied' : 'Could not access camera/microphone');
      return;
    }
    setIsVideo(video);
    setMicOn(true);
    setCamOn(video);
    setPeerName(peerNameHint);
    setCallState('ringing-out');
    audioServiceRef.current?.ensureReady?.();
    audioServiceRef.current?.playRingtone('outgoingCall', Infinity);

    const ring = () => send('ring', { fromName: subscribedConfig.selfName, video });
    ring();
    ringIntervalRef.current = setInterval(ring, RING_INTERVAL_MS);
    ringTimeoutRef.current = setTimeout(() => {
      send('end', {});
      resetToIdle('no-answer');
    }, RING_TIMEOUT_MS);
  }, [ensureLocalMedia, send, resetToIdle, waitForRoomReady, subscribedConfig.roomId, subscribedConfig.selfId, subscribedConfig.selfName]);

  const acceptCall = useCallback(async () => {
    if (callStateRef.current !== 'ringing-in') return;
    clearRingTimers();
    audioServiceRef.current?.stopAllSounds();
    setError('');
    try {
      await ensureLocalMedia(isVideo);
    } catch (err) {
      setError(err?.name === 'NotAllowedError' ? 'Camera/microphone permission denied' : 'Could not access camera/microphone');
      send('decline', { reason: 'media-error' });
      resetToIdle('ended');
      return;
    }
    setMicOn(true);
    setCamOn(isVideo);
    setCallState('active');
    elapsedTimerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
    send('accept', { fromName: subscribedConfig.selfName });
  }, [ensureLocalMedia, isVideo, send, subscribedConfig.selfName, resetToIdle]);

  const declineCall = useCallback(() => {
    if (callStateRef.current !== 'ringing-in') return;
    send('decline', { reason: 'declined' });
    audioServiceRef.current?.stopAllSounds();
    resetToIdle('ended');
  }, [send, resetToIdle]);

  const endCall = useCallback(() => {
    if (callStateRef.current === 'idle') return;
    send('end', {});
    audioServiceRef.current?.stopAllSounds();
    audioServiceRef.current?.playSound('callEnded');
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
    if (!isVideo) return;
    setCamOn((prev) => {
      const next = !prev;
      localStreamRef.current?.getVideoTracks().forEach((t) => { t.enabled = next; });
      return next;
    });
  }, [isVideo]);

  // Channel setup — only re-subscribes when the committed (idle-gated) config changes.
  useEffect(() => {
    const { roomId: rid, selfId: sid, selfName: sname } = subscribedConfig;
    if (!rid || !sid) {
      channelRef.current = null;
      return undefined;
    }

    const channel = supabase.channel(`ican-call:${rid}`, { config: { broadcast: { self: true } } });

    let resolveReady;
    const readyPromise = new Promise((res) => { resolveReady = res; });
    roomReadyRef.current.set(rid, { promise: readyPromise });

    channel
      .on('broadcast', { event: 'ring' }, async ({ payload }) => {
        if (!payload || payload.from === sid) return;
        if (callStateRef.current !== 'idle') {
          if (callStateRef.current !== 'ringing-in' || peerIdRef.current !== payload.from) {
            channel.send({ type: 'broadcast', event: 'decline', payload: { from: sid, reason: 'busy' } });
          }
          return;
        }
        peerIdRef.current = payload.from;
        setPeerId(payload.from);
        setIsVideo(!!payload.video);
        setPeerName(payload.fromName || 'Someone');
        setCallState('ringing-in');
        setError('');
        setEndReason('');
        audioServiceRef.current?.ensureReady?.();
        audioServiceRef.current?.playRingtone('incomingCall', Infinity);
      })
      .on('broadcast', { event: 'accept' }, async ({ payload }) => {
        if (!payload || payload.from === sid || callStateRef.current !== 'ringing-out') return;
        peerIdRef.current = payload.from;
        setPeerId(payload.from);
        if (payload.fromName) setPeerName(payload.fromName);
        clearRingTimers();
        audioServiceRef.current?.stopAllSounds();
        setCallState('active');
        elapsedTimerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);

        const pc = createPeerConnection();
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          channel.send({ type: 'broadcast', event: 'webrtc-offer', payload: { from: sid, sdp: offer } });
        } catch (err) {
          console.warn('[useDirectCall] failed to create offer:', err);
        }
      })
      .on('broadcast', { event: 'decline' }, ({ payload }) => {
        if (!payload || payload.from === sid || callStateRef.current !== 'ringing-out') return;
        audioServiceRef.current?.stopAllSounds();
        resetToIdle(payload.reason === 'busy' ? 'busy' : 'declined');
      })
      .on('broadcast', { event: 'end' }, ({ payload }) => {
        if (!payload || payload.from === sid || callStateRef.current === 'idle') return;
        audioServiceRef.current?.stopAllSounds();
        audioServiceRef.current?.playSound('callEnded');
        resetToIdle('ended');
      })
      .on('broadcast', { event: 'webrtc-offer' }, async ({ payload }) => {
        if (!payload || payload.from === sid || callStateRef.current !== 'active') return;
        const pc = pcRef.current || createPeerConnection();
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
          await flushPendingIce(pc);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          channel.send({ type: 'broadcast', event: 'webrtc-answer', payload: { from: sid, sdp: answer } });
        } catch (err) {
          console.warn('[useDirectCall] failed to handle offer:', err);
        }
      })
      .on('broadcast', { event: 'webrtc-answer' }, async ({ payload }) => {
        if (!payload || payload.from === sid || !pcRef.current) return;
        try {
          await pcRef.current.setRemoteDescription(new RTCSessionDescription(payload.sdp));
          await flushPendingIce(pcRef.current);
        } catch (err) {
          console.warn('[useDirectCall] failed to handle answer:', err);
        }
      })
      .on('broadcast', { event: 'webrtc-ice' }, async ({ payload }) => {
        if (!payload || payload.from === sid || !payload.candidate) return;
        const pc = pcRef.current;
        if (pc && pc.remoteDescription) {
          try { await pc.addIceCandidate(new RTCIceCandidate(payload.candidate)); } catch (_) { /* stale candidate */ }
        } else {
          pendingIceRef.current.push(payload.candidate);
        }
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') resolveReady();
      });

    channelRef.current = channel;

    return () => {
      // Room is changing (or the hook is unmounting) mid-call — let the peer
      // know rather than leaving them hanging until their ICE connection
      // times out on its own.
      if (callStateRef.current !== 'idle') {
        try { channel.send({ type: 'broadcast', event: 'end', payload: { from: sid } }); } catch (_) { /* best effort */ }
      }
      supabase.removeChannel(channel);
      if (channelRef.current === channel) channelRef.current = null;
      roomReadyRef.current.delete(rid);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscribedConfig.roomId, subscribedConfig.selfId, createPeerConnection, flushPendingIce, resetToIdle]);

  // Full cleanup on unmount.
  useEffect(() => () => {
    clearRingTimers();
    clearElapsedTimer();
    teardownMedia();
  }, [teardownMedia]);

  return {
    callState,
    isVideo,
    peerName,
    peerId,
    elapsed,
    micOn,
    camOn,
    localStream,
    remoteStream,
    error,
    endReason,
    canCall: Boolean(subscribedConfig.roomId && subscribedConfig.selfId) && callState === 'idle',
    startCall,
    acceptCall,
    declineCall,
    endCall,
    toggleMic,
    toggleCam,
  };
};

export default useDirectCall;
