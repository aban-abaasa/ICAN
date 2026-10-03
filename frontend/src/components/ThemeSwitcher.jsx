import React, { useEffect, useState } from 'react';
import { useTheme, THEMES } from '../context/ThemeContext';
import { Check, ChevronDown, Palette } from 'lucide-react';

const ThemeSwitcher = () => {
  const { theme, changeTheme, actualTheme } = useTheme();
  const [isOpen, setIsOpen] = useState(false);

  const themeList = Object.values(THEMES);
  const currentTheme = THEMES[theme];

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKeyDown = (e) => { if (e.key === 'Escape') setIsOpen(false); };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen]);

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="inline-flex items-center space-x-1.5 sm:space-x-2 px-1.5 sm:px-3 py-2 rounded-lg hover:bg-purple-500/20 transition-all duration-200 group"
        title="Switch theme"
        aria-label="Theme switcher"
        aria-haspopup="menu"
        aria-expanded={isOpen}
      >
        <Palette className="w-5 h-5 text-yellow-400 group-hover:text-yellow-300 transition-colors" />
        <span className="text-sm font-medium hidden xl:inline max-w-20 truncate">
          {currentTheme.name}
        </span>
        <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {/* Classic dropdown: small type, one plain row per theme, a tick on the current one */}
      {isOpen && (
        <div className="icn-menu icn-menu-compact absolute right-0 top-full mt-2 z-50" role="menu" aria-label="Appearance">
          <div className="icn-menu-head">
            <p className="icn-menu-eyebrow">Appearance</p>
          </div>

          <div className="icn-menu-body">
            {themeList.map((t) => {
              const selected = theme === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={selected}
                  title={t.description}
                  className={`icn-menu-item ${selected ? 'is-active' : ''}`}
                  onClick={() => {
                    changeTheme(t.id);
                    setIsOpen(false);
                  }}
                >
                  <span>{t.name}</span>
                  {selected && <Check className="icn-menu-check" aria-hidden="true" />}
                </button>
              );
            })}
          </div>

          <p className="icn-menu-foot">
            {theme === 'system'
              ? `Using ${actualTheme === 'dark' ? 'dark' : 'light'} mode (system)`
              : `Using ${actualTheme} mode`}
          </p>
        </div>
      )}

      {/* Click outside to close */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40"
          aria-hidden="true"
          onClick={() => setIsOpen(false)}
        />
      )}
    </div>
  );
};

export default ThemeSwitcher;
