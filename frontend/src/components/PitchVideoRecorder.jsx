import React, { useState, useRef, useEffect } from 'react';
import { Camera, Mic, Square, Play, Upload, X, RotateCcw, Pin, Maximize, Minimize, Smartphone, Scissors } from 'lucide-react';
import { uploadVideo } from '../services/pitchingService';
import { VideoClipper } from './status/VideoClipper';

const PitchVideoRecorder = ({ cameraMode = 'front', recordingMethod = 'record', onPitchCreated, onClose, hideControls = false, onVideoRecorded }) => {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const animationFrameRef = useRef(null);
  const streamRef = useRef(null);
  const fullscreenRef = useRef(null);
  
  const [isRecording, setIsRecording] = useState(false);
  const [recordedChunks, setRecordedChunks] = useState([]);
  const [videoBlob, setVideoBlob] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [isFormExpanded, setIsFormExpanded] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [facingMode, setFacingMode] = useState(cameraMode === 'back' ? 'environment' : 'user'); // 'user' for front, 'environment' for back
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [showVideoClipper, setShowVideoClipper] = useState(false);
  
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    creator: '',
    category: 'Technology',
    raised: '$0',
    goal: '$500K',
    equity: '10%',
    pitchType: 'Equity',
    hasIP: false,
    members: []
  });

  // Update facing mode when camera mode prop changes
  useEffect(() => {
    const newFacingMode = cameraMode === 'back' ? 'environment' : 'user';
    if (newFacingMode !== facingMode) {
      setFacingMode(newFacingMode);
      // Stop current stream if recording
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
      setIsRecording(false);
    }
  }, [cameraMode]);

  // Recording timer effect
  useEffect(() => {
    let interval;
    if (isRecording) {
      interval = setInterval(() => {
        setRecordingTime(t => t + 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isRecording]);

  const startRecording = async () => {
    try {
      console.log('Requesting camera permissions...');
      
      // Check for available cameras
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(device => device.kind === 'videoinput');
      setHasMultipleCameras(videoDevices.length > 1);
      
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          facingMode: facingMode
        },
        audio: true
      });

      console.log('Camera stream obtained:', stream);
      console.log('Video tracks:', stream.getVideoTracks());

      streamRef.current = stream;

      // Set up canvas rendering as fallback
      if (canvasRef.current) {
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        console.log('Canvas context obtained:', ctx);
        
        // Set canvas dimensions to match video
        canvas.width = 1280;
        canvas.height = 720;
        console.log('Canvas dimensions set to:', canvas.width, 'x', canvas.height);
        
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          
          // Draw video frames to canvas
          const drawFrame = () => {
            // Clear canvas first
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            
            // Try to draw video frame - drawImage handles not-ready videos gracefully
            try {
              if (videoRef.current) {
                ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
              }
            } catch (e) {
              // Silently handle drawImage errors when video isn't ready
            }
            animationFrameRef.current = requestAnimationFrame(drawFrame);
          };
          
          videoRef.current.onplay = () => {
            console.log('Video element play event fired');
            // Canvas dimensions already set above, just start drawing
            if (videoRef.current) {
              drawFrame();
              setIsRecording(true);
              setRecordingTime(0);
            }
          };

          videoRef.current.onerror = (e) => {
            console.error('Video element error:', e);
          };

          // Try to play
          videoRef.current.play().catch(err => {
            console.error('Play error:', err);
            // Still try to record if play fails
            setIsRecording(true);
          });
        }
      }

      // Use a MIME type with better browser support
      // Try MP4 first, then WebM as fallback
      let mimeType = 'video/webm';
      const supportedTypes = [
        'video/mp4;codecs=h264',
        'video/mp4;codecs=avc1',
        'video/webm;codecs=vp8,opus',
        'video/webm;codecs=vp9,opus',
        'video/webm'
      ];
      
      for (const type of supportedTypes) {
        if (MediaRecorder.isTypeSupported(type)) {
          mimeType = type;
          break;
        }
      }
      
      console.log('🎥 Using MIME type:', mimeType);
      const mediaRecorder = new MediaRecorder(stream, { mimeType });

      const chunks = [];
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunks.push(e.data);
        }
      };
      
      mediaRecorder.onstop = () => {
        console.log('MediaRecorder stopped, creating blob...');
        const blob = new Blob(chunks, { type: mimeType });
        console.log('Blob created:', blob.size, 'bytes');
        const url = URL.createObjectURL(blob);
        console.log('Preview URL created:', url);
        setVideoBlob(blob);
        setPreviewUrl(url);
        setRecordedChunks(chunks);
        console.log('Preview state updated');
        
        // Notify parent of video blob (not URL) so it persists
        if (onVideoRecorded) {
          onVideoRecorded(blob);
        }
        
        // Stop animation frame
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
          console.log('Animation frame cancelled');
        }
        
        // Stop all tracks
        stream.getTracks().forEach(track => {
          track.stop();
          console.log('Track stopped:', track.kind);
        });
      };

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start();
      console.log('Recording started');
    } catch (error) {
      console.error('Error accessing camera:', error);
      console.error('Error name:', error.name);
      console.error('Error message:', error.message);
      alert(`Unable to access camera: ${error.message}. Please check permissions and try again.`);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const toggleCamera = async () => {
    if (!hasMultipleCameras) return;
    
    // Stop current stream
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
    }
    
    // Switch camera
    const newFacingMode = facingMode === 'user' ? 'environment' : 'user';
    setFacingMode(newFacingMode);
    
    // Restart recording with new camera
    setTimeout(() => {
      startRecording();
    }, 500);
  };

  const toggleFullscreen = () => {
    const elem = fullscreenRef.current;
    if (!document.fullscreenElement) {
      elem?.requestFullscreen().catch(err => {
        console.warn('Fullscreen request failed:', err);
      });
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  const handleUploadVideo = (e) => {
    const file = e.target.files[0];
    if (file) {
      // Show video clipper for uploaded videos
      if (file.type.startsWith('video')) {
        setVideoBlob(file);
        setShowVideoClipper(true);
        return;
      }
      
      // For non-videos, just set directly
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
      setVideoBlob(file);
      setRecordedChunks([file]);
      
      // Notify parent of video blob (not URL) so it persists
      if (onVideoRecorded) {
        onVideoRecorded(file);
      }
    }
  };

  const handleVideoClip = (clipData) => {
    // User clipped the video, now use the clipped blob
    setShowVideoClipper(false);
    setVideoBlob(clipData.blob);
    
    // Create preview URL for clipped video
    const url = URL.createObjectURL(clipData.blob);
    setPreviewUrl(url);
    setRecordedChunks([clipData.blob]);
    
    // Notify parent
    if (onVideoRecorded) {
      onVideoRecorded(clipData.blob);
    }
  };

  const handleAddMember = (memberName) => {
    if (memberName.trim() && !formData.members.includes(memberName.trim())) {
      setFormData({
        ...formData,
        members: [...formData.members, memberName.trim()]
      });
    }
  };

  const handleRemoveMember = (memberName) => {
    setFormData({
      ...formData,
      members: formData.members.filter(m => m !== memberName)
    });
  };

  const handleSubmit = async () => {
    if (!videoBlob || !formData.title || !formData.description || !formData.creator) {
      setSubmitError('Please fill in all required fields and record/upload a video');
      return;
    }

    try {
      setIsSubmitting(true);
      setSubmitError(null);
      console.log('Submitting pitch with data:', {
        title: formData.title,
        creator: formData.creator,
        videoBlob: videoBlob ? `${videoBlob.size} bytes` : 'missing'
      });

      const pitchData = {
        ...formData,
        videoBlob: videoBlob,
        category: formData.category,
        timestamp: 'just now'
      };

      console.log('Calling onPitchCreated...');
      await onPitchCreated(pitchData);
      
      console.log('Pitch created successfully');
      setSubmitSuccess(true);
      
      // Show success message for 2 seconds then close
      setTimeout(() => {
        setSubmitSuccess(false);
      }, 2000);
    } catch (error) {
      console.error('Error submitting pitch:', error);
      setSubmitError(error.message || 'Failed to create pitch');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="w-full h-full px-0 relative flex flex-col">
      {/* Close Button - Hidden when using CreatorPage */}
      {onClose && !hideControls && (
        <button
          onClick={onClose}
          className="absolute top-3 left-3 md:top-4 md:right-4 w-9 h-9 md:w-10 md:h-10 rounded-full bg-white/10 hover:bg-white/20 text-white/70 hover:text-white flex items-center justify-center transition z-50 focus:outline-none focus:ring-2 focus:ring-white/30"
          aria-label="Close"
        >
          <X className="w-5 h-5 md:w-6 md:h-6" />
        </button>
      )}
      <div className="bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 rounded-none p-0 border-0 h-full flex flex-col overflow-hidden flex-1 space-y-4">
        {/* Header - Unified Pitchin Design */}
        <div className="hidden md:block mb-6 relative">
          <div className="relative">
            {/* Pitchin Title with Icon */}
            <div className="flex items-center gap-3 mb-4">
              <div className="text-4xl">🎬</div>
              <div>
                <h2 className="text-3xl font-bold bg-gradient-to-r from-pink-300 to-purple-300 bg-clip-text text-transparent">
                  Create Your Pitch
                </h2>
                <p className="text-sm text-gray-400">Share your vision, connect with investors</p>
              </div>
            </div>

            <p className="text-slate-300 text-base font-medium">
              Record or upload a compelling pitch video (up to 3 minutes). Tell your story, showcase your passion, and let your vision shine! 🚀
            </p>
          </div>
        </div>

        {/* Video Container - Full screen on mobile */}
        <div ref={fullscreenRef} className="flex-1 md:flex-shrink-0 md:mb-8 relative w-full h-full md:h-auto">
          <div style={{
            backgroundColor: '#000',
            position: 'relative',
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: '0rem'
          }} className="md:rounded-xl md:aspect-video border-0 md:border-2 md:border-purple-500/30 md:shadow-2xl md:shadow-purple-500/20">
            {!previewUrl ? (
              <>
                {/* Hidden video element for stream capture */}
                <video
                  ref={videoRef}
                  style={{
                    display: 'none'
                  }}
                  autoPlay
                  playsInline
                  muted
                />
                {/* Canvas for displaying video stream */}
                <canvas
                  ref={canvasRef}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    display: 'block',
                    backgroundColor: '#000'
                  }}
                />

              </>
            ) : (
              <>
                <video
                  src={previewUrl}
                  controls
                  autoPlay
                  playsInline
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    backgroundColor: '#000',
                    display: 'block'
                  }}
                />
              </>
            )}

            {/* Overlay Controls - Camera & Upload ALWAYS Visible - Bottom Left */}
            <div className="absolute bottom-3 md:bottom-4 left-3 md:left-4 flex gap-3 z-40 flex-wrap">
              {!previewUrl ? (
                <>
                  {/* Start Recording Button */}
                  <div className="relative group">
                    <button
                      onClick={startRecording}
                      disabled={isRecording}
                      className="relative w-14 h-14 md:w-14 md:h-14 rounded-full bg-gradient-to-br from-red-600 to-pink-600 hover:from-red-700 hover:to-pink-700 disabled:from-slate-600 disabled:to-slate-600 text-white flex items-center justify-center transition focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 focus:ring-offset-slate-900 shadow-xl hover:shadow-red-500/50"
                    >
                      <Camera className="w-6 h-6 md:w-6 md:h-6" />
                      {isRecording && (
                        <span className="absolute inset-0 rounded-full border-2 border-red-400 animate-pulse" />
                      )}
                    </button>
                    <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none hidden md:block">
                      <div className="bg-slate-900 border border-red-500/50 text-white text-xs px-3 py-2 rounded-lg whitespace-nowrap font-semibold shadow-lg">
                        {isRecording ? '⏹ Recording...' : '🔴 Record'}
                      </div>
                    </div>
                  </div>

                  {/* Stop Recording Button */}
                  {isRecording && (
                    <div className="relative group">
                      <button
                        onClick={stopRecording}
                        className="w-14 h-14 md:w-14 md:h-14 rounded-full bg-gradient-to-br from-slate-700 to-slate-600 hover:from-slate-600 hover:to-slate-500 text-white flex items-center justify-center transition focus:outline-none focus:ring-2 focus:ring-slate-500 focus:ring-offset-2 focus:ring-offset-slate-900 shadow-xl"
                      >
                        <Square className="w-6 h-6 md:w-6 md:h-6" />
                      </button>
                      <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none hidden md:block">
                        <div className="bg-slate-900 border border-slate-500/50 text-white text-xs px-3 py-2 rounded-lg whitespace-nowrap font-semibold shadow-lg">
                          ⏹ Stop Recording
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Upload Video Button */}
                  <div className="relative group">
                    <label className="w-14 h-14 md:w-14 md:h-14 rounded-full bg-gradient-to-br from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700 text-white flex items-center justify-center transition cursor-pointer focus-within:outline-none focus-within:ring-2 focus-within:ring-blue-500 focus-within:ring-offset-2 focus-within:ring-offset-slate-900 shadow-xl hover:shadow-blue-500/50">
                      <Upload className="w-6 h-6 md:w-6 md:h-6" />
                      <input
                        type="file"
                        accept="video/*"
                        onChange={handleUploadVideo}
                        className="hidden"
                      />
                    </label>
                    <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none hidden md:block">
                      <div className="bg-slate-900 border border-blue-500/50 text-white text-xs px-3 py-2 rounded-lg whitespace-nowrap font-semibold shadow-lg">
                        📤 Upload Video
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="relative group">
                    <button
                      onClick={() => setShowVideoClipper(true)}
                      className="w-12 h-12 md:w-12 md:h-12 rounded-full bg-gradient-to-br from-orange-600 to-yellow-600 hover:from-orange-700 hover:to-yellow-700 text-white flex items-center justify-center transition focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 focus:ring-offset-slate-900 shadow-xl hover:shadow-orange-500/50"
                    >
                      <Scissors className="w-6 h-6 md:w-6 md:h-6" />
                    </button>
                    <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none hidden md:block">
                      <div className="bg-slate-900 border border-orange-500/50 text-white text-xs px-3 py-2 rounded-lg whitespace-nowrap font-semibold shadow-lg">
                        ✂️ Clip Video
                      </div>
                    </div>
                  </div>
                  <div className="relative group">
                    <button
                      onClick={() => setPreviewUrl(null)}
                      className="w-12 h-12 md:w-12 md:h-12 rounded-full bg-slate-700 hover:bg-slate-600 text-white flex items-center justify-center transition focus:outline-none focus:ring-2 focus:ring-slate-500 focus:ring-offset-2 focus:ring-offset-slate-900 shadow-xl"
                    >
                      <RotateCcw className="w-6 h-6 md:w-6 md:h-6" />
                    </button>
                  <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none hidden md:block">
                    <div className="bg-slate-900 text-white text-xs px-3 py-1 rounded whitespace-nowrap border border-slate-700">
                      Re-record
                    </div>
                  </div>
                  </div>
                </>
              )}
            </div>

            {/* Camera Toggle - Top Left (Mobile), Bottom Left (Desktop) */}
            {hasMultipleCameras && !previewUrl && (
              <div className="absolute top-4 left-4 md:bottom-4 md:left-4 md:top-auto z-40">
                <button
                  onClick={toggleCamera}
                  className="relative group w-11 h-11 md:w-12 md:h-12 rounded-full bg-slate-700/80 hover:bg-slate-600 text-cyan-400 hover:text-cyan-300 flex items-center justify-center transition focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:ring-offset-2 focus:ring-offset-slate-900 shadow-lg"
                  title="Switch camera"
                >
                  <Smartphone className="w-6 h-6 md:w-6 md:h-6" />
                  <div className="absolute bottom-full left-0 mb-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none hidden md:block">
                    <div className="bg-slate-900 text-white text-xs px-3 py-1 rounded whitespace-nowrap border border-slate-700">
                      {facingMode === 'user' ? 'Back Camera' : 'Front Camera'}
                    </div>
                  </div>
                </button>
              </div>
            )}

            {/* Fullscreen Toggle - Top Right (Mobile), Bottom Right (Desktop) */}
            {!previewUrl && (
              <div className="absolute top-4 right-16 md:bottom-4 md:right-4 md:top-auto z-40">
                <button
                  onClick={toggleFullscreen}
                  className="relative group w-11 h-11 md:w-12 md:h-12 rounded-full bg-slate-700/80 hover:bg-slate-600 text-yellow-400 hover:text-yellow-300 flex items-center justify-center transition focus:outline-none focus:ring-2 focus:ring-yellow-500 focus:ring-offset-2 focus:ring-offset-slate-900 shadow-lg"
                  title="Toggle fullscreen"
                >
                  {isFullscreen ? (
                    <Minimize className="w-6 h-6 md:w-6 md:h-6" />
                  ) : (
                    <Maximize className="w-6 h-6 md:w-6 md:h-6" />
                  )}
                  <div className="absolute bottom-full right-0 mb-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none hidden md:block">
                    <div className="bg-slate-900 text-white text-xs px-3 py-1 rounded whitespace-nowrap border border-slate-700">
                      {isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
                    </div>
                  </div>
                </button>
              </div>
            )}

            {/* Recording Time Display */}
            {isRecording && (
              <div className="absolute top-4 left-1/2 transform -translate-x-1/2 md:top-auto md:bottom-4 z-40 bg-red-600/80 text-white px-4 py-2 rounded-full flex items-center gap-2 shadow-lg">
                <div className="w-2 h-2 bg-white rounded-full animate-pulse"></div>
                <span className="text-sm font-bold">{Math.floor(recordingTime / 60)}:{String(recordingTime % 60).padStart(2, '0')}</span>
              </div>
            )}
            <div className="absolute top-14 md:top-4 right-4 md:right-4 z-40">
              <button
                onClick={() => setIsFormExpanded(!isFormExpanded)}
                className="relative group w-11 h-11 md:w-12 md:h-12 rounded-full bg-slate-700/80 hover:bg-slate-600 text-purple-400 hover:text-purple-300 flex items-center justify-center transition focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 focus:ring-offset-slate-900 shadow-lg"
              >
                <Pin className={`w-6 h-6 md:w-6 md:h-6 transition-transform ${isFormExpanded ? 'rotate-45' : ''}`} />
                <div className="absolute bottom-full right-0 mb-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none hidden md:block">
                  <div className="bg-slate-900 text-white text-xs px-3 py-1 rounded whitespace-nowrap border border-slate-700">
                    {isFormExpanded ? 'Collapse form' : 'Expand form'}
                  </div>
                </div>
              </button>
            </div>
          </div>
        </div>

        {/* Form Fields - Completely hidden until pin clicked */}
        <div className={`transition-all duration-300 overflow-y-auto md:flex-none md:space-y-4 ${
          isFormExpanded 
            ? 'flex flex-col flex-1 md:flex-none max-h-full opacity-100 px-3 md:px-0 py-4 md:py-0' 
            : 'hidden'
        }`}>
          <div className="space-y-3 md:space-y-4 px-0 md:px-0">
            {/* Form Header */}
            <div className="hidden md:block mb-4 pb-4 border-b border-purple-500/30">
              <h3 className="text-lg font-bold bg-gradient-to-r from-purple-300 to-pink-300 bg-clip-text text-transparent">
                Tell Your Story
              </h3>
              <p className="text-sm text-slate-400 mt-1">Fill in the details to help investors understand your vision</p>
            </div>

            {/* Title */}
            <div>
              <label className="block text-slate-300 font-semibold mb-2 text-sm md:text-base">
                ✨ Pitch Title *
              </label>
              <input
                type="text"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                placeholder="e.g., AI-Powered Supply Chain Platform"
                className="w-full bg-slate-800/50 text-white rounded-lg px-3 md:px-4 py-2.5 md:py-3 border border-purple-500/30 hover:border-purple-500/50 focus:border-purple-500 focus:outline-none text-sm md:text-base transition placeholder-slate-500"
              />
            </div>

            {/* Creator Name */}
            <div>
              <label className="block text-slate-300 font-semibold mb-2 text-sm md:text-base">
                👤 Creator/Company Name *
              </label>
              <input
                type="text"
                value={formData.creator}
                onChange={(e) => setFormData({ ...formData, creator: e.target.value })}
                placeholder="Your name or company"
                className="w-full bg-slate-800/50 text-white rounded-lg px-3 md:px-4 py-2.5 md:py-3 border border-purple-500/30 hover:border-purple-500/50 focus:border-purple-500 focus:outline-none text-sm md:text-base transition placeholder-slate-500"
              />
            </div>

            {/* Description */}
            <div>
              <label className="block text-slate-300 font-semibold mb-2 text-sm md:text-base">
                📝 Pitch Description *
              </label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Describe your idea, business model, and what you're seeking. Be compelling and clear!"
                rows={3}
                className="w-full bg-slate-800/50 text-white rounded-lg px-3 md:px-4 py-2.5 md:py-3 border border-purple-500/30 hover:border-purple-500/50 focus:border-purple-500 focus:outline-none text-sm md:text-base resize-none transition placeholder-slate-500"
              />
            </div>

            {/* Grid: Category, Pitch Type */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
              <div>
                <label className="block text-slate-300 font-semibold mb-2 text-sm md:text-base">
                  🎯 Category
                </label>
                <select
                  value={formData.category}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                  className="w-full bg-slate-800/50 text-white rounded-lg px-3 md:px-4 py-2.5 md:py-3 border border-purple-500/30 hover:border-purple-500/50 focus:border-purple-500 focus:outline-none text-sm md:text-base transition"
                >
                  <option>Technology</option>
                  <option>Healthcare</option>
                  <option>Finance</option>
                  <option>Agriculture</option>
                  <option>Education</option>
                  <option>Sustainability</option>
                </select>
              </div>
              <div>
                <label className="block text-slate-300 font-semibold mb-2 text-sm md:text-base">
                  💼 Pitch Type
                </label>
                <select
                  value={formData.pitchType}
                  onChange={(e) => setFormData({ ...formData, pitchType: e.target.value })}
                  className="w-full bg-slate-800/50 text-white rounded-lg px-3 md:px-4 py-2.5 md:py-3 border border-purple-500/30 hover:border-purple-500/50 focus:border-purple-500 focus:outline-none text-sm md:text-base transition"
                >
                  <option>Equity</option>
                  <option>Partnership</option>
                  <option>Debt</option>
                  <option>Grant</option>
                </select>
              </div>
            </div>

            {/* Grid: Funding Details */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4">
              <div>
                <label className="block text-slate-300 font-semibold mb-2 text-sm md:text-base">
                  💰 Target Goal
                </label>
                <input
                  type="text"
                  value={formData.goal}
                  onChange={(e) => setFormData({ ...formData, goal: e.target.value })}
                  placeholder="$500K"
                  className="w-full bg-slate-800/50 text-white rounded-lg px-3 md:px-4 py-2.5 md:py-3 border border-purple-500/30 hover:border-purple-500/50 focus:border-purple-500 focus:outline-none text-sm md:text-base transition placeholder-slate-500"
                />
              </div>
              <div>
                <label className="block text-slate-300 font-semibold mb-2 text-sm md:text-base">
                  📊 Equity Offering
                </label>
                <input
                  type="text"
                  value={formData.equity}
                  onChange={(e) => setFormData({ ...formData, equity: e.target.value })}
                  placeholder="10%"
                  className="w-full bg-slate-800/50 text-white rounded-lg px-3 md:px-4 py-2.5 md:py-3 border border-purple-500/30 hover:border-purple-500/50 focus:border-purple-500 focus:outline-none text-sm md:text-base transition placeholder-slate-500"
                />
              </div>
              <div>
                <label className="block text-slate-300 font-semibold mb-2 text-sm md:text-base">
                  💵 Currently Raised
                </label>
                <input
                  type="text"
                  value={formData.raised}
                  onChange={(e) => setFormData({ ...formData, raised: e.target.value })}
                  placeholder="$0"
                  className="w-full bg-slate-800/50 text-white rounded-lg px-3 md:px-4 py-2.5 md:py-3 border border-purple-500/30 hover:border-purple-500/50 focus:border-purple-500 focus:outline-none text-sm md:text-base transition placeholder-slate-500"
                />
              </div>
            </div>

            {/* IP Checkbox */}
            <div className="flex items-center gap-3 p-3 bg-slate-800/30 rounded-lg border border-purple-500/20">
              <input
                type="checkbox"
                checked={formData.hasIP}
                onChange={(e) => setFormData({ ...formData, hasIP: e.target.checked })}
                className="w-4 h-4 md:w-5 md:h-5 rounded border-purple-500/50 cursor-pointer accent-purple-500"
              />
              <label className="text-slate-300 font-semibold cursor-pointer text-sm md:text-base">
                🔐 This pitch includes Intellectual Property (IP)
              </label>
            </div>

            {/* Team Members */}
            <div>
              <label className="block text-slate-300 font-semibold mb-2 text-sm md:text-base">
                👥 Team Members
              </label>
              <div className="flex flex-col md:flex-row gap-2 mb-2">
                <input
                  type="text"
                  id="memberInput"
                  placeholder="Add team member name"
                  className="flex-1 bg-slate-800/50 text-white rounded-lg px-3 md:px-4 py-2.5 md:py-3 border border-purple-500/30 hover:border-purple-500/50 focus:border-purple-500 focus:outline-none text-sm md:text-base transition placeholder-slate-500"
                />
                <button
                  onClick={() => {
                    const input = document.getElementById('memberInput');
                    handleAddMember(input.value);
                    input.value = '';
                  }}
                  className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white px-4 md:px-6 py-2.5 md:py-3 rounded-lg font-semibold transition text-sm md:text-base shadow-lg hover:shadow-purple-500/50"
                >
                  ➕ Add
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {formData.members.map((member, idx) => (
                  <div
                    key={idx}
                    className="bg-purple-600/30 text-purple-300 px-3 py-1 rounded-full text-xs md:text-sm flex items-center gap-2 border border-purple-500/50"
                  >
                    {member}
                    <button
                      onClick={() => handleRemoveMember(member)}
                      className="hover:text-purple-100"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Error Message */}
            {submitError && (
              <div className="bg-gradient-to-r from-red-600 to-red-700 text-white px-4 py-3 rounded-lg mb-3 text-sm font-semibold border border-red-500/50 shadow-lg">
                ⚠️ {submitError}
              </div>
            )}

            {/* Success Message */}
            {submitSuccess && (
              <div className="bg-gradient-to-r from-green-600 to-emerald-600 text-white px-4 py-3 rounded-lg mb-3 text-center font-semibold border border-green-500/50 shadow-lg">
                ✅ Pitch created successfully! Redirecting...
              </div>
            )}

            {/* Submit */}
            <button
              onClick={handleSubmit}
              disabled={isSubmitting}
              className={`w-full py-3 md:py-4 rounded-lg font-bold text-base md:text-lg transition shadow-xl ${
                isSubmitting
                  ? 'bg-slate-600 cursor-not-allowed opacity-75'
                  : 'bg-gradient-to-r from-purple-600 via-pink-600 to-red-600 hover:from-purple-700 hover:via-pink-700 hover:to-red-700 text-white hover:shadow-2xl hover:shadow-pink-500/50 transform hover:scale-105'
              }`}
            >
              {isSubmitting ? '⏳ Launching Pitch...' : '🚀 Launch Your Pitch & Connect With Investors'}
            </button>
          </div>
        </div>

        {/* Video Clipper Modal */}
        {showVideoClipper && videoBlob && (
          <VideoClipper 
            videoFile={videoBlob}
            onClip={handleVideoClip}
            onCancel={() => setShowVideoClipper(false)}
          />
        )}
      </div>
    </div>
  );
};

export default PitchVideoRecorder;
