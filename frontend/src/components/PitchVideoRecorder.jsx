import React, { useState, useRef, useEffect } from 'react';
import { Camera, Mic, Square, Play, Upload, X, RotateCcw, Pin, Maximize, Minimize, Smartphone, Scissors, CheckCircle, SwitchCamera, Sparkles, ArrowLeft, Rocket } from 'lucide-react';
import { uploadVideo, getSupabase } from '../services/pitchingService';
import { VideoClipper } from './status/SimpleVideoClipper';
import BusinessProfileDocuments from './BusinessProfileDocuments';
import PitchDetailsForm from './PitchDetailsForm';
import BusinessProfileSelector from './BusinessProfileSelector';

const PitchVideoRecorder = ({ cameraMode = 'front', recordingMethod = 'record', onPitchCreated, onClose, hideControls = false, onVideoRecorded, currentBusinessProfile, businessProfiles = [], onSelectProfile, onShowProfileSelector }) => {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const animationFrameRef = useRef(null);
  const streamRef = useRef(null);
  const fullscreenRef = useRef(null);
  const videoRefs = useRef({});
  const recordedChunksRef = useRef([]);
  
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
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [selectedProfile, setSelectedProfile] = useState(currentBusinessProfile);
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

  // Sync selected profile with prop
  useEffect(() => {
    setSelectedProfile(currentBusinessProfile);
  }, [currentBusinessProfile]);

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
      console.log(`📹 Starting recording - Camera mode: ${facingMode === 'user' ? 'Front' : 'Back'}`);
      
      // Reset chunks at start of recording
      recordedChunksRef.current = [];
      setRecordedChunks([]);
      
      // Check for available cameras
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(device => device.kind === 'videoinput');
      console.log(`Found ${videoDevices.length} camera(s)`);
      setHasMultipleCameras(videoDevices.length > 1);
      
      // Determine which camera to use based on facingMode
      const constraints = {
        video: {
          facingMode: facingMode,
          aspectRatio: { ideal: 9/16 },
          width: { ideal: 1080 },
          height: { ideal: 1920 }
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      };
      
      console.log('Requesting camera with constraints:', constraints);
      const stream = await navigator.mediaDevices.getUserMedia(constraints);

      console.log('✅ Camera stream obtained');
      console.log('Video tracks:', stream.getVideoTracks().map(t => ({
        label: t.label,
        facingMode: t.getSettings().facingMode
      })));

      streamRef.current = stream;

      // Set up canvas rendering
      if (canvasRef.current && videoRef.current) {
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        
        // Set initial canvas dimensions (9:16 portrait)
        canvas.width = 1080;
        canvas.height = 1920;
        console.log('Canvas initialized: 1080x1920');
        
        videoRef.current.srcObject = stream;
        
        // Play the video to display on canvas
        videoRef.current.play().catch(err => {
          console.error('❌ Play error:', err);
        });
        
        // Set up MediaRecorder to capture canvas stream
        try {
          const canvasStream = canvasRef.current.captureStream(30); // 30 FPS
          const audioTracks = stream.getAudioTracks();
          
          // Add audio tracks to canvas stream if available
          if (audioTracks.length > 0) {
            audioTracks.forEach(track => {
              canvasStream.addTrack(track);
            });
          }
          
          // Create MediaRecorder
          const mimeType = 'video/webm;codecs=vp9,opus';
          const options = {
            mimeType: mimeType,
            videoBitsPerSecond: 2500000 // 2.5 Mbps
          };
          
          mediaRecorderRef.current = new MediaRecorder(canvasStream, options);
          
          // Handle data chunks
          mediaRecorderRef.current.ondataavailable = (event) => {
            if (event.data.size > 0) {
              recordedChunksRef.current.push(event.data);
              console.log('📦 Data chunk received:', event.data.size);
            }
          };
          
          // Handle recording stop
          mediaRecorderRef.current.onstop = () => {
            console.log('⏹️ Recording stopped');
            const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' });
            const url = URL.createObjectURL(blob);
            setPreviewUrl(url);
            setVideoBlob(blob);
            setRecordedChunks(recordedChunksRef.current);
            
            // Notify parent
            if (onVideoRecorded) {
              onVideoRecorded(blob);
            }
          };
          
          mediaRecorderRef.current.onerror = (event) => {
            console.error('❌ MediaRecorder error:', event.error);
          };
          
          console.log('✅ MediaRecorder set up successfully');
        } catch (err) {
          console.error('❌ MediaRecorder setup failed:', err);
        }
        
        // Draw video frames to canvas
        const drawFrame = () => {
          // Clear canvas
          ctx.fillStyle = '#000';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          
          try {
            if (videoRef.current && videoRef.current.readyState >= 2) {
              const videoWidth = videoRef.current.videoWidth;
              const videoHeight = videoRef.current.videoHeight;
              
              if (videoWidth && videoHeight) {
                // Update canvas to match video dimensions
                if (canvas.width !== videoWidth || canvas.height !== videoHeight) {
                  canvas.width = videoWidth;
                  canvas.height = videoHeight;
                }
                
                // Draw video frame
                ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
              }
            }
          } catch (e) {
            // Handle drawImage errors silently
          }
          animationFrameRef.current = requestAnimationFrame(drawFrame);
        };
        
        videoRef.current.onplay = () => {
          console.log('✅ Video play event - starting frame drawing');
          drawFrame();
          // Start recording after stream is ready
          setTimeout(() => {
            if (mediaRecorderRef.current) {
              mediaRecorderRef.current.start();
              setIsRecording(true);
              setRecordingTime(0);
              console.log('🔴 Recording started');
            }
          }, 100);
        };
        
        videoRef.current.onerror = (error) => {
          console.error('❌ Video error:', error);
        };
      }
    } catch (error) {
      console.error('❌ Error starting recording:', error);
      if (error.name === 'NotAllowedError') {
        alert('Camera access denied. Please allow camera permissions.');
      } else if (error.name === 'NotFoundError') {
        alert(`${facingMode === 'user' ? 'Front' : 'Back'} camera not found.`);
      }
    }
  };

  const stopRecording = () => {
    console.log('⏹️ Stop recording requested');
    
    if (isRecording) {
      setIsRecording(false);
      
      // Stop MediaRecorder
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
      
      // Stop stream tracks
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => {
          track.stop();
          console.log('Stopped track:', track.kind);
        });
        streamRef.current = null;
      }
      
      // Stop animation frame
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      
      setRecordingTime(0);
    }
  };

  const toggleCamera = async () => {
    if (!hasMultipleCameras) {
      console.warn('Only one camera available');
      return;
    }
    
    try {
      // Stop current stream and recording
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => {
          track.stop();
          console.log('Stopped track:', track.kind);
        });
        streamRef.current = null;
      }
      
      if (isRecording) {
        setIsRecording(false);
        if (mediaRecorderRef.current) {
          mediaRecorderRef.current.stop();
        }
      }
      
      // Switch camera mode
      const newFacingMode = facingMode === 'user' ? 'environment' : 'user';
      console.log(`Switching camera: ${facingMode} → ${newFacingMode}`);
      setFacingMode(newFacingMode);
      
      // Wait for state update then request new stream
      setTimeout(async () => {
        try {
          console.log('Requesting new stream with facing mode:', newFacingMode);
          await startRecording();
          console.log('✅ Camera switched successfully');
        } catch (error) {
          console.error('❌ Error getting camera stream:', error);
          setFacingMode(facingMode); // Revert on error
        }
      }, 300);
    } catch (error) {
      console.error('❌ Camera toggle error:', error);
    }
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
      
      // Show real preview immediately for uploaded videos (skip trim dialog)
      if (file.type.startsWith('video')) {
        const url = URL.createObjectURL(file);
        setPreviewUrl(url);
        setVideoBlob(file);
        setRecordedChunks([file]);
        
        // Notify parent of video blob so it persists
        if (onVideoRecorded) {
          onVideoRecorded(file);
        }
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
      if (selectedProfile && !completedDocumentsData) {
        try {
          const supabase = getSupabase();
          if (supabase) {
            const { data: docs, error } = await supabase
              .from('business_documents')
              .select('*')
              .eq('business_profile_id', selectedProfile.id)
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
    <div className="w-full h-screen px-0 relative flex flex-col bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
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

      <div className="bg-black rounded-none p-0 border-0 h-screen flex flex-col overflow-hidden flex-1">

        {/* Full-Screen Video Container */}
        <div ref={fullscreenRef} className="relative w-full h-full bg-black overflow-hidden flex-1">
          
          {/* Workflow Status Indicator */}
          {workflowStatus && (
            <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-50 bg-green-600/90 backdrop-blur-md text-white px-4 py-2 rounded-full flex items-center gap-2 shadow-lg animate-pulse">
              <div className="w-2 h-2 bg-white rounded-full animate-pulse"></div>
              <span className="text-sm font-medium">{workflowStatus}</span>
            </div>
          )}
          
          {/* Main Video Display */}
          <div style={{
            backgroundColor: '#000',
            position: 'relative',
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'auto',
            padding: '0'
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
                {/* Canvas for displaying video stream - Normal view without zoom */}
                <canvas
                  ref={canvasRef}
                  style={{
                    maxWidth: '100%',
                    maxHeight: '100%',
                    width: 'auto',
                    height: 'auto',
                    display: 'block',
                    backgroundColor: '#000',
                    objectFit: 'contain'
                  }}
                />

                {/* Fallback - Clickable Camera Button to Start Recording */}
                <button
                  onClick={startRecording}
                  className="absolute inset-0 flex flex-col items-center justify-center text-white z-10 hover:bg-black/20 transition-all active:bg-black/40 rounded-lg"
                  title="Click to start recording"
                >
                  <div className="w-20 h-20 rounded-full bg-slate-700 hover:bg-slate-600 flex items-center justify-center mb-4 transition-all hover:scale-110 active:scale-95 shadow-lg">
                    <Camera className="w-10 h-10 text-slate-400" />
                  </div>
                  <p className="text-lg font-semibold">Tap to start recording</p>
                </button>
              </>
            ) : (
              <>
                {/* Preview Video - Normal view without zoom, wide display */}
                <div className="absolute inset-0">
                  <video
                    ref={el => { if (el) videoRefs.current['preview'] = el; }}
                    key={previewUrl}
                    src={previewUrl}
                    playsInline
                    className="w-full h-full object-contain"
                    style={{
                      backgroundColor: '#000',
                      display: 'block',
                      maxWidth: '100%',
                      maxHeight: '100%'
                    }}
                    onLoadedMetadata={(e) => {
                      console.log('✅ Preview video loaded:', e.target.videoWidth, 'x', e.target.videoHeight);
                    }}
                    onError={(e) => {
                      console.error('❌ Preview video error:', e);
                    }}
                  />
                </div>

                {/* Video Controls Overlay in Preview - Bottom Center */}
                <div className="absolute bottom-32 left-0 right-0 flex items-center justify-center gap-4 z-40">
                  {/* Play/Pause Button */}
                  <button
                    onClick={() => {
                      const video = videoRefs.current['preview'];
                      if (video) {
                        if (video.paused) {
                          video.play();
                        } else {
                          video.pause();
                        }
                      }
                    }}
                    className="w-14 h-14 rounded-full bg-blue-500/80 hover:bg-blue-500 backdrop-blur-md border-2 border-blue-400 text-white flex items-center justify-center transition-all shadow-xl hover:scale-110"
                    title="Play/Pause"
                  >
                    <Play className="w-7 h-7 fill-white" />
                  </button>

                  {/* Volume Toggle */}
                  <button
                    onClick={() => {
                      const video = videoRefs.current['preview'];
                      if (video) {
                        video.muted = !video.muted;
                      }
                    }}
                    className="w-12 h-12 rounded-full bg-white/20 hover:bg-white/30 backdrop-blur-md border border-white/30 text-white flex items-center justify-center transition-all"
                    title="Toggle Sound"
                  >
                    <span className="text-lg">🔊</span>
                  </button>

                  {/* Fullscreen Toggle */}
                  <button
                    onClick={() => {
                      const video = videoRefs.current['preview'];
                      if (video?.requestFullscreen) {
                        video.requestFullscreen();
                      }
                    }}
                    className="w-12 h-12 rounded-full bg-white/20 hover:bg-white/30 backdrop-blur-md border border-white/30 text-white flex items-center justify-center transition-all"
                    title="Fullscreen"
                  >
                    <Maximize className="w-5 h-5" />
                  </button>
                </div>

                {/* Preview Info Indicator */}
                <div className="absolute top-4 left-4 bg-black/60 backdrop-blur-md px-4 py-2 rounded-full border border-white/30 z-40">
                  <p className="text-white font-semibold text-sm flex items-center gap-2">
                    <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></span>
                    Preview
                  </p>
                </div>
              </>
            )}

            {/* Top Right - Camera Mode Indicator - Recording Only */}
            {!previewUrl && (
            <div className="absolute top-4 right-4 flex items-center gap-2 px-3 py-2 rounded-full bg-blue-500/20 backdrop-blur-md border border-blue-500/50 z-40">
              <span className="text-blue-300 text-xs font-semibold whitespace-nowrap">
                {facingMode === 'user' ? '📱 Front' : '🔄 Back'}
              </span>
            </div>
            )}

            {/* Top Left - Back Button - Preview Only */}
            {previewUrl && onClose && (
            <button
              onClick={onClose}
              className="absolute top-4 left-4 flex items-center gap-2 px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 backdrop-blur-md border border-white/20 text-white text-sm font-medium transition-all hover:scale-105 active:scale-95 z-40"
              title="Close preview"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back</span>
            </button>
            )}

            {/* Left Side Controls - Vertical Stack */}
            <div className="absolute left-4 top-1/2 transform -translate-y-1/2 flex flex-col gap-3 z-40">
              {/* Back Button */}
              {onClose && (
                <button
                  onClick={onClose}
                  className="flex items-center justify-center w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-md border-2 border-white/20 text-white transition-all hover:scale-105 active:scale-95 shadow-lg"
                  title="Back"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
              )}

              {/* Upload Video Button */}
              <label className="w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-md border-2 border-white/20 text-white flex items-center justify-center transition-all cursor-pointer hover:scale-105 active:scale-95 shadow-lg"
                title="Upload Video">
                <Upload className="w-5 h-5" />
                <input
                  type="file"
                  accept="video/*"
                  onChange={handleUploadVideo}
                  className="hidden"
                />
              </label>
            </div>

            {/* Right Side Controls - Vertical Stack */}
            <div className="absolute right-4 top-1/2 transform -translate-y-1/2 flex flex-col gap-3 z-40">
              {/* Camera Toggle Button */}
              <button
                onClick={toggleCamera}
                disabled={!hasMultipleCameras}
                title={hasMultipleCameras ? `Switch to ${facingMode === 'user' ? 'Back' : 'Front'} Camera` : 'Only one camera available'}
                className={`w-12 h-12 rounded-full backdrop-blur-md border-2 flex items-center justify-center transition-all shadow-lg ${
                  hasMultipleCameras
                    ? 'bg-blue-500/20 hover:bg-blue-500/40 border-blue-400/50 text-blue-300 hover:scale-105 active:scale-95'
                    : 'bg-white/5 border-white/10 text-white/30 cursor-not-allowed opacity-50'
                }`}
              >
                <SwitchCamera className="w-5 h-5" />
              </button>

              {/* Fullscreen Toggle */}
              <button
                onClick={toggleFullscreen}
                className="w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-md border-2 border-white/20 text-white flex items-center justify-center transition-all hover:scale-105 active:scale-95 shadow-lg"
                title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
              >
                {isFullscreen ? (
                  <Minimize className="w-5 h-5" />
                ) : (
                  <Maximize className="w-5 h-5" />
                )}
              </button>

              {/* Recording Timer - Vertical */}
              {isRecording && (
                <div className="flex flex-col items-center justify-center px-3 py-2 rounded-full bg-red-500/20 border border-red-500/50 backdrop-blur-md">
                  <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></div>
                  <span className="text-white font-semibold text-xs mt-1 whitespace-nowrap">
                    {Math.floor(recordingTime / 60)}:{String(recordingTime % 60).padStart(2, '0')}
                  </span>
                </div>
              )}
            </div>

            {/* Bottom Controls Row - Stop Recording (When Active) */}
            {isRecording && (
            <div className="absolute bottom-4 left-0 right-0 flex items-center justify-center z-40">
              <button
                onClick={stopRecording}
                className="w-20 h-20 rounded-full bg-red-500 border-2 border-red-400 hover:bg-red-600 flex items-center justify-center transition-all shadow-2xl hover:scale-110 active:scale-95"
                title="Stop recording"
              >
                <Square className="w-10 h-10 text-white fill-white" />
              </button>
            </div>
            )}

            {/* Preview Action Buttons - Right Side Vertical Stack (Only during Preview) */}
            {previewUrl && (
            <div className="absolute right-4 bottom-24 flex flex-col items-center gap-3 z-40">
              {/* Retake Button */}
              <button
                onClick={() => setPreviewUrl(null)}
                className="px-5 py-2 rounded-full bg-orange-500/90 hover:bg-orange-600 backdrop-blur-md border-2 border-orange-400 text-white font-semibold transition-all hover:scale-110 active:scale-95 flex items-center gap-2 shadow-lg"
                title="Record again"
              >
                <RotateCcw className="w-5 h-5" />
                <span className="hidden sm:inline">Retake</span>
              </button>

              {/* Edit/Trim Button */}
              <button
                onClick={() => setShowVideoClipper(true)}
                className="px-5 py-2 rounded-full bg-blue-500/90 hover:bg-blue-600 backdrop-blur-md border-2 border-blue-400 text-white font-semibold transition-all hover:scale-110 active:scale-95 flex items-center gap-2 shadow-lg"
                title="Trim or edit video"
              >
                <Scissors className="w-5 h-5" />
                <span className="hidden sm:inline">Edit</span>
              </button>

              {/* Next Button */}
              <button
                onClick={() => {
                  console.log('📝 Next clicked - Checking business profile...');
                  
                  // If no profile selected, show profile selector first
                  if (!selectedProfile) {
                    console.log('⚠️ No business profile selected - showing selector');
                    setShowProfileModal(true);
                    return;
                  }
                  
                  // Profile is selected, open documents form
                  console.log('✅ Opening documents form with profile:', selectedProfile.name);
                  setWorkflowPhase('documents');
                  setIsFormExpanded(true);
                  setWorkflowStatus('📋 Complete all documents to publish');
                }}
                className="px-5 py-2 rounded-full bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 border-2 border-green-400 text-white font-bold transition-all hover:scale-110 active:scale-95 flex items-center gap-2 shadow-xl"
                title="Proceed to document upload"
              >
                <CheckCircle className="w-5 h-5" />
                <span className="hidden sm:inline">Next</span>
              </button>
            </div>
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
                {selectedProfile ? (
                  <BusinessProfileDocuments
                    businessProfile={selectedProfile}
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
                      await handleDirectVideoSubmit(completedDocumentsData, selectedProfile);
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

        {/* Video Clipper Modal */}
        {showVideoClipper && videoBlob && (
          <VideoClipper 
            videoFile={videoBlob}
            onClip={handleVideoClip}
            onCancel={() => setShowVideoClipper(false)}
          />
        )}

        {/* Business Profile Selector Modal */}
        {showProfileModal && (
          <BusinessProfileSelector
            profiles={businessProfiles}
            currentProfile={selectedProfile}
            onSelectProfile={(profile) => {
              setSelectedProfile(profile);
              setShowProfileModal(false);
              // Auto-open documents form after profile selection
              setTimeout(() => {
                setWorkflowPhase('documents');
                setIsFormExpanded(true);
                setWorkflowStatus('📋 Complete all documents to publish');
              }, 300);
            }}
            onCreateNew={() => {
              setShowProfileModal(false);
              // Note: Parent component handles showing the profile creation form
              if (onShowProfileSelector) {
                onShowProfileSelector();
              }
            }}
            onCancel={() => setShowProfileModal(false)}
          />
        )}

        {/* Pitch Details Form - Auto-opens after documents completion */}
        {showPitchDetailsForm && selectedProfile && (
          <PitchDetailsForm
            isOpen={showPitchDetailsForm}
            onClose={() => setShowPitchDetailsForm(false)}
            onSubmit={handlePitchDetailsSubmit}
            currentBusinessProfile={selectedProfile}
          />
        )}
      </div>
    </div>
  );
};

export default PitchVideoRecorder;
