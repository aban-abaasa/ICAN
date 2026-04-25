import React, { useState } from 'react';
import { useTheme, THEMES } from '../context/ThemeContext';
import { ChevronDown, Palette } from 'lucide-react';

const ThemeSwitcher = () => {
  const { theme, changeTheme, actualTheme } = useTheme();
  const [isOpen, setIsOpen] = useState(false);

  const themeList = Object.values(THEMES);
  const currentTheme = THEMES[theme];

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="inline-flex items-center gap-1 px-2 md:px-3 py-1.5 md:py-2 rounded-lg hover:bg-purple-500/20 transition-all duration-200 group text-xs md:text-sm"
        title="Switch theme"
        aria-label="Theme switcher"
      >
        <Palette className="w-4 h-4 md:w-5 md:h-5 text-yellow-400 group-hover:text-yellow-300 transition-colors flex-shrink-0" />
        <span className="font-medium hidden md:inline max-w-16 truncate">
          {currentTheme.name}
        </span>
        <ChevronDown className={`w-3 h-3 md:w-4 md:h-4 text-gray-400 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute right-0 mt-1.5 w-56 md:w-64 bg-slate-900/95 border border-purple-500/40 rounded-lg shadow-2xl shadow-purple-500/30 backdrop-blur-xl z-50 animate-fadeIn text-xs md:text-sm">
          <div className="p-2 md:p-3 space-y-1.5 md:space-y-2">
            {/* Header */}
            <div className="px-2 md:px-3 py-1.5 md:py-2 border-b border-purple-500/20">
              <p className="text-xs font-semibold text-purple-300 uppercase tracking-wider">Appear</p>
            </div>

            {/* Theme Options */}
            <div className="space-y-0.5 md:space-y-1">
              {themeList.map((t) => (
                <button
                  key={t.id}
                  onClick={() => {
                    changeTheme(t.id);
                    setIsOpen(false);
                  }}
                  className={`w-full flex items-center gap-2 px-2 md:px-3 py-1.5 md:py-2 rounded-lg transition-all duration-200 ${
                    theme === t.id
                      ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white shadow-lg shadow-purple-500/50'
                      : 'text-gray-300 hover:bg-purple-500/20'
                  }`}
                >
                  <span className="text-base md:text-lg flex-shrink-0">{t.icon}</span>
                  <div className="text-left flex-1 min-w-0">
                    <p className="font-semibold text-xs md:text-sm line-clamp-1">{t.name}</p>
                    <p className="text-xs text-gray-400 line-clamp-1">{t.description}</p>
                  </div>
                  {theme === t.id && (
                    <div className="w-1.5 h-1.5 md:w-2 md:h-2 rounded-full bg-white shadow-lg flex-shrink-0"></div>
                  )}
                </button>
              ))}
            </div>

            {/* Info */}
            <div className="px-2 md:px-3 py-1.5 md:py-2 border-t border-purple-500/20">
              <p className="text-xs text-gray-500 line-clamp-1">
                {theme === 'system' 
                  ? `Using ${actualTheme === 'dark' ? 'dark' : 'light'} mode (system)`
                  : `Using ${actualTheme} mode`
                }
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Click outside to close */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setIsOpen(false)}
        />
      )}
    </div>
  );
};

export default ThemeSwitcher;
