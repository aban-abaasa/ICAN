import React, { createContext, useContext, useState, useEffect } from 'react';

const ThemeContext = createContext();

// Theme definitions
export const THEMES = {
  system: {
    id: 'system',
    name: 'System Default',
    icon: '🖥️',
    description: 'Follow device settings'
  },
  light: {
    id: 'light',
    name: 'Light',
    icon: '☀️',
    description: 'Bright & clean'
  },
  dark: {
    id: 'dark',
    name: 'Dark',
    icon: '🌙',
    description: 'Dark mode'
  },
  purple: {
    id: 'purple',
    name: 'Purple Night',
    icon: '🟣',
    description: 'Purple & vibrant'
  },
  green: {
    id: 'green',
    name: 'Forest Green',
    icon: '🟢',
    description: 'Green & natural'
  },
  ocean: {
    id: 'ocean',
    name: 'Ocean Blue',
    icon: '🔵',
    description: 'Blue & serene'
  }
};

// Color schemes for each theme
const THEME_COLORS = {
  light: {
    bg: '#ffffff',
    bgSecondary: '#ffffff',
    text: '#1a1a2e',
    textSecondary: '#555555',
    border: '#d0d5e0',
    primary: '#5a67d8',
    primaryLight: '#eef2ff',
    secondary: '#6366f1',
    accent: '#fbbf24'
  },
  dark: {
    bg: '#090d1a',
    bgSecondary: '#111827',
    text: '#f8fafc',
    textSecondary: '#cbd5e1',
    border: '#253046',
    primary: '#60a5fa',
    primaryLight: '#172554',
    secondary: '#818cf8',
    accent: '#fbbf24'
  },
  purple: {
    bg: '#1a0e3b',
    bgSecondary: '#2d1b5e',
    text: '#f8f7ff',
    textSecondary: '#d4c5ff',
    border: '#6d28d9',
    primary: '#c084fc',
    primaryLight: '#581c87',
    secondary: '#f0abfc',
    accent: '#fbbf24'
  },
  green: {
    bg: '#0f3d2e',
    bgSecondary: '#134e4a',
    text: '#f0fdf4',
    textSecondary: '#dcfce7',
    border: '#059669',
    primary: '#6ee7b7',
    primaryLight: '#064e3b',
    secondary: '#34d399',
    accent: '#fbbf24'
  },
  ocean: {
    bg: '#0c2d44',
    bgSecondary: '#164e63',
    text: '#f0f9ff',
    textSecondary: '#cffafe',
    border: '#0369a1',
    primary: '#38bdf8',
    primaryLight: '#082f49',
    secondary: '#0ea5e9',
    accent: '#fbbf24'
  }
};

