/**
 * LiveBoardroom - Modern full-screen video meeting with transparent controls
 * Inspired by professional pitching platforms - full screen, creative UI
 */

import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { getSupabase } from '../services/pitchingService';
import {
  X, Video, Mic, MicOff, VideoOff, Phone, Users, Share2, Send,
  MessageCircle, Eye, Check
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
    return \:\:\;
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
    setChatMessages([{ id: Date.now(), sender: 'System', message: \ started the meeting, timestamp: new Date(), isSystem: true }]);
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

  if (!meetingStarted) {
    return (
      <div className="w-full h-full bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex flex-col items-center justify-center p-4 relative overflow-hidden">
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

  return (
    <div ref={containerRef} className="w-full h-full bg-black relative overflow-hidden group">
      <div className="w-full h-full flex flex-col">
        <div className="flex-1 relative bg-black flex items-center justify-center overflow-hidden">
          {isVideoOn ? (
            <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-slate-900 to-black flex items-center justify-center">
              <div className="text-center">
                <div className="w-32 h-32 bg-gradient-to-br from-slate-700 to-slate-800 rounded-full flex items-center justify-center mx-auto mb-6">
                  <VideoOff className="w-16 h-16 text-red-500" />
                </div>
                <p className="text-3xl text-white font-bold mb-2">Camera Disabled</p>
                <p className="text-gray-400 text-lg mb-6">Enable camera to be visible</p>
                <button onClick={toggleVideo} className="px-8 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold transition-all flex items-center gap-3 mx-auto">
                  <Video className="w-5 h-5" />
                  Enable Camera
                </button>
              </div>
            </div>
          )}

          <div className="absolute top-0 left-0 right-0 h-20 bg-gradient-to-b from-black/60 via-black/30 to-transparent flex items-center justify-between px-6 transition-opacity duration-300 opacity-0 group-hover:opacity-100">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 px-4 py-2 bg-black/40 backdrop-blur-md rounded-full">
                <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></div>
                <span className="text-white font-semibold text-sm">{groupName}</span>
              </div>
              <div className="px-4 py-2 bg-black/40 backdrop-blur-md rounded-full">
                <span className="text-white font-mono text-sm">{formatTime(meetingTime)}</span>
              </div>
            </div>
            <div className="flex items-center gap-2 px-4 py-2 bg-black/40 backdrop-blur-md rounded-full">
              <Users className="w-4 h-4 text-white" />
              <span className="text-white text-sm font-medium">{members?.length || 1}</span>
            </div>
          </div>

          <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-black/80 via-black/40 to-transparent flex items-end justify-center pb-6 transition-opacity duration-300 opacity-0 group-hover:opacity-100">
            <div className="flex gap-4 items-center">
              <div onMouseEnter={() => setHoveredControl('mic')} onMouseLeave={() => setHoveredControl(null)} className="relative">
                <button onClick={() => setIsMicOn(!isMicOn)} className={w-14 h-14 rounded-full flex items-center justify-center font-bold transition-all transform hover:scale-110 backdrop-blur-md \} title={isMicOn ? 'Mute' : 'Unmute'}>
                  {isMicOn ? <Mic className="w-6 h-6" /> : <MicOff className="w-6 h-6" />}
                </button>
                {hoveredControl === 'mic' && <div className="absolute bottom-full mb-3 bg-black/80 backdrop-blur-md text-white text-xs px-3 py-2 rounded-lg whitespace-nowrap">{isMicOn ? 'Mute Microphone' : 'Unmute Microphone'}</div>}
              </div>

              <div onMouseEnter={() => setHoveredControl('video')} onMouseLeave={() => setHoveredControl(null)} className="relative">
                <button onClick={toggleVideo} className={w-14 h-14 rounded-full flex items-center justify-center font-bold transition-all transform hover:scale-110 backdrop-blur-md \} title={isVideoOn ? 'Turn off Camera' : 'Turn on Camera'}>
                  {isVideoOn ? <Video className="w-6 h-6" /> : <VideoOff className="w-6 h-6" />}
                </button>
                {hoveredControl === 'video' && <div className="absolute bottom-full mb-3 bg-black/80 backdrop-blur-md text-white text-xs px-3 py-2 rounded-lg whitespace-nowrap">{isVideoOn ? 'Turn off Camera' : 'Turn on Camera'}</div>}
              </div>

              <div onMouseEnter={() => setHoveredControl('share')} onMouseLeave={() => setHoveredControl(null)} className="relative">
                <button onClick={() => setIsScreenSharing(!isScreenSharing)} className={w-14 h-14 rounded-full flex items-center justify-center font-bold transition-all transform hover:scale-110 backdrop-blur-md \} title={isScreenSharing ? 'Stop Sharing' : 'Share Screen'}>
                  <Share2 className="w-6 h-6" />
                </button>
                {hoveredControl === 'share' && <div className="absolute bottom-full mb-3 bg-black/80 backdrop-blur-md text-white text-xs px-3 py-2 rounded-lg whitespace-nowrap">{isScreenSharing ? 'Stop Sharing' : 'Share Screen'}</div>}
              </div>

              <div onMouseEnter={() => setHoveredControl('chat')} onMouseLeave={() => setHoveredControl(null)} className="relative">
                <button onClick={() => setShowChat(!showChat)} className={w-14 h-14 rounded-full flex items-center justify-center font-bold transition-all transform hover:scale-110 backdrop-blur-md \} title={showChat ? 'Hide Chat' : 'Show Chat'}>
                  {showChat ? <MessageCircle className="w-6 h-6" /> : <MessageCircle className="w-6 h-6" />}
                </button>
                {hoveredControl === 'chat' && <div className="absolute bottom-full mb-3 bg-black/80 backdrop-blur-md text-white text-xs px-3 py-2 rounded-lg whitespace-nowrap">{showChat ? 'Hide Chat' : 'Show Chat'}</div>}
              </div>

              <button onClick={endMeeting} className="w-14 h-14 rounded-full flex items-center justify-center font-bold transition-all transform hover:scale-110 bg-red-600/60 hover:bg-red-700 text-white shadow-lg shadow-red-500/50 backdrop-blur-md" title="End Meeting">
                <Phone className="w-6 h-6" />
              </button>
            </div>
          </div>

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

      {showChat && (
        <div className="absolute right-0 top-0 bottom-0 w-96 bg-black/90 backdrop-blur-xl border-l border-slate-700/50 flex flex-col shadow-2xl">
          <div className="flex-shrink-0 p-4 border-b border-slate-700/50 flex items-center justify-between bg-gradient-to-r from-slate-900/80 to-black/80 backdrop-blur-md">
            <div className="flex items-center gap-2">
              <MessageCircle className="w-5 h-5 text-purple-400" />
              <h3 className="text-white font-bold">Chat</h3>
            </div>
            <button onClick={() => setShowChat(false)} className="p-1 hover:bg-slate-800 rounded-lg transition-colors">
              <X className="w-5 h-5 text-gray-400" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {chatMessages.length === 0 ? (
              <div className="flex items-center justify-center h-full text-gray-500 text-sm">
                <p className="text-center">No messages yet...</p>
              </div>
            ) : (
              chatMessages.map((msg) => (
                <div key={msg.id} className={msg.isSystem ? 'text-center' : ''}>
                  {msg.isSystem ? (
                    <p className="text-xs text-gray-600 italic">{msg.message}</p>
                  ) : (
                    <div className={\}>
                      <p className="text-xs text-gray-400 mb-1 font-semibold">{msg.sender}</p>
                      <p className={	ext-sm px-3 py-2 rounded-lg \}>
                        {msg.message}
                      </p>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          <div className="flex-shrink-0 p-4 border-t border-slate-700/50 bg-gradient-to-r from-black to-slate-900/80 backdrop-blur-md">
            <div className="flex gap-2">
              <input type="text" value={newMessage} onChange={(e) => setNewMessage(e.target.value)} onKeyPress={(e) => e.key === 'Enter' && sendMessage()} placeholder="Message..." className="flex-1 bg-slate-800/50 backdrop-blur-sm text-white text-sm px-4 py-2 rounded-lg border border-slate-700/50 focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500/30" />
              <button onClick={sendMessage} className="px-4 py-2 bg-purple-600/80 hover:bg-purple-700 text-white rounded-lg transition-colors font-semibold backdrop-blur-md">
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LiveBoardroom;