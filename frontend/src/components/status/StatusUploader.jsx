/**
 * StatusUploader Component - Enhanced with Camera Capture
 * Creative modern UI for uploading statuses with image/video
 */

import React, { useState, useRef, useEffect } from 'react';
import { Upload, X, Eye, EyeOff, Heart, Send, Plus, CheckCircle, AlertCircle, Loader, Camera, Video, Sparkles, Zap } from 'lucide-react';
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
  const [previewMediaKind, setPreviewMediaKind] = useState(null);

  const releasePreviewUrl = () => {
    if (previewUrl && previewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(previewUrl);
    }
  };

  const resetSelectedMedia = () => {
    releasePreviewUrl();
    setPreviewUrl(null);
    setFileToUpload(null);
    setPreviewMediaKind(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const getMediaKind = (file) => (file?.type?.startsWith('video') ? 'video' : 'image');

  // Camera access
  const startCamera = async () => {
    try {
      setError(null);
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'user'
        }
      });
      setStream(mediaStream);
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
        setTimeout(() => setIsCameraReady(true), 500);
      }
      setShowCamera(true);
    } catch (err) {
      setError('Unable to access camera. Please check permissions.');
      console.error('Camera error:', err);
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
          const capturedFile = new File([blob], `status-capture-${Date.now()}.jpg`, { type: 'image/jpeg' });
          const url = URL.createObjectURL(capturedFile);
          releasePreviewUrl();
          setPreviewUrl(url);
          setFileToUpload(capturedFile);
          setPreviewMediaKind('image');
          stopCamera();
        }
      }, 'image/jpeg', 0.95);
    }
  };

  // Cleanup camera on unmount
  useEffect(() => {
    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
      if (previewUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [stream, previewUrl]);

  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    const mediaKind = getMediaKind(file);
    const maxSizeMB = mediaKind === 'video' ? 100 : 20;
    const allowedTypes = [
      'image/jpeg',
      'image/png',
      'image/webp',
      'video/mp4',
      'video/quicktime',
      'video/webm'
    ];

    if (!allowedTypes.includes(file.type)) {
      setError('Unsupported file format. Use JPEG, PNG, WebP, MP4, MOV, or WebM.');
      return;
    }

    if (file.size > maxSizeMB * 1024 * 1024) {
      setError(`${mediaKind === 'video' ? 'Video' : 'Image'} is too large. Max ${maxSizeMB}MB.`);
      return;
    }

    // Preview (object URL supports both image and video)
    const nextPreviewUrl = URL.createObjectURL(file);
    releasePreviewUrl();
    setPreviewUrl(nextPreviewUrl);
    setPreviewMediaKind(mediaKind);
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
    if (!user?.id) {
      setError('Please sign in again before uploading a status.');
      return;
    }

    setIsUploading(true);
    setError(null);

    try {
      // Determine media type
      const mediaType = previewMediaKind || getMediaKind(fileToUpload);

      // Upload to storage
      const { url, error: uploadError } = await uploadStatusMedia(user.id, fileToUpload, {
        maxSizeMB: mediaType === 'video' ? 100 : 20,
        allowedTypes: [
          'image/jpeg',
          'image/png',
          'image/webp',
          'video/mp4',
          'video/quicktime',
          'video/webm'
        ]
      });
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
      setIsUploading(false);

      // Reset form
      resetSelectedMedia();
      setCaption('');
      setVisibility('public');

      onStatusCreated?.(status);
    } catch (err) {
      const message = String(err?.message || 'Upload failed');
      if (message.toLowerCase().includes('mime type')) {
        setError('Video upload is blocked by storage MIME policy. Please allow video/mp4, video/quicktime, and video/webm in Supabase bucket "user-content".');
      } else {
        setError(message);
      }
      console.error('Upload error:', err);
      setIsUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-gradient-to-br from-black/90 via-purple-900/50 to-black/90 backdrop-blur-xl flex items-center justify-center z-50 p-4">
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
          {showCamera && isCameraReady ? (
            <div className="relative rounded-2xl overflow-hidden bg-black aspect-video border-2 border-purple-500/30">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                className="w-full h-full object-cover"
              />
              <canvas ref={canvasRef} className="hidden" />
              
              {/* Camera Controls Overlay */}
              <div className="absolute inset-0 flex flex-col items-center justify-between p-4 bg-gradient-to-t from-black/60 via-transparent to-transparent">
                <div className="flex items-center gap-2 px-4 py-2 bg-white/10 rounded-full backdrop-blur-md border border-white/20">
                  <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></div>
                  <span className="text-white text-sm font-medium">Live Camera</span>
                </div>
                
                <div className="flex items-center gap-4">
                  <button
                    onClick={captureImage}
                    className="w-16 h-16 rounded-full bg-gradient-to-r from-white to-gray-100 hover:from-gray-50 hover:to-white text-black flex items-center justify-center transition-all transform hover:scale-110 shadow-2xl border-4 border-white"
                    title="Capture"
                  >
                    <Camera className="w-7 h-7" />
                  </button>
                  <button
                    onClick={stopCamera}
                    className="w-12 h-12 rounded-full bg-red-500/90 hover:bg-red-600 text-white flex items-center justify-center transition-all transform hover:scale-110 shadow-lg border-2 border-red-400"
                    title="Cancel"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </div>
          ) : previewUrl ? (
            <div className="relative rounded-2xl overflow-hidden bg-black aspect-video border-2 border-purple-500/30">
              {previewMediaKind === 'video' ? (
                <video
                  src={previewUrl}
                  controls
                  playsInline
                  className="w-full h-full object-contain bg-black"
                />
              ) : (
                <img
                  src={previewUrl}
                  alt="Preview"
                  className="w-full h-full object-cover"
                />
              )}
              <button
                onClick={resetSelectedMedia}
                className="absolute top-3 right-3 p-2 bg-black/60 hover:bg-black/80 rounded-full text-white transition-all transform hover:scale-110 border border-white/20"
              >
                <X className="w-4 h-4" />
              </button>
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
                  <p className="text-xs text-blue-200/70">JPEG/PNG/WebP up to 20MB, MP4/MOV/WebM up to 100MB</p>
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
              onClick={resetSelectedMedia}
              className="w-full px-4 py-2 text-gray-300 hover:text-white hover:bg-white/10 rounded-lg font-medium transition-all"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default StatusUploader;
