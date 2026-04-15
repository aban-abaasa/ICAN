import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';

const SignIn = ({ onSwitchToSignUp, onForgotPassword, onSuccess }) => {
  const { signIn, signInWithGoogle } = useAuth();
  const { actualTheme } = useTheme();
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    rememberMe: false
  });
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const isAuthenticating = loading || googleLoading;

  const themeStyles = {
    dark: {
      pageBg: 'linear-gradient(135deg, #0b1020 0%, #111827 55%, #1f1147 100%)',
      cardBg: 'rgba(17, 24, 39, 0.84)',
      cardBorder: 'rgba(148, 163, 184, 0.30)',
      cardShadow: '0 28px 64px rgba(2, 6, 23, 0.55)',
      text: '#f8fafc',
      muted: '#cbd5e1',
      label: '#cbd5e1',
      inputBg: 'rgba(30, 41, 59, 0.72)',
      inputBorder: 'rgba(100, 116, 139, 0.70)',
      inputText: '#f8fafc',
      inputPlaceholder: 'placeholder-slate-400',
      primaryGradient: 'linear-gradient(90deg, #8b5cf6 0%, #ec4899 100%)',
      primaryShadow: '0 10px 28px rgba(168, 85, 247, 0.38)',
      primaryText: '#ffffff',
      secondaryBg: 'rgba(255, 255, 255, 0.92)',
      secondaryText: '#111827',
      walletBg: 'linear-gradient(90deg, rgba(251, 146, 60, 0.30), rgba(250, 204, 21, 0.26))',
      walletBorder: 'rgba(251, 146, 60, 0.55)',
      link: '#a78bfa',
      linkHover: '#c4b5fd',
      divider: 'rgba(148, 163, 184, 0.45)'
    },
    light: {
      pageBg: 'linear-gradient(135deg, #e2e8f0 0%, #f8fafc 50%, #dbeafe 100%)',
      cardBg: 'rgba(255, 255, 255, 0.90)',
      cardBorder: 'rgba(148, 163, 184, 0.65)',
      cardShadow: '0 24px 54px rgba(148, 163, 184, 0.35)',
      text: '#0f172a',
      muted: '#475569',
      label: '#334155',
      inputBg: 'rgba(255, 255, 255, 0.96)',
      inputBorder: 'rgba(148, 163, 184, 0.75)',
      inputText: '#0f172a',
      inputPlaceholder: 'placeholder-slate-500',
      primaryGradient: 'linear-gradient(90deg, #2563eb 0%, #7c3aed 100%)',
      primaryShadow: '0 10px 22px rgba(59, 130, 246, 0.32)',
      primaryText: '#ffffff',
      secondaryBg: 'rgba(248, 250, 252, 0.98)',
      secondaryText: '#0f172a',
      walletBg: 'linear-gradient(90deg, rgba(251, 146, 60, 0.16), rgba(34, 197, 94, 0.14))',
      walletBorder: 'rgba(249, 115, 22, 0.36)',
      link: '#4f46e5',
      linkHover: '#4338ca',
      divider: 'rgba(148, 163, 184, 0.65)'
    },
    purple: {
      pageBg: 'linear-gradient(135deg, #1e1b4b 0%, #4c1d95 55%, #581c87 100%)',
      cardBg: 'rgba(45, 27, 94, 0.86)',
      cardBorder: 'rgba(192, 132, 252, 0.45)',
      cardShadow: '0 28px 64px rgba(45, 27, 94, 0.62)',
      text: '#f8f7ff',
      muted: '#ddd6fe',
      label: '#e9d5ff',
      inputBg: 'rgba(88, 28, 135, 0.45)',
      inputBorder: 'rgba(192, 132, 252, 0.55)',
      inputText: '#f8f7ff',
      inputPlaceholder: 'placeholder-purple-200',
      primaryGradient: 'linear-gradient(90deg, #c084fc 0%, #f472b6 100%)',
      primaryShadow: '0 10px 28px rgba(192, 132, 252, 0.38)',
      primaryText: '#1f1136',
      secondaryBg: 'rgba(248, 247, 255, 0.96)',
      secondaryText: '#2e1065',
      walletBg: 'linear-gradient(90deg, rgba(192, 132, 252, 0.28), rgba(248, 113, 113, 0.22))',
      walletBorder: 'rgba(216, 180, 254, 0.55)',
      link: '#f0abfc',
      linkHover: '#f5d0fe',
      divider: 'rgba(192, 132, 252, 0.45)'
    },
    green: {
      pageBg: 'linear-gradient(135deg, #052e2b 0%, #14532d 50%, #064e3b 100%)',
      cardBg: 'rgba(19, 78, 74, 0.86)',
      cardBorder: 'rgba(110, 231, 183, 0.46)',
      cardShadow: '0 28px 64px rgba(4, 47, 46, 0.60)',
      text: '#f0fdf4',
      muted: '#d1fae5',
      label: '#bbf7d0',
      inputBg: 'rgba(6, 78, 59, 0.52)',
      inputBorder: 'rgba(110, 231, 183, 0.52)',
      inputText: '#f0fdf4',
      inputPlaceholder: 'placeholder-emerald-200',
      primaryGradient: 'linear-gradient(90deg, #34d399 0%, #22d3ee 100%)',
      primaryShadow: '0 10px 28px rgba(52, 211, 153, 0.34)',
      primaryText: '#052e16',
      secondaryBg: 'rgba(240, 253, 244, 0.95)',
      secondaryText: '#064e3b',
      walletBg: 'linear-gradient(90deg, rgba(74, 222, 128, 0.24), rgba(45, 212, 191, 0.22))',
      walletBorder: 'rgba(110, 231, 183, 0.55)',
      link: '#6ee7b7',
      linkHover: '#a7f3d0',
      divider: 'rgba(110, 231, 183, 0.45)'
    },
    ocean: {
      pageBg: 'linear-gradient(135deg, #082f49 0%, #0c4a6e 52%, #164e63 100%)',
      cardBg: 'rgba(22, 78, 99, 0.86)',
      cardBorder: 'rgba(125, 211, 252, 0.50)',
      cardShadow: '0 28px 64px rgba(8, 47, 73, 0.62)',
      text: '#f0f9ff',
      muted: '#dbeafe',
      label: '#bae6fd',
      inputBg: 'rgba(8, 47, 73, 0.55)',
      inputBorder: 'rgba(125, 211, 252, 0.52)',
      inputText: '#f0f9ff',
      inputPlaceholder: 'placeholder-sky-200',
      primaryGradient: 'linear-gradient(90deg, #38bdf8 0%, #6366f1 100%)',
      primaryShadow: '0 10px 28px rgba(56, 189, 248, 0.34)',
      primaryText: '#082f49',
      secondaryBg: 'rgba(240, 249, 255, 0.95)',
      secondaryText: '#0f172a',
      walletBg: 'linear-gradient(90deg, rgba(56, 189, 248, 0.24), rgba(99, 102, 241, 0.22))',
      walletBorder: 'rgba(125, 211, 252, 0.55)',
      link: '#7dd3fc',
      linkHover: '#bae6fd',
      divider: 'rgba(125, 211, 252, 0.45)'
    }
  };

  const palette = themeStyles[actualTheme] || themeStyles.dark;

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
    setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    const normalizedEmail = String(formData.email || '').trim().toLowerCase();
    const password = formData.password;
    
    if (!normalizedEmail || !password) {
      setError('Please enter both email and password');
      return;
    }

    setLoading(true);
    setError('');

    try {
      await signIn(normalizedEmail, password);
      if (onSuccess) {
        onSuccess();
      }
    } catch (err) {
      console.error('Sign in error:', err);
      const message = String(err?.message || '').toLowerCase();
      if (message.includes('invalid login credentials')) {
        setError('Invalid email or password. Also confirm this account exists in the current Supabase project and has completed email verification.');
      } else {
        setError(err.message || 'Sign in failed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ backgroundImage: palette.pageBg }}>
      <div
        className={`max-w-md w-full backdrop-blur-xl rounded-[30px] shadow-2xl p-8 border transition-all duration-500 ${isAuthenticating ? 'scale-[1.01]' : ''}`}
        style={{
          backgroundColor: palette.cardBg,
          borderColor: isAuthenticating ? palette.link : palette.cardBorder,
          boxShadow: palette.cardShadow
        }}
      >
        <style>{`
          @keyframes logoFloat {
            0%, 100% { transform: translateY(0px) scale(1); }
            50% { transform: translateY(-5px) scale(1.015); }
          }

          @keyframes logoPulse {
            0%, 100% { transform: scale(1); filter: brightness(1); }
            50% { transform: scale(1.08); filter: brightness(1.15); }
          }

          @keyframes logoSpin {
            from { rotate: 0deg; }
            to { rotate: 360deg; }
          }
        `}</style>

        {/* Logo/Brand */}
        <div className="text-center mb-8">
          <div className={`relative w-24 h-24 mx-auto mb-4 rounded-2xl overflow-hidden flex items-center justify-center transition-all duration-500 ${
            isAuthenticating
              ? 'bg-gradient-to-r from-blue-500 to-purple-500 shadow-lg shadow-blue-500/50'
              : 'bg-gradient-to-r from-purple-600 to-pink-600 shadow-lg shadow-purple-500/30'
          }`}>
            {isAuthenticating && (
              <div className="absolute inset-0 bg-blue-500 opacity-30 blur-lg animate-pulse"></div>
            )}
            <img
              src={new URL('../../IcanEra.png', import.meta.url).href}
              alt="IcanEra logo"
              className="relative z-10 w-20 h-20 object-contain filter drop-shadow-lg"
              style={{
                animation: isAuthenticating
                  ? 'logoPulse 1.2s ease-in-out infinite'
                  : 'logoFloat 4.5s ease-in-out infinite'
              }}
              onError={(e) => {
                e.target.style.display = 'none';
                e.target.parentElement.textContent = '💎';
                e.target.parentElement.style.fontSize = '3rem';
              }}
            />
          </div>
          <h2 className="text-2xl font-bold" style={{ color: palette.text }}>Welcome Back</h2>
          <p className="text-sm mt-2 transition-all duration-300" style={{ color: palette.muted }}>
            {isAuthenticating ? 'Authenticating with IcanEra...' : 'Sign in to IcanEra'}
          </p>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-xl">
            <p className="text-red-400 text-sm text-center">{error}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Email */}
          <div>
            <label className="block text-sm font-medium mb-2" style={{ color: palette.label }}>Email Address</label>
            <input
              type="email"
              name="email"
              value={formData.email}
              onChange={handleChange}
              className={`w-full px-4 py-3 border rounded-xl focus:outline-none focus:ring-2 focus:border-transparent transition-all ${palette.inputPlaceholder}`}
              placeholder="you@example.com"
              style={{
                backgroundColor: palette.inputBg,
                borderColor: palette.inputBorder,
                color: palette.inputText,
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)'
              }}
              required
              autoComplete="email"
            />
          </div>

          {/* Password */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium" style={{ color: palette.label }}>Password</label>
              <button
                type="button"
                onClick={onForgotPassword}
                className="text-sm transition-colors"
                style={{ color: palette.link }}
                onMouseEnter={(e) => { e.currentTarget.style.color = palette.linkHover; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = palette.link; }}
              >
                Forgot password?
              </button>
            </div>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                name="password"
                value={formData.password}
                onChange={handleChange}
                className={`w-full px-4 py-3 pr-16 border rounded-xl focus:outline-none focus:ring-2 focus:border-transparent transition-all ${palette.inputPlaceholder}`}
                placeholder="Enter your password"
                style={{
                  backgroundColor: palette.inputBg,
                  borderColor: palette.inputBorder,
                  color: palette.inputText,
                  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)'
                }}
                required
                autoComplete="current-password"
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold transition-colors"
                style={{ color: palette.link }}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>

          {/* Remember Me */}
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              name="rememberMe"
              checked={formData.rememberMe}
              onChange={handleChange}
              className="w-5 h-5 rounded border focus:ring-2 focus:ring-offset-0"
              style={{
                accentColor: palette.link,
                borderColor: palette.inputBorder,
                backgroundColor: palette.inputBg
              }}
            />
            <span className="text-sm" style={{ color: palette.muted }}>Remember me for 30 days</span>
          </label>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 px-4 font-semibold rounded-xl transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            style={{
              backgroundImage: palette.primaryGradient,
              color: palette.primaryText,
              boxShadow: palette.primaryShadow
            }}
          >
            {loading ? (
              <>
                <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Entering IcanEra...
              </>
            ) : (
              <>
                Sign In
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </>
            )}
          </button>
        </form>

        {/* Divider */}
        <div className="relative my-6">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t" style={{ borderColor: palette.divider }}></div>
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="px-4" style={{ backgroundColor: palette.cardBg, color: palette.muted }}>Or continue with</span>
          </div>
        </div>

        {/* Google Sign In Button - Automatically checks for country after login */}
        <button
          type="button"
          disabled={googleLoading}
          className="w-full py-3 px-4 font-medium rounded-xl transition-all duration-200 flex items-center justify-center gap-3 disabled:opacity-50"
          style={{
            backgroundColor: palette.secondaryBg,
            color: palette.secondaryText,
            border: `1px solid ${palette.cardBorder}`
          }}
          onClick={async () => {
            setGoogleLoading(true);
            setError('');
            try {
              // signInWithGoogle redirects to OAuth, then CountryCheckMiddleware
              // will automatically verify if user has country_code set in user_accounts
              // If not set, CountrySetup modal appears - user CANNOT proceed without setting country
              await signInWithGoogle();
            } catch (err) {
              setError(err.message || 'Failed to sign in with Google');
              setGoogleLoading(false);
            }
          }}
        >
          {googleLoading ? (
            <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : (
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
          )}
          Continue with Google
        </button>

        {/* Wallet Login Button */}
        <button
          type="button"
          className="w-full mt-3 py-3 px-4 font-medium rounded-xl transition-all duration-200 flex items-center justify-center gap-3"
          style={{
            backgroundImage: palette.walletBg,
            border: `1px solid ${palette.walletBorder}`,
            color: palette.text
          }}
          onClick={() => {
            alert('Wallet login coming soon! Connect your Web3 wallet for passwordless authentication.');
          }}
        >
          <span className="text-xl">⛓️</span>
          Connect Wallet
        </button>

        {/* Sign Up Link */}
        <div className="mt-6 text-center">
          <p className="text-sm" style={{ color: palette.muted }}>
            Don't have an account?{' '}
            <button
              onClick={onSwitchToSignUp}
              className="font-medium transition-colors"
              style={{ color: palette.link }}
              onMouseEnter={(e) => { e.currentTarget.style.color = palette.linkHover; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = palette.link; }}
            >
              Create Account
            </button>
          </p>
        </div>

        {/* Trust Indicators */}
        <div className="mt-8 pt-6 border-t" style={{ borderColor: palette.divider }}>
          <div className="flex items-center justify-center gap-4 text-xs" style={{ color: palette.muted }}>
            <div className="flex items-center gap-1">
              <svg className="w-4 h-4" style={{ color: '#22c55e' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
              <span>256-bit encryption</span>
            </div>
            <div className="flex items-center gap-1">
              <svg className="w-4 h-4" style={{ color: '#60a5fa' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              <span>Biometric ready</span>
            </div>
            <div className="flex items-center gap-1">
              <svg className="w-4 h-4" style={{ color: palette.link }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              <span>Blockchain verified</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SignIn;
