import React, { useState, useRef } from 'react';
import { 
  X, 
  Video, 
  Target, 
  TrendingUp, 
  Heart, 
  Gift,
  Flame,
  Zap,
  Users,
  Award,
  Download,
  Calendar,
  Lock,
  FileText,
  Shield,
  Award as Badge,
  Eye,
  Plus
} from 'lucide-react';
import Pitchin from './Pitchin';

const SHAREHub = ({ onClose, openCreateForm = false }) => {
  const [activeTab, setActiveTab] = useState('pitchin');
  const [headerExpanded, setHeaderExpanded] = useState(true);
  const [showPitchCreator, setShowPitchCreator] = useState(openCreateForm);
  const videoInputRef = useRef(null);
  const fileInputRef = useRef(null);
  const [toolbarExpanded, setToolbarExpanded] = useState(true);

  const tabs = [
    {
      id: 'pitchin',
      label: 'Pitchin',
      icon: Video,
      badge: 'Hot',
      badgeColor: 'bg-red-500',
      component: 'pitchin'
    },
    // {
    //   id: 'opportunities',
    //   label: 'Opportunities',
    //   icon: Target,
    //   component: 'opportunities'
    // },
    // {
    //   id: 'myPitches',
    //   label: 'My Pitches',
    //   icon: Zap,
    //   component: 'myPitches'
    // },
    // {
    //   id: 'invest',
    //   label: 'Invest',
    //   icon: TrendingUp,
    //   component: 'invest'
    // },
    {
      id: 'grants',
      label: 'Grants',
      icon: Gift,
      component: 'grants'
    }
  ];

  // Render content based on active tab
  const renderContent = () => {
    switch (activeTab) {
      case 'pitchin':
        return (
          <div>
            {/* Featured Pitches Grid - Web Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-6 mb-8">
              {[1, 2, 3, 4, 5, 6].map((item) => (
                <div
                  key={item}
                  className="glass-card overflow-hidden hover:bg-white/10 transition-all cursor-pointer border border-white/10 hover:border-pink-500/50 group"
                >
                  {/* Thumbnail - Video Preview */}
                  <div className="relative w-full aspect-video bg-gradient-to-br from-purple-600 to-pink-600 overflow-hidden flex items-center justify-center">
                    <span className="text-5xl opacity-50 group-hover:opacity-100 transition">🎬</span>
                    <div className="absolute inset-0 bg-black/20 group-hover:bg-black/10 transition"></div>
                  </div>

                  {/* Content */}
                  <div className="p-4 md:p-6">
                    {/* Header */}
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <h3 className="text-base md:text-lg font-bold text-white mb-1">
                          Pitch {item}
                        </h3>
                        <p className="text-xs text-gray-400">Entrepreneur Network</p>
                      </div>
                      <span className="px-2 md:px-3 py-0.5 md:py-1 text-xs font-medium bg-pink-500/30 text-pink-300 rounded-full whitespace-nowrap">
                        Trending
                      </span>
                    </div>

                    {/* Description */}
                    <p className="text-gray-400 text-xs md:text-sm mb-4 line-clamp-2">
                      Innovative business solution connecting entrepreneurs with investors worldwide.
                    </p>

                    {/* Stats */}
                    <div className="grid grid-cols-3 gap-2 mb-4 bg-white/5 p-3 rounded-lg">
                      <div className="text-center">
                        <p className="text-xs text-gray-500">RAISED</p>
                        <p className="text-sm font-bold text-white">UGX {(50000000 * item).toLocaleString()}</p>
                      </div>
                      <div className="text-center border-x border-white/10">
                        <p className="text-xs text-gray-500">GOAL</p>
                        <p className="text-sm font-bold text-white">UGX {(100000000 * item).toLocaleString()}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-xs text-gray-500">EQUITY</p>
                        <p className="text-sm font-bold text-white">{10 + item}%</p>
                      </div>
                    </div>

                    {/* Progress Bar */}
                    <div className="mb-4">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-gray-400">Funding Progress</span>
                        <span className="text-xs font-bold text-pink-400">{50 - item * 5}%</span>
                      </div>
                      <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-gradient-to-r from-pink-500 to-purple-500 rounded-full transition-all"
                          style={{width: `${50 - item * 5}%`}}
                        ></div>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2">
                      <button className="flex-1 px-3 py-2 bg-gradient-to-r from-pink-500 to-purple-500 hover:from-pink-600 hover:to-purple-600 text-white rounded-lg text-xs md:text-sm font-medium transition-all">
                        View Pitch
                      </button>
                      <button className="flex-1 px-3 py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg text-xs md:text-sm font-medium transition-all">
                        💰 Invest
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Full Pitchin Component Below */}
            <div className="mt-12 pt-8 border-t border-white/10">
              <h2 className="text-2xl font-bold text-white mb-6">All Active Pitches</h2>
              <Pitchin onOpenCreate={() => setShowPitchCreator(true)} showPitchCreator={showPitchCreator} onClosePitchCreator={() => setShowPitchCreator(false)} />
            </div>
          </div>
        );
      
      case 'opportunities':
        return (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-2 gap-3 md:gap-6">
            {[1, 2, 3, 4].map((item) => (
              <div
                key={item}
                className="glass-card p-4 md:p-6 hover:bg-white/10 transition-all cursor-pointer border border-white/10 hover:border-blue-500/50"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="p-2 md:p-3 bg-blue-500/30 rounded-lg flex-shrink-0">
                    <Target className="w-5 md:w-6 h-5 md:h-6 text-blue-400" />
                  </div>
                  <span className="px-2 md:px-3 py-0.5 md:py-1 text-xs font-medium bg-green-500/30 text-green-300 rounded-full whitespace-nowrap">
                    Open
                  </span>
                </div>
                <h3 className="text-base md:text-lg font-bold text-white mb-2">
                  Opportunity {item}
                </h3>
                <p className="text-gray-400 text-xs md:text-sm mb-4">
                  Explore exciting business and investment opportunities in your network.
                </p>
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
                  <span className="text-xs text-gray-500">Min: UGX {(100000 * item).toLocaleString()}</span>
                  <button className="w-full sm:w-auto px-3 md:px-4 py-2 md:py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs md:text-sm font-medium transition-colors">
                    Learn More
                  </button>
                </div>
              </div>
            ))}
          </div>
        );
      
      case 'myPitches':
        return (
          <div className="text-center py-12">
            <Zap className="w-16 h-16 text-gray-500 mx-auto mb-4" />
            <h3 className="text-2xl font-bold text-white mb-2">Your Pitches</h3>
            <p className="text-gray-400 mb-6">
              You haven't created any pitches yet. Go to the Pitchin tab to create your first pitch!
            </p>
            <button
              onClick={() => setActiveTab('pitchin')}
              className="px-6 py-3 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white rounded-lg font-medium transition-all"
            >
              Create Your First Pitch
            </button>
          </div>
        );
      
      case 'invest':
        return (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {[1, 2, 3, 4].map((item) => (
              <div
                key={item}
                className="glass-card p-6 hover:bg-white/10 transition-all cursor-pointer border border-white/10 hover:border-green-500/50"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="p-3 bg-green-500/30 rounded-lg">
                    <TrendingUp className="w-6 h-6 text-green-400" />
                  </div>
                  <span className="px-3 py-1 text-xs font-medium bg-blue-500/30 text-blue-300 rounded-full">
                    {Math.floor(Math.random() * 20) + 8}% Return
                  </span>
                </div>
                <h3 className="text-lg font-bold text-white mb-2">
                  Investment {item}
                </h3>
                <p className="text-gray-400 text-sm mb-4">
                  High-potential investment opportunity with verified track record.
                </p>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500">UGX {(500000 * item).toLocaleString()}</span>
                  <button className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium transition-colors">
                    Invest Now
                  </button>
                </div>
              </div>
            ))}
          </div>
        );
      
      case 'grants':
        return (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-2 gap-3 md:gap-6">
            {[1, 2, 3, 4].map((item) => (
              <div
                key={item}
                className="glass-card p-4 md:p-6 hover:bg-white/10 transition-all cursor-pointer border border-white/10 hover:border-purple-500/50"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="p-2 md:p-3 bg-purple-500/30 rounded-lg flex-shrink-0">
                    <Gift className="w-5 md:w-6 h-5 md:h-6 text-purple-400" />
                  </div>
                  <span className="px-2 md:px-3 py-0.5 md:py-1 text-xs font-medium bg-purple-500/30 text-purple-300 rounded-full whitespace-nowrap">
                    Grant
                  </span>
                </div>
                <h3 className="text-base md:text-lg font-bold text-white mb-2">
                  {['Tech Innovation', 'Social Impact', 'Agriculture', 'Education'][item - 1]} Grant
                </h3>
                <p className="text-gray-400 text-xs md:text-sm mb-4">
                  Non-repayable grant for eligible businesses and entrepreneurs.
                </p>
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
                  <span className="text-xs text-gray-500">Up to UGX {(10000000 * item).toLocaleString()}</span>
                  <button className="w-full sm:w-auto px-3 md:px-4 py-2 md:py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-xs md:text-sm font-medium transition-colors">
                    Apply Now
                  </button>
                </div>
              </div>
            ))}
          </div>
        );
      
      default:
        return null;
    }
  };

  // Toolbar action handlers
  const handleRecordVideo = () => {
    // Trigger video input
    videoInputRef.current?.click();
  };

  const handleImportMedia = () => {
    // Trigger file input
    fileInputRef.current?.click();
  };

  const handleCreatePitch = () => {
    // Switch to Pitchin tab and open creator
    setActiveTab('pitchin');
    setShowPitchCreator(true);
    setTimeout(() => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }, 100);
  };

  const handleSchedulePitch = () => {
    alert('Schedule Pitch - Coming Soon!\n\nYou can schedule your pitch to be published at a specific time.');
  };

  const handlePrivacySettings = () => {
    alert('Privacy Settings - Coming Soon!\n\nManage who can view and interact with your pitches.');
  };

  const handleAddDocuments = () => {
    alert('Add Documents - Coming Soon!\n\nAttach business plans, financial statements, and other documents to your pitch.');
  };

  const handleVerifyPitch = () => {
    alert('Verify & Secure - Coming Soon!\n\nEnsure your pitch is verified and secure with blockchain technology.');
  };

  const handleAddCredentials = () => {
    alert('Add Credentials - Coming Soon!\n\nAdd certificates, awards, and professional credentials to build trust.');
  };

  const handleViewAnalytics = () => {
    alert('Analytics & Views - Coming Soon!\n\nTrack pitch views, engagement, and investor interest in real-time.');
  };

  const handleCollaborate = () => {
    alert('Collaborate with Team - Coming Soon!\n\nInvite team members to co-create and manage pitches together.');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-3 md:p-8">
      {/* Close button */}
      <button
        onClick={onClose}
        className="fixed top-4 md:top-6 right-4 md:right-6 z-50 p-2 hover:bg-white/10 rounded-lg transition-colors"
      >
        <X className="w-5 md:w-6 h-5 md:h-6 text-white" />
      </button>

      <div className="max-w-6xl mx-auto">
        {/* Pitchin Header - Always Visible */}
        {activeTab === 'pitchin' && (
          <div className="mb-8 md:mb-12 text-center">
            {/* Desktop: Full Header */}
            <div className="hidden md:block pt-4">
              <div className="inline-block mb-4">
                <div className="w-16 h-16 bg-gradient-to-br from-pink-500 to-purple-500 rounded-xl flex items-center justify-center shadow-lg shadow-pink-500/30 mx-auto mb-4">
                  <span className="text-3xl">🎥</span>
                </div>
              </div>
              <h1 className="text-5xl font-bold mb-3 bg-gradient-to-r from-pink-400 to-purple-400 bg-clip-text text-transparent">
                Pitchin
              </h1>
              <p className="text-xl text-gray-300 mb-6">
                Share your vision, connect with investors
              </p>
              {/* Icon Grid - Desktop */}
              <div className="flex justify-center items-center gap-8 md:gap-12 text-center">
                <div className="flex flex-col items-center">
                  <span className="text-4xl mb-2">🎥</span>
                  <span className="text-sm text-gray-400">Available</span>
                </div>
                <div className="flex flex-col items-center">
                  <span className="text-4xl mb-2">🎬</span>
                  <span className="text-sm text-gray-400">My Pitches</span>
                </div>
                <div className="flex flex-col items-center">
                  <span className="text-4xl mb-2">📹</span>
                  <span className="text-sm text-gray-400">Record</span>
                </div>
                <div className="flex flex-col items-center">
                  <span className="text-4xl mb-2">🎤</span>
                  <span className="text-sm text-gray-400">Voice</span>
                </div>
                <div className="flex flex-col items-center">
                  <span className="text-4xl mb-2">🗳️</span>
                  <span className="text-sm text-gray-400">Pending Votes</span>
                </div>
                <div className="flex flex-col items-center">
                  <span className="text-4xl mb-2">⏳</span>
                  <span className="text-sm text-gray-400">In Progress</span>
                </div>
              </div>
            </div>

            {/* Mobile: Compact Header */}
            <div className="md:hidden pt-2">
              <h1 className="text-3xl font-bold mb-2 bg-gradient-to-r from-pink-400 to-purple-400 bg-clip-text text-transparent">
                Pitchin
              </h1>
              <p className="text-sm text-gray-300 mb-4">
                Share your vision, connect with investors
              </p>
              {/* Icon Grid - Mobile (Same as Desktop) */}
              <div className="flex justify-center items-center gap-4 flex-wrap">
                <div className="flex flex-col items-center">
                  <span className="text-2xl mb-1">🎥</span>
                  <span className="text-xs text-gray-400">Available</span>
                </div>
                <div className="flex flex-col items-center">
                  <span className="text-2xl mb-1">🎬</span>
                  <span className="text-xs text-gray-400">My Pitches</span>
                </div>
                <div className="flex flex-col items-center">
                  <span className="text-2xl mb-1">📹</span>
                  <span className="text-xs text-gray-400">Record</span>
                </div>
                <div className="flex flex-col items-center">
                  <span className="text-2xl mb-1">🎤</span>
                  <span className="text-xs text-gray-400">Voice</span>
                </div>
                <div className="flex flex-col items-center">
                  <span className="text-2xl mb-1">🗳️</span>
                  <span className="text-xs text-gray-400">Pending Votes</span>
                </div>
                <div className="flex flex-col items-center">
                  <span className="text-2xl mb-1">⏳</span>
                  <span className="text-xs text-gray-400">In Progress</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tabs - Responsive */}
        <div className="flex flex-wrap gap-2 md:gap-3 mb-8 md:mb-12 justify-center px-1">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;

            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-3 md:px-6 py-2 md:py-3 rounded-lg md:rounded-xl font-medium flex items-center gap-2 transition-all whitespace-nowrap text-sm md:text-base ${
                  isActive
                    ? 'bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-lg shadow-blue-500/50'
                    : 'bg-white/10 text-gray-300 hover:bg-white/20 border border-white/20'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span className="hidden sm:inline">{tab.label}</span>
                <span className="sm:hidden text-xs">{tab.label}</span>
                {tab.badge && (
                  <span className={`ml-1 px-2 py-0.5 text-xs font-bold rounded-full ${tab.badgeColor} text-white`}>
                    {tab.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Enhanced Toolbar - Action Icons */}
        <div className="flex flex-wrap gap-2 md:gap-3 mb-8 justify-center items-center px-1 pb-4 border-b border-white/10">
          {/* Video Record Button */}
          <button
            onClick={handleRecordVideo}
            className="p-2.5 md:p-3 bg-gradient-to-br from-red-500 to-pink-600 hover:from-red-600 hover:to-pink-700 text-white rounded-lg transition-all transform hover:scale-110 shadow-lg hover:shadow-red-500/50"
            title="Record Video"
          >
            <Video className="w-5 h-5 md:w-6 md:h-6" />
          </button>

          {/* Import/Download Button */}
          <button
            onClick={handleImportMedia}
            className="p-2.5 md:p-3 bg-gradient-to-br from-blue-500 to-cyan-600 hover:from-blue-600 hover:to-cyan-700 text-white rounded-lg transition-all transform hover:scale-110 shadow-lg hover:shadow-blue-500/50"
            title="Import Media"
          >
            <Download className="w-5 h-5 md:w-6 md:h-6" />
          </button>

          {/* Create Pitch Button - Primary */}
          <button
            onClick={handleCreatePitch}
            className="px-4 md:px-6 py-2.5 md:py-3 bg-gradient-to-r from-pink-500 to-rose-600 hover:from-pink-600 hover:to-rose-700 text-white rounded-full font-bold flex items-center gap-2 transition-all transform hover:scale-110 shadow-lg hover:shadow-pink-500/50"
            title="Create New Pitch"
          >
            <Plus className="w-5 h-5 md:w-6 md:h-6" />
            <span className="hidden md:inline">Create</span>
          </button>

          {/* Calendar/Schedule Button */}
          <button
            onClick={handleSchedulePitch}
            className="p-2.5 md:p-3 bg-gradient-to-br from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white rounded-lg transition-all transform hover:scale-110 shadow-lg hover:shadow-amber-500/50"
            title="Schedule Pitch"
          >
            <Calendar className="w-5 h-5 md:w-6 md:h-6" />
          </button>

          {/* Lock/Security Button */}
          <button
            onClick={handlePrivacySettings}
            className="p-2.5 md:p-3 bg-gradient-to-br from-slate-600 to-slate-700 hover:from-slate-700 hover:to-slate-800 text-white rounded-lg transition-all transform hover:scale-110 shadow-lg hover:shadow-slate-500/50"
            title="Privacy Settings"
          >
            <Lock className="w-5 h-5 md:w-6 md:h-6" />
          </button>

          {/* Document/File Button */}
          <button
            onClick={handleAddDocuments}
            className="p-2.5 md:p-3 bg-gradient-to-br from-yellow-600 to-yellow-700 hover:from-yellow-700 hover:to-yellow-800 text-white rounded-lg transition-all transform hover:scale-110 shadow-lg hover:shadow-yellow-500/50"
            title="Add Documents"
          >
            <FileText className="w-5 h-5 md:w-6 md:h-6" />
          </button>

          {/* Shield/Verification Button */}
          <button
            onClick={handleVerifyPitch}
            className="p-2.5 md:p-3 bg-gradient-to-br from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white rounded-lg transition-all transform hover:scale-110 shadow-lg hover:shadow-emerald-500/50"
            title="Verify & Secure"
          >
            <Shield className="w-5 h-5 md:w-6 md:h-6" />
          </button>

          {/* Certificate/Badge Button */}
          <button
            onClick={handleAddCredentials}
            className="p-2.5 md:p-3 bg-gradient-to-br from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white rounded-lg transition-all transform hover:scale-110 shadow-lg hover:shadow-indigo-500/50"
            title="Add Credentials"
          >
            <Badge className="w-5 h-5 md:w-6 md:h-6" />
          </button>

          {/* Eye/Analytics Button */}
          <button
            onClick={handleViewAnalytics}
            className="p-2.5 md:p-3 bg-gradient-to-br from-violet-500 to-fuchsia-600 hover:from-violet-600 hover:to-fuchsia-700 text-white rounded-lg transition-all transform hover:scale-110 shadow-lg hover:shadow-violet-500/50"
            title="Analytics & Views"
          >
            <Eye className="w-5 h-5 md:w-6 md:h-6" />
          </button>

          {/* Users/Collaborate Button */}
          <button
            onClick={handleCollaborate}
            className="p-2.5 md:p-3 bg-gradient-to-br from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white rounded-lg transition-all transform hover:scale-110 shadow-lg hover:shadow-cyan-500/50"
            title="Collaborate with Team"
          >
            <Users className="w-5 h-5 md:w-6 md:h-6" />
          </button>

          {/* Hidden File Inputs */}
          <input
            ref={videoInputRef}
            type="file"
            accept="video/*"
            style={{ display: 'none' }}
            onChange={(e) => {
              if (e.target.files?.[0]) {
                alert(`Video selected: ${e.target.files[0].name}\n\nThis will be used in your pitch.`);
                setActiveTab('pitchin');
              }
            }}
          />
          <input
            ref={fileInputRef}
            type="file"
            accept="*/*"
            style={{ display: 'none' }}
            onChange={(e) => {
              if (e.target.files?.[0]) {
                alert(`File imported: ${e.target.files[0].name}\n\nThis will be attached to your pitch.`);
              }
            }}
          />
        </div>

        {/* Content */}
        <div className="animate-in fade-in duration-300 px-1 md:px-0">
          {renderContent()}
        </div>
      </div>
    </div>
  );
};

export default SHAREHub;
