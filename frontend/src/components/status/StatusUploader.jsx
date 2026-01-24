/**
 * StatusUploader Component - Enhanced with Camera Capture
 * Creative modern UI for uploading statuses with image/video and camera capture
 */

import React, { useState, useRef, useEffect } from 'react';
import { Upload, X, Eye, EyeOff, Heart, Send, Plus, CheckCircle, AlertCircle, Loader, Camera, Video, Sparkles, Zap, Square } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { uploadStatusMedia, createStatus } from '../../services/statusService';

export const StatusUploader = ({ onStatusCreated = null, onClose = null }) => {
  const { user, profile } = useAuth();
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [caption, setCaption] = useState('');
  const [visibility, setVisibility] = useState('public');
  const [backgroundColor, setBackgroundColor] = useState('#667eea');
  const [error, setError] = useState(null);
  const fileInputRef = useRef(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [showCamera, setShowCamera] = useState(false);
  const [stream, setStream] = useState(null);
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [fileToUpload, setFileToUpload] = useState(null);
  const [isPhotoPreview, setIsPhotoPreview] = useState(false);
  const [captureMode, setCaptureMode] = useState('photo');
  const mediaRecorderRef = useRef(null);
  const recordedChunksRef = useRef([]);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [streamRef, setStreamRef] = useState(null);

  // Camera access - exact copy from PitchVideoRecorder
  const startCamera = async () => {
    try {
      setError(null);
      setShowCamera(true);
      setIsCameraReady(false);
      
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'user'
        },
        audio: false
      });

      setStream(stream);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        
        videoRef.current.onplay = () => {
          setIsCameraReady(true);
        };

        videoRef.current.play().catch(err => {
          console.error('Play error:', err);
          setIsCameraReady(true);
        });
      }
    } catch (error) {
      console.error('Error accessing camera:', error);
      setError(`Unable to access camera: ${error.message}`);
      setShowCamera(false);
    }
  };

  const stopCamera = () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
    setShowCamera(false);
    setIsCameraReady(false);
  };

  const captureImage = () => {
    if (videoRef.current && canvasRef.current && isCameraReady) {
      const ctx = canvasRef.current.getContext('2d');
      canvasRef.current.width = videoRef.current.videoWidth;
      canvasRef.current.height = videoRef.current.videoHeight;
      ctx.drawImage(videoRef.current, 0, 0);
      
      canvasRef.current.toBlob((blob) => {
        if (blob) {
          const url = URL.createObjectURL(blob);
          setPreviewUrl(url);
          setFileToUpload(blob);
          stopCamera();
          setIsPhotoPreview(true);
        }
      }, 'image/jpeg', 0.95);
    }
  };

  const retakePhoto = () => {
    setPreviewUrl(null);
    setFileToUpload(null);
    setIsPhotoPreview(false);
    startCamera();
  };

  const confirmPhoto = () => {
    setShowCamera(false);
    setIsPhotoPreview(false);
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const startVideoRecording = async () => {
    try {
      setError(null);
      setShowCamera(true);
      
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'user'
        },
        audio: true
      });

      setStreamRef(stream);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        
        videoRef.current.onplay = () => {
          setIsRecording(true);
          setRecordingTime(0);
          
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
          
          const mediaRecorder = new MediaRecorder(stream, { mimeType });
          const chunks = [];
          recordedChunksRef.current = chunks;
          
          mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) chunks.push(e.data);
          };
          
          mediaRecorder.onstop = () => {
            const blob = new Blob(chunks, { type: mimeType });
            const url = URL.createObjectURL(blob);
            setPreviewUrl(url);
            setFileToUpload(blob);
            setIsPhotoPreview(true);
            stream.getTracks().forEach(track => track.stop());
          };
          
          mediaRecorderRef.current = mediaRecorder;
          mediaRecorder.start();
        };

        videoRef.current.play().catch(err => {
          console.error('Play error:', err);
          setIsRecording(true);
        });
      }
    } catch (error) {
      console.error('Error accessing camera:', error);
      setError(`Unable to access camera: ${error.message}`);
      setShowCamera(false);
    }
  };

  const stopVideoRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setRecordingTime(0);
    }
  };

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

  // Cleanup camera on unmount
  useEffect(() => {
    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, [stream]);

  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);

    // Preview
    const reader = new FileReader();
    reader.onload = (event) => {
      setPreviewUrl(event.target?.result);
    };
    reader.readAsDataURL(file);

    // Prepare for upload
    setFileToUpload(file);
  };

  // Auto-close on success
  useEffect(() => {
    if (uploadSuccess) {
      const timer = setTimeout(() => {
        onClose?.();
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [uploadSuccess, onClose]);

  // Simulate upload progress
  useEffect(() => {
    if (!isUploading) {
      setUploadProgress(0);
      return;
    }

    const interval = setInterval(() => {
      setUploadProgress((prev) => {
        if (prev >= 90) return 90;
        return prev + Math.random() * 30;
      });
    }, 300);

    return () => clearInterval(interval);
  }, [isUploading]);

  const handleUpload = async () => {
    if (!fileToUpload) {
      setError('Please select an image or video');
      return;
    }

    setIsUploading(true);
    setError(null);

    try {
      // Determine media type
      const mediaType = fileToUpload.type.startsWith('video') ? 'video' : 'image';

      // Upload to storage
      const { url, error: uploadError } = await uploadStatusMedia(user.id, fileToUpload);
      if (uploadError) throw uploadError;

      // Create status record
      const { status, error: createError } = await createStatus(user.id, {
        media_type: mediaType,
        media_url: url,
        caption: caption.trim(),
        visibility,
        background_color: backgroundColor
      });

      if (createError) throw createError;

      // Show success state
      setUploadProgress(100);
      setUploadSuccess(true);

      // Reset form
      setPreviewUrl(null);
      setCaption('');
      setVisibility('public');
      setFileToUpload(null);
      if (fileInputRef.current) fileInputRef.current.value = '';

      onStatusCreated?.(status);
    } catch (err) {
      setError(err.message || 'Upload failed');
      console.error('Upload error:', err);
      setIsUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-gradient-to-br from-black/90 via-purple-900/50 to-black/90 backdrop-blur-xl flex items-center justify-center z-50 p-4">
      {/* Camera Capture UI - Full Modal */}
      {showCamera ? (
        <div className="bg-gradient-to-br from-slate-900 via-purple-900/30 to-slate-900 border border-purple-500/30 rounded-3xl w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden shadow-2xl relative">
          
          {/* Header */}
          <div className="relative flex items-center justify-between p-5 border-b border-purple-500/20 flex-shrink-0 bg-slate-900/50 backdrop-blur-md">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-gradient-to-r from-purple-500 to-pink-500 flex items-center justify-center">
                <Camera className="w-5 h-5 text-white" />
              </div>
              <div>
                <h2 className="text-lg font-bold bg-gradient-to-r from-purple-300 to-pink-300 bg-clip-text text-transparent">Capture Photo</h2>
                <p className="text-xs text-gray-400">{isPhotoPreview ? 'Review your media' : isRecording ? `Recording: ${formatTime(recordingTime)}` : captureMode === 'video' ? 'Record a video' : 'Point and shoot'}</p>
              </div>
            </div>
            <button
              onClick={() => {
                stopCamera();
                setShowCamera(false);
                setIsPhotoPreview(false);
                setPreviewUrl(null);
                setFileToUpload(null);
              }}
              className="p-2 text-gray-400 hover:text-white hover:bg-white/10 rounded-full transition-all transform hover:scale-110"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Camera/Preview Area */}
          <div className="flex-1 flex items-center justify-center p-6">
            {isPhotoPreview ? (
              <div className="relative rounded-2xl overflow-hidden bg-black w-full aspect-video border-2 border-purple-500/30">
                <img
                  src={previewUrl}
                  alt="Captured media"
                  className="w-full h-full object-cover"
                />
                <video
                  src={previewUrl}
                  className="w-full h-full object-cover"
                  controls
                  style={{ display: fileToUpload?.type?.startsWith('video') ? 'block' : 'none' }}
                />
                <div className="absolute inset-0 flex flex-col items-center justify-between p-4 bg-gradient-to-t from-black/60 via-transparent to-transparent">
                  <div className="flex items-center gap-2 px-4 py-2 bg-white/10 rounded-full backdrop-blur-md border border-white/20">
                    <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                    <span className="text-white text-sm font-medium">Perfect!</span>
                  </div>
                </div>
              </div>
            ) : isCameraReady || isRecording ? (
              <div className="relative rounded-2xl overflow-hidden bg-black w-full aspect-video border-2 border-purple-500/30">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover"
                />
                <canvas ref={canvasRef} className="hidden" />
                
                <div className="absolute inset-0 flex flex-col items-center justify-between p-4 bg-gradient-to-t from-black/60 via-transparent to-transparent">
                  <div className="flex items-center gap-2 px-4 py-2 bg-white/10 rounded-full backdrop-blur-md border border-white/20">
                    <div className={`w-2 h-2 rounded-full ${isRecording ? 'bg-red-500 animate-pulse' : 'bg-red-500'}`}></div>
                    <span className="text-white text-sm font-medium">
                      {isRecording ? `Recording ${formatTime(recordingTime)}` : 'Live Camera'}
                    </span>
                  </div>

                  {/* Mode Toggle (Photo/Video) */}
                  {!isRecording && !isPhotoPreview && (
                    <div className="flex gap-2 px-4 py-3 bg-black/50 rounded-full backdrop-blur-md border border-white/20">
                      <button
                        onClick={() => setCaptureMode('photo')}
                        className={`px-4 py-2 rounded-full font-semibold transition-all ${
                          captureMode === 'photo'
                            ? 'bg-purple-500 text-white'
                            : 'bg-white/10 text-gray-300 hover:bg-white/20'
                        }`}
                      >
                        Photo
                      </button>
                      <button
                        onClick={() => setCaptureMode('video')}
                        className={`px-4 py-2 rounded-full font-semibold transition-all ${
                          captureMode === 'video'
                            ? 'bg-purple-500 text-white'
                            : 'bg-white/10 text-gray-300 hover:bg-white/20'
                        }`}
                      >
                        Video
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="text-center py-12">
                <Loader className="w-8 h-8 text-purple-400 mx-auto mb-2 animate-spin" />
                <p className="text-gray-300">Initializing camera...</p>
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="p-6 border-t border-purple-500/20 flex-shrink-0 bg-slate-900/50 backdrop-blur-md">
            {isPhotoPreview ? (
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setIsPhotoPreview(false);
                    if (captureMode === 'video') {
                      startVideoRecording();
                    }
                  }}
                  className="flex-1 py-3 px-4 rounded-lg bg-orange-500/90 hover:bg-orange-600 text-white font-semibold transition-all transform hover:scale-105 flex items-center justify-center gap-2"
                >
                  <Camera className="w-4 h-4" />
                  Retake
                </button>
                <button
                  onClick={confirmPhoto}
                  className="flex-1 py-3 px-4 rounded-lg bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 text-white font-semibold transition-all transform hover:scale-105 flex items-center justify-center gap-2 shadow-lg"
                >
                  <CheckCircle className="w-4 h-4" />
                  Use Media
                </button>
              </div>
            ) : isRecording ? (
              <button
                onClick={stopVideoRecording}
                className="w-full py-3 px-4 rounded-lg bg-red-500 hover:bg-red-600 text-white font-semibold transition-all transform hover:scale-105 flex items-center justify-center gap-2 shadow-lg"
              >
                <Square className="w-4 h-4" />
                Stop Recording
              </button>
            ) : isCameraReady ? (
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    if (captureMode === 'video') startVideoRecording();
                    else stopCamera(); setShowCamera(false);
                  }}
                  className={`flex-1 py-3 px-4 rounded-lg font-semibold transition-all ${
                    captureMode === 'video'
                      ? 'bg-red-500/20 hover:bg-red-500/30 text-red-200'
                      : 'bg-red-500/20 hover:bg-red-500/30 text-red-200'
                  }`}
                >
                  {captureMode === 'video' ? 'Exit' : 'Cancel'}
                </button>
                <button
                  onClick={captureMode === 'photo' ? captureImage : startVideoRecording}
                  className="flex-1 py-3 px-4 rounded-lg bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white font-semibold transition-all transform hover:scale-105 flex items-center justify-center gap-2 shadow-lg"
                >
                  {captureMode === 'video' ? (
                    <>
                      <Camera className="w-4 h-4" />
                      Record
                    </>
                  ) : (
                    <>
                      <Camera className="w-4 h-4" />
                      Capture
                    </>
                  )}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="bg-gradient-to-br from-slate-900 via-purple-900/30 to-slate-900 border border-purple-500/30 rounded-3xl w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden shadow-2xl relative">
          
          {/* Animated Background Blur */}
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute top-0 left-0 w-40 h-40 bg-purple-600/20 rounded-full blur-3xl"></div>
            <div className="absolute bottom-0 right-0 w-40 h-40 bg-pink-600/20 rounded-full blur-3xl"></div>
          </div>

          {/* Header */}
          <div className="relative flex items-center justify-between p-5 border-b border-purple-500/20 flex-shrink-0 bg-slate-900/50 backdrop-blur-md">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-gradient-to-r from-purple-500 to-pink-500 flex items-center justify-center">
                <Sparkles className="w-5 h-5 text-white" />
              </div>
              <div>
                <h2 className="text-lg font-bold bg-gradient-to-r from-purple-300 to-pink-300 bg-clip-text text-transparent">Share a Story</h2>
                <p className="text-xs text-gray-400">Create your moment</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 text-gray-400 hover:text-white hover:bg-white/10 rounded-full transition-all transform hover:scale-110"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Content - Scrollable */}
          <div className="p-6 space-y-4 overflow-y-auto flex-1 pr-8 relative">
          {/* Camera Preview */}
          {previewUrl && !showCamera ? (
            <div className="relative rounded-2xl overflow-hidden bg-black aspect-video border-2 border-purple-500/30">
              <img
                src={previewUrl}
                alt="Preview"
                className="w-full h-full object-cover"
              />
            </div>
          ) : (
            <div className="space-y-3">
              {/* Camera Capture Option */}
              <button
                onClick={startCamera}
                className="relative group w-full rounded-2xl p-6 transition-all overflow-hidden border-2 border-purple-500/40 hover:border-purple-500/80 bg-gradient-to-br from-purple-500/10 to-pink-500/10 hover:from-purple-500/20 hover:to-pink-500/20"
              >
                <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                  <div className="absolute inset-0 bg-gradient-to-r from-purple-600/20 to-pink-600/20"></div>
                </div>
                <div className="relative space-y-2">
                  <div className="w-12 h-12 rounded-full bg-gradient-to-r from-purple-500 to-pink-500 flex items-center justify-center mx-auto mb-2 group-hover:scale-110 transition-transform shadow-lg">
                    <Camera className="w-6 h-6 text-white" />
                  </div>
                  <p className="text-sm font-bold bg-gradient-to-r from-purple-300 to-pink-300 bg-clip-text text-transparent">Take Photo</p>
                  <p className="text-xs text-purple-200/70">Capture from your camera</p>
                </div>
              </button>

              {/* File Upload Option */}
              <button
                onClick={() => fileInputRef.current?.click()}
                className="relative group w-full rounded-2xl p-6 transition-all overflow-hidden border-2 border-blue-500/40 hover:border-blue-500/80 bg-gradient-to-br from-blue-500/10 to-cyan-500/10 hover:from-blue-500/20 hover:to-cyan-500/20"
              >
                <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                  <div className="absolute inset-0 bg-gradient-to-r from-blue-600/20 to-cyan-600/20"></div>
                </div>
                <div className="relative space-y-2">
                  <div className="w-12 h-12 rounded-full bg-gradient-to-r from-blue-500 to-cyan-500 flex items-center justify-center mx-auto mb-2 group-hover:scale-110 transition-transform shadow-lg">
                    <Upload className="w-6 h-6 text-white" />
                  </div>
                  <p className="text-sm font-bold bg-gradient-to-r from-blue-300 to-cyan-300 bg-clip-text text-transparent">Upload Media</p>
                  <p className="text-xs text-blue-200/70">JPEG, PNG, WebP, MP4 • Max 10MB</p>
                </div>
              </button>

              {/* Info Cards */}
              <div className="grid grid-cols-2 gap-2 pt-2">
                <div className="rounded-lg bg-gradient-to-br from-orange-500/20 to-red-500/20 border border-orange-500/30 p-3 text-center">
                  <Zap className="w-4 h-4 text-orange-400 mx-auto mb-1" />
                  <p className="text-xs font-semibold text-orange-300">Instant</p>
                </div>
                <div className="rounded-lg bg-gradient-to-br from-green-500/20 to-emerald-500/20 border border-green-500/30 p-3 text-center">
                  <Heart className="w-4 h-4 text-green-400 mx-auto mb-1" />
                  <p className="text-xs font-semibold text-green-300">Engaging</p>
                </div>
              </div>
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*"
            onChange={handleFileSelect}
            className="hidden"
          />

          {/* Caption */}
          {previewUrl && (
            <>
              <div>
                <label className="text-xs font-semibold text-purple-300 block mb-2">✨ Add a Caption (optional)</label>
                <textarea
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  placeholder="What's on your mind?"
                  maxLength={500}
                  className="w-full px-4 py-3 bg-slate-800/50 border border-purple-500/30 rounded-xl text-white placeholder-gray-500 text-sm resize-none focus:border-purple-500/60 focus:outline-none transition-all"
                  rows={3}
                />
                <p className="text-xs text-purple-300/60 mt-1">{caption.length}/500</p>
              </div>

              {/* Visibility */}
              <div>
                <label className="text-xs font-semibold text-purple-300 block mb-2">👥 Who can see?</label>
                <select
                  value={visibility}
                  onChange={(e) => setVisibility(e.target.value)}
                  className="w-full px-4 py-3 bg-slate-800/50 border border-purple-500/30 rounded-xl text-white text-sm focus:border-purple-500/60 focus:outline-none transition-all"
                >
                  <option value="public">Everyone</option>
                  <option value="followers">Followers Only</option>
                  <option value="private">Only Me</option>
                </select>
              </div>

              {/* Background Color */}
              <div>
                <label className="text-xs font-semibold text-purple-300 block mb-2">🎨 Vibe</label>
                <div className="flex gap-2 flex-wrap">
                  {['#667eea', '#f093fb', '#4facfe', '#00f2fe', '#43e97b', '#fa709a'].map((color) => (
                    <button
                      key={color}
                      onClick={() => setBackgroundColor(color)}
                      className={`w-10 h-10 rounded-lg transition-all transform hover:scale-110 ${
                        backgroundColor === color
                          ? 'ring-2 ring-white scale-110 shadow-lg'
                          : 'ring-1 ring-slate-700 hover:ring-slate-600 hover:shadow-md'
                      }`}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                  <button
                    onClick={() => {
                      const customColor = prompt('Enter color code (e.g., #FF5733):');
                      if (customColor) setBackgroundColor(customColor);
                    }}
                    className="w-10 h-10 rounded-lg border-2 border-purple-500 flex items-center justify-center text-purple-400 hover:bg-purple-500/10 transition-all font-bold text-sm hover:scale-110"
                    title="Add custom color"
                  >
                    <Plus className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </>
          )}

          {/* Error message */}
          {error && (
            <div className="p-3 bg-red-500/20 border border-red-500/50 rounded-lg text-red-200 text-sm flex items-center gap-2 animate-pulse">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          {/* Upload Progress */}
          {isUploading && (
            <div className="space-y-3 p-4 bg-purple-500/10 border border-purple-500/30 rounded-lg backdrop-blur-sm">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-purple-200">Publishing...</span>
                <span className="text-sm text-purple-300 font-bold">{Math.round(uploadProgress)}%</span>
              </div>
              <div className="w-full h-2 bg-slate-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-purple-500 via-pink-500 to-red-500 transition-all duration-300 shadow-lg shadow-purple-500/50"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            </div>
          )}

          {/* Success Message */}
          {uploadSuccess && (
            <div className="p-4 bg-green-500/20 border border-green-500/50 rounded-lg flex items-center gap-2 animate-pulse">
              <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0" />
              <div>
                <p className="font-medium text-green-200">Story published! 🎉</p>
                <p className="text-sm text-green-300">Closing...</p>
              </div>
            </div>
          )}
          </div>

          {/* Floating Submit Button */}
          {fileToUpload && !uploadSuccess && (
            <button
              onClick={handleUpload}
              disabled={isUploading}
              className={`absolute bottom-24 right-6 w-16 h-16 rounded-full flex items-center justify-center transition-all shadow-2xl hover:shadow-2xl hover:scale-110 disabled:scale-95 z-10 font-bold text-lg transform ${
                isUploading 
                  ? 'bg-gradient-to-r from-purple-600 to-pink-600 animate-pulse' 
                  : 'bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 hover:shadow-purple-500/50'
              } text-white border-2 border-white/30`}
              title={isUploading ? 'Publishing...' : 'Publish Story'}
            >
              {isUploading ? (
                <Loader className="w-6 h-6 animate-spin" />
              ) : (
                <Send className="w-6 h-6" />
              )}
            </button>
          )}

          {/* Cancel Button */}
          {fileToUpload && (
            <div className="p-4 border-t border-purple-500/20 flex-shrink-0 bg-slate-900/50 backdrop-blur-md">
              <button
                onClick={() => {
                  setPreviewUrl(null);
                  setFileToUpload(null);
                }}
                className="w-full px-4 py-2 text-gray-300 hover:text-white hover:bg-white/10 rounded-lg font-medium transition-all"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default StatusUploader;
