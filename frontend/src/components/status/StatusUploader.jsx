/**
 * StatusUploader Component
 * WhatsApp-style status upload interface
 * Upload new media or share existing pitches as status
 */

import React, { useState, useRef, useEffect } from 'react';
import { Upload, X, Eye, EyeOff, Heart, Send, Plus, CheckCircle, Loader, Video, Image as ImageIcon } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { uploadStatusMedia, createStatus } from '../../services/statusService';
import { getUserPitches } from '../../services/pitchingService';
import { VideoClipper } from './VideoClipper';
import { MediaQualitySelector } from './MediaQualitySelector';
import { shouldCompress } from '../../services/mediaOptimizationService';

export const StatusUploader = ({ onStatusCreated = null, onClose = null }) => {
  const { user, profile } = useAuth();
  const [isUploading, setIsUploading] = useState(false);
  const [showQualitySelector, setShowQualitySelector] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [caption, setCaption] = useState('');
  const [visibility, setVisibility] = useState('public');
  const [backgroundColor, setBackgroundColor] = useState('#667eea');
  const [error, setError] = useState(null);
  const [showVideoClipper, setShowVideoClipper] = useState(false);
  const [activeTab, setActiveTab] = useState('upload'); // 'upload' or 'pitches'
  const [myPitches, setMyPitches] = useState([]);
  const [selectedPitch, setSelectedPitch] = useState(null);
  const [loadingPitches, setLoadingPitches] = useState(false);
  const fileInputRef = useRef(null);

  // Load user's pitches when tab changes
  useEffect(() => {
    if (activeTab === 'pitches' && user?.id) {
      loadPitches();
    }
  }, [activeTab, user?.id]);

  const loadPitches = async () => {
    try {
      setLoadingPitches(true);
      const pitches = await getUserPitches(user.id);
      setMyPitches(pitches || []);
    } catch (error) {
      console.error('Failed to load pitches:', error);
      setError('Could not load your pitches');
    } finally {
      setLoadingPitches(false);
    }
  };

  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);

    // If it's a video, show the clipper first
    if (file.type.startsWith('video')) {
      setFileToUpload(file);
      setShowVideoClipper(true);
      return;
    }

    // For images, check if compression is needed
    if (shouldCompress(file, 25)) {
      setFileToUpload(file);
      setShowQualitySelector(true);
      return;
    }

    // Small image - proceed directly
    const reader = new FileReader();
    reader.onload = (event) => {
      setPreviewUrl(event.target?.result);
    };
    reader.readAsDataURL(file);

    setFileToUpload(file);
  };

  const [fileToUpload, setFileToUpload] = useState(null);

  const handleVideoClip = (clipData) => {
    // User clipped the video, now use the clipped blob for upload
    setShowVideoClipper(false);
    setFileToUpload(clipData.blob);

    // Create preview URL for clipped video
    const reader = new FileReader();
    reader.onload = (event) => {
      setPreviewUrl(event.target?.result);
    };
    reader.readAsDataURL(clipData.blob);
  };

  const handleQualitySelected = (qualityData) => {
    // User selected quality preference
    setShowQualitySelector(false);

    // Create preview from compressed data
    const reader = new FileReader();
    reader.onload = (event) => {
      setPreviewUrl(event.target?.result);
    };
    reader.readAsDataURL(fileToUpload);

    // Store quality preference
    window.selectedQuality = qualityData.quality;
  };

  useEffect(() => {
    if (uploadSuccess) {
      const timer = setTimeout(() => {
        onClose?.();
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [uploadSuccess, onClose]);

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

  const sharePitchAsStatus = async () => {
    if (!selectedPitch) {
      setError('Please select a pitch');
      return;
    }

    setIsUploading(true);
    setError(null);

    try {
      // Create status using pitch video
      const { status, error: createError } = await createStatus(user.id, {
        media_type: 'video',
        media_url: selectedPitch.video_url,
        caption: caption.trim() || `Check out my pitch: ${selectedPitch.title}`,
        visibility: 'public',
        background_color: backgroundColor
      });

      if (createError) throw createError;

      setUploadProgress(100);
      setUploadSuccess(true);
      setCaption('');
      setSelectedPitch(null);

      console.log('Pitch shared as status:', status);
      onStatusCreated?.(status);
    } catch (err) {
      setError(err.message || 'Failed to share pitch as status');
      console.error('Share pitch error:', err);
      setIsUploading(false);
    }
  };

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

      setUploadProgress(100);
      setUploadSuccess(true);

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
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden shadow-2xl relative">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-700 flex-shrink-0">
          <h2 className="text-lg font-bold text-white">New Status</h2>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-0 border-b border-slate-700 px-4 flex-shrink-0 bg-slate-800">
          <button
            onClick={() => setActiveTab('upload')}
            className={`flex-1 py-3 px-4 text-sm font-semibold transition-all border-b-2 ${
              activeTab === 'upload'
                ? 'border-purple-500 text-white'
                : 'border-transparent text-gray-400 hover:text-white'
            }`}
          >
            <Upload className="w-4 h-4 inline mr-2" />
            Upload
          </button>
          <button
            onClick={() => setActiveTab('pitches')}
            className={`flex-1 py-3 px-4 text-sm font-semibold transition-all border-b-2 ${
              activeTab === 'pitches'
                ? 'border-purple-500 text-white'
                : 'border-transparent text-gray-400 hover:text-white'
            }`}
          >
            <Video className="w-4 h-4 inline mr-2" />
            My Pitches
          </button>
        </div>

        {/* Content - Scrollable */}
        <div className="p-6 space-y-4 overflow-y-auto flex-1 pr-8">
          {activeTab === 'upload' ? (
            <>
              {/* UPLOAD TAB */}
          {previewUrl ? (
            <div className="relative rounded-xl overflow-hidden bg-black aspect-video">
              <img
                src={previewUrl}
                alt="Preview"
                className="w-full h-full object-cover"
              />
              <button
                onClick={() => {
                  setPreviewUrl(null);
                  setFileToUpload(null);
                }}
                className="absolute top-2 right-2 p-2 bg-black/50 hover:bg-black/70 rounded-full text-white transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-slate-600 rounded-xl p-8 text-center cursor-pointer hover:border-purple-500 hover:bg-purple-500/5 transition-all"
            >
              <Upload className="w-8 h-8 text-slate-400 mx-auto mb-2" />
              <p className="text-sm text-gray-400">Click to upload image or video</p>
              <p className="text-xs text-gray-500 mt-1">Max 10MB • JPEG, PNG, WebP, MP4</p>
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
                <label className="text-xs text-gray-400 block mb-2">Caption (optional)</label>
                <textarea
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  placeholder="Add a caption..."
                  maxLength={500}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-gray-500 text-sm resize-none"
                  rows={3}
                />
                <p className="text-xs text-gray-500 mt-1">{caption.length}/500</p>
              </div>

              {/* Visibility */}
              <div>
                <label className="text-xs text-gray-400 block mb-2">Who can see?</label>
                <select
                  value={visibility}
                  onChange={(e) => setVisibility(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm"
                >
                  <option value="public">Everyone</option>
                  <option value="followers">Followers Only</option>
                  <option value="private">Only Me</option>
                </select>
              </div>

              {/* Background Color (for text-only statuses) */}
              <div>
                <label className="text-xs text-gray-400 block mb-2">Background Color</label>
                <div className="flex gap-2">
                  {['#667eea', '#f093fb', '#4facfe', '#00f2fe', '#43e97b', '#fa709a'].map((color) => (
                    <button
                      key={color}
                      onClick={() => setBackgroundColor(color)}
                      className={`w-10 h-10 rounded-lg transition-all ${
                        backgroundColor === color
                          ? 'ring-2 ring-white scale-110'
                          : 'ring-1 ring-slate-700 hover:ring-slate-600'
                      }`}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                  <button
                    onClick={() => {
                      const customColor = prompt('Enter color code (e.g., #FF5733):');
                      if (customColor) setBackgroundColor(customColor);
                    }}
                    className="w-10 h-10 rounded-lg border-2 border-red-500 flex items-center justify-center text-red-500 hover:bg-red-500/10 transition-all font-bold text-sm"
                    title="Add custom color"
                  >
                    <Plus className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </>
          )}

            </>
          ) : (
            <>
              {/* PITCHES TAB */}
              {loadingPitches ? (
                <div className="flex items-center justify-center py-12">
                  <Loader className="w-6 h-6 text-purple-500 animate-spin" />
                  <span className="ml-2 text-gray-400">Loading your pitches...</span>
                </div>
              ) : myPitches.length === 0 ? (
                <div className="text-center py-12">
                  <Video className="w-12 h-12 text-gray-600 mx-auto mb-3" />
                  <p className="text-gray-400 font-medium">No pitches yet</p>
                  <p className="text-gray-500 text-sm mt-1">Create a pitch in the Pitchin section first</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {myPitches.map((pitch) => (
                    <button
                      key={pitch.id}
                      onClick={() => {
                        setSelectedPitch(pitch);
                        setCaption(pitch.caption || `Check out my pitch: ${pitch.title}`);
                      }}
                      className={`w-full p-3 rounded-lg border transition-all text-left ${
                        selectedPitch?.id === pitch.id
                          ? 'border-purple-500 bg-purple-500/20'
                          : 'border-slate-700 bg-slate-800 hover:border-slate-600'
                      }`}
                    >
                      <div className="flex gap-3">
                        {pitch.thumbnail_url && (
                          <img
                            src={pitch.thumbnail_url}
                            alt={pitch.title}
                            className="w-16 h-16 rounded-lg object-cover flex-shrink-0"
                          />
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-white truncate">{pitch.title}</p>
                          <p className="text-xs text-gray-400 truncate mt-1">{pitch.description}</p>
                          {pitch.video_url && (
                            <p className="text-xs text-purple-400 mt-2">✓ Video ready</p>
                          )}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {selectedPitch && (
                <div className="mt-4">
                  <label className="text-xs text-gray-400 block mb-2">Caption (optional)</label>
                  <textarea
                    value={caption}
                    onChange={(e) => setCaption(e.target.value)}
                    placeholder="Add a caption..."
                    maxLength={500}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-gray-500 text-sm resize-none"
                    rows={3}
                  />
                  <p className="text-xs text-gray-500 mt-1">{caption.length}/500</p>
                </div>
              )}
            </>
          )}

          {/* Error message */}
          {error && (
            <div className="p-3 bg-red-500/20 border border-red-500/50 rounded-lg text-red-200 text-sm flex items-center gap-2">
              <X className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          {/* Upload Progress */}
          {isUploading && (
            <div className="space-y-3 p-4 bg-purple-500/10 border border-purple-500/30 rounded-lg">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-purple-200">Uploading status...</span>
                <span className="text-sm text-purple-300">{Math.round(uploadProgress)}%</span>
              </div>
              <div className="w-full h-2 bg-slate-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all duration-300"
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
                <p className="font-medium text-green-200">Status uploaded successfully!</p>
                <p className="text-sm text-green-300">Closing in a moment...</p>
              </div>
            </div>
          )}
        </div>

        {/* Floating Submit Button */}
        {fileToUpload && !uploadSuccess && (
          <button
            onClick={activeTab === 'upload' ? handleUpload : sharePitchAsStatus}
            disabled={isUploading || (activeTab === 'upload' && !fileToUpload) || (activeTab === 'pitches' && !selectedPitch)}
            className={`absolute bottom-20 right-6 w-16 h-16 rounded-full flex items-center justify-center transition-all shadow-2xl hover:scale-110 disabled:scale-95 z-10 ${ isUploading ? 'bg-gradient-to-r from-purple-600 to-pink-600 animate-pulse' : 'bg-purple-600 hover:bg-purple-700'} text-white`}
            title={isUploading ? 'Uploading...' : 'Post Status'}
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
          <div className="p-4 border-t border-slate-700 flex-shrink-0">
            <button
              onClick={() => {
                setPreviewUrl(null);
                setFileToUpload(null);
              }}
              className="w-full px-4 py-2 text-gray-300 hover:bg-white/10 rounded-lg font-medium transition-colors"
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      {/* Video Clipper Modal */}
      {showVideoClipper && fileToUpload && fileToUpload.type.startsWith('video') && (
        <VideoClipper
          videoFile={fileToUpload}
          onClip={handleVideoClip}
          onCancel={() => {
            setShowVideoClipper(false);
            setFileToUpload(null);
            setPreviewUrl(null);
          }}
        />
      )}

      {/* Media Quality Selector */}
      {showQualitySelector && fileToUpload && fileToUpload.type.startsWith('image') && (
        <MediaQualitySelector
          file={fileToUpload}
          onQualitySelected={handleQualitySelected}
          onCancel={() => {
            setShowQualitySelector(false);
            setFileToUpload(null);
            setPreviewUrl(null);
          }}
        />
      )}
    </div>
  );
};

export default StatusUploader;