// Apply theme immediately (synchronously)
const applyThemeImmediate = (themeId) => {
  const colors = THEME_COLORS[themeId] || THEME_COLORS.dark;
  const root = document.documentElement;
  
  // Direct inline style application - FASTEST
  root.style.backgroundColor = colors.bg;
  root.style.color = colors.text;
  
  if (document.body) {
    document.body.style.backgroundColor = colors.bg;
    document.body.style.color = colors.text;
  }
  
  // Set CSS variables
  Object.entries(colors).forEach(([key, value]) => {
    root.style.setProperty(`--color-${key}`, value);
  });
  
  // Set data attributes
  root.setAttribute('data-theme', themeId);
  
  // Create or update dynamic style tag for complete color overrides
  let styleTag = document.getElementById('dynamic-theme-overrides');
  if (!styleTag) {
    styleTag = document.createElement('style');
    styleTag.id = 'dynamic-theme-overrides';
    styleTag.type = 'text/css';
    document.head.appendChild(styleTag);
  }
  
  // Generate comprehensive CSS with ALL color utility overrides
  const generateComprehensiveThemeCSS = (colors, themeId) => {
    const isDarkTheme = themeId === 'dark';
    const mappedPrimarySurface = isDarkTheme ? colors.primaryLight : colors.primary;
    const mappedGradientFrom = isDarkTheme ? colors.bg : colors.bgSecondary;
    const mappedGradientVia = isDarkTheme ? colors.bgSecondary : colors.primary;
    const mappedGradientTo = isDarkTheme ? colors.bg : colors.bgSecondary;
    const backgroundImageCSS = themeId === 'light'
      ? 'background-image: none !important;'
      : isDarkTheme
        ? `background-image: linear-gradient(160deg, ${colors.bg} 0%, ${colors.bgSecondary} 55%, ${colors.bg} 100%) !important;`
        : `background-image: linear-gradient(135deg, ${colors.bgSecondary} 0%, ${colors.primary} 50%, ${colors.bgSecondary} 100%) !important;`;
    
    return `
      /* ==================== PRIORITY OVERRIDES ==================== */
      * {
        --tw-bg-opacity: 1 !important;
        --tw-text-opacity: 1 !important;
        --tw-border-opacity: 1 !important;
      }
      
      html, body, #root, #app, main, [role="main"], .main-content {
        background-color: ${colors.bg} !important;
        color: ${colors.text} !important;
      }
      
      /* === AGGRESSIVE DASHBOARD OVERRIDES === */
      div, section, article, nav, header, footer {
        --tw-bg-opacity: 1 !important;
      }
      
      /* ==================== COMPREHENSIVE BACKGROUND COLORS ==================== */
      /* Grayscale dark backgrounds */
      .bg-slate-950, .bg-slate-900, .bg-slate-800, .bg-slate-700, .bg-slate-600, .bg-slate-500,
      .bg-gray-950, .bg-gray-900, .bg-gray-800, .bg-gray-700, .bg-gray-600,
      .bg-zinc-900, .bg-zinc-800, .bg-neutral-900, .bg-neutral-800, .bg-stone-900,
      .bg-slate-400, .bg-slate-300, .bg-slate-200, .bg-slate-100,
      .bg-violet-950, .bg-violet-900, .bg-violet-800, .bg-violet-700,
      .bg-purple-950, .bg-purple-900, .bg-purple-800, .bg-purple-700,
      .dark\\:bg-slate-900, .dark\\:bg-gray-900,
      .md\\:bg-slate-900, .md\\:bg-gray-900 {
        background-color: ${colors.bgSecondary} !important;
        background-image: none !important;
      }
      
      /* Grayscale light backgrounds */
      .bg-white, .bg-gray-50, .bg-slate-50, .bg-gray-100, .bg-slate-100,
      .bg-zinc-50, .bg-neutral-50, .bg-stone-50 {
        background-color: ${colors.bg} !important;
        background-image: none !important;
      }
      
      /* All colored backgrounds (map to primary) */
      .bg-purple-900, .bg-purple-800, .bg-purple-700, .bg-purple-600, .bg-purple-500, .bg-purple-400, .bg-purple-300, .bg-purple-200,
      .bg-indigo-900, .bg-indigo-800, .bg-indigo-700, .bg-indigo-600, .bg-indigo-500, .bg-indigo-400,
      .bg-blue-900, .bg-blue-800, .bg-blue-700, .bg-blue-600, .bg-blue-500, .bg-blue-400, .bg-blue-300, .bg-blue-200,
      .bg-cyan-900, .bg-cyan-800, .bg-cyan-700, .bg-cyan-600, .bg-cyan-500, .bg-cyan-400, .bg-cyan-300,
      .bg-teal-900, .bg-teal-800, .bg-teal-700, .bg-teal-600, .bg-teal-500, .bg-teal-400,
      .bg-emerald-900, .bg-emerald-800, .bg-emerald-700, .bg-emerald-600, .bg-emerald-500, .bg-emerald-400,
      .bg-green-900, .bg-green-800, .bg-green-700, .bg-green-600, .bg-green-500, .bg-green-400,
      .bg-pink-900, .bg-pink-800, .bg-pink-700, .bg-pink-600, .bg-pink-500, .bg-pink-400, .bg-pink-300,
      .bg-rose-900, .bg-rose-800, .bg-rose-700, .bg-rose-600, .bg-rose-500,
      .bg-violet-900, .bg-violet-800, .bg-violet-700, .bg-violet-600,
      .bg-fuchsia-900, .bg-fuchsia-800, .bg-fuchsia-700, .bg-fuchsia-600,
      .bg-sky-900, .bg-sky-800, .bg-sky-700, .bg-sky-600, .bg-sky-500,
      .md\\:bg-purple-900, .md\\:bg-blue-900 {
        background-color: ${mappedPrimarySurface} !important;
        background-image: none !important;
      }
      
      /* Accent colors */
      .bg-yellow-600, .bg-yellow-500, .bg-yellow-400, .bg-yellow-300,
      .bg-amber-600, .bg-amber-500, .bg-amber-400, .bg-amber-300,
      .bg-orange-600, .bg-orange-500, .bg-orange-400 {
        background-color: ${colors.accent} !important;
        background-image: none !important;
      }
      
      /* ==================== COMPREHENSIVE TEXT COLORS ==================== */
      /* Light text */
      .text-white, .text-slate-50, .text-gray-50, .text-slate-100, .text-gray-100,
      .text-zinc-50, .text-neutral-50, .text-slate-200, .text-gray-200,
      .text-slate-300, .text-gray-300 {
        color: ${colors.text} !important;
      }
      
      /* Secondary text */
      .text-slate-400, .text-slate-500, .text-slate-600, .text-slate-700,
      .text-gray-400, .text-gray-500, .text-gray-600, .text-gray-700,
      .text-zinc-400, .text-zinc-500, .text-neutral-400, .text-neutral-500 {
        color: ${colors.textSecondary} !important;
      }
      
      /* Primary colored text */
      .text-purple-300, .text-purple-400, .text-purple-500, .text-purple-600, .text-purple-700, .text-purple-800,
      .text-indigo-300, .text-indigo-400, .text-indigo-500, .text-indigo-600, .text-indigo-700,
      .text-blue-300, .text-blue-400, .text-blue-500, .text-blue-600, .text-blue-700, .text-blue-800,
      .text-cyan-300, .text-cyan-400, .text-cyan-500, .text-cyan-600, .text-cyan-700,
      .text-teal-300, .text-teal-400, .text-teal-500, .text-teal-600, .text-teal-700,
      .text-emerald-300, .text-emerald-400, .text-emerald-500, .text-emerald-600,
      .text-green-300, .text-green-400, .text-green-500, .text-green-600,
      .text-pink-300, .text-pink-400, .text-pink-500, .text-pink-600, .text-pink-700,
      .text-rose-300, .text-rose-400, .text-rose-500, .text-rose-600,
      .text-violet-300, .text-violet-400, .text-violet-500, .text-violet-600,
      .text-fuchsia-300, .text-fuchsia-400, .text-fuchsia-500,
      .text-sky-300, .text-sky-400, .text-sky-500, .text-sky-600 {
        color: ${colors.primary} !important;
      }
      
      /* ==================== BORDER COLORS ==================== */
      .border-slate-700, .border-slate-600, .border-slate-500, .border-slate-400, .border-slate-300,
      .border-gray-700, .border-gray-600, .border-gray-500, .border-gray-400, .border-gray-300,
      .border-zinc-700, .border-zinc-600, .border-neutral-700, .border-neutral-600 {
        border-color: ${colors.border} !important;
      }
      
      .border-purple-500, .border-purple-600, .border-purple-700, .border-purple-400,
      .border-indigo-500, .border-indigo-600, .border-indigo-400,
      .border-blue-400, .border-blue-500, .border-blue-600, .border-blue-700,
      .border-cyan-500, .border-cyan-600, .border-cyan-400,
      .border-teal-500, .border-teal-600, .border-teal-400,
      .border-emerald-500, .border-emerald-600, .border-emerald-400,
      .border-green-500, .border-green-600, .border-green-400,
      .border-pink-500, .border-pink-600, .border-pink-400 {
        border-color: ${colors.primary} !important;
      }
      
      /* ==================== AGGRESSIVE GRADIENT COLOR OVERRIDES ==================== */
      /* Override ALL gradient backgrounds directly */
      [class*="bg-gradient"] {
        background-color: ${colors.bgSecondary} !important;
        ${backgroundImageCSS}
      }
      
      /* Gradient from, via, to stops */
      .from-slate-950, .from-slate-900, .from-slate-800, .from-slate-700, .from-slate-600, .from-violet-950, .from-purple-950,
      .from-gray-950, .from-gray-900, .from-gray-800, .from-gray-700, .from-gray-600,
      .from-purple-900, .from-purple-800, .from-purple-700,
      .from-indigo-900, .from-indigo-800, .from-indigo-700,
      .from-blue-900, .from-blue-800, .from-blue-700 {
        --tw-gradient-from: ${mappedGradientFrom} !important;
        background-color: ${mappedGradientFrom} !important;
      }
      
      .via-slate-900, .via-slate-800, .via-slate-700, .via-slate-600, .via-violet-950, .via-purple-950,
      .via-gray-900, .via-gray-800, .via-gray-700,
      .via-purple-900, .via-purple-800, .via-purple-700, .via-purple-600,
      .via-indigo-900, .via-indigo-800, .via-indigo-700, .via-indigo-600,
      .via-blue-900, .via-blue-800, .via-blue-700, .via-blue-600 {
        --tw-gradient-via: ${mappedGradientVia} !important;
      }
      
      .to-slate-950, .to-slate-900, .to-slate-800, .to-slate-700, .to-violet-950, .to-purple-950,
      .to-gray-950, .to-gray-900, .to-gray-800, .to-gray-700,
      .to-purple-900, .to-purple-800, .to-purple-700,
      .to-indigo-900, .to-indigo-800, .to-indigo-700,
      .to-blue-900, .to-blue-800, .to-blue-700 {
        --tw-gradient-to: ${mappedGradientTo} !important;
        background-color: ${mappedGradientTo} !important;
      }
      
      /* ==================== HOVER STATES ==================== */
      .hover\\:bg-slate-800:hover, .hover\\:bg-slate-700:hover, .hover\\:bg-slate-600:hover,
      .hover\\:bg-gray-800:hover, .hover\\:bg-gray-700:hover, .hover\\:bg-gray-600:hover {
        background-color: ${colors.bgSecondary} !important;
      }
      
      .hover\\:text-purple-400:hover, .hover\\:text-blue-400:hover, .hover\\:text-cyan-400:hover,
      .hover\\:text-slate-300:hover, .hover\\:text-gray-300:hover,
      .hover\\:text-purple-300:hover, .hover\\:text-blue-300:hover {
        color: ${colors.primary} !important;
      }
      
      .hover\\:border-purple-500:hover, .hover\\:border-blue-500:hover {
        border-color: ${colors.primary} !important;
      }
      
      /* ==================== FOCUS STATES ==================== */
      .focus\\:ring-purple-500:focus, .focus\\:ring-blue-500:focus,
      .focus\\:ring-cyan-500:focus, .focus\\:ring-indigo-500:focus {
        --tw-ring-color: ${colors.primary} !important;
      }
      
      .focus\\:border-purple-500:focus, .focus\\:border-blue-500:focus {
        border-color: ${colors.primary} !important;
      }
      
      /* ==================== FORM ELEMENTS ==================== */
      input, textarea, select, button, .input, .form-control {
        background-color: ${colors.bgSecondary} !important;
        color: ${colors.text} !important;
        border-color: ${colors.border} !important;
      }
      
      input:focus, textarea:focus, select:focus, button:focus {
        border-color: ${colors.primary} !important;
        --tw-ring-color: ${colors.primary} !important;
      }
      
      input::placeholder, textarea::placeholder {
        color: ${colors.textSecondary} !important;
      }
      
      /* ==================== SCROLLBAR ==================== */
      ::-webkit-scrollbar {
        background-color: ${colors.bgSecondary} !important;
      }
      
      ::-webkit-scrollbar-thumb {
        background-color: ${colors.primary} !important;
      }
      
      /* ==================== RING & SHADOW ==================== */
      .ring-purple-500, .ring-blue-500, .ring-cyan-500,
      .ring-slate-700, .ring-gray-700 {
        --tw-ring-color: ${colors.primary} !important;
      }
      
      .shadow-purple-500, .shadow-purple-600, .shadow-blue-500, .shadow-blue-600 {
        --tw-shadow-color: ${colors.primary} !important;
      }
      
      /* ==================== DIVIDE COLORS ==================== */
      .divide-slate-700, .divide-slate-600, .divide-gray-700, .divide-gray-600 {
        border-color: ${colors.border} !important;
      }
      
      .divide-purple-500, .divide-blue-500, .divide-cyan-500 {
        border-color: ${colors.primary} !important;
      }
    `;
  };
  
  const themeCSS = generateComprehensiveThemeCSS(colors, themeId);
  styleTag.innerHTML = themeCSS;
};

