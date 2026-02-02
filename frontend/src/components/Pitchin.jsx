import React, { useState, useRef, useEffect } from 'react';
import { ThumbsUp, MessageCircle, Share2, Clock, Users, FileText, Zap, AlertCircle, Building2, Loader, Plus, Trash2, Lock, Unlock, X, Send, Copy, Check, Play, Home, BookMarked, Heart, Briefcase } from 'lucide-react';
import PitchVideoRecorder from './PitchVideoRecorder';
import SmartContractGenerator from './SmartContractGenerator';
import ShareSigningFlow from './ShareSigningFlow';
import BusinessProfileForm from './BusinessProfileForm';
import BusinessProfileSelector from './BusinessProfileSelector';
import BusinessProfileCard from './BusinessProfileCard';
import SHAREHub from './SHAREHub';
import { 
  getAllPitches, 
  getUserPitches, 
  getUserBusinessProfiles,
  getAllAccessibleBusinessProfiles,
  checkBusinessProfileEditPermission,
  likePitch,
  sharePitch,
  createPitch,
  updatePitch,
  deletePitch,
  uploadVideo,
  deleteBusinessProfile as deleteProfileService,
  createNotification,
  getSupabase
} from '../services/pitchingService';
import {
  likePitchDb,
  unlikePitchDb,
  getPitchComments,
  addPitchComment,
  deleteComment,
  hasUserLikedPitch
} from '../services/pitchInteractionsService';

