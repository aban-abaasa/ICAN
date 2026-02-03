import React, { useState, useRef, useEffect } from 'react';
import { Camera, Mic, Square, Play, Upload, X, RotateCcw, Pin, Maximize, Minimize, Smartphone, Scissors, CheckCircle, SwitchCamera, Sparkles, ArrowLeft, Rocket } from 'lucide-react';
import { uploadVideo, getSupabase } from '../services/pitchingService';
import { VideoClipper } from './status/VideoClipper';
import BusinessProfileDocuments from './BusinessProfileDocuments';
import PitchDetailsForm from './PitchDetailsForm';

const PitchVideoRecorder = ({ cameraMode = 'front', recordingMethod = 'record', onPitchCreated, onClose, hideControls = false, onVideoRecorded, currentBusinessProfile }) => {
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
  const [showTrimDialog, setShowTrimDialog] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [documentsComplete, setDocumentsComplete] = useState(false); // Track document completion
  const [workflowPhase, setWorkflowPhase] = useState('documents'); // 'documents', 'video-details', 'ready'
  const [completedDocumentsData, setCompletedDocumentsData] = useState(null); // Store completed document data
  const [showPitchDetailsForm, setShowPitchDetailsForm] = useState(false); // Control PitchDetailsForm visibility
  const [workflowStatus, setWorkflowStatus] = useState(''); // Show workflow status messages
  
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
          facingMode: facingMode,
          aspectRatio: { ideal: 9/16 }
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
        
        // Set canvas dimensions to match actual video track settings
        // This will be updated once we get the actual video dimensions
        canvas.width = 1080;
        canvas.height = 1920;
        console.log('Canvas dimensions set to:', canvas.width, 'x', canvas.height, '(9:16 portrait)');
        
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          
          // Draw video frames to canvas
          const drawFrame = () => {
            // Clear canvas first
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            
            // Draw video maintaining aspect ratio (contain fit)
            try {
              if (videoRef.current && videoRef.current.readyState >= 2) {
                const videoWidth = videoRef.current.videoWidth;
                const videoHeight = videoRef.current.videoHeight;
                
                if (videoWidth && videoHeight) {
                  // Update canvas to match video dimensions for 1:1 quality
                  if (canvas.width !== videoWidth || canvas.height !== videoHeight) {
                    canvas.width = videoWidth;
                    canvas.height = videoHeight;
                    console.log('Canvas resized to video dimensions:', videoWidth, 'x', videoHeight);
                  }
                  
                  // Draw video at full size without distortion
                  ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
                }
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
        console.log('Preview URL is valid:', url && url.startsWith('blob:'));
        setVideoBlob(blob);
        setPreviewUrl(url);
        setRecordedChunks(chunks);
        setShowReview(true); // Show review dialog for recorded videos
        console.log('Review mode enabled, previewUrl:', url);
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
      // Validate file size - maximum 100MB
      const maxUploadMB = 100;
      const fileSizeMB = file.size / 1024 / 1024;
      
      if (fileSizeMB > maxUploadMB) {
        console.error(`❌ Video is ${fileSizeMB.toFixed(2)}MB, exceeds maximum ${maxUploadMB}MB`);
        alert(`❌ Video Too Large!\n\nYour video is ${fileSizeMB.toFixed(2)}MB but the maximum allowed is ${maxUploadMB}MB.\n\nPlease:\n1. Compress your video using tools like:\n   - HandBrake (free)\n   - ffmpeg (command line)\n   - Online compressors\n2. Reduce resolution or frame rate\n3. Try again with a smaller file\n\n💡 Tip: A 5-10 minute pitch video typically compresses to 20-50MB`);
        return;
      }
      
      // Warn if over 50MB
      if (fileSizeMB > 50) {
        console.warn(`⚠️ Warning: Video is ${fileSizeMB.toFixed(2)}MB, exceeds recommended 50MB. Upload will take several minutes.`);
      }
      
      // Show trim dialog for uploaded videos
      if (file.type.startsWith('video')) {
        setVideoBlob(file);
        setShowTrimDialog(true);
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
  
  const handleSkipTrim = () => {
    // User chose to skip trimming - use video as is
    setShowTrimDialog(false);
    if (videoBlob) {
      const url = URL.createObjectURL(videoBlob);
      setPreviewUrl(url);
      setRecordedChunks([videoBlob]);
      
      if (onVideoRecorded) {
        onVideoRecorded(videoBlob);
      }
    }
  };
  
  const handleOpenTrimmer = () => {
    // User chose to trim the video
    setShowTrimDialog(false);
    setShowVideoClipper(true);
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

  // Direct video submission after documents are completed - bypasses PitchDetailsForm
  const handleDirectVideoSubmit = async (documentsData, businessProfile) => {
    console.log('🚀 Starting direct video submission...');
    console.log('📊 Documents data:', documentsData);
    console.log('🏢 Business profile:', businessProfile);
    console.log('🎥 Video blob:', videoBlob ? `${videoBlob.size} bytes` : 'missing');
    
    if (!videoBlob) {
      throw new Error('No video blob found');
    }
    
    if (!businessProfile) {
      throw new Error('No business profile found');
    }

    // Auto-populate form fields from completed documents data and business profile
    const autoFormData = {
      title: businessProfile.business_name 
        ? `${businessProfile.business_name} Investment Pitch` 
        : 'Investment Pitch',
      description: documentsData.value_proposition_wants 
        ? documentsData.value_proposition_wants.length > 200 
          ? `${documentsData.value_proposition_wants.substring(0, 200)}...`
          : documentsData.value_proposition_wants
        : businessProfile.business_description || 'Investment opportunity pitch',
      creator: businessProfile.contact_person || businessProfile.business_name || 'Entrepreneur',
      category: businessProfile.business_type || 'Technology',
      raised: '$0',
      goal: documentsData.financial_projection_content?.includes('$') 
        ? documentsData.financial_projection_content.match(/\$[\d,]+/)?.[0] || '$500K'
        : '$500K',
      equity: documentsData.share_allocation_shares 
        ? `${documentsData.share_allocation_shares}%` 
        : '10%',
      pitchType: 'Equity',
      hasIP: documentsData.business_plan_content?.toLowerCase().includes('intellectual property') || false,
      members: []
    };

    console.log('📝 Auto-populated form data:', autoFormData);
    
    // Update the workflow status
    setWorkflowStatus('🚀 Uploading your pitch video...');
    
    // Call the submission function
    await handleSubmitWithAutoData(autoFormData);
  };

  // Handle pitch details form submission - this will trigger video upload
  const handlePitchDetailsSubmit = async (businessProfile) => {
    if (!videoBlob || !completedDocumentsData) {
      console.error('❌ Missing video or documents data');
      return;
    }

    try {
      setIsSubmitting(true);
      setSubmitError(null);

      // Auto-populate form fields from completed documents data and business profile
      const autoFormData = {
        title: completedDocumentsData.business_plan_content 
          ? `${businessProfile.business_name || 'Business'} Pitch` 
          : formData.title || `${businessProfile.business_name || 'Business'} Pitch`,
        description: completedDocumentsData.value_proposition_wants 
          ? `${completedDocumentsData.value_proposition_wants.substring(0, 200)}...` 
          : formData.description || 'Investment opportunity pitch',
        creator: businessProfile.contact_person || formData.creator || 'Entrepreneur',
        category: businessProfile.business_type || formData.category || 'Technology',
        raised: formData.raised,
        goal: formData.goal,
        equity: formData.equity,
        pitchType: formData.pitchType,
        hasIP: formData.hasIP,
        members: formData.members
      };

      // Update form data with auto-populated values
      setFormData(autoFormData);

      // Use the completed documents data and trigger the main submit
      console.log('🚀 Auto-submitting pitch with completed documents and video');
      console.log('📊 Documents data:', completedDocumentsData);
      console.log('🎥 Video blob size:', videoBlob.size);
      console.log('📝 Auto-populated form:', autoFormData);

      // Set workflow to ready
      setWorkflowPhase('ready');
      
      // Update status
      setWorkflowStatus('📤 Preparing video for upload...');
      
      // Close the pitch details form
      setShowPitchDetailsForm(false);
      
      // Small delay to ensure form data is updated, then submit
      setTimeout(async () => {
        try {
          setWorkflowStatus('🚀 Uploading your pitch video...');
          await handleSubmitWithAutoData(autoFormData);
        } catch (error) {
          console.error('❌ Error in delayed submission:', error);
          setSubmitError(error.message);
          setWorkflowStatus('❌ Upload failed. Please try again.');
          setIsSubmitting(false);
        }
      }, 100);
      
    } catch (error) {
      console.error('❌ Error in pitch details submission:', error);
      setSubmitError(error.message);
      setIsSubmitting(false);
    }
  };

  // Original handleSubmit - now calls handleSubmitWithAutoData
  const handleSubmit = async () => {
    await handleSubmitWithAutoData(formData);
  };

  // Core submission logic
  const handleSubmitWithAutoData = async (submitFormData) => {
    if (!videoBlob || !submitFormData.title || !submitFormData.description || !submitFormData.creator) {
      const missingFields = [];
      if (!videoBlob) missingFields.push('video');
      if (!submitFormData.title) missingFields.push('title');
      if (!submitFormData.description) missingFields.push('description');
      if (!submitFormData.creator) missingFields.push('creator name');
      setSubmitError(`Missing required fields: ${missingFields.join(', ')}`);
      return;
    }

    try {
      setIsSubmitting(true);
      setSubmitError(null);

      console.log('📤 Starting video submission with data:', {
        title: submitFormData.title,
        description: submitFormData.description,
        creator: submitFormData.creator,
        hasVideo: !!videoBlob,
        hasDocuments: !!completedDocumentsData
      });

      // Check if documents are saved to Supabase BEFORE allowing video submission
      // Skip validation if we already have completed documents data from the workflow
      if (currentBusinessProfile && !completedDocumentsData) {
        try {
          const supabase = getSupabase();
          if (supabase) {
            const { data: docs, error } = await supabase
              .from('business_documents')
              .select('*')
              .eq('business_profile_id', currentBusinessProfile.id)
              .single();

            if (error || !docs) {
              // No documents found in database
              setSubmitError('❌ Documents not saved. Please save all business documents before publishing your pitch.\n\nGo to Business Profile → Documents → Fill all fields → Save Documents');
              setIsSubmitting(false);
              return;
            }

            // Check if all required fields are filled in the saved documents
            const allDocumentsComplete = 
              docs.business_plan_content?.trim() &&
              docs.financial_projection_content?.trim() &&
              docs.value_proposition_wants?.trim() &&
              docs.value_proposition_fears?.trim() &&
              docs.value_proposition_needs?.trim() &&
              docs.mou_content?.trim() &&
              docs.share_allocation_shares &&
              docs.share_allocation_share_price;

            if (!allDocumentsComplete) {
              setSubmitError('❌ Incomplete documents. All document fields must be filled and saved before publishing.\n\nPlease complete: Business Plan, Financial Projection, Value Proposition, MOU, and Share Allocation.');
              setIsSubmitting(false);
              return;
            }

            // Check that all documents are marked as completed
            const allMarkedComplete = 
              docs.business_plan_completed &&
              docs.financial_projection_completed &&
              docs.value_proposition_completed &&
              docs.mou_completed &&
              docs.share_allocation_completed &&
              docs.all_documents_completed === true;

            if (!allMarkedComplete) {
              setSubmitError('❌ Documents not marked complete. Please ensure all document checkboxes are checked and click "Save Documents".');
              setIsSubmitting(false);
              return;
            }
          }
        } catch (docError) {
          console.warn('Error checking documents:', docError?.message);
          // Continue with submission even if document check fails (demo mode)
        }
      }

      console.log('🚀 Submitting pitch with data:', {
        title: submitFormData.title,
        creator: submitFormData.creator,
        videoBlob: videoBlob ? `${videoBlob.size} bytes` : 'missing'
      });

      const pitchData = {
        ...submitFormData,
        videoBlob: videoBlob,
        category: submitFormData.category,
        timestamp: 'just now'
      };

      console.log('📤 Calling onPitchCreated...');
      if (!onPitchCreated) {
        throw new Error('onPitchCreated callback is not defined');
      }
      
      await onPitchCreated(pitchData);
      
      console.log('✅ Pitch created successfully');
      setWorkflowStatus('✅ Pitch uploaded successfully! 🎉');
      setSubmitSuccess(true);
      
      // Clear status after 4 seconds
      setTimeout(() => {
        setWorkflowStatus('');
      }, 4000);
      
      // Show success message for 3 seconds then close
      setTimeout(() => {
        setSubmitSuccess(false);
        // Reset form
        setFormData({
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
        setVideoBlob(null);
        setPreviewUrl(null);
        // Close the recorder
        if (onClose) {
          onClose();
        }
      }, 3000);
    } catch (error) {
      console.error('❌ Error submitting pitch:', error);
      setSubmitError(error.message || 'Failed to create pitch. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="w-full h-screen md:h-full px-0 relative flex flex-col bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      {/* Enhanced Header Section - COMMENTED OUT */}
      {/* 
      <div className="hidden md:block bg-gradient-to-r from-purple-900/80 via-pink-900/60 to-purple-900/80 backdrop-blur-sm border-b border-purple-500/20 px-8 py-8 space-y-6">
        {/* Mode Tabs / Icons Row */}
        {/* 
        <div className="flex items-center justify-between">
          <div className="flex gap-3">
            <button className="w-12 h-12 rounded-lg bg-pink-500 text-white flex items-center justify-center hover:bg-pink-600 transition font-semibold text-lg">📱</button>
            <button className="w-12 h-12 rounded-lg bg-slate-700/50 text-slate-300 flex items-center justify-center hover:bg-slate-700 transition font-semibold text-lg">📸</button>
            <button className="w-12 h-12 rounded-lg bg-slate-700/50 text-slate-300 flex items-center justify-center hover:bg-slate-700 transition font-semibold text-lg">🎥</button>
            <button className="w-12 h-12 rounded-lg bg-slate-700/50 text-slate-300 flex items-center justify-center hover:bg-slate-700 transition font-semibold text-lg">📤</button>
            <button className="w-12 h-12 rounded-lg bg-slate-700/50 text-slate-300 flex items-center justify-center hover:bg-slate-700 transition font-semibold text-lg">🎬</button>
          </div>
          <div className="text-white/60 text-sm">Pitch Recorder v1.0</div>
        </div>

        {/* Main Title Section */}
        {/* 
        <div className="space-y-4">
          <div className="flex items-start gap-4">
            <div className="text-5xl md:text-6xl">🎬</div>
            <div className="flex-1">
              <h1 className="text-4xl md:text-5xl font-black bg-gradient-to-r from-pink-200 via-purple-200 to-pink-200 bg-clip-text text-transparent leading-tight">
                Create Your Pitch
              </h1>
              <p className="text-lg text-purple-200 mt-2">Share your vision, connect with investors</p>
            </div>
          </div>

          {/* Description */}
        {/*
          <p className="text-slate-200 text-base leading-relaxed max-w-2xl">
            Record or upload a compelling pitch video (up to 3 minutes). Tell your story, showcase your passion, and let your vision shine! 🚀
          </p>

          {/* Quick Stats */}
        {/*
          <div className="flex gap-6 pt-4 border-t border-purple-500/20">
            <div className="space-y-1">
              <p className="text-slate-400 text-sm">Max Duration</p>
              <p className="text-white font-bold text-lg">3 Minutes</p>
            </div>
            <div className="space-y-1">
              <p className="text-slate-400 text-sm">Supported Formats</p>
              <p className="text-white font-bold text-lg">MP4, WebM</p>
            </div>
            <div className="space-y-1">
              <p className="text-slate-400 text-sm">File Size Limit</p>
              <p className="text-white font-bold text-lg">500 MB</p>
            </div>
          </div>
        </div>
      </div>
      */}

      {/* Mobile Header - Removed for full screen */}

      <div className="bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 rounded-none p-0 border-0 h-full flex flex-col overflow-hidden flex-1 space-y-4">

        {/* Video Container - Full screen */}
        <div ref={fullscreenRef} className="flex-1 relative w-full h-full bg-black overflow-hidden">
          
          {/* Workflow Status Indicator */}
          {workflowStatus && (
            <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-50 bg-green-600/90 backdrop-blur-md text-white px-4 py-2 rounded-full flex items-center gap-2 shadow-lg animate-pulse">
              <div className="w-2 h-2 bg-white rounded-full animate-pulse"></div>
              <span className="text-sm font-medium">{workflowStatus}</span>
            </div>
          )}
          
          <div style={{
            backgroundColor: '#000',
            position: 'relative',
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden'
          }}>
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
                    backgroundColor: '#000',
                    objectFit: 'cover'
                  }}
                />

              </>
            ) : (
              <>
                <video
                  key={previewUrl}
                  src={previewUrl}
                  controls
                  autoPlay
                  playsInline
                  className="object-cover md:object-contain"
                  style={{
                    width: '100%',
                    height: '100%',
                    backgroundColor: '#000',
                    display: 'block'
                  }}
                  onLoadedMetadata={(e) => {
                    console.log('Video loaded:', e.target.videoWidth, e.target.videoHeight);
                  }}
                  onError={(e) => {
                    console.error('Video load error:', e);
                  }}
                />
              </>
            )}

            {/* Top Controls Row - Clean & Creative - Responsive for Portrait/Landscape */}
            <div className="absolute portrait:top-4 landscape:top-2 portrait:left-4 landscape:left-2 portrait:right-4 landscape:right-2 flex items-center justify-between z-40">
              {/* Left Side - Back Button + Recording/Upload Controls - Responsive */}
              <div className="flex portrait:flex-col landscape:flex-row gap-2 items-center">
                {/* Back to Pitches Button */}
                {onClose && (
                  <button
                    onClick={onClose}
                    className="flex items-center gap-1.5 portrait:px-2 portrait:py-1.5 landscape:px-3 landscape:py-2 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-md border-2 border-white/20 hover:scale-105 active:scale-95 text-white portrait:text-xs landscape:text-sm font-medium transition-all shadow-xl"
                  >
                    <ArrowLeft className="portrait:w-3 portrait:h-3 landscape:w-4 landscape:h-4" />
                    <span className="hidden sm:inline">Back</span>
                  </button>
                )}

                {!previewUrl ? (
                  <>
                    {/* Start Recording Button */}
                    <button
                      onClick={startRecording}
                      disabled={isRecording}
                      className="portrait:w-12 portrait:h-12 landscape:w-14 landscape:h-14 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-md border-2 border-white/20 hover:scale-110 active:scale-95 disabled:opacity-50 text-white flex items-center justify-center transition-all shadow-xl"
                    >
                      <Camera className="portrait:w-5 portrait:h-5 landscape:w-6 landscape:h-6" />
                      {isRecording && (
                        <span className="absolute inset-0 rounded-full border-2 border-white animate-pulse" />
                      )}
                    </button>

                    {/* Stop Recording Button */}
                    {isRecording && (
                      <button
                        onClick={stopRecording}
                        className="portrait:w-12 portrait:h-12 landscape:w-14 landscape:h-14 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-md border-2 border-white/20 hover:scale-110 active:scale-95 text-white flex items-center justify-center transition-all shadow-xl"
                      >
                        <Square className="portrait:w-5 portrait:h-5 landscape:w-6 landscape:h-6 fill-white" />
                      </button>
                    )}

                    {/* Upload Video Button */}
                    <label className="portrait:w-12 portrait:h-12 landscape:w-14 landscape:h-14 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-md border-2 border-white/20 hover:scale-110 active:scale-95 text-white flex items-center justify-center transition-all cursor-pointer shadow-xl">
                      <Upload className="portrait:w-5 portrait:h-5 landscape:w-6 landscape:h-6" />
                      <input
                        type="file"
                        accept="video/*"
                        onChange={handleUploadVideo}
                        className="hidden"
                      />
                    </label>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => setShowVideoClipper(true)}
                      className="portrait:w-12 portrait:h-12 landscape:w-14 landscape:h-14 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-md border-2 border-white/20 hover:scale-110 active:scale-95 text-white flex items-center justify-center transition-all shadow-xl"
                    >
                      <Scissors className="portrait:w-5 portrait:h-5 landscape:w-6 landscape:h-6" />
                    </button>
                    <button
                      onClick={() => setPreviewUrl(null)}
                      className="portrait:w-12 portrait:h-12 landscape:w-14 landscape:h-14 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-md border-2 border-white/20 hover:scale-110 active:scale-95 text-white flex items-center justify-center transition-all shadow-xl"
                    >
                      <RotateCcw className="portrait:w-5 portrait:h-5 landscape:w-6 landscape:h-6" />
                    </button>
                  </>
                )}
              </div>

              {/* Right Side - Camera Controls */}
              <div className="flex portrait:flex-col landscape:flex-row gap-2">
                {/* Flip Camera - Always show on mobile */}
                {!previewUrl && (
                  <button
                    onClick={toggleCamera}
                    disabled={!hasMultipleCameras}
                    className={`portrait:w-12 portrait:h-12 landscape:w-14 landscape:h-14 rounded-full backdrop-blur-md border-2 border-white/20 text-white flex flex-col items-center justify-center transition-all shadow-xl ${
                      hasMultipleCameras 
                        ? 'bg-white/10 hover:bg-white/20 hover:scale-110 active:scale-95' 
                        : 'bg-white/5 opacity-50 cursor-not-allowed'
                    }`}
                  >
                    <RotateCcw className="portrait:w-4 portrait:h-4 landscape:w-5 landscape:h-5 mb-0.5" />
                    <span className="portrait:text-[6px] landscape:text-[7px] font-bold tracking-wider">{facingMode === 'user' ? 'FRONT' : 'BACK'}</span>
                  </button>
                )}

                {/* Filters Button */}
                {!previewUrl && (
                  <button
                    onClick={() => alert('🎨 Filters coming soon!')}
                    className="portrait:w-12 portrait:h-12 landscape:w-14 landscape:h-14 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-md border-2 border-white/20 hover:scale-110 active:scale-95 text-white flex items-center justify-center transition-all shadow-xl"
                  >
                    <Sparkles className="portrait:w-5 portrait:h-5 landscape:w-6 landscape:h-6" />
                  </button>
                )}

                {/* Submit Button - Show on recorded/uploaded videos */}
                {previewUrl && (
                  <button
                    onClick={() => {
                      // Always open the documents form as mandatory step
                      console.log('📝 Submit clicked - Opening documents form (mandatory)');
                      setWorkflowPhase('documents'); // Reset to documents phase
                      setIsFormExpanded(true); // Always open the form
                      setWorkflowStatus('📋 Please complete all document fields before video upload');
                    }}
                    className="portrait:px-3 portrait:py-1.5 landscape:px-4 landscape:py-2 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-md border-2 border-white/20 hover:scale-105 active:scale-95 text-white font-bold portrait:text-xs landscape:text-sm flex items-center justify-center transition-all shadow-xl"
                  >
                    <span>Submit</span>
                  </button>
                )}
              </div>
            </div>

        {/* Pitch Details Modal Popup */}
        {isFormExpanded && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[9999] p-4 overflow-y-auto">
            <div className="bg-gradient-to-br from-slate-900 via-purple-900/50 to-slate-900 rounded-2xl shadow-2xl w-full max-w-4xl border border-purple-500/30 my-8">
              {/* Modal Header */}
              <div className="sticky top-0 bg-gradient-to-r from-purple-900/95 via-pink-900/80 to-purple-900/95 backdrop-blur-md border-b border-purple-500/30 px-6 py-4 rounded-t-2xl flex items-center justify-between z-10">
                <div>
                  <h3 className="text-xl font-bold bg-gradient-to-r from-purple-300 to-pink-300 bg-clip-text text-transparent">
                    ✨ Pitch Details Required
                  </h3>
                  <p className="text-sm text-slate-400 mt-1">Complete all document fields before your video can be uploaded</p>
                </div>
                <button
                  onClick={() => {
                    setIsFormExpanded(false);
                    setWorkflowStatus(''); // Clear any workflow status
                  }}
                  className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Modal Content */}
              <div className="p-6 max-h-[70vh] overflow-y-auto">
                {currentBusinessProfile ? (
                  <BusinessProfileDocuments
                    businessProfile={currentBusinessProfile}
                    onDocumentsComplete={(docs) => {
                      console.log('Documents completed:', docs);
                      
                      if (docs && typeof docs === 'object') {
                        // Documents are complete with data
                        setCompletedDocumentsData(docs);
                        setDocumentsComplete(true);
                        setWorkflowPhase('ready');
                        setWorkflowStatus('✅ Documents completed! Click "Finish & Submit" to upload video.');
                        console.log('✅ Documents completed with data! Ready for manual video submission.');
                      } else if (docs === false) {
                        // Documents are incomplete
                        setCompletedDocumentsData(null);
                        setDocumentsComplete(false);
                        setWorkflowPhase('documents');
                        setWorkflowStatus('');
                        console.log('📝 Documents incomplete. Please fill all required fields.');
                      }
                    }}
                    onCancel={() => {
                      setIsFormExpanded(false);
                    }}
                  />
                ) : (
                  <div className="bg-yellow-900/30 border border-yellow-600/50 rounded-lg p-4 text-yellow-300 text-sm">
                    ⚠️ Please select or create a business profile first to document your pitch details.
                  </div>
                )}
              </div>

              {/* Modal Footer with Finish Button */}
              <div className="sticky bottom-0 bg-gradient-to-r from-slate-900/95 via-purple-900/80 to-slate-900/95 backdrop-blur-md border-t border-purple-500/30 px-6 py-4 rounded-b-2xl">
                <button
                  onClick={async () => {
                    // Check if documents are completed
                    if (!completedDocumentsData || !documentsComplete) {
                      setWorkflowStatus('❌ Please complete all document fields first');
                      return;
                    }
                    
                    // Close the modal first
                    setIsFormExpanded(false);
                    setWorkflowStatus('🚀 Uploading your pitch video...');
                    
                    try {
                      // Use direct video submit with completed documents
                      await handleDirectVideoSubmit(completedDocumentsData, currentBusinessProfile);
                    } catch (error) {
                      console.error('❌ Submit error:', error);
                      setWorkflowStatus('❌ Upload failed. Please try again.');
                      setIsSubmitting(false);
                    }
                  }}
                  disabled={isSubmitting || !completedDocumentsData}
                  className={`w-full py-3 px-6 rounded-xl font-bold text-lg transition shadow-xl flex items-center justify-center gap-2 ${
                    isSubmitting || !completedDocumentsData
                      ? 'bg-slate-600 cursor-not-allowed opacity-50 text-slate-300'
                      : 'bg-gradient-to-r from-green-500 via-emerald-500 to-green-600 hover:from-green-600 hover:via-emerald-600 hover:to-green-700 text-white hover:shadow-2xl hover:shadow-green-500/50 transform hover:scale-105 cursor-pointer active:scale-95'
                  }`}
                >
                  {isSubmitting ? (
                    <>
                      <Upload className="w-5 h-5 animate-spin" />
                      <span>Processing Your Pitch...</span>
                    </>
                  ) : (
                    <>
                      <Rocket className="w-5 h-5" />
                      <span>Finish & Submit Pitch</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

            {/* Recording Time Display */}
            {isRecording && (
              <div className="absolute portrait:top-20 landscape:top-16 left-1/2 transform -translate-x-1/2 z-40 bg-red-600/80 backdrop-blur-md text-white portrait:px-3 portrait:py-1.5 landscape:px-4 landscape:py-2 rounded-full flex items-center gap-2 shadow-lg">
                <div className="w-2 h-2 bg-white rounded-full animate-pulse"></div>
                <span className="portrait:text-xs landscape:text-sm font-bold">{Math.floor(recordingTime / 60)}:{String(recordingTime % 60).padStart(2, '0')}</span>
              </div>
            )}
            {/* Pin icon button - Commented out */}
            {/* <div className="absolute top-14 md:top-4 right-4 md:right-4 z-40">
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
            </div> */}
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
                ✨ Pitch Details
              </h3>
              <p className="text-sm text-slate-400 mt-1">Click the expand button to open detailed form</p>
            </div>

            {/* Simplified message - Documents handled in modal */}
            <div className="bg-purple-900/30 border border-purple-600/50 rounded-lg p-4 text-purple-300 text-sm text-center">
              📋 Pitch documentation is available in the expanded modal view
            </div>

            {/* Submit Button Area */}
            <div className="md:px-8 md:pb-8 space-y-3">
              <button
                onClick={() => {
                  // Always open the documents form as mandatory step
                  console.log('📝 Form Submit clicked - Opening documents form (mandatory)');
                  setWorkflowPhase('documents'); // Reset to documents phase
                  setIsFormExpanded(true); // Always open the form
                  setWorkflowStatus('📋 Please complete all document fields before video upload');
                }}
                disabled={isSubmitting || !videoBlob}
                title={!videoBlob ? 'Please upload or record a video' : 'Click to open pitch details form'}
                className={`w-full py-3 md:py-4 px-6 rounded-xl font-bold text-base md:text-lg transition shadow-xl flex items-center justify-center gap-2 ${
                  isSubmitting || !videoBlob
                    ? 'bg-slate-600 cursor-not-allowed opacity-50 text-slate-300'
                    : 'bg-gradient-to-r from-pink-500 via-purple-500 to-indigo-500 hover:from-pink-600 hover:via-purple-600 hover:to-indigo-600 text-white hover:shadow-2xl hover:shadow-pink-500/50 transform hover:scale-105 cursor-pointer active:scale-95'
                }`}
              >
                {isSubmitting ? (
                  <>
                    <Upload className="w-5 h-5 animate-spin" />
                    <span>Processing Your Pitch...</span>
                  </>
                ) : (
                  <>
                    <span>📝</span>
                    <span>Open Pitch Details</span>
                  </>
                )}
              </button>
              {/* Helper text - Commented out */}
              {/* <p className="text-center text-slate-400 text-xs md:text-sm">
                {isSubmitting ? 'Please wait while we process your pitch...' : 'Fill all fields and record/upload a video to proceed'}
              </p> */}
            </div>
          </div>
        </div>

        {/* Trim Dialog Modal */}
        {showTrimDialog && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[9999] p-4">
            <div className="bg-gradient-to-br from-gray-900 via-gray-800 to-black rounded-2xl shadow-2xl p-6 max-w-md w-full border border-purple-500/30">
              <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                <Scissors className="w-5 h-5 text-purple-400" />
                Trim Your Video?
              </h3>
              
              <p className="text-gray-300 mb-6 text-sm">
                You can optionally trim your video to cut out unwanted parts, or upload it as is. Trimming is optional!
              </p>
              
              <div className="flex gap-3">
                <button
                  onClick={handleSkipTrim}
                  className="flex-1 px-4 py-3 bg-gray-700 hover:bg-gray-600 text-white font-semibold rounded-lg transition-colors"
                >
                  📤 Skip & Upload
                </button>
                
                <button
                  onClick={handleOpenTrimmer}
                  className="flex-1 px-4 py-3 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white font-semibold rounded-lg transition-all hover:shadow-lg hover:shadow-purple-500/50"
                >
                  ✂️ Trim Video
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Video Clipper Modal */}
        {showVideoClipper && videoBlob && (
          <VideoClipper 
            videoFile={videoBlob}
            onClip={handleVideoClip}
            onCancel={() => setShowVideoClipper(false)}
          />
        )}

        {/* Pitch Details Form - Auto-opens after documents completion */}
        {showPitchDetailsForm && currentBusinessProfile && (
          <PitchDetailsForm
            isOpen={showPitchDetailsForm}
            onClose={() => setShowPitchDetailsForm(false)}
            onSubmit={handlePitchDetailsSubmit}
            currentBusinessProfile={currentBusinessProfile}
          />
        )}
      </div>
    </div>
  );
};

export default PitchVideoRecorder;
