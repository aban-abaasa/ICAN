/**
 * LiveBoardroom - Group video meetings with Pitchin integration
 * Works like Zoom but integrated with group management
 * Members can present pitches, share ideas, and collaborate in real-time
 */

import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { getSupabase } from '../services/pitchingService';
import {
  X,
  Video,
  Mic,
  MicOff,
  VideoOff,
  Phone,
  Users,
  Share2,
  Settings,
  MoreVertical,
  Send,
  Clock,
  AlertCircle,
  Play,
  Upload,
  Dot,
  ChevronDown,
  Bell,
  Check
} from 'lucide-react';

const LiveBoardroom = ({ groupId, groupName, members = [], creatorId = null }) => {
  const { user } = useAuth();
  const [isVideoOn, setIsVideoOn] = useState(false);
  const [isMicOn, setIsMicOn] = useState(true);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [showParticipants, setShowParticipants] = useState(true);
  const [showControls, setShowControls] = useState(false);
  const [showChat, setShowChat] = useState(true);
  const [meetingStarted, setMeetingStarted] = useState(false);
  const [isHost, setIsHost] = useState(false);
  const [hasJoined, setHasJoined] = useState(false);
  const [pendingInvite, setPendingInvite] = useState(null);
  const [joinRequests, setJoinRequests] = useState([]);
  const [activePresenter, setActivePresenter] = useState(null);
  const [meetingTime, setMeetingTime] = useState(0);
  const [chatMessages, setChatMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const videoRef = useRef(null);
  const meetingTimerRef = useRef(null);

  // Determine if current user is the group creator/host
  useEffect(() => {
    if (user) {
      let isUserCreator = false;
      
      // First, check if creatorId prop is provided
      if (creatorId) {
        isUserCreator = user?.id === creatorId;
      }
      
      // If not, check members array
      if (!isUserCreator && members && members.length > 0) {
        const firstMember = members[0];
        isUserCreator = 
          user?.id === firstMember?.user_id || 
          user?.id === firstMember?.id ||
          user?.email === firstMember?.user_email || 
          user?.email === firstMember?.email;
      }
      
      // If no creatorId and empty members, assume current user is host
      if (!isUserCreator && (!members || members.length === 0)) {
        isUserCreator = true;
      }
      
      // Set as host if user is the creator
      setIsHost(isUserCreator);
    }
  }, [members, user, creatorId]);

  // Initialize meeting timer
  useEffect(() => {
    if (meetingStarted) {
      meetingTimerRef.current = setInterval(() => {
        setMeetingTime(t => t + 1);
      }, 1000);
    }

    return () => {
      if (meetingTimerRef.current) clearInterval(meetingTimerRef.current);
    };
  }, [meetingStarted]);

  // Initialize video stream when meeting starts
  useEffect(() => {
    if (meetingStarted && isVideoOn && videoRef.current) {
      const timeoutId = setTimeout(() => {
        console.warn('Camera access timeout - stopping video');
        setIsVideoOn(false);
      }, 5000);

      navigator.mediaDevices
        .getUserMedia({ 
          video: { width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: isMicOn 
        })
        .then((stream) => {
          clearTimeout(timeoutId);
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
          }
        })
        .catch((error) => {
          clearTimeout(timeoutId);
          console.error('Error accessing camera:', error.message);
          
          // Handle specific errors
          if (error.name === 'NotAllowedError') {
            console.error('Camera permission denied. Please allow camera access in browser settings.');
          } else if (error.name === 'NotFoundError') {
            console.error('No camera device found.');
          } else if (error.name === 'AbortError') {
            console.error('Camera request was aborted. Try closing other apps using the camera.');
          }
          
          setIsVideoOn(false);
        });
    }

    return () => {
      if (videoRef.current?.srcObject) {
        try {
          videoRef.current.srcObject.getTracks().forEach((track) => track.stop());
        } catch (e) {
          console.error('Error stopping video tracks:', e);
        }
      }
    };
  }, [meetingStarted, isVideoOn, isMicOn]);

  // Format meeting time
  const formatMeetingTime = (seconds) => {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Start meeting
  const startMeeting = async () => {
    setIsHost(true);
    setMeetingStarted(true);
    setIsVideoOn(true);
    setChatMessages([
      {
        id: Date.now(),
        sender: 'System',
        senderName: 'System',
        message: `${user?.email || 'User'} started the meeting`,
        timestamp: new Date(),
        isSystem: true
      }
    ]);

    // Save meeting state to database
    if (groupId && user?.id) {
      try {
        const sb = getSupabase();
        if (sb) {
          // Store meeting state
          const { data: meetingData } = await sb
            .from('live_meetings')
            .upsert({
              group_id: groupId,
              is_active: true,
              started_at: new Date().toISOString(),
              started_by: user?.id
            }, { onConflict: 'group_id' })
            .select()
            .single();

          // Create invites for all group members (excluding the host)
          if (meetingData && members && members.length > 0) {
            const invites = members
              .filter(m => m.user_id !== user?.id && m.user_email !== user?.email)
              .map(m => ({
                meeting_id: meetingData.id,
                group_id: groupId,
                invited_user_id: m.user_id,
                invited_by: user?.id,
                status: 'pending'
              }));

            if (invites.length > 0) {
              await sb.from('meeting_invites').insert(invites);
            }
          }
        }
      } catch (error) {
        console.error('Error saving meeting state:', error);
      }
    }
  };

  // Load meeting state and subscribe to changes
  useEffect(() => {
    if (!groupId) return;

    const loadMeetingState = async () => {
      try {
        const sb = getSupabase();
        if (sb) {
          // Check if meeting is already active
          const { data, error } = await sb
            .from('live_meetings')
            .select('*')
            .eq('group_id', groupId)
            .eq('is_active', true)
            .single();

          if (data && !error) {
            setMeetingStarted(true);
          }

          // Subscribe to real-time changes
          const channel = sb
            .channel(`meeting:${groupId}`)
            .on(
              'postgres_changes',
              {
                event: '*',
                schema: 'public',
                table: 'live_meetings',
                filter: `group_id=eq.${groupId}`
              },
              (payload) => {
                if (payload.new?.is_active) {
                  setMeetingStarted(true);
                } else {
                  setMeetingStarted(false);
                }
              }
            )
            .subscribe();

          return () => {
            channel.unsubscribe();
          };
        }
      } catch (error) {
        console.error('Error loading meeting state:', error);
      }
    };

    loadMeetingState();
  }, [groupId]);

  // Request to join meeting
  const requestJoin = () => {
    if (!user) return;
    const request = {
      id: Date.now(),
      userId: user.id,
      userEmail: user.email,
      userName: user.user_metadata?.full_name || user.email?.split('@')[0],
      timestamp: new Date(),
      status: 'pending'
    };
    setJoinRequests([...joinRequests, request]);
    setChatMessages([
      ...chatMessages,
      {
        id: Date.now(),
        sender: 'System',
        senderName: 'System',
        message: `${request.userName} requested to join the meeting`,
        timestamp: new Date(),
        isSystem: true,
        type: 'join-request'
      }
    ]);
  };

  // Approve join request
  const approveJoin = (requestId) => {
    const request = joinRequests.find(r => r.id === requestId);
    if (request) {
      setJoinRequests(joinRequests.map(r => 
        r.id === requestId ? { ...r, status: 'approved' } : r
      ));
      setHasJoined(request.userId === user?.id);
      setChatMessages([
        ...chatMessages,
        {
          id: Date.now(),
          sender: 'System',
          senderName: 'System',
          message: `${request.userName} joined the meeting`,
          timestamp: new Date(),
          isSystem: true
        }
      ]);
    }
  };

  // Reject join request
  const rejectJoin = (requestId) => {
    const request = joinRequests.find(r => r.id === requestId);
    if (request) {
      setJoinRequests(joinRequests.filter(r => r.id !== requestId));
      setChatMessages([
        ...chatMessages,
        {
          id: Date.now(),
          sender: 'System',
          senderName: 'System',
          message: `${request.userName}'s join request was declined`,
          timestamp: new Date(),
          isSystem: true
        }
      ]);
    }
  };

  // Accept meeting invite
  const acceptInvite = async () => {
    if (!pendingInvite || !user?.id) return;

    try {
      const sb = getSupabase();
      if (sb) {
        // Update invite status
        await sb
          .from('meeting_invites')
          .update({ status: 'accepted', responded_at: new Date().toISOString() })
          .eq('id', pendingInvite.id);

        // User joins the meeting
        setHasJoined(true);
        setPendingInvite(null);
        setChatMessages([
          ...chatMessages,
          {
            id: Date.now(),
            sender: 'System',
            senderName: 'System',
            message: `${user?.email || 'A user'} joined the meeting`,
            timestamp: new Date(),
            isSystem: true
          }
        ]);
      }
    } catch (error) {
      console.error('Error accepting invite:', error);
    }
  };

  // Decline meeting invite
  const declineInvite = async () => {
    if (!pendingInvite || !user?.id) return;

    try {
      const sb = getSupabase();
      if (sb) {
        // Update invite status
        await sb
          .from('meeting_invites')
          .update({ status: 'declined', responded_at: new Date().toISOString() })
          .eq('id', pendingInvite.id);

        setPendingInvite(null);
      }
    } catch (error) {
      console.error('Error declining invite:', error);
    }
  };

  // Load pending invite when meeting starts
  useEffect(() => {
    if (meetingStarted && !isHost && !hasJoined && user?.id && groupId) {
      const loadInvite = async () => {
        try {
          const sb = getSupabase();
          if (sb) {
            const { data } = await sb
              .from('meeting_invites')
              .select('*')
              .eq('group_id', groupId)
              .eq('invited_user_id', user.id)
              .eq('status', 'pending')
              .single();

            if (data) {
              setPendingInvite(data);
            }
          }
        } catch (error) {
          console.error('Error loading invite:', error);
        }
      };

      loadInvite();
    }
  }, [meetingStarted, isHost, hasJoined, user?.id, groupId]);

  // End meeting
  const endMeeting = () => {
    if (videoRef.current?.srcObject) {
      videoRef.current.srcObject.getTracks().forEach((track) => track.stop());
    }
    setMeetingStarted(false);
    setIsVideoOn(false);
    setMeetingTime(0);
  };

  // Send chat message
  const handleSendMessage = () => {
    if (newMessage.trim()) {
      setChatMessages([
        ...chatMessages,
        {
          id: Date.now(),
          sender: user?.email || 'Anonymous',
          senderName: user?.user_metadata?.full_name || 'User',
          message: newMessage,
          timestamp: new Date()
        }
      ]);
      setNewMessage('');
    }
  };

  // Toggle video
  const toggleVideo = async () => {
    if (isVideoOn) {
      // Turn off video
      if (videoRef.current?.srcObject) {
        videoRef.current.srcObject.getTracks().forEach((track) => track.stop());
      }
      setIsVideoOn(false);
    } else {
      // Turn on video
      setIsVideoOn(true);
      // The useEffect will handle starting the camera
    }
  };

  // Toggle mic
  const toggleMic = () => {
    setIsMicOn(!isMicOn);
  };

  // Share screen
  const toggleScreenShare = async () => {
    if (!isScreenSharing) {
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: { cursor: 'always' },
          audio: false
        });
        setIsScreenSharing(true);
        setChatMessages([
          ...chatMessages,
          {
            id: Date.now(),
            sender: 'System',
            senderName: 'System',
            message: `${user?.email || 'A user'} started screen sharing`,
            timestamp: new Date(),
            isSystem: true
          }
        ]);
      } catch (error) {
        console.error('Screen share error:', error);
      }
    } else {
      setIsScreenSharing(false);
      setChatMessages([
        ...chatMessages,
        {
          id: Date.now(),
          sender: 'System',
          senderName: 'System',
          message: `${user?.email || 'A user'} stopped screen sharing`,
          timestamp: new Date(),
          isSystem: true
        }
      ]);
    }
  };

  return (
    <div className="w-full h-full flex flex-col bg-slate-900">
      {/* Header */}
      <div className="flex-shrink-0 flex items-center justify-between p-4 border-b border-slate-700 bg-slate-800/50">
        <div className="flex items-center gap-3">
          <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse"></div>
          <div>
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <Video className="w-5 h-5 text-red-400" />
              {groupName} - Live Meeting
            </h3>
            <p className="text-xs text-gray-400">
              {members?.length || 0} members • {formatMeetingTime(meetingTime)}
            </p>
          </div>
        </div>
        <button
          onClick={() => setShowSettings(!showSettings)}
          className="p-2 hover:bg-slate-700 rounded-lg transition-colors"
        >
          <MoreVertical className="w-5 h-5 text-gray-400" />
        </button>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex gap-4 p-4 overflow-hidden">
        {/* Main Video Area */}
        <div className="flex-1 flex flex-col gap-4">
          {!meetingStarted ? (
            // Pre-Meeting Screen
            <div className="flex-1 bg-gradient-to-br from-slate-800 to-slate-900 rounded-lg overflow-hidden border border-slate-700 flex items-center justify-center relative">
              {/* Animated background */}
              <div className="absolute inset-0 opacity-30">
                <div className="absolute top-10 left-10 w-32 h-32 bg-blue-500 rounded-full blur-3xl opacity-20 animate-pulse"></div>
                <div className="absolute bottom-10 right-10 w-40 h-40 bg-purple-500 rounded-full blur-3xl opacity-20 animate-pulse"></div>
              </div>

              <div className="text-center z-10">
                {!isHost ? (
                  /* Member pre-meeting waiting screen */
                  <>
                    <div className="w-20 h-20 bg-gradient-to-br from-slate-600 to-slate-700 rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg animate-pulse">
                      <Clock className="w-10 h-10 text-white" />
                    </div>
                    <h2 className="text-3xl font-bold text-white mb-2">{groupName}</h2>
                    <p className="text-gray-300 text-lg mb-2">Live Boardroom</p>
                    <p className="text-gray-400 mb-8">
                      Waiting for {members?.[0]?.user_email?.split('@')[0] || 'host'} to start the meeting...
                    </p>
                    <div className="flex items-center justify-center gap-2">
                      <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse"></div>
                      <span className="text-gray-400 text-sm">Ready to join</span>
                      <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse" style={{ animationDelay: '0.5s' }}></div>
                    </div>
                  </>
                ) : (
                  /* Host pre-meeting screen */
                  <>
                    <div className="w-20 h-20 bg-gradient-to-br from-blue-500 to-blue-600 rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg">
                      <Play className="w-10 h-10 text-white" />
                    </div>
                    <h2 className="text-3xl font-bold text-white mb-2">{groupName}</h2>
                    <p className="text-gray-300 text-lg mb-4">Live Boardroom</p>
                    <p className="text-gray-400 mb-6">Ready to start the meeting?</p>
                    <div className="flex items-center justify-center gap-3 mb-8">
                      <div className="flex -space-x-2">
                        {members?.slice(0, 3).map((member, idx) => (
                          <div
                            key={idx}
                            className="w-10 h-10 bg-slate-600 rounded-full flex items-center justify-center border-2 border-slate-800 text-xs text-white font-semibold"
                          >
                            {member?.user_email?.charAt(0).toUpperCase()}
                          </div>
                        ))}
                      </div>
                      <p className="text-gray-400 text-sm">
                        {members?.length || 0} members ready
                      </p>
                    </div>
                    <button
                      onClick={startMeeting}
                      className="px-8 py-3 bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-700 hover:to-blue-600 text-white rounded-lg font-bold transition-all flex items-center justify-center gap-3 mx-auto shadow-lg hover:shadow-xl"
                    >
                      <Play className="w-5 h-5" />
                      Start Meeting
                    </button>
                  </>
                )}
              </div>
            </div>
          ) : pendingInvite && !hasJoined ? (
            // Meeting Invite Screen
            <div className="flex-1 bg-gradient-to-br from-slate-800 to-slate-900 rounded-lg overflow-hidden border border-slate-700 flex items-center justify-center relative">
              {/* Animated background */}
              <div className="absolute inset-0 opacity-30">
                <div className="absolute top-10 left-10 w-32 h-32 bg-emerald-500 rounded-full blur-3xl opacity-20 animate-pulse"></div>
                <div className="absolute bottom-10 right-10 w-40 h-40 bg-blue-500 rounded-full blur-3xl opacity-20 animate-pulse"></div>
              </div>

              <div className="text-center z-10 max-w-md">
                <div className="w-20 h-20 bg-gradient-to-br from-emerald-500 to-emerald-600 rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg animate-bounce">
                  <Bell className="w-10 h-10 text-white" />
                </div>
                <h2 className="text-3xl font-bold text-white mb-2">You're Invited!</h2>
                <p className="text-gray-300 text-lg mb-2">{groupName}</p>
                <p className="text-gray-400 mb-8">
                  {members?.[0]?.user_email?.split('@')[0] || 'The host'} has started a live meeting and invited you to join.
                </p>
                
                <div className="flex gap-4 justify-center">
                  <button
                    onClick={declineInvite}
                    className="px-6 py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-bold transition-colors"
                  >
                    Decline
                  </button>
                  <button
                    onClick={acceptInvite}
                    className="px-6 py-3 bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-700 hover:to-emerald-600 text-white rounded-lg font-bold transition-all shadow-lg hover:shadow-xl flex items-center gap-2"
                  >
                    <Check className="w-5 h-5" />
                    Accept & Join
                  </button>
                </div>
              </div>
            </div>
          ) : (
            /* Live Meeting Screen */
            <>
              {/* Main Video Container */}
              <div className="flex-1 bg-black rounded-lg overflow-hidden relative border border-slate-700 flex items-center justify-center">
                {isVideoOn ? (
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full bg-gradient-to-b from-slate-900 to-slate-950 flex items-center justify-center">
                    <div className="text-center">
                      <VideoOff className="w-24 h-24 text-red-500 mx-auto mb-4" />
                      <p className="text-gray-300 text-lg font-semibold">Video is off</p>
                      <p className="text-gray-500 text-sm mt-2">Turn on video to be visible to others</p>
                      <button
                        onClick={toggleVideo}
                        className="mt-4 px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold transition-colors flex items-center gap-2 mx-auto"
                      >
                        <Video className="w-4 h-4" />
                        Enable Camera
                      </button>
                    </div>
                  </div>
                )}

                {/* User Info Overlay */}
                <div className="absolute bottom-4 left-4 bg-black/70 px-3 py-2 rounded">
                  <p className="text-white text-sm font-semibold">{user?.email || 'You'}</p>
                  <p className="text-gray-300 text-xs">Host</p>
                </div>

                {/* Screen Share Indicator */}
                {isScreenSharing && (
                  <div className="absolute top-4 right-4 bg-emerald-500 text-white px-3 py-1 rounded-full flex items-center gap-2 text-sm font-semibold">
                    <Share2 className="w-4 h-4" />
                    Screen Sharing
                  </div>
                )}

                {/* Floating Control Dots */}
                <div className="absolute bottom-4 right-4 flex flex-col gap-2">
                  <button
                    onClick={() => setShowControls(!showControls)}
                    className="w-12 h-12 bg-blue-600 hover:bg-blue-700 text-white rounded-full flex items-center justify-center shadow-lg transition-all"
                    title="Toggle Controls"
                  >
                    <ChevronDown className={`w-5 h-5 transition-transform ${showControls ? 'rotate-180' : ''}`} />
                  </button>

                  {showControls && (
                    <div className="flex flex-col gap-2 bg-slate-800/90 p-3 rounded-lg border border-slate-700">
                      <button
                        onClick={toggleVideo}
                        className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${
                          isVideoOn
                            ? 'bg-slate-700 hover:bg-slate-600 text-white'
                            : 'bg-red-600/50 hover:bg-red-600 text-red-200'
                        }`}
                        title={isVideoOn ? 'Turn off video' : 'Turn on video'}
                      >
                        {isVideoOn ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
                      </button>

                      <button
                        onClick={toggleMic}
                        className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${
                          isMicOn
                            ? 'bg-slate-700 hover:bg-slate-600 text-white'
                            : 'bg-red-600/50 hover:bg-red-600 text-red-200'
                        }`}
                        title={isMicOn ? 'Mute microphone' : 'Unmute microphone'}
                      >
                        {isMicOn ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
                      </button>

                      <button
                        onClick={toggleScreenShare}
                        className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${
                          isScreenSharing
                            ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                            : 'bg-slate-700 hover:bg-slate-600 text-white'
                        }`}
                        title={isScreenSharing ? 'Stop sharing' : 'Share screen'}
                      >
                        <Share2 className="w-5 h-5" />
                      </button>

                      <button
                        className="w-10 h-10 bg-slate-700 hover:bg-slate-600 text-white rounded-full flex items-center justify-center transition-all"
                        title="Share a pitch"
                      >
                        <Upload className="w-5 h-5" />
                      </button>

                      <button
                        onClick={endMeeting}
                        className="w-10 h-10 bg-red-600 hover:bg-red-700 text-white rounded-full flex items-center justify-center transition-all"
                        title="End meeting"
                      >
                        <Phone className="w-5 h-5" />
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Participants Grid */}
              {showParticipants && members && members.length > 0 && (
                <>
                  <div className="flex items-center gap-2 mb-2">
                    <button
                      onClick={() => setShowParticipants(!showParticipants)}
                      className="px-3 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded text-sm font-semibold flex items-center gap-2 transition-colors"
                    >
                      <Users className="w-4 h-4" />
                      {members.length} Members
                      <ChevronDown className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 max-h-[200px] overflow-y-auto">
                    {members.map((member, idx) => (
                      <div
                        key={idx}
                        className="bg-slate-800 rounded-lg overflow-hidden border border-slate-700 hover:border-slate-600 transition-colors cursor-pointer h-20 flex items-center justify-center relative group"
                      >
                        <div className="w-full h-full bg-gradient-to-b from-slate-800 to-slate-900 flex items-center justify-center">
                          <div className="text-center">
                            <Users className="w-6 h-6 text-gray-600 mx-auto mb-1" />
                            <p className="text-gray-300 text-xs truncate px-2">
                              {member?.user_email?.split('@')[0] || 'Member'}
                            </p>
                          </div>
                        </div>
                        <div className="absolute top-2 right-2 flex gap-1">
                          {member.has_mic && <Mic className="w-3 h-3 text-green-400" />}
                          {!member.has_mic && <MicOff className="w-3 h-3 text-red-400" />}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </div>

        {/* Right Sidebar - Chat (Collapsible) */}
        {meetingStarted && (
          showChat ? (
            <div className="w-72 flex flex-col bg-slate-800/50 border border-slate-700 rounded-lg overflow-hidden">
              {/* Chat Header with Collapse Button */}
              <div className="flex-shrink-0 p-4 border-b border-slate-700 bg-slate-800 flex items-center justify-between">
                <h4 className="text-white font-semibold flex items-center gap-2">
                  <Send className="w-4 h-4" />
                  Meeting Chat
                </h4>
                <button
                  onClick={() => setShowChat(false)}
                  className="p-1 hover:bg-slate-700 rounded transition-colors"
                  title="Collapse chat"
                >
                  <ChevronDown className="w-4 h-4 text-gray-400 rotate-180" />
                </button>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {chatMessages.length === 0 ? (
                  <div className="flex items-center justify-center h-full text-gray-500 text-sm">
                    <p className="text-center">
                      <AlertCircle className="w-4 h-4 mx-auto mb-2" />
                      No messages yet
                    </p>
                  </div>
                ) : (
                  chatMessages.map((msg) => (
                    <div key={msg.id} className={msg.isSystem ? 'text-center' : ''}>
                      {msg.isSystem ? (
                        <p className="text-xs text-gray-500 italic">{msg.message}</p>
                      ) : (
                        <div>
                          <p className="text-xs text-gray-400">
                            <span className="font-semibold text-gray-300">{msg.senderName}</span>
                            {' '}
                            <span className="text-gray-600">
                              {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </p>
                          <p className="text-sm text-gray-200 mt-1">{msg.message}</p>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>

              {/* Message Input */}
              <div className="flex-shrink-0 p-4 border-t border-slate-700 bg-slate-800/50">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
                    placeholder="Type a message..."
                    className="flex-1 bg-slate-700 text-white text-sm px-3 py-2 rounded border border-slate-600 focus:outline-none focus:border-blue-500"
                  />
                  <button
                    onClick={handleSendMessage}
                    className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ) : (
            // Collapsed Chat Button
            <button
              onClick={() => setShowChat(true)}
              className="w-14 h-14 bg-blue-600 hover:bg-blue-700 text-white rounded-full flex items-center justify-center shadow-lg transition-all relative"
              title="Expand chat"
            >
              <Send className="w-6 h-6" />
              {chatMessages.length > 0 && (
                <div className="absolute -top-1 -right-1 w-6 h-6 bg-red-500 text-white text-xs rounded-full flex items-center justify-center font-bold">
                  {chatMessages.length > 9 ? '9+' : chatMessages.length}
                </div>
              )}
            </button>
          )
        )}
      </div>
    </div>
  );
};

export default LiveBoardroom;
