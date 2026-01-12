import React, { useState } from 'react';
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
  Award
} from 'lucide-react';
import Pitchin from './Pitchin';

const SHAREHub = ({ onClose }) => {
  const [activeTab, setActiveTab] = useState('pitchin');
  const [headerExpanded, setHeaderExpanded] = useState(true);

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
        return <Pitchin />;
      
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
        {/* Header - Collapsible on Mobile - HIDDEN */}
        {/* <div className="mb-6 md:mb-12">
          {/* Desktop: Always visible */}
          {/* <div className="hidden md:block text-center mb-8 pt-4">
            <h1 className="text-5xl font-bold mb-3">
              <span className="gradient-text">🚀 SHARE Hub</span>
            </h1>
            <p className="text-xl text-gray-300">
              Share your pitches, explore grants, and discover investment opportunities
            </p>
          </div> */}

          {/* Mobile: Collapsible header */}
          {/* <div className="md:hidden">
            <button
              onClick={() => setHeaderExpanded(!headerExpanded)}
              className="flex items-center justify-center p-1.5 rounded-md bg-white/5 hover:bg-white/10 transition-all border border-white/10 mb-4 opacity-60 hover:opacity-100"
              title="Toggle SHARE Hub details"
            >
              <span className="text-lg">🚀</span>
            </button>
            
            {/* Expanded header content */}
            {/* {headerExpanded && (
              <div className="text-center pb-4 mb-4 animate-in fade-in duration-200">
                <h1 className="text-2xl font-bold mb-2">
                  <span className="gradient-text">🚀 SHARE Hub</span>
                </h1>
                <p className="text-xs text-gray-400">
                  Share pitches, explore grants, discover opportunities
                </p>
              </div>
            )}
          </div>
        </div> */}

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

        {/* Content */}
        <div className="animate-in fade-in duration-300 px-1 md:px-0">
          {renderContent()}
        </div>
      </div>
    </div>
  );
};

export default SHAREHub;
