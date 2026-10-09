/**
 * MainNavigation Component
 * Top menu bar with ICAN Capital Engine sections matching design
 * Includes: Dashboard, Security, Readiness, Growth, Trust (SACCO), Settings
 * Features: Hide on scroll for better UX, Prominent branding
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
  Wallet
} from 'lucide-react'
import IcanEraLogo from '../IcanEra.png'
import ThemeSwitcher from './ThemeSwitcher'
import { useI18n } from '../i18n/I18nProvider'

export default function MainNavigation({ onTrustClick, onShareClick, onWalletClick }) {
  const { t } = useI18n()
  const [activeSection, setActiveSection] = useState('dashboard')
  const [expandedMenu, setExpandedMenu] = useState(null)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [expandedMobileMenu, setExpandedMobileMenu] = useState(null)
  const [isNavVisible, setIsNavVisible] = useState(true)
  const [scrollDirection, setScrollDirection] = useState('up')
  const [lastScrollY, setLastScrollY] = useState(0)
  const menuRef = useRef(null)
  const navRef = useRef(null)

  const menuItems = [
    {
      id: 'dashboard',
      label: t('nav.dashboard'),
      icon: Home,
      path: '/dashboard',
      submenu: [
        { label: t('nav.overview'), path: '/dashboard', icon: Home },
        { label: t('nav.portfolio'), path: '/dashboard/portfolio', icon: BarChart3 },
        { label: t('nav.analytics'), path: '/dashboard/analytics', icon: TrendingUp }
      ]
    },
    {
      id: 'security',
      label: t('nav.security'),
      icon: Shield,
      path: '/security',
      submenu: [
        { label: t('nav.account'), path: '/security', icon: Lock },
        { label: t('nav.privacy'), path: '/security/privacy', icon: Lock },
        { label: t('nav.verification'), path: '/security/verify', icon: Shield }
      ]
    },
    {
      id: 'readiness',
      label: t('nav.readiness'),
      icon: Globe,
      path: '/readiness',
      submenu: [
        { label: t('nav.status'), path: '/readiness', icon: Globe },
        { label: t('nav.reports'), path: '/readiness/reports', icon: BarChart3 }
      ]
    },
    {
      id: 'growth',
      label: t('nav.growth'),
      icon: TrendingUp,
      path: '/growth',
      submenu: [
        { label: t('nav.opportunities'), path: '/growth', icon: Target },
        { label: t('nav.strategies'), path: '/growth/strategies', icon: TrendingUp }
      ]
    },
    {
      id: 'trust',
      label: `🏦 ${t('nav.sacco')}`,
      icon: Banknote,
      path: '/trust',
      submenu: [
        { label: `🔍 ${t('nav.explore')}`, path: '/trust', icon: Users },
        { label: `👥 ${t('nav.myTrusts')}`, path: '/trust/my', icon: Banknote },
        { label: `🗳️ ${t('nav.vote')}`, path: '/trust/vote', icon: Target },
        { label: `📮 ${t('nav.applications')}`, path: '/trust/applications', icon: BarChart3 },
        { label: `✨ ${t('nav.create')}`, path: '/trust/create', icon: Target }
      ]
    },
    {
      id: 'share',
      label: t('nav.share'),
      icon: Heart,
      path: '/share',
      submenu: [
        { label: t('nav.opportunities'), path: '/share', icon: Banknote },
        { label: t('nav.myPitches'), path: '/share/my-pitches', icon: Target },
        { label: t('nav.invest'), path: '/share/invest', icon: TrendingUp },
        { label: t('nav.grants'), path: '/share/grants', icon: Heart }
      ]
    },
    {
      id: 'wallet',
      label: t('nav.wallet'),
      icon: Wallet,
      path: '/wallet',
      submenu: [
        { label: t('nav.myWallet'), path: '/wallet', icon: Wallet },
        { label: t('nav.sendMoney'), path: '/wallet/send', icon: Banknote },
        { label: t('nav.receive'), path: '/wallet/receive', icon: TrendingUp },
        { label: t('nav.transactions'), path: '/wallet/transactions', icon: BarChart3 },
        { label: t('nav.currency'), path: '/wallet/currency', icon: Globe }
      ]
    },
    {
      id: 'settings',
      label: t('nav.settings'),
      icon: Settings,
      path: '/settings',
      submenu: [
        { label: t('nav.profile'), path: '/settings/profile', icon: Home },
        { label: t('nav.preferences'), path: '/settings/preferences', icon: Settings }
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

  // Handle scroll direction for show/hide navbar
  useEffect(() => {
    const handleScroll = () => {
      const currentScrollY = window.scrollY
      
      // Threshold: only hide/show after scrolling more than 50px
      const threshold = 50
      
      if (currentScrollY - lastScrollY > threshold && scrollDirection === 'up') {
        // Scrolling down
        setScrollDirection('down')
        setIsNavVisible(false)
      } else if (lastScrollY - currentScrollY > threshold && scrollDirection === 'down') {
        // Scrolling up
        setScrollDirection('up')
        setIsNavVisible(true)
      }
      
      setLastScrollY(currentScrollY)
    }

    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [lastScrollY, scrollDirection])

  return (
    <>
      {/* Top Bar - Mode/Region - Hide on mobile */}
      {/* <div className="hidden md:block bg-gradient-to-r from-purple-600 to-blue-600 backdrop-blur-sm border-b border-white/10 px-6 py-3">
        <p className="text-white font-semibold text-lg">SE Mode | Uganda</p>
      </div> */}

      {/* Main Navigation */}
      <nav 
        ref={navRef}
        className={`bg-gradient-to-b from-slate-800 to-slate-900 border-b border-slate-700/50 backdrop-blur-md sticky top-0 z-50 transition-all duration-300 ease-in-out transform ${
          isNavVisible ? 'translate-y-0 shadow-lg' : '-translate-y-full shadow-none'
        }`}
      >
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-3 md:py-6">
          {/* Desktop: Logo and Title + Menu */}
          <div className="hidden md:block">
            {/* Logo and Title with Enhanced Branding */}
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-4 group">
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
                
                {/* Branding Text */}
                <div>
                  <p className="text-white font-bold text-xl group-hover:drop-shadow-[0_0_8px_rgba(59,130,246,0.5)] transition-all duration-300">IcanEra</p>
                  <p className="text-blue-300 text-xs font-medium">Capital Engine</p>
                </div>
              </div>
            </div>

            {/* Menu Items */}
            <div className="flex items-center gap-3 flex-wrap justify-between" ref={menuRef}>
              <div className="flex items-center gap-3 flex-wrap">
                {menuItems.map((item) => {
                  const Icon = item.icon
                  const isActive = activeSection === item.id

                  return (
                    <div key={item.id} className="relative">
                    <button
                      onClick={() => {
                        setActiveSection(item.id)
                        if (item.id === 'trust') {
                          if (onTrustClick) onTrustClick()
                        } else if (item.id === 'share') {
                          if (onShareClick) onShareClick()
                        } else if (item.id === 'wallet') {
                          if (onWalletClick) onWalletClick()
                        } else if (item.submenu) {
                          setExpandedMenu(expandedMenu === item.id ? null : item.id)
                        }
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
              <ThemeSwitcher />
            </div>
          </div>

          {/* Mobile: Hamburger Menu */}
          <div className="md:hidden">
            {/* Mobile Header with Enhanced Branding */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-gradient-to-r from-blue-500/30 to-purple-500/30 border border-blue-400/50">
                  <img 
                    src={IcanEraLogo} 
                    alt="IcanEra" 
                    className="w-6 h-6 object-contain"
                    onError={(e) => {
                      e.target.style.display = 'none';
                      e.target.parentElement.textContent = '💎';
                      e.target.parentElement.style.fontSize = '1.25rem';
                    }}
                  />
                </div>
                <div>
                  <p className="text-white font-bold text-lg">IcanEra</p>
                  <p className="text-blue-300 text-xs font-medium">Capital Engine</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {/* Theme Switcher for Mobile */}
                <div className="scale-90">
                  <ThemeSwitcher />
                </div>
                {/* Hamburger Menu Button */}
                <button
                  onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                  className="p-2 rounded-lg bg-slate-700/50 hover:bg-slate-700 text-slate-300 hover:text-white transition-all"
                >
                  {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
                </button>
              </div>
            </div>

            {/* Mobile Menu */}
            {mobileMenuOpen && (
              <div className="space-y-2 pb-4 animate-in fade-in slide-in-from-top-2 duration-200">
                {menuItems.map((item) => {
                  const Icon = item.icon
                  const isActive = activeSection === item.id
                  const isExpanded = expandedMobileMenu === item.id

                  return (
                    <div key={item.id}>
                      <button
                        onClick={() => {
                          setActiveSection(item.id)
                          if (item.id === 'trust') {
                            if (onTrustClick) onTrustClick()
                            setMobileMenuOpen(false)
                          } else if (item.id === 'share') {
                            if (onShareClick) onShareClick()
                            setMobileMenuOpen(false)
                          } else if (item.id === 'wallet') {
                            if (onWalletClick) onWalletClick()
                            setMobileMenuOpen(false)
                          } else if (item.submenu) {
                            setExpandedMobileMenu(isExpanded ? null : item.id)
                          } else {
                            setMobileMenuOpen(false)
                          }
                        }}
                        className={`w-full px-4 py-3 rounded-lg font-medium text-sm flex items-center gap-2 transition-all border ${
                          isActive
                            ? 'bg-blue-500 text-white border-blue-400'
                            : 'bg-slate-700/50 text-slate-300 border-slate-600'
                        }`}
                      >
                        <Icon className="w-4 h-4 flex-shrink-0" />
                        <span>{item.label}</span>
                        {item.submenu && (
                          <ChevronDown className={`w-4 h-4 ml-auto transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                        )}
                      </button>

                      {/* Mobile Submenu */}
                      {item.submenu && isExpanded && (
                        <div className="mt-1 ml-4 space-y-1 border-l border-slate-600 pl-2">
                          {item.submenu.map((subitem) => {
                            const SubIcon = subitem.icon
                            return (
                              <button
                                key={subitem.path}
                                onClick={() => {
                                  setExpandedMobileMenu(null)
                                  setMobileMenuOpen(false)
                                }}
                                className="w-full px-3 py-2 rounded-lg text-left text-slate-300 hover:text-white hover:bg-blue-500/30 transition-all flex items-center gap-2 text-xs"
                              >
                                <SubIcon className="w-4 h-4 flex-shrink-0" />
                                {subitem.label}
                              </button>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </nav>
    </>
  )
}
