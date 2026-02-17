/**
 * LiveBoardroom - Real-time group video meeting with presence tracking
 * Features: Live member presence, real-time chat sync, member status tracking
 */

import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { getSupabaseClient } from '../lib/supabase/client';
import { getAudioNotificationService } from '../services/audioNotificationService';
import {
  X, Video, Mic, MicOff, VideoOff, Phone, Users, Share2, Send,
  MessageCircle, Eye, Wifi, WifiOff, Circle, Volume2, VolumeX
} from 'lucide-react';

const LiveBoardroom = ({ groupId, groupName, members = [], creatorId = null }) => {
  const { user } = useAuth();
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
  const [groupMembers, setGroupMembers] = useState(members);
  const [isOnline, setIsOnline] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [soundVolume, setSoundVolume] = useState(0.7);
  const [showMobileMenu, setShowMobileMenu] = useState(false);

  const videoRef = useRef(null);
  const meetingTimerRef = useRef(null);
  const containerRef = useRef(null);
  const presenceRef = useRef(null);
  const chatSubscriptionRef = useRef(null);
  const audioServiceRef = useRef(null);
  const previousMembersRef = useRef([]);
  const touchStartX = useRef(0);

  const supabase = getSupabaseClient();

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
    else if (!creatorId && (!members || members.length === 0)) setIsHost(true);
  }, [members, user, creatorId]);

  // Load group members and set up real-time connections
  useEffect(() => {
    const loadGroupMembers = async () => {
      if (!groupId) return;

      try {
        // First, use the members prop if available and has data
        if (members && Array.isArray(members) && members.length > 0) {
          console.log('Using members from props:', members);
          const transformedMembers = members.map(m => ({
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
        
        const { data: usersData, error: usersError } = await supabase
          .from('users')
          .select('id, email')
          .in('id', userIds);

        if (usersError) {
          console.warn('Error fetching users:', usersError);
          return;
        }

        console.log('Fetched users data:', usersData);
        console.log('Users data length:', usersData?.length);
        
        const transformedMembers = (usersData || []).map(u => ({
          id: u.id,
          user_email: u.email || 'Unknown',
          email: u.email,
          status: 'member'
        }));
        
        console.log('Transformed members:', transformedMembers);
        setGroupMembers(transformedMembers);
      } catch (err) {
        console.warn('Error loading group members:', err);
      }
    };

    loadGroupMembers();
  }, [groupId, supabase, members]);

  // Load chat history and set up real-time chat
  useEffect(() => {
    const setupChat = async () => {
      if (!supabase || !groupId || !meetingStarted) return;

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
  }, [groupId, supabase, meetingStarted, user]);

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

  // Camera access
  useEffect(() => {
    if (meetingStarted && isVideoOn && videoRef.current) {
      navigator.mediaDevices
        .getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: isMicOn })
        .then((stream) => { if (videoRef.current) videoRef.current.srcObject = stream; })
        .catch((error) => { console.error('Camera error:', error); setIsVideoOn(false); });
    }
    return () => {
      if (videoRef.current?.srcObject) {
        videoRef.current.srcObject.getTracks().forEach((track) => track.stop());
      }
    };
  }, [meetingStarted, isVideoOn, isMicOn]);

  const formatTime = (seconds) => {
    const h = Math.floor(seconds / 3600).toString().padStart(2, '0');
    const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${h}:${m}:${s}`;
  };

  const toggleVideo = () => {
    if (isVideoOn && videoRef.current?.srcObject) {
      videoRef.current.srcObject.getTracks().forEach((track) => track.stop());
    }
    setIsVideoOn(!isVideoOn);
  };

  const startMeeting = async () => {
    setMeetingStarted(true);
    setIsVideoOn(true);
    
    // Play incoming call sound (meeting started)
    if (audioServiceRef.current && isHost) {
      audioServiceRef.current.playSound('incomingCall');
    }
    
    // Log meeting start to chat
    if (supabase) {
      try {
        await supabase.from('boarding_room_chat').insert({
          group_id: groupId,
          user_id: user?.id,
          user_email: user?.email,
          message: `${user?.email || 'Host'} started the meeting`,
          is_system: true
        });
      } catch (err) {
        console.warn('Error logging meeting start:', err);
      }
    }
  };

  const endMeeting = async () => {
    if (videoRef.current?.srcObject) {
      videoRef.current.srcObject.getTracks().forEach((track) => track.stop());
    }
    
    // Play call ended sound
    if (audioServiceRef.current) {
      audioServiceRef.current.playSound('callEnded');
    }
    
    setMeetingStarted(false);
    setIsVideoOn(false);
    setMeetingTime(0);
    setConnectedMembers([]);

    // Log meeting end
    if (supabase) {
      try {
        await supabase.from('boarding_room_chat').insert({
          group_id: groupId,
          user_id: user?.id,
          user_email: user?.email,
          message: `${user?.email || 'Member'} left the meeting`,
          is_system: true
        });
      } catch (err) {
        console.warn('Error logging meeting end:', err);
      }
    }
  };

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

  // Pre-meeting screen
  if (!meetingStarted) {
    return (
      <div className="w-full h-full bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex flex-col items-center justify-center p-4 sm:p-6 relative overflow-hidden">
        <div className="absolute inset-0 opacity-20">
          <div className="absolute top-0 -left-40 w-80 h-80 bg-blue-500 rounded-full blur-3xl animate-pulse"></div>
          <div className="absolute bottom-0 -right-40 w-80 h-80 bg-purple-500 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }}></div>
        </div>
        <div className="relative z-10 text-center max-w-md w-full px-2">
          <div className="w-16 h-16 sm:w-24 sm:h-24 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center mx-auto mb-6 sm:mb-8 shadow-2xl">
            {isHost ? <Video className="w-8 h-8 sm:w-12 sm:h-12 text-white" /> : <Eye className="w-8 h-8 sm:w-12 sm:h-12 text-white" />}
          </div>
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-2 sm:mb-3">{groupName}</h2>
          <p className="text-lg sm:text-2xl text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-400 mb-4 sm:mb-6">Live Boardroom</p>
          {isHost ? (
            <>
              <p className="text-sm sm:text-base text-gray-300 mb-6 sm:mb-8">Ready to start?</p>
              {/* Show actual group members */}
              <div className="flex gap-2 sm:gap-3 justify-center mb-6 sm:mb-8 items-center flex-wrap">
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
              <button 
                onClick={startMeeting} 
                className="px-8 sm:px-12 py-3 sm:py-4 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white rounded-2xl font-bold text-base sm:text-lg transition-all transform hover:scale-105 active:scale-95 shadow-2xl flex items-center gap-2 sm:gap-3 mx-auto w-full sm:w-auto justify-center"
              >
                <Video className="w-5 h-5 sm:w-6 sm:h-6" />
                Start Meeting
              </button>
            </>
          ) : (
            <>
              <p className="text-sm sm:text-base text-gray-400 mb-6 sm:mb-8">Waiting for host to start the meeting...</p>
              <div className="flex gap-2 justify-center">
                <div className="w-2 h-2 sm:w-3 sm:h-3 bg-blue-400 rounded-full animate-pulse"></div>
                <div className="w-2 h-2 sm:w-3 sm:h-3 bg-blue-400 rounded-full animate-pulse" style={{ animationDelay: '0.3s' }}></div>
                <div className="w-2 h-2 sm:w-3 sm:h-3 bg-blue-400 rounded-full animate-pulse" style={{ animationDelay: '0.6s' }}></div>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  // Live meeting screen
  return (
    <div ref={containerRef} className="w-full h-full bg-black relative overflow-hidden group sm:pb-0 pb-24">
      <div className="w-full h-full flex flex-col">
        {/* Video Container - FULL SCREEN - Improved for mobile */}
        <div className="flex-1 relative bg-black flex items-center justify-center overflow-hidden">
          {/* Mobile Status Bar - Top */}
          <div className="absolute top-0 left-0 right-0 bg-gradient-to-b from-black/70 to-transparent p-2 sm:p-3 z-30 sm:hidden flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs text-white">
              <div className={`w-2 h-2 rounded-full ${isOnline ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></div>
              <span>{formatTime(meetingTime)}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Users className="w-4 h-4 text-blue-300" />
              <span className="text-xs text-blue-300 font-semibold">{connectedMembers.length || 1}</span>
            </div>
          </div>

          {isVideoOn ? (
            <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-slate-900 to-black flex items-center justify-center p-4">
              <div className="text-center">
                <div className="w-16 h-16 sm:w-32 sm:h-32 bg-gradient-to-br from-slate-700 to-slate-800 rounded-full flex items-center justify-center mx-auto mb-3 sm:mb-6">
                  <VideoOff className="w-8 h-8 sm:w-16 sm:h-16 text-red-500" />
                </div>
                <p className="text-lg sm:text-3xl text-white font-bold mb-2">Camera Disabled</p>
                <p className="text-gray-400 text-sm sm:text-lg mb-4 sm:mb-6">Enable camera to be visible</p>
                <button 
                  onClick={toggleVideo} 
                  className="px-6 sm:px-8 py-2 sm:py-3 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-lg sm:rounded-xl font-bold transition-all flex items-center gap-2 sm:gap-3 mx-auto text-sm sm:text-base"
                >
                  <Video className="w-4 h-4 sm:w-5 sm:h-5" />
                  Enable Camera
                </button>
              </div>
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

          {/* Mobile Controls - Transparent Glassmorphism Design */}
          <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 sm:hidden flex flex-row gap-2 bg-black/40 backdrop-blur-xl p-3 rounded-2xl border border-white/20 z-40 shadow-2xl shadow-black/50">
            {/* Mute Microphone - Glassmorphism */}
            <button 
              onClick={() => setIsMicOn(!isMicOn)} 
              className={`w-11 h-11 rounded-xl flex items-center justify-center transition-all ${isMicOn ? 'bg-gradient-to-br from-green-400/50 to-emerald-600/50 text-green-100 shadow-lg shadow-green-500/40 border border-green-300/30' : 'bg-gradient-to-br from-red-400/50 to-red-600/50 text-red-100 shadow-lg shadow-red-500/40 border border-red-300/30'}`} 
              title={isMicOn ? 'Mute Microphone' : 'Unmute Microphone'}
            >
              {isMicOn ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
            </button>
            
            {/* Toggle Camera - Glassmorphism */}
            <button 
              onClick={toggleVideo} 
              className={`w-11 h-11 rounded-xl flex items-center justify-center transition-all ${isVideoOn ? 'bg-gradient-to-br from-blue-400/50 to-cyan-600/50 text-blue-100 shadow-lg shadow-blue-500/40 border border-blue-300/30' : 'bg-gradient-to-br from-slate-400/50 to-slate-600/50 text-slate-100 shadow-lg shadow-slate-500/40 border border-slate-300/30'}`} 
              title={isVideoOn ? 'Turn off Camera' : 'Turn on Camera'}
            >
              {isVideoOn ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
            </button>
            
            {/* Toggle Sound Notifications - Glassmorphism */}
            <button 
              onClick={() => setSoundEnabled(!soundEnabled)} 
              className={`w-11 h-11 rounded-xl flex items-center justify-center transition-all ${soundEnabled ? 'bg-gradient-to-br from-amber-400/50 to-yellow-600/50 text-amber-100 shadow-lg shadow-amber-500/40 border border-amber-300/30' : 'bg-gradient-to-br from-slate-400/50 to-slate-600/50 text-slate-100 shadow-lg shadow-slate-500/40 border border-slate-300/30'}`} 
              title={soundEnabled ? 'Mute Notifications' : 'Unmute Notifications'}
            >
              {soundEnabled ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
            </button>
            
            {/* Toggle Chat - Glassmorphism */}
            <button 
              onClick={() => setShowChat(!showChat)} 
              className={`w-11 h-11 rounded-xl flex items-center justify-center transition-all relative ${showChat ? 'bg-gradient-to-br from-purple-400/50 to-violet-600/50 text-purple-100 shadow-lg shadow-purple-500/40 border border-purple-300/30' : 'bg-gradient-to-br from-slate-400/50 to-slate-600/50 text-slate-100 shadow-lg shadow-slate-500/40 border border-slate-300/30'}`} 
              title={showChat ? 'Hide Chat' : 'Show Chat'}
            >
              <MessageCircle className="w-5 h-5" />
              {chatMessages.length > 0 && !showChat && (
                <span className="absolute -top-2 -right-2 bg-gradient-to-br from-red-400 to-red-600 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-bold shadow-lg shadow-red-500/40 border border-red-300/30">{Math.min(chatMessages.length, 9)}</span>
              )}
            </button>
            
            {/* End Meeting - Glassmorphism */}
            <button 
              onClick={endMeeting} 
              className="w-11 h-11 rounded-xl flex items-center justify-center transition-all bg-gradient-to-br from-red-500/60 to-red-700/60 text-red-100 shadow-lg shadow-red-500/40 border border-red-300/30" 
              title="End Meeting"
            >
              <Phone className="w-5 h-5" />
            </button>
          </div>

          {/* Participants Sidebar - Right - Shows connected members with status */}
          <div className="absolute right-0 top-0 bottom-0 w-20 bg-gradient-to-l from-black/40 to-transparent flex flex-col py-6 gap-3 px-2 overflow-y-auto transition-opacity duration-300 opacity-0 group-hover:opacity-100">
            {connectedMembers && connectedMembers.length > 0 ? (
              connectedMembers.map((member, idx) => (
                <div key={idx} className="w-full aspect-square bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl flex items-center justify-center shadow-lg hover:shadow-2xl transition-all cursor-pointer transform hover:scale-110 relative group/member">
                  <span className="text-white font-bold text-lg">{member?.email?.charAt(0).toUpperCase()}</span>
                  
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