export const ThemeProvider = ({ children }) => {
  const [theme, setTheme] = useState('system');
  const [actualTheme, setActualTheme] = useState('dark');
  const [isLoading, setIsLoading] = useState(true);

  // Load saved theme preference and apply immediately
  useEffect(() => {
    const savedTheme = localStorage.getItem('icanera-theme') || 'system';
    setTheme(savedTheme);
    
    // Detect system preference
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const effectiveTheme = savedTheme === 'system' 
      ? (prefersDark ? 'dark' : 'light')
      : savedTheme;
    
    setActualTheme(effectiveTheme);
    
    // Apply theme immediately (synchronously)
    applyThemeImmediate(effectiveTheme);
    
    setIsLoading(false);
  }, []);

  // Listen for system theme changes
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => {
      if (theme === 'system') {
        setActualTheme(mediaQuery.matches ? 'dark' : 'light');
      }
    };
    
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [theme]);

  const changeTheme = (newTheme) => {
    // Validate theme
    if (!THEMES[newTheme]) {
      return;
    }
    
    // Update localStorage immediately
    localStorage.setItem('icanera-theme', newTheme);
    
    // Apply theme immediately
    if (newTheme === 'system') {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      const effectiveTheme = prefersDark ? 'dark' : 'light';
      setTheme(newTheme);
      setActualTheme(effectiveTheme);
      applyThemeImmediate(effectiveTheme);
    } else {
      setTheme(newTheme);
      setActualTheme(newTheme);
      applyThemeImmediate(newTheme);
    }
    
    // Force immediate repaint
    try {
      window.requestAnimationFrame(() => {
        document.documentElement.offsetHeight;
      });
    } catch (e) {
      // Fail silently
    }
  };

  const applyTheme = (themeId) => {
    applyThemeImmediate(themeId);
  };

  // Apply theme on actual theme change - IMMEDIATE application
  useEffect(() => {
    if (!isLoading) {
      applyThemeImmediate(actualTheme);
      
      // Single reapplication after short delay for safety
      const timeoutId = setTimeout(() => {
        applyThemeImmediate(actualTheme);
      }, 50);
      
      return () => clearTimeout(timeoutId);
    }
  }, [actualTheme, isLoading]);

  const value = {
    theme,
    actualTheme,
    changeTheme,
    colors: THEME_COLORS[actualTheme] || THEME_COLORS.dark,
    isLoading
  };

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return context;
};