const Pitchin = ({ showPitchCreator, onClosePitchCreator, onOpenCreate }) => {
  const [pitches, setPitches] = useState([]);
  const [filteredPitches, setFilteredPitches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState(null);
  const [supabaseReady, setSupabaseReady] = useState(true);

  const [showRecorder, setShowRecorder] = useState(false);
  const [currentPitch, setCurrentPitch] = useState(null);
  const [activeTab, setActiveTab] = useState('feed');
  const [selectedForContract, setSelectedForContract] = useState(null);
  const [selectedForInvestment, setSelectedForInvestment] = useState(null); // For ShareSigningFlow
  const [videoErrors, setVideoErrors] = useState({});
  const [businessProfiles, setBusinessProfiles] = useState([]);
  const [currentBusinessProfile, setCurrentBusinessProfile] = useState(null);
  const [showBusinessForm, setShowBusinessForm] = useState(false);
  const [showProfileSelector, setShowProfileSelector] = useState(false);
  const [showProfileDetails, setShowProfileDetails] = useState(false);
  const [showWallet, setShowWallet] = useState(false);
  const [editingProfile, setEditingProfile] = useState(null);
  const [likedPitches, setLikedPitches] = useState(new Set());
  const [showComments, setShowComments] = useState(null); // pitch id for comments modal
  const [comments, setComments] = useState({});
  const [newComment, setNewComment] = useState('');
  const [copiedPitchId, setCopiedPitchId] = useState(null);
  const [expandedPitchInfo, setExpandedPitchInfo] = useState(null); // pitch id for info tooltip
  const [videoOrientations, setVideoOrientations] = useState({}); // track video orientations (portrait/landscape)
  const [showMobilePitchDetail, setShowMobilePitchDetail] = useState(false); // mobile pitch detail modal
  const [selectedMobilePitch, setSelectedMobilePitch] = useState(null); // selected pitch for mobile detail
  const [showSHAREHub, setShowSHAREHub] = useState(false); // show SHAREHub modal on mobile
  const [videoPlayerPitch, setVideoPlayerPitch] = useState(null); // pitch for fullscreen video player
  const videoScrollRef = useRef(null);

  // Initialize and load data
  useEffect(() => {
    const initialize = async () => {
      try {
        setLoading(true);
        
        // Check if Supabase is configured
        const sb = getSupabase();
        console.log('Supabase client initialized:', !!sb);
        setSupabaseReady(!!sb);

        if (sb) {
          try {
            // Get current user with error handling
            console.log('Fetching current user...');
            const { data: { user }, error: userError } = await sb.auth.getUser();
            
            if (userError) {
              console.warn('Auth error getting user:', userError.message);
              // Continue without user - demo mode will work
            } else {
              setCurrentUser(user);

              // Load user's business profiles if logged in (owned + co-owned)
              if (user) {
                try {
                  // Get all accessible profiles (owned + co-owned)
                  const profiles = await getAllAccessibleBusinessProfiles(user.id, user.email);
                  setBusinessProfiles(profiles);
                  if (profiles.length > 0) {
                    setCurrentBusinessProfile(profiles[0]);
                  }
                } catch (profileError) {
                  console.warn('Error loading profiles:', profileError.message);
                }
              }
            }
          } catch (authError) {
            console.warn('Auth initialization error:', authError.message);
            // Continue without auth - fallback to demo mode
          }
        }

        // Load pitches (works in demo mode)
        const allPitches = await getAllPitches();
        setPitches(allPitches);
        setFilteredPitches(allPitches);
      } catch (error) {
        console.error('Error initializing Pitchin:', error);
        // Still show demo content even if there's an error
        const demoData = await getAllPitches();
        setPitches(demoData);
        setFilteredPitches(demoData);
      } finally {
        setLoading(false);
      }
    };

    initialize();
  }, []);

  // Handle tab changes
  useEffect(() => {
    if (activeTab === 'feed') {
      // Show ALL published pitches in feed - free to view for everyone
      setFilteredPitches(pitches);
    } else if (activeTab === 'myPitches' && currentUser) {
      // Show only user's actual pitches (must have user_id that matches)
      setFilteredPitches(pitches.filter(p => p.business_profiles?.user_id === currentUser.id));
    } else if (activeTab === 'interested') {
      // Show pitches user has liked (pending votes/interested)
      const interestedPitches = pitches.filter(p => likedPitches.has(p.id));
      setFilteredPitches(interestedPitches.length > 0 ? interestedPitches : pitches.slice(0, 0)); // Show empty if no likes
    }
  }, [activeTab, pitches, currentUser, likedPitches]);
  // Handle external showPitchCreator trigger from parent
  useEffect(() => {
    console.log('Pitchin: showPitchCreator changed to:', showPitchCreator);
    if (showPitchCreator) {
      console.log('Pitchin: Setting showRecorder to true');
      setShowRecorder(true);
    }
  }, [showPitchCreator]);

  const handleCreatePitch = async (pitchData) => {
    try {
      if (!currentUser) {
        alert('Please login to create a pitch');
        return;
      }

      if (!currentBusinessProfile) {
        alert('Please select or create a business profile first');
        return;
      }

      // Check if business profile documents are complete AND saved to database
      try {
        const sb = getSupabase();
        if (sb) {
          try {
            const { data: docs, error } = await sb
              .from('business_documents')
              .select('*')
              .eq('business_profile_id', currentBusinessProfile.id)
              .single();

            if (!error && docs) {
              // Check if all required fields are filled AND saved
              const allDocumentsComplete = 
                docs.business_plan_content?.trim() &&
                docs.financial_projection_content?.trim() &&
                docs.value_proposition_wants?.trim() &&
                docs.value_proposition_fears?.trim() &&
                docs.value_proposition_needs?.trim() &&
                docs.mou_content?.trim() &&
                docs.share_allocation_shares &&
                docs.share_allocation_share_price;

              // Also check that documents are marked as completed
              const allMarkedComplete = 
                docs.business_plan_completed &&
                docs.financial_projection_completed &&
                docs.value_proposition_completed &&
                docs.mou_completed &&
                docs.share_allocation_completed &&
                docs.all_documents_completed === true;

              if (!allDocumentsComplete) {
                alert('❌ All pitch documents must be filled in before publishing.\n\nPlease complete:\n• Business Plan\n• Financial Projection\n• Value Proposition (Wants, Fears, Needs)\n• Memorandum of Understanding\n• Share Allocation\n\nThen click "Save Documents" to save your changes.');
                return;
              }

              if (!allMarkedComplete) {
                alert('❌ All documents must be saved and marked as complete.\n\nPlease:\n1. Fill in all document fields\n2. Click "Save Documents" button\n3. Try publishing again');
                return;
              }
            } else if (error) {
              // Handle different error codes
              if (error.code === '404' || error.code === 'PGRST116' || error.message?.includes('No rows')) {
                console.warn('No documents saved for this business profile');
                alert('❌ Pitch documents have not been saved yet.\n\nPlease:\n1. Go to Business Profile → Documents\n2. Fill in all required fields\n3. Click "Save Documents"\n4. Then publish your pitch');
                return;
              } else if (error.code === '406' || error.message?.includes('406')) {
                // 406 error - server issue with RLS or connection
                console.warn('Server error (406) checking documents');
                alert('❌ Unable to verify documents due to a server issue.\n\nPlease ensure you have:\n1. Saved all documents to your Business Profile\n2. Marked them as complete\n3. Try again in a moment');
                return;
              } else {
                throw error;
              }
            }
          } catch (docError) {
            console.warn('Document check error:', docError?.message || docError);
            alert('❌ Please complete and save all pitch documents in your business profile before publishing.');
            return;
          }
        }
      } catch (docError) {
        console.warn('Document verification error:', docError?.message);
        // Continue in demo mode
      }

      // Map form data to database schema
      // Parse currency values (e.g., "$500K" -> 500000)
      const parseAmount = (str) => {
        if (typeof str !== 'string') return 0;
        const match = str.match(/[\d.]+/);
        if (!match) return 0;
        let num = parseFloat(match[0]);
        if (str.includes('K')) num *= 1000;
        if (str.includes('M')) num *= 1000000;
        return num;
      };

      // Parse percentage (e.g., "10%" -> 10)
      const parsePercent = (str) => {
        if (typeof str !== 'string') return 0;
        const match = str.match(/[\d.]+/);
        return match ? parseFloat(match[0]) : 0;
      };

      let videoUrl = null;

      // Upload video if provided
      if (pitchData.videoBlob) {
        console.log('Uploading video:', pitchData.videoBlob.size, 'bytes');
        try {
          // We need to create pitch first to get the ID for the upload path
          // So we'll upload video after creating pitch
        } catch (error) {
          console.error('Error preparing video upload:', error);
          // Continue without video
        }
      }

      // Map form fields to database schema
      const newPitch = {
        business_profile_id: currentBusinessProfile.id,
        title: pitchData.title || 'Untitled Pitch',
        description: pitchData.description || '',
        category: pitchData.category || 'Technology',
        pitch_type: pitchData.pitchType || 'Equity',
        target_funding: parseAmount(pitchData.goal),
        raised_amount: parseAmount(pitchData.raised),
        equity_offering: parsePercent(pitchData.equity),
        video_url: videoUrl,
        has_ip: pitchData.hasIP || false,
        status: 'published',
        likes_count: 0,
        comments_count: 0,
        shares_count: 0,
        views_count: 0
      };

      console.log('Creating pitch with mapped data:', newPitch);

      // Save pitch to database
      const result = await createPitch(newPitch);
      if (!result.success) {
        throw new Error(result.error || 'Failed to create pitch');
      }

      // Get the newly created pitch
      const newPitchData = result.data;
      console.log('Pitch created successfully:', newPitchData);

      // Upload video after pitch creation if provided
      if (pitchData.videoBlob && newPitchData?.id) {
        console.log('Uploading video for pitch:', newPitchData.id);
        try {
          const uploadResult = await uploadVideo(pitchData.videoBlob, newPitchData.id);
          if (uploadResult.success && uploadResult.url) {
            console.log('✅ Video uploaded successfully:', uploadResult.url);
            // Update pitch with video URL
            await updatePitch(newPitchData.id, { video_url: uploadResult.url });
          } else {
            // Upload failed - show error and delete the pitch
            console.error('❌ Video upload failed:', uploadResult.error);
            console.error('   Deleting pitch because video is required');
            // Delete the pitch since it has no video
            await deletePitch(newPitchData.id);
            setShowRecorder(false);
            alert(`❌ Video upload failed: ${uploadResult.error}\n\nThe pitch has been deleted. Please try again after fixing the video upload issue.`);
            return;
          }
        } catch (error) {
          console.error('❌ Unexpected error uploading video:', error);
          console.error('   Deleting pitch because video upload failed');
          // Delete the pitch since video upload failed
          await deletePitch(newPitchData.id);
          setShowRecorder(false);
          alert(`❌ Video upload failed: ${error.message}\n\nThe pitch has been deleted. Please try again.`);
          return;
        }
      } else if (pitchData.videoBlob && !newPitchData?.id) {
        console.error('❌ Pitch created but no ID returned - cannot upload video');
        alert('❌ Error creating pitch - please try again');
        return;
      }

      // Reload pitches
      const allPitches = await getAllPitches();
      setPitches(allPitches);
      setFilteredPitches(allPitches);
      setShowRecorder(false);

      // Automatically open SmartContractGenerator for the creator to set up agreement
      // Wait a moment for state to update, then open the contract generator
      setTimeout(() => {
        setSelectedForContract(newPitchData || {
          id: newPitchData?.id,
          title: newPitchData?.title,
          pitch_type: newPitchData?.pitch_type,
          description: newPitchData?.description
        });
      }, 500);
    } catch (error) {
      console.error('Error creating pitch:', error);
      alert('Failed to create pitch: ' + error.message);
    }
  };

  const handleLike = async (pitchId) => {
    try {
      if (!currentUser) {
        alert('Please sign in to like pitches');
        return;
      }

      const alreadyLiked = likedPitches.has(pitchId);
      const pitch = pitches.find(p => p.id === pitchId);
      
      if (!pitch) return;
      
      if (alreadyLiked) {
        // Unlike
        const result = await unlikePitchDb(pitchId, currentUser.id);
        if (result.success) {
          const newLiked = new Set(likedPitches);
          newLiked.delete(pitchId);
          setLikedPitches(newLiked);
          
          const newLikesCount = result.data?.likes_count ?? Math.max(0, (pitch.likes_count || 1) - 1);
          const updatedPitches = pitches.map(p =>
            p.id === pitchId ? { ...p, likes_count: newLikesCount } : p
          );
          setPitches(updatedPitches);
          setFilteredPitches(updatedPitches);
        }
      } else {
        // Like
        const result = await likePitchDb(pitchId, currentUser.id, currentUser.email);
        if (result.success) {
          const newLiked = new Set(likedPitches);
          newLiked.add(pitchId);
          setLikedPitches(newLiked);
          
          const newLikesCount = result.data?.likes_count ?? (pitch.likes_count || 0) + 1;
          const updatedPitches = pitches.map(p =>
            p.id === pitchId ? { ...p, likes_count: newLikesCount } : p
          );
          setPitches(updatedPitches);
          setFilteredPitches(updatedPitches);
        } else {
          // Fallback: manually increment if no result
          const newLiked = new Set(likedPitches);
          newLiked.add(pitchId);
          setLikedPitches(newLiked);
          const updatedPitches = pitches.map(p =>
            p.id === pitchId ? { ...p, likes_count: (p.likes_count || 0) + 1 } : p
          );
          setPitches(updatedPitches);
          setFilteredPitches(updatedPitches);
        }
      }
    } catch (error) {
      console.error('Error liking pitch:', error);
    }
  };

  const handleShare = async (pitchId) => {
    try {
      const pitch = pitches.find(p => p.id === pitchId);
      const shareUrl = `${window.location.origin}/pitchin/${pitchId}`;
      const shareData = {
        title: pitch?.title || 'Check out this pitch!',
        text: pitch?.description || 'Discover this amazing investment opportunity on ICAN',
        url: shareUrl
      };

      // Try native share first (mobile)
      if (navigator.share && navigator.canShare && navigator.canShare(shareData)) {
        await navigator.share(shareData);
      } else {
        // Fallback: Copy to clipboard
        await navigator.clipboard.writeText(shareUrl);
        setCopiedPitchId(pitchId);
        setTimeout(() => setCopiedPitchId(null), 2000);
      }
      
      // Increment share count
      const result = await sharePitch(pitchId);
      const newSharesCount = result.success && result.data ? result.data.shares_count : (pitch?.shares_count || 0) + 1;
      const updatedPitches = pitches.map(p =>
        p.id === pitchId ? { ...p, shares_count: newSharesCount } : p
      );
      setPitches(updatedPitches);
      setFilteredPitches(updatedPitches);
    } catch (error) {
      console.error('Error sharing pitch:', error);
    }
  };

  const handleOpenComments = async (pitchId) => {
    setShowComments(pitchId);
    // Load comments from database
    if (!comments[pitchId]) {
      try {
        const pitchComments = await getPitchComments(pitchId);
        setComments(prev => ({ ...prev, [pitchId]: pitchComments }));
      } catch (error) {
        console.error('Error loading comments:', error);
        setComments(prev => ({ ...prev, [pitchId]: [] }));
      }
    }
  };

  const handleAddComment = async (pitchId) => {
    if (!newComment.trim()) return;
    if (!currentUser) {
      alert('Please sign in to comment');
      return;
    }

    try {
      const userName = currentUser.user_metadata?.full_name || currentUser.email?.split('@')[0] || 'Anonymous';
      const result = await addPitchComment(pitchId, currentUser.id, userName, newComment.trim());

      if (result.success) {
        // Add to local state
        const newCommentObj = result.data;
        setComments(prev => ({
          ...prev,
          [pitchId]: [newCommentObj, ...(prev[pitchId] || [])]
        }));

        // Update comment count
        const updatedPitches = pitches.map(p =>
          p.id === pitchId ? { ...p, comments_count: (p.comments_count || 0) + 1 } : p
        );
        setPitches(updatedPitches);
        setFilteredPitches(updatedPitches);

        setNewComment('');
      }
    } catch (error) {
      console.error('Error adding comment:', error);
      alert('Failed to add comment');
    }
  };

  const handleDeletePitch = async (pitch) => {
    if (!confirm(`Delete pitch "${pitch.title}"? This cannot be undone.`)) {
      return;
    }

    try {
      const result = await deletePitch(pitch.id);
      if (result.success) {
        // Remove from pitches list
        const updatedPitches = pitches.filter(p => p.id !== pitch.id);
        setPitches(updatedPitches);
        setFilteredPitches(updatedPitches);
        console.log('✅ Pitch deleted successfully');
      } else {
        alert('Error deleting pitch: ' + result.error);
      }
    } catch (error) {
      console.error('Error deleting pitch:', error);
      alert('Error deleting pitch');
    }
  };

  const handleVideoError = (pitchId, event) => {
    console.error(`❌ Video failed to load for pitch ${pitchId}`);
    const errorCode = event?.target?.error?.code;
    const errorMessage = event?.target?.error?.message || 'Unknown error';
    
    console.error('   Error code:', errorCode);
    console.error('   Error message:', errorMessage);
    console.error('');
    
    // Handle QUIC protocol errors (ERR_QUIC_PROTOCOL_ERROR)
    if (errorMessage?.includes('QUIC') || errorCode === 4) {
      console.error('   🌐 QUIC PROTOCOL ERROR DETECTED');
      console.error('   Attempting HTTP/1.1 fallback...');
      
      // Retry with HTTP/1.1 by fetching a fresh signed URL
      const retryWithHTTP11 = async () => {
        try {
          const { getSupabase } = await import('../services/pitchingService');
          const sb = getSupabase();
          if (!sb) return;
          
          // Try to reload the video element or notify user
          console.log('   Retrying video load with HTTP/1.1 protocol...');
          // Reload the same URL (browser may auto-upgrade to HTTP/1.1)
          event.target.load();
        } catch (err) {
          console.error('   Failed to retry:', err);
          setVideoErrors(prev => ({
            ...prev,
            [pitchId]: true
          }));
        }
      };
      
      // Retry after brief delay
      setTimeout(retryWithHTTP11, 500);
      return;
    }
    
    console.error('   📊 VIDEO ERROR DIAGNOSTICS:');
    console.error('   1️⃣  RLS Policy Issue (most likely):');
    console.error('      → Go to Supabase Dashboard');
    console.error('      → Storage → pitches bucket → Policies tab');
    console.error('      → Ensure "Anyone can view pitch videos" policy is ENABLED (green checkmark)');
    console.error('   2️⃣  WebM Format Issue:');
    console.error('      → Some browsers don\'t support WebM');
    console.error('      → Try converting videos to MP4 format');
    console.error('   3️⃣  CORS Issue:');
    console.error('      → Check browser Network tab for 403/CORS errors');
    console.error('      → Supabase CORS may need configuration');
    console.error('   4️⃣  Invalid URL:');
    console.error('      → Video URL:', event?.target?.src);
    
    setVideoErrors({
      ...videoErrors,
      [pitchId]: true
    });
  };

  const handleVideoLoadedMetadata = (pitchId, event) => {
    // Detect video orientation based on dimensions
    const video = event.target;
    const width = video.videoWidth;
    const height = video.videoHeight;
    const isPortrait = height > width;
    
    setVideoOrientations(prev => ({
      ...prev,
      [pitchId]: isPortrait ? 'portrait' : 'landscape'
    }));
    
    console.log(`📹 Video loaded - ${pitchId}: ${width}x${height} (${isPortrait ? 'PORTRAIT' : 'LANDSCAPE'})`);
  };

  const handleCreatePitchClick = () => {
    if (!currentUser) {
      alert('Please login to create a pitch');
      return;
    }
    if (!currentBusinessProfile) {
      if (businessProfiles.length > 0) {
        setShowProfileSelector(true);
      } else {
        setShowBusinessForm(true);
      }
      return;
    }
    setShowRecorder(true);
  };

  const handleSmartContractClick = (pitch) => {
    if (!currentUser) {
      alert('Please login to invest');
      return;
    }
    if (!currentBusinessProfile) {
      if (businessProfiles.length > 0) {
        setShowProfileSelector(true);
      } else {
        setShowBusinessForm(true);
      }
      return;
    }
    // Use ShareSigningFlow for investment
    setSelectedForInvestment(pitch);
  };

  const handleBusinessProfileCreated = async (profile) => {
    try {
      const newProfile = {
        ...profile,
        user_id: currentUser.id
      };
      
      // Reload profiles from database (owned + co-owned)
      if (currentUser) {
        const updatedProfiles = await getAllAccessibleBusinessProfiles(currentUser.id, currentUser.email);
        setBusinessProfiles(updatedProfiles);
        if (updatedProfiles.length > 0) {
          setCurrentBusinessProfile(updatedProfiles[0]);
        }
      }
      
      // Clear editing state and close form
      setEditingProfile(null);
      setShowBusinessForm(false);
      
      // Create notification
      await createNotification({
        recipient_id: currentUser.id,
        notification_type: 'profile_created',
        title: 'Business Profile Updated',
        message: `Your business profile has been saved successfully.`
      });
    } catch (error) {
      console.error('Error saving business profile:', error);
    }
  };

  const handleSelectBusinessProfile = (profile) => {
    setCurrentBusinessProfile(profile);
    setShowProfileSelector(false);
  };

  const handleDeleteBusinessProfile = async (profileId) => {
    try {
      await deleteProfileService(profileId);
      if (currentBusinessProfile?.id === profileId) {
        setCurrentBusinessProfile(null);
      }
      setBusinessProfiles(businessProfiles.filter(p => p.id !== profileId));
    } catch (error) {
      console.error('Error deleting business profile:', error);
    }
  };

  const formatCurrency = (amount) => {
    if (!amount) return '$0';
    return `$${(amount / 1000).toFixed(0)}K`;
  };

  const formatDate = (timestamp) => {
    if (!timestamp) return 'recently';
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    
    if (hours < 1) return 'just now';
    if (hours < 24) return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
    if (days < 7) return `${days} day${days !== 1 ? 's' : ''} ago`;
    return date.toLocaleDateString();
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 overflow-hidden">
      {/* Demo Mode Banner */}
      {!supabaseReady && (
        <div className="bg-amber-500/20 border-b border-amber-500/50 text-amber-200 px-6 py-3">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <p className="text-sm">
              <strong>Demo Mode:</strong> Supabase not configured. Using sample data. 
              <a href="https://supabase.com" target="_blank" rel="noopener noreferrer" className="underline ml-2">
                Configure Supabase →
              </a>
            </p>
          </div>
        </div>
      )}

      {/* Collapsed Header - Small Business Profile Icon */}
      <div className="sticky top-0 z-40 bg-gradient-to-r from-purple-900/80 to-pink-900/80 backdrop-blur border-b border-purple-500/30">
        <div className="px-4 py-4 flex items-center justify-between">
          {/* Business Profile Icon - Left */}
          <button
            onClick={() => setShowProfileSelector(true)}
            className="flex items-center gap-3 hover:bg-white/10 px-3 py-2 rounded-lg transition"
          >
            <div className="w-10 h-10 bg-gradient-to-br from-pink-500 to-purple-500 rounded-lg flex items-center justify-center shadow-lg">
              <Building2 className="w-5 h-5 text-white" />
            </div>
            <div className="hidden sm:block text-left">
              <h1 className="text-sm font-bold text-white">Pitchin</h1>
              <p className="text-xs text-gray-300">Share your vision</p>
            </div>
          </button>

          {/* Tab Buttons - Center */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveTab('feed')}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition ${
                activeTab === 'feed'
                  ? 'bg-pink-500 text-white'
                  : 'bg-white/10 text-gray-300 hover:bg-white/20'
              }`}
            >
              Available
            </button>
            <button
              onClick={() => setActiveTab('myPitches')}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition ${
                activeTab === 'myPitches'
                  ? 'bg-purple-500 text-white'
                  : 'bg-white/10 text-gray-300 hover:bg-white/20'
              }`}
            >
              My Pitches
            </button>
            <button
              onClick={() => setActiveTab('interested')}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition ${
                activeTab === 'interested'
                  ? 'bg-blue-500 text-white'
                  : 'bg-white/10 text-gray-300 hover:bg-white/20'
              }`}
            >
              Pending Votes
            </button>
          </div>

          {/* Action Icons - Right */}
          <div className="flex items-center gap-2">
            {/* Like Icon */}
            <button
              title="Like"
              className="p-2 hover:bg-white/10 rounded-lg transition flex items-center justify-center"
              onClick={() => alert('❤️ Like functionality')}
            >
              <Heart className="w-5 h-5 text-red-400" />
            </button>

            {/* Comment Icon */}
            <button
              title="Comment"
              className="p-2 hover:bg-white/10 rounded-lg transition flex items-center justify-center"
              onClick={() => alert('💬 Comment functionality')}
            >
              <MessageCircle className="w-5 h-5 text-blue-400" />
            </button>

            {/* Invest Icon */}
            <button
              title="Invest"
              className="p-2 hover:bg-white/10 rounded-lg transition flex items-center justify-center"
              onClick={() => alert('💰 Invest functionality')}
            >
              <Zap className="w-5 h-5 text-yellow-400" />
            </button>

            {/* Share Icon */}
            <button
              title="Share"
              className="p-2 hover:bg-white/10 rounded-lg transition flex items-center justify-center"
              onClick={() => alert('🔗 Share functionality')}
            >
              <Share2 className="w-5 h-5 text-green-400" />
            </button>

            {/* Create Button */}
            <button
              onClick={() => {
                handleCreatePitchClick();
              }}
              className="ml-2 px-4 py-2 bg-gradient-to-r from-pink-500 to-purple-500 hover:from-pink-600 hover:to-purple-600 text-white rounded-lg font-semibold transition flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">Create</span>
            </button>

            {/* Profile Button */}
            <button
              onClick={() => setShowProfileSelector(true)}
              className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg font-semibold transition flex items-center gap-2"
            >
              <Building2 className="w-4 h-4" />
              <span className="hidden sm:inline">Profile</span>
            </button>
          </div>
        </div>
      </div>

      {/* Business Profile Section - Minimal Collapsed View - HIDDEN */}
      {/* Now accessible via overlay icon in video feed */}
      {/* 
      {currentUser && currentBusinessProfile && (
        <div className="border-t border-slate-700 bg-slate-900/50">
          <div className="max-w-7xl mx-auto px-4 py-3">
            {!showProfileDetails ? (
              // Ultra-compact view - just company name
              <button
                onClick={() => setShowProfileDetails(true)}
                className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-slate-800 transition"
              >
                <Building2 className="w-5 h-5 text-blue-400 flex-shrink-0" />
                <span className="text-sm font-semibold text-white truncate">
                  {currentBusinessProfile.name}
                </span>
              </button>
            ) : (
              // Expanded view - show full details
              <>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-bold text-white flex items-center gap-2">
                    <Building2 className="w-5 h-5 text-blue-400" />
                    Business Profile
                  </h2>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setShowBusinessForm(true)}
                      className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium flex items-center gap-2 transition"
                    >
                      <Plus className="w-4 h-4" />
                      New Profile
                    </button>
                    <button
                      onClick={() => setShowProfileDetails(false)}
                      className="bg-slate-700 hover:bg-slate-600 text-white px-3 py-2 rounded-lg font-medium transition"
                    >
                      ✕
                    </button>
                  </div>
                </div>
                
                {currentBusinessProfile ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <BusinessProfileCard 
                      profile={currentBusinessProfile} 
                      onEdit={() => setShowProfileSelector(true)}
                      onSelect={() => {}} 
                    />
                    {businessProfiles.length > 1 && (
                      <button
                        onClick={() => setShowProfileSelector(true)}
                        className="bg-slate-800 hover:bg-slate-700 border border-slate-600 hover:border-blue-500 rounded-xl p-5 transition flex items-center justify-center text-slate-300 hover:text-blue-400"
                      >
                        <div className="text-center">
                          <p className="font-semibold mb-1">Switch Profile</p>
                          <p className="text-sm">{businessProfiles.length - 1} more profile{businessProfiles.length - 1 !== 1 ? 's' : ''}</p>
                        </div>
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="bg-slate-800 border border-dashed border-slate-600 rounded-xl p-8 text-center">
                    <Building2 className="w-12 h-12 text-slate-500 mx-auto mb-3 opacity-50" />
                    <p className="text-slate-400 mb-4">No business profile yet</p>
                    <button
                      onClick={() => setShowBusinessForm(true)}
                      className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-medium transition"
                    >
                      Create First Profile
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
      */}

      {/* Main Content - Full screen on mobile */}
      <div className="fixed inset-0 w-screen h-screen md:relative md:inset-auto md:w-full md:h-auto px-0 py-0 md:py-8 overflow-hidden md:overflow-visible bg-slate-900">
        {showRecorder ? (
          <div className="w-full h-full md:h-auto flex flex-col md:flex-row md:items-center md:justify-center px-4 md:px-8 py-4 md:py-8">
            <div className="w-full max-w-4xl">
              <button
                onClick={() => {
                  setShowRecorder(false);
                  if (onClosePitchCreator) onClosePitchCreator();
                }}
                className="text-slate-400 hover:text-slate-200 mb-6 font-medium flex items-center gap-2 text-lg"
              >
                ← Back to Pitches
              </button>
              <PitchVideoRecorder 
                onPitchCreated={handleCreatePitch} 
                onClose={() => {
                  setShowRecorder(false);
                  if (onClosePitchCreator) onClosePitchCreator();
                }}
                currentBusinessProfile={currentBusinessProfile}
              />
            </div>
          </div>
        ) : (
          <>
            {/* Pitch Feed - Full-Screen TikTok-Style with Snap Scroll */}
            <div className="h-full w-full overflow-y-auto snap-y snap-mandatory scroll-smooth" ref={videoScrollRef}>
              {loading ? (
                // Creative Full-Screen Loading Experience with Video Preview
                <div className="fixed inset-0 z-50 bg-black flex items-center justify-center overflow-hidden">
                  {/* Full-Screen Video Background */}
                  <div className="absolute inset-0 w-full h-full">
                    {/* Fallback animated gradient pattern - shows by default */}
                    <div className="w-full h-full bg-gradient-to-br from-purple-900 via-black to-pink-900">
                      <div className="absolute top-0 left-0 w-96 h-96 bg-purple-500/30 rounded-full blur-3xl animate-blob"></div>
                      <div className="absolute top-0 right-0 w-96 h-96 bg-pink-500/30 rounded-full blur-3xl animate-blob animation-delay-2000"></div>
                      <div className="absolute bottom-0 left-1/2 w-96 h-96 bg-orange-500/30 rounded-full blur-3xl animate-blob animation-delay-4000"></div>
                    </div>
                    {/* Dark overlay for better text visibility */}
                    <div className="absolute inset-0 bg-black/40"></div>
                  </div>

                  {/* Floating Transparent Icons */}
                  <div className="absolute inset-0 overflow-hidden pointer-events-none">
                    {/* Icon 1 - Briefcase */}
                    <div className="absolute top-20 left-10 animate-float" style={{ animationDelay: '0s' }}>
                      <Briefcase className="w-16 h-16 text-white/20 drop-shadow-lg" />
                    </div>
                    {/* Icon 2 - Users */}
                    <div className="absolute top-40 right-20 animate-float" style={{ animationDelay: '0.5s' }}>
                      <Users className="w-20 h-20 text-white/20 drop-shadow-lg" />
                    </div>
                    {/* Icon 3 - Zap */}
                    <div className="absolute bottom-32 left-20 animate-float" style={{ animationDelay: '1s' }}>
                      <Zap className="w-14 h-14 text-white/20 drop-shadow-lg" />
                    </div>
                    {/* Icon 4 - Share */}
                    <div className="absolute bottom-20 right-32 animate-float" style={{ animationDelay: '1.5s' }}>
                      <Share2 className="w-12 h-12 text-white/20 drop-shadow-lg" />
                    </div>
                    {/* Icon 5 - Heart */}
                    <div className="absolute top-1/3 left-1/4 animate-float" style={{ animationDelay: '2s' }}>
                      <Heart className="w-18 h-18 text-white/20 drop-shadow-lg" />
                    </div>
                    {/* Icon 6 - Play */}
                    <div className="absolute top-1/2 right-1/4 animate-float" style={{ animationDelay: '2.5s' }}>
                      <Play className="w-16 h-16 text-white/20 drop-shadow-lg" />
                    </div>
                  </div>

                  {/* Center Content */}
                  <div className="relative z-10 text-center space-y-6 px-4">
                    {/* Logo with Glow */}
                    <div className="flex justify-center mb-6">
                      <div className="relative">
                        <Briefcase className="w-24 h-24 text-white animate-pulse-slow drop-shadow-2xl" />
                        <div className="absolute inset-0 bg-purple-500/50 blur-3xl animate-pulse"></div>
                      </div>
                    </div>

                    {/* Pitchin Text */}
                    <h1 className="text-6xl font-black text-transparent bg-clip-text bg-gradient-to-r from-purple-400 via-pink-400 to-orange-400 animate-gradient-x">
                      Pitchin
                    </h1>
                    
                    {/* Tagline */}
                    <p className="text-xl text-gray-300 font-light tracking-wide animate-fade-in">
                      Where Ideas Meet Investment
                    </p>

                    {/* Loading Animation */}
                    <div className="flex items-center justify-center gap-2 pt-4">
                      <div className="w-3 h-3 bg-purple-500 rounded-full animate-bounce" style={{ animationDelay: '0s' }}></div>
                      <div className="w-3 h-3 bg-pink-500 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                      <div className="w-3 h-3 bg-orange-500 rounded-full animate-bounce" style={{ animationDelay: '0.4s' }}></div>
                    </div>

                    {/* Loading Text */}
                    <p className="text-sm text-gray-400 animate-pulse">
                      Loading amazing pitches...
                    </p>

                    {/* Floating Stats */}
                    <div className="grid grid-cols-3 gap-4 mt-8 max-w-md mx-auto">
                      <div className="bg-white/5 backdrop-blur-sm rounded-lg p-3 border border-white/10 animate-fade-in" style={{ animationDelay: '0.3s' }}>
                        <div className="text-2xl font-bold text-purple-400">100+</div>
                        <div className="text-xs text-gray-400">Pitches</div>
                      </div>
                      <div className="bg-white/5 backdrop-blur-sm rounded-lg p-3 border border-white/10 animate-fade-in" style={{ animationDelay: '0.6s' }}>
                        <div className="text-2xl font-bold text-pink-400">50+</div>
                        <div className="text-xs text-gray-400">Investors</div>
                      </div>
                      <div className="bg-white/5 backdrop-blur-sm rounded-lg p-3 border border-white/10 animate-fade-in" style={{ animationDelay: '0.9s' }}>
                        <div className="text-2xl font-bold text-orange-400">$1M+</div>
                        <div className="text-xs text-gray-400">Funded</div>
                      </div>
                    </div>
                  </div>

                  {/* Bottom Wave Effect */}
                  <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-black to-transparent"></div>
                </div>
              ) : filteredPitches.length === 0 ? (
                <div className="col-span-full text-center py-12">
                  <Zap className="w-12 h-12 text-slate-500 mx-auto mb-4" />
                  <p className="text-slate-400">No pitches available yet</p>
                </div>
              ) : (
                filteredPitches.map((pitch) => (
                  <div
                    key={pitch.id}
                    className="relative w-full h-screen snap-start bg-black overflow-hidden"
                  >
                    {/* Full-Screen Video Background */}
                    <div className="absolute inset-0 w-full h-full bg-gradient-to-br from-purple-600 to-pink-600 flex items-center justify-center">
                      {!pitch.video_url || videoErrors[pitch.id] ? (
                        <div className="w-full h-full flex items-center justify-center">
                          <AlertCircle className="w-12 h-12 text-slate-500" />
                        </div>
                      ) : (
                        <>
                          <video
                            src={pitch.video_url}
                            className="w-full h-full object-cover"
                            crossOrigin="anonymous"
                            onError={(event) => handleVideoError(pitch.id, event)}
                            onLoadedMetadata={(event) => handleVideoLoadedMetadata(pitch.id, event)}
                          />
                          <button
                            onClick={() => setVideoPlayerPitch(pitch)}
                            className="absolute inset-0 flex items-center justify-center"
                          >
                            <div className="w-20 h-20 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center hover:scale-110 transition-transform">
                              <Play className="w-10 h-10 text-white fill-white ml-1" />
                            </div>
                          </button>
                        </>
                      )}
                    </div>

                    {/* Right Side Action Buttons - TikTok Style */}
                    <div className="absolute right-3 bottom-24 flex flex-col gap-4 z-10">
                      {/* Like Button */}
                      <button
                        onClick={() => handleLike(pitch.id)}
                        className="flex flex-col items-center gap-1"
                        title="Like"
                      >
                        <div className={`w-12 h-12 rounded-full flex items-center justify-center backdrop-blur-md transition-all ${
                          likedPitches.has(pitch.id)
                            ? 'bg-red-500/80 scale-110'
                            : 'bg-black/40 hover:bg-black/60'
                        }`}>
                          <Heart className={`w-6 h-6 ${likedPitches.has(pitch.id) ? 'text-white fill-white' : 'text-white'}`} />
                        </div>
                        <span className="text-white text-xs font-semibold drop-shadow-lg">{pitch.likes_count || 0}</span>
                      </button>

                      {/* Comment Button */}
                      <button
                        onClick={() => handleOpenComments(pitch.id)}
                        className="flex flex-col items-center gap-1"
                        title="Comment"
                      >
                        <div className="w-12 h-12 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center hover:bg-black/60 transition-all">
                          <MessageCircle className="w-6 h-6 text-white" />
                        </div>
                        <span className="text-white text-xs font-semibold drop-shadow-lg">{pitch.comments_count || 0}</span>
                      </button>

                      {/* Share Button */}
                      <button
                        onClick={() => handleShare(pitch.id)}
                        className="flex flex-col items-center gap-1"
                        title="Share"
                      >
                        <div className="w-12 h-12 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center hover:bg-black/60 transition-all">
                          <Share2 className="w-6 h-6 text-white" />
                        </div>
                        <span className="text-white text-xs font-semibold drop-shadow-lg">{pitch.shares_count || 1}</span>
                      </button>

                      {/* Invest Button - Highlighted */}
                      <button
                        onClick={() => handleSmartContractClick(pitch)}
                        className="flex flex-col items-center gap-1"
                        title="Invest"
                      >
                        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-yellow-500 to-orange-500 flex items-center justify-center animate-pulse-slow shadow-lg shadow-yellow-500/50 hover:scale-110 transition-transform">
                          <Zap className="w-6 h-6 text-white fill-white" />
                        </div>
                        <span className="text-yellow-300 text-xs font-bold drop-shadow-lg">Invest</span>
                      </button>
                    </div>

                    {/* Bottom Info Section */}
                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent px-4 pb-20 pt-8">
                      {/* Creator Info */}
                      <div className="flex items-center gap-3 mb-3">
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
                          <Building2 className="w-5 h-5 text-white" />
                        </div>
                        <div>
                          <p className="text-white font-semibold text-sm drop-shadow-lg">
                            {pitch.business_profiles?.business_name || 'Business'}
                          </p>
                          <p className="text-gray-300 text-xs">{formatDate(pitch.created_at)}</p>
                        </div>
                      </div>

                      {/* Title */}
                      <h3 className="text-white font-bold text-lg mb-2 drop-shadow-lg line-clamp-2">
                        {pitch.title}
                      </h3>

                      {/* Description */}
                      <p className="text-gray-200 text-sm mb-3 line-clamp-2 drop-shadow-lg">
                        {pitch.description}
                      </p>

                      {/* Funding Info - Compact */}
                      <div className="flex gap-4 text-xs">
                        <div>
                          <span className="text-gray-400">Target: </span>
                          <span className="text-white font-bold">{formatCurrency(pitch.target_funding)}</span>
                        </div>
                        <div>
                          <span className="text-gray-400">Equity: </span>
                          <span className="text-purple-300 font-bold">{pitch.equity_offering || 0}%</span>
                        </div>
                        {pitch.has_ip && (
                          <div className="bg-blue-500/30 backdrop-blur-sm text-blue-300 px-2 py-0.5 rounded-full text-xs font-semibold border border-blue-400/30">
                            IP ✓
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </div>

      {/* Smart Contract Modal */}
      {selectedForContract && (
        <SmartContractGenerator
          pitch={selectedForContract}
          onClose={() => setSelectedForContract(null)}
          businessProfile={currentBusinessProfile}
          currentUser={currentUser}
        />
      )}

      {/* Share Signing & Investment Flow Modal */}
      {selectedForInvestment && (
        <ShareSigningFlow
          pitch={selectedForInvestment}
          onClose={() => setSelectedForInvestment(null)}
          businessProfile={currentBusinessProfile}
          currentUser={currentUser}
        />
      )}

      {/* Business Profile Form Modal */}
      {showBusinessForm && (
        <BusinessProfileForm
          onProfileCreated={handleBusinessProfileCreated}
          onCancel={() => {
            setShowBusinessForm(false);
            setEditingProfile(null);
          }}
          userId={currentUser?.id}
          editingProfile={editingProfile}
        />
      )}

      {/* Business Profile Selector Modal */}
      {showProfileSelector && (
        <BusinessProfileSelector
          profiles={businessProfiles}
          currentProfile={currentBusinessProfile}
          currentUserId={currentUser?.id}
          currentUserEmail={currentUser?.email}
          onSelectProfile={handleSelectBusinessProfile}
          onCreateNew={() => {
            setShowProfileSelector(false);
            setShowBusinessForm(true);
            setEditingProfile(null);
          }}
          onEdit={async (profile) => {
            const permission = await checkBusinessProfileEditPermission(
              profile.id, 
              currentUser?.id, 
              currentUser?.email
            );
            
            if (!permission.canEdit) {
              alert(`⚠️ Cannot edit: ${permission.reason}`);
              return;
            }
            
            setEditingProfile(profile);
            setShowProfileSelector(false);
            setShowBusinessForm(true);
          }}
          onDelete={handleDeleteBusinessProfile}
          onWalletClick={(profile) => {
            setShowProfileSelector(false);
            setShowWallet(true);
          }}
        />
      )}

      {/* Comments Modal */}
      {showComments && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-2xl w-full max-w-lg max-h-[80vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-slate-700">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <MessageCircle className="w-5 h-5 text-blue-400" />
                Comments
              </h3>
              <button
                onClick={() => setShowComments(null)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-700 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Comments List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {(!comments[showComments] || comments[showComments]?.length === 0) ? (
                <div className="text-center py-8">
                  <MessageCircle className="w-12 h-12 text-slate-600 mx-auto mb-3" />
                  <p className="text-slate-400">No comments yet</p>
                  <p className="text-slate-500 text-sm">Be the first to comment!</p>
                </div>
              ) : (
                (comments[showComments] || []).map((comment) => (
                  <div key={comment.id} className="bg-slate-700/50 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white text-xs font-bold">
                        {(comment.user_name || comment.user?.name || 'U')[0]?.toUpperCase()}
                      </div>
                      <div className="flex-1">
                        <p className="text-white font-medium text-sm">{comment.user_name || comment.user?.name || 'Anonymous'}</p>
                        <p className="text-slate-500 text-xs">
                          {new Date(comment.created_at || comment.timestamp).toLocaleDateString()} at{' '}
                          {new Date(comment.created_at || comment.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                    </div>
                    <p className="text-slate-300 text-sm pl-10">{comment.comment_text || comment.text}</p>
                  </div>
                ))
              )}
            </div>

            {/* Comment Input */}
            <div className="p-4 border-t border-slate-700">
              {currentUser ? (
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handleAddComment(showComments)}
                    placeholder="Write a comment..."
                    className="flex-1 bg-slate-700 text-white rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 placeholder-slate-400"
                  />
                  <button
                    onClick={() => handleAddComment(showComments)}
                    disabled={!newComment.trim()}
                    className="bg-purple-600 hover:bg-purple-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white p-2 rounded-lg transition"
                  >
                    <Send className="w-5 h-5" />
                  </button>
                </div>
              ) : (
                <p className="text-center text-slate-400 text-sm">
                  Please sign in to comment
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Mobile Pitch Detail Modal - Shows SHAREHub-style UI */}
      {showMobilePitchDetail && selectedMobilePitch && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 md:hidden flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between p-4 bg-slate-900/95 border-b border-slate-700">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <span className="text-2xl">🎥</span>
              Pitch Details
            </h2>
            <button
              onClick={() => {
                setShowMobilePitchDetail(false);
                setSelectedMobilePitch(null);
              }}
              className="p-1 rounded-lg hover:bg-slate-800 transition text-slate-400 hover:text-white"
            >
              <X className="w-6 h-6" />
            </button>
          </div>

          {/* Content - Full screen scroll */}
          <div className="flex-1 overflow-y-auto">
            {/* Pitch Content Goes Here */}
          </div>
        </div>
      )}

      {/* Smart Contract Modal */}
      {selectedForContract && (
        <SmartContractGenerator
          pitch={selectedForContract}
          onClose={() => setSelectedForContract(null)}
          businessProfile={currentBusinessProfile}
          currentUser={currentUser}
        />
      )}

      {/* Share Signing & Investment Flow Modal */}
      {selectedForInvestment && (
        <ShareSigningFlow
          pitch={selectedForInvestment}
          onClose={() => setSelectedForInvestment(null)}
          businessProfile={currentBusinessProfile}
          currentUser={currentUser}
        />
      )}

      {/* Business Profile Form Modal */}
      {showBusinessForm && (
        <BusinessProfileForm
          onProfileCreated={handleBusinessProfileCreated}
          onCancel={() => {
            setShowBusinessForm(false);
            setEditingProfile(null);
          }}
          userId={currentUser?.id}
          editingProfile={editingProfile}
        />
      )}

      {/* Business Profile Selector Modal */}
      {showProfileSelector && (
        <BusinessProfileSelector
          profiles={businessProfiles}
          currentProfile={currentBusinessProfile}
          currentUserId={currentUser?.id}
          currentUserEmail={currentUser?.email}
          onSelectProfile={handleSelectBusinessProfile}
          onCreateNew={() => {
            setShowProfileSelector(false);
            setShowBusinessForm(true);
            setEditingProfile(null);
          }}
          onEdit={async (profile) => {
            // Check if user has permission to edit
            const permission = await checkBusinessProfileEditPermission(
              profile.id, 
              currentUser?.id, 
              currentUser?.email
            );
            
            if (!permission.canEdit) {
              alert(`⚠️ Cannot edit: ${permission.reason}`);
              return;
            }
            
            setEditingProfile(profile);
            setShowProfileSelector(false);
            setShowBusinessForm(true);
          }}
          onDelete={handleDeleteBusinessProfile}
          onWalletClick={(profile) => {
            setShowProfileSelector(false);
            setShowWallet(true);
          }}
        />
      )}

      {/* Comments Modal */}
      {showComments && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-2xl w-full max-w-lg max-h-[80vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-slate-700">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <MessageCircle className="w-5 h-5 text-blue-400" />
                Comments
              </h3>
              <button
                onClick={() => setShowComments(null)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-700 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Comments List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {(!comments[showComments] || comments[showComments]?.length === 0) ? (
                <div className="text-center py-8">
                  <MessageCircle className="w-12 h-12 text-slate-600 mx-auto mb-3" />
                  <p className="text-slate-400">No comments yet</p>
                  <p className="text-slate-500 text-sm">Be the first to comment!</p>
                </div>
              ) : (
                (comments[showComments] || []).map((comment) => (
                  <div key={comment.id} className="bg-slate-700/50 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white text-xs font-bold">
                        {(comment.user_name || comment.user?.name || 'U')[0]?.toUpperCase()}
                      </div>
                      <div className="flex-1">
                        <p className="text-white font-medium text-sm">{comment.user_name || comment.user?.name || 'Anonymous'}</p>
                        <p className="text-slate-500 text-xs">
                          {new Date(comment.created_at || comment.timestamp).toLocaleDateString()} at{' '}
                          {new Date(comment.created_at || comment.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                    </div>
                    <p className="text-slate-300 text-sm pl-10">{comment.comment_text || comment.text}</p>
                  </div>
                ))
              )}
            </div>

            {/* Comment Input */}
            <div className="p-4 border-t border-slate-700">
              {currentUser ? (
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handleAddComment(showComments)}
                    placeholder="Write a comment..."
                    className="flex-1 bg-slate-700 text-white rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 placeholder-slate-400"
                  />
                  <button
                    onClick={() => handleAddComment(showComments)}
                    disabled={!newComment.trim()}
                    className="bg-purple-600 hover:bg-purple-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white p-2 rounded-lg transition"
                  >
                    <Send className="w-5 h-5" />
                  </button>
                </div>
              ) : (
                <p className="text-center text-slate-400 text-sm">
                  Please sign in to comment
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Mobile Pitch Detail Modal - Shows Full Web Pitchin UI */}
      {showMobilePitchDetail && (
        <div className="fixed inset-0 bg-black/80 z-50 md:hidden flex flex-col">
          {/* Header with Close Button */}
          <div className="sticky top-0 z-30 bg-gradient-to-r from-purple-900/95 to-pink-900/95 p-4 flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Share2 className="w-6 h-6 text-pink-400" />
                <span className="text-xl font-bold text-white">Pitchin</span>
              </div>
              <p className="text-xs text-purple-200">Share your vision, connect with investors</p>
            </div>
            <button
              onClick={() => {
                setShowMobilePitchDetail(false);
                setSelectedMobilePitch(null);
              }}
              className="p-2 rounded-lg hover:bg-slate-800 transition text-slate-400 hover:text-white flex-shrink-0"
            >
              <X className="w-6 h-6" />
            </button>
          </div>

          {/* Tab Filters */}
          <div className="bg-slate-900/50 border-b border-slate-700 px-4 py-3 flex gap-2 overflow-x-auto">
            <button
              onClick={() => setActiveTab('feed')}
              className={`flex-shrink-0 px-4 py-2 rounded-full font-semibold transition whitespace-nowrap ${
                activeTab === 'feed'
                  ? 'bg-purple-600 text-white'
                  : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }`}
            >
              🎥 Available
            </button>
            <button
              onClick={() => setActiveTab('myPitches')}
              className={`flex-shrink-0 px-4 py-2 rounded-full font-semibold transition whitespace-nowrap ${
                activeTab === 'myPitches'
                  ? 'bg-purple-600 text-white'
                  : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }`}
            >
              🎬 My Pitches
            </button>
            <button
              onClick={() => setActiveTab('interested')}
              className={`flex-shrink-0 px-4 py-2 rounded-full font-semibold transition whitespace-nowrap ${
                activeTab === 'interested'
                  ? 'bg-purple-600 text-white'
                  : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }`}
            >
              🗳️ Pending Votes
            </button>
          </div>

          {/* Content - Pitch Grid */}
          <div className="flex-1 overflow-y-auto p-4">
            <div className="grid grid-cols-1 gap-4">
              {loading ? (
                <>
                  {[...Array(3)].map((_, idx) => (
                    <div key={idx} className="bg-slate-800/60 rounded-lg overflow-hidden animate-pulse">
                      <div className="aspect-video bg-gradient-to-r from-slate-700 to-slate-800"></div>
                      <div className="p-4 space-y-2">
                        <div className="h-4 bg-gradient-to-r from-slate-700 to-slate-800 rounded w-3/4"></div>
                        <div className="h-3 bg-gradient-to-r from-slate-700 to-slate-800 rounded w-1/2"></div>
                      </div>
                    </div>
                  ))}
                </>
              ) : filteredPitches.length === 0 ? (
                <div className="col-span-full text-center py-8">
                  <Zap className="w-12 h-12 text-slate-500 mx-auto mb-4" />
                  <p className="text-slate-400">No pitches available</p>
                </div>
              ) : (
                filteredPitches.map((pitch) => (
                  <div
                    key={pitch.id}
                    className="bg-slate-800/60 backdrop-blur border border-slate-700 hover:border-pink-500/50 rounded-lg overflow-hidden hover:shadow-2xl hover:shadow-purple-500/30 transition-all group"
                  >
                    {/* Thumbnail */}
                    <div className="relative w-full aspect-video bg-black flex items-center justify-center">
                      {!pitch.video_url || videoErrors[pitch.id] ? (
                        <AlertCircle className="w-8 h-8 text-slate-500" />
                      ) : (
                        <>
                          <video
                            src={pitch.video_url}
                            className="w-full h-full object-cover opacity-50 group-hover:opacity-70 transition"
                            crossOrigin="anonymous"
                            onError={(event) => handleVideoError(pitch.id, event)}
                          />
                          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition">
                            <Play className="w-12 h-12 text-white fill-white" />
                          </div>
                        </>
                      )}
                      {pitch.has_ip && (
                        <div className="absolute top-2 right-2 bg-blue-500/30 text-blue-300 px-2 py-1 rounded text-xs font-semibold">
                          IP ✓
                        </div>
                      )}
                    </div>

                    {/* Content */}
                    <div className="p-4">
                      <h3 className="text-base font-bold text-white mb-1 line-clamp-2 group-hover:text-pink-400 transition">
                        {pitch.title}
                      </h3>
                      <p className="text-sm text-gray-400 mb-3">
                        {pitch.business_profiles?.business_name || 'Unknown'}
                      </p>
                      <p className="text-xs text-slate-400 mb-3 line-clamp-2">
                        {pitch.description}
                      </p>

                      {/* Funding Info */}
                      <div className="grid grid-cols-3 gap-2 bg-white/5 p-2 rounded mb-3">
                        <div className="text-center">
                          <p className="text-xs text-slate-400">Raised</p>
                          <p className="text-xs font-bold text-white">{formatCurrency(pitch.raised_amount)}</p>
                        </div>
                        <div className="text-center border-x border-white/10">
                          <p className="text-xs text-slate-400">Goal</p>
                          <p className="text-xs font-bold text-white">{formatCurrency(pitch.target_funding)}</p>
                        </div>
                        <div className="text-center">
                          <p className="text-xs text-slate-400">Equity</p>
                          <p className="text-xs font-bold text-white">{pitch.equity_offering || 0}%</p>
                        </div>
                      </div>

                      {/* Action Buttons with Icons */}
                      <div className="flex gap-2">
                        {/* Like Button */}
                        <button
                          onClick={() => handleLike(pitch.id)}
                          className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg text-xs font-medium transition-all ${
                            likedPitches.has(pitch.id)
                              ? 'bg-red-500/40 hover:bg-red-500/50 text-red-300'
                              : 'bg-slate-700/50 hover:bg-red-500/30 text-slate-300'
                          }`}
                          title="Like"
                        >
                          <Heart className="w-4 h-4" />
                          <span>{pitch.likes_count || 0}</span>
                        </button>

                        {/* Comment Button */}
                        <button
                          onClick={() => handleOpenComments(pitch.id)}
                          className="flex-1 flex items-center justify-center gap-1.5 px-2 py-2 bg-slate-700/50 hover:bg-blue-500/30 text-slate-300 rounded-lg text-xs font-medium transition-all"
                          title="Comment"
                        >
                          <MessageCircle className="w-4 h-4" />
                          <span>{pitch.comments_count || 0}</span>
                        </button>

                        {/* Invest Button */}
                        <button
                          onClick={() => handleSmartContractClick(pitch)}
                          className="flex-1 flex items-center justify-center gap-1.5 px-2 py-2 bg-gradient-to-r from-yellow-500/40 to-orange-500/40 hover:from-yellow-500/50 hover:to-orange-500/50 text-yellow-300 rounded-lg text-xs font-medium transition-all"
                          title="Invest"
                        >
                          <Zap className="w-4 h-4" />
                          <span>Invest</span>
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Fullscreen Video Player Modal */}
      {videoPlayerPitch && (
        <div className="fixed inset-0 bg-black z-50 w-screen h-screen overflow-hidden">
          {/* Close Button */}
          <button
            onClick={() => setVideoPlayerPitch(null)}
            className="absolute top-4 right-4 z-30 p-2 sm:p-3 bg-black/50 hover:bg-black/80 text-white rounded-lg transition"
          >
            <X className="w-6 h-6 sm:w-8 sm:h-8" />
          </button>

          {/* Video Container - True Fullscreen, No Flex */}
          <div className="absolute inset-0 w-screen h-screen bg-black">
            {!videoPlayerPitch.video_url || videoErrors[videoPlayerPitch.id] ? (
              <div className="w-full h-full flex flex-col items-center justify-center gap-4">
                <AlertCircle className="w-16 h-16 sm:w-20 sm:h-20 text-slate-500" />
                <p className="text-slate-400 text-lg sm:text-xl">Video unavailable</p>
              </div>
            ) : (
              <video
                src={videoPlayerPitch.video_url}
                className="w-full h-full object-cover"
                controls
                autoPlay
                crossOrigin="anonymous"
                preload="auto"
                onError={(event) => handleVideoError(videoPlayerPitch.id, event)}
                controlsList="nodownload"
              />
            )}
          </div>

          {/* Pitch Info Bottom Bar - Overlaid on Video */}
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black via-black/90 to-transparent p-4 sm:p-6 z-20 pointer-events-none">
            <h3 className="text-base sm:text-lg font-bold text-white mb-1">{videoPlayerPitch.title}</h3>
            <p className="text-xs sm:text-sm text-gray-300">{videoPlayerPitch.business_profiles?.business_name}</p>
            
            {/* Quick Stats - Mobile Optimized */}
            <div className="flex gap-3 mt-3 sm:mt-4 text-xs sm:text-sm">
              <div className="flex items-center gap-1">
                <span>👍</span>
                <span className="text-gray-300">{videoPlayerPitch.likes_count || 0}</span>
              </div>
              <div className="flex items-center gap-1">
                <span>💬</span>
                <span className="text-gray-300">{videoPlayerPitch.comments_count || 0}</span>
              </div>
              <div className="flex items-center gap-1">
                <span>🔗</span>
                <span className="text-gray-300">{videoPlayerPitch.shares_count || 0}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Shimmer Animation CSS */}
      <style>{`
        @keyframes shimmer {
          0% {
            transform: translateX(-100%);
          }
          100% {
            transform: translateX(100%);
          }
        }
        
        .animate-shimmer {
          animation: shimmer 2s infinite;
        }
      `}</style>
    </div>
  );
};

export default Pitchin;
