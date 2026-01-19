/**
 * ConsolidatedNavigation Component
 * Single unified header with dropdown menus
 * Replaces both MainNavigation and inline tab system
 * Features: Dropdown functionality, mobile responsive, maintains all functionality
 */

import React, { useState, useRef, useEffect } from 'react';
import {
  Home,
  Shield,
  Globe,
  TrendingUp,
  Banknote,
  Settings,
  ChevronDown,
  Users,
  Lock,
  BarChart3,
  Target,
  Heart,
  Menu,
  X,
  Wallet,
  Send,
  DollarSign
} from 'lucide-react';

export const ConsolidatedNavigation = ({ 
  activeTab, 
  onTabChange, 
  onTrustClick, 
  onShareClick, 
  onWalletClick,
  profile,
  onStatusClick,
  onProfileClick,
  onShareSubTabChange,
  onTrustSubTabChange,
  onGrowthSubTabChange,
  onReadinessSubTabChange,
  onSecuritySubTabChange,
  onDashboardSubTabChange,
  onSettingsSubTabChange
}) => {
  const [expandedMenu, setExpandedMenu] = useState(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const dropdownRefs = useRef({});

  const navigationItems = [
    {
      id: 'dashboard',
      label: 'Dashboard',
      icon: BarChart3,
      submenu: [
        { label: 'Overview', id: 'dashboard', icon: Home },
        { label: 'Portfolio', id: 'portfolio', icon: BarChart3 },
        { label: 'Analytics', id: 'analytics', icon: TrendingUp }
      ]
    },
    {
      id: 'security',
      label: 'Security',
      icon: Shield,
      submenu: [
        { label: 'Account', id: 'security', icon: Lock },
        { label: 'Privacy', id: 'security-privacy', icon: Lock },
        { label: 'Verification', id: 'security-verify', icon: Shield }
      ]
    },
    {
      id: 'readiness',
      label: 'Readiness',
      icon: Globe,
      submenu: [
        { label: 'Status', id: 'readiness', icon: Globe },
        { label: 'Reports', id: 'readiness-reports', icon: BarChart3 }
      ]
    },
    {
      id: 'growth',
      label: 'Growth',
      icon: TrendingUp,
      submenu: [
        { label: 'Opportunities', id: 'growth', icon: Target },
        { label: 'Strategies', id: 'growth-strategies', icon: TrendingUp }
      ]
    },
    {
      id: 'trust',
      label: 'Trust',
      icon: Banknote,
      submenu: [
        { label: 'My Trusts', id: 'trust', icon: Banknote },
        { label: 'Explore', id: 'trust-explore', icon: Users },
        { label: 'Create', id: 'trust-create', icon: Target },
        { label: 'Dashboard', id: 'trust-dashboard', icon: BarChart3 }
      ]
    },
    {
      id: 'share',
      label: 'Share',
      icon: Send,
      submenu: [
        { label: 'Opportunities', id: 'share', icon: Banknote },
        { label: 'My Pitches', id: 'share-pitches', icon: Target },
        { label: 'Invest', id: 'share-invest', icon: TrendingUp },
        { label: 'Grants', id: 'share-grants', icon: Heart }
      ]
    },
    {
      id: 'wallet',
      label: 'Wallet',
      icon: DollarSign,
      isAction: true,
      action: onWalletClick,
      submenu: [
        { label: 'My Wallet', id: 'wallet', icon: Wallet },
        { label: 'Send Money', id: 'wallet-send', icon: Banknote },
        { label: 'Receive', id: 'wallet-receive', icon: TrendingUp },
        { label: 'Transactions', id: 'wallet-transactions', icon: BarChart3 },
        { label: 'Currency', id: 'wallet-currency', icon: Globe }
      ]
    },
    {
      id: 'settings',
      label: 'Settings',
      icon: Settings,
      submenu: [
        { label: 'Profile', id: 'settings-profile', icon: Home },
        { label: 'Preferences', id: 'settings-prefs', icon: Settings }
      ]
    }
  ];

  // Close menus when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setExpandedMenu(null);
      }
    };

    if (expandedMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [expandedMenu]);

  const handleMenuItemClick = (item) => {
    if (item.isAction && item.action) {
      item.action();
      setExpandedMenu(null);
      setMobileMenuOpen(false);
    } else if (item.submenu) {
      setExpandedMenu(expandedMenu === item.id ? null : item.id);
    }
  };

  const handleSubmenuClick = (submenu, parentId) => {
    // Handle Dashboard submenu items to set dashboardSubTab
    if (parentId === 'dashboard') {
      onTabChange('dashboard');
      
      // Map submenu IDs to dashboardSubTab values
      if (submenu.id === 'dashboard') {
        onDashboardSubTabChange && onDashboardSubTabChange('overview');
      } else if (submenu.id === 'portfolio') {
        onDashboardSubTabChange && onDashboardSubTabChange('portfolio');
      } else if (submenu.id === 'analytics') {
        onDashboardSubTabChange && onDashboardSubTabChange('analytics');
      }
    }
    // Handle Settings submenu items to set settingsSubTab
    else if (parentId === 'settings') {
      onTabChange('settings');
      
      // Map submenu IDs to settingsSubTab values
      if (submenu.id === 'settings-profile') {
        onSettingsSubTabChange && onSettingsSubTabChange('profile');
      } else if (submenu.id === 'settings-prefs') {
        onSettingsSubTabChange && onSettingsSubTabChange('preferences');
      }
    }
    // Handle Share submenu items to set shareSubTab
    else if (parentId === 'share') {
      onTabChange('share');
      
      // Map submenu IDs to shareSubTab values
      if (submenu.id === 'share') {
        onShareSubTabChange && onShareSubTabChange('opportunities');
      } else if (submenu.id === 'share-pitches') {
        onShareSubTabChange && onShareSubTabChange('my-pitches');
      } else if (submenu.id === 'share-invest') {
        onShareSubTabChange && onShareSubTabChange('invest');
      } else if (submenu.id === 'share-grants') {
        onShareSubTabChange && onShareSubTabChange('grants');
      }
    }
    // Handle Trust submenu items to set trustSubTab
    else if (parentId === 'trust') {
      onTabChange('trust');
      
      // Map submenu IDs to trustSubTab values
      if (submenu.id === 'trust') {
        onTrustSubTabChange && onTrustSubTabChange('my-trusts');
      } else if (submenu.id === 'trust-explore') {
        onTrustSubTabChange && onTrustSubTabChange('explore');
      } else if (submenu.id === 'trust-create') {
        oTrustSubTabChange && onTrustSubTabChange('create');
      } else if (submenu.id === 'trust-dashboard') {
        onTrustSubTabChange && onTrustSubTabChange('dashboard');
      }
    }
    // Handle Growth submenu items to set growthSubTab
    else if (parentId === 'growth') {
      onTabChange('growth');
      
      // Map submenu IDs to growthSubTab values
      if (submenu.id === 'growth') {
        onGrowthSubTabChange && onGrowthSubTabChange('opportunities');
      } else if (submenu.id === 'growth-strategies') {
        onGrowthSubTabChange && onGrowthSubTabChange('strategies');
      }
    }
    // Handle Readiness submenu items to set readinessSubTab
    else if (parentId === 'readiness') {
      onTabChange('readiness');
      
      // Map submenu IDs to readinessSubTab values
      if (submenu.id === 'readiness') {
        onReadinessSubTabChange && onReadinessSubTabChange('status');
      } else if (submenu.id === 'readiness-reports') {
        onReadinessSubTabChange && onReadinessSubTabChange('reports');
      }
    }
    // Handle Security submenu items to set securitySubTab
    else if (parentId === 'security') {
      onTabChange('security');
      
      // Map submenu IDs to securitySubTab values
      if (submenu.id === 'security') {
        onSecuritySubTabChange && onSecuritySubTabChange('account');
      } else if (submenu.id === 'security-privacy') {
        onSecuritySubTabChange && onSecuritySubTabChange('privacy');
      } else if (submenu.id === 'security-verify') {
        onSecuritySubTabChange && onSecuritySubTabChange('verify');
      }
    }
    else {
      onTabChange(submenu.id);
    }
    
    setExpandedMenu(null);
    setMobileMenuOpen(false);
  };

  return (
    <>
      {/* Main Navigation Header */}
      <nav className="bg-gradient-to-b from-slate-800 to-slate-900 border-b border-slate-700/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-full px-4 md:px-6 py-4">
          {/* Desktop Header */}
          <div className="hidden md:flex items-center justify-between gap-6">
            {/* Logo Section */}
            <div className="flex items-center gap-3 flex-shrink-0">
              <div className="p-2.5 rounded-lg bg-blue-500/30 border border-blue-400/50">
                <Shield className="w-5 h-5 text-blue-400" />
              </div>
              <div>
                <h1 className="text-white font-bold text-lg leading-tight">ICAN Capital Engine</h1>
                <p className="text-blue-300 text-xs">From Volatility to Global Capital</p>
              </div>
            </div>

            {/* Main Navigation Menu */}
            <div 
              className="flex items-center gap-2 flex-wrap flex-1" 
              ref={menuRef}
            >
              {navigationItems.map((item) => {
                const Icon = item.icon;
                const isActive = activeTab === item.id;

                return (
                  <div key={item.id} className="relative">
                    {/* Menu Button */}
                    <button
                      onClick={() => handleMenuItemClick(item)}
                      onMouseEnter={() => {
                        if (item.submenu && !item.isAction) {
                          setExpandedMenu(item.id);
                        }
                      }}
                      className={`px-3 py-2 rounded-lg font-medium text-sm flex items-center gap-2 transition-all whitespace-nowrap border ${
                        isActive
                          ? 'bg-blue-500 text-white border-blue-400 shadow-lg shadow-blue-500/50'
                          : 'bg-slate-700/50 text-slate-300 border-slate-600 hover:bg-slate-700 hover:text-white hover:border-slate-500'
                      }`}
                    >
                      <Icon className="w-4 h-4 flex-shrink-0" />
                      <span>{item.label}</span>
                      {item.submenu && (
                        <ChevronDown 
                          className={`w-3.5 h-3.5 transition-transform ${expandedMenu === item.id ? 'rotate-180' : ''}`} 
                        />
                      )}
                    </button>

                    {/* Dropdown Menu */}
                    {item.submenu && expandedMenu === item.id && (
                      <div
                        className="absolute left-0 mt-1 w-48 rounded-lg bg-slate-900 border border-slate-700 shadow-2xl overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150 z-50"
                        onMouseLeave={() => {
                          if (!item.isAction) {
                            setExpandedMenu(null);
                          }
                        }}
                      >
                        <div className="py-1">
                          {item.submenu.map((subitem, idx) => {
                            const SubIcon = subitem.icon;
                            const isSubActive = activeTab === subitem.id;
                            
                            return (
                              <button
                                key={idx}
                                onClick={() => handleSubmenuClick(subitem, item.id)}
                                className={`w-full px-4 py-2.5 text-sm flex items-center gap-3 transition-colors ${
                                  isSubActive
                                    ? 'bg-blue-500/30 text-blue-200 border-l-2 border-blue-500'
                                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                                }`}
                              >
                                <SubIcon className="w-4 h-4 flex-shrink-0" />
                                <span className="text-left">{subitem.label}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Right Section - Profile */}
            <div className="flex items-center gap-3 flex-shrink-0">
              {profile && (
                <button
                  onClick={onProfileClick}
                  className="relative w-10 h-10 rounded-full overflow-hidden ring-2 ring-white ring-opacity-30 hover:ring-opacity-50 transition-all flex-shrink-0"
                  title="Profile"
                >
                  <img
                    src={profile.avatar_url}
                    alt={profile.full_name}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      e.target.src = `https://ui-avatars.com/api/?name=${profile.full_name || 'User'}`;
                    }}
                  />
                </button>
              )}
            </div>
          </div>

          {/* Mobile Header */}
          <div className="flex md:hidden items-center justify-between gap-3">
            {/* Logo */}
            <div className="flex items-center gap-2 flex-shrink-0 min-w-0">
              <div className="p-2 rounded-lg bg-blue-500/30 border border-blue-400/50 flex-shrink-0">
                <Shield className="w-4 h-4 text-blue-400" />
              </div>
              <div className="min-w-0">
                <h1 className="text-white font-bold text-sm leading-tight truncate">ICAN</h1>
                <p className="text-blue-300 text-xs truncate">Capital Engine</p>
              </div>
            </div>

            {/* Mobile Menu Button */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="p-2 rounded-lg bg-slate-700/50 text-slate-300 hover:bg-slate-700 hover:text-white transition-colors flex-shrink-0"
            >
              {mobileMenuOpen ? (
                <X className="w-5 h-5" />
              ) : (
                <Menu className="w-5 h-5" />
              )}
            </button>
          </div>

          {/* Mobile Menu */}
          {mobileMenuOpen && (
            <div className="md:hidden mt-3 space-y-2 max-h-96 overflow-y-auto">
              {navigationItems.map((item) => {
                const Icon = item.icon;
                const isActive = activeTab === item.id;

                return (
                  <div key={item.id}>
                    <button
                      onClick={() => handleMenuItemClick(item)}
                      className={`w-full px-3 py-2.5 rounded-lg font-medium text-sm flex items-center justify-between transition-all border ${
                        isActive
                          ? 'bg-blue-500 text-white border-blue-400'
                          : 'bg-slate-700/50 text-slate-300 border-slate-600 hover:bg-slate-700 hover:text-white'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <Icon className="w-4 h-4" />
                        <span>{item.label}</span>
                      </div>
                      {item.submenu && (
                        <ChevronDown className="w-3.5 h-3.5" />
                      )}
                    </button>

                    {/* Mobile Submenu */}
                    {item.submenu && (
                      <div className="pl-4 space-y-1 mt-1">
                        {item.submenu.map((subitem, idx) => {
                          const SubIcon = subitem.icon;
                          const isSubActive = activeTab === subitem.id;

                          return (
                            <button
                              key={idx}
                              onClick={() => handleSubmenuClick(subitem, item.id)}
                              className={`w-full px-3 py-2 rounded-lg text-sm flex items-center gap-2 transition-colors ${
                                isSubActive
                                  ? 'bg-blue-500/30 text-blue-200'
                                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
                              }`}
                            >
                              <SubIcon className="w-3.5 h-3.5" />
                              <span>{subitem.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </nav>

      {/* Blue Gradient Accent Line */}
      <div className="h-1 bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500" />
    </>
  );
};

export default ConsolidatedNavigation;
