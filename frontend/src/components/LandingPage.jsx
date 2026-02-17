import React, { useState, useEffect } from 'react';
import { ChevronRight, Play, Zap, Shield, TrendingUp, Users, ArrowRight, ChevronDown } from 'lucide-react';
import DashboardPreview from './DashboardPreview';

const LandingPage = ({ onGetStarted }) => {
  const [currentSlide, setCurrentSlide] = useState(0);
  const [currentHeroSlide, setCurrentHeroSlide] = useState(0);
  const [currentBadgeInfo, setCurrentBadgeInfo] = useState(0);
  const [currentTestimonial, setCurrentTestimonial] = useState(0);
  const [scrollPosition, setScrollPosition] = useState(0);
  const [isHeroExpanded, setIsHeroExpanded] = useState(false);

  // Image slides with descriptions (using all 20 images from public/images)
  const slides = [
    {
      image: '/images/dairy expense and inacome.png',
      title: 'Expense & Income Tracker',
      subtitle: 'Smart Financial Management',
      description: 'Track every transaction with precision. Smart categorization, real-time insights, and predictive analytics for complete financial control',
      whyJoin: 'Take control of every shilling—track, analyze, grow',
      features: ['Real-time tracking', 'Smart categorization', 'Expense reports', 'Budget forecasting', 'AI-powered insights'],
      highlight: true
    },
    {
      image: '/images/ICANera expense.png',
      title: 'Financial Dashboard',
      subtitle: 'Advanced Analytics',
      description: 'Comprehensive financial overview with real-time analytics and performance metrics',
      whyJoin: 'See your complete financial picture at a glance',
      features: ['Real-time analytics', 'Performance tracking', 'Financial reports']
    },
    {
      image: '/images/icanera wallet.png',
      title: 'Digital Wallet',
      subtitle: 'Secure Management',
      description: 'Manage your accounts, balances & transactions with secure digital wallet management',
      whyJoin: 'Secure, fast, and simple money management',
      features: ['Account management', 'Balance tracking', 'Secure transactions']
    },
    {
      image: '/images/ICANwallet.png',
      title: 'Smart Wallet',
      subtitle: 'Secure & Fast',
      description: 'Advanced wallet features with multi-currency support and instant transactions',
      whyJoin: 'Instant transfers, zero hassles, total peace of mind',
      features: ['Multi-currency', 'Instant transfers', 'Security verified']
    },
    {
      image: '/images/incaera share.png',
      title: 'Pitchin',
      subtitle: 'Investment Hub',
      description: 'Share your vision, connect with investors and build your business dreams',
      whyJoin: 'Your idea + our platform = your next big breakthrough',
      features: ['Business pitches', 'Investor connections', 'Growth opportunities']
    },
    {
      image: '/images/ICANera pitchin.png',
      title: 'Pitchin Pro',
      subtitle: 'Professional Platform',
      description: 'Professional platform for sharing and funding innovative business ideas',
      whyJoin: 'Connect with investors who believe in your vision',
      features: ['Pitch templates', 'Investor network', 'Funding support']
    },
    {
      image: '/images/ICANera pitchin 8.png',
      title: 'Pitchin Advanced',
      subtitle: 'Smart Matching',
      description: 'AI-powered investor matching and business growth acceleration',
      whyJoin: 'AI finds the perfect investor match for your dreams',
      features: ['Smart matching', 'Growth tools', 'Investor support']
    },
    {
      image: '/images/cmms.png',
      title: 'Treasury Guardian',
      subtitle: 'Security Platform',
      description: 'Account security & privacy controls with enterprise-level protection',
      whyJoin: 'Enterprise security protecting everything you own',
      features: ['Security controls', 'Privacy protection', 'Account verification']
    },
    {
      image: '/images/ICANera CMMS.png',
      title: 'CMMS Platform',
      subtitle: 'Management System',
      description: 'Comprehensive management system for operations and resources',
      whyJoin: 'Organize, optimize, and scale your operations',
      features: ['Resource mgmt', 'Operations tracking', 'Team coordination']
    },
    {
      image: '/images/ICANera CMMS1.png',
      title: 'CMMS Pro',
      subtitle: 'Enterprise Edition',
      description: 'Enterprise-grade management and operational excellence',
      whyJoin: 'Enterprise power at your fingertips, simply executed',
      features: ['Enterprise tools', 'Analytics', 'Automation']
    },
    {
      image: '/images/sacco.png',
      title: 'Trust Management',
      subtitle: 'Community Wealth',
      description: 'Collaborate, contribute, and grow wealth together in SACCO groups',
      whyJoin: 'Build wealth faster with your trusted circle',
      features: ['Group collaboration', 'Wealth growth', 'Community benefits']
    },
    {
      image: '/images/ICAN era sacco.png',
      title: 'SACCO Groups',
      subtitle: 'Community Finance',
      description: 'Democratic savings groups with transparent fund management and rapid growth',
      whyJoin: 'Together we save more, grow faster, achieve more',
      features: ['Group savings', 'Transparent mgmt', 'Rapid growth']
    },
    {
      image: '/images/trust.png',
      title: 'ICAN Opportunities',
      subtitle: 'Global Access',
      description: 'Your readiness for global opportunities with comprehensive assessment',
      whyJoin: 'Unlock global opportunities with your ICAN Opportunity Rating',
      features: ['Opportunity assessment', 'Readiness evaluation', 'Global access']
    },
    {
      image: '/images/ICANera trust.png',
      title: 'Trust Platform',
      subtitle: 'Verified & Secure',
      description: 'Blockchain-verified trust management with complete transparency',
      whyJoin: 'Blockchain-backed trust that never lies, always protects',
      features: ['Blockchain verified', 'Full transparency', 'Secure transfers']
    },
    {
      image: '/images/ICANera trust 2.png',
      title: 'Trust Pro',
      subtitle: 'Advanced Features',
      description: 'Advanced trust management with smart contracts and automation',
      whyJoin: 'Smart contracts automate trust—no middleman needed',
      features: ['Smart contracts', 'Automation', 'Advanced controls']
    },
    {
      image: '/images/ICANera1.png',
      title: 'ICAN Ecosystem',
      subtitle: 'All-in-One Platform',
      description: 'Complete financial ecosystem with all tools integrated seamlessly',
      whyJoin: 'Everything you need—one powerful, integrated platform',
      features: ['Integrated platform', 'All features', 'Unified experience']
    },
    {
      image: '/images/ICANera 3.png',
      title: 'ICAN Premium',
      subtitle: 'Elite Features',
      description: 'Premium features for power users and enterprise clients',
      whyJoin: 'Premium power for ambitious financial champions',
      features: ['Premium tools', 'Priority support', 'Advanced analytics']
    },
    {
      image: '/images/ICANera tithe.png',
      title: 'Tithe Management',
      subtitle: 'Spiritual Giving',
      description: 'Give back to your faith community with smart tithe calculations and automatic contributions',
      whyJoin: 'Align your faith with your finances—giving made sacred',
      features: ['Tithe calculation', 'Auto-giving', 'Faith tracking', 'Community giving', 'Receipt records'],
      highlight: true
    },
    {
      image: '/images/ICANera tith2.png',
      title: 'Tithe Pro',
      subtitle: 'Advanced Giving',
      description: 'Professional tithe management with offerings, donations, and spiritual accountability',
      whyJoin: 'Spiritual accountability through transparent, purposeful giving',
      features: ['Multiple giving types', 'Donation tracking', 'Spiritual accountability', 'Community support', 'Impact reports']
    },
    {
      image: '/images/ICANera i.png',
      title: 'ICAN Core',
      subtitle: 'Foundation Platform',
      description: 'The core foundation enabling all ICAN financial services and integrations',
      whyJoin: 'The powerful foundation building your financial future',
      features: ['Foundation', 'Integration hub', 'Core services']
    }
  ];

  // Hero Feature Slides with same images
  const heroSlides = [
    {
      image: '/images/dairy expense and inacome.png',
      title: 'Expense & Income Tracker',
      subtitle: 'Smart financial management',
      description: 'Track every transaction with precision'
    },
    {
      image: '/images/ICANera expense.png',
      title: 'Financial Dashboard',
      subtitle: 'Advanced tracking',
      description: 'Real-time financial insights'
    },
    {
      image: '/images/icanera wallet.png',
      title: 'Digital Wallet',
      subtitle: 'Secure management',
      description: 'Manage accounts & balances'
    },
    {
      image: '/images/ICANwallet.png',
      title: 'Smart Wallet',
      subtitle: 'Fast & secure',
      description: 'Instant transactions'
    },
    {
      image: '/images/incaera share.png',
      title: 'Pitchin',
      subtitle: 'Investment hub',
      description: 'Share your vision'
    },
    {
      image: '/images/ICANera pitchin.png',
      title: 'Pitchin Pro',
      subtitle: 'Professional platform',
      description: 'Connect with investors'
    },
    {
      image: '/images/ICANera pitchin 8.png',
      title: 'Smart Matching',
      subtitle: 'AI-powered',
      description: 'Find perfect investors'
    },
    {
      image: '/images/cmms.png',
      title: 'Treasury Guardian',
      subtitle: 'Security platform',
      description: 'Enterprise protection'
    },
    {
      image: '/images/ICANera CMMS.png',
      title: 'CMMS System',
      subtitle: 'Management tools',
      description: 'Resource optimization'
    },
    {
      image: '/images/ICANera CMMS1.png',
      title: 'CMMS Pro',
      subtitle: 'Enterprise edition',
      description: 'Advanced operations'
    },
    {
      image: '/images/sacco.png',
      title: 'SACCO Groups',
      subtitle: 'Community wealth',
      description: 'Group savings & growth'
    },
    {
      image: '/images/ICAN era sacco.png',
      title: 'Trust Management',
      subtitle: 'Collaborative finance',
      description: 'Transparent group funds'
    },
    {
      image: '/images/trust.png',
      title: 'ICAN Opportunities',
      subtitle: 'Global access',
      description: 'Readiness assessment'
    },
    {
      image: '/images/ICANera trust.png',
      title: 'Trust Platform',
      subtitle: 'Blockchain verified',
      description: 'Transparent transfers'
    },
    {
      image: '/images/ICANera trust 2.png',
      title: 'Trust Pro',
      subtitle: 'Smart contracts',
      description: 'Automated trust mgmt'
    },
    {
      image: '/images/ICANera1.png',
      title: 'ICAN Ecosystem',
      subtitle: 'All-in-one platform',
      description: 'Integrated experience'
    },
    {
      image: '/images/ICANera 3.png',
      title: 'ICAN Premium',
      subtitle: 'Elite features',
      description: 'Power users'
    },
    {
      image: '/images/ICANera tithe.png',
      title: 'Tithe Management',
      subtitle: 'Spiritual giving',
      description: 'Smart contributions'
    },
    {
      image: '/images/ICANera tith2.png',
      title: 'Tithe Pro',
      subtitle: 'Advanced giving',
      description: 'Community support'
    }
  ];

  // Badge Information - Rotating Messages
  const badgeInfo = [
    {
      title: 'Complete Financial Solutions',
      description: 'ICAN\'s comprehensive suite of integrated platforms designed to empower your financial journey—from opportunity discovery to wealth management and beyond'
    },
    {
      title: '🚀 Smart Financial Management',
      description: 'Track expenses, manage income, and gain real-time insights into your financial health with AI-powered analytics'
    },
    {
      title: '💰 Wealth Accumulation Hub',
      description: 'Build generational wealth through SACCO groups, smart investing, and community-driven financial growth'
    },
    {
      title: '🔐 Enterprise Security',
      description: 'Blockchain-verified transactions, bank-level encryption, and transparent fund management for complete peace of mind'
    },
    {
      title: '🌍 Global Opportunities',
      description: 'Access international investment opportunities and get your ICAN Opportunity Rating for global business readiness'
    },
    {
      title: '🤝 Community Powered',
      description: 'Join thousands collaborating to create transparent, thriving savings groups with rapid wealth growth potential'
    },
    {
      title: '⚡ Lightning Fast Transactions',
      description: 'Experience blazing-fast wallet transfers, instant settlements, and real-time transaction updates 24/7'
    },
    {
      title: '📊 Advanced Analytics',
      description: 'Deep financial insights, predictive analytics, and smart recommendations to optimize your financial decisions'
    },
    {
      title: '🙏 Spiritual Giving Made Simple',
      description: 'Give back to your faith community with automated tithe calculations, giving tracking, and meaningful spiritual accountability'
    },
    {
      title: '💝 Give with Purpose',
      description: 'Manage offerings, donations, and community giving with transparent records and impact reports that matter'
    },
    {
      title: '✨ Spiritual Guidance & Finance',
      description: 'Integrate your spiritual values with smart financial decisions—align giving with your faith and community'
    }
  ];

  const features = [
    {
      icon: <Zap className="w-8 h-8" />,
      title: 'Lightning Fast',
      description: 'Experience blazing-fast transactions and real-time updates across all platforms'
    },
    {
      icon: <Shield className="w-8 h-8" />,
      title: 'Bank-Level Security',
      description: 'Enterprise-grade encryption and security protocols to protect your data'
    },
    {
      icon: <TrendingUp className="w-8 h-8" />,
      title: 'Smart Analytics',
      description: 'Powerful insights and analytics to make informed financial decisions'
    },
    {
      icon: <Users className="w-8 h-8" />,
      title: 'Community First',
      description: 'Build and grow with like-minded individuals in our vibrant ecosystem'
    }
  ];

  const testimonials = [
    {
      name: 'Sarah Okoye',
      role: 'Finance Manager',
      text: 'ICAN transformed how we manage our group finances. The dashboard is intuitive and powerful.',
      avatar: '👩‍💼'
    },
    {
      name: 'John Kipchoge',
      role: 'Business Owner',
      text: 'The wallet system is exactly what we needed. Security and speed combined perfectly.',
      avatar: '👨‍💼'
    },
    {
      name: 'Alice Mutua',
      role: 'Community Leader',
      text: 'Best platform for managing SACCO operations. Highly recommended for all groups!',
      avatar: '👩‍🌾'
    }
  ];

  // Auto-rotate slides
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentSlide((prev) => (prev + 1) % slides.length);
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  // Auto-rotate hero slides
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentHeroSlide((prev) => (prev + 1) % heroSlides.length);
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  // Auto-rotate badge information
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentBadgeInfo((prev) => (prev + 1) % badgeInfo.length);
    }, 6000);
    return () => clearInterval(interval);
  }, []);

  // Auto-rotate testimonials
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTestimonial((prev) => (prev + 1) % testimonials.length);
    }, 7000);
    return () => clearInterval(interval);
  }, []);

  // Handle scroll
  useEffect(() => {
    const handleScroll = () => {
      setScrollPosition(window.scrollY);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const nextSlide = () => {
    setCurrentSlide((prev) => (prev + 1) % slides.length);
  };

  const prevSlide = () => {
    setCurrentSlide((prev) => (prev - 1 + slides.length) % slides.length);
  };

  const nextHeroSlide = () => {
    setCurrentHeroSlide((prev) => (prev + 1) % heroSlides.length);
  };

  const prevHeroSlide = () => {
    setCurrentHeroSlide((prev) => (prev - 1 + heroSlides.length) % heroSlides.length);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-purple-950 to-slate-950 text-white overflow-hidden">
      {/* Animated background elements */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-purple-500/20 rounded-full blur-3xl animate-blob"></div>
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-blue-500/20 rounded-full blur-3xl animate-blob animation-delay-2000"></div>
        <div className="absolute top-1/2 right-1/3 w-96 h-96 bg-pink-500/10 rounded-full blur-3xl animate-blob animation-delay-4000"></div>
      </div>

      {/* Navigation */}
      <nav className="fixed top-0 w-full z-50 bg-slate-950/50 backdrop-blur-md border-b border-purple-500/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
          <div className="flex items-center space-x-3">
            <div className="text-3xl md:text-4xl font-black bg-gradient-to-r from-yellow-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
              ICANera
            </div>
            <div className="hidden sm:flex flex-col">
              <p className="text-xs md:text-sm font-semibold text-gray-300">Financial Ecosystem</p>
              <p className="text-xs text-purple-300">Wealth Platform</p>
            </div>
          </div>
          <div className="hidden md:flex space-x-8">
            <a href="#features" className="text-sm md:text-base font-medium hover:text-purple-400 transition">Features</a>
            <a href="#platforms" className="text-sm md:text-base font-medium hover:text-purple-400 transition">Platforms</a>
            <a href="#testimonials" className="text-sm md:text-base font-medium hover:text-purple-400 transition">Testimonials</a>
          </div>
          <button
            onClick={onGetStarted}
            className="bg-gradient-to-r from-purple-500 to-pink-500 px-6 py-2 rounded-lg font-semibold hover:shadow-lg hover:shadow-purple-500/50 transition transform hover:scale-105 text-sm md:text-base"
          >
            Get Started
          </button>
        </div>
      </nav>

      {/* Hero Section */}
      <div className="relative pt-16 md:pt-20 pb-12 md:pb-16 px-4 sm:px-6 lg:px-8 overflow-visible">
        {/* Decorative elements */}
        <div className="absolute top-10 left-5 w-32 h-32 bg-purple-500/5 rounded-full blur-3xl"></div>
        <div className="absolute bottom-10 right-10 w-40 h-40 bg-pink-500/5 rounded-full blur-3xl"></div>
        
        <div className="max-w-7xl mx-auto grid md:grid-cols-2 gap-6 md:gap-8 lg:gap-12 items-center relative">
          {/* Left Content - Collapsed to Icon */}
          <div className="flex items-center justify-center md:justify-start animate-fadeInUp relative z-40 w-full md:w-auto">
            <div className="w-full md:w-auto">
              {/* Mobile: Collapsible Badge */}
              <div className="md:hidden">
                <button 
                  onClick={() => setIsHeroExpanded(!isHeroExpanded)}
                  className="inline-flex items-center space-x-3 px-6 py-3 bg-gradient-to-r from-purple-500/90 via-pink-500/90 to-purple-600/90 hover:from-purple-500 hover:via-pink-500 hover:to-purple-600 rounded-full border border-purple-300/40 backdrop-blur-sm shadow-lg hover:shadow-2xl hover:shadow-purple-500/50 transition-all duration-300 transform hover:scale-110 w-full justify-center"
                  title="About ICAN Capital Engine"
                >
                  <Zap className="w-5 h-5 text-white drop-shadow-lg animate-pulse flex-shrink-0" />
                  <span className="text-sm font-bold text-white">Learn More</span>
                  <ChevronDown className={`w-4 h-4 text-white transition-transform duration-300 ${isHeroExpanded ? 'rotate-180' : ''}`} />
                </button>

                {/* Mobile Expanded Container */}
                {isHeroExpanded && (
                  <div className="mt-4 bg-gradient-to-br from-slate-900/95 to-slate-950/95 border border-purple-500/40 rounded-2xl p-6 space-y-5 shadow-2xl shadow-purple-500/30 backdrop-blur-xl animate-fadeInUp">
                    <div className="inline-flex items-center space-x-2 bg-gradient-to-r from-purple-500/20 to-pink-500/20 border border-purple-400/30 rounded-full px-4 py-2 w-full">
                      <Zap className="w-4 h-4 text-purple-300 flex-shrink-0" />
                      <span className="text-sm text-purple-200 font-medium">From Volatility to Global Capital → Your Path to Prosperity</span>
                    </div>
                    
                    <h2 className="text-2xl font-bold bg-gradient-to-r from-purple-300 via-pink-300 to-blue-300 bg-clip-text text-transparent leading-tight">
                      Build Generational Wealth Together
                    </h2>
                    
                    <div className="text-sm text-gray-300 leading-relaxed space-y-3">
                      <span className="block font-semibold text-purple-200 text-base">Empower Your Financial Future:</span>
                      <p>Harness the transformative power of democratic savings groups, secure wallet management, intelligent financial tracking for income and expenses, spiritual wealth growth through tithing, and blockchain-verified transactions. Join thousands building generational wealth through collaboration, transparency, and prosperity—designed for personal liberation and unstoppable business growth.</p>
                    </div>
                    
                    <div className="flex items-center space-x-2 pt-3">
                      <Shield className="w-5 h-5 text-green-400 flex-shrink-0" />
                      <span className="text-sm text-green-300 font-medium">Blockchain-Secured • Trusted • Transparent</span>
                    </div>
                    
                    <button className="inline-flex items-center space-x-2 px-6 py-3 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 rounded-full font-bold text-white transition-all duration-300 transform hover:scale-105 shadow-lg hover:shadow-xl hover:shadow-purple-500/50 mt-4 w-full justify-center">
                      <span>Explore Platforms</span>
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>

              {/* Desktop: Always Visible Full Container */}
              <div className="hidden md:block bg-gradient-to-br from-slate-900/95 to-slate-950/95 border border-purple-500/40 rounded-2xl p-6 md:p-8 space-y-5 shadow-2xl shadow-purple-500/30 backdrop-blur-xl w-full md:w-full lg:max-w-2xl">
                {/* Tag */}
                <div className="inline-flex items-center space-x-2 bg-gradient-to-r from-purple-500/20 to-pink-500/20 border border-purple-400/30 rounded-full px-4 py-2">
                  <Zap className="w-4 h-4 text-purple-300 flex-shrink-0" />
                  <span className="text-sm md:text-base text-purple-200 font-medium">From Volatility to Global Capital → Your Path to Prosperity</span>
                </div>
                
                {/* Headline */}
                <h2 className="text-2xl md:text-3xl lg:text-4xl font-bold bg-gradient-to-r from-purple-300 via-pink-300 to-blue-300 bg-clip-text text-transparent leading-tight">
                  Build Generational Wealth Together
                </h2>
                
                {/* Description */}
                <div className="text-sm md:text-base text-gray-300 leading-relaxed space-y-3">
                  <span className="block font-semibold text-purple-200 text-base md:text-lg">Empower Your Financial Future:</span>
                  <p>Harness the transformative power of democratic savings groups, secure wallet management, intelligent financial tracking for income and expenses, spiritual wealth growth through tithing, and blockchain-verified transactions. Join thousands building generational wealth through collaboration, transparency, and prosperity—designed for personal liberation and unstoppable business growth.</p>
                </div>
                
                {/* Trust Badge */}
                <div className="flex items-center space-x-2 pt-3">
                  <Shield className="w-5 h-5 text-green-400 flex-shrink-0" />
                  <span className="text-sm text-green-300 font-medium">Blockchain-Secured • Trusted • Transparent</span>
                </div>
                
                {/* CTA Button */}
                <button className="inline-flex items-center space-x-2 px-6 py-3 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 rounded-full font-bold text-white transition-all duration-300 transform hover:scale-105 shadow-lg hover:shadow-xl hover:shadow-purple-500/50 mt-4">
                  <span>Explore Platforms</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          {/* Right - Feature Image Showcase Carousel */}
          <div className="relative animate-fadeInDown hidden md:flex items-center justify-center h-full min-h-96 z-0">
            <div className="relative w-full max-w-lg group">
              {/* Image container with carousel */}
              <div className="relative rounded-3xl overflow-hidden">
                {/* Content - Animated Carousel */}
                <div className="relative space-y-6">
                  {/* Image with slide transition */}
                  <div className="relative h-80 rounded-2xl overflow-hidden shadow-lg group/image">
                    <img 
                      src={heroSlides[currentHeroSlide].image}
                      alt={heroSlides[currentHeroSlide].title}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        e.target.style.display = 'none';
                      }}
                    />
                  </div>
                  
                  {/* Label with animation */}
                  <div className="text-center space-y-2 animate-fadeIn">
                    <p className="text-xs text-yellow-300 font-semibold uppercase tracking-wider">✨ {heroSlides[currentHeroSlide].subtitle}</p>
                    <h3 className="text-xl font-bold bg-gradient-to-r from-purple-200 via-pink-200 to-purple-200 bg-clip-text text-transparent">{heroSlides[currentHeroSlide].title}</h3>
                    <p className="text-sm text-gray-400">{heroSlides[currentHeroSlide].description}</p>
                  </div>

                  {/* Slide Navigation Buttons - Small */}
                  <div className="flex gap-2 justify-center mt-4">
                    <button
                      onClick={prevHeroSlide}
                      className="p-2 rounded-full bg-purple-500/30 hover:bg-purple-500/60 transition transform hover:scale-110 group/btn"
                    >
                      <ChevronRight className="w-4 h-4 transform rotate-180 group-hover/btn:translate-x-0.5 transition" />
                    </button>
                    <button
                      onClick={nextHeroSlide}
                      className="p-2 rounded-full bg-purple-500/30 hover:bg-purple-500/60 transition transform hover:scale-110 group/btn"
                    >
                      <ChevronRight className="w-4 h-4 group-hover/btn:-translate-x-0.5 transition" />
                    </button>
                  </div>

                  {/* Mini Slide Indicators - Hidden on Mobile */}
                  <div className="hidden md:flex gap-1 justify-center mt-3 flex-wrap">
                    {heroSlides.map((_, index) => (
                      <button
                        key={index}
                        onClick={() => setCurrentHeroSlide(index)}
                        className={`rounded-full transition transform hover:scale-125 ${
                          index === currentHeroSlide
                            ? 'bg-gradient-to-r from-yellow-500 to-yellow-400 w-4 h-1.5'
                            : 'bg-purple-500/30 w-1.5 h-1.5 hover:bg-yellow-500/60'
                        }`}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Image Carousel Section - Our Platforms */}
      {/* Features Section - COMMENTED OUT */}
      {/* <section id="features" className="relative py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-2xl md:text-4xl lg:text-5xl font-bold mb-3 md:mb-4 leading-tight">
              <span className="bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
                Our Platforms
              </span>
            </h2>
            <p className="text-gray-400 text-sm md:text-base lg:text-lg">Comprehensive solutions tailored for your financial success</p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {features.map((feature, index) => (
              <div
                key={index}
                className="group bg-gradient-to-br from-purple-900/20 to-blue-900/20 border border-purple-500/20 rounded-xl p-6 hover:border-purple-500/50 transition transform hover:scale-105 hover:shadow-lg hover:shadow-purple-500/20"
              >
                <div className="text-purple-400 mb-4 group-hover:scale-110 transition transform">
                  {feature.icon}
                </div>
                <h3 className="text-xl font-bold mb-2">{feature.title}</h3>
                <p className="text-gray-400">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section> */}

      {/* Lightning Fast, Bank-Level Security, Smart Analytics, Community First - COMMENTED OUT */}
      {/* 
      <section className="features-section">
        Lightning Fast
        Experience blazing-fast transactions and real-time updates across all platforms

        Bank-Level Security
        Enterprise-grade encryption and security protocols to protect your data

        Smart Analytics
        Powerful insights and analytics to make informed financial decisions

        Community First
        Build and grow with like-minded individuals in our vibrant ecosystem
      </section>
      */}

      {/* Image Carousel Section */}
      <section id="platforms" className="relative py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          {/* Animated Badge Section */}
          <div className="text-center mb-12 md:mb-16">
            {/* Main Badge Container */}
            <div className="inline-block mb-8">
              <div className="relative group">
                {/* Glow effect */}
                <div className="absolute inset-0 bg-gradient-to-r from-yellow-500/30 via-purple-500/20 to-pink-500/30 rounded-3xl blur-2xl group-hover:opacity-100 opacity-70 transition duration-500 animate-pulse"></div>
                
                {/* Badge */}
                <div className="relative bg-gradient-to-br from-slate-900/95 to-slate-950/95 border border-yellow-500/40 rounded-3xl px-6 md:px-10 py-4 md:py-6 backdrop-blur-xl shadow-2xl shadow-yellow-500/20">
                  {/* Animated gradient border */}
                  <div className="absolute inset-0 rounded-3xl bg-gradient-to-r from-yellow-500/0 via-yellow-500/20 to-pink-500/0 animate-pulse pointer-events-none"></div>
                  
                  {/* Badge Content */}
                  <div className="relative space-y-2 min-h-24 md:min-h-20 flex flex-col justify-center">
                    {/* Animated Title */}
                    <div className="relative">
                      <h2 className="text-2xl md:text-4xl lg:text-5xl font-bold mb-2 md:mb-3 leading-tight min-h-16 md:min-h-14 flex items-center justify-center">
                        <span 
                          key={currentBadgeInfo}
                          className="bg-gradient-to-r from-yellow-300 via-purple-300 to-pink-300 bg-clip-text text-transparent animate-fadeIn"
                        >
                          {badgeInfo[currentBadgeInfo].title}
                        </span>
                      </h2>
                    </div>
                    
                    {/* Animated Description */}
                    <div className="relative min-h-12 flex items-center justify-center">
                      <p 
                        key={`desc-${currentBadgeInfo}`}
                        className="text-gray-300 text-sm md:text-base max-w-3xl mx-auto leading-relaxed animate-fadeIn"
                      >
                        {badgeInfo[currentBadgeInfo].description}
                      </p>
                    </div>

                    {/* Badge Indicators - Hidden on Mobile */}
                    <div className="hidden md:flex gap-1 justify-center mt-4 flex-wrap">
                      {badgeInfo.map((_, index) => (
                        <button
                          key={index}
                          onClick={() => setCurrentBadgeInfo(index)}
                          className={`rounded-full transition transform hover:scale-125 ${
                            index === currentBadgeInfo
                              ? 'bg-gradient-to-r from-yellow-500 to-pink-500 w-3 h-3 shadow-lg shadow-yellow-500/50'
                              : 'bg-purple-500/30 w-2 h-2 hover:bg-yellow-500/60'
                          }`}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Carousel Container with Golden Border Animation */}
          <div className="relative">
            {/* Main Carousel */}
            <div className="relative">
              {/* Inner Content */}
              <div className="relative rounded-3xl overflow-hidden">
                {/* Main Image - Full Screen */}
                <div className="relative h-96 md:h-[600px] lg:h-[700px] overflow-hidden shadow-2xl">
                  <img
                    src={slides[currentSlide].image}
                    alt={slides[currentSlide].title}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      e.target.style.display = 'none';
                    }}
                  />

                  {/* Text Overlay - "Why Join" Message */}
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-950/85 via-slate-950/40 to-slate-950/20 flex flex-col items-center justify-center p-4 md:p-8">
                    <div className="text-center space-y-3 md:space-y-4 animate-fadeIn max-w-2xl">
                      <p className="text-xl md:text-2xl lg:text-4xl font-bold bg-gradient-to-r from-yellow-300 via-purple-300 to-pink-300 bg-clip-text text-transparent leading-tight">
                        {slides[currentSlide].whyJoin}
                      </p>
                      <p className="text-xs md:text-sm lg:text-base text-purple-200 font-medium opacity-90">
                        Join ICANera Today
                      </p>
                    </div>
                  </div>

                  {/* Featured badge for Expense & Income Tracker */}
                  {slides[currentSlide].highlight && (
                    <div className="absolute top-4 right-4 md:top-6 md:right-6 px-4 py-2 md:px-5 md:py-3 bg-gradient-to-r from-yellow-500 to-yellow-400 rounded-full shadow-lg shadow-yellow-500/60 animate-bounce">
                      <p className="text-xs md:text-sm font-bold text-slate-900">⭐ FEATURED</p>
                    </div>
                  )}
                </div>

                {/* Navigation Buttons with Golden Accents */}
                <button
                  onClick={prevSlide}
                  className="absolute left-4 top-1/2 transform -translate-y-1/2 z-20 bg-gradient-to-r from-purple-600 to-purple-500 hover:from-purple-500 hover:to-purple-400 rounded-full p-3 md:p-4 transition group shadow-lg shadow-purple-500/50 hover:shadow-xl hover:shadow-yellow-500/30"
                >
                  <ChevronRight className="w-5 h-5 md:w-6 md:h-6 transform rotate-180 group-hover:translate-x-1 transition" />
                </button>
                <button
                  onClick={nextSlide}
                  className="absolute right-4 top-1/2 transform -translate-y-1/2 z-20 bg-gradient-to-r from-purple-600 to-purple-500 hover:from-purple-500 hover:to-purple-400 rounded-full p-3 md:p-4 transition group shadow-lg shadow-purple-500/50 hover:shadow-xl hover:shadow-yellow-500/30"
                >
                  <ChevronRight className="w-5 h-5 md:w-6 md:h-6 group-hover:translate-x-1 transition" />
                </button>

                {/* Slide indicators - Hidden on Mobile, Visible on Desktop */}
                <div className="hidden md:flex absolute bottom-4 left-1/2 transform -translate-x-1/2 gap-2 z-20 bg-slate-950/80 px-4 py-3 rounded-full backdrop-blur-md border border-yellow-500/30 shadow-lg shadow-yellow-500/20">
                  {slides.map((_, index) => (
                    <button
                      key={index}
                      onClick={() => setCurrentSlide(index)}
                      className={`rounded-full transition transform hover:scale-125 ${
                        index === currentSlide
                          ? 'bg-gradient-to-r from-yellow-500 to-yellow-400 w-8 h-2.5 shadow-lg shadow-yellow-500/60'
                          : 'bg-purple-500/40 w-2.5 h-2.5 hover:bg-yellow-500/60'
                      }`}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Platform Icons Grid - Single Row, Text on Hover */}
          <div className="flex justify-center gap-3 md:gap-5 mt-6 md:mt-8 overflow-x-auto px-4 pb-2">
            {slides.map((slide, index) => (
              <button
                key={index}
                onClick={() => setCurrentSlide(index)}
                className={`group flex flex-col items-center space-y-1 px-0 py-1 rounded-md transition transform hover:scale-110 flex-shrink-0 ${
                  index === currentSlide
                    ? 'bg-purple-500/30'
                    : 'hover:bg-purple-500/10'
                }`}
              >
                <div className="w-8 h-8 md:w-10 md:h-10 rounded-md overflow-hidden border border-purple-500/40">
                  <img
                    src={slide.image}
                    alt={slide.title}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      e.target.style.display = 'none';
                    }}
                  />
                </div>
                <p className="font-medium text-[0.5rem] md:text-sm text-center whitespace-nowrap text-purple-200 opacity-0 md:opacity-0 md:group-hover:opacity-100 md:group-[.bg-purple-500/30]:opacity-100 transition-opacity duration-200 h-3 md:h-5 lg:opacity-0 lg:group-hover:opacity-100">{slide.title}</p>
              </button>
            ))}
          </div>

          {/* Call-to-Action Buttons and Stats Section */}
          <div className="mt-4 md:mt-12 space-y-3 md:space-y-8 text-center">
            {/* Buttons */}
            <div className="flex flex-col sm:flex-row gap-2 md:gap-4 justify-center">
              <button
                onClick={onGetStarted}
                className="group bg-gradient-to-r from-purple-500 to-pink-500 px-4 md:px-8 py-2 md:py-4 rounded-lg font-bold text-sm md:text-lg flex items-center justify-center space-x-2 hover:shadow-lg hover:shadow-purple-500/50 transition transform hover:scale-105"
              >
                <span>Start Your Journey</span>
                <ArrowRight className="w-4 h-4 md:w-5 md:h-5 group-hover:translate-x-1 transition" />
              </button>
              <button className="border-2 border-purple-400 px-4 md:px-8 py-2 md:py-4 rounded-lg font-bold text-sm md:text-lg hover:bg-purple-500/10 transition">
                Learn More
              </button>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-2 md:gap-4 pt-3 md:pt-8 border-t border-purple-500/20">
              <div className="text-center">
                <p className="text-lg md:text-4xl font-bold text-purple-400">10K+</p>
                <p className="text-gray-400 text-xs md:text-base">Active Users</p>
              </div>
              <div className="text-center">
                <p className="text-lg md:text-4xl font-bold text-pink-400">$50M+</p>
                <p className="text-gray-400 text-xs md:text-base">Volume Managed</p>
              </div>
              <div className="text-center">
                <p className="text-lg md:text-4xl font-bold text-blue-400">99.9%</p>
                <p className="text-gray-400 text-xs md:text-base">Uptime</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Testimonials Section - Compact Animated Badge */}
      <section id="testimonials" className="relative py-6 md:py-8 lg:py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
          {/* Compact Testimonial Badge - Horizontal */}
          <div className="relative group">
            {/* Animated Glow */}
            <div className="absolute inset-0 bg-gradient-to-r from-cyan-500/20 via-purple-500/20 to-pink-500/20 rounded-2xl blur-xl group-hover:opacity-100 opacity-50 transition duration-500 animate-pulse"></div>
            
            {/* Badge Container - Compact Horizontal */}
            <div className="relative bg-gradient-to-br from-slate-900/90 to-slate-950/90 border border-cyan-500/30 rounded-2xl px-4 md:px-8 py-4 md:py-6 backdrop-blur-xl shadow-lg shadow-cyan-500/10">
              {/* Animated Border */}
              <div className="absolute inset-0 rounded-2xl bg-gradient-to-r from-cyan-500/0 via-purple-500/20 to-pink-500/0 animate-pulse pointer-events-none"></div>
              
              {/* Horizontal Layout */}
              <div className="relative flex flex-col md:flex-row items-center justify-between gap-4 md:gap-6">
                {/* Left - Avatar & Name (Compact) */}
                <div 
                  key={`user-${currentTestimonial}`}
                  className="flex items-center gap-3 md:gap-4 min-w-max animate-fadeIn"
                >
                  <span className="text-3xl md:text-4xl flex-shrink-0">{testimonials[currentTestimonial].avatar}</span>
                  <div className="text-left">
                    <p className="font-bold text-sm md:text-base text-white">{testimonials[currentTestimonial].name}</p>
                    <p className="text-xs md:text-sm bg-gradient-to-r from-cyan-300 to-purple-300 bg-clip-text text-transparent font-semibold">{testimonials[currentTestimonial].role}</p>
                  </div>
                </div>

                {/* Middle - Quote (Compact) */}
                <div className="flex-grow text-center md:text-left">
                  <p 
                    key={`quote-${currentTestimonial}`}
                    className="text-gray-300 italic text-xs md:text-sm leading-relaxed line-clamp-2 animate-fadeIn"
                  >
                    "{testimonials[currentTestimonial].text}"
                  </p>
                </div>

                {/* Right - Controls (Compact) */}
                <div className="flex gap-2 items-center flex-shrink-0">
                  {/* Stars */}
                  <div className="flex gap-0.5">
                    {[...Array(5)].map((_, i) => (
                      <span key={i} className="text-lg md:text-xl">⭐</span>
                    ))}
                  </div>
                  
                  {/* Nav Buttons */}
                  <div className="flex gap-1 md:gap-2">
                    <button
                      onClick={() => setCurrentTestimonial((prev) => (prev - 1 + testimonials.length) % testimonials.length)}
                      className="p-1.5 md:p-2 rounded-full bg-cyan-500/30 hover:bg-cyan-500/50 transition transform hover:scale-110 group/btn border border-cyan-400/30 hover:border-cyan-400/60"
                    >
                      <ChevronRight className="w-4 h-4 md:w-5 md:h-5 transform rotate-180" />
                    </button>
                    <button
                      onClick={() => setCurrentTestimonial((prev) => (prev + 1) % testimonials.length)}
                      className="p-1.5 md:p-2 rounded-full bg-cyan-500/30 hover:bg-cyan-500/50 transition transform hover:scale-110 group/btn border border-cyan-400/30 hover:border-cyan-400/60"
                    >
                      <ChevronRight className="w-4 h-4 md:w-5 md:h-5" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Indicators - Hidden on Mobile, Visible on Desktop */}
              <div className="hidden md:flex gap-1 justify-center mt-3 flex-wrap relative z-10">
                {testimonials.map((_, index) => (
                  <button
                    key={index}
                    onClick={() => setCurrentTestimonial(index)}
                    className={`rounded-full transition transform hover:scale-125 ${
                      index === currentTestimonial
                        ? 'bg-gradient-to-r from-cyan-400 to-purple-400 w-3 h-3 shadow-lg shadow-cyan-500/50'
                        : 'bg-purple-500/30 w-2 h-2 hover:bg-cyan-500/50'
                    }`}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="relative py-8 md:py-12 lg:py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto">
          <div className="bg-gradient-to-r from-purple-900/40 via-pink-900/40 to-blue-900/40 border border-purple-500/30 rounded-xl md:rounded-2xl p-4 md:p-8 lg:p-16 text-center">
            <h2 className="text-xl md:text-3xl lg:text-5xl font-bold mb-3 md:mb-4 lg:mb-6 leading-tight">
              Ready to Transform Your Capital?
            </h2>
            <p className="text-xs md:text-sm lg:text-xl text-gray-300 mb-4 md:mb-6 lg:mb-8 leading-relaxed">
              Join the revolution and take control of your financial future today.
            </p>
            <button
              onClick={onGetStarted}
              className="group bg-gradient-to-r from-purple-500 to-pink-500 px-4 md:px-8 lg:px-10 py-2 md:py-3 lg:py-4 rounded-lg font-bold text-xs md:text-sm lg:text-lg inline-flex items-center space-x-2 hover:shadow-lg hover:shadow-purple-500/50 transition transform hover:scale-105"
            >
              <span>Get Started Now</span>
              <ArrowRight className="w-4 h-4 md:w-5 md:h-5 group-hover:translate-x-1 transition" />
            </button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative border-t border-purple-500/10 py-6 md:py-10 lg:py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6 lg:gap-8 mb-4 md:mb-8">
            <div>
              <h3 className="text-lg md:text-xl font-bold bg-gradient-to-r from-yellow-400 via-purple-400 to-pink-400 bg-clip-text text-transparent mb-2 md:mb-4">ICANera</h3>
              <p className="text-gray-400 text-xs md:text-sm font-medium">Transform Volatility to Global Capital</p>
              <p className="text-purple-300 text-xs md:text-sm mt-2 font-semibold">@icaneraera</p>
            </div>
            <div>
              <h4 className="font-bold text-sm md:text-base mb-2 md:mb-4">Product</h4>
              <ul className="space-y-1 md:space-y-2 text-gray-400 text-xs md:text-sm">
                <li><a href="#" className="hover:text-purple-400 transition">Features</a></li>
                <li><a href="#" className="hover:text-purple-400 transition">Pricing</a></li>
                <li><a href="#" className="hover:text-purple-400 transition">Security</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-bold text-sm md:text-base mb-2 md:mb-4">Company</h4>
              <ul className="space-y-1 md:space-y-2 text-gray-400 text-xs md:text-sm">
                <li><a href="#" className="hover:text-purple-400 transition">About</a></li>
                <li><a href="#" className="hover:text-purple-400 transition">Blog</a></li>
                <li><a href="#" className="hover:text-purple-400 transition">Careers</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-bold text-sm md:text-base mb-2 md:mb-4">Legal</h4>
              <ul className="space-y-1 md:space-y-2 text-gray-400 text-xs md:text-sm">
                <li><a href="#" className="hover:text-purple-400 transition">Privacy</a></li>
                <li><a href="#" className="hover:text-purple-400 transition">Terms</a></li>
                <li><a href="#" className="hover:text-purple-400 transition">Contact</a></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-purple-500/10 pt-4 md:pt-6 lg:pt-8 flex flex-col md:flex-row justify-between items-center text-gray-400 text-xs md:text-sm gap-3">
            <p>&copy; 2024 ICANera. All rights reserved.</p>
            <div className="flex space-x-4 md:space-x-6">
              <a href="https://twitter.com/icaneraera" target="_blank" rel="noopener noreferrer" className="hover:text-purple-400 transition flex items-center space-x-1">
                <span>𝕏</span>
                <span>@icaneraera</span>
              </a>
              <a href="https://instagram.com/icaneraera" target="_blank" rel="noopener noreferrer" className="hover:text-purple-400 transition flex items-center space-x-1">
                <span>📷</span>
                <span>@icaneraera</span>
              </a>
              <a href="mailto:icaneraera@gmail.com" className="hover:text-purple-400 transition flex items-center space-x-1">
                <span>✉️</span>
                <span>Email</span>
              </a>
              <a href="#" className="hover:text-purple-400 transition">Discord</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;
