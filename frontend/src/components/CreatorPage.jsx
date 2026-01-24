import React, { useState } from 'react';
import { X, Camera, Smartphone, Download, Radio, Upload, CheckCircle, AlertCircle } from 'lucide-react';
import PitchVideoRecorder from './PitchVideoRecorder';
import PitchDetailsForm from './PitchDetailsForm';
import { createPitch, getSupabase } from '../services/pitchingService';

const CreatorPage = ({ onClose, onPitchCreated, selectedBusinessProfile, onNoProfileCreateProfile }) => {
  const [cameraMode, setCameraMode] = useState('front'); // 'front' or 'back'
  const [recordingMethod, setRecordingMethod] = useState('record'); // 'record' or 'upload'
  const [showDetailsForm, setShowDetailsForm] = useState(false);
  const [videoBlob, setVideoBlob] = useState(null); // Track video blob from recorder
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState(''); // 'uploading', 'processing', 'success', 'error'

  // Helper function to upload video with retry logic
  const uploadVideoWithRetry = async (sb, videoBlob, profileId, maxRetries = 2) => {
    let lastError = null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`📹 Upload attempt ${attempt}/${maxRetries}`);
        
        const timestamp = Date.now();
        const fileName = `${timestamp}_pitch-video-${timestamp}.webm`;
        
        console.log(`📤 Uploading: ${(videoBlob.size / 1024 / 1024).toFixed(2)}MB to pitches/${profileId}/${fileName}`);
        setUploadProgress(10 + (attempt * 20)); // Show progress
        
        const { data, error } = await sb.storage
          .from('pitches')
          .upload(`${profileId}/${fileName}`, videoBlob, {
            cacheControl: '3600',
            upsert: true,
            contentType: videoBlob.type || 'video/webm'
          });
        
        if (error) {
          lastError = error;
          console.error(`❌ Upload attempt ${attempt} failed:`, error.message);
          
          // Don't retry on permission errors
          if (error.message.includes('permission') || error.message.includes('Unauthorized')) {
            throw error;
          }
          
          // Wait before retrying
          if (attempt < maxRetries) {
            console.log(`⏳ Waiting 2 seconds before retry...`);
            await new Promise(resolve => setTimeout(resolve, 2000));
            continue;
          }
          throw error;
        }
        
        console.log('✅ Upload successful, generating signed URL...');
        setUploadProgress(70);
        
        // Get signed URL
        const { data: urlData, error: urlError } = await sb.storage
          .from('pitches')
          .createSignedUrl(`${profileId}/${fileName}`, 3600 * 24 * 365);
        
        if (urlError) {
          console.warn('⚠️ Could not generate signed URL, using public URL');
          const baseUrl = sb.storage.from('pitches').getPublicUrl(`${profileId}/${fileName}`);
          setUploadProgress(100);
          return baseUrl.data.publicUrl;
        }
        
        console.log('✅ Signed URL generated');
        setUploadProgress(100);
        return urlData.signedUrl;
        
      } catch (error) {
        lastError = error;
        if (attempt === maxRetries) {
          throw error;
        }
      }
    }
    
    throw lastError;
  };

  const handlePitchSubmit = async (formData) => {
    try {
      console.log('Pitch submitted:', formData);
      
      // Get current user
      const sb = getSupabase();
      if (!sb) {
        alert('Database not configured');
        return;
      }

      const { data: { user } } = await sb.auth.getUser();
      if (!user) {
        alert('Please login to create a pitch');
        return;
      }

      if (!selectedBusinessProfile) {
        // Trigger profile creation flow instead of just alerting
        if (onNoProfileCreateProfile) {
          onNoProfileCreateProfile();
        } else {
          alert('No business profile available. Please create a business profile first before creating a pitch.');
        }
        return;
      }

      // Create pitch in database with published status
      let videoUrl = null;
      
      // Upload video blob if present
      if (videoBlob) {
        try {
          const fileSizeMB = videoBlob.size / 1024 / 1024;
          console.log(`📹 Video upload starting: ${videoBlob.size} bytes (${fileSizeMB.toFixed(2)} MB)`);
          
          // Check file size - block if over 100MB
          const maxUploadMB = 100;
          if (fileSizeMB > maxUploadMB) {
            console.error(`❌ Video is ${fileSizeMB.toFixed(2)}MB, exceeds maximum ${maxUploadMB}MB`);
            alert(`❌ Video Too Large!\n\nYour video is ${fileSizeMB.toFixed(2)}MB but the maximum allowed is ${maxUploadMB}MB.\n\nPlease:\n1. Compress your video using tools like:\n   - HandBrake (free)\n   - ffmpeg (command line)\n   - Online compressors\n2. Reduce resolution or frame rate\n3. Try again with a smaller file\n\n💡 Tip: A 5-10 minute pitch video typically compresses to 20-50MB`);
            return;
          }
          
          // Warn if over 50MB
          if (fileSizeMB > 50) {
            console.warn(`⚠️ Warning: Video is ${fileSizeMB.toFixed(2)}MB, exceeds recommended 50MB. Upload will take several minutes.`);
          }
          
          setIsUploading(true);
          setUploadStatus('uploading');
          setUploadProgress(5);
          
          // Set timeout to show failure after 5 seconds if still uploading
          const uploadTimeoutId = setTimeout(() => {
            if (isUploading) {
              console.error('⏱️ Upload timeout after 5 seconds');
              setUploadStatus('error');
              setUploadProgress(0);
              
              // Auto-close after 3 seconds
              setTimeout(() => {
                setIsUploading(false);
              }, 3000);
            }
          }, 5000);
          
          // Use retry-enabled upload
          videoUrl = await uploadVideoWithRetry(sb, videoBlob, selectedBusinessProfile.id, 2);
          
          // Clear timeout if upload succeeded
          clearTimeout(uploadTimeoutId);
          
          console.log('✅ Video uploaded successfully:', videoUrl);
          setUploadStatus('processing');
          setUploadProgress(90);
          
        } catch (error) {
          console.error('❌ Final video upload error:', error);
          console.error('   Error details:', {
            message: error.message,
            status: error.status,
            statusText: error.statusText
          });
          
          setUploadStatus('error');
          setUploadProgress(0);
          
          // Don't show alert - just let the UI show failure message
          // Users can retry or try with smaller file
          console.error('Upload failed. User can retry or reduce file size.');
          setIsUploading(false);
          return;
        }
      }
      
      const newPitch = {
        business_profile_id: selectedBusinessProfile.id,
        title: formData.title || 'Untitled Pitch',
        description: formData.description || '',
        category: formData.category || 'Technology',
        pitch_type: formData.pitchType || 'Equity',
        target_funding: parseInt(formData.targetGoal) || 0,
        raised_amount: parseInt(formData.currentlyRaised) || 0,
        equity_offering: parseFloat(formData.equityOffering) || 0,
        video_url: videoUrl, // Use uploaded video URL
        has_ip: formData.hasIP || false,
        status: 'published', // Set to published immediately
        likes_count: 0,
        comments_count: 0,
        shares_count: 0,
        views_count: 0
      };

      console.log('Creating pitch:', newPitch);
      const result = await createPitch(newPitch);
      
      if (!result.success) {
        alert('Error creating pitch: ' + result.error);
        setIsUploading(false);
        return;
      }

      console.log('Pitch created successfully:', result.data);
      
      setUploadStatus('success');
      setUploadProgress(100);
      
      // Show success state for 2 seconds then close
      setTimeout(() => {
        setIsUploading(false);
        setUploadProgress(0);
        setUploadStatus('');
        setShowDetailsForm(false);
        if (onPitchCreated) {
          onPitchCreated(result.data);
        }
      }, 2000);
    } catch (error) {
      console.error('Error in handlePitchSubmit:', error);
      alert('Error creating pitch: ' + error.message);
      setIsUploading(false);
      setUploadStatus('error');
    }
  };

  return (
    <div className="fixed inset-0 w-screen h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 z-[9999] flex flex-col">
      {/* Header - Ultra Compact on Mobile */}
      <div className="flex-shrink-0 bg-slate-900/90 backdrop-blur-md border-b border-pink-500/30">
        <div className="w-full px-2 py-1 flex items-center justify-between gap-1">
          <button
            onClick={onClose}
            className="flex-shrink-0 p-1 hover:bg-white/10 rounded-lg transition"
          >
            <X className="w-4 h-4 text-white" />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="text-sm font-bold text-white truncate">Create Pitch</h1>
          </div>
          <div className="text-lg flex-shrink-0">🚀</div>
        </div>
      </div>

      {/* Camera & Recording Mode Selector - Compact Horizontal Bar */}
      <div className="flex-shrink-0 flex items-center justify-center gap-2 px-3 py-2 bg-slate-800/80 border-b border-pink-500/30">
        {/* Camera Selection */}
        <button
          onClick={() => setCameraMode('front')}
          title="Front Camera"
          className={`w-7 h-7 rounded-md flex items-center justify-center transition-all border-2 text-sm flex-shrink-0 ${
            cameraMode === 'front'
              ? 'border-pink-500 bg-pink-500/50 text-pink-200'
              : 'border-white/30 bg-white/10 text-gray-300 hover:border-pink-500/50'
          }`}
        >
          📱
        </button>
        <button
          onClick={() => setCameraMode('back')}
          title="Back Camera"
          className={`w-7 h-7 rounded-md flex items-center justify-center transition-all border-2 text-sm flex-shrink-0 ${
            cameraMode === 'back'
              ? 'border-purple-500 bg-purple-500/50 text-purple-200'
              : 'border-white/30 bg-white/10 text-gray-300 hover:border-purple-500/50'
          }`}
        >
          📸
        </button>

        {/* Separator */}
        <div className="w-px h-5 bg-white/20 flex-shrink-0"></div>

        {/* Recording Method Selection */}
        <button
          onClick={() => setRecordingMethod('record')}
          title="Record Live"
          className={`w-7 h-7 rounded-md flex items-center justify-center transition-all border-2 text-sm flex-shrink-0 ${
            recordingMethod === 'record'
              ? 'border-pink-500 bg-pink-500/50 text-pink-200'
              : 'border-white/30 bg-white/10 text-gray-300 hover:border-pink-500/50'
          }`}
        >
          🎥
        </button>
        <button
          onClick={() => setRecordingMethod('upload')}
          title="Upload Video"
          className={`w-7 h-7 rounded-md flex items-center justify-center transition-all border-2 text-sm flex-shrink-0 ${
            recordingMethod === 'upload'
              ? 'border-purple-500 bg-purple-500/50 text-purple-200'
              : 'border-white/30 bg-white/10 text-gray-300 hover:border-purple-500/50'
          }`}
        >
          📤
        </button>
      </div>

      {/* Recorder Component - Full remaining space */}
      <div className="flex-1 bg-slate-900 overflow-hidden border-t border-pink-500/30 flex flex-col relative">
        <PitchVideoRecorder 
          cameraMode={cameraMode}
          recordingMethod={recordingMethod}
          hideControls={true}
          onPitchCreated={onPitchCreated}
          onClose={onClose}
          onVideoRecorded={setVideoBlob}
        />
        
        {/* Submit Button - Floating on Video */}
        <button
          onClick={() => {
            if (!videoBlob) {
              alert('Please record or upload a video before submitting your pitch.');
              return;
            }
            setShowDetailsForm(true);
          }}
          disabled={!videoBlob}
          className={`absolute bottom-4 right-4 px-4 py-2 rounded-lg transition flex items-center gap-2 shadow-lg font-bold ${
            videoBlob 
              ? 'bg-gradient-to-r from-pink-500 to-purple-500 hover:from-pink-600 hover:to-purple-600 text-white cursor-pointer'
              : 'bg-gray-500 text-gray-300 cursor-not-allowed opacity-50'
          }`}
        >
          <span>🚀</span>
          <span className="hidden sm:inline">Submit</span>
        </button>
      </div>

      {/* Pitch Details Form - Dropdown Modal */}
      <PitchDetailsForm 
        isOpen={showDetailsForm}
        onClose={() => setShowDetailsForm(false)}
        onSubmit={handlePitchSubmit}
      />

      {/* Animated Upload Progress UI - Minimal */}
      {isUploading && (
        <div className="fixed inset-0 z-[99999] flex items-center justify-center pointer-events-none">
          <div className="relative w-28 h-28">
            {uploadStatus === 'error' ? (
              <>
                {/* Error State */}
                <svg className="w-full h-full" viewBox="0 0 100 100">
                  <circle cx="50" cy="50" r="40" fill="none" stroke="#ef4444" strokeWidth="2" opacity="0.3" />
                  <text x="50" y="55" textAnchor="middle" className="text-2xl fill-red-500 font-bold" fontSize="40">
                    ✕
                  </text>
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="text-center">
                    <div className="text-xs font-bold bg-gradient-to-r from-red-400 to-red-600 bg-clip-text text-transparent">
                      Loading<br/>Failed
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <>
                {/* Loading State */}
                <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
                  {/* Background circle */}
                  <circle
                    cx="50"
                    cy="50"
                    r="40"
                    fill="none"
                    stroke="#ffffff"
                    strokeWidth="1.5"
                    opacity="0.15"
                  />
                  {/* Progress circle */}
                  <circle
                    cx="50"
                    cy="50"
                    r="40"
                    fill="none"
                    stroke="url(#progressGradient)"
                    strokeWidth="2.5"
                    strokeDasharray={`${2.51 * uploadProgress} 251`}
                    strokeLinecap="round"
                    className="transition-all duration-500"
                  />
                  <defs>
                    <linearGradient id="progressGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#ec4899" />
                      <stop offset="100%" stopColor="#a855f7" />
                    </linearGradient>
                  </defs>
                </svg>
                {/* Percentage text */}
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-lg font-bold bg-gradient-to-r from-pink-400 to-purple-400 bg-clip-text text-transparent">
                    {uploadProgress}%
                  </span>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default CreatorPage;
