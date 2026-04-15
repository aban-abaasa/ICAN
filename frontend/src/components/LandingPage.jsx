import React, { useState, useEffect } from 'react';
import { ChevronRight, Play, Zap, Shield, TrendingUp, Users, ArrowRight, ChevronDown } from 'lucide-react';
import DashboardPreview from './DashboardPreview';
import ThemeSwitcher from './ThemeSwitcher';
import { useTheme } from '../context/ThemeContext';

const LandingPage = ({ onGetStarted }) => {
  const { actualTheme } = useTheme();
  const isDarkTheme = actualTheme === 'dark';
  const [currentSlide, setCurrentSlide] = useState(0);
  const [currentHeroSlide, setCurrentHeroSlide] = useState(0);
  const [currentBadgeInfo, setCurrentBadgeInfo] = useState(0);
  const [currentTestimonial, setCurrentTestimonial] = useState(0);
  const [scrollPosition, setScrollPosition] = useState(0);
  const [isHeroExpanded, setIsHeroExpanded] = useState(false);
  const [expandedFooterSection, setExpandedFooterSection] = useState(null);
  const [expandedFooterItem, setExpandedFooterItem] = useState(null);
  const [failedMainSlideImages, setFailedMainSlideImages] = useState({});

  const scrollToSection = (sectionId) => {
    const section = document.getElementById(sectionId);
    if (section) {
      section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const handleSignIn = () => {
    onGetStarted?.('signin');
  };

  const handleCreateAccount = () => {
    onGetStarted?.('signup');
  };

  // Handle email click
  const handleEmailClick = (e) => {
    e.preventDefault();
    // Open Gmail compose page with pre-filled recipient
    window.open('https://mail.google.com/mail/?view=cm&fs=1&to=icaneraera@gmail.com', '_blank');
  };

  // Footer section data with nested dropdown content
  const footerSections = {
    about: {
      title: 'About ICANera',
      content: 'ICANera is a revolutionary financial ecosystem designed to transform volatility into global capital. We empower individuals and communities to build generational wealth through democratic savings groups, secure transactions, and innovative financial tools. Our mission is to provide accessible, transparent, and transformative financial solutions.',
      description: 'Learn more about our mission'
    },
    blog: {
      title: 'Blog & Resources',
      content: 'Discover latest insights on financial growth, investment strategies, SACCO management, and wealth building. Our blog features expert tips, success stories, and practical guides to help you maximize your financial potential on ICANera.',
      links: [
        { title: 'Building Wealth Through Community', content: 'Learn how democratic savings groups empower communities to build generational wealth together. Discover strategies for managing group finances, building trust, and maximizing collective growth potential.' },
        { title: 'Digital Wallet Security Guide', content: 'Master the security features of your ICANera wallet. Understand encryption, two-factor authentication, PIN management, and best practices to keep your funds protected at all times.' },
        { title: 'Investment Tips for Beginners', content: 'Start your investment journey with confidence. Learn fundamental investment principles, risk management, portfolio diversification, and how to grow your wealth through smart financial decisions.' },
        { title: 'SACCO Group Best Practices', content: 'Optimize your SACCO group operations with proven strategies. From member recruitment to fund management, transparency protocols, and conflict resolution—everything you need for group success.' }
      ],
      description: 'Read our latest articles'
    },
    careers: {
      title: 'Careers at ICANera',
      content: 'Join our growing team and be part of the financial revolution. We\'re seeking passionate individuals across engineering, product, design, and business development to help transform how people manage their wealth.',
      links: [
        { title: 'Engineering Opportunities', content: 'Help us build the future of fintech. We\'re looking for backend engineers, frontend developers, mobile engineers, and DevOps specialists who are passionate about creating transformative financial technology.' },
        { title: 'Product & Design Roles', content: 'Shape the user experience that millions depend on. Join our product and design teams to build intuitive interfaces, define product strategy, and create delightful user experiences.' },
        { title: 'Sales & Business Development', content: 'Drive growth and expand our market reach. We need visionary sales professionals and business development experts to partner with enterprises and grow our ecosystem.' },
        { title: 'Customer Support Team', content: 'Be the voice of ICANera. Help our users succeed with exceptional support, relationship building, and community engagement across all channels.' }
      ],
      description: 'View open positions'
    },
    privacy: {
      title: 'Privacy Policy',
      content: 'At ICANera, your data privacy and security is paramount. We employ industry-leading encryption, transparent data practices, and strict compliance with global privacy regulations to protect your personal and financial information.',
      links: [
        { title: 'Data Protection Standards', content: 'We employ military-grade encryption (AES-256) for all data at rest and TLS 1.2+ for data in transit. Our infrastructure is compliant with ISO 27001 and regularly audited by third-party security firms.' },
        { title: 'User Privacy Rights', content: 'You have the right to access, modify, or delete your personal data at any time. We never sell or share your data with third parties without explicit consent. Your financial information remains exclusively yours.' },
        { title: 'Cookie Policy', content: 'We use essential cookies to provide secure authentication and functional cookies to improve user experience. You can manage cookie preferences in your account settings. No tracking cookies are used without consent.' },
        { title: 'GDPR Compliance', content: 'ICANera fully complies with GDPR regulations for European users. We have established Data Processing Agreements with all partners and ensure your right to be forgotten is respected.' }
      ],
      description: 'Your privacy matters to us'
    },
    terms: {
      title: 'Terms of Service',
      content: 'Our comprehensive terms of service outline the rights and responsibilities of users interacting with the ICANera platform. By using ICANera, you agree to our terms and commit to responsible financial engagement.',
      links: [
        { title: 'User Responsibilities', content: 'Users must provide accurate information, protect their credentials, comply with applicable laws, and use the platform responsibly. You are responsible for all activities under your account and must notify us of unauthorized access immediately.' },
        { title: 'Platform Limitations', content: 'ICANera provides the platform "as is" without warranties. We are not liable for third-party services, user content, or losses from unauthorized access. Service interruptions may occur for maintenance, security, or regulatory compliance.' },
        { title: 'Dispute Resolution', content: 'We encourage users to contact our support team first. Unresolved disputes will be handled through binding arbitration rather than court proceedings. Both parties agree to good-faith negotiation before pursuing legal action.' },
        { title: 'Intellectual Property', content: 'All ICANera content, code, and brand elements are protected intellectual property. Users receive a personal, non-exclusive license to use the platform. Unauthorized reproduction, modification, or distribution is prohibited.' }
      ],
      description: 'Terms apply to all users'
    }
  };

  // Image slides with descriptions - IMPROVED with real, authentic messaging
  const slides = [
    {
      image: '/images/dairy expense and inacome.png',
      title: 'Record Every Transaction',
      subtitle: 'Voice & Manual Entry',
      description: 'Record transactions effortlessly by speaking or typing. Smart categorization captures every shilling for complete financial clarity.',
      whyJoin: 'Take control of every transaction—voice or manual, your choice',
      features: ['Voice recording', 'Smart categorization', 'Real-time updates', 'Expense insights', 'Income tracking'],
      highlight: true,
      realMessage: 'Easy transaction logging - the busier you are, the faster you capture'
    },
    {
      image: '/images/ICANera expense.png',
      title: 'Your Financial Picture',
      subtitle: 'Dashboard & Analytics',
      description: 'See your complete financial overview at a glance. Real-time analytics show income, expenses, profit, and growth trends.',
      whyJoin: 'Know exactly where your money is and where it\'s going',
      features: ['Real-time overview', 'Income tracking', 'Expense analysis', 'Profit calculation', 'Growth trends'],
      realMessage: 'One dashboard to rule them all - personal, business, and investments'
    },
    {
      image: '/images/icanera wallet.png',
      title: 'Personal Finances Separated',
      subtitle: 'Wallet Management',
      description: 'Keep personal and business money completely separate. Multi-wallet system gives you clarity and control.',
      whyJoin: 'Personal savings vs. business profits - crystal clear',
      features: ['Multi-wallet system', 'Account separation', 'Balance tracking', 'Quick transfers', 'Secure holdings'],
      realMessage: 'Never mix personal spending with business again'
    },
    {
      image: '/images/ICANwallet.png',
      title: 'Move Money Instantly',
      subtitle: 'Global Transfers',
      description: 'Send money across borders in seconds using ICAN coins. Zero fees, blockchain-backed, completely transparent.',
      whyJoin: 'Send to Kenya, Uganda, Tanzania instantly - no bank delays',
      features: ['Instant transfers', 'Zero fees', 'Blockchain secured', 'Multi-currency', 'No delays'],
      realMessage: 'International transfers that actually work like we promised'
    },
    {
      image: '/images/incaera share.png',
      title: 'Share Your Vision',
      subtitle: 'PitchIn - Crowdfunding',
      description: 'Raise capital from your community. Investors see your pitch, funds arrive, your business grows. Democracy in action.',
      whyJoin: 'Your idea + community support = unstoppable growth',
      features: ['Business pitches', 'Investor matching', 'Smart contracts', 'Dividend sharing', 'Growth support'],
      realMessage: 'Stop begging banks - let your community fund your dreams'
    },
    {
      image: '/images/ICANera pitchin.png',
      title: 'Invest In Businesses You Believe In',
      subtitle: 'PitchIn - Investor View',
      description: 'Own a piece of promising businesses. See real returns through dividends. Your money works for you.',
      whyJoin: 'Build wealth by backing businesses you trust',
      features: ['Browse pitches', 'Evaluate returns', 'Own shares', 'Earn dividends', 'Smart contracts'],
      realMessage: 'Become an investor - own real businesses, earn real returns'
    },
    {
      image: '/images/ICANera pitchin 8.png',
      title: 'AI Finds Perfect Matches',
      subtitle: 'Smart Investment Matching',
      description: 'AI analyzes every pitch and matches you with businesses aligned to your financial goals and values.',
      whyJoin: 'Let AI find the best opportunities for your portfolio',
      features: ['AI matching', 'Risk analysis', 'Return projections', 'Portfolio diversity', 'Smart recommendations'],
      realMessage: 'Technology + community = better investment decisions'
    },
    {
      image: '/images/cmms.png',
      title: 'Run Your Business Smoothly',
      subtitle: 'Inventory & Operations',
      description: 'Manage inventory, approvals, and team workflows. No spreadsheets, no confusion - just organized operations.',
      whyJoin: 'Scale from chaos to organized operations',
      features: ['Inventory tracking', 'Team approvals', 'Supply management', 'Workflow automation', 'Real-time updates'],
      realMessage: 'From losing track to complete control of your operations'
    },
    {
      image: '/images/ICANera CMMS.png',
      title: 'Manage Teams & Approvals',
      subtitle: 'Department Workflows',
      description: 'Set up roles, permissions, and approval chains. Everyone knows what they\'re doing and why.',
      whyJoin: 'Scale with confidence - organized teams, clear workflows',
      features: ['Role-based access', 'Approval flows', 'Team management', 'Audit trails', 'Department control'],
      realMessage: 'Professional operations management built for growth'
    },
    {
      image: '/images/ICANera CMMS1.png',
      title: 'Enterprise-Grade Operations',
      subtitle: 'Advanced CMMS',
      description: 'Advanced features for serious operations. Analytics, automation, and integration for your complex needs.',
      whyJoin: 'Professional tools for professional operations',
      features: ['Advanced analytics', 'Automation', 'Deep integration', 'Custom workflows', 'Priority support'],
      realMessage: 'Enterprise power, built for ambitious operators'
    },
    {
      image: '/images/sacco.png',
      title: 'Save Together, Grow Faster',
      subtitle: 'TRUST Groups',
      description: 'Join a democratic savings group. Contribute monthly, earn interest, help each other grow. Interest from the community, not banks.',
      whyJoin: '8-15% returns vs. 0% from banks - change your life',
      features: ['Democratic savings', 'Group returns', 'Member loans', 'Shared ownership', 'Transparent management'],
      realMessage: 'Community savings that actually build wealth'
    },
    {
      image: '/images/ICAN era sacco.png',
      title: 'Groups That Work',
      subtitle: 'TRUST Management',
      description: 'Professional SACCO management meets community trust. Transparent fund tracking, voting, and automated distributions.',
      whyJoin: 'Stop managing groups with phones and notebooks',
      features: ['Transparent ledger', 'Democratic voting', 'Auto-distributions', 'Analytics', 'Member management'],
      realMessage: 'Digital SACCO management that respects community values'
    },
    {
      image: '/images/trust.png',
      title: 'Know Your Wealth Potential',
      subtitle: 'Opportunity Rating',
      description: 'Get your ICAN Opportunity Rating - a score showing your readiness for global opportunities and investment.',
      whyJoin: 'Understand your true financial potential',
      features: ['Financial assessment', 'Opportunity unlocking', 'Growth recommendations', 'Global readiness', 'Custom guidance'],
      realMessage: 'Your path to global financial opportunities starts here'
    },
    {
      image: '/images/ICANera trust.png',
      title: 'Trust Backed By Blockchain',
      subtitle: 'Verified Transactions',
      description: 'Every transaction blockchain-verified. No fraud, no disputes, no hidden fees. Complete transparency.',
      whyJoin: 'Trust with proof - blockchain never lies',
      features: ['Blockchain verified', 'Immutable records', 'Zero disputes', 'Transparent fees', 'Proof of ownership'],
      realMessage: 'Technology that proves trust, not just promises it'
    },
    {
      image: '/images/ICANera trust 2.png',
      title: 'Smart Contracts Automate Trust',
      subtitle: 'Advanced Trust System',
      description: 'Smart contracts enforce agreements automatically. No waiting, no lawyers, no middlemen taking their cut.',
      whyJoin: 'Agreements that execute themselves, fairly and automatically',
      features: ['Smart contracts', 'Auto-execution', 'No middleman', 'Lower costs', 'Instant settlement'],
      realMessage: 'Contracts that enforce themselves - welcome to the future'
    },
    {
      image: new URL('../IcanEra.png', import.meta.url).href,
      title: 'Everything You Need In One Place',
      subtitle: 'Complete Ecosystem',
      description: 'Wallets, investments, TRUST groups, business management, global transfers - all integrated seamlessly.',
      whyJoin: 'Stop juggling apps - your entire financial life, one platform',
      features: ['All features included', 'Beautiful integration', 'Single login', 'Unified dashboard', 'Complete control'],
      realMessage: 'The platform that thinks like you - holistic financial control'
    },
    {
      image: '/images/ICANera 3.png',
      title: 'Unlock Premium Features',
      subtitle: 'ICAN Premium',
      description: 'Premium features for power users - advanced analytics, priority support, exclusive opportunities.',
      whyJoin: 'Level up your financial game with elite features',
      features: ['Advanced analytics', 'Priority support', 'Exclusive deals', 'Higher limits', 'VIP access'],
      realMessage: 'Premium tools for financial champions'
    },
    {
      image: '/images/ICANera tithe.png',
      title: 'Align Faith With Finances',
      subtitle: 'Tithe Management',
      description: 'Give back meaningfully with automatic tithe calculations and community impact tracking. Your giving, your values, your impact.',
      whyJoin: 'Support your faith community with confidence and clarity',
      features: ['Auto tithe calc', 'Community impact', 'Giving history', 'Faith tracking', 'Donation receipts'],
      highlight: true,
      realMessage: 'Spiritual giving made simple and transparent'
    },
    {
      image: '/images/ICANera tith2.png',
      title: 'Generous Giving, Real Impact',
      subtitle: 'Tithe Pro',
      description: 'Advanced giving tools for offerings, donations, and community support. See the impact of your generosity.',
      whyJoin: 'Give with purpose - see how your giving changes lives',
      features: ['Multiple giving types', 'Impact reports', 'Community feedback', 'Giving analytics', 'Charitable records'],
      realMessage: 'Your generosity, amplified and tracked'
    },
    {
      image: '/images/ICANera i.png',
      title: 'Built On Solid Foundation',
      subtitle: 'ICAN Core Technology',
      description: 'The foundation powering all ICAN features. Secure, scalable, designed for billions of transactions.',
      whyJoin: 'Trust the bedrock of modern financial technology',
      features: ['Secure infrastructure', 'Blockchain foundation', 'Scalability', 'Integration hub', 'Future-proof'],
      realMessage: 'Technology that scales with your ambitions'
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
      title: 'PitchIn',
      subtitle: 'Investment hub',
      description: 'Share your vision'
    },
    {
      image: '/images/ICANera pitchin.png',
      title: 'PitchIn Pro',
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

  const badgeCardThemes = [
    {
      glow: 'from-violet-500/35 via-fuchsia-500/25 to-purple-500/35',
      card: 'from-violet-950/95 via-violet-900/95 to-fuchsia-950/95',
      border: 'border-violet-300/70',
      pulse: 'from-violet-400/0 via-violet-300/25 to-fuchsia-300/0',
      title: 'text-violet-100',
      desc: 'text-violet-100/95',
      indicatorActive: 'bg-violet-300',
      indicatorInactive: 'bg-violet-400/35 hover:bg-violet-300/70'
    },
    {
      glow: 'from-cyan-500/35 via-sky-500/25 to-blue-500/35',
      card: 'from-cyan-950/95 via-sky-900/95 to-blue-950/95',
      border: 'border-cyan-300/70',
      pulse: 'from-cyan-400/0 via-cyan-300/25 to-blue-300/0',
      title: 'text-cyan-100',
      desc: 'text-cyan-100/95',
      indicatorActive: 'bg-cyan-300',
      indicatorInactive: 'bg-cyan-400/35 hover:bg-cyan-300/70'
    },
    {
      glow: 'from-emerald-500/35 via-teal-500/25 to-green-500/35',
      card: 'from-emerald-950/95 via-teal-900/95 to-green-950/95',
      border: 'border-emerald-300/70',
      pulse: 'from-emerald-400/0 via-emerald-300/25 to-green-300/0',
      title: 'text-emerald-100',
      desc: 'text-emerald-100/95',
      indicatorActive: 'bg-emerald-300',
      indicatorInactive: 'bg-emerald-400/35 hover:bg-emerald-300/70'
    },
    {
      glow: 'from-amber-500/35 via-orange-500/25 to-yellow-500/35',
      card: 'from-amber-950/95 via-orange-900/95 to-yellow-950/95',
      border: 'border-amber-300/70',
      pulse: 'from-amber-400/0 via-amber-300/25 to-yellow-300/0',
      title: 'text-amber-100',
      desc: 'text-amber-100/95',
      indicatorActive: 'bg-amber-300',
      indicatorInactive: 'bg-amber-400/35 hover:bg-amber-300/70'
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

  const activeBadgeTheme = badgeCardThemes[currentBadgeInfo % badgeCardThemes.length];
  const badgeWordPalette = [
    { title: '#b91c1c', desc: '#dc2626' },
    { title: '#065f46', desc: '#047857' },
    { title: '#1d4ed8', desc: '#2563eb' },
    { title: '#6d28d9', desc: '#7c3aed' },
    { title: '#9a3412', desc: '#c2410c' }
  ];
  const activeBadgeWordPalette = badgeWordPalette[currentBadgeInfo % badgeWordPalette.length];
  const slideWordPalette = [
    { subtitle: '#7c2d12', title: '#7f1d1d', body: '#991b1b', feature: '#b91c1c' },
    { subtitle: '#14532d', title: '#166534', body: '#15803d', feature: '#16a34a' },
    { subtitle: '#1e3a8a', title: '#1d4ed8', body: '#2563eb', feature: '#3b82f6' },
    { subtitle: '#581c87', title: '#6d28d9', body: '#7c3aed', feature: '#8b5cf6' },
    { subtitle: '#78350f', title: '#a16207', body: '#ca8a04', feature: '#f59e0b' }
  ];
  const activeSlideWordPalette = slideWordPalette[currentSlide % slideWordPalette.length];

  const rainbowTextStyle = {
    backgroundImage: 'linear-gradient(90deg, #ef4444, #f59e0b, #eab308, #22c55e, #06b6d4, #3b82f6, #8b5cf6, #ec4899, #ef4444)',
    backgroundSize: '300% 300%',
    WebkitBackgroundClip: 'text',
    backgroundClip: 'text',
    color: 'transparent',
    animation: 'icanRainbowShift 8s linear infinite'
  };

  return (
    <div className={`min-h-screen overflow-hidden ${
      isDarkTheme
        ? 'bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-slate-100'
        : 'bg-gradient-to-br from-slate-100 via-slate-50 to-slate-100 text-slate-900'
    }`}>
      <style>{`
        @keyframes icanRainbowShift {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
        @keyframes icanRainbowFloat {
          0% { transform: translateY(0px); opacity: 0.18; }
          50% { transform: translateY(-12px); opacity: 0.3; }
          100% { transform: translateY(0px); opacity: 0.18; }
        }
        .ican-rainbow-text {
          background-image: linear-gradient(90deg, #ef4444, #f59e0b, #eab308, #22c55e, #06b6d4, #3b82f6, #8b5cf6, #ec4899, #ef4444);
          background-size: 300% 300%;
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
          animation: icanRainbowShift 8s linear infinite;
        }
        .ican-rainbow-fill {
          background-image: linear-gradient(90deg, #7c3aed, #ec4899, #ef4444, #f59e0b, #eab308, #22c55e, #06b6d4, #3b82f6, #7c3aed);
          background-size: 300% 300%;
          animation: icanRainbowShift 6s linear infinite;
        }
        .ican-rainbow-border {
          border-color: transparent !important;
          border-image: linear-gradient(90deg, #7c3aed, #ec4899, #ef4444, #f59e0b, #eab308, #22c55e, #06b6d4, #3b82f6, #7c3aed) 1;
          animation: icanRainbowShift 7s linear infinite;
        }
      `}</style>
      {/* Animated background elements */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute inset-0 opacity-20" style={{ backgroundImage: 'linear-gradient(110deg, rgba(124,58,237,0.18), rgba(236,72,153,0.14), rgba(234,179,8,0.12), rgba(34,197,94,0.12), rgba(59,130,246,0.14), rgba(124,58,237,0.18))', backgroundSize: '260% 260%', animation: 'icanRainbowShift 22s linear infinite' }}></div>
        <div className={`absolute top-0 left-1/4 w-96 h-96 rounded-full blur-3xl animate-blob ${isDarkTheme ? 'bg-slate-700/20' : 'bg-slate-400/15'}`}></div>
        <div className={`absolute bottom-0 right-1/4 w-96 h-96 rounded-full blur-3xl animate-blob animation-delay-2000 ${isDarkTheme ? 'bg-blue-900/20' : 'bg-blue-300/15'}`}></div>
        <div className={`absolute top-1/2 right-1/3 w-96 h-96 rounded-full blur-3xl animate-blob animation-delay-4000 ${isDarkTheme ? 'bg-slate-800/20' : 'bg-slate-300/10'}`}></div>
        <div className="absolute top-24 right-20 w-72 h-72 rounded-full blur-3xl" style={{ backgroundImage: 'linear-gradient(90deg, rgba(236,72,153,0.25), rgba(59,130,246,0.25), rgba(234,179,8,0.2))', animation: 'icanRainbowFloat 10s ease-in-out infinite' }}></div>
      </div>

      {/* Navigation */}
      <nav className={`fixed top-0 w-full z-50 backdrop-blur-md border-b ${isDarkTheme ? 'bg-slate-950/70 border-slate-700/40' : 'bg-white/70 border-slate-300/70'}`}>
        <div className="max-w-7xl 2xl:max-w-[1600px] 3xl:max-w-[1800px] mx-auto px-4 sm:px-6 lg:px-8 2xl:px-12 py-4 2xl:py-5 flex justify-between items-center">
          <div className="flex items-center space-x-3">
            <div
              className="text-3xl md:text-4xl 2xl:text-5xl font-black tracking-tight"
              style={{
                color: 'var(--color-secondary)',
                textShadow: isDarkTheme ? '0 0 14px rgba(129, 140, 248, 0.35)' : '0 1px 0 rgba(255,255,255,0.5)'
              }}
            >
              IcanEra
            </div>
            <div className="hidden sm:flex flex-col">
              <p className="text-xs md:text-sm 2xl:text-base font-semibold" style={{ color: isDarkTheme ? '#cbd5e1' : '#334155' }}>Financial Ecosystem</p>
              <p className="text-xs 2xl:text-sm" style={{ color: isDarkTheme ? '#93c5fd' : '#1d4ed8' }}>Wealth Platform</p>
            </div>
          </div>
          <div className="hidden md:flex items-center gap-3 2xl:gap-4">
            <button
              onClick={() => scrollToSection('platforms')}
              className={`px-4 py-2 ican-cove-tab border-2 text-sm md:text-base 2xl:text-lg font-bold transition-all duration-300 ${isDarkTheme ? 'text-amber-100 border-amber-300/55 bg-amber-900/25 hover:bg-amber-800/35 hover:border-amber-200/80' : 'text-amber-900 border-amber-400/55 bg-amber-100 hover:bg-amber-200/90 hover:border-amber-500/75'}`}
            >
              Features
            </button>
            <button
              onClick={() => scrollToSection('platforms')}
              className={`px-4 py-2 ican-cove-tab border-2 text-sm md:text-base 2xl:text-lg font-bold transition-all duration-300 ${isDarkTheme ? 'text-cyan-100 border-cyan-300/55 bg-cyan-900/25 hover:bg-cyan-800/35 hover:border-cyan-200/80' : 'text-cyan-900 border-cyan-400/55 bg-cyan-100 hover:bg-cyan-200/90 hover:border-cyan-500/75'}`}
            >
              Platforms
            </button>
            <button
              onClick={() => scrollToSection('testimonials')}
              className={`px-4 py-2 ican-cove-tab border-2 text-sm md:text-base 2xl:text-lg font-bold transition-all duration-300 ${isDarkTheme ? 'text-rose-100 border-rose-300/55 bg-rose-900/25 hover:bg-rose-800/35 hover:border-rose-200/80' : 'text-rose-900 border-rose-400/55 bg-rose-100 hover:bg-rose-200/90 hover:border-rose-500/75'}`}
            >
              Testimonials
            </button>
          </div>
          <div className="flex items-center gap-2 md:gap-3">
            <ThemeSwitcher />
            <button
              onClick={handleSignIn}
              className="px-3 md:px-5 py-2 rounded-full border-2 ican-rainbow-border bg-purple-900/25 hover:bg-purple-800/40 text-white font-bold transition-all duration-300 text-xs md:text-sm 2xl:text-base"
            >
              Sign In
            </button>
            <button
              onClick={handleCreateAccount}
              className="ican-rainbow-fill border-2 ican-rainbow-border px-3 md:px-5 py-2 rounded-full font-extrabold hover:shadow-2xl hover:shadow-purple-500/55 transition-all duration-300 transform hover:scale-[1.04] text-white text-xs md:text-sm 2xl:text-base"
            >
              Create Account
            </button>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <div className="relative pt-16 md:pt-20 2xl:pt-28 pb-12 md:pb-16 2xl:pb-24 px-4 sm:px-6 lg:px-8 2xl:px-16 overflow-visible">
        {/* Decorative elements */}
        <div className="absolute top-10 left-5 w-32 h-32 bg-slate-500/10 rounded-full blur-3xl"></div>
        <div className="absolute bottom-10 right-10 w-40 h-40 bg-blue-400/10 rounded-full blur-3xl"></div>
        
        <div className="max-w-7xl 2xl:max-w-[1600px] 3xl:max-w-[1800px] mx-auto grid md:grid-cols-2 gap-6 md:gap-8 lg:gap-12 2xl:gap-16 items-center relative">
          {/* Left Content - Collapsed to Icon */}
          <div className="flex items-center justify-center md:justify-start animate-fadeInUp relative z-40 w-full md:w-auto">
            <div className="w-full md:w-auto">
              {/* Mobile: Collapsible Badge */}
              <div className="md:hidden">
                <button 
                  onClick={() => setIsHeroExpanded(!isHeroExpanded)}
                  className="inline-flex items-center space-x-3 px-6 py-3 bg-gradient-to-r from-slate-600/95 via-slate-700/95 to-blue-700/95 hover:from-slate-500 hover:via-slate-600 hover:to-blue-600 rounded-full border border-slate-300/40 backdrop-blur-sm shadow-lg hover:shadow-2xl hover:shadow-slate-500/40 transition-all duration-300 transform hover:scale-110 w-full justify-center"
                  title="About IcanEra"
                >
                  <Zap className="w-5 h-5 text-white drop-shadow-lg animate-pulse flex-shrink-0" />
                  <span className="text-sm font-bold text-white">Learn More</span>
                  <ChevronDown className={`w-4 h-4 text-white transition-transform duration-300 ${isHeroExpanded ? 'rotate-180' : ''}`} />
                </button>

                {/* Mobile Expanded Container */}
                {isHeroExpanded && (
                  <div className={`mt-4 border ican-cove-card p-6 space-y-5 shadow-2xl backdrop-blur-xl animate-fadeInUp ${isDarkTheme ? 'bg-slate-900/90 border-slate-600/45 shadow-slate-900/50' : 'bg-slate-100/95 border-slate-300/70 shadow-slate-300/45'}`}>
                    <div className={`inline-flex items-center space-x-2 border ican-cove-tab px-4 py-2 w-full ${isDarkTheme ? 'bg-slate-800/80 border-slate-600/55' : 'bg-white/95 border-slate-300/80'}`}>
                      <Zap className="w-4 h-4 text-blue-200 flex-shrink-0" />
                      <span className="text-sm text-slate-200 font-medium">Record • Invest • Grow • Prosper</span>
                    </div>
                    
                    <h2 className="text-2xl font-extrabold text-white leading-tight">
                      Your Complete Financial Life In One Platform
                    </h2>
                    
                    <div className="text-sm text-gray-300 leading-relaxed space-y-4">
                      <div className="space-y-2">
                        <p className="font-semibold text-yellow-200">Record every transaction effortlessly</p>
                        <p className="text-xs">Capture income and expenses by voice or manual entry. Smart categorization handles everything.</p>
                      </div>
                      <div className="space-y-2">
                        <p className="font-semibold text-purple-200">Separate personal & business finances</p>
                        <p className="text-xs">Multi-wallet system keeps everything organized and crystal clear.</p>
                      </div>
                      <div className="space-y-2">
                        <p className="font-semibold text-pink-200">Invest, earn, and grow together</p>
                        <p className="text-xs">TRUST groups (8-15% returns), business investing via PitchIn, zero-fee global transfers.</p>
                      </div>
                      <div className="space-y-2">
                        <p className="font-semibold text-green-200">Give back with purpose through tithing</p>
                        <p className="text-xs">Align faith with finances. Automatic calculations, community impact, spiritual accountability.</p>
                      </div>
                      <div className="space-y-2">
                        <p className="font-semibold text-blue-200">Scale your business with confidence</p>
                        <p className="text-xs">Professional tools for team management, inventory, and automated approvals.</p>
                      </div>
                    </div>
                    
                    <div className="flex items-center space-x-2 pt-3">
                      <Shield className="w-5 h-5 text-green-400 flex-shrink-0" />
                      <span className="text-sm text-green-300 font-medium">Blockchain-Secured • Trusted • Transparent</span>
                    </div>
                    
                    <div className="space-y-3 pt-2">
                      <button onClick={onGetStarted} className="inline-flex items-center space-x-2 px-6 py-3 bg-gradient-to-r from-yellow-500 to-yellow-400 hover:from-yellow-400 hover:to-yellow-300 rounded-full font-bold text-slate-900 transition-all duration-300 transform hover:scale-105 shadow-lg hover:shadow-xl hover:shadow-yellow-500/50 w-full justify-center">
                        <Zap className="w-4 h-4" />
                        <span>Start Recording Now</span>
                      </button>
                      <button
                        onClick={() => scrollToSection('platforms')}
                        className="inline-flex items-center space-x-2 px-6 py-3 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 rounded-full font-bold text-white transition-all duration-300 transform hover:scale-105 shadow-lg hover:shadow-xl hover:shadow-purple-500/50 w-full justify-center"
                      >
                        <span>Explore All Platforms</span>
                        <ArrowRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Desktop: Always Visible Full Container */}
              <div className={`hidden md:block border ican-cove-card p-6 md:p-8 2xl:p-10 space-y-5 2xl:space-y-7 shadow-2xl backdrop-blur-xl w-full md:w-full lg:max-w-2xl 2xl:max-w-3xl ${isDarkTheme ? 'bg-slate-900/90 border-slate-600/45 shadow-slate-900/50' : 'bg-slate-100/95 border-slate-300/70 shadow-slate-300/45'}`}>
                {/* Tag */}
                <div className={`inline-flex items-center space-x-2 border ican-cove-tab px-4 py-2 ${isDarkTheme ? 'bg-slate-800/80 border-slate-600/55' : 'bg-white/95 border-slate-300/80'}`}>
                  <Zap className="w-4 h-4 text-blue-200 flex-shrink-0" />
                  <span className="text-sm md:text-base 2xl:text-lg text-slate-200 font-medium">Record • Invest • Grow • Prosper</span>
                </div>
                
                {/* Headline */}
                <h2 className="text-2xl md:text-3xl lg:text-4xl 2xl:text-5xl 3xl:text-6xl font-extrabold text-white leading-tight">
                  Your Complete Financial Life In One Platform
                </h2>
                
                {/* Description */}
                <div className="text-sm md:text-base 2xl:text-lg text-gray-300 leading-relaxed space-y-4">
                  <div className="space-y-3">
                    <p className="font-semibold text-yellow-200">Record every transaction effortlessly</p>
                    <p>Capture income and expenses by voice or manual entry. Watch our smart system instantly categorize and organize everything for you.</p>
                  </div>
                  <div className="space-y-3">
                    <p className="font-semibold text-purple-200">Separate personal & business finances</p>
                    <p>Multi-wallet system keeps your personal savings, business profits, group savings, and investments completely organized and crystal clear.</p>
                  </div>
                  <div className="space-y-3">
                    <p className="font-semibold text-pink-200">Invest, earn, and grow together</p>
                    <p>Build wealth through democratic TRUST groups (8-15% returns), invest in promising businesses via PitchIn, and move money globally with zero fees.</p>
                  </div>
                  <div className="space-y-3">
                    <p className="font-semibold text-green-200">Give back with purpose through tithing</p>
                    <p>Align your faith with your finances. Automatic tithe calculations, community impact tracking, and spiritual accountability—your generosity tracked and honored.</p>
                  </div>
                  <div className="space-y-3">
                    <p className="font-semibold text-blue-200">Scale your business with confidence</p>
                    <p>Professional reporting, team management, inventory tracking, and automated approvals. Enterprise-grade tools built for ambitious entrepreneurs.</p>
                  </div>
                </div>
                
                {/* Trust Badge */}
                <div className="flex items-center space-x-2 pt-3">
                  <Shield className="w-5 h-5 text-green-400 flex-shrink-0" />
                  <span className="text-sm text-green-300 font-medium">Blockchain-Secured • Trusted • Transparent</span>
                </div>
                
                {/* CTA Buttons */}
                <div className="space-y-3 pt-2 flex flex-col lg:flex-row gap-3">
                  <button onClick={onGetStarted} className="inline-flex items-center space-x-2 px-8 py-3 2xl:py-4 bg-gradient-to-r from-yellow-500 to-yellow-400 hover:from-yellow-400 hover:to-yellow-300 rounded-full font-bold text-slate-900 transition-all duration-300 transform hover:scale-105 shadow-lg hover:shadow-xl hover:shadow-yellow-500/50 justify-center">
                    <Zap className="w-5 h-5" />
                    <span className="text-base 2xl:text-lg">Start Recording Now</span>
                  </button>
                  <button
                    onClick={() => scrollToSection('platforms')}
                    className="inline-flex items-center space-x-2 px-8 py-3 2xl:py-4 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 rounded-full font-bold text-white transition-all duration-300 transform hover:scale-105 shadow-lg hover:shadow-xl hover:shadow-purple-500/50 justify-center"
                  >
                    <span className="text-base 2xl:text-lg">Explore All Platforms</span>
                    <ArrowRight className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Right - Feature Image Showcase Carousel */}
          <div className="relative animate-fadeInDown hidden md:flex items-center justify-center h-full min-h-96 2xl:min-h-[500px] z-0">
            <div className="relative w-full max-w-lg 2xl:max-w-2xl group">
              {/* Image container with carousel */}
              <div className="relative ican-cove-card overflow-hidden">
                {/* Content - Animated Carousel */}
                <div className="relative space-y-6">
                  {/* Image with slide transition */}
                  <div className="relative h-80 2xl:h-[450px] 3xl:h-[520px] ican-cove-panel overflow-hidden shadow-lg group/image">
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
                  <div key={`hero-${currentHeroSlide}`} className="text-center space-y-2 animate-fadeIn">
                    <p className="text-xs text-yellow-300 font-semibold uppercase tracking-wider">✨ {heroSlides[currentHeroSlide].subtitle}</p>
                    <h3 className="text-xl 2xl:text-2xl font-bold bg-gradient-to-r from-slate-100 via-blue-100 to-slate-100 bg-clip-text text-transparent">{heroSlides[currentHeroSlide].title}</h3>
                    <p className="text-[11px] text-gray-500 uppercase tracking-[0.14em]">
                      Slide {currentHeroSlide + 1} of {heroSlides.length}
                    </p>
                  </div>

                  {/* Slide Navigation Buttons - Small */}
                  <div className="flex gap-2 justify-center mt-4">
                    <button
                      onClick={prevHeroSlide}
                      className="p-2 rounded-full bg-slate-600/40 hover:bg-slate-500/70 transition transform hover:scale-110 group/btn"
                    >
                      <ChevronRight className="w-4 h-4 transform rotate-180 group-hover/btn:translate-x-0.5 transition" />
                    </button>
                    <button
                      onClick={nextHeroSlide}
                      className="p-2 rounded-full bg-slate-600/40 hover:bg-slate-500/70 transition transform hover:scale-110 group/btn"
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
                            : 'bg-slate-500/40 w-1.5 h-1.5 hover:bg-yellow-500/60'
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
                className="group bg-gradient-to-br from-purple-900/20 to-blue-900/20 border border-purple-500/20 ican-cove-panel p-6 hover:border-purple-500/50 transition transform hover:scale-105 hover:shadow-lg hover:shadow-purple-500/20"
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
      <section id="platforms" className="relative py-20 2xl:py-28 px-4 sm:px-6 lg:px-8 2xl:px-16">
        <div className="max-w-7xl 2xl:max-w-[1600px] 3xl:max-w-[1800px] mx-auto">
          {/* Animated Badge Section */}
          <div className="text-center mb-12 md:mb-16">
            {/* Main Badge Container */}
            <div className="inline-block mb-8">
              <div className="relative group">
                {/* Glow effect */}
                <div className={`absolute inset-0 bg-gradient-to-r ${activeBadgeTheme.glow} ican-cove-card blur-2xl group-hover:opacity-100 opacity-80 transition duration-500 animate-pulse`}></div>
                
                {/* Badge */}
                <div className={`relative bg-gradient-to-br ${activeBadgeTheme.card} border-[3px] ${activeBadgeTheme.border} ican-cove-card overflow-hidden px-6 md:px-10 py-4 md:py-6 backdrop-blur-xl shadow-2xl animate-[fadeIn_350ms_ease-out]`}>
                  {/* Animated gradient border */}
                  <div className={`absolute inset-0 ican-cove-card bg-gradient-to-r ${activeBadgeTheme.pulse} animate-pulse pointer-events-none`}></div>
                  <div className="absolute -top-3 right-10 w-7 h-7 rounded-full bg-white/20 blur-md animate-bounce pointer-events-none"></div>
                  <div className="absolute -bottom-3 left-10 w-6 h-6 rounded-full bg-white/15 blur-md animate-pulse pointer-events-none"></div>
                  
                  {/* Badge Content */}
                  <div className="relative space-y-2 min-h-24 md:min-h-20 flex flex-col justify-center">
                    {/* Animated Title */}
                    <div className="relative">
                      <h2 className="text-2xl md:text-4xl lg:text-5xl 2xl:text-6xl font-extrabold mb-2 md:mb-3 leading-tight min-h-16 md:min-h-14 flex items-center justify-center">
                        <span 
                          key={currentBadgeInfo}
                          className="font-black tracking-tight animate-fadeIn"
                          style={{ color: activeBadgeWordPalette.title }}
                        >
                          {badgeInfo[currentBadgeInfo].title}
                        </span>
                      </h2>
                    </div>
                    
                    {/* Animated Description */}
                    <div className="relative min-h-12 flex items-center justify-center">
                      <p 
                        key={`desc-${currentBadgeInfo}`}
                        className="font-extrabold text-sm md:text-base 2xl:text-lg max-w-3xl 2xl:max-w-4xl mx-auto leading-relaxed animate-fadeIn"
                        style={{ color: activeBadgeWordPalette.desc }}
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
                              ? `${activeBadgeTheme.indicatorActive} w-3 h-3 shadow-lg`
                              : `${activeBadgeTheme.indicatorInactive} w-2 h-2`
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
              <div className="relative ican-cove-card overflow-hidden">
                {/* Main Image - Full Screen */}
                <div className="relative h-96 md:h-[600px] lg:h-[700px] 2xl:h-[850px] 3xl:h-[950px] overflow-hidden shadow-2xl group bg-slate-900">
                  <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900" />
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none px-8 text-center">
                    <p className="text-slate-500/75 text-xl md:text-3xl font-bold tracking-wide">{slides[currentSlide].title}</p>
                  </div>
                  {!failedMainSlideImages[currentSlide] && (
                    <img
                      src={slides[currentSlide].image}
                      alt={slides[currentSlide].title}
                      className="absolute inset-0 w-full h-full object-cover brightness-110 contrast-110 saturate-110 group-hover:scale-105 transition-transform duration-500"
                      onError={() => setFailedMainSlideImages((prev) => ({ ...prev, [currentSlide]: true }))}
                    />
                  )}

                  {/* Improved Transparent Overlay - Better readability */}
                  <div className="absolute inset-0 flex flex-col justify-between p-4 md:p-8 2xl:p-12">
                    {/* Top: Badge/Featured */}
                    <div className="flex justify-between items-start">
                      {/* Featured badge */}
                      {slides[currentSlide].highlight && (
                        <div className="px-4 py-2 md:px-5 md:py-3 bg-gradient-to-r from-yellow-500 to-yellow-400 rounded-full shadow-lg shadow-yellow-500/60 animate-bounce">
                          <p className="text-xs md:text-sm font-bold text-slate-900">⭐ FEATURED</p>
                        </div>
                      )}
                      {/* Slide counter */}
                      <p className="text-[10px] md:text-xs 2xl:text-sm text-slate-200/90 font-semibold uppercase tracking-widest ml-auto">
                        {currentSlide + 1} / {slides.length}
                      </p>
                    </div>

                    {/* Bottom: Content Overlay - Better hierarchy & readability */}
                    <div
                      key={`platform-slide-${currentSlide}`}
                      className="space-y-3 md:space-y-4 2xl:space-y-5 animate-fadeIn bg-transparent ican-cove-panel p-3 md:p-5 border border-transparent"
                    >
                      {/* Subtitle/Category */}
                      <div className="inline-flex items-center space-x-2 bg-transparent border border-transparent rounded-full px-0 py-0 w-fit">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: activeSlideWordPalette.subtitle }}></div>
                        <p className="text-xs md:text-sm 2xl:text-base font-black uppercase tracking-wider" style={{ color: activeSlideWordPalette.subtitle }}>
                          {slides[currentSlide].subtitle}
                        </p>
                      </div>

                      {/* Main Title - Big, Bold, Readable */}
                      <h3 className="text-2xl md:text-4xl lg:text-5xl 2xl:text-6xl font-black leading-tight max-w-2xl" style={{ color: activeSlideWordPalette.title }}>
                        <span>
                          {slides[currentSlide].title}
                        </span>
                      </h3>

                      {/* Real Message - The "why it matters" */}
                      <p className="text-sm md:text-lg 2xl:text-xl font-black leading-relaxed max-w-2xl italic" style={{ color: activeSlideWordPalette.body }}>
                        "{slides[currentSlide].realMessage}"
                      </p>

                      {/* Description - Additional context */}
                      <p className="text-xs md:text-sm 2xl:text-base font-extrabold leading-relaxed max-w-2xl" style={{ color: activeSlideWordPalette.body }}>
                        {slides[currentSlide].description}
                      </p>

                      {/* Quick Features TagList */}
                      {slides[currentSlide].features && (
                        <div className="flex flex-wrap gap-2 pt-2">
                          {slides[currentSlide].features.slice(0, 3).map((feature, idx) => (
                            <span key={idx} className="inline-block px-0 py-0 bg-transparent border border-transparent rounded-full text-xs md:text-sm font-black" style={{ color: activeSlideWordPalette.feature }}>
                              {feature}
                            </span>
                          ))}
                          {slides[currentSlide].features.length > 3 && (
                            <span className="inline-block px-0 py-0 bg-transparent border border-transparent rounded-full text-xs md:text-sm font-black" style={{ color: activeSlideWordPalette.feature }}>
                              +{slides[currentSlide].features.length - 3} more
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Navigation Buttons with Golden Accents */}
                <button
                  onClick={prevSlide}
                  className="absolute left-2 md:left-4 top-1/2 transform -translate-y-1/2 z-20 ican-rainbow-fill rounded-full p-2.5 md:p-4 transition group shadow-lg shadow-purple-500/50 hover:shadow-xl hover:shadow-yellow-500/30 hover:scale-110 active:scale-95"
                  title="Previous slide"
                >
                  <ChevronRight className="w-4 h-4 md:w-6 md:h-6 transform rotate-180 group-hover:translate-x-1 transition" />
                </button>
                <button
                  onClick={nextSlide}
                  className="absolute right-2 md:right-4 top-1/2 transform -translate-y-1/2 z-20 ican-rainbow-fill rounded-full p-2.5 md:p-4 transition group shadow-lg shadow-purple-500/50 hover:shadow-xl hover:shadow-yellow-500/30 hover:scale-110 active:scale-95"
                  title="Next slide"
                >
                  <ChevronRight className="w-4 h-4 md:w-6 md:h-6 group-hover:translate-x-1 transition" />
                </button>

              </div>
            </div>
          </div>

          {/* Call-to-Action Buttons and Stats Section */}
          <div className="mt-4 md:mt-12 2xl:mt-16 space-y-3 md:space-y-8 text-center animate-[fadeIn_600ms_ease-out]">
            {/* Buttons */}
            <div className="flex flex-col sm:flex-row gap-2 md:gap-4 justify-center">
              <button
                onClick={onGetStarted}
                className="group bg-gradient-to-r from-emerald-500 to-cyan-500 border-2 border-emerald-300/70 px-4 md:px-8 2xl:px-10 py-2 md:py-4 2xl:py-5 ican-cove-panel font-extrabold text-sm md:text-lg 2xl:text-xl flex items-center justify-center space-x-2 text-slate-900 hover:shadow-2xl hover:shadow-emerald-500/45 transition-all duration-300 transform hover:-translate-y-0.5 hover:scale-[1.03]"
              >
                <span>Start Your Journey</span>
                <ArrowRight className="w-4 h-4 md:w-5 md:h-5 2xl:w-6 2xl:h-6 group-hover:translate-x-1 transition" />
              </button>
              <button
                onClick={() => scrollToSection('testimonials')}
                className="border-[3px] border-amber-300/65 bg-gradient-to-r from-amber-900/25 to-orange-900/25 px-4 md:px-8 2xl:px-10 py-2 md:py-4 2xl:py-5 ican-cove-panel font-extrabold text-sm md:text-lg 2xl:text-xl text-amber-100 hover:bg-amber-500/20 hover:shadow-xl hover:shadow-amber-500/30 transition-all duration-300 transform hover:-translate-y-0.5"
              >
                Learn More
              </button>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-2 md:gap-4 2xl:gap-8 pt-3 md:pt-8 2xl:pt-12 border-t border-purple-500/20">
              <div className="text-center ican-cove-panel border-2 border-violet-400/50 bg-violet-950/25 py-3 md:py-4 hover:border-violet-300/80 hover:shadow-lg hover:shadow-violet-500/30 transition-all duration-300 animate-[fadeIn_700ms_ease-out]">
                <p className="text-lg md:text-4xl 2xl:text-5xl font-black text-purple-300 tracking-tight">10K+</p>
                <p className="text-gray-300 text-xs md:text-base 2xl:text-lg font-semibold">Active Users</p>
              </div>
              <div className="text-center ican-cove-panel border-2 border-cyan-400/50 bg-cyan-950/25 py-3 md:py-4 hover:border-cyan-300/80 hover:shadow-lg hover:shadow-cyan-500/30 transition-all duration-300 animate-[fadeIn_850ms_ease-out]">
                <p className="text-lg md:text-4xl 2xl:text-5xl font-black text-fuchsia-300 tracking-tight">$50M+</p>
                <p className="text-gray-300 text-xs md:text-base 2xl:text-lg font-semibold">Volume Managed</p>
              </div>
              <div className="text-center ican-cove-panel border-2 border-rose-400/50 bg-rose-950/25 py-3 md:py-4 hover:border-rose-300/80 hover:shadow-lg hover:shadow-rose-500/30 transition-all duration-300 animate-[fadeIn_1000ms_ease-out]">
                <p className="text-lg md:text-4xl 2xl:text-5xl font-black text-violet-300 tracking-tight">99.9%</p>
                <p className="text-gray-300 text-xs md:text-base 2xl:text-lg font-semibold">Uptime</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Testimonials Section - Compact Animated Badge */}
      <section id="testimonials" className="relative py-6 md:py-8 lg:py-12 2xl:py-16 px-4 sm:px-6 lg:px-8 2xl:px-16">
        <div className="max-w-6xl 2xl:max-w-[1400px] mx-auto">
          {/* Compact Testimonial Badge - Horizontal */}
          <div className="relative group">
            {/* Animated Glow */}
            <div className={`absolute inset-0 ican-cove-panel blur-xl group-hover:opacity-100 opacity-50 transition duration-500 animate-pulse ${isDarkTheme ? 'bg-gradient-to-r from-teal-500/20 via-cyan-500/20 to-blue-500/20' : 'bg-gradient-to-r from-teal-300/35 via-cyan-300/35 to-blue-300/35'}`}></div>
            
            {/* Badge Container - Compact Horizontal */}
            <div className={`relative border-2 ican-cove-panel px-4 md:px-8 2xl:px-12 py-4 md:py-6 2xl:py-8 backdrop-blur-xl shadow-lg ${isDarkTheme ? 'bg-gradient-to-br from-teal-900/35 to-cyan-950/40 border-cyan-300/55 shadow-cyan-500/20' : 'bg-gradient-to-br from-teal-50 to-cyan-100 border-cyan-300/65 shadow-cyan-300/45'}`}>
              {/* Animated Border */}
              <div className="absolute inset-0 ican-cove-panel bg-gradient-to-r from-cyan-500/0 via-teal-400/20 to-blue-500/0 animate-pulse pointer-events-none"></div>
              
              {/* Horizontal Layout */}
              <div className="relative flex flex-col md:flex-row items-center justify-between gap-4 md:gap-6">
                {/* Left - Avatar & Name (Compact) */}
                <div 
                  key={`user-${currentTestimonial}`}
                  className="flex items-center gap-3 md:gap-4 min-w-max animate-fadeIn"
                >
                  <span className="text-3xl md:text-4xl 2xl:text-5xl flex-shrink-0">{testimonials[currentTestimonial].avatar}</span>
                  <div className="text-left">
                    <p className="font-bold text-sm md:text-base 2xl:text-lg text-white">{testimonials[currentTestimonial].name}</p>
                    <p className="text-xs md:text-sm 2xl:text-base bg-gradient-to-r from-cyan-300 to-purple-300 bg-clip-text text-transparent font-semibold">{testimonials[currentTestimonial].role}</p>
                  </div>
                </div>

                {/* Middle - Quote (Compact) */}
                <div className="flex-grow text-center md:text-left">
                  <p 
                    key={`quote-${currentTestimonial}`}
                    className="text-gray-300 italic text-xs md:text-sm 2xl:text-base leading-relaxed line-clamp-2 animate-fadeIn"
                  >
                    "{testimonials[currentTestimonial].text}"
                  </p>
                </div>

                {/* Right - Controls (Compact) */}
                <div className="flex gap-2 items-center flex-shrink-0">
                  {/* Stars */}
                  <div className="flex gap-0.5">
                    {[...Array(5)].map((_, i) => (
                      <span key={i} className="text-lg md:text-xl animate-[pulse_2.4s_ease-in-out_infinite]" style={{ animationDelay: `${i * 120}ms` }}>⭐</span>
                    ))}
                  </div>
                  
                  {/* Nav Buttons */}
                  <div className="flex gap-1 md:gap-2">
                    <button
                      onClick={() => setCurrentTestimonial((prev) => (prev - 1 + testimonials.length) % testimonials.length)}
                      className="p-1.5 md:p-2 rounded-full bg-purple-600/35 hover:bg-purple-500/50 transition-all duration-300 transform hover:scale-110 group/btn border-2 border-purple-300/45 hover:border-purple-300/75"
                    >
                      <ChevronRight className="w-4 h-4 md:w-5 md:h-5 transform rotate-180" />
                    </button>
                    <button
                      onClick={() => setCurrentTestimonial((prev) => (prev + 1) % testimonials.length)}
                      className="p-1.5 md:p-2 rounded-full bg-purple-600/35 hover:bg-purple-500/50 transition-all duration-300 transform hover:scale-110 group/btn border-2 border-purple-300/45 hover:border-purple-300/75"
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
      <section className="relative py-8 md:py-12 lg:py-20 2xl:py-28 px-4 sm:px-6 lg:px-8 2xl:px-16">
        <div className="max-w-4xl 2xl:max-w-6xl mx-auto">
          <div className={`border-[3px] ican-cove-card p-4 md:p-8 lg:p-16 2xl:p-20 text-center shadow-2xl animate-[fadeIn_750ms_ease-out] ${isDarkTheme ? 'bg-gradient-to-r from-amber-900/45 via-yellow-900/45 to-emerald-900/45 border-emerald-300/55 shadow-emerald-500/20' : 'bg-gradient-to-r from-amber-100 via-yellow-100 to-emerald-100 border-emerald-400/65 shadow-emerald-300/45'}`}>
            <h2 className="text-xl md:text-3xl lg:text-5xl 2xl:text-6xl font-black mb-3 md:mb-4 lg:mb-6 leading-tight drop-shadow-[0_2px_12px_rgba(76,29,149,0.6)]">
              <span style={rainbowTextStyle}>Ready to Transform Your Capital?</span>
            </h2>
            <p className="text-xs md:text-sm lg:text-xl 2xl:text-2xl text-gray-300 mb-4 md:mb-6 lg:mb-8 2xl:mb-10 leading-relaxed">
              Join the revolution and take control of your financial future today.
            </p>
            <button
              onClick={onGetStarted}
              className={`group border-2 px-4 md:px-8 lg:px-10 2xl:px-12 py-2 md:py-3 lg:py-4 2xl:py-5 ican-cove-panel font-black text-xs md:text-sm lg:text-lg 2xl:text-xl inline-flex items-center space-x-2 transition-all duration-300 transform hover:-translate-y-0.5 hover:scale-[1.03] ${isDarkTheme ? 'bg-gradient-to-r from-emerald-400 to-cyan-500 border-emerald-300/70 text-slate-900 hover:shadow-2xl hover:shadow-emerald-500/50' : 'bg-gradient-to-r from-emerald-300 to-cyan-400 border-emerald-500/55 text-slate-900 hover:shadow-2xl hover:shadow-cyan-400/45'}`}
            >
              <span>Get Started Now</span>
              <ArrowRight className="w-4 h-4 md:w-5 md:h-5 group-hover:translate-x-1 transition" />
            </button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative border-t border-purple-500/10 py-6 md:py-10 lg:py-12 2xl:py-16 px-4 sm:px-6 lg:px-8 2xl:px-16">
        <div className="max-w-7xl 2xl:max-w-[1600px] 3xl:max-w-[1800px] mx-auto">
          {/* Footer Navigation - Simple List */}
          <div className="flex flex-wrap gap-3 md:gap-6 mb-8 md:mb-12 justify-center md:justify-start">
            {/* About */}
            <div className="group">
              <button
                onClick={() => setExpandedFooterSection(expandedFooterSection === 'about' ? null : 'about')}
                className={`flex items-center gap-2 transition-all duration-300 font-bold text-sm md:text-base px-3 py-1.5 ican-cove-tab border-2 ${isDarkTheme ? 'text-amber-100 hover:text-white border-amber-300/55 bg-amber-900/20 hover:bg-amber-700/35 hover:border-amber-200/80' : 'text-amber-900 hover:text-amber-950 border-amber-400/55 bg-amber-100 hover:bg-amber-200/90 hover:border-amber-500/75'}`}
              >
                About
                <ChevronDown className={`w-4 h-4 transition-transform duration-300 ${expandedFooterSection === 'about' ? 'rotate-180' : ''}`} />
              </button>
              {expandedFooterSection === 'about' && (
                <div className={`mt-2 border ican-cove-panel p-3 md:p-4 animate-fadeIn w-80 md:absolute md:left-0 md:z-50 ${isDarkTheme ? 'bg-gradient-to-br from-amber-900/35 to-orange-950/35 border-amber-300/25' : 'bg-gradient-to-br from-amber-50 to-orange-100 border-amber-300/50'}`}>
                  <p className="text-gray-400 text-xs md:text-sm leading-relaxed">{footerSections.about.content}</p>
                </div>
              )}
            </div>

            {/* Blog */}
            <div className="group">
              <button
                onClick={() => setExpandedFooterSection(expandedFooterSection === 'blog' ? null : 'blog')}
                className={`flex items-center gap-2 transition-all duration-300 font-bold text-sm md:text-base px-3 py-1.5 ican-cove-tab border-2 ${isDarkTheme ? 'text-cyan-100 hover:text-white border-cyan-300/55 bg-cyan-900/20 hover:bg-cyan-700/35 hover:border-cyan-200/80' : 'text-cyan-900 hover:text-cyan-950 border-cyan-400/55 bg-cyan-100 hover:bg-cyan-200/90 hover:border-cyan-500/75'}`}
              >
                Blog
                <ChevronDown className={`w-4 h-4 transition-transform duration-300 ${expandedFooterSection === 'blog' ? 'rotate-180' : ''}`} />
              </button>
              {expandedFooterSection === 'blog' && (
                <div className={`mt-2 border ican-cove-panel p-3 md:p-4 animate-fadeIn w-80 md:absolute md:left-32 md:z-50 space-y-2 ${isDarkTheme ? 'bg-gradient-to-br from-cyan-900/35 to-blue-950/35 border-cyan-300/25' : 'bg-gradient-to-br from-cyan-50 to-blue-100 border-cyan-300/50'}`}>
                  <p className="text-gray-400 text-xs md:text-sm leading-relaxed mb-2">{footerSections.blog.content}</p>
                  <ul className="space-y-1">
                    {footerSections.blog.links.map((link, i) => (
                      <li key={i}>
                        <button
                          onClick={() => setExpandedFooterItem(expandedFooterItem === `blog-${i}` ? null : `blog-${i}`)}
                          className="w-full text-left px-2 py-1 ican-cove-tab-sm hover:bg-white/10 transition group/item flex items-center justify-between"
                        >
                          <span className="text-purple-300 text-xs font-medium hover:text-purple-200">→ {link.title}</span>
                          <ChevronDown className={`w-3 h-3 transition-transform duration-200 ${expandedFooterItem === `blog-${i}` ? 'rotate-180' : ''}`} />
                        </button>
                        {expandedFooterItem === `blog-${i}` && (
                          <div className="mt-1 ml-2 pl-2 border-l border-purple-500/40 text-gray-400 text-xs leading-relaxed animate-fadeIn">
                            {link.content}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* Careers */}
            <div className="group">
              <button
                onClick={() => setExpandedFooterSection(expandedFooterSection === 'careers' ? null : 'careers')}
                className={`flex items-center gap-2 transition-all duration-300 font-bold text-sm md:text-base px-3 py-1.5 ican-cove-tab border-2 ${isDarkTheme ? 'text-emerald-100 hover:text-white border-emerald-300/55 bg-emerald-900/20 hover:bg-emerald-700/35 hover:border-emerald-200/80' : 'text-emerald-900 hover:text-emerald-950 border-emerald-400/55 bg-emerald-100 hover:bg-emerald-200/90 hover:border-emerald-500/75'}`}
              >
                Careers
                <ChevronDown className={`w-4 h-4 transition-transform duration-300 ${expandedFooterSection === 'careers' ? 'rotate-180' : ''}`} />
              </button>
              {expandedFooterSection === 'careers' && (
                <div className={`mt-2 border ican-cove-panel p-3 md:p-4 animate-fadeIn w-80 md:absolute md:left-48 md:z-50 space-y-2 ${isDarkTheme ? 'bg-gradient-to-br from-emerald-900/35 to-teal-950/35 border-emerald-300/25' : 'bg-gradient-to-br from-emerald-50 to-teal-100 border-emerald-300/50'}`}>
                  <p className="text-gray-400 text-xs md:text-sm leading-relaxed mb-2">{footerSections.careers.content}</p>
                  <ul className="space-y-1">
                    {footerSections.careers.links.map((link, i) => (
                      <li key={i}>
                        <button
                          onClick={() => setExpandedFooterItem(expandedFooterItem === `careers-${i}` ? null : `careers-${i}`)}
                          className="w-full text-left px-2 py-1 ican-cove-tab-sm hover:bg-white/10 transition group/item flex items-center justify-between"
                        >
                          <span className="text-purple-300 text-xs font-medium hover:text-purple-200">→ {link.title}</span>
                          <ChevronDown className={`w-3 h-3 transition-transform duration-200 ${expandedFooterItem === `careers-${i}` ? 'rotate-180' : ''}`} />
                        </button>
                        {expandedFooterItem === `careers-${i}` && (
                          <div className="mt-1 ml-2 pl-2 border-l border-purple-500/40 text-gray-400 text-xs leading-relaxed animate-fadeIn">
                            {link.content}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* Privacy */}
            <div className="group">
              <button
                onClick={() => setExpandedFooterSection(expandedFooterSection === 'privacy' ? null : 'privacy')}
                className={`flex items-center gap-2 transition-all duration-300 font-bold text-sm md:text-base px-3 py-1.5 ican-cove-tab border-2 ${isDarkTheme ? 'text-rose-100 hover:text-white border-rose-300/55 bg-rose-900/20 hover:bg-rose-700/35 hover:border-rose-200/80' : 'text-rose-900 hover:text-rose-950 border-rose-400/55 bg-rose-100 hover:bg-rose-200/90 hover:border-rose-500/75'}`}
              >
                Privacy
                <ChevronDown className={`w-4 h-4 transition-transform duration-300 ${expandedFooterSection === 'privacy' ? 'rotate-180' : ''}`} />
              </button>
              {expandedFooterSection === 'privacy' && (
                <div className={`mt-2 border ican-cove-panel p-3 md:p-4 animate-fadeIn w-80 md:absolute md:left-64 md:z-50 space-y-2 ${isDarkTheme ? 'bg-gradient-to-br from-rose-900/35 to-pink-950/35 border-rose-300/25' : 'bg-gradient-to-br from-rose-50 to-pink-100 border-rose-300/50'}`}>
                  <p className="text-gray-400 text-xs md:text-sm leading-relaxed mb-2">{footerSections.privacy.content}</p>
                  <ul className="space-y-1">
                    {footerSections.privacy.links.map((link, i) => (
                      <li key={i}>
                        <button
                          onClick={() => setExpandedFooterItem(expandedFooterItem === `privacy-${i}` ? null : `privacy-${i}`)}
                          className="w-full text-left px-2 py-1 ican-cove-tab-sm hover:bg-white/10 transition group/item flex items-center justify-between"
                        >
                          <span className="text-purple-300 text-xs font-medium hover:text-purple-200">→ {link.title}</span>
                          <ChevronDown className={`w-3 h-3 transition-transform duration-200 ${expandedFooterItem === `privacy-${i}` ? 'rotate-180' : ''}`} />
                        </button>
                        {expandedFooterItem === `privacy-${i}` && (
                          <div className="mt-1 ml-2 pl-2 border-l border-purple-500/40 text-gray-400 text-xs leading-relaxed animate-fadeIn">
                            {link.content}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* Terms */}
            <div className="group">
              <button
                onClick={() => setExpandedFooterSection(expandedFooterSection === 'terms' ? null : 'terms')}
                className={`flex items-center gap-2 transition-all duration-300 font-bold text-sm md:text-base px-3 py-1.5 ican-cove-tab border-2 ${isDarkTheme ? 'text-indigo-100 hover:text-white border-indigo-300/55 bg-indigo-900/20 hover:bg-indigo-700/35 hover:border-indigo-200/80' : 'text-indigo-900 hover:text-indigo-950 border-indigo-400/55 bg-indigo-100 hover:bg-indigo-200/90 hover:border-indigo-500/75'}`}
              >
                Terms
                <ChevronDown className={`w-4 h-4 transition-transform duration-300 ${expandedFooterSection === 'terms' ? 'rotate-180' : ''}`} />
              </button>
              {expandedFooterSection === 'terms' && (
                <div className={`mt-2 border ican-cove-panel p-3 md:p-4 animate-fadeIn w-80 md:absolute md:right-0 md:z-50 space-y-2 ${isDarkTheme ? 'bg-gradient-to-br from-indigo-900/35 to-violet-950/35 border-indigo-300/25' : 'bg-gradient-to-br from-indigo-50 to-violet-100 border-indigo-300/50'}`}>
                  <p className="text-gray-400 text-xs md:text-sm leading-relaxed mb-2">{footerSections.terms.content}</p>
                  <ul className="space-y-1">
                    {footerSections.terms.links.map((link, i) => (
                      <li key={i}>
                        <button
                          onClick={() => setExpandedFooterItem(expandedFooterItem === `terms-${i}` ? null : `terms-${i}`)}
                          className="w-full text-left px-2 py-1 ican-cove-tab-sm hover:bg-white/10 transition group/item flex items-center justify-between"
                        >
                          <span className="text-purple-300 text-xs font-medium hover:text-purple-200">→ {link.title}</span>
                          <ChevronDown className={`w-3 h-3 transition-transform duration-200 ${expandedFooterItem === `terms-${i}` ? 'rotate-180' : ''}`} />
                        </button>
                        {expandedFooterItem === `terms-${i}` && (
                          <div className="mt-1 ml-2 pl-2 border-l border-purple-500/40 text-gray-400 text-xs leading-relaxed animate-fadeIn">
                            {link.content}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>

          {/* Bottom Footer */}
          <div className={`border-t border-purple-500/10 pt-4 md:pt-6 lg:pt-8 flex flex-col md:flex-row justify-between items-center text-xs md:text-sm gap-3 ${isDarkTheme ? 'text-gray-400' : 'text-slate-600'}`}>
            <div className="text-center md:text-left">
              <p
                className="font-bold"
                style={{
                  color: 'var(--color-secondary)',
                  textShadow: isDarkTheme ? '0 0 10px rgba(129, 140, 248, 0.3)' : '0 1px 0 rgba(255,255,255,0.45)'
                }}
              >
                IcanEra
              </p>
              <p className={`${isDarkTheme ? 'text-gray-400' : 'text-slate-600'} text-xs`}>Transform Volatility to Global Capital</p>
              <p>&copy; 2026 IcanEra. All rights reserved.</p>
            </div>
            <div className="flex flex-wrap justify-center md:justify-end gap-2 md:gap-3">
              <a href="https://twitter.com/icaneraera" target="_blank" rel="noopener noreferrer" className={`transition-all duration-300 flex items-center space-x-1 px-2.5 py-1.5 ican-cove-tab-sm border-2 ${isDarkTheme ? 'hover:text-white border-cyan-300/55 bg-cyan-900/20 hover:border-cyan-200/80 hover:bg-cyan-700/35' : 'text-cyan-900 border-cyan-400/55 bg-cyan-100 hover:bg-cyan-200/90 hover:border-cyan-500/75'}`}>
                <span>𝕏</span>
                <span>@icaneraera</span>
              </a>
              <a href="https://instagram.com/icaneraera" target="_blank" rel="noopener noreferrer" className={`transition-all duration-300 flex items-center space-x-1 px-2.5 py-1.5 ican-cove-tab-sm border-2 ${isDarkTheme ? 'hover:text-white border-rose-300/55 bg-rose-900/20 hover:border-rose-200/80 hover:bg-rose-700/35' : 'text-rose-900 border-rose-400/55 bg-rose-100 hover:bg-rose-200/90 hover:border-rose-500/75'}`}>
                <span>📷</span>
                <span>@icaneraera</span>
              </a>
              <div className="relative">
                <button
                  onClick={handleEmailClick}
                  className={`transition-all duration-300 flex items-center space-x-1 cursor-pointer px-2.5 py-1.5 ican-cove-tab-sm border-2 ${isDarkTheme ? 'hover:text-white border-emerald-300/55 bg-emerald-900/20 hover:border-emerald-200/80 hover:bg-emerald-700/35' : 'text-emerald-900 border-emerald-400/55 bg-emerald-100 hover:bg-emerald-200/90 hover:border-emerald-500/75'}`}
                  title="Click to open Gmail"
                >
                  <span>✉️</span>
                  <span>Email</span>
                </button>
              </div>
              <a href="#" className={`transition-all duration-300 flex items-center px-2.5 py-1.5 ican-cove-tab-sm border-2 ${isDarkTheme ? 'hover:text-white border-amber-300/55 bg-amber-900/20 hover:border-amber-200/80 hover:bg-amber-700/35' : 'text-amber-900 border-amber-400/55 bg-amber-100 hover:bg-amber-200/90 hover:border-amber-500/75'}`}>Discord</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;

