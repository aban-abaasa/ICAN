import React, { useState, useEffect } from 'react';
import { ChevronRight, Play, Zap, Shield, TrendingUp, Users, ArrowRight, ChevronDown } from 'lucide-react';
import DashboardPreview from './DashboardPreview';

const LandingPage = ({ onGetStarted }) => {
  const [currentSlide, setCurrentSlide] = useState(0);
  const [scrollPosition, setScrollPosition] = useState(0);

  // Image slides with descriptions
  const slides = [
    {
      image: '/images/icanera%20wallet.png',
      title: 'ICAN Wallet',
      description: 'Secure digital wallet for managing your finances with real-time transaction tracking',
      features: ['Real-time tracking', 'Secure transactions', 'Multiple accounts']
    },
    {
      image: '/images/incaera%20share.png',
      title: 'Share Network',
      description: 'Connect and collaborate with your community through our integrated sharing platform',
      features: ['Community driven', 'Easy sharing', 'Social features']
    },
    {
      image: '/images/dairy%20expense%20and%20inacome.png',
      title: 'Expense & Income Tracker',
      description: 'Intelligent financial tracking to monitor your daily expenses and income with detailed insights',
      features: ['Daily tracking', 'Smart categorization', 'Financial insights']
    },
    {
      image: '/images/cmms.png',
      title: 'CMMS System',
      description: 'Comprehensive Maintenance Management System for enterprise-level operations',
      features: ['Asset tracking', 'Maintenance scheduling', 'Analytics dashboard']
    },
    {
      image: '/images/sacco.png',
      title: 'SACCO Hub',
      description: 'Savings and Credit Cooperative Organization platform for group management',
      features: ['Group savings', 'Loan management', 'Member benefits']
    },
    {
      image: '/images/trust.png',
      title: 'Trust System',
      description: 'Verify member credibility and manage SACCO group transactions with blockchain-backed verification and reputation tracking for secure community lending',
      features: ['Member verification', 'SACCO management', 'Transaction verification']
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
          <div className="text-2xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
            ICAN Capital Engine
          </div>
          <div className="hidden md:flex space-x-8">
            <a href="#features" className="hover:text-purple-400 transition">Features</a>
            <a href="#platforms" className="hover:text-purple-400 transition">Platforms</a>
            <a href="#testimonials" className="hover:text-purple-400 transition">Testimonials</a>
          </div>
          <button
            onClick={onGetStarted}
            className="bg-gradient-to-r from-purple-500 to-pink-500 px-6 py-2 rounded-lg font-semibold hover:shadow-lg hover:shadow-purple-500/50 transition transform hover:scale-105"
          >
            Get Started
          </button>
        </div>
      </nav>

      {/* Hero Section */}
      <div className="relative pt-32 pb-8 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto grid md:grid-cols-2 gap-12 items-center">
          {/* Left Content */}
          <div className="space-y-8 animate-fadeInUp">
            <div className="space-y-4">
              <div className="inline-flex items-center space-x-2 bg-purple-500/10 border border-purple-500/30 rounded-full px-2 sm:px-4 py-2">
                <Zap className="w-4 h-4 text-purple-400 flex-shrink-0" />
                <span className="text-xs sm:text-sm text-purple-300">From Volatility to Global Capital</span>
              </div>
              <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold leading-tight">
                <span className="bg-gradient-to-r from-purple-400 via-pink-400 to-blue-400 bg-clip-text text-transparent">
                  Build Generational Wealth Together
                </span>
              </h1>
              <p className="text-base sm:text-lg md:text-xl text-gray-300 leading-relaxed">
                Harness the power of democratic savings groups, secure wallet management, intelligent financial tracking for income and expenses, spiritual wealth growth through tithing, and blockchain-verified transactions—all in one platform designed to build generational wealth for personal and business growth.
              </p>
            </div>
          </div>

          {/* Right - Ugandan User Illustration */}
          <div className="relative animate-fadeInDown hidden md:flex items-center justify-center h-full">
            <svg viewBox="0 0 400 600" className="w-full max-w-md h-auto" xmlns="http://www.w3.org/2000/svg">
              {/* Background Glow */}
              <defs>
                <linearGradient id="bgGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" style={{stopColor: '#a855f7', stopOpacity: 0.2}} />
                  <stop offset="100%" style={{stopColor: '#ec4899', stopOpacity: 0.2}} />
                </linearGradient>
                <linearGradient id="skinTone" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" style={{stopColor: '#92612d'}} />
                  <stop offset="100%" style={{stopColor: '#6d4423'}} />
                </linearGradient>
              </defs>

              {/* Background Circle */}
              <circle cx="200" cy="300" r="180" fill="url(#bgGradient)" opacity="0.5" />

              {/* Head */}
              <circle cx="200" cy="120" r="45" fill="url(#skinTone)" />

              {/* Hair */}
              <path d="M 155 110 Q 155 60 200 60 Q 245 60 245 110" fill="#3d2817" />

              {/* Ears */}
              <circle cx="155" cy="120" r="12" fill="#8b5a2b" />
              <circle cx="245" cy="120" r="12" fill="#8b5a2b" />

              {/* Face Expression - Happy */}
              {/* Eyes */}
              <circle cx="185" cy="110" r="5" fill="#1a1a1a" />
              <circle cx="215" cy="110" r="5" fill="#1a1a1a" />
              <circle cx="186" cy="108" r="2" fill="#ffffff" />
              <circle cx="216" cy="108" r="2" fill="#ffffff" />

              {/* Smile */}
              <path d="M 185 125 Q 200 135 215 125" stroke="#6d4423" strokeWidth="2" fill="none" strokeLinecap="round" />
              <path d="M 190 125 L 210 125" stroke="#f5deb3" strokeWidth="1" fill="none" />

              {/* Nose */}
              <path d="M 200 115 L 200 123" stroke="#8b5a2b" strokeWidth="1" />

              {/* Neck */}
              <rect x="185" y="160" width="30" height="20" fill="url(#skinTone)" />

              {/* Shirt - Smart Casual Ugandan Style */}
              <path d="M 140 180 L 140 280 Q 140 300 160 300 L 240 300 Q 260 300 260 280 L 260 180 Z" fill="#1e40af" />
              <path d="M 140 180 L 260 180" stroke="#ec4899" strokeWidth="2" />

              {/* Collar */}
              <path d="M 190 180 L 185 200 L 200 195 L 215 200 L 210 180" fill="#1e40af" />

              {/* Shirt Details - Gold/Purple accent stripes (Ugandan fashion) */}
              <line x1="160" y1="200" x2="240" y2="200" stroke="#f59e0b" strokeWidth="2" opacity="0.6" />
              <line x1="160" y1="250" x2="240" y2="250" stroke="#a855f7" strokeWidth="2" opacity="0.6" />

              {/* Left Arm - Holding Phone */}
              <g transform="translate(140, 200)">
                {/* Arm */}
                <rect x="0" y="0" width="20" height="80" rx="10" fill="url(#skinTone)" />
                {/* Hand */}
                <circle cx="10" cy="85" r="12" fill="#92612d" />
              </g>

              {/* Right Arm - Gesturing happily */}
              <g transform="translate(240, 190) rotate(-30)">
                <rect x="0" y="0" width="20" height="75" rx="10" fill="url(#skinTone)" />
                <circle cx="10" cy="80" r="12" fill="#92612d" />
              </g>

              {/* ICAN Wallet/Phone in Hand */}
              <g transform="translate(100, 240)">
                {/* Phone Body */}
                <rect x="0" y="0" width="60" height="110" rx="8" fill="#1f2937" stroke="#ec4899" strokeWidth="2" />
                
                {/* Screen */}
                <rect x="4" y="8" width="52" height="94" rx="4" fill="#0f172a" />

                {/* ICAN Wallet Display */}
                {/* Header */}
                <rect x="6" y="12" width="48" height="18" fill="#a855f7" rx="2" />
                <text x="30" y="25" textAnchor="middle" fill="#ffffff" fontSize="8" fontWeight="bold">ICAN Wallet</text>

                {/* Balance */}
                <text x="30" y="45" textAnchor="middle" fill="#ec4899" fontSize="7" fontWeight="bold">SACCO Balance</text>
                <text x="30" y="56" textAnchor="middle" fill="#22c55e" fontSize="10" fontWeight="bold">450,000 UGX</text>

                {/* Quick Actions */}
                <rect x="8" y="65" width="14" height="14" rx="2" fill="#3b82f6" />
                <text x="15" y="73" textAnchor="middle" fill="#ffffff" fontSize="6" fontWeight="bold">Send</text>

                <rect x="24" y="65" width="14" height="14" rx="2" fill="#10b981" />
                <text x="31" y="73" textAnchor="middle" fill="#ffffff" fontSize="6" fontWeight="bold">Receive</text>

                <rect x="40" y="65" width="14" height="14" rx="2" fill="#f59e0b" />
                <text x="47" y="73" textAnchor="middle" fill="#ffffff" fontSize="6" fontWeight="bold">Contribute</text>

                {/* Recent Activity */}
                <line x1="8" y1="85" x2="52" y2="85" stroke="#4b5563" strokeWidth="0.5" />
                <text x="30" y="98" textAnchor="middle" fill="#9ca3af" fontSize="5">✓ Contribution Approved</text>
              </g>

              {/* Lower body - Pants and Shoes */}
              <path d="M 170 300 L 165 360 L 190 360 L 195 300" fill="#2d3748" />
              <path d="M 205 300 L 210 360 L 235 360 L 230 300" fill="#1a202c" />

              {/* Shoes */}
              <ellipse cx="177" cy="365" rx="15" ry="8" fill="#1a1a1a" />
              <ellipse cx="222" cy="365" rx="15" ry="8" fill="#1a1a1a" />

              {/* Success Badge - Floating */}
              <g transform="translate(300, 150)">
                <circle cx="0" cy="0" r="35" fill="#10b981" opacity="0.9" />
                <text x="0" y="0" textAnchor="middle" dominantBaseline="middle" fill="#ffffff" fontSize="16" fontWeight="bold">✓</text>
                <text x="0" y="22" textAnchor="middle" fill="#ffffff" fontSize="11" fontWeight="bold">Transaction</text>
                <text x="0" y="35" textAnchor="middle" fill="#ffffff" fontSize="11" fontWeight="bold">Successful</text>
              </g>

              {/* Confetti/Celebration - Small animated circles */}
              <circle cx="80" cy="100" r="3" fill="#fbbf24" opacity="0.8" />
              <circle cx="320" cy="120" r="3" fill="#a855f7" opacity="0.8" />
              <circle cx="100" cy="160" r="2.5" fill="#ec4899" opacity="0.8" />
              <circle cx="300" cy="180" r="2.5" fill="#10b981" opacity="0.8" />

              {/* Text Label */}
              <text x="200" y="540" textAnchor="middle" fill="#a78bfa" fontSize="14" fontWeight="bold">
                Happy SACCO Member
              </text>
              <text x="200" y="560" textAnchor="middle" fill="#9ca3af" fontSize="11">
                Contributing & Growing Together
              </text>
            </svg>

            {/* Animated background elements */}
            <div className="absolute inset-0 -z-10">
              <div className="absolute top-10 right-10 w-20 h-20 bg-purple-500/20 rounded-full blur-3xl animate-pulse"></div>
              <div className="absolute bottom-20 left-10 w-32 h-32 bg-pink-500/10 rounded-full blur-3xl animate-pulse" style={{animationDelay: '0.5s'}}></div>
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
          <div className="text-center mb-12 md:mb-16">
            <h2 className="text-2xl md:text-4xl lg:text-5xl font-bold mb-3 md:mb-4 leading-tight">
              <span className="bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
                Build Wealth Smarter
              </span>
            </h2>
          </div>

          {/* Carousel */}
          <div className="relative group">
            {/* Main Image - Full Screen */}
            <div className="relative h-96 md:h-[600px] lg:h-[700px] bg-gradient-to-br from-purple-900/30 to-blue-900/30 rounded-2xl border border-purple-500/30 overflow-hidden">
              <img
                src={slides[currentSlide].image}
                alt={slides[currentSlide].title}
                className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition duration-500"
              />
              
              {/* Overlay with content */}
              <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-transparent to-transparent flex flex-col justify-end p-6 md:p-8 lg:p-12">
                <div className="space-y-3 md:space-y-4 animate-fadeIn">
                  <div>
                    <h3 className="text-2xl md:text-3xl lg:text-4xl font-bold mb-2">{slides[currentSlide].title}</h3>
                    <p className="text-sm md:text-base lg:text-xl text-gray-300">{slides[currentSlide].description}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {slides[currentSlide].features.map((feature, idx) => (
                      <span key={idx} className="px-3 py-1 md:px-4 md:py-2 bg-purple-500/30 border border-purple-500/50 rounded-full text-xs md:text-sm text-purple-200">
                        {feature}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Navigation Buttons */}
            <button
              onClick={prevSlide}
              className="absolute left-4 top-1/2 transform -translate-y-1/2 z-10 bg-purple-500/50 hover:bg-purple-500 rounded-full p-2 md:p-3 transition group"
            >
              <ChevronRight className="w-5 h-5 md:w-6 md:h-6 transform rotate-180 group-hover:translate-x-1 transition" />
            </button>
            <button
              onClick={nextSlide}
              className="absolute right-4 top-1/2 transform -translate-y-1/2 z-10 bg-purple-500/50 hover:bg-purple-500 rounded-full p-2 md:p-3 transition group"
            >
              <ChevronRight className="w-5 h-5 md:w-6 md:h-6 group-hover:translate-x-1 transition" />
            </button>

            {/* Slide indicators */}
            <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 flex gap-2 z-10">
              {slides.map((_, index) => (
                <button
                  key={index}
                  onClick={() => setCurrentSlide(index)}
                  className={`h-2 rounded-full transition ${
                    index === currentSlide
                      ? 'bg-purple-500 w-8'
                      : 'bg-purple-500/40 w-2 hover:bg-purple-500/60'
                  }`}
                />
              ))}
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
                  />
                </div>
                <p className="font-medium text-xs md:text-sm text-center whitespace-nowrap text-purple-200 opacity-0 group-hover:opacity-100 group-[.bg-purple-500/30]:opacity-100 transition-opacity duration-200 h-4 md:h-5">{slide.title}</p>
              </button>
            ))}
          </div>

          {/* Call-to-Action Buttons and Stats Section */}
          <div className="mt-12 md:mt-16 space-y-8 text-center">
            {/* Buttons */}
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <button
                onClick={onGetStarted}
                className="group bg-gradient-to-r from-purple-500 to-pink-500 px-8 py-4 rounded-lg font-bold text-lg flex items-center justify-center space-x-2 hover:shadow-lg hover:shadow-purple-500/50 transition transform hover:scale-105"
              >
                <span>Start Your Journey</span>
                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition" />
              </button>
              <button className="border-2 border-purple-400 px-8 py-4 rounded-lg font-bold text-lg hover:bg-purple-500/10 transition">
                Learn More
              </button>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-4 pt-8 border-t border-purple-500/20">
              <div className="text-center">
                <p className="text-3xl md:text-4xl font-bold text-purple-400">10K+</p>
                <p className="text-gray-400 text-sm md:text-base">Active Users</p>
              </div>
              <div className="text-center">
                <p className="text-3xl md:text-4xl font-bold text-pink-400">$50M+</p>
                <p className="text-gray-400 text-sm md:text-base">Volume Managed</p>
              </div>
              <div className="text-center">
                <p className="text-3xl md:text-4xl font-bold text-blue-400">99.9%</p>
                <p className="text-gray-400 text-sm md:text-base">Uptime</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Testimonials Section */}
      <section id="testimonials" className="relative py-16 md:py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12 md:mb-16">
            <h2 className="text-2xl md:text-4xl lg:text-5xl font-bold mb-3 md:mb-4 leading-tight">
              <span className="bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
                What Users Say
              </span>
            </h2>
            <p className="text-gray-400 text-sm md:text-base lg:text-lg">Join thousands of satisfied users</p>
          </div>

          <div className="grid md:grid-cols-3 gap-4 md:gap-6">
            {testimonials.map((testimonial, index) => (
              <div
                key={index}
                className="bg-gradient-to-br from-purple-900/20 to-blue-900/20 border border-purple-500/20 rounded-xl p-4 md:p-6 lg:p-8 hover:border-purple-500/50 transition"
              >
                <div className="flex items-center mb-4">
                  <span className="text-3xl md:text-4xl mr-3">{testimonial.avatar}</span>
                  <div>
                    <p className="font-bold text-sm md:text-base">{testimonial.name}</p>
                    <p className="text-xs md:text-sm text-purple-400">{testimonial.role}</p>
                  </div>
                </div>
                <p className="text-gray-300 italic text-xs md:text-sm lg:text-base leading-relaxed">"{testimonial.text}"</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="relative py-16 md:py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto">
          <div className="bg-gradient-to-r from-purple-900/40 via-pink-900/40 to-blue-900/40 border border-purple-500/30 rounded-2xl p-6 md:p-12 lg:p-16 text-center">
            <h2 className="text-2xl md:text-4xl lg:text-5xl font-bold mb-4 md:mb-6 leading-tight">
              Ready to Transform Your Capital?
            </h2>
            <p className="text-sm md:text-base lg:text-xl text-gray-300 mb-6 md:mb-8 leading-relaxed">
              Join the revolution and take control of your financial future today.
            </p>
            <button
              onClick={onGetStarted}
              className="group bg-gradient-to-r from-purple-500 to-pink-500 px-6 md:px-10 py-3 md:py-4 rounded-lg font-bold text-sm md:text-base lg:text-lg inline-flex items-center space-x-2 hover:shadow-lg hover:shadow-purple-500/50 transition transform hover:scale-105"
            >
              <span>Get Started Now</span>
              <ArrowRight className="w-4 h-4 md:w-5 md:h-5 group-hover:translate-x-1 transition" />
            </button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative border-t border-purple-500/10 py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="grid md:grid-cols-4 gap-8 mb-8">
            <div>
              <h3 className="text-xl font-bold text-purple-400 mb-4">ICAN</h3>
              <p className="text-gray-400 text-sm">Transform Volatility to Global Capital</p>
            </div>
            <div>
              <h4 className="font-bold mb-4">Product</h4>
              <ul className="space-y-2 text-gray-400 text-sm">
                <li><a href="#" className="hover:text-purple-400 transition">Features</a></li>
                <li><a href="#" className="hover:text-purple-400 transition">Pricing</a></li>
                <li><a href="#" className="hover:text-purple-400 transition">Security</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-bold mb-4">Company</h4>
              <ul className="space-y-2 text-gray-400 text-sm">
                <li><a href="#" className="hover:text-purple-400 transition">About</a></li>
                <li><a href="#" className="hover:text-purple-400 transition">Blog</a></li>
                <li><a href="#" className="hover:text-purple-400 transition">Careers</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-bold mb-4">Legal</h4>
              <ul className="space-y-2 text-gray-400 text-sm">
                <li><a href="#" className="hover:text-purple-400 transition">Privacy</a></li>
                <li><a href="#" className="hover:text-purple-400 transition">Terms</a></li>
                <li><a href="#" className="hover:text-purple-400 transition">Contact</a></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-purple-500/10 pt-8 flex flex-col md:flex-row justify-between items-center text-gray-400 text-sm">
            <p>&copy; 2024 ICAN Capital Engine. All rights reserved.</p>
            <div className="flex space-x-6 mt-4 md:mt-0">
              <a href="#" className="hover:text-purple-400 transition">Twitter</a>
              <a href="#" className="hover:text-purple-400 transition">LinkedIn</a>
              <a href="#" className="hover:text-purple-400 transition">Discord</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;
