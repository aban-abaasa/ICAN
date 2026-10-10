import React, { useEffect, useState } from 'react';
import { useTheme, THEMES } from '../context/ThemeContext';
import { Check, ChevronDown, Palette } from 'lucide-react';
import AmbientToggle from './AmbientToggle';

// Shown up front; every other theme folds under "More themes".
const MAIN_THEME_IDS = ['system', 'light', 'dark'];

const ThemeSwitcher = () => {
  const { theme, changeTheme, actualTheme } = useTheme();
  const [isOpen, setIsOpen] = useState(false);
  const [showMore, setShowMore] = useState(false);

  const themeList = Object.values(THEMES);
  const mainThemes = themeList.filter((t) => MAIN_THEME_IDS.includes(t.id));
  const currentTheme = THEMES[theme];
  // A current theme that isn't one of the main three is pinned under them so it
  // stays visible (ticked); only the remaining themes fold under "More themes".
  const pinnedTheme = MAIN_THEME_IDS.includes(theme) ? null : currentTheme;
  const moreThemes = themeList.filter((t) => !MAIN_THEME_IDS.includes(t.id) && t.id !== theme);

  const close = () => {
    setIsOpen(false);
    setShowMore(false);
  };

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
        setShowMore(false);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen]);

  const renderItem = (t) => {
    const selected = theme === t.id;
    return (
      <button
        key={t.id}
        type="button"
        role="menuitemradio"
        aria-checked={selected}
        title={t.description}
        className={`icn-tm-item ${selected ? 'is-active' : ''}`}
        onClick={() => {
          changeTheme(t.id);
          close();
        }}
      >
        <span className="icn-tm-name">{t.name}</span>
        {selected && <Check className="icn-tm-check" aria-hidden="true" />}
      </button>
    );
  };

  return (
    <div className="relative inline-flex items-center">
      {/* One tap turns the blockchain background on or off (fine-tuning lives in Settings > Appearance). */}
      <AmbientToggle
        className="inline-flex items-center px-1.5 sm:px-2 py-2 rounded-lg hover:bg-purple-500/20 transition-all duration-200"
        iconClass="text-yellow-400"
        offIconClass="text-gray-400"
      />
      <button
        onClick={() => (isOpen ? close() : setIsOpen(true))}
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

      {/* Classic dropdown: small type, tight rows, main themes up front, the rest folded away */}
      {isOpen && (
        <div className="icn-tm absolute right-0 top-full mt-1.5 z-50" role="menu" aria-label="Appearance">
          <p className="icn-tm-title">Appearance</p>

          <div className="icn-tm-list">
            {mainThemes.map(renderItem)}
            {pinnedTheme && renderItem(pinnedTheme)}

            <div className="icn-tm-sep" role="separator" />

            <button
              type="button"
              role="menuitem"
              aria-expanded={showMore}
              className="icn-tm-item"
              onClick={() => setShowMore((v) => !v)}
            >
              <span className="icn-tm-name">More themes</span>
              <ChevronDown className={`icn-tm-chev ${showMore ? 'is-open' : ''}`} aria-hidden="true" />
            </button>

            {showMore && (
              <div className="icn-tm-sub" role="group" aria-label="More themes">
                {moreThemes.map(renderItem)}
              </div>
            )}
          </div>

          {theme === 'system' && (
            <p className="icn-tm-foot">Following device: {actualTheme === 'dark' ? 'dark' : 'light'}</p>
          )}
        </div>
      )}

      {/* Click outside to close */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40"
          aria-hidden="true"
          onClick={close}
        />
      )}
    </div>
  );
};

export default ThemeSwitcher;
