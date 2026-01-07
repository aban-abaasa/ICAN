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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {[1, 2, 3, 4].map((item) => (
              <div
                key={item}
                className="glass-card p-6 hover:bg-white/10 transition-all cursor-pointer border border-white/10 hover:border-blue-500/50"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="p-3 bg-blue-500/30 rounded-lg">
                    <Target className="w-6 h-6 text-blue-400" />
                  </div>
                  <span className="px-3 py-1 text-xs font-medium bg-green-500/30 text-green-300 rounded-full">
                    Open
                  </span>
                </div>
                <h3 className="text-lg font-bold text-white mb-2">
                  Opportunity {item}
                </h3>
                <p className="text-gray-400 text-sm mb-4">
                  Explore exciting business and investment opportunities in your network.
                </p>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500">Min: UGX {(100000 * item).toLocaleString()}</span>
                  <button className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors">
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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {[1, 2, 3, 4].map((item) => (
              <div
                key={item}
                className="glass-card p-6 hover:bg-white/10 transition-all cursor-pointer border border-white/10 hover:border-purple-500/50"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="p-3 bg-purple-500/30 rounded-lg">
                    <Gift className="w-6 h-6 text-purple-400" />
                  </div>
                  <span className="px-3 py-1 text-xs font-medium bg-purple-500/30 text-purple-300 rounded-full">
                    Grant
                  </span>
                </div>
                <h3 className="text-lg font-bold text-white mb-2">
                  {['Tech Innovation', 'Social Impact', 'Agriculture', 'Education'][item - 1]} Grant
                </h3>
                <p className="text-gray-400 text-sm mb-4">
                  Non-repayable grant for eligible businesses and entrepreneurs.
                </p>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500">Up to UGX {(10000000 * item).toLocaleString()}</span>
                  <button className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-medium transition-colors">
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
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-8">
      {/* Close button */}
      <button
        onClick={onClose}
        className="fixed top-6 right-6 z-50 p-2 hover:bg-white/10 rounded-lg transition-colors"
      >
        <X className="w-6 h-6 text-white" />
      </button>

      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="text-center mb-12 pt-4">
          <h1 className="text-4xl md:text-5xl font-bold mb-3">
            <span className="gradient-text">🚀 SHARE Hub</span>
          </h1>
          <p className="text-xl text-gray-300">
            Share your pitches, explore grants, and discover investment opportunities
          </p>
        </div>

        {/* Tabs */}
        <div className="flex flex-wrap gap-3 mb-12 justify-center">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;

            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-6 py-3 rounded-xl font-medium flex items-center gap-2 transition-all whitespace-nowrap ${
                  isActive
                    ? 'bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-lg shadow-blue-500/50'
                    : 'bg-white/10 text-gray-300 hover:bg-white/20 border border-white/20'
                }`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
                {tab.badge && (
                  <span className={`ml-2 px-2 py-0.5 text-xs font-bold rounded-full ${tab.badgeColor} text-white`}>
                    {tab.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div className="animate-in fade-in duration-300">
          {renderContent()}
        </div>
      </div>
    </div>
  );
};

export default SHAREHub;
