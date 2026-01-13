import React, { useState, useRef, useEffect } from 'react';
import { ThumbsUp, MessageCircle, Share2, Clock, Users, FileText, Zap, AlertCircle, Building2, Loader, Plus, Trash2, Lock, Unlock, X, Send, Copy, Check, Play, Home, BookMarked, Heart } from 'lucide-react';
import PitchVideoRecorder from './PitchVideoRecorder';
import SmartContractGenerator from './SmartContractGenerator';
import BusinessProfileForm from './BusinessProfileForm';
import BusinessProfileSelector from './BusinessProfileSelector';
import BusinessProfileCard from './BusinessProfileCard';
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

const Pitchin = () => {
  const [pitches, setPitches] = useState([]);
  const [filteredPitches, setFilteredPitches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState(null);
  const [supabaseReady, setSupabaseReady] = useState(true);

  const [showRecorder, setShowRecorder] = useState(false);
  const [currentPitch, setCurrentPitch] = useState(null);
  const [activeTab, setActiveTab] = useState('feed');
  const [selectedForContract, setSelectedForContract] = useState(null);
  const [videoErrors, setVideoErrors] = useState({});
  const [businessProfiles, setBusinessProfiles] = useState([]);
  const [currentBusinessProfile, setCurrentBusinessProfile] = useState(null);
  const [showBusinessForm, setShowBusinessForm] = useState(false);
  const [showProfileSelector, setShowProfileSelector] = useState(false);
  const [showProfileDetails, setShowProfileDetails] = useState(false);
  const [editingProfile, setEditingProfile] = useState(null);
  const [likedPitches, setLikedPitches] = useState(new Set());
  const [showComments, setShowComments] = useState(null); // pitch id for comments modal
  const [comments, setComments] = useState({});
  const [newComment, setNewComment] = useState('');
  const [copiedPitchId, setCopiedPitchId] = useState(null);
  const [expandedPitchInfo, setExpandedPitchInfo] = useState(null); // pitch id for info tooltip
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
      setFilteredPitches(pitches); // TODO: Implement interested pitches
    }
  }, [activeTab, pitches, currentUser]);

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
      alert('Please login to create a smart contract');
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
    setSelectedForContract(pitch);
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
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      {/* Demo Mode Banner */}
      {!supabaseReady && (
        <div className="bg-amber-500/20 border-b border-amber-500/50 text-amber-200 px-4 py-3">
          <div className="max-w-7xl mx-auto flex items-center gap-2">
            <AlertCircle className="w-5 h-5" />
            <p className="text-sm">
              <strong>Demo Mode:</strong> Supabase not configured. Using sample data. 
              <a href="https://supabase.com" target="_blank" rel="noopener noreferrer" className="underline ml-2">
                Configure Supabase →
              </a>
            </p>
          </div>
        </div>
      )}

      {/* Header - Hidden on mobile, visible on desktop */}
      <div className="hidden md:block sticky top-0 z-40 bg-slate-900/95 backdrop-blur border-b border-slate-700">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-pink-500 rounded-lg flex items-center justify-center">
                <Zap className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
                  Pitchin
                </h1>
                {currentBusinessProfile && (
                  <button
                    onClick={() => setShowProfileSelector(true)}
                    className="text-xs text-slate-400 hover:text-slate-200 transition flex items-center gap-1"
                  >
                    <Building2 className="w-3 h-3" />
                    {currentBusinessProfile.businessName}
                  </button>
                )}
              </div>
            </div>
            {/* Create Pitch button - Now in overlay only */}
            {/* <button
              onClick={handleCreatePitchClick}
              className="bg-gradient-to-r from-purple-600 to-pink-600 text-white px-6 py-2 rounded-full font-semibold hover:shadow-lg hover:shadow-purple-500/50 transition flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">Create Pitch</span>
              <span className="sm:hidden">Create</span>
            </button> */}
          </div>

          {/* Navigation Tabs - Converted to Icon Buttons */}
          {/* Commented out - icons now only on video overlay */}
          {/* <div className="flex gap-2 mt-4">
            {/* Feed Icon Button */}
            {/* <button
              onClick={() => setActiveTab('feed')}
              title="Pitch Feed"
              className={`p-2.5 rounded-lg transition ${
                activeTab === 'feed'
                  ? 'bg-purple-500/50 text-purple-300'
                  : 'bg-slate-700/30 text-slate-400 hover:bg-slate-700/50 hover:text-slate-200'
              }`}
            >
              <Home className="w-5 h-5" />
            </button>
            
            {/* My Pitches Icon Button */}
            {/* <button
              onClick={() => setActiveTab('myPitches')}
              title="My Pitches"
              className={`p-2.5 rounded-lg transition ${
                activeTab === 'myPitches'
                  ? 'bg-purple-500/50 text-purple-300'
                  : 'bg-slate-700/30 text-slate-400 hover:bg-slate-700/50 hover:text-slate-200'
              }`}
            >
              <Zap className="w-5 h-5" />
            </button>
            
            {/* Interested Icon Button */}
            {/* <button
              onClick={() => setActiveTab('interested')}
              title="Interested"
              className={`p-2.5 rounded-lg transition ${
                activeTab === 'interested'
                  ? 'bg-purple-500/50 text-purple-300'
                  : 'bg-slate-700/30 text-slate-400 hover:bg-slate-700/50 hover:text-slate-200'
              }`}
            >
              <Heart className="w-5 h-5" />
            </button>
          </div> */}
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
      <div className="w-full h-screen md:h-auto max-w-7xl md:mx-auto px-0 md:px-8 py-0 md:py-8 min-h-screen md:min-h-auto">
        {showRecorder ? (
          <div className="mb-8 px-4 md:px-0">
            <button
              onClick={() => setShowRecorder(false)}
              className="text-slate-400 hover:text-slate-200 mb-4 font-medium"
            >
              ← Back
            </button>
            <PitchVideoRecorder onPitchCreated={handleCreatePitch} />
          </div>
        ) : (
          <>
            {/* Feed Grid */}
            <div
              ref={videoScrollRef}
              className="grid grid-cols-1 md:grid-cols-1 lg:grid-cols-2 gap-0 md:gap-8 h-screen md:h-auto w-full md:w-auto"
            >
              {loading ? (
                <div className="col-span-full flex items-center justify-center py-12">
                  <div className="text-center">
                    <Loader className="w-12 h-12 text-purple-400 animate-spin mx-auto mb-4" />
                    <p className="text-slate-400">Loading pitches...</p>
                  </div>
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
                    className="group bg-slate-800 rounded-none md:rounded-xl lg:rounded-2xl overflow-hidden hover:shadow-2xl hover:shadow-purple-500/20 transition border-0 md:border border-slate-700 hover:border-purple-500/50 flex flex-col h-full w-full md:h-auto"
                  >
                    {/* Video Container - Full screen on mobile */}
                    <div className="relative bg-black aspect-video md:aspect-video flex items-center justify-center overflow-hidden w-full h-full flex-shrink-0">
                      {!pitch.video_url || videoErrors[pitch.id] ? (
                        <div className="w-full h-full bg-gradient-to-br from-slate-800 to-slate-900 flex flex-col items-center justify-center gap-4">
                          <AlertCircle className="w-12 h-12 text-slate-500" />
                          <div className="text-center">
                            <p className="text-slate-400 font-semibold">Video unavailable</p>
                            <p className="text-slate-500 text-sm mt-1">{videoErrors[pitch.id] ? 'The pitch video could not be loaded' : 'No video uploaded for this pitch'}</p>
                          </div>
                        </div>
                      ) : (
                        <video
                          src={pitch.video_url}
                          className="w-full h-full object-cover"
                          controls
                          crossOrigin="anonymous"
                          onError={(event) => handleVideoError(pitch.id, event)}
                          onLoadStart={() => console.log(`📹 Loading video: ${pitch.video_url}`)}
                          onCanPlay={() => console.log(`✅ Video can play: ${pitch.id}`)}
                        />
                      )}
                      {/* Pitch Type Badge */}
                      <div className="absolute top-4 right-4 bg-gradient-to-r from-purple-600 to-pink-600 text-white px-3 py-1 rounded-full text-sm font-semibold">
                        {pitch.pitch_type || 'Equity'}
                      </div>
                      
                      {/* Info Icon Overlay - Bottom Right of Video */}
                      <button
                        onClick={() => setExpandedPitchInfo(expandedPitchInfo === pitch.id ? null : pitch.id)}
                        className="absolute bottom-3 md:bottom-4 right-3 md:right-4 p-1.5 md:p-2 bg-white/5 hover:bg-white/15 backdrop-blur-md text-white rounded-lg transition opacity-50 hover:opacity-75 z-10"
                        title="Pitch Details - Click to expand"
                      >
                        <FileText className="w-3 h-3 md:w-4 md:h-4" />
                        {/* Tooltip popup on click - Mobile optimized */}
                        {expandedPitchInfo === pitch.id && (
                          <div className="absolute bottom-full right-0 mb-2 bg-slate-800/95 backdrop-blur-md border border-slate-600 rounded-lg p-2 md:p-3 w-48 md:w-56 text-left text-xs shadow-lg z-20">
                            <p className="text-slate-400 flex items-center gap-1 mb-2">
                              <Clock className="w-2 h-2 md:w-3 md:h-3" />
                              {formatDate(pitch.created_at)}
                            </p>
                            <h4 className="text-white font-bold mb-1 text-xs md:text-sm">{pitch.title}</h4>
                            <p className="text-slate-300 text-xs mb-2">{pitch.business_profiles?.business_name}</p>
                            <p className="text-slate-400 text-xs mb-2 line-clamp-2">{pitch.description}</p>
                            
                            {/* Funding Info */}
                            <div className="grid grid-cols-3 gap-1 bg-slate-700/30 p-1.5 md:p-2 rounded mb-2">
                              <div>
                                <p className="text-slate-500 text-xs">RAISED</p>
                                <p className="text-white text-xs font-bold">{formatCurrency(pitch.raised_amount)}</p>
                              </div>
                              <div>
                                <p className="text-slate-500 text-xs">GOAL</p>
                                <p className="text-white text-xs font-bold">{formatCurrency(pitch.target_funding)}</p>
                              </div>
                              <div>
                                <p className="text-slate-500 text-xs">EQUITY</p>
                                <p className="text-white text-xs font-bold">{pitch.equity_offering || 0}%</p>
                              </div>
                            </div>

                            {/* Co-owners */}
                            {pitch.business_profiles?.business_co_owners && pitch.business_profiles.business_co_owners.length > 0 && (
                              <div className="flex items-center gap-1">
                                <Users className="w-3 h-3 text-slate-400" />
                                <p className="text-slate-400 text-xs">
                                  {pitch.business_profiles.business_co_owners.length} team member{pitch.business_profiles.business_co_owners.length !== 1 ? 's' : ''}
                                </p>
                                <div className="flex ml-1">
                                  {pitch.business_profiles.business_co_owners.slice(0, 2).map((member, idx) => (
                                    <div
                                      key={idx}
                                      className="w-4 h-4 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white text-xs font-bold -ml-1 first:ml-0"
                                      title={member.owner_name}
                                    >
                                      {member.owner_name[0]}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </button>
                      
                      <div className="absolute top-3 md:top-4 left-3 md:left-4 flex gap-1.5 md:gap-2">
                        {/* Create Pitch Icon */}
                        <button
                          onClick={handleCreatePitchClick}
                          title="Create Pitch"
                          className="p-1.5 md:p-2 bg-white/5 hover:bg-white/15 backdrop-blur-md text-white rounded-lg transition opacity-50 hover:opacity-75"
                        >
                          <Plus className="w-3 h-3 md:w-4 md:h-4" />
                        </button>
                        
                        {/* Feed Icon */}
                        <button
                          onClick={() => setActiveTab('feed')}
                          title="Feed"
                          className={`p-1.5 md:p-2 rounded-lg transition backdrop-blur-md ${
                            activeTab === 'feed'
                              ? 'bg-purple-500/50 text-white'
                              : 'bg-white/5 text-white/70 hover:bg-white/15 opacity-50 hover:opacity-75'
                          }`}
                        >
                          <Home className="w-3 h-3 md:w-4 md:h-4" />
                        </button>
                        
                        {/* My Pitches Icon */}
                        <button
                          onClick={() => setActiveTab('myPitches')}
                          title="My Pitches"
                          className={`p-1.5 md:p-2 rounded-lg transition backdrop-blur-md ${
                            activeTab === 'myPitches'
                              ? 'bg-purple-500/50 text-white'
                              : 'bg-white/5 text-white/70 hover:bg-white/15 opacity-50 hover:opacity-75'
                          }`}
                        >
                          <Zap className="w-3 h-3 md:w-4 md:h-4" />
                        </button>
                        
                        {/* Interested Icon */}
                        <button
                          onClick={() => setActiveTab('interested')}
                          title="Interested"
                          className={`p-1.5 md:p-2 rounded-lg transition backdrop-blur-md ${
                            activeTab === 'interested'
                              ? 'bg-purple-500/50 text-white'
                              : 'bg-white/5 text-white/70 hover:bg-white/15 opacity-50 hover:opacity-75'
                          }`}
                        >
                          <Heart className="w-3 h-3 md:w-4 md:h-4" />
                        </button>
                        
                        {/* Business Profile Icon */}
                        {currentBusinessProfile && (
                          <button
                            onClick={() => setShowProfileDetails(!showProfileDetails)}
                            title={currentBusinessProfile.name}
                            className="p-1.5 md:p-2 bg-white/5 hover:bg-white/15 backdrop-blur-md text-blue-300 rounded-lg transition opacity-50 hover:opacity-75"
                          >
                            <Building2 className="w-3 h-3 md:w-4 md:h-4" />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Pitch Info - Hidden, now in overlay */}
                    {/* <div className="p-6">
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex-1">
                          <p className="text-slate-400 text-sm flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {formatDate(pitch.created_at)}
                          </p>
                          <h3 className="text-xl font-bold text-white mt-1 group-hover:text-purple-400 transition">
                            {pitch.title}
                          </h3>
                          <p className="text-slate-300 mt-2">{pitch.business_profiles?.business_name}</p>
                        </div>
                        {pitch.has_ip && (
                          <span className="bg-blue-500/20 text-blue-300 px-2 py-1 rounded text-xs font-semibold">
                            IP ✓
                          </span>
                        )}
                      </div>

                      <p className="text-slate-400 text-sm mb-4">{pitch.description}</p>

                      {/* Funding Info */}
                      {/* <div className="grid grid-cols-3 gap-3 mb-4 bg-slate-700/50 p-3 rounded-lg">
                        <div>
                          <p className="text-slate-400 text-xs font-semibold">RAISED</p>
                          <p className="text-white font-bold">{formatCurrency(pitch.raised_amount)}</p>
                        </div>
                        <div>
                          <p className="text-slate-400 text-xs font-semibold">GOAL</p>
                          <p className="text-white font-bold">{formatCurrency(pitch.target_funding)}</p>
                        </div>
                        <div>
                          <p className="text-slate-400 text-xs font-semibold">EQUITY</p>
                          <p className="text-white font-bold">{pitch.equity_offering || 0}%</p>
                        </div>
                      </div> */}

                      {/* Co-owners */}
                      {/* {pitch.business_profiles?.business_co_owners && pitch.business_profiles.business_co_owners.length > 0 && (
                        <div className="flex items-center gap-2 mb-4">
                          <Users className="w-4 h-4 text-slate-400" />
                          <p className="text-slate-400 text-sm">
                            {pitch.business_profiles.business_co_owners.length} team member{pitch.business_profiles.business_co_owners.length !== 1 ? 's' : ''}
                          </p>
                          <div className="flex ml-2">
                            {pitch.business_profiles.business_co_owners.slice(0, 3).map((member, idx) => (
                              <div
                                key={idx}
                                className="w-6 h-6 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white text-xs font-bold -ml-2 first:ml-0 border border-slate-700"
                                title={member.owner_name}
                              >
                                {member.owner_name[0]}
                              </div>
                            ))}
                          </div>
                        </div>
                      )} */}

                      {/* Action Buttons */}
                      {/* <div className={`grid gap-2 ${pitch.business_profiles?.user_id === currentUser?.id ? 'grid-cols-5' : 'grid-cols-4'}`}>
                        <button
                          onClick={() => handleLike(pitch.id)}
                          className={`flex items-center justify-center gap-2 p-2 rounded-lg transition font-medium text-sm ${
                            likedPitches.has(pitch.id)
                              ? 'bg-purple-500/50 text-purple-200'
                              : 'bg-slate-700/50 hover:bg-purple-500/30 text-slate-300 hover:text-purple-300'
                          }`}
                          title={likedPitches.has(pitch.id) ? 'Unlike' : 'Like'}
                        >
                          <ThumbsUp className={`w-4 h-4 ${likedPitches.has(pitch.id) ? 'fill-current' : ''}`} />
                          {pitch.likes_count || 0}
                        </button>
                        <button 
                          onClick={() => handleOpenComments(pitch.id)}
                          className="flex items-center justify-center gap-2 bg-slate-700/50 hover:bg-blue-500/30 text-slate-300 hover:text-blue-300 p-2 rounded-lg transition font-medium text-sm"
                          title="View comments"
                        >
                          <MessageCircle className="w-4 h-4" />
                          {pitch.comments_count || 0}
                        </button>
                        <button
                          onClick={() => handleShare(pitch.id)}
                          className={`flex items-center justify-center gap-2 p-2 rounded-lg transition font-medium text-sm ${
                            copiedPitchId === pitch.id
                              ? 'bg-green-500/50 text-green-200'
                              : 'bg-slate-700/50 hover:bg-green-500/30 text-slate-300 hover:text-green-300'
                          }`}
                          title={copiedPitchId === pitch.id ? 'Link copied!' : 'Share'}
                        >
                          {copiedPitchId === pitch.id ? (
                            <Check className="w-4 h-4" />
                          ) : (
                            <Share2 className="w-4 h-4" />
                          )}
                          {pitch.shares_count || 0}
                        </button>
                        <button
                          onClick={() => handleSmartContractClick(pitch)}
                          className="flex items-center justify-center gap-2 bg-gradient-to-r from-purple-600/50 to-pink-600/50 hover:from-purple-600 hover:to-pink-600 text-white p-2 rounded-lg transition font-medium text-sm"
                        >
                          <FileText className="w-4 h-4" />
                          Sign
                        </button>
                        {/* Delete button - only visible to pitch creator */}
                        {/* {pitch.business_profiles?.user_id === currentUser?.id && (
                          <button
                            onClick={() => handleDeletePitch(pitch)}
                            className="flex items-center justify-center gap-2 bg-slate-700/50 hover:bg-red-500/30 text-slate-300 hover:text-red-300 p-2 rounded-lg transition font-medium text-sm"
                            title="Delete this pitch"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div> */}
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
          currentUserId={currentUser?.id}
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
    </div>
  );
};

export default Pitchin;
