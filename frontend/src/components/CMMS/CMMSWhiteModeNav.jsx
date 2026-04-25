/**
 * CMMS White Mode Navigation Component
 * Modern, professional navigation for light theme
 */

import React, { useState, useEffect, useRef } from 'react';
import { MoreVertical, X } from 'lucide-react';
import { getWhiteModePalette } from '../../lib/themes/cmmsWhiteMode';

export const CMMSWhiteModeNav = ({ activeTab, setActiveTab, getTabs }) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const menuRef = useRef(null);

  const tabDefinitions = [
    { id: 'company', label: 'Company', icon: '🏢', description: 'Organization Profile' },
    { id: 'departments', label: 'Departments', icon: '🏭', description: 'Manage Departments' },
    { id: 'users', label: 'Users & Roles', icon: '👥', description: 'Team Management' },
    { id: 'inventory', label: 'Inventory', icon: '📦', description: 'Stock Management' },
    { id: 'requisitions', label: 'Requisitions', icon: '📋', description: 'Request Management' },
    { id: 'approvals', label: 'Approvals', icon: '✓', description: 'Approval Queue' },
    { id: 'reports', label: 'Reports', icon: '📊', description: 'Analytics & Reports' }
  ];

  const accessibleTabs = tabDefinitions.filter(tab => getTabs().includes(tab.id));

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false);
      }
    };

    if (menuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [menuOpen]);

  const getCurrentTabLabel = () => {
    const currentTab = accessibleTabs.find(t => t.id === activeTab);
    return currentTab ? `${currentTab.icon} ${currentTab.label}` : '🏢 Company';
  };

  const getPaletteColors = (tabId) => {
    const palette = getWhiteModePalette(tabId);
    return {
      activeBg: palette.activeBgLight || 'linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)',
      activeBorder: palette.activeBorder || '#3b82f6',
      activeText: palette.activeText || '#1e40af',
      inactiveBg: palette.inactiveBgLight || '#f8fafc',
      border: palette.border || '#e2e8f0'
    };
  };

  // Mobile view
  if (isMobile) {
    return (
      <div className="mb-6 bg-white border-b-2 border-slate-200 -mx-4 px-4 py-3 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-semibold text-slate-700">
            {getCurrentTabLabel()}
          </div>

          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className={`p-2 rounded-lg transition-all flex items-center justify-center ${
                menuOpen
                  ? 'bg-blue-100 text-blue-600'
                  : 'bg-slate-100 text-slate-600 active:bg-slate-200'
              }`}
              title="Menu"
            >
              {menuOpen ? (
                <X className="w-5 h-5" />
              ) : (
                <MoreVertical className="w-5 h-5" />
              )}
            </button>

            {/* Mobile Dropdown */}
            {menuOpen && (
              <div className="absolute right-0 top-full mt-2 bg-white border border-slate-200 rounded-lg shadow-xl z-30 min-w-72 animate-in fade-in zoom-in-95 duration-200">
                <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 text-slate-700 text-xs font-bold uppercase letter-spacing rounded-t-lg">
                  📋 Navigation
                </div>
                <div className="divide-y divide-slate-200 max-h-96 overflow-y-auto">
                  {accessibleTabs.map(tab => {
                    const isActive = activeTab === tab.id;
                    const colors = getPaletteColors(tab.id);
                    
                    return (
                      <button
                        key={tab.id}
                        onClick={() => {
                          setActiveTab(tab.id);
                          setMenuOpen(false);
                        }}
                        className={`w-full px-4 py-3 text-left flex items-center gap-3 transition-all ${
                          isActive
                            ? 'text-slate-900 font-semibold'
                            : 'text-slate-700 hover:bg-slate-50'
                        }`}
                        style={isActive ? {
                          background: colors.activeBg,
                          borderLeft: `4px solid ${colors.activeBorder}`
                        } : {
                          background: 'white'
                        }}
                      >
                        <span className="text-xl">{tab.icon}</span>
                        <div className="flex-1">
                          <div className="font-medium">{tab.label}</div>
                          <div className="text-xs text-slate-500">{tab.description}</div>
                        </div>
                        {isActive && <span className="text-blue-600 font-bold">✓</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Desktop view
  return (
    <div className="mb-6 bg-white border-b-2 border-slate-200 -mx-4 md:-mx-6 lg:-mx-8 shadow-sm">
      <div className="px-4 md:px-6 lg:px-8 py-3">
        <div className="flex gap-2 items-center overflow-x-auto flex-wrap">
          {accessibleTabs.map(tab => {
            const isActive = activeTab === tab.id;
            const colors = getPaletteColors(tab.id);

            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`
                  px-4 py-2.5 rounded-lg font-semibold text-sm transition-all duration-300
                  flex items-center gap-2 whitespace-nowrap border-2 shadow-none
                  hover:shadow-md hover:-translate-y-0.5
                `}
                style={isActive ? {
                  background: colors.activeBg,
                  borderColor: colors.activeBorder,
                  color: colors.activeText,
                  boxShadow: `0 4px 12px ${colors.activeBorder}30`
                } : {
                  background: colors.inactiveBg,
                  borderColor: colors.border,
                  color: '#64748b'
                }}
                title={tab.description}
              >
                <span className="text-lg">{tab.icon}</span>
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default CMMSWhiteModeNav;
