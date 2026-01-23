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
      title: 'Digital Wallet',
      description: 'Manage your accounts, balances & transactions with secure digital wallet management',
      features: ['Account management', 'Balance tracking', 'Secure transactions']
    },
    {
      image: '/images/incaera%20share.png',
      title: 'Pitchin',
      description: 'Share your vision, connect with investors and build your business dreams',
      features: ['Business pitches', 'Investor connections', 'Growth opportunities']
    },
    {
      image: '/images/dairy%20expense%20and%20inacome.png',
      title: 'Investment Portfolio',
      description: 'Performance Analytics to track and optimize your investment returns',
      features: ['Performance tracking', 'Analytics insights', 'Portfolio optimization']
    },
    {
      image: '/images/cmms.png',
      title: 'Treasury Guardian',
      description: 'Account security & privacy controls with enterprise-level protection',
      features: ['Security controls', 'Privacy protection', 'Account verification']
    },
    {
      image: '/images/sacco.png',
      title: 'Trust Management',
      description: 'Collaborate, contribute, and grow wealth together in SACCO groups',
      features: ['Group collaboration', 'Wealth growth', 'Community benefits']
    },
    {
      image: '/images/trust.png',
      title: 'ICAN Opportunity Rating',
      description: 'Your readiness for global opportunities with comprehensive assessment',
      features: ['Opportunity assessment', 'Readiness evaluation', 'Global access']
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
      <div className="relative pt-16 md:pt-20 pb-12 md:pb-16 px-4 sm:px-6 lg:px-8 overflow-visible">
        {/* Decorative elements */}
        <div className="absolute top-10 left-5 w-32 h-32 bg-purple-500/5 rounded-full blur-3xl"></div>
        <div className="absolute bottom-10 right-10 w-40 h-40 bg-pink-500/5 rounded-full blur-3xl"></div>
        
        <div className="max-w-7xl mx-auto grid md:grid-cols-2 gap-6 md:gap-8 lg:gap-12 items-center relative">
          {/* Left Content - Collapsed to Icon */}
          <div className="flex items-center justify-center md:justify-start animate-fadeInUp relative z-40 w-full md:w-auto">
            <div className="w-full md:w-auto">
              {/* Full Info Container - Always Visible */}
              <div className="bg-gradient-to-br from-slate-900/95 to-slate-950/95 border border-purple-500/40 rounded-2xl p-6 md:p-8 space-y-5 shadow-2xl shadow-purple-500/30 backdrop-blur-xl w-full md:w-full lg:max-w-2xl">
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

          {/* Right - Feature Image Showcase */}
          <div className="relative animate-fadeInDown hidden md:flex items-center justify-center h-full min-h-96 z-0">
            <div className="relative w-full max-w-lg">
              {/* Glow background */}
              <div className="absolute inset-0 bg-gradient-to-br from-purple-500/20 to-pink-500/20 rounded-3xl blur-3xl"></div>
              
              {/* Image container */}
              <div className="relative bg-gradient-to-br from-purple-900/40 to-blue-900/40 border border-purple-500/30 rounded-3xl p-8 backdrop-blur-xl shadow-2xl shadow-purple-500/30 overflow-hidden">
                {/* Animated border gradient */}
                <div className="absolute inset-0 bg-gradient-to-r from-purple-500/0 via-purple-500/20 to-pink-500/0 rounded-3xl animate-pulse"></div>
                
                {/* Content */}
                <div className="relative space-y-6">
                  {/* Image */}
                  <img 
                    src="/images/dairy%20expense%20and%20inacome.png" 
                    alt="Expense & Income Tracker"
                    className="w-full h-80 object-cover rounded-2xl shadow-lg"
                  />
                  
                  {/* Label */}
                  <div className="text-center space-y-2">
                    <h3 className="text-xl font-bold text-purple-300">Expense & Income Tracker</h3>
                    <p className="text-sm text-gray-400">Smart financial management at your fingertips</p>
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
          <div className="text-center mb-12 md:mb-16">
            <h2 className="text-2xl md:text-4xl lg:text-5xl font-bold mb-3 md:mb-4 leading-tight">
              <span className="bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
                Complete Financial Solutions
              </span>
            </h2>
            <p className="text-gray-400 text-sm md:text-base max-w-2xl mx-auto">
              ICAN's comprehensive suite of integrated platforms designed to empower your financial journey—from opportunity discovery to wealth management and beyond
            </p>
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
              <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-transparent to-transparent flex flex-col justify-end p-4 md:p-6 lg:p-8">
                <div className="space-y-2 md:space-y-3 animate-fadeIn">
                  <div>
                    <h3 className="text-lg md:text-2xl lg:text-3xl font-bold mb-1">{slides[currentSlide].title}</h3>
                    <p className="text-xs md:text-sm lg:text-base text-gray-300 line-clamp-2">{slides[currentSlide].description}</p>
                  </div>
                  <div className="flex flex-wrap gap-1 md:gap-2">
                    {slides[currentSlide].features.map((feature, idx) => (
                      <span key={idx} className="px-2 py-0.5 md:px-3 md:py-1 bg-purple-500/30 border border-purple-500/50 rounded-full text-xs text-purple-200">
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

      {/* Testimonials Section */}
      <section id="testimonials" className="relative py-6 md:py-12 lg:py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-4 md:mb-8 lg:mb-16">
            <h2 className="text-lg md:text-3xl lg:text-5xl font-bold mb-1 md:mb-2 lg:mb-4 leading-tight">
              <span className="bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
                What Users Say
              </span>
            </h2>
            <p className="text-gray-400 text-xs md:text-sm lg:text-lg">Join thousands of satisfied users</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 md:gap-3 lg:gap-6">
            {testimonials.map((testimonial, index) => (
              <div
                key={index}
                className="bg-gradient-to-br from-purple-900/20 to-blue-900/20 border border-purple-500/20 rounded-lg p-3 md:p-4 lg:p-6 hover:border-purple-500/50 transition"
              >
                <div className="flex items-center mb-3">
                  <span className="text-2xl md:text-3xl mr-2">{testimonial.avatar}</span>
                  <div>
                    <p className="font-bold text-xs md:text-sm">{testimonial.name}</p>
                    <p className="text-xs text-purple-400">{testimonial.role}</p>
                  </div>
                </div>
                <p className="text-gray-300 italic text-xs md:text-sm leading-relaxed">"{testimonial.text}"</p>
              </div>
            ))}
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
              <h3 className="text-lg md:text-xl font-bold text-purple-400 mb-2 md:mb-4">ICAN</h3>
              <p className="text-gray-400 text-xs md:text-sm">Transform Volatility to Global Capital</p>
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
            <p>&copy; 2024 ICAN Capital Engine. All rights reserved.</p>
            <div className="flex space-x-4 md:space-x-6">
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
