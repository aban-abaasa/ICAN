import React, { useState, useRef, useEffect } from 'react';
import { X, Rocket } from 'lucide-react';
import { getSupabase } from '../services/pitchingService';
import PitchCameraStage from './PitchCameraStage';
import { VideoClipper } from './status/SimpleVideoClipper';
import BusinessProfileDocuments from './BusinessProfileDocuments';
import PitchDetailsForm from './PitchDetailsForm';
import BusinessProfileSelector from './BusinessProfileSelector';
import DiamondLoader from './DiamondLoader';
import { applyWatermarkToVideoBlob } from '../utils/videoWatermark';
import { createBlobTask } from '../utils/videoFormat';

const PitchVideoRecorder = ({ cameraMode = 'front', recordingMethod = 'record', onPitchCreated, onClose, hideControls = false, onVideoRecorded, currentBusinessProfile, businessProfiles = [], onSelectProfile, onShowProfileSelector, backgroundUpload = false }) => {
  const fullscreenRef = useRef(null);
  const documentsRef = useRef(null);
  const previewUrlRef = useRef(null);
  const videoTaskRef = useRef(null);   // background "stamp the IcanEra mark" job for a picked file
  const handedOffRef = useRef(false);  // the clip + task now belong to the uploader, so don't cancel them on close

  const [recordedChunks, setRecordedChunks] = useState([]);
  const [videoBlob, setVideoBlob] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [videoMeta, setVideoMeta] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [isFormExpanded, setIsFormExpanded] = useState(false);
  const [showVideoClipper, setShowVideoClipper] = useState(false);
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

  // Sync selected profile with prop
  useEffect(() => {
    setSelectedProfile(currentBusinessProfile);
  }, [currentBusinessProfile]);

  // Release the preview URL, and any unfinished background work, when the recorder goes away.
  useEffect(() => () => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    if (!handedOffRef.current) videoTaskRef.current?.abort();
  }, []);

  // A clip is ready (just recorded, or picked from the phone).
  const handleVideoReady = ({ blob, durationSec, source, needsWatermark, task, width, height }) => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    const url = URL.createObjectURL(blob);
    previewUrlRef.current = url;
    videoTaskRef.current = task || null;
    setVideoBlob(blob);
    setRecordedChunks([blob]);
    setPreviewUrl(url);
    setVideoMeta({ durationSec, source, needsWatermark: !!needsWatermark, size: blob.size, type: blob.type, width, height });
    if (task && !backgroundUpload) {
      // Callers that publish by themselves expect the finished (stamped) video, so hand it over once it's ready.
      task.promise.then((finalBlob) => { if (videoTaskRef.current === task) onVideoRecorded?.(finalBlob); });
    } else if (onVideoRecorded) {
      onVideoRecorded(blob);
    }
  };

  const handleRetake = () => {
    videoTaskRef.current?.abort();
    videoTaskRef.current = null;
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = null;
    setPreviewUrl(null);
    setVideoBlob(null);
    setRecordedChunks([]);
    setVideoMeta(null);
  };

  const handleVideoClip = (clipData) => {
    // The trimmed copy replaces the clip. A picked file still needs its IcanEra mark, so stamp the trimmed copy too.
    setShowVideoClipper(false);
    videoTaskRef.current?.abort();
    const needsWatermark = !!videoMeta?.needsWatermark;
    const task = needsWatermark
      ? createBlobTask(({ signal, onProgress }) => applyWatermarkToVideoBlob(clipData.blob, { onProgress, signal }), { timeoutMs: 120000 })
      : null;
    handleVideoReady({
      blob: clipData.blob,
      durationSec: clipData.duration || null,
      source: videoMeta?.source,
      needsWatermark,
      task,
    });
  };

  const handleNext = () => {
    // If no profile selected, show the profile selector first
    if (!selectedProfile) {
      setShowProfileModal(true);
      return;
    }
    // Profile is selected, open documents form
    setWorkflowPhase('documents');
    setIsFormExpanded(true);
    setWorkflowStatus('📋 Complete all documents to publish');
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

      // Callers that publish by themselves get the finished (stamped) video; the background uploader
      // takes the clip together with its still-running stamping job instead, and waits for it itself.
      const task = videoTaskRef.current;
      let finalBlob = videoBlob;
      if (task && !backgroundUpload) {
        setWorkflowStatus('🎞️ Finishing your video…');
        finalBlob = (await task.promise) || videoBlob;
      }

      const pitchData = {
        ...submitFormData,
        videoBlob: finalBlob,
        videoTask: backgroundUpload ? task : null,
        category: submitFormData.category,
        timestamp: 'just now'
      };

      if (!onPitchCreated) {
        throw new Error('onPitchCreated callback is not defined');
      }

      const accepted = await onPitchCreated(pitchData);
      if (backgroundUpload && accepted !== true) {
        // The parent showed its own message (e.g. documents not saved yet) and didn't take the video: stay open.
        setWorkflowStatus('');
        return;
      }

      handedOffRef.current = true;
      setSubmitSuccess(true);
      setWorkflowStatus(backgroundUpload ? '' : '✅ Pitch uploaded successfully! 🎉');

      if (onClose) {
        // Closes at once: with backgroundUpload the video keeps uploading, and progress shows in the tray.
        onClose();
      } else {
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
        setSubmitSuccess(false);
      }
    } catch (error) {
      console.error('❌ Error submitting pitch:', error);
      setSubmitError(error.message || 'Failed to create pitch. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="w-full h-[100dvh] px-0 relative flex flex-col bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
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

      <div className="bg-black rounded-none p-0 border-0 min-h-0 flex flex-col overflow-hidden flex-1">

        {/* Camera, recording and preview */}
        <div ref={fullscreenRef} className="relative w-full h-full bg-black overflow-hidden flex-1">
          {/* Workflow Status Indicator */}
          {workflowStatus && (
            <div className="absolute top-[4.5rem] left-1/2 transform -translate-x-1/2 z-50 max-w-[92%] bg-green-600/90 backdrop-blur-md text-white px-4 py-2 rounded-full flex items-center gap-2 shadow-lg">
              <div className="w-2 h-2 bg-white rounded-full animate-pulse flex-shrink-0"></div>
              <span className="text-sm font-medium">{workflowStatus}</span>
            </div>
          )}

          <PitchCameraStage
            cameraMode={cameraMode}
            previewUrl={previewUrl}
            videoMeta={videoMeta}
            onClose={onClose}
            onVideoReady={handleVideoReady}
            onRetake={handleRetake}
            onTrim={() => setShowVideoClipper(true)}
            onNext={handleNext}
          />
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
                    ref={documentsRef}
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

                    try {
                      // Completion above is only local form state — persist to the
                      // database now, since Pitchin.jsx's publish check reads
                      // business_documents directly and requires it saved there.
                      setWorkflowStatus('💾 Saving documents...');
                      const saveResult = await documentsRef.current?.saveDocuments();
                      if (!saveResult?.success) {
                        setWorkflowStatus('❌ ' + (saveResult?.error || 'Failed to save documents. Please try again.'));
                        return;
                      }

                      // Close the modal first
                      setIsFormExpanded(false);
                      setWorkflowStatus('🚀 Uploading your pitch video...');

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
                      <DiamondLoader size={22} />
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
