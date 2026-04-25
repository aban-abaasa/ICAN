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
  Database,
  Menu,
  X,
  Wallet,
  Bell,
  FileText,
  Lightbulb,
  Calculator,
  User
} from 'lucide-react'
import IcanEraLogo from '../IcanEra.png'
import ThemeSwitcher from './ThemeSwitcher'

export default function MainNavigation({ onTrustClick, onShareClick, onWalletClick, onExtensionClick }) {
  const [activeSection, setActiveSection] = useState('dashboard')
  const [expandedMenu, setExpandedMenu] = useState(null)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [expandedMobileMenu, setExpandedMobileMenu] = useState(null)
  const menuRef = useRef(null)

  // Main navigation items (displayed as tabs)
  const mainMenuItems = [
    {
      id: 'dashboard',
      label: 'Dashboard',
      icon: Home,
      path: '/dashboard'
    },
    {
      id: 'pitchin',
      label: 'Pitchin',
      icon: Target,
      path: '/pitchin',
      action: onShareClick
    },
    {
      id: 'wallet',
      label: 'Wallet',
      icon: Wallet,
      path: '/wallet',
      action: onWalletClick
    },
    {
      id: 'trust',
      label: 'Trust',
      icon: Banknote,
      path: '/trust',
      action: onTrustClick
    },
    {
      id: 'cmms',
      label: 'CMMS',
      icon: Database,
      path: '/cmms'
    }
  ]

  // Extension/Additional items (shown in dropdown)
  const extensionMenuItems = [
    {
      id: 'profile',
      label: 'My Profile',
      icon: User,
      path: '/profile'
    },
    {
      id: 'notifications',
      label: 'Notifications',
      icon: Bell,
      path: '/notifications'
    },
    {
      id: 'readiness',
      label: 'Readiness',
      icon: Globe,
      path: '/readiness'
    },
    {
      id: 'growth',
      label: 'Growth',
      icon: TrendingUp,
      path: '/growth'
    },
    {
      id: 'reports',
      label: 'Reports',
      icon: FileText,
      path: '/reports'
    },
    {
      id: 'tithe',
      label: 'Tithe',
      icon: Heart,
      path: '/tithe'
    },
    {
      id: 'loan-calculator',
      label: 'Loan Calculator',
      icon: Calculator,
      path: '/loan-calculator'
    },
    {
      id: 'security',
      label: 'Security',
      icon: Shield,
      path: '/security'
    },
    {
      id: 'settings',
      label: 'Settings',
      icon: Settings,
      path: '/settings'
    }
  ]

  const extensionMenu = {
    id: 'extension',
    label: 'Extension',
    icon: Lightbulb,
    submenu: extensionMenuItems
  }

  const additionalMenuItems = [
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
      id: 'wallet',
      label: 'Wallet',
      icon: Wallet,
      path: '/wallet',
      submenu: [
        { label: 'My Wallet', path: '/wallet', icon: Wallet },
        { label: 'Send Money', path: '/wallet/send', icon: Banknote },
        { label: 'Receive', path: '/wallet/receive', icon: TrendingUp },
        { label: 'Transactions', path: '/wallet/transactions', icon: BarChart3 },
        { label: 'Currency', path: '/wallet/currency', icon: Globe }
      ]
    },
    {
      id: 'settings',
      label: 'Settings',
      icon: Settings,
      path: '/settings',
      submenu: [
        { label: 'Profile', path: '/settings/profile', icon: Home },
        { label: 'Preferences', path: '/settings/preferences', icon: Settings },
        { label: 'Security', path: '/settings/security', icon: Shield }
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
      {/* Top Bar - Mode/Region - Hide on mobile */}
      {/* <div className="hidden md:block bg-gradient-to-r from-purple-600 to-blue-600 backdrop-blur-sm border-b border-white/10 px-6 py-3">
        <p className="text-white font-semibold text-lg">SE Mode | Uganda</p>
      </div> */}

      {/* Main Navigation */}
      <nav className="bg-gradient-to-b from-slate-800 to-slate-900 border-b border-slate-700/50 backdrop-blur-md sticky top-0 z-50 overflow-visible">
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-3 md:py-4 min-h-fit">
          {/* Desktop: Logo and Title + Menu */}
          <div className="hidden md:block">
            {/* Logo and Title */}
            <div className="flex items-center gap-4 mb-6 group">
              {/* Dynamic Logo with Glow Effect */}
              <div className="relative transition-all duration-300 group-hover:scale-110 rounded-lg overflow-hidden">
                {/* Subtle glow background */}
                <div className="absolute inset-0 bg-gradient-to-r from-blue-500 to-purple-500 rounded-lg opacity-0 group-hover:opacity-30 blur-lg transition-all duration-300"></div>
                
                {/* Logo container */}
                <div className="relative bg-gradient-to-r from-blue-500/10 to-purple-500/10 rounded-lg p-2 hover:bg-gradient-to-r hover:from-blue-500/30 hover:to-purple-500/30 transition-all duration-300 group-hover:shadow-lg group-hover:shadow-blue-500/50 flex items-center justify-center">
                  <img 
                    src={IcanEraLogo} 
                    alt="IcanEra" 
                    className="w-14 h-14 object-contain transition-transform duration-300 group-hover:scale-105 filter drop-shadow-md"
                    onError={(e) => {
                      e.target.style.display = 'none';
                      e.target.parentElement.textContent = '💎';
                      e.target.parentElement.style.fontSize = '1.75rem';
                    }}
                  />
                </div>
              </div>
              
              <div>
                <p className="text-white font-bold text-xl group-hover:drop-shadow-[0_0_8px_rgba(59,130,246,0.5)] transition-all duration-300">IcanEra</p>
              </div>
            </div>

            {/* Menu Items */}
            <div className="flex items-center gap-2 flex-wrap justify-between" ref={menuRef}>
              <div className="flex items-center gap-2 flex-wrap max-h-fit overflow-y-auto pb-2">
                {/* Main Menu Items */}
                {mainMenuItems.map((item) => {
                  const Icon = item.icon
                  const isActive = activeSection === item.id

                  return (
                    <div key={item.id} className="relative">
                      <button
                        onClick={() => {
                          setActiveSection(item.id)
                          if (item.action) item.action()
                        }}
                        className={`px-4 py-2 rounded-lg font-medium text-xs md:text-sm flex items-center gap-1.5 transition-all whitespace-nowrap border ${
                          isActive
                            ? 'bg-blue-500 text-white border-blue-400 shadow-lg shadow-blue-500/50'
                            : 'bg-slate-700/50 text-slate-300 border-slate-600 hover:bg-slate-700 hover:text-white hover:border-slate-500'
                        }`}
                      >
                        <Icon className="w-3.5 h-3.5 md:w-4 md:h-4" />
                        <span className="hidden sm:inline">{item.label}</span>
                      </button>
                    </div>
                  )
                })}

                {/* Extension Menu (Dropdown) */}
                <div className="relative">
                  <button
                    onClick={() => {
                      setExpandedMenu(expandedMenu === 'extension' ? null : 'extension')
                      if (onExtensionClick && expandedMenu !== 'extension') {
                        onExtensionClick()
                      }
                    }}
                    className={`px-4 py-2 rounded-lg font-medium text-xs md:text-sm flex items-center gap-1.5 transition-all whitespace-nowrap border ${
                      expandedMenu === 'extension'
                        ? 'bg-purple-500 text-white border-purple-400 shadow-lg shadow-purple-500/50'
                        : 'bg-slate-700/50 text-slate-300 border-slate-600 hover:bg-slate-700 hover:text-white hover:border-slate-500'
                    }`}
                  >
                    <extensionMenu.icon className="w-3.5 h-3.5 md:w-4 md:h-4" />
                    <span className="hidden sm:inline">{extensionMenu.label}</span>
                    <ChevronDown className={`w-3 h-3 md:w-4 md:h-4 transition-transform ${expandedMenu === 'extension' ? 'rotate-180' : ''}`} />
                  </button>

                  {/* Extension Submenu */}
                  {expandedMenu === 'extension' && (
                    <div className="absolute left-0 mt-2 w-56 rounded-xl bg-slate-900 border border-slate-700 shadow-2xl overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200 z-[60]">
                      <div className="p-2 space-y-1 max-h-80 overflow-y-auto">
                        {extensionMenu.submenu.map((subitem) => {
                          const SubIcon = subitem.icon
                          return (
                            <button
                              key={subitem.path}
                              onClick={() => {
                                setActiveSection(subitem.id)
                                setExpandedMenu(null)
                              }}
                              className="w-full px-3 py-2.5 rounded-lg text-left text-slate-300 hover:text-white hover:bg-blue-500/30 transition-all flex items-center gap-2 text-sm border border-transparent hover:border-blue-500/30"
                            >
                              <SubIcon className="w-4 h-4 flex-shrink-0" />
                              {subitem.label}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <ThemeSwitcher />
            </div>
          </div>

          {/* Mobile: Hamburger Menu */}
          <div className="md:hidden">
            {/* Mobile Header */}
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div className="p-2 rounded-lg bg-blue-500/30 border border-blue-400/50 flex-shrink-0">
                  <Shield className="w-5 h-5 text-blue-400" />
                </div>
                <div className="min-w-0">
                  <p className="text-white font-bold text-base md:text-lg truncate">ICANera</p>
                  <p className="text-blue-300 text-xs truncate">Global Capital</p>
                </div>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {/* Theme Switcher for Mobile */}
                <div className="scale-75 origin-right">
                  <ThemeSwitcher />
                </div>
                {/* Hamburger Menu Button */}
                <button
                  onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                  className="p-2 rounded-lg bg-slate-700/50 hover:bg-slate-700 text-slate-300 hover:text-white transition-all flex-shrink-0"
                >
                  {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
                </button>
              </div>
            </div>

            {/* Mobile Menu */}
            {mobileMenuOpen && (
              <div className="mt-4 pt-4 pb-6 max-h-[calc(100vh-200px)] overflow-y-auto space-y-2 animate-in fade-in slide-in-from-top-2 duration-200 border-t border-slate-700/50">
                {/* Main Menu Items */}
                {mainMenuItems.map((item) => {
                  const Icon = item.icon
                  const isActive = activeSection === item.id

                  return (
                    <button
                      key={item.id}
                      onClick={() => {
                        setActiveSection(item.id)
                        if (item.action) item.action()
                        setMobileMenuOpen(false)
                      }}
                      className={`w-full px-4 py-3 rounded-lg font-medium text-sm flex items-center gap-2 transition-all border ${
                        isActive
                          ? 'bg-blue-500 text-white border-blue-400 shadow-md shadow-blue-500/30'
                          : 'bg-slate-700/50 text-slate-300 border-slate-600 hover:bg-slate-700 hover:text-white hover:border-slate-500'
                      }`}
                    >
                      <Icon className="w-4 h-4 flex-shrink-0" />
                      <span className="flex-1 text-left">{item.label}</span>
                    </button>
                  )
                })}

                {/* Extension Menu for Mobile */}
                <div className="pt-2 mt-2 border-t border-slate-700/50">
                  <button
                    onClick={() => setExpandedMobileMenu(expandedMobileMenu === 'extension' ? null : 'extension')}
                    className={`w-full px-4 py-3 rounded-lg font-medium text-sm flex items-center gap-2 transition-all border ${
                      expandedMobileMenu === 'extension'
                        ? 'bg-purple-500 text-white border-purple-400 shadow-md shadow-purple-500/30'
                        : 'bg-slate-700/50 text-slate-300 border-slate-600 hover:bg-slate-700 hover:text-white hover:border-slate-500'
                    }`}
                  >
                    <extensionMenu.icon className="w-4 h-4 flex-shrink-0" />
                    <span className="flex-1 text-left">{extensionMenu.label}</span>
                    <ChevronDown className={`w-4 h-4 transition-transform flex-shrink-0 ${expandedMobileMenu === 'extension' ? 'rotate-180' : ''}`} />
                  </button>

                  {/* Mobile Extension Submenu */}
                  {expandedMobileMenu === 'extension' && (
                    <div className="mt-1 ml-2 space-y-1 border-l-2 border-purple-500/50 pl-3 py-1">
                      {extensionMenu.submenu.map((subitem) => {
                        const SubIcon = subitem.icon
                        return (
                          <button
                            key={subitem.path}
                            onClick={() => {
                              setActiveSection(subitem.id)
                              setExpandedMobileMenu(null)
                              setMobileMenuOpen(false)
                            }}
                            className="w-full px-3 py-2 rounded-lg text-left text-slate-300 hover:text-white hover:bg-blue-500/30 transition-all flex items-center gap-2 text-xs font-medium border border-transparent hover:border-blue-500/30"
                          >
                            <SubIcon className="w-4 h-4 flex-shrink-0" />
                            <span className="flex-1">{subitem.label}</span>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </nav>
    </>
  )
}
