import { isDarkFamilyTheme } from '../../context/ThemeContext';

// One "classic edition" palette for the sign-in / create-account screens --
// ivory paper, ink and forest green by day; warm ink and amber by night --
// matching the landing page. Same keys the old per-theme palettes used, so
// SignIn, SignUp and ReferralCodeField consume it unchanged. Every colour is
// flat on purpose (the one-stop gradients below are solid fills) so buttons
// read as printed, not glowing.
const flat = (color) => `linear-gradient(${color}, ${color})`;

const LIGHT = {
  pageBg: flat('#f6f1e4'),
  cardBg: '#fffdf6',
  cardBorder: 'rgba(31, 26, 18, 0.65)',
  cardShadow: '6px 6px 0 0 rgba(31, 26, 18, 0.18)',
  text: '#1f1a12',
  muted: '#6b5f49',
  label: '#4a4132',
  inputBg: '#fffdf6',
  inputBorder: 'rgba(31, 26, 18, 0.45)',
  inputText: '#1f1a12',
  inputPlaceholder: 'placeholder-stone-400',
  primaryGradient: flat('#14532d'),
  primaryShadow: '4px 4px 0 0 rgba(31, 26, 18, 0.28)',
  primaryText: '#f6f1e4',
  secondaryBg: '#fffdf6',
  secondaryText: '#1f1a12',
  walletBg: flat('#f0e7cd'),
  walletBorder: 'rgba(138, 106, 31, 0.65)',
  link: '#14532d',
  linkHover: '#0f3d21',
  divider: 'rgba(31, 26, 18, 0.25)',
};

const DARK = {
  pageBg: flat('#0f0d0a'),
  cardBg: '#17130d',
  cardBorder: 'rgba(252, 211, 77, 0.45)',
  cardShadow: '6px 6px 0 0 rgba(0, 0, 0, 0.55)',
  text: '#f6f1e4',
  muted: '#bfb49a',
  label: '#fcd34d',
  inputBg: '#0f0d0a',
  inputBorder: 'rgba(252, 211, 77, 0.35)',
  inputText: '#f6f1e4',
  inputPlaceholder: 'placeholder-stone-500',
  primaryGradient: flat('#fcd34d'),
  primaryShadow: '4px 4px 0 0 rgba(0, 0, 0, 0.5)',
  primaryText: '#1f1a12',
  secondaryBg: '#17130d',
  secondaryText: '#f6f1e4',
  walletBg: flat('#211b10'),
  walletBorder: 'rgba(252, 211, 77, 0.5)',
  link: '#fcd34d',
  linkHover: '#fde68a',
  divider: 'rgba(252, 211, 77, 0.25)',
};

export const getClassicAuthPalette = (actualTheme) => (isDarkFamilyTheme(actualTheme) ? DARK : LIGHT);
export const classicAuthClass = (actualTheme) =>
  `ican-auth-classic ${isDarkFamilyTheme(actualTheme) ? 'ican-auth-dark' : 'ican-auth-light'}`;
