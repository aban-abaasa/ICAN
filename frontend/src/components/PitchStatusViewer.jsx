import React, { useState, useEffect } from 'react';
import { 
  Upload, CheckCircle, AlertCircle, Clock, Zap, TrendingUp, Share2, Eye, 
  Heart, MessageCircle, User, Building2, Calendar, DollarSign, Percent,
  X, Play, Pause, Volume2, VolumeX
} from 'lucide-react';

const PitchStatusViewer = ({ pitch, onClose }) => {
  const [status, setStatus] = useState('uploaded'); // uploaded, processing, published, shared, live
  const [progress, setProgress] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const videoRef = React.useRef(null);

  // Simulate upload progress
  useEffect(() => {
    if (status === 'uploaded' && progress < 100) {
      const timer = setTimeout(() => {
        setProgress(prev => {
          if (prev >= 100) {
            setStatus('processing');
            return 100;
          }
          return prev + Math.random() * 15;
        });
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [progress, status]);

  // Simulate processing to published transition
  useEffect(() => {
    if (status === 'processing') {
      const timer = setTimeout(() => {
        setStatus('published');
        setProgress(100);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [status]);

  const getStatusColor = () => {
    switch (status) {
      case 'uploaded': return 'from-blue-500 to-cyan-500';
      case 'processing': return 'from-purple-500 to-pink-500';
      case 'published': return 'from-green-500 to-emerald-500';
      case 'shared': return 'from-orange-500 to-yellow-500';
      case 'live': return 'from-red-500 to-pink-500';
      default: return 'from-slate-500 to-slate-600';
    }
  };

  const getStatusIcon = () => {
    switch (status) {
      case 'uploaded': return <Upload className="w-6 h-6" />;
      case 'processing': return <Clock className="w-6 h-6 animate-spin" />;
      case 'published': return <CheckCircle className="w-6 h-6" />;
      case 'shared': return <Share2 className="w-6 h-6" />;
      case 'live': return <Zap className="w-6 h-6 animate-pulse" />;
      default: return <AlertCircle className="w-6 h-6" />;
    }
  };

  const getStatusText = () => {
    const statuses = {
      uploaded: { title: 'Uploading...', desc: 'Your pitch video is being uploaded' },
      processing: { title: 'Processing...', desc: 'Optimizing video quality and metadata' },
      published: { title: 'Published! 🎉', desc: 'Your pitch is now live on the platform' },
      shared: { title: 'Shared', desc: 'Your pitch has been shared with investors' },
      live: { title: 'Going Viral!', desc: 'Your pitch is trending' }
    };
    return statuses[status] || statuses.uploaded;
  };

  const stats = [
    { icon: Eye, label: 'Views', value: Math.floor(Math.random() * 500), color: 'blue' },
    { icon: Heart, label: 'Likes', value: Math.floor(Math.random() * 150), color: 'red' },
    { icon: MessageCircle, label: 'Comments', value: Math.floor(Math.random() * 50), color: 'green' },
    { icon: Share2, label: 'Shares', value: Math.floor(Math.random() * 30), color: 'orange' }
  ];

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-50 p-4">
      <div className="bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 rounded-2xl shadow-2xl max-w-2xl w-full border-2 border-purple-500/30 overflow-hidden">
        
        {/* Header */}
        <div className="relative h-64 bg-gradient-to-b from-slate-800 to-slate-900 border-b border-purple-500/30 overflow-hidden">
          {/* Animated Background */}
          <div className="absolute inset-0 opacity-30">
            <div className={`absolute inset-0 bg-gradient-to-r ${getStatusColor()} animate-pulse`}></div>
          </div>

          {/* Video Preview */}
          {pitch?.video_url ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <video
                ref={videoRef}
                src={pitch.video_url}
                className="w-full h-full object-cover"
                muted={isMuted}
              />
              <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                <button
                  onClick={() => setIsPlaying(!isPlaying)}
                  className="w-16 h-16 rounded-full bg-white/20 hover:bg-white/40 backdrop-blur-md flex items-center justify-center transition-all transform hover:scale-110"
                >
                  {isPlaying ? (
                    <Pause className="w-8 h-8 text-white" />
                  ) : (
                    <Play className="w-8 h-8 text-white ml-1" />
                  )}
                </button>
              </div>
            </div>
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center">
                <Play className="w-12 h-12 text-purple-300 mx-auto mb-2" />
                <p className="text-purple-200 text-sm">No video available</p>
              </div>
            </div>
          )}

          {/* Close Button */}
          <button
            onClick={onClose}
            className="absolute top-4 right-4 z-10 w-10 h-10 bg-black/50 hover:bg-black/70 rounded-full flex items-center justify-center transition-all border border-white/20"
          >
            <X className="w-5 h-5 text-white" />
          </button>
        </div>

        {/* Status Section */}
        <div className="p-6 space-y-6">
          {/* Main Status */}
          <div className="flex items-center gap-4">
            <div className={`w-16 h-16 rounded-full bg-gradient-to-r ${getStatusColor()} flex items-center justify-center text-white shadow-lg`}>
              {getStatusIcon()}
            </div>
            <div>
              <h3 className="text-2xl font-bold text-white">{getStatusText().title}</h3>
              <p className="text-purple-200 text-sm">{getStatusText().desc}</p>
            </div>
          </div>

          {/* Progress Bar */}
          {status !== 'published' && (
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-300">Progress</span>
                <span className="text-purple-300 font-bold">{Math.floor(progress)}%</span>
              </div>
              <div className="w-full h-2 bg-slate-700 rounded-full overflow-hidden border border-purple-500/30">
                <div
                  className={`h-full bg-gradient-to-r ${getStatusColor()} transition-all duration-500 rounded-full`}
                  style={{ width: `${progress}%` }}
                ></div>
              </div>
            </div>
          )}

          {/* Pitch Details */}
          <div className="bg-slate-800/50 rounded-lg p-4 border border-purple-500/20 space-y-3">
            <div className="flex items-start justify-between">
              <div>
                <h4 className="text-lg font-bold text-white">{pitch?.title || 'Untitled Pitch'}</h4>
                <p className="text-gray-400 text-sm mt-1">{pitch?.description}</p>
              </div>
            </div>

            {/* Pitch Info Grid */}
            <div className="grid grid-cols-2 gap-3 pt-3 border-t border-purple-500/20">
              {pitch?.business_profile_id && (
                <div className="flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-purple-400" />
                  <div>
                    <p className="text-xs text-gray-400">Business</p>
                    <p className="text-sm font-semibold text-white truncate">Profile #{pitch.business_profile_id.slice(0, 8)}</p>
                  </div>
                </div>
              )}
              {pitch?.target_funding && (
                <div className="flex items-center gap-2">
                  <DollarSign className="w-4 h-4 text-green-400" />
                  <div>
                    <p className="text-xs text-gray-400">Target</p>
                    <p className="text-sm font-semibold text-white">${pitch.target_funding.toLocaleString()}</p>
                  </div>
                </div>
              )}
              {pitch?.equity_offering && (
                <div className="flex items-center gap-2">
                  <Percent className="w-4 h-4 text-blue-400" />
                  <div>
                    <p className="text-xs text-gray-400">Equity</p>
                    <p className="text-sm font-semibold text-white">{pitch.equity_offering}%</p>
                  </div>
                </div>
              )}
              {pitch?.category && (
                <div className="flex items-center gap-2">
                  <Zap className="w-4 h-4 text-yellow-400" />
                  <div>
                    <p className="text-xs text-gray-400">Category</p>
                    <p className="text-sm font-semibold text-white">{pitch.category}</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-4 gap-2">
            {stats.map((stat, idx) => {
              const Icon = stat.icon;
              const colorMap = {
                blue: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
                red: 'bg-red-500/20 text-red-300 border-red-500/30',
                green: 'bg-green-500/20 text-green-300 border-green-500/30',
                orange: 'bg-orange-500/20 text-orange-300 border-orange-500/30'
              };
              return (
                <div key={idx} className={`rounded-lg p-3 border ${colorMap[stat.color]} text-center`}>
                  <Icon className="w-4 h-4 mx-auto mb-1" />
                  <p className="text-lg font-bold">{stat.value}</p>
                  <p className="text-xs opacity-80">{stat.label}</p>
                </div>
              );
            })}
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3 pt-4 border-t border-purple-500/20">
            <button
              onClick={() => setShowDetails(!showDetails)}
              className="flex-1 px-4 py-2 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white font-semibold rounded-lg transition-all transform hover:scale-105"
            >
              {showDetails ? '✖️ Hide' : '👁️ View Details'}
            </button>
            <button className="flex-1 px-4 py-2 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700 text-white font-semibold rounded-lg transition-all transform hover:scale-105">
              📤 Share
            </button>
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white font-semibold rounded-lg transition-all"
            >
              ✕ Close
            </button>
          </div>

          {/* Expandable Details */}
          {showDetails && (
            <div className="pt-4 border-t border-purple-500/20 space-y-2 animate-in fade-in">
              <p className="text-xs text-gray-400">Status Created: {new Date().toLocaleString()}</p>
              <p className="text-xs text-gray-400">Video Size: {pitch?.video_size ? `${(pitch.video_size / 1024 / 1024).toFixed(2)}MB` : 'N/A'}</p>
              <p className="text-xs text-gray-400">Pitch Type: {pitch?.pitch_type || 'N/A'}</p>
              <p className="text-xs text-gray-400">Status: {status.toUpperCase()}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PitchStatusViewer;
