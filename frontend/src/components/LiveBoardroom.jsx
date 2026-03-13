/**
 * LiveBoardroom - Real-time group video meeting with presence tracking
 * Features: Live member presence, real-time chat sync, member status tracking
 */

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { getSupabaseClient } from '../lib/supabase/client';
import { getAudioNotificationService } from '../services/audioNotificationService';
import {
  X, Video, Mic, MicOff, VideoOff, Phone, Users, Share2, Send,
  MessageCircle, Eye, Wifi, WifiOff, Circle, Volume2, VolumeX, MoreVertical
} from 'lucide-react';

const EMPTY_MEMBERS = [];

const LiveBoardroom = ({ groupId, groupName, members, creatorId = null, onClose = () => {} }) => {
  const { user } = useAuth();
  const userId = user?.id;
  const userEmail = user?.email;
  const normalizedMembers = useMemo(
    () => (Array.isArray(members) ? members : EMPTY_MEMBERS),
    [members]
  );
  const [isVideoOn, setIsVideoOn] = useState(false);
  const [isMicOn, setIsMicOn] = useState(true);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [meetingStarted, setMeetingStarted] = useState(false);
  const [isHost, setIsHost] = useState(false);
  const [meetingTime, setMeetingTime] = useState(0);
  const [chatMessages, setChatMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [showChat, setShowChat] = useState(true);
  const [hoveredControl, setHoveredControl] = useState(null);
  const [connectedMembers, setConnectedMembers] = useState([]);
  const [groupMembers, setGroupMembers] = useState(normalizedMembers);
  const [isOnline, setIsOnline] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [soundVolume, setSoundVolume] = useState(0.7);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [incomingCall, setIncomingCall] = useState(null);
  const [callAccepted, setCallAccepted] = useState(false);
  const [hasActiveCall, setHasActiveCall] = useState(false);
  const [boardroomMode, setBoardroomMode] = useState(null); // null = picker | 'chat' | 'live'
  const [isCalling, setIsCalling] = useState(false); // host is ringing members
  const [callingTimer, setCallingTimer] = useState(0); // seconds since call started
  const [remoteStreams, setRemoteStreams] = useState([]); // [{ userId, email, stream }]

  const videoRef = useRef(null);
  const meetingTimerRef = useRef(null);
  const containerRef = useRef(null);
  const presenceRef = useRef(null);
  const chatSubscriptionRef = useRef(null);
  const audioServiceRef = useRef(null);
  const previousMembersRef = useRef([]);
  const touchStartX = useRef(0);
  const callChannelRef = useRef(null);
  const webrtcChannelRef = useRef(null);
  const localStreamRef = useRef(null);
  const peerConnectionsRef = useRef(new Map());
  const pendingIceCandidatesRef = useRef(new Map());
  const callingTimerRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const isVideoOnRef = useRef(false);
  const isMicOnRef = useRef(true);

  const supabase = useMemo(() => getSupabaseClient(), []);

  const getRemoteStreamByUserId = useCallback(
    (userId) => remoteStreams.find((s) => s.userId === userId)?.stream,
    [remoteStreams]
  );

  const peerTargets = useMemo(() => {
    const peers = new Map();

    (connectedMembers || []).forEach((member) => {
      if (!member?.userId || member.userId === userId) return;
      peers.set(member.userId, member.email || '');
    });

    (groupMembers || []).forEach((member) => {
      const id = member?.id || member?.user_id;
      if (!id || id === userId) return;
      if (!peers.has(id)) {
        peers.set(id, member?.email || member?.user_email || '');
      }
    });

    return Array.from(peers.entries()).map(([id, email]) => ({ id, email }));
  }, [connectedMembers, groupMembers, userId]);

  // Initialize audio notification service
  useEffect(() => {
    try {
      audioServiceRef.current = getAudioNotificationService();
      audioServiceRef.current.setEnabled(soundEnabled);
      audioServiceRef.current.setVolume(soundVolume);
    } catch (err) {
      console.warn('Audio service initialization failed:', err);
    }
  }, []);

  // Update audio service settings
  useEffect(() => {
    if (audioServiceRef.current) {
      audioServiceRef.current.setEnabled(soundEnabled);
      audioServiceRef.current.setVolume(soundVolume);
    }
  }, [soundEnabled, soundVolume]);

  // Keep latest close handler without forcing channel re-subscription on each render.
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    isVideoOnRef.current = isVideoOn;
  }, [isVideoOn]);

  useEffect(() => {
    isMicOnRef.current = isMicOn;
  }, [isMicOn]);

  // Monitor member joins/leaves and play sounds
  useEffect(() => {
    if (!meetingStarted || !audioServiceRef.current) return;

    const previousMembers = previousMembersRef.current;
    const currentMembers = connectedMembers || [];

    // Check for new members (joined)
    currentMembers.forEach(member => {
      const wasPresent = previousMembers.some(m => m.userId === member.userId);
      if (!wasPresent && member.userId !== user?.id) {
        // Play member joined sound
        audioServiceRef.current.playSound('memberJoined');
      }
    });

    // Check for members that left
    previousMembers.forEach(member => {
      const isStillPresent = currentMembers.some(m => m.userId === member.userId);
      if (!isStillPresent) {
        // Play member left sound
        audioServiceRef.current.playSound('memberLeft');
      }
    });

    previousMembersRef.current = currentMembers;
  }, [connectedMembers, meetingStarted, user]);

  // Initialize host status
  useEffect(() => {
    if (user && creatorId === user?.id) setIsHost(true);
    else if (!creatorId && (!normalizedMembers || normalizedMembers.length === 0)) setIsHost(true);
  }, [normalizedMembers, user, creatorId]);

  // Load group members and set up real-time connections
  useEffect(() => {
    const loadGroupMembers = async () => {
      if (!groupId) return;

      try {
        // First, use the members prop if available and has data
        if (normalizedMembers.length > 0) {
          console.log('Using members from props:', normalizedMembers);
          const transformedMembers = normalizedMembers.map(m => ({
            id: m.id || m.user_id,
            user_email: m.email || m.user_email || 'Unknown',
            email: m.email || m.user_email,
            status: 'member'
          }));
          setGroupMembers(transformedMembers);
          return;
        }

        // Fetch from Supabase
        if (!supabase) return;
        
        console.log('Fetching members from Supabase for group:', groupId);
        
        // Step 1: Get user_ids from trust_group_members
        const { data: memberData, error: memberError } = await supabase
          .from('trust_group_members')
          .select('user_id')
          .eq('group_id', groupId);

        if (memberError) {
          console.warn('Error fetching members:', memberError);
          return;
        }

        console.log('Fetched member data:', memberData);
        
        if (!memberData || memberData.length === 0) {
          console.log('No members found');
          setGroupMembers([]);
          return;
        }

        // Step 2: Get user details
        const userIds = memberData.map(m => m.user_id);
        console.log('User IDs to fetch:', userIds);
        
        // Prefer public profiles table (RLS-safe) instead of users table.
        const { data: profilesData, error: profilesError } = await supabase
          .from('profiles')
          .select('id, email, full_name')
          .in('id', userIds);

        if (profilesError) {
          console.warn('Error fetching profiles:', profilesError);
        }

        console.log('Fetched profiles data:', profilesData);
        console.log('Profiles data length:', profilesData?.length || 0);

        // Fallback for IDs that are not readable in profiles due to policy/state.
        const profileById = new Map((profilesData || []).map(p => [p.id, p]));
        const transformedMembers = userIds.map((id) => {
          const profile = profileById.get(id);
          const fallbackLabel = `member-${String(id).slice(0, 6)}`;
          const resolvedEmail = profile?.email || profile?.full_name || fallbackLabel;
          return {
            id,
            user_email: resolvedEmail,
            email: resolvedEmail,
            status: 'member'
          };
        });
        
        console.log('Transformed members:', transformedMembers);
        setGroupMembers(transformedMembers);
      } catch (err) {
        console.warn('Error loading group members:', err);
      }
    };

    loadGroupMembers();
  }, [groupId, supabase, normalizedMembers]);

  // Load chat history and set up real-time chat
  useEffect(() => {
    const setupChat = async () => {
      if (!supabase || !groupId || (!meetingStarted && boardroomMode !== 'chat')) return;

      try {
        // Load recent messages
        const { data: messages, error } = await supabase
          .from('boarding_room_chat')
          .select('*')
          .eq('group_id', groupId)
          .order('created_at', { ascending: true })
          .limit(50);

        if (!error && messages) {
          setChatMessages(messages.map(m => ({
            id: m.id,
            sender: m.user_email?.split('@')[0] || 'User',
            message: m.message,
            timestamp: new Date(m.created_at),
            isThis: m.user_id === user?.id,
            isSystem: m.is_system
          })));
        }

        // Subscribe to real-time chat updates
        const subscription = supabase
          .channel(`boardroom-chat:${groupId}`)
          .on('postgres_changes', {
            event: 'INSERT',
            schema: 'public',
            table: 'boarding_room_chat',
            filter: `group_id=eq.${groupId}`
          }, (payload) => {
            const newMsg = payload.new;
            const isOwnMessage = newMsg.user_id === user?.id;
            
            // Play message notification sound (only for messages from others)
            if (!isOwnMessage && audioServiceRef.current) {
              audioServiceRef.current.playSound('messageNotification');
            }
            
            setChatMessages(prev => [...prev, {
              id: newMsg.id,
              sender: newMsg.user_email?.split('@')[0] || 'User',
              message: newMsg.message,
              timestamp: new Date(newMsg.created_at),
              isThis: isOwnMessage,
              isSystem: newMsg.is_system
            }]);
          })
          .subscribe();

        chatSubscriptionRef.current = subscription;
      } catch (err) {
        console.warn('Error setting up chat:', err);
      }
    };

    setupChat();

    return () => {
      if (chatSubscriptionRef.current) {
        chatSubscriptionRef.current.unsubscribe();
      }
    };
  }, [groupId, supabase, meetingStarted, boardroomMode, user]);

  // Set up call broadcast channel for incoming/outgoing call notifications
  // This must run immediately and persist for the entire session
  useEffect(() => {
    if (!supabase || !groupId || !user?.id) return;

    console.log('🔌 [CALL CHANNEL] Initializing call channel for group:', groupId);

    try {
      const callBroadcast = supabase.channel(`boardroom-calls:${groupId}`, {
        config: { broadcast: { self: true } }
      });

      // Chain ALL listeners BEFORE subscribing
      callBroadcast
        .on('broadcast', { event: 'call-started' }, ({ payload }) => {
          console.log('📞 [CALL RECEIVED] CALL STARTED broadcast received:', payload);
          console.log('📞 [CALL RECEIVED] Current user ID:', user?.id, 'Is this my call?:', payload.hostId === user?.id);
          
          // Only show incoming call if this is NOT our call (we're not the host)
          if (payload.hostId !== user?.id) {
            console.log('✅ [CALL RECEIVED] This call is for me! Setting incoming call state...');
            setIncomingCall(payload);
            
            // Play ringtone
            if (audioServiceRef.current) {
              console.log('🔊 [CALL RECEIVED] Playing incoming call ringtone...');
              audioServiceRef.current.playRingtone('incomingCall', 3);
            }
          } else {
            console.log('⚠️  [CALL RECEIVED] Ignoring - I am the initiator of this call');
          }
        })
        .on('broadcast', { event: 'call-ended' }, ({ payload }) => {
          console.log('📞 [CALL ENDED] Call ended:', payload);
          setIncomingCall(null);
          setIsCalling(false);
          setCallAccepted(false);
          setMeetingStarted(false);
          setIsVideoOn(false);
          setMeetingTime(0);
          setConnectedMembers([]);
          if (callingTimerRef.current) {
            clearInterval(callingTimerRef.current);
            callingTimerRef.current = null;
          }
          if (audioServiceRef.current) {
            audioServiceRef.current.stopAllSounds();
            audioServiceRef.current.playSound('callEnded');
          }
          // Participants should exit boardroom when host ends the call.
          if (payload?.hostId && payload.hostId !== user?.id) {
            onCloseRef.current?.();
          }
        })
        .on('broadcast', { event: 'call-accepted' }, ({ payload }) => {
          console.log('✅ [CALL ACCEPTED] Member accepted the call:', payload);
          // Host: someone accepted, start the meeting!
          if (payload.acceptedBy !== user?.id) {
            setIsCalling(false);
            setMeetingStarted(true);
            if (callingTimerRef.current) { clearInterval(callingTimerRef.current); callingTimerRef.current = null; }
            if (audioServiceRef.current) audioServiceRef.current.playSound('memberJoined');
          }
        })
        .subscribe((status) => {
          console.log('🔌 [CALL CHANNEL] Channel status changed to:', status);
          if (status === 'SUBSCRIBED') {
            console.log('✅ [CALL CHANNEL] Successfully subscribed to call channel');
          }
        });

      callChannelRef.current = callBroadcast;
      console.log('✅ [CALL CHANNEL] Call channel initialized and subscribed');
    } catch (err) {
      console.error('❌ [CALL CHANNEL] Error setting up call channel:', err);
    }

    return () => {
      console.log('🔌 [CALL CHANNEL] Cleaning up call channel');
      if (callChannelRef.current) {
        callChannelRef.current.unsubscribe();
      }
    };
  }, [groupId, supabase, user?.id]);

  // Recover missed call-start/call-end broadcasts by checking recent system events.
  useEffect(() => {
    const probeRecentCallState = async () => {
      if (!supabase || !groupId || !user?.id || isHost || meetingStarted) return;

      try {
        const { data, error } = await supabase
          .from('boarding_room_chat')
          .select('message, created_at, user_id, user_email, is_system')
          .eq('group_id', groupId)
          .eq('is_system', true)
          .order('created_at', { ascending: false })
          .limit(30);

        if (error) {
          console.warn('Call-state probe failed:', error);
          return;
        }

        const events = data || [];
        const startEvent = events.find((e) => /is calling/i.test(e.message || ''));
        const endEvent = events.find((e) => /call ended|left the meeting/i.test(e.message || ''));

        const startTs = startEvent ? new Date(startEvent.created_at).getTime() : 0;
        const endTs = endEvent ? new Date(endEvent.created_at).getTime() : 0;
        const now = Date.now();
        const callStillFresh = startTs > 0 && now - startTs < 70_000;
        const active = Boolean(startTs && startTs > endTs && callStillFresh);

        setHasActiveCall(active);

        if (active && !incomingCall) {
          setIncomingCall({
            hostId: startEvent?.user_id,
            hostEmail: startEvent?.user_email,
            groupId,
            timestamp: startEvent?.created_at
          });
        }

        if (!active && incomingCall) {
          setIncomingCall(null);
        }
      } catch (err) {
        console.warn('Error probing recent call state:', err);
      }
    };

    probeRecentCallState();
    const interval = setInterval(probeRecentCallState, 10_000);
    return () => clearInterval(interval);
  }, [supabase, groupId, user?.id, isHost, meetingStarted, incomingCall]);

  // Monitor for incoming calls from host
  useEffect(() => {
    if (!meetingStarted && isHost === false && presenceRef.current) {
      // Check if any host is in the room
      const state = presenceRef.current.presenceState();
      const hasHost = Object.values(state).some(presence => 
        presence && presence.length > 0 && presence[0]?.isHost
      );
      
      if (hasHost && !incomingCall) {
        setIncomingCall('Incoming call...');
        if (audioServiceRef.current) {
          audioServiceRef.current.playRingtone('incomingCall', 3);
        }
      }
    }
  }, [meetingStarted, isHost, incomingCall, presenceRef.current?.presenceState()]);

  // Set up presence tracking
  useEffect(() => {
    const setupPresence = async () => {
      if (!supabase || !groupId || !user) return;

      try {
        // Create presence channel
        const channel = supabase.channel(`boardroom-presence:${groupId}`, {
          config: { broadcast: { self: true } }
        });

        // Track user presence
        channel
          .on('presence', { event: 'sync' }, () => {
            const state = channel.presenceState();
            const userIds = Object.keys(state);
            const members = [];
            
            userIds.forEach(userId => {
              const presence = state[userId];
              if (presence && presence.length > 0) {
                members.push({
                  userId: presence[0]?.userId,
                  email: presence[0]?.email,
                  videoOn: presence[0]?.videoOn,
                  micOn: presence[0]?.micOn,
                  status: 'online'
                });
              }
            });
            
            setConnectedMembers(members);
          })
          .on('presence', { event: 'join' }, ({ key, newPresences }) => {
            console.log('Member joined:', newPresences);
            setConnectedMembers(prev => [...prev.filter(m => m.userId !== key), ...newPresences.map(p => ({
              userId: p.userId,
              email: p.email,
              videoOn: p.videoOn,
              micOn: p.micOn,
              status: 'online'
            }))]);
          })
          .on('presence', { event: 'leave' }, ({ key }) => {
            console.log('Member left:', key);
            setConnectedMembers(prev => prev.filter(m => m.userId !== key));
          })
          .subscribe(async (status) => {
            if (status === 'SUBSCRIBED') {
              await channel.track({
                userId: user.id,
                email: user.email,
                videoOn: isVideoOn,
                micOn: isMicOn,
                isHost: isHost,
                status: 'online'
              });
            }
          });

        presenceRef.current = channel;
      } catch (err) {
        console.warn('Error setting up presence:', err);
      }
    };

    if (meetingStarted) {
      setupPresence();
    }

    return () => {
      if (presenceRef.current) {
        presenceRef.current.unsubscribe();
      }
    };
  }, [groupId, supabase, user, meetingStarted, isVideoOn, isMicOn]);

  // Update presence when video/mic changes
  useEffect(() => {
    if (presenceRef.current && meetingStarted) {
      presenceRef.current.track({
        userId: user?.id,
        email: user?.email,
        videoOn: isVideoOn,
        micOn: isMicOn,
        status: 'online'
      });
    }
  }, [isVideoOn, isMicOn, meetingStarted, user]);

  // Meeting timer
  useEffect(() => {
    if (meetingStarted) {
      meetingTimerRef.current = setInterval(() => setMeetingTime(t => t + 1), 1000);
    }
    return () => { if (meetingTimerRef.current) clearInterval(meetingTimerRef.current); };
  }, [meetingStarted]);

  const ensureLocalStream = useCallback(async () => {
    if (localStreamRef.current) return localStreamRef.current;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: true
      });
      localStreamRef.current = stream;
      return stream;
    } catch (error) {
      console.error('Camera/microphone access error:', error);
      return null;
    }
  }, []);

  const updateLocalTrackState = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    stream.getVideoTracks().forEach((track) => {
      track.enabled = isVideoOn;
    });
    stream.getAudioTracks().forEach((track) => {
      track.enabled = isMicOn;
    });
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
    }
  }, [isVideoOn, isMicOn]);

  useEffect(() => {
    if (!meetingStarted) return;
    ensureLocalStream().then(() => updateLocalTrackState());
  }, [meetingStarted, ensureLocalStream, updateLocalTrackState]);

  useEffect(() => {
    updateLocalTrackState();
  }, [isVideoOn, isMicOn, updateLocalTrackState]);

  const createPeerConnection = useCallback(async (peerUserId, peerEmail = '') => {
    if (!peerUserId || peerUserId === userId) return null;
    if (peerConnectionsRef.current.has(peerUserId)) {
      return peerConnectionsRef.current.get(peerUserId);
    }

    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    });

    pc.onicecandidate = async (event) => {
      if (!event.candidate || !webrtcChannelRef.current) return;
      try {
        await webrtcChannelRef.current.send({
          type: 'broadcast',
          event: 'webrtc-signal',
          payload: {
            signalType: 'ice-candidate',
            from: userId,
            fromEmail: userEmail,
            target: peerUserId,
            candidate: event.candidate
          }
        });
      } catch (err) {
        console.warn('Failed to send ICE candidate:', err);
      }
    };

    pc.ontrack = (event) => {
      const [stream] = event.streams;
      if (!stream) return;
      setRemoteStreams((prev) => {
        const withoutPeer = prev.filter((s) => s.userId !== peerUserId);
        return [...withoutPeer, { userId: peerUserId, email: peerEmail, stream }];
      });
    };

    pc.onconnectionstatechange = () => {
      if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) {
        setRemoteStreams((prev) => prev.filter((s) => s.userId !== peerUserId));
      }
    };

    const localStream = await ensureLocalStream();
    if (localStream) {
      localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));
      localStream.getVideoTracks().forEach((track) => {
        track.enabled = isVideoOnRef.current;
      });
      localStream.getAudioTracks().forEach((track) => {
        track.enabled = isMicOnRef.current;
      });
    }

    peerConnectionsRef.current.set(peerUserId, pc);
    return pc;
  }, [ensureLocalStream, userId, userEmail]);

  const closeAllPeerConnections = useCallback(() => {
    peerConnectionsRef.current.forEach((pc) => {
      try { pc.close(); } catch (_) {}
    });
    peerConnectionsRef.current.clear();
    pendingIceCandidatesRef.current.clear();
    setRemoteStreams([]);
  }, []);

  // WebRTC signaling channel
  useEffect(() => {
    if (!supabase || !groupId || !userId || !meetingStarted) return;

    const signalingChannel = supabase.channel(`boardroom-webrtc:${groupId}`, {
      config: { broadcast: { self: true } }
    });

    signalingChannel
      .on('broadcast', { event: 'webrtc-signal' }, async ({ payload }) => {
        if (!payload || payload.target !== userId || payload.from === userId) return;

        const { signalType, from, fromEmail, offer, answer, candidate } = payload;
        let pc = peerConnectionsRef.current.get(from);

        if (!pc) {
          pc = await createPeerConnection(from, fromEmail);
          if (!pc) return;
        }

        try {
          if (signalType === 'offer' && offer) {
            await pc.setRemoteDescription(new RTCSessionDescription(offer));

            // Flush any ICE candidates that arrived before remote description was set.
            const queued = pendingIceCandidatesRef.current.get(from) || [];
            for (const queuedCandidate of queued) {
              try {
                await pc.addIceCandidate(new RTCIceCandidate(queuedCandidate));
              } catch (iceErr) {
                console.warn('Failed to apply queued ICE candidate:', iceErr);
              }
            }
            if (queued.length) pendingIceCandidatesRef.current.delete(from);

            const createdAnswer = await pc.createAnswer();
            await pc.setLocalDescription(createdAnswer);

            await signalingChannel.send({
              type: 'broadcast',
              event: 'webrtc-signal',
              payload: {
                signalType: 'answer',
                from: userId,
                fromEmail: userEmail,
                target: from,
                answer: createdAnswer
              }
            });
          } else if (signalType === 'answer' && answer) {
            await pc.setRemoteDescription(new RTCSessionDescription(answer));

            const queued = pendingIceCandidatesRef.current.get(from) || [];
            for (const queuedCandidate of queued) {
              try {
                await pc.addIceCandidate(new RTCIceCandidate(queuedCandidate));
              } catch (iceErr) {
                console.warn('Failed to apply queued ICE candidate:', iceErr);
              }
            }
            if (queued.length) pendingIceCandidatesRef.current.delete(from);
          } else if (signalType === 'ice-candidate' && candidate) {
            if (pc.remoteDescription) {
              await pc.addIceCandidate(new RTCIceCandidate(candidate));
            } else {
              const existing = pendingIceCandidatesRef.current.get(from) || [];
              existing.push(candidate);
              pendingIceCandidatesRef.current.set(from, existing);
            }
          }
        } catch (err) {
          console.warn('WebRTC signal handling error:', err);
        }
      })
      .subscribe();

    webrtcChannelRef.current = signalingChannel;

    return () => {
      if (webrtcChannelRef.current) {
        webrtcChannelRef.current.unsubscribe();
        webrtcChannelRef.current = null;
      }
      closeAllPeerConnections();
    };
  }, [supabase, groupId, userId, userEmail, meetingStarted, createPeerConnection, closeAllPeerConnections]);

  // Create offers to peers from presence + known group membership.
  useEffect(() => {
    const createOffersToPeers = async () => {
      if (!meetingStarted || !webrtcChannelRef.current || !userId) return;

      for (const peer of peerTargets) {
        const peerId = peer.id;
        if (!peerId || peerId === userId) continue;

        // Deterministic initiator avoids offer glare.
        if (String(userId) > String(peerId)) continue;

        let pc = peerConnectionsRef.current.get(peerId);
        if (!pc) {
          pc = await createPeerConnection(peerId, peer?.email || '');
        }
        if (!pc) continue;

        if (pc.signalingState !== 'stable') continue;

        // If we already have a working stream for this peer, skip renegotiation.
        if (getRemoteStreamByUserId(peerId)) continue;

        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          await webrtcChannelRef.current.send({
            type: 'broadcast',
            event: 'webrtc-signal',
            payload: {
              signalType: 'offer',
              from: userId,
              fromEmail: userEmail,
              target: peerId,
              offer
            }
          });
        } catch (err) {
          console.warn('Failed to create/send offer:', err);
        }
      }
    };

    createOffersToPeers();

    // Retry offers periodically in case one side subscribed late.
    const retry = setInterval(createOffersToPeers, 5000);
    return () => clearInterval(retry);
  }, [peerTargets, meetingStarted, userId, userEmail, createPeerConnection, getRemoteStreamByUserId]);

  const formatTime = (seconds) => {
    const h = Math.floor(seconds / 3600).toString().padStart(2, '0');
    const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${h}:${m}:${s}`;
  };

  const memberTileVariant = (seed = '') => {
    const variants = [
      'from-indigo-600 to-blue-700 border-indigo-300/30',
      'from-fuchsia-600 to-violet-700 border-fuchsia-300/30',
      'from-emerald-600 to-teal-700 border-emerald-300/30',
      'from-amber-600 to-orange-700 border-amber-300/30',
      'from-rose-600 to-pink-700 border-rose-300/30'
    ];
    let hash = 0;
    for (let i = 0; i < seed.length; i += 1) {
      hash = (hash << 5) - hash + seed.charCodeAt(i);
      hash |= 0;
    }
    return variants[Math.abs(hash) % variants.length];
  };

  const toggleVideo = () => {
    setIsVideoOn(!isVideoOn);
  };

  const startMeeting = async () => {
    // Don't start meeting yet — ring the members first
    setIsCalling(true);
    setIsVideoOn(true);
    setCallingTimer(0);
    
    // Start a ring timer so user can see how long they've been calling
    callingTimerRef.current = setInterval(() => setCallingTimer(t => t + 1), 1000);
    
    console.log('📞 Host initiating call, ringing members...');
    
    // Broadcast call started to all members (any member can initiate)
    if (callChannelRef.current) {
      try {
        console.log('📡 Attempting to broadcast call-started event...');
        const broadcastResult = await callChannelRef.current.send({
          type: 'broadcast',
          event: 'call-started',
          payload: {
            hostId: userId,
            hostEmail: userEmail,
            groupId: groupId,
            timestamp: new Date().toISOString()
          }
        });
        console.log('✅ Call broadcast sent to all members, result:', broadcastResult);
      } catch (err) {
        console.error('❌ Error broadcasting call:', err);
      }
    } else {
      console.warn('⚠️ Cannot broadcast - callChannelRef not ready', { hasChannel: !!callChannelRef.current });
    }
    
    // Play outgoing call ringtone
    if (audioServiceRef.current) {
      console.log('🔊 Playing outgoing ringtone...');
      audioServiceRef.current.playRingtone('outgoingCall', 30);
    }
    
    // Notify other members of incoming call via chat
    if (supabase && groupId) {
      try {
        await supabase.from('boarding_room_chat').insert({
          group_id: groupId,
          user_id: userId,
          user_email: userEmail,
          message: `📞 ${userEmail || 'Host'} is calling...`,
          is_system: true
        });
      } catch (err) {
        console.warn('Error logging meeting start:', err);
      }
    }
    
    // Auto-cancel after 60 seconds if no one answers
    setTimeout(() => {
      setIsCalling(prev => {
        if (prev) {
          console.log('⏱ Call timed out — no one answered');
          cancelCall();
        }
        return false;
      });
    }, 60000);
  };

  const cancelCall = async () => {
    console.log('❌ Host cancelled the call');
    setIsCalling(false);
    setCallingTimer(0);
    if (callingTimerRef.current) { clearInterval(callingTimerRef.current); callingTimerRef.current = null; }
    
    // Stop ringtone
    if (audioServiceRef.current) {
      audioServiceRef.current.stopAllSounds();
    }
    
    // Broadcast call ended
    if (callChannelRef.current) {
      try {
        await callChannelRef.current.send({
          type: 'broadcast',
          event: 'call-ended',
          payload: {
            hostId: userId,
            groupId: groupId,
            timestamp: new Date().toISOString()
          }
        });
      } catch (err) {
        console.warn('Error broadcasting call-ended:', err);
      }
    }

    // Persist call-end marker so members who missed broadcast don't stay on waiting screen.
    if (supabase && groupId && isHost) {
      try {
        await supabase.from('boarding_room_chat').insert({
          group_id: groupId,
          user_id: userId,
          user_email: userEmail,
          message: '📵 Call ended',
          is_system: true
        });
      } catch (err) {
        console.warn('Error logging call end:', err);
      }
    }
  };

  const acceptCall = async () => {
    console.log('✅ [ACCEPT CALL] User accepted the call');
    setCallAccepted(true);
    setMeetingStarted(true);
    setIsVideoOn(true);
    setIncomingCall(null);
    
    // Broadcast call-accepted so the HOST knows to start the meeting
    if (callChannelRef.current) {
      try {
        await callChannelRef.current.send({
          type: 'broadcast',
          event: 'call-accepted',
          payload: {
            acceptedBy: userId,
            acceptedEmail: userEmail,
            groupId: groupId,
            timestamp: new Date().toISOString()
          }
        });
        console.log('✅ Call-accepted broadcast sent to host');
      } catch (err) {
        console.warn('Error broadcasting call-accepted:', err);
      }
    }
    
    // Log call acceptance
    if (supabase) {
      try {
        await supabase.from('boarding_room_chat').insert({
          group_id: groupId,
          user_id: userId,
          user_email: userEmail,
          message: `✅ ${userEmail || 'Member'} joined the call`,
          is_system: true
        });
      } catch (err) {
        console.warn('Error logging call acceptance:', err);
      }
    }
  };

  const rejectCall = () => {
    console.log('❌ [REJECT CALL] User declined the call');
    setIncomingCall(null);
  };

  const endMeeting = async () => {
    closeAllPeerConnections();
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }
    
    console.log('🔴 Ending meeting, broadcasting call-ended...');
    
    // Broadcast call ended to all members
    if (callChannelRef.current) {
      try {
        await callChannelRef.current.send({
          type: 'broadcast',
          event: 'call-ended',
          payload: {
            hostId: userId,
            groupId: groupId,
            timestamp: new Date().toISOString()
          }
        });
        console.log('✅ Call-ended broadcast sent');
      } catch (err) {
        console.warn('Error broadcasting call-ended:', err);
      }
    }
    
    // Play call ended sound
    if (audioServiceRef.current) {
      audioServiceRef.current.playSound('callEnded');
    }
    
    setMeetingStarted(false);
    setIsVideoOn(false);
    setMeetingTime(0);
    setConnectedMembers([]);
    setRemoteStreams([]);
    setIncomingCall(null);
    setCallAccepted(false);
    setIsCalling(false);
    if (callingTimerRef.current) {
      clearInterval(callingTimerRef.current);
      callingTimerRef.current = null;
    }

    // Log meeting end
    if (supabase) {
      try {
        await supabase.from('boarding_room_chat').insert({
          group_id: groupId,
          user_id: userId,
          user_email: userEmail,
          message: `${userEmail || 'Member'} left the meeting`,
          is_system: true
        });
        if (isHost) {
          await supabase.from('boarding_room_chat').insert({
            group_id: groupId,
            user_id: userId,
            user_email: userEmail,
            message: '📵 Call ended',
            is_system: true
          });
        }
      } catch (err) {
        console.warn('Error logging meeting end:', err);
      }
    }

    // Close boardroom for the host as well after ending.
    onClose();
  };

  useEffect(() => {
    return () => {
      closeAllPeerConnections();
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => track.stop());
        localStreamRef.current = null;
      }
    };
  }, [closeAllPeerConnections]);

  const sendMessage = async () => {
    if (!newMessage.trim() || !supabase) return;

    try {
      const { error } = await supabase.from('boarding_room_chat').insert({
        group_id: groupId,
        user_id: user?.id,
        user_email: user?.email,
        message: newMessage,
        is_system: false
      });

      if (!error) {
        setNewMessage('');
      }
    } catch (err) {
      console.error('Error sending message:', err);
    }
  };

  // Incoming call screen
  if (incomingCall && !callAccepted) {
    console.log('🔔 [INCOMING CALL] Rendering incoming call screen - incomingCall:', !!incomingCall, 'isHost:', isHost, 'callAccepted:', callAccepted);
    return (
      <div className="w-full h-full bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex flex-col items-center justify-center p-4 sm:p-6 pb-32 sm:pb-8 relative overflow-hidden">
        <div className="absolute inset-0 opacity-30">
          <div className="absolute top-0 -left-40 w-80 h-80 bg-red-500 rounded-full blur-3xl animate-pulse"></div>
          <div className="absolute bottom-0 -right-40 w-80 h-80 bg-orange-500 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }}></div>
        </div>
        
        <div className="relative z-10 text-center max-w-md w-full px-2 sm:px-0">
          {/* Animated incoming call icon */}
          <div className="w-24 h-24 sm:w-32 sm:h-32 bg-gradient-to-br from-red-500 to-orange-600 rounded-full flex items-center justify-center mx-auto mb-6 sm:mb-8 shadow-2xl animate-pulse">
            <Phone className="w-12 h-12 sm:w-16 sm:h-16 text-white animate-bounce" style={{ animationDelay: '0.3s' }} />
          </div>
          
          <h2 className="text-2xl sm:text-4xl font-bold text-white mb-1 sm:mb-2 break-words">{groupName}</h2>
          <p className="text-base sm:text-xl text-transparent bg-clip-text bg-gradient-to-r from-red-400 to-orange-400 mb-2 sm:mb-3 font-semibold">{typeof incomingCall === 'object' ? `${incomingCall.hostEmail || 'Host'} is calling` : 'Incoming Call...'}</p>
          <p className="text-xs sm:text-sm text-gray-400 mb-6 sm:mb-8">Group Call</p>
          
          {/* Ringing indicator */}
          <div className="flex items-center justify-center gap-2 mb-8 sm:mb-12">
            <div className="w-2 h-2 sm:w-2.5 sm:h-2.5 bg-red-500 rounded-full animate-pulse"></div>
            <div className="w-2 h-2 sm:w-2.5 sm:h-2.5 bg-red-500 rounded-full animate-pulse" style={{ animationDelay: '0.2s' }}></div>
            <div className="w-2 h-2 sm:w-2.5 sm:h-2.5 bg-red-500 rounded-full animate-pulse" style={{ animationDelay: '0.4s' }}></div>
          </div>
          
          {/* Buttons */}
          <div className="flex gap-3 sm:gap-4 justify-center flex-col sm:flex-row w-full">
            <button
              onClick={() => acceptCall()}
              className="flex-1 sm:flex-none px-6 sm:px-8 py-3 sm:py-4 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 active:from-green-800 active:to-emerald-800 text-white rounded-xl sm:rounded-2xl font-bold transition-all transform hover:scale-105 active:scale-95 shadow-2xl flex items-center gap-2 sm:gap-3 justify-center text-sm sm:text-base"
            >
              <Phone className="w-4 h-4 sm:w-5 sm:h-5" />
              Accept
            </button>
            <button
              onClick={() => rejectCall()}
              className="flex-1 sm:flex-none px-6 sm:px-8 py-3 sm:py-4 bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-700 hover:to-rose-700 active:from-red-800 active:to-rose-800 text-white rounded-xl sm:rounded-2xl font-bold transition-all transform hover:scale-105 active:scale-95 shadow-2xl flex items-center gap-2 sm:gap-3 justify-center text-sm sm:text-base"
            >
              <X className="w-4 h-4 sm:w-5 sm:h-5" />
              Decline
            </button>
          </div>
        </div>
      </div>
    );
  } else if (incomingCall && (!isHost === false || callAccepted === true)) {
    console.log('🔔 [INCOMING CALL] Not showing screen - isHost:', isHost, 'callAccepted:', callAccepted, 'incomingCall:', !!incomingCall);
  }

  // ── Mode picker ──────────────────────────────────────────────────
  if (!meetingStarted && boardroomMode === null) {
    return (
      <div className="w-full h-full bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex flex-col items-center justify-center p-6 pb-28 sm:pb-6 relative overflow-hidden">
        <div className="absolute inset-0 opacity-20 pointer-events-none">
          <div className="absolute top-0 -left-40 w-80 h-80 bg-blue-500 rounded-full blur-3xl animate-pulse"></div>
          <div className="absolute bottom-0 -right-40 w-80 h-80 bg-purple-500 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }}></div>
        </div>
        <div className="relative z-10 w-full max-w-sm">
          <h2 className="text-2xl sm:text-3xl font-bold text-white text-center mb-1">{groupName}</h2>
          <p className="text-center text-slate-400 text-sm mb-8">What would you like to do?</p>

          <div className="flex flex-col gap-4">
            {/* Message option */}
            <button
              onClick={() => setBoardroomMode('chat')}
              className="flex items-center gap-4 w-full bg-slate-800/70 hover:bg-slate-700/80 border border-slate-600/50 hover:border-purple-500/50 rounded-2xl p-5 transition-all group active:scale-95"
            >
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-purple-600 to-violet-600 flex items-center justify-center flex-shrink-0 shadow-lg shadow-purple-500/30 group-hover:scale-110 transition-transform">
                <MessageCircle className="w-7 h-7 text-white" />
              </div>
              <div className="text-left">
                <p className="text-white font-bold text-base">Send a Message</p>
                <p className="text-slate-400 text-xs mt-0.5">Group chat — read & send messages</p>
              </div>
            </button>

            {/* Live option */}
            <button
              onClick={() => setBoardroomMode('live')}
              className="flex items-center gap-4 w-full bg-slate-800/70 hover:bg-slate-700/80 border border-slate-600/50 hover:border-blue-500/50 rounded-2xl p-5 transition-all group active:scale-95"
            >
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-600 to-cyan-600 flex items-center justify-center flex-shrink-0 shadow-lg shadow-blue-500/30 group-hover:scale-110 transition-transform">
                <Video className="w-7 h-7 text-white" />
              </div>
              <div className="text-left">
                <p className="text-white font-bold text-base">{isHost ? 'Start Live' : 'Join Live'}</p>
                <p className="text-slate-400 text-xs mt-0.5">{isHost ? 'Start a video call for the group' : 'Join a live video meeting'}</p>
              </div>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Standalone group chat mode ────────────────────────────────────
  if (!meetingStarted && boardroomMode === 'chat') {
    return (
      <div className="w-full h-full flex flex-col bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
        {/* Chat header */}
        <div className="flex-shrink-0 flex items-center gap-3 px-4 py-3 border-b border-slate-700/60 bg-slate-900/80">
          <button onClick={() => setBoardroomMode(null)} className="p-1.5 hover:bg-slate-700 rounded-lg transition text-slate-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-purple-600 to-violet-600 flex items-center justify-center flex-shrink-0">
            <MessageCircle className="w-4 h-4 text-white" />
          </div>
          <div>
            <p className="text-white font-bold text-sm leading-tight">{groupName}</p>
            <p className="text-slate-400 text-xs">Group Chat</p>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-2 sm:space-y-3">
          {chatMessages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-500 gap-2">
              <MessageCircle className="w-10 h-10 text-slate-600" />
              <p className="text-sm text-slate-500">No messages yet. Say hi! 👋</p>
            </div>
          ) : (
            chatMessages.map((msg) => (
              <div key={msg.id} className="flex flex-col gap-0.5">
                {msg.isSystem ? (
                  <div className="flex items-center gap-1.5 py-1.5 px-2 bg-slate-800/40 rounded-lg border border-slate-700/30">
                    <div className="w-1 h-1 rounded-full bg-blue-400 flex-shrink-0"></div>
                    <p className="text-xs text-gray-400 italic">{msg.message}</p>
                  </div>
                ) : (
                  <div className={`flex gap-2 ${msg.isThis ? 'flex-row-reverse' : ''}`}>
                    <div className={`h-7 w-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${msg.isThis ? 'bg-blue-600' : 'bg-purple-600'}`}>
                      {msg.sender.charAt(0).toUpperCase()}
                    </div>
                    <div className={`flex flex-col gap-0.5 ${msg.isThis ? 'items-end' : 'items-start'} flex-1 min-w-0`}>
                      <p className="text-xs text-gray-400 px-2">{msg.isThis ? 'You' : msg.sender.split('@')[0]}</p>
                      <div className={`px-3 py-2 rounded-2xl max-w-[78%] text-sm break-words ${
                        msg.isThis
                          ? 'bg-gradient-to-r from-blue-600 to-blue-500 text-white rounded-br-none'
                          : 'bg-slate-800/80 text-gray-100 rounded-bl-none border border-slate-700/50'
                      }`}>
                        {msg.message}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* Input */}
        <div className="flex-shrink-0 px-3 pt-3 pb-[calc(6rem+env(safe-area-inset-bottom))] sm:pb-4 border-t border-slate-700/60 bg-slate-900/80">
          <div className="flex gap-2 items-center">
            <input
              type="text"
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
              placeholder="Message..."
              className="flex-1 bg-slate-800 text-white text-sm px-4 py-2.5 rounded-full border border-slate-600/50 focus:border-purple-500/50 focus:outline-none placeholder-slate-500 min-w-0"
            />
            <button
              onClick={sendMessage}
              disabled={!newMessage.trim()}
              className="w-10 h-10 flex items-center justify-center bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 disabled:from-slate-700 disabled:to-slate-700 text-white rounded-full transition-all active:scale-95 flex-shrink-0"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Calling screen (host ringing members) ──────────────────────────
  if (isCalling && isHost && !meetingStarted) {
    return (
      <div className="w-full h-full bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex flex-col items-center justify-center p-4 sm:p-6 pb-32 sm:pb-8 relative overflow-hidden">
        <div className="absolute inset-0 opacity-30">
          <div className="absolute top-0 -left-40 w-80 h-80 bg-blue-500 rounded-full blur-3xl animate-pulse"></div>
          <div className="absolute bottom-0 -right-40 w-80 h-80 bg-purple-500 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }}></div>
        </div>
        
        <div className="relative z-10 text-center max-w-md w-full px-2 sm:px-0 overflow-y-auto max-h-[calc(100vh-140px)] sm:max-h-none">
          {/* Animated phone icon */}
          <div className="w-24 h-24 sm:w-32 sm:h-32 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center mx-auto mb-6 sm:mb-8 shadow-2xl animate-bounce">
            <Phone className="w-12 h-12 sm:w-16 sm:h-16 text-white" />
          </div>
          
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-1 sm:mb-2 word-break">{groupName}</h2>
          <p className="text-lg sm:text-xl text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-400 mb-6 sm:mb-8">Calling members...</p>
          
          {/* Timer showing how long they've been calling */}
          <div className="text-4xl sm:text-5xl font-mono font-bold text-white mb-6 sm:mb-8 tabular-nums">{formatTime(callingTimer)}</div>
          
          {/* Show group members being called */}
          <div className="mb-8 sm:mb-10">
            <p className="text-xs sm:text-sm text-gray-400 mb-3 sm:mb-4">Ringing {groupMembers?.length || 0} member{groupMembers?.length !== 1 ? 's' : ''}:</p>
            <div className="flex justify-center gap-2 sm:gap-3 flex-wrap max-h-32 sm:max-h-40 overflow-y-auto">
              {groupMembers && groupMembers.length > 0 ? (
                groupMembers.map((m, i) => (
                  <div key={i} className="flex flex-col items-center flex-shrink-0">
                    <div className="w-10 h-10 sm:w-12 sm:h-12 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white font-bold text-sm sm:text-lg mb-1.5 sm:mb-2 animate-pulse shadow-lg ring-2 ring-blue-400/30">
                      {m?.user_email?.charAt(0).toUpperCase()}
                    </div>
                    <p className="text-xs text-gray-400 max-w-[50px] sm:max-w-[60px] truncate">{m?.user_email?.split('@')[0]}</p>
                  </div>
                ))
              ) : (
                <p className="text-xs sm:text-sm text-gray-500 italic">No members to call</p>
              )}
            </div>
          </div>
          
          {/* Status indicator */}
          <div className="flex items-center justify-center gap-2 mb-6 sm:mb-8">
            <div className="w-2 h-2 sm:w-2.5 sm:h-2.5 bg-blue-400 rounded-full animate-pulse"></div>
            <p className="text-xs sm:text-sm text-gray-400">Waiting for response...</p>
          </div>
          
          {/* Cancel button */}
          <button
            onClick={() => cancelCall()}
            className="w-full sm:w-auto px-8 sm:px-12 py-3 sm:py-4 bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800 active:from-red-800 active:to-red-900 text-white rounded-xl sm:rounded-2xl font-bold transition-all transform hover:scale-105 active:scale-95 shadow-2xl flex items-center gap-2 sm:gap-3 mx-auto text-sm sm:text-base"
          >
            <Phone className="w-4 h-4 sm:w-5 sm:h-5" />
            Cancel Call
          </button>
        </div>
      </div>
    );
  }

  // ── Pre-meeting: boardroomMode === 'live' ─────────────────────────
  if (!meetingStarted) {
    return (
      <div className="w-full h-full bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex flex-col items-center justify-center p-4 pb-28 sm:pb-6 sm:p-6 relative overflow-hidden">
        <div className="absolute inset-0 opacity-20">
          <div className="absolute top-0 -left-40 w-80 h-80 bg-blue-500 rounded-full blur-3xl animate-pulse"></div>
          <div className="absolute bottom-0 -right-40 w-80 h-80 bg-purple-500 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }}></div>
        </div>
        <div className="relative z-10 text-center max-w-md w-full px-2">
          <button onClick={() => setBoardroomMode(null)} className="mb-4 text-slate-400 hover:text-white text-xs flex items-center gap-1 mx-auto transition">
            ← Back
          </button>
          <div className="w-16 h-16 sm:w-24 sm:h-24 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center mx-auto mb-6 sm:mb-8 shadow-2xl">
            {isHost ? <Video className="w-8 h-8 sm:w-12 sm:h-12 text-white" /> : <Eye className="w-8 h-8 sm:w-12 sm:h-12 text-white" />}
          </div>
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-2 sm:mb-3">{groupName}</h2>
          <p className="text-lg sm:text-2xl text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-400 mb-4 sm:mb-6">Live Boardroom</p>
          <>
            <p className="text-sm sm:text-base text-gray-300 mb-6 sm:mb-8">Ready to start?</p>
            <div className="flex gap-2 sm:gap-3 justify-center mb-4 sm:mb-6 items-center flex-wrap">
              <div className="flex -space-x-2 sm:-space-x-3">
                {groupMembers?.slice(0, 3).map((m, i) => (
                  <div key={i} title={m?.user_email} className="w-8 h-8 sm:w-10 sm:h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center border-2 border-slate-900 text-xs font-bold hover:scale-110 transition-transform cursor-pointer text-white">
                    {m?.user_email?.charAt(0).toUpperCase()}
                  </div>
                ))}
                {groupMembers?.length > 3 && (
                  <div className="w-8 h-8 sm:w-10 sm:h-10 bg-gradient-to-br from-slate-600 to-slate-700 rounded-full flex items-center justify-center border-2 border-slate-900 text-xs font-bold text-white">
                    +{groupMembers.length - 3}
                  </div>
                )}
              </div>
              <span className="text-sm sm:text-base text-gray-400">{groupMembers?.length || 0} members</span>
            </div>
            <p className="text-xs sm:text-sm text-gray-400 mb-6 sm:mb-8">
              {hasActiveCall ? 'Incoming call detected. You can also start a new call.' : 'Any member can start a new meeting call.'}
            </p>
            <button
              onClick={startMeeting}
              className="px-8 sm:px-12 py-3 sm:py-4 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white rounded-2xl font-bold text-base sm:text-lg transition-all transform hover:scale-105 active:scale-95 shadow-2xl flex items-center gap-2 sm:gap-3 mx-auto w-full sm:w-auto justify-center"
            >
              <Video className="w-5 h-5 sm:w-6 sm:h-6" />
              Start Meeting
            </button>
          </>
        </div>
      </div>
    );
  }

  // Live meeting screen
  return (
    <div ref={containerRef} className="w-full h-full bg-black relative overflow-hidden group sm:pb-0 pb-24">
      <div className="w-full h-full flex flex-col">
        {/* Video Gallery Container */}
        <div className="flex-1 relative bg-black flex flex-col overflow-hidden">
          {/* Main Video Area - Local User or First Participant */}
          <div className="flex-1 relative bg-gradient-to-br from-slate-900 to-black flex items-center justify-center overflow-hidden">
            {isVideoOn ? (
              <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center p-4">
                <div className="text-center">
                  <div className="w-16 h-16 sm:w-32 sm:h-32 bg-gradient-to-br from-slate-700 to-slate-800 rounded-full flex items-center justify-center mx-auto mb-3 sm:mb-6">
                    <VideoOff className="w-8 h-8 sm:w-16 sm:h-16 text-red-500" />
                  </div>
                  <p className="hidden sm:block text-lg sm:text-3xl text-white font-bold mb-2">Camera Disabled</p>
                  <p className="hidden sm:block text-gray-400 text-sm sm:text-lg mb-4 sm:mb-6">Enable camera to be visible</p>
                  <button 
                    onClick={toggleVideo} 
                    className="px-6 sm:px-8 py-2 sm:py-3 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-lg sm:rounded-xl font-bold transition-all flex items-center gap-2 sm:gap-3 mx-auto text-sm sm:text-base"
                  >
                    <Video className="w-4 h-4 sm:w-5 sm:h-5" />
                    <span className="hidden sm:inline">Enable Camera</span>
                  </button>
                </div>
              </div>
            )}
            
            {/* Local User Badge */}
            <div className="absolute bottom-3 left-3 bg-black/70 backdrop-blur-md px-3 py-1.5 rounded-lg flex items-center gap-2 border border-white/20">
              <div className="w-2 h-2 rounded-full bg-green-500"></div>
              <span className="hidden sm:inline text-xs sm:text-sm text-white font-semibold">You</span>
            </div>

            {/* Mobile Status Bar - Top */}
            <div className="absolute top-0 left-0 right-0 bg-gradient-to-b from-black/70 to-transparent p-2 sm:p-3 z-30 sm:hidden flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs text-white">
                <div className={`w-2 h-2 rounded-full ${isOnline ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></div>
                <span>{formatTime(meetingTime)}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Users className="w-4 h-4 text-blue-300" />
                <span className="text-xs text-blue-300 font-semibold">{(connectedMembers.length || 0) + 1}</span>
              </div>
            </div>
          </div>

          {/* Participants Gallery - Compact on mobile to keep video area dominant */}
          {connectedMembers && connectedMembers.length > 0 && (
            <div className="h-16 sm:h-32 bg-black/75 border-t border-slate-700/50 overflow-x-auto flex gap-2 p-2 backdrop-blur-sm">
              {connectedMembers.map((member, idx) => (
                <div
                  key={idx}
                  className={`flex-shrink-0 w-12 h-12 sm:w-28 sm:h-28 bg-gradient-to-br ${memberTileVariant(member?.email || member?.userId || String(idx))} rounded-lg relative flex items-center justify-center overflow-hidden shadow-lg hover:shadow-2xl transition-all border group/member`}
                >
                  {getRemoteStreamByUserId(member?.userId) ? (
                    <video
                      autoPlay
                      playsInline
                      muted={false}
                      ref={(el) => {
                        if (!el) return;
                        const stream = getRemoteStreamByUserId(member?.userId);
                        if (stream && el.srcObject !== stream) {
                          el.srcObject = stream;
                          el.play?.().catch(() => {});
                        }
                      }}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span className="text-white font-bold text-sm sm:text-2xl">{member?.email?.charAt(0).toUpperCase()}</span>
                  )}
                  
                  {/* Member Status Indicators */}
                  <div className="absolute top-1 right-1 flex gap-0.5">
                    {member.videoOn && (
                      <div className="w-1.5 h-1.5 sm:w-2 sm:h-2 bg-green-500 rounded-full shadow-lg"></div>
                    )}
                    {member.micOn && (
                      <div className="w-1.5 h-1.5 sm:w-2 sm:h-2 bg-blue-500 rounded-full shadow-lg"></div>
                    )}
                  </div>

                  {/* Member Name */}
                  <div className="hidden sm:block absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent px-1 py-0.5 sm:px-1.5 sm:py-1 text-center">
                    <p className="text-white text-[10px] sm:text-xs font-semibold truncate">{member?.email?.split('@')[0]}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* TOP CONTROLS - Transparent - Responsive for mobile */}
          <div className="absolute top-0 left-0 right-0 h-16 sm:h-20 bg-gradient-to-b from-black/60 via-black/30 to-transparent flex items-center justify-between px-3 sm:px-6 transition-opacity duration-300 opacity-0 group-hover:opacity-100">
            <div className="flex items-center gap-2 sm:gap-4">
              <div className="flex items-center gap-1 sm:gap-2 px-2 sm:px-4 py-1 sm:py-2 bg-black/40 backdrop-blur-md rounded-full">
                <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></div>
                <span className="text-white font-semibold text-xs sm:text-sm truncate max-w-xs">{groupName}</span>
              </div>
              <div className="px-2 sm:px-4 py-1 sm:py-2 bg-black/40 backdrop-blur-md rounded-full hidden sm:block">
                <span className="text-white font-mono text-xs sm:text-sm">{formatTime(meetingTime)}</span>
              </div>
            </div>
            <div className="flex items-center gap-1 sm:gap-2 px-2 sm:px-4 py-1 sm:py-2 bg-black/40 backdrop-blur-md rounded-full">
              <div className={`w-2 h-2 rounded-full animate-pulse ${isOnline ? 'bg-green-500' : 'bg-red-500'}`}></div>
              <Users className="w-3 h-3 sm:w-4 sm:h-4 text-white" />
              <span className="text-white text-xs sm:text-sm font-medium">{connectedMembers.length || 1}</span>
            </div>
          </div>

          {/* BOTTOM CONTROLS - Floating Bar with Transparent Glassmorphism Icons - Hidden on mobile */}
          <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-black/80 via-black/40 to-transparent flex items-end justify-center pb-6 transition-opacity duration-300 opacity-0 group-hover:opacity-100 hidden sm:flex">
            <div className="flex gap-4 items-center">
              {/* Microphone Button - Glassmorphism */}
              <div onMouseEnter={() => setHoveredControl('mic')} onMouseLeave={() => setHoveredControl(null)} className="relative">
                <button onClick={() => setIsMicOn(!isMicOn)} className={`w-14 h-14 rounded-2xl flex items-center justify-center font-bold transition-all backdrop-blur-xl border border-white/20 ${isMicOn ? 'bg-gradient-to-br from-green-400/40 to-emerald-600/40 hover:from-green-400/50 hover:to-emerald-600/50 text-green-100 shadow-lg shadow-green-500/30' : 'bg-gradient-to-br from-red-400/40 to-red-600/40 hover:from-red-400/50 hover:to-red-600/50 text-red-100 shadow-lg shadow-red-500/30'}`} title={isMicOn ? 'Mute' : 'Unmute'}>
                  {isMicOn ? <Mic className="w-6 h-6" /> : <MicOff className="w-6 h-6" />}
                </button>
                {hoveredControl === 'mic' && <div className="absolute bottom-full mb-3 bg-black/80 backdrop-blur-xl border border-white/20 text-white text-xs px-3 py-2 rounded-lg whitespace-nowrap">{isMicOn ? 'Mute Microphone' : 'Unmute Microphone'}</div>}
              </div>

              {/* Camera Button - Glassmorphism */}
              <div onMouseEnter={() => setHoveredControl('video')} onMouseLeave={() => setHoveredControl(null)} className="relative">
                <button onClick={toggleVideo} className={`w-14 h-14 rounded-2xl flex items-center justify-center font-bold transition-all backdrop-blur-xl border border-white/20 ${isVideoOn ? 'bg-gradient-to-br from-blue-400/40 to-cyan-600/40 hover:from-blue-400/50 hover:to-cyan-600/50 text-blue-100 shadow-lg shadow-blue-500/30' : 'bg-gradient-to-br from-slate-400/40 to-slate-600/40 hover:from-slate-400/50 hover:to-slate-600/50 text-slate-100 shadow-lg shadow-slate-500/30'}`} title={isVideoOn ? 'Turn off Camera' : 'Turn on Camera'}>
                  {isVideoOn ? <Video className="w-6 h-6" /> : <VideoOff className="w-6 h-6" />}
                </button>
                {hoveredControl === 'video' && <div className="absolute bottom-full mb-3 bg-black/80 backdrop-blur-xl border border-white/20 text-white text-xs px-3 py-2 rounded-lg whitespace-nowrap">{isVideoOn ? 'Turn off Camera' : 'Turn on Camera'}</div>}
              </div>

              {/* Screen Share Button - Glassmorphism */}
              <div onMouseEnter={() => setHoveredControl('share')} onMouseLeave={() => setHoveredControl(null)} className="relative">
                <button onClick={() => setIsScreenSharing(!isScreenSharing)} className={`w-14 h-14 rounded-2xl flex items-center justify-center font-bold transition-all backdrop-blur-xl border border-white/20 ${isScreenSharing ? 'bg-gradient-to-br from-emerald-400/40 to-teal-600/40 hover:from-emerald-400/50 hover:to-teal-600/50 text-emerald-100 shadow-lg shadow-emerald-500/30' : 'bg-gradient-to-br from-slate-400/40 to-slate-600/40 hover:from-slate-400/50 hover:to-slate-600/50 text-slate-100 shadow-lg shadow-slate-500/30'}`} title={isScreenSharing ? 'Stop Sharing' : 'Share Screen'}>
                  <Share2 className="w-6 h-6" />
                </button>
                {hoveredControl === 'share' && <div className="absolute bottom-full mb-3 bg-black/80 backdrop-blur-xl border border-white/20 text-white text-xs px-3 py-2 rounded-lg whitespace-nowrap">{isScreenSharing ? 'Stop Sharing' : 'Share Screen'}</div>}
              </div>

              {/* Sound Toggle Button - Glassmorphism */}
              <div onMouseEnter={() => setHoveredControl('sound')} onMouseLeave={() => setHoveredControl(null)} className="relative">
                <button onClick={() => setSoundEnabled(!soundEnabled)} className={`w-14 h-14 rounded-2xl flex items-center justify-center font-bold transition-all backdrop-blur-xl border border-white/20 ${soundEnabled ? 'bg-gradient-to-br from-amber-400/40 to-yellow-600/40 hover:from-amber-400/50 hover:to-yellow-600/50 text-amber-100 shadow-lg shadow-amber-500/30' : 'bg-gradient-to-br from-slate-400/40 to-slate-600/40 hover:from-slate-400/50 hover:to-slate-600/50 text-slate-100 shadow-lg shadow-slate-500/30'}`} title={soundEnabled ? 'Mute Notifications' : 'Unmute Notifications'}>
                  {soundEnabled ? <Volume2 className="w-6 h-6" /> : <VolumeX className="w-6 h-6" />}
                </button>
                {hoveredControl === 'sound' && <div className="absolute bottom-full mb-3 bg-black/80 backdrop-blur-xl border border-white/20 text-white text-xs px-3 py-2 rounded-lg whitespace-nowrap">{soundEnabled ? 'Mute Notifications' : 'Unmute Notifications'}</div>}
              </div>

              {/* Chat Button - Glassmorphism */}
              <div onMouseEnter={() => setHoveredControl('chat')} onMouseLeave={() => setHoveredControl(null)} className="relative">
                <button onClick={() => setShowChat(!showChat)} className={`w-14 h-14 rounded-2xl flex items-center justify-center font-bold transition-all backdrop-blur-xl border border-white/20 ${showChat ? 'bg-gradient-to-br from-purple-400/40 to-violet-600/40 hover:from-purple-400/50 hover:to-violet-600/50 text-purple-100 shadow-lg shadow-purple-500/30' : 'bg-gradient-to-br from-slate-400/40 to-slate-600/40 hover:from-slate-400/50 hover:to-slate-600/50 text-slate-100 shadow-lg shadow-slate-500/30'}`} title={showChat ? 'Hide Chat' : 'Show Chat'}>
                  {showChat ? <MessageCircle className="w-6 h-6" /> : <MessageCircle className="w-6 h-6" />}
                </button>
                {hoveredControl === 'chat' && <div className="absolute bottom-full mb-3 bg-black/80 backdrop-blur-xl border border-white/20 text-white text-xs px-3 py-2 rounded-lg whitespace-nowrap">{showChat ? 'Hide Chat' : 'Show Chat'}</div>}
              </div>

              {/* End Call Button - Glassmorphism */}
              <button onClick={endMeeting} className="w-14 h-14 rounded-2xl flex items-center justify-center font-bold transition-all bg-gradient-to-br from-red-600/50 to-red-800/50 hover:from-red-600/60 hover:to-red-800/60 text-red-100 shadow-lg shadow-red-500/30 backdrop-blur-xl border border-white/20" title="End Meeting">
                <Phone className="w-6 h-6" />
              </button>
            </div>
          </div>

          {/* Mobile Controls - collapsed to a single 3-dot trigger */}
          <div className="absolute bottom-4 right-4 sm:hidden z-40 flex flex-col items-end gap-2">
            {showMobileMenu && (
              <div className="grid grid-cols-3 gap-2 bg-black/20 backdrop-blur-md p-2 rounded-2xl border border-white/10 shadow-xl">
                <button
                  onClick={() => setIsMicOn(!isMicOn)}
                  className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${isMicOn ? 'bg-emerald-500/25 text-emerald-100 border border-emerald-300/20' : 'bg-rose-500/25 text-rose-100 border border-rose-300/20'}`}
                  title={isMicOn ? 'Mute Microphone' : 'Unmute Microphone'}
                >
                  {isMicOn ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
                </button>
                <button
                  onClick={toggleVideo}
                  className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${isVideoOn ? 'bg-blue-500/25 text-blue-100 border border-blue-300/20' : 'bg-slate-500/25 text-slate-100 border border-slate-300/20'}`}
                  title={isVideoOn ? 'Turn off Camera' : 'Turn on Camera'}
                >
                  {isVideoOn ? <Video className="w-4 h-4" /> : <VideoOff className="w-4 h-4" />}
                </button>
                <button
                  onClick={() => setShowChat(!showChat)}
                  className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all relative ${showChat ? 'bg-purple-500/25 text-purple-100 border border-purple-300/20' : 'bg-slate-500/25 text-slate-100 border border-slate-300/20'}`}
                  title={showChat ? 'Hide Chat' : 'Show Chat'}
                >
                  <MessageCircle className="w-4 h-4" />
                  {chatMessages.length > 0 && !showChat && (
                    <span className="absolute -top-2 -right-2 bg-red-500/80 text-white text-[10px] rounded-full w-4.5 h-4.5 flex items-center justify-center font-bold border border-red-300/30">{Math.min(chatMessages.length, 9)}</span>
                  )}
                </button>
                <button
                  onClick={() => setSoundEnabled(!soundEnabled)}
                  className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${soundEnabled ? 'bg-amber-500/25 text-amber-100 border border-amber-300/20' : 'bg-slate-500/25 text-slate-100 border border-slate-300/20'}`}
                  title={soundEnabled ? 'Mute Notifications' : 'Unmute Notifications'}
                >
                  {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
                </button>
                <button
                  onClick={() => setIsScreenSharing(!isScreenSharing)}
                  className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${isScreenSharing ? 'bg-teal-500/25 text-teal-100 border border-teal-300/20' : 'bg-slate-500/25 text-slate-100 border border-slate-300/20'}`}
                  title={isScreenSharing ? 'Stop Sharing' : 'Share Screen'}
                >
                  <Share2 className="w-4 h-4" />
                </button>
                <button
                  onClick={endMeeting}
                  className="w-10 h-10 rounded-xl flex items-center justify-center transition-all bg-red-500/30 text-red-100 border border-red-300/25"
                  title="End Meeting"
                >
                  <Phone className="w-4 h-4" />
                </button>
              </div>
            )}

            <button
              onClick={() => setShowMobileMenu((prev) => !prev)}
              className="w-11 h-11 rounded-xl flex items-center justify-center transition-all bg-black/25 backdrop-blur-md text-slate-100 border border-white/10"
              title={showMobileMenu ? 'Hide controls' : 'Show controls'}
            >
              <MoreVertical className="w-5 h-5" />
            </button>
          </div>

          {/* Participants Sidebar - Right - Shows connected members with status */}
          <div className="absolute right-0 top-0 bottom-0 w-20 bg-gradient-to-l from-black/40 to-transparent flex flex-col py-6 gap-3 px-2 overflow-y-auto transition-opacity duration-300 opacity-0 group-hover:opacity-100">
            {connectedMembers && connectedMembers.length > 0 ? (
              connectedMembers.map((member, idx) => (
                <div key={idx} className="w-full aspect-square bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl flex items-center justify-center shadow-lg hover:shadow-2xl transition-all cursor-pointer transform hover:scale-110 relative group/member">
                  {getRemoteStreamByUserId(member?.userId) ? (
                    <video
                      autoPlay
                      playsInline
                      muted
                      ref={(el) => {
                        if (!el) return;
                        const stream = getRemoteStreamByUserId(member?.userId);
                        if (stream && el.srcObject !== stream) {
                          el.srcObject = stream;
                        }
                      }}
                      className="w-full h-full object-cover rounded-xl"
                    />
                  ) : (
                    <span className="text-white font-bold text-lg">{member?.email?.charAt(0).toUpperCase()}</span>
                  )}
                  
                  {/* Status indicators */}
                  <div className="absolute bottom-1 right-1 flex gap-0.5">
                    {member.videoOn && (
                      <div className="w-2 h-2 bg-blue-300 rounded-full" title="Video on"></div>
                    )}
                    {member.micOn && (
                      <div className="w-2 h-2 bg-green-300 rounded-full" title="Mic on"></div>
                    )}
                  </div>

                  <div className="absolute inset-0 rounded-xl opacity-0 group-hover/member:opacity-100 transition-opacity">
                    <div className="w-full h-full bg-black/60 backdrop-blur-sm rounded-xl flex flex-col items-center justify-center p-1">
                      <span className="text-white text-xs text-center font-semibold break-words">{member?.email?.split('@')[0]}</span>
                      <div className="text-xs text-gray-300 mt-1">
                        {member.videoOn ? '📹' : '🔴'} {member.micOn ? '🎤' : '🔇'}
                      </div>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="w-full h-20 flex items-center justify-center">
                <div className="text-center">
                  <Users className="w-6 h-6 text-gray-500 mx-auto mb-1" />
                  <p className="text-xs text-gray-500">No members</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Chat Sidebar - Responsive drawer for mobile */}
      {showChat && (
        <>
          {/* Mobile overlay */}
          <div className="absolute right-0 top-0 bottom-0 w-full sm:w-96 z-40 sm:z-0 sm:pb-0 pb-20">
            {/* Backdrop overlay for mobile */}
            <div 
              onClick={() => setShowChat(false)}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm sm:hidden"
            />
            
            {/* Chat sidebar - slides in from right */}
            <div className="absolute right-0 top-0 sm:bottom-0 bottom-20 w-4/5 sm:w-full bg-black/95 backdrop-blur-lg border-l border-purple-500/20 flex flex-col shadow-2xl z-50 animate-in slide-in-from-right">
              {/* Chat Header */}
              <div className="flex-shrink-0 p-3 sm:p-4 border-b border-purple-500/20 flex items-center justify-between bg-gradient-to-r from-slate-900 via-purple-900/20 to-black backdrop-blur-md">
                <div className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0">
                  <div className="p-1.5 sm:p-2 bg-purple-500/20 rounded-lg flex-shrink-0">
                    <MessageCircle className="w-4 h-4 sm:w-5 sm:h-5 text-purple-400" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-white font-bold text-xs sm:text-sm truncate">Chat</h3>
                    <p className="text-xs text-gray-400">{chatMessages.length} msgs</p>
                  </div>
                </div>
                <button 
                  onClick={() => setShowChat(false)} 
                  className="p-1.5 hover:bg-slate-800/50 rounded-lg transition-colors flex-shrink-0"
                  title="Close chat"
                >
                  <X className="w-4 h-4 sm:w-5 sm:h-5 text-gray-400 hover:text-gray-300" />
                </button>
              </div>

              {/* Messages Container - Improved scrolling for mobile */}
              <div className="flex-1 overflow-y-auto p-2 sm:p-4 space-y-2 sm:space-y-3 bg-gradient-to-b from-black/50 to-black/30 scrollbar-hide">
                {chatMessages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-gray-500">
                    <MessageCircle className="w-6 h-6 sm:w-12 sm:h-12 text-gray-600 mb-1 sm:mb-2 opacity-50" />
                    <p className="text-xs sm:text-sm text-center">No messages<br/>yet</p>
                  </div>
                ) : (
                  chatMessages.map((msg) => (
                    <div key={msg.id} className="flex flex-col gap-0.5">
                      {msg.isSystem ? (
                        <div className="flex items-center gap-1.5 py-1.5 px-2 sm:px-3 bg-gradient-to-r from-slate-800/40 to-transparent rounded-lg border border-slate-700/30 backdrop-blur-sm">
                          <div className="w-1 h-1 rounded-full bg-blue-400 flex-shrink-0"></div>
                          <p className="text-xs text-gray-400 italic flex-1 break-words">{msg.message}</p>
                        </div>
                      ) : (
                        <div className={`flex gap-1.5 sm:gap-2 ${msg.isThis ? 'flex-row-reverse' : ''}`}>
                          <div className={`h-5 w-5 sm:h-7 sm:w-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${msg.isThis ? 'bg-blue-600' : 'bg-purple-600'}`}>
                            {msg.sender.charAt(0).toUpperCase()}
                          </div>
                          <div className={`flex flex-col gap-0.5 ${msg.isThis ? 'items-end' : 'items-start'} flex-1 min-w-0`}>
                            <p className="text-xs text-gray-400 px-1.5 sm:px-2">{msg.sender.split('@')[0]}</p>
                            <div className={`px-2 sm:px-3 py-1 sm:py-2 rounded-2xl max-w-xs text-xs sm:text-sm break-words backdrop-blur-sm ${
                              msg.isThis 
                                ? 'bg-gradient-to-r from-blue-600 to-blue-500 text-white rounded-br-none shadow-lg shadow-blue-500/20' 
                                : 'bg-slate-800/80 text-gray-100 rounded-bl-none border border-slate-700/50'
                            }`}>
                              {msg.message}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>

              {/* Message Input - Improved for mobile */}
              <div className="flex-shrink-0 p-2 sm:p-4 border-t border-purple-500/20 bg-gradient-to-r from-black via-slate-900/20 to-black backdrop-blur-md">
                <div className="flex gap-1.5 sm:gap-2">
                  <input 
                    type="text" 
                    value={newMessage} 
                    onChange={(e) => setNewMessage(e.target.value)} 
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        sendMessage();
                      }
                    }}
                    placeholder="Message..." 
                    className="flex-1 bg-slate-800/60 hover:bg-slate-800/80 focus:bg-slate-800 text-white text-xs sm:text-sm px-2.5 sm:px-4 py-1.5 sm:py-2.5 rounded-full border border-slate-700/50 focus:border-purple-500/50 focus:outline-none focus:ring-2 focus:ring-purple-500/20 transition-all placeholder-gray-500 backdrop-blur-sm" 
                  />
                  <button 
                    onClick={sendMessage} 
                    disabled={!newMessage.trim()}
                    className="p-1.5 sm:p-2.5 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 disabled:from-slate-700 disabled:to-slate-700 text-white rounded-full transition-all transform active:scale-95 disabled:scale-100 shadow-lg shadow-purple-500/20 disabled:shadow-none flex-shrink-0"
                    title="Send message"
                  >
                    <Send className="w-4 h-4 sm:w-4 sm:h-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default LiveBoardroom;
