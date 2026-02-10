/**
 * LiveBoardroom - Modern full-screen video meeting with transparent controls
 * Inspired by professional pitching platforms - full screen, creative UI
 */

import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { getSupabase } from '../services/pitchingService';
import {
  X, Video, Mic, MicOff, VideoOff, Phone, Users, Share2, Send,
  MessageCircle, Eye
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
  const videoRef = useRef(null);
  const meetingTimerRef = useRef(null);
  const containerRef = useRef(null);

  useEffect(() => {
    if (user && creatorId === user?.id) setIsHost(true);
    else if (!creatorId && (!members || members.length === 0)) setIsHost(true);
  }, [members, user, creatorId]);

  useEffect(() => {
    if (meetingStarted) {
      meetingTimerRef.current = setInterval(() => setMeetingTime(t => t + 1), 1000);
    }
    return () => { if (meetingTimerRef.current) clearInterval(meetingTimerRef.current); };
  }, [meetingStarted]);

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

  const startMeeting = () => {
    setMeetingStarted(true);
    setIsVideoOn(true);
    setChatMessages([{ id: Date.now(), sender: 'System', message: `${user?.email || 'Host'} started the meeting`, timestamp: new Date(), isSystem: true }]);
  };

  const endMeeting = () => {
    if (videoRef.current?.srcObject) {
      videoRef.current.srcObject.getTracks().forEach((track) => track.stop());
    }
    setMeetingStarted(false);
    setIsVideoOn(false);
    setMeetingTime(0);
  };

  const sendMessage = () => {
    if (newMessage.trim()) {
      setChatMessages([...chatMessages, { id: Date.now(), sender: user?.email?.split('@')[0] || 'You', message: newMessage, timestamp: new Date(), isThis: true }]);
      setNewMessage('');
    }
  };

  // Pre-meeting screen
  if (!meetingStarted) {
    return (
      <div className="w-full h-full bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex flex-col items-center justify-center p-4 pb-28 sm:pb-4 relative overflow-hidden">
        <div className="absolute inset-0 opacity-20">
          <div className="absolute top-0 -left-40 w-80 h-80 bg-blue-500 rounded-full blur-3xl animate-pulse"></div>
          <div className="absolute bottom-0 -right-40 w-80 h-80 bg-purple-500 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }}></div>
        </div>
        <div className="relative z-10 text-center max-w-md">
          <div className="w-24 h-24 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center mx-auto mb-8 shadow-2xl">
            {isHost ? <Video className="w-12 h-12 text-white" /> : <Eye className="w-12 h-12 text-white" />}
          </div>
          <h2 className="text-4xl font-bold text-white mb-3">{groupName}</h2>
          <p className="text-2xl text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-400 mb-6">Live Boardroom</p>
          {isHost ? (
            <>
              <p className="text-gray-300 mb-8">Ready to start?</p>
              <div className="flex gap-3 justify-center mb-6">
                <div className="flex -space-x-3">
                  {members?.slice(0, 3).map((m, i) => (
                    <div key={i} className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center border-2 border-slate-900 text-xs text-white font-bold">
                      {m?.user_email?.charAt(0).toUpperCase()}
                    </div>
                  ))}
                </div>
                <span className="text-gray-400">{members?.length || 0} members</span>
              </div>
              <button onClick={startMeeting} className="px-12 py-4 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white rounded-2xl font-bold text-lg transition-all transform hover:scale-105 shadow-2xl flex items-center gap-3 mx-auto">
                <Video className="w-6 h-6" />
                Start Meeting
              </button>
            </>
          ) : (
            <>
              <p className="text-gray-400 mb-8">Waiting for host...</p>
              <div className="flex gap-2 justify-center">
                <div className="w-3 h-3 bg-blue-400 rounded-full animate-pulse"></div>
                <div className="w-3 h-3 bg-blue-400 rounded-full animate-pulse" style={{ animationDelay: '0.3s' }}></div>
                <div className="w-3 h-3 bg-blue-400 rounded-full animate-pulse" style={{ animationDelay: '0.6s' }}></div>
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
        {/* Video Container - FULL SCREEN */}
        <div className="flex-1 relative bg-black flex items-center justify-center overflow-hidden">
          {isVideoOn ? (
            <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-slate-900 to-black flex items-center justify-center p-4">
              <div className="text-center">
                <div className="w-20 h-20 sm:w-32 sm:h-32 bg-gradient-to-br from-slate-700 to-slate-800 rounded-full flex items-center justify-center mx-auto mb-4 sm:mb-6">
                  <VideoOff className="w-10 h-10 sm:w-16 sm:h-16 text-red-500" />
                </div>
                <p className="text-lg sm:text-3xl text-white font-bold mb-2">Camera Disabled</p>
                <p className="text-gray-400 text-sm sm:text-lg mb-4 sm:mb-6">Enable camera to be visible</p>
                <button onClick={toggleVideo} className="px-4 sm:px-8 py-2 sm:py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg sm:rounded-xl font-bold transition-all flex items-center gap-2 sm:gap-3 mx-auto text-sm sm:text-base">
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
              <Users className="w-3 h-3 sm:w-4 sm:h-4 text-white" />
              <span className="text-white text-xs sm:text-sm font-medium">{members?.length || 1}</span>
            </div>
          </div>

          {/* BOTTOM CONTROLS - Floating Bar with Transparent Icons - Hidden on mobile */}
          <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-black/80 via-black/40 to-transparent flex items-end justify-center pb-6 transition-opacity duration-300 opacity-0 group-hover:opacity-100 hidden sm:flex">
            <div className="flex gap-4 items-center">
              {/* Microphone Button */}
              <div onMouseEnter={() => setHoveredControl('mic')} onMouseLeave={() => setHoveredControl(null)} className="relative">
                <button onClick={() => setIsMicOn(!isMicOn)} className={`w-14 h-14 rounded-full flex items-center justify-center font-bold transition-all transform hover:scale-110 backdrop-blur-md ${isMicOn ? 'bg-green-500/60 hover:bg-green-600 text-white shadow-lg shadow-green-500/50' : 'bg-red-500/60 hover:bg-red-600 text-white shadow-lg shadow-red-500/50'}`} title={isMicOn ? 'Mute' : 'Unmute'}>
                  {isMicOn ? <Mic className="w-6 h-6" /> : <MicOff className="w-6 h-6" />}
                </button>
                {hoveredControl === 'mic' && <div className="absolute bottom-full mb-3 bg-black/80 backdrop-blur-md text-white text-xs px-3 py-2 rounded-lg whitespace-nowrap">{isMicOn ? 'Mute Microphone' : 'Unmute Microphone'}</div>}
              </div>

              {/* Camera Button */}
              <div onMouseEnter={() => setHoveredControl('video')} onMouseLeave={() => setHoveredControl(null)} className="relative">
                <button onClick={toggleVideo} className={`w-14 h-14 rounded-full flex items-center justify-center font-bold transition-all transform hover:scale-110 backdrop-blur-md ${isVideoOn ? 'bg-blue-500/60 hover:bg-blue-600 text-white shadow-lg shadow-blue-500/50' : 'bg-slate-600/60 hover:bg-slate-700 text-white shadow-lg shadow-slate-500/50'}`} title={isVideoOn ? 'Turn off Camera' : 'Turn on Camera'}>
                  {isVideoOn ? <Video className="w-6 h-6" /> : <VideoOff className="w-6 h-6" />}
                </button>
                {hoveredControl === 'video' && <div className="absolute bottom-full mb-3 bg-black/80 backdrop-blur-md text-white text-xs px-3 py-2 rounded-lg whitespace-nowrap">{isVideoOn ? 'Turn off Camera' : 'Turn on Camera'}</div>}
              </div>

              {/* Screen Share Button */}
              <div onMouseEnter={() => setHoveredControl('share')} onMouseLeave={() => setHoveredControl(null)} className="relative">
                <button onClick={() => setIsScreenSharing(!isScreenSharing)} className={`w-14 h-14 rounded-full flex items-center justify-center font-bold transition-all transform hover:scale-110 backdrop-blur-md ${isScreenSharing ? 'bg-emerald-500/60 hover:bg-emerald-600 text-white shadow-lg shadow-emerald-500/50' : 'bg-slate-600/60 hover:bg-slate-700 text-white shadow-lg shadow-slate-500/50'}`} title={isScreenSharing ? 'Stop Sharing' : 'Share Screen'}>
                  <Share2 className="w-6 h-6" />
                </button>
                {hoveredControl === 'share' && <div className="absolute bottom-full mb-3 bg-black/80 backdrop-blur-md text-white text-xs px-3 py-2 rounded-lg whitespace-nowrap">{isScreenSharing ? 'Stop Sharing' : 'Share Screen'}</div>}
              </div>

              {/* Chat Button */}
              <div onMouseEnter={() => setHoveredControl('chat')} onMouseLeave={() => setHoveredControl(null)} className="relative">
                <button onClick={() => setShowChat(!showChat)} className={`w-14 h-14 rounded-full flex items-center justify-center font-bold transition-all transform hover:scale-110 backdrop-blur-md ${showChat ? 'bg-purple-500/60 hover:bg-purple-600 text-white shadow-lg shadow-purple-500/50' : 'bg-slate-600/60 hover:bg-slate-700 text-white shadow-lg shadow-slate-500/50'}`} title={showChat ? 'Hide Chat' : 'Show Chat'}>
                  {showChat ? <MessageCircle className="w-6 h-6" /> : <MessageCircle className="w-6 h-6" />}
                </button>
                {hoveredControl === 'chat' && <div className="absolute bottom-full mb-3 bg-black/80 backdrop-blur-md text-white text-xs px-3 py-2 rounded-lg whitespace-nowrap">{showChat ? 'Hide Chat' : 'Show Chat'}</div>}
              </div>

              {/* End Call Button */}
              <button onClick={endMeeting} className="w-14 h-14 rounded-full flex items-center justify-center font-bold transition-all transform hover:scale-110 bg-red-600/60 hover:bg-red-700 text-white shadow-lg shadow-red-500/50 backdrop-blur-md" title="End Meeting">
                <Phone className="w-6 h-6" />
              </button>
            </div>
          </div>

          {/* Mobile Controls - Floating bar at bottom right */}
          <div className="absolute bottom-28 right-4 sm:hidden flex flex-col gap-2">
            <div className="flex flex-col gap-2 bg-black/40 backdrop-blur-md p-2 rounded-full">
              <button onClick={() => setIsMicOn(!isMicOn)} className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${isMicOn ? 'bg-green-500/60 text-white' : 'bg-red-500/60 text-white'}`} title={isMicOn ? 'Mute' : 'Unmute'}>
                {isMicOn ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
              </button>
              <button onClick={toggleVideo} className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${isVideoOn ? 'bg-blue-500/60 text-white' : 'bg-slate-600/60 text-white'}`} title={isVideoOn ? 'Camera off' : 'Camera on'}>
                {isVideoOn ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
              </button>
              <button onClick={() => setShowChat(!showChat)} className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${showChat ? 'bg-purple-500/60 text-white' : 'bg-slate-600/60 text-white'}`} title={showChat ? 'Hide chat' : 'Show chat'}>
                <MessageCircle className="w-5 h-5" />
              </button>
              <button onClick={endMeeting} className="w-10 h-10 rounded-full flex items-center justify-center transition-all bg-red-600/60 text-white" title="End call">
                <Phone className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Participants Sidebar - Right */}
          <div className="absolute right-0 top-0 bottom-0 w-20 bg-gradient-to-l from-black/40 to-transparent flex flex-col py-6 gap-3 px-2 overflow-y-auto transition-opacity duration-300 opacity-0 group-hover:opacity-100">
            {members?.slice(0, 5).map((member, idx) => (
              <div key={idx} className="w-full aspect-square bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl flex items-center justify-center shadow-lg hover:shadow-2xl transition-all cursor-pointer transform hover:scale-110 relative group/member">
                <span className="text-white font-bold text-lg">{member?.user_email?.charAt(0).toUpperCase()}</span>
                <div className="absolute inset-0 rounded-xl opacity-0 group-hover/member:opacity-100 transition-opacity">
                  <div className="w-full h-full bg-black/60 backdrop-blur-sm rounded-xl flex items-center justify-center">
                    <span className="text-white text-xs text-center px-2 font-semibold">{member?.user_email?.split('@')[0]}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Chat Sidebar - Enhanced UI - Responsive for mobile */}
      {showChat && (
        <div className="absolute right-0 top-0 bottom-0 w-full sm:w-96 bg-black/95 backdrop-blur-lg border-l border-purple-500/20 flex flex-col shadow-2xl z-50">
          {/* Chat Header */}
          <div className="flex-shrink-0 p-4 border-b border-purple-500/20 flex items-center justify-between bg-gradient-to-r from-slate-900 via-purple-900/20 to-black backdrop-blur-md">
            <div className="flex items-center gap-3 flex-1">
              <div className="p-2 bg-purple-500/20 rounded-lg">
                <MessageCircle className="w-5 h-5 text-purple-400" />
              </div>
              <div className="min-w-0">
                <h3 className="text-white font-bold text-sm">Meeting Chat</h3>
                <p className="text-xs text-gray-400">{chatMessages.length} messages</p>
              </div>
            </div>
            <button onClick={() => setShowChat(false)} className="p-2 hover:bg-slate-800/50 rounded-lg transition-colors flex-shrink-0">
              <X className="w-5 h-5 text-gray-400 hover:text-gray-300" />
            </button>
          </div>

          {/* Messages Container */}
          <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-3 bg-gradient-to-b from-black/50 to-black/30">
            {chatMessages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-gray-500">
                <MessageCircle className="w-8 h-8 sm:w-12 sm:h-12 text-gray-600 mb-2 opacity-50" />
                <p className="text-xs sm:text-sm text-center">No messages yet<br/>Start the conversation!</p>
              </div>
            ) : (
              chatMessages.map((msg) => (
                <div key={msg.id} className="flex flex-col gap-1">
                  {msg.isSystem ? (
                    <div className="flex items-center gap-2 py-2 px-2 sm:px-3 bg-gradient-to-r from-slate-800/40 to-transparent rounded-lg border border-slate-700/30 backdrop-blur-sm">
                      <div className="w-1.5 h-1.5 rounded-full bg-blue-400 flex-shrink-0"></div>
                      <p className="text-xs text-gray-400 italic flex-1 break-words">{msg.message}</p>
                    </div>
                  ) : (
                    <div className={`flex gap-2 ${msg.isThis ? 'flex-row-reverse' : ''}`}>
                      <div className={`h-6 w-6 sm:h-7 sm:w-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${msg.isThis ? 'bg-blue-600' : 'bg-purple-600'}`}>
                        {msg.sender.charAt(0).toUpperCase()}
                      </div>
                      <div className={`flex flex-col gap-0.5 ${msg.isThis ? 'items-end' : 'items-start'} flex-1`}>
                        <p className="text-xs text-gray-400 px-2">{msg.sender.split('@')[0]}</p>
                        <div className={`px-2 sm:px-3 py-1.5 sm:py-2 rounded-2xl max-w-sm sm:max-w-xs text-xs sm:text-sm break-words backdrop-blur-sm ${
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

          {/* Message Input */}
          <div className="flex-shrink-0 p-3 sm:p-4 border-t border-purple-500/20 bg-gradient-to-r from-black via-slate-900/20 to-black backdrop-blur-md">
            <div className="flex gap-2">
              <input 
                type="text" 
                value={newMessage} 
                onChange={(e) => setNewMessage(e.target.value)} 
                onKeyPress={(e) => e.key === 'Enter' && sendMessage()} 
                placeholder="Type a message..." 
                className="flex-1 bg-slate-800/60 hover:bg-slate-800/80 focus:bg-slate-800 text-white text-xs sm:text-sm px-3 sm:px-4 py-2 sm:py-2.5 rounded-full border border-slate-700/50 focus:border-purple-500/50 focus:outline-none focus:ring-2 focus:ring-purple-500/20 transition-all placeholder-gray-500 backdrop-blur-sm" 
              />
              <button 
                onClick={sendMessage} 
                disabled={!newMessage.trim()}
                className="p-2 sm:p-2.5 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 disabled:from-slate-700 disabled:to-slate-700 text-white rounded-full transition-all transform hover:scale-105 disabled:scale-100 shadow-lg shadow-purple-500/20 disabled:shadow-none flex-shrink-0"
              >
                <Send className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LiveBoardroom;
