/**
 * MainNavigation Component
 * Top menu bar with ICAN Capital Engine sections matching design
 * Includes: Dashboard, Security, Readiness, Growth, Trust (SACCO), Settings
 */

import React, { useState, useRef, useEffect } from 'react'
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
  Database
} from 'lucide-react'

export default function MainNavigation({ onTrustClick, onShareClick }) {
  const [activeSection, setActiveSection] = useState('dashboard')
  const [expandedMenu, setExpandedMenu] = useState(null)
  const menuRef = useRef(null)

  const menuItems = [
    {
      id: 'dashboard',
      label: 'Dashboard',
      icon: Home,
      path: '/dashboard',
      submenu: [
        { label: 'Overview', path: '/dashboard', icon: Home },
        { label: 'Portfolio', path: '/dashboard/portfolio', icon: BarChart3 },
        { label: 'Analytics', path: '/dashboard/analytics', icon: TrendingUp }
      ]
    },
    {
      id: 'security',
      label: 'Security',
      icon: Shield,
      path: '/security',
      submenu: [
        { label: 'Account', path: '/security', icon: Lock },
        { label: 'Privacy', path: '/security/privacy', icon: Lock },
        { label: 'Verification', path: '/security/verify', icon: Shield }
      ]
    },
    {
      id: 'readiness',
      label: 'Readiness',
      icon: Globe,
      path: '/readiness',
      submenu: [
        { label: 'Status', path: '/readiness', icon: Globe },
        { label: 'Reports', path: '/readiness/reports', icon: BarChart3 }
      ]
    },
    {
      id: 'growth',
      label: 'Growth',
      icon: TrendingUp,
      path: '/growth',
      submenu: [
        { label: 'Opportunities', path: '/growth', icon: Target },
        { label: 'Strategies', path: '/growth/strategies', icon: TrendingUp }
      ]
    },
    {
      id: 'trust',
      label: 'Trust',
      icon: Banknote,
      path: '/trust',
      submenu: [
        { label: 'My Trusts', path: '/trust', icon: Banknote },
        { label: 'Explore', path: '/trust/explore', icon: Users },
        { label: 'Create', path: '/trust/create', icon: Target },
        { label: 'Dashboard', path: '/trust/dashboard', icon: BarChart3 }
      ]
    },
    {
      id: 'share',
      label: 'Share',
      icon: Heart,
      path: '/share',
      submenu: [
        { label: 'Opportunities', path: '/share', icon: Banknote },
        { label: 'My Pitches', path: '/share/my-pitches', icon: Target },
        { label: 'Invest', path: '/share/invest', icon: TrendingUp },
        { label: 'Grants', path: '/share/grants', icon: Heart }
      ]
    },
    {
      id: 'settings',
      label: 'Settings',
      icon: Settings,
      path: '/settings',
      submenu: [
        { label: 'Profile', path: '/settings/profile', icon: Home },
        { label: 'Preferences', path: '/settings/preferences', icon: Settings }
      ]
    }
  ]

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setExpandedMenu(null)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <>
      {/* Top Bar - Mode/Region */}
      <div className="bg-gradient-to-r from-purple-600 to-blue-600 backdrop-blur-sm border-b border-white/10 px-6 py-3">
        <p className="text-white font-semibold text-lg">SE Mode | Uganda</p>
      </div>

      {/* Main Navigation */}
      <nav className="bg-gradient-to-b from-slate-800 to-slate-900 border-b border-slate-700/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-6">
          {/* Logo and Title */}
          <div className="flex items-center gap-4 mb-6">
            <div className="p-3 rounded-lg bg-blue-500/30 border border-blue-400/50">
              <Shield className="w-6 h-6 text-blue-400" />
            </div>
            <div>
              <p className="text-white font-bold text-xl">ICAN Capital Engine</p>
              <p className="text-blue-300 text-sm">From Volatility to Global Capital</p>
            </div>
          </div>

          {/* Menu Items */}
          <div className="flex items-center gap-3 flex-wrap" ref={menuRef}>
            {menuItems.map((item) => {
              const Icon = item.icon
              const isActive = activeSection === item.id

              return (
                <div key={item.id} className="relative">
                  <button
                    onClick={() => {
                      setActiveSection(item.id)
                      if (item.id === 'trust') {
                        // Call the onTrustClick callback
                        if (onTrustClick) onTrustClick()
                      } else if (item.id === 'share') {
                        // Call the onShareClick callback
                        if (onShareClick) onShareClick()
                      } else if (item.submenu) {
                        setExpandedMenu(expandedMenu === item.id ? null : item.id)
                      }
                      // For other sections, just set active state
                    }}
                    className={`px-5 py-2.5 rounded-lg font-medium text-sm flex items-center gap-2 transition-all whitespace-nowrap border ${
                      isActive
                        ? 'bg-blue-500 text-white border-blue-400 shadow-lg shadow-blue-500/50'
                        : 'bg-slate-700/50 text-slate-300 border-slate-600 hover:bg-slate-700 hover:text-white hover:border-slate-500'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    {item.label}
                    {item.submenu && (
                      <ChevronDown className={`w-4 h-4 transition-transform ${expandedMenu === item.id ? 'rotate-180' : ''}`} />
                    )}
                  </button>

                  {/* Submenu */}
                  {item.submenu && expandedMenu === item.id && (
                    <div className="absolute left-0 mt-2 w-56 rounded-xl bg-slate-900 border border-slate-700 shadow-2xl overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200 z-50">
                      <div className="p-2 space-y-1">
                        {item.submenu.map((subitem) => {
                          const SubIcon = subitem.icon
                          return (
                            <button
                              key={subitem.path}
                              onClick={() => {
                                navigate(subitem.path)
                                setExpandedMenu(null)
                              }}
                              className="w-full px-3 py-2.5 rounded-lg text-left text-slate-300 hover:text-white hover:bg-blue-500/30 transition-all flex items-center gap-2 text-sm"
                            >
                              <SubIcon className="w-4 h-4" />
                              {subitem.label}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </nav>
    </>
  )
}
