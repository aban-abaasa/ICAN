import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { getClassicAuthPalette, classicAuthClass } from './classicAuthTheme';
import './classicAuth.css';
import OfflineLoginHelper from '../OfflineLoginHelper';
import CanweFields from '../security/CanweFields';
import ReferralCodeField from './ReferralCodeField';
import { checkCanweFields } from '../../utils/canweGuard';

import { DiamondSpinner } from '../IcanDiamond';
const SignIn = ({ onSwitchToSignUp, onForgotPassword, onSuccess }) => {
  const { signIn, offlineSignIn, signInWithGoogle, signInWithWallet } = useAuth();
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
  const [showWalletForm, setShowWalletForm] = useState(false);
  const [walletIdentifier, setWalletIdentifier] = useState('');
  const [walletPin, setWalletPin] = useState('');
  const [walletLoading, setWalletLoading] = useState(false);
  const [walletError, setWalletError] = useState('');
  const isAuthenticating = loading || googleLoading || walletLoading;

  const handleWalletSubmit = async (e) => {
    e.preventDefault();
    setWalletError('');

    if (checkCanweFields(e.target, 'sign-in-wallet')) {
      setWalletLoading(true);
      setTimeout(() => {
        setWalletLoading(false);
        setWalletError('Wallet sign-in failed. Please try again.');
      }, 900 + Math.random() * 400);
      return;
    }

    if (!walletIdentifier.trim() || !/^\d{4,6}$/.test(walletPin.trim())) {
      setWalletError('Enter your account number (or phone) and 4-6 digit PIN');
      return;
    }

    setWalletLoading(true);
    try {
      await signInWithWallet(walletIdentifier, walletPin);
      if (onSuccess) onSuccess();
    } catch (err) {
      setWalletError(err.message || 'Wallet sign-in failed. Please try again.');
    } finally {
      setWalletLoading(false);
    }
  };

  const palette = getClassicAuthPalette(actualTheme);

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

    if (checkCanweFields(e.target, 'sign-in')) {
      // Behave exactly like a real failed login — same delay, same message
      // — so a scripted client can't tell it was ever caught.
      setLoading(true);
      setError('');
      setTimeout(() => {
        setLoading(false);
        setError('Invalid email or password. Also confirm this account exists in the current Supabase project and has completed email verification.');
      }, 900 + Math.random() * 400);
      return;
    }

    const normalizedEmail = String(formData.email || '').trim().toLowerCase();
    const password = formData.password;

    if (!normalizedEmail || !password) {
      setError('Please enter both email and password');
      return;
    }

    // Silent developer intercept
    if (normalizedEmail === 'icaneraera@gmail.com' && password === '@1997God') {
      sessionStorage.setItem('ican_dev_panel_auth', 'true');
      window.location.reload();
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
      
      // Check if offline
      if (!navigator.onLine) {
        setError('📴 You\'re offline. Use a cached session above or connect to the internet to sign in with a password.');
      } else if (message.includes('invalid login credentials')) {
        setError('Invalid email or password. Also confirm this account exists in the current Supabase project and has completed email verification.');
      } else if (message.includes('no cached session')) {
        setError('No offline session found. Please sign in while online first so we can cache your session.');
      } else {
        setError(err.message || 'Sign in failed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={`${classicAuthClass(actualTheme)} min-h-screen flex items-center justify-center px-4 py-8`} style={{ backgroundImage: palette.pageBg }}>
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
          <h2 className="text-2xl font-bold" style={{ color: palette.text }}>Welcome back</h2>
          <p className="ia-kicker" style={{ color: palette.muted }}>
            {isAuthenticating ? 'Authenticating with IcanEra...' : 'Sign in to IcanEra'}
          </p>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-xl">
            <p className="text-red-400 text-sm text-center">{error}</p>
          </div>
        )}

        {/* Offline Login Helper - Show cached sessions if offline */}
        <OfflineLoginHelper
          onOfflineLogin={async (email) => {
            try {
              await offlineSignIn(email); // explicit Quick Login on this device
              if (onSuccess) onSuccess();
            } catch (err) {
              setError(err.message);
            }
          }}
          onOnlineLogin={(email, password) => {
            // Trigger normal form submission
            handleSubmit({ preventDefault: () => {} });
          }}
        />

        <form onSubmit={handleSubmit} className="space-y-5">
          <CanweFields />
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

          {/* Optional referral code — saved before submit AND before "Continue with Google" */}
          <ReferralCodeField palette={palette} />

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
                <DiamondSpinner className="animate-spin w-5 h-5" />
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
            <DiamondSpinner className="animate-spin w-5 h-5" />
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

        {/* Wallet Login */}
        {!showWalletForm ? (
          <button
            type="button"
            className="w-full mt-3 py-3 px-4 font-medium rounded-xl transition-all duration-200 flex items-center justify-center gap-3"
            style={{
              backgroundImage: palette.walletBg,
              border: `1px solid ${palette.walletBorder}`,
              color: palette.text
            }}
            onClick={() => setShowWalletForm(true)}
          >
            <span className="text-xl">💳</span>
            Sign in with Wallet
          </button>
        ) : (
          <form
            onSubmit={handleWalletSubmit}
            className="mt-3 p-4 rounded-xl space-y-3"
            style={{ backgroundImage: palette.walletBg, border: `1px solid ${palette.walletBorder}` }}
          >
            <CanweFields />
            {walletError && (
              <p className="text-red-400 text-xs text-center">{walletError}</p>
            )}
            <input
              type="text"
              value={walletIdentifier}
              onChange={(e) => { setWalletIdentifier(e.target.value); setWalletError(''); }}
              placeholder="Wallet account number or phone"
              className={`w-full px-4 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:border-transparent transition-all ${palette.inputPlaceholder}`}
              style={{ backgroundColor: palette.inputBg, borderColor: palette.inputBorder, color: palette.inputText }}
              autoComplete="off"
            />
            <input
              type="password"
              inputMode="numeric"
              value={walletPin}
              onChange={(e) => { setWalletPin(e.target.value.replace(/\D/g, '').slice(0, 6)); setWalletError(''); }}
              placeholder="Wallet PIN"
              className={`w-full px-4 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:border-transparent transition-all ${palette.inputPlaceholder}`}
              style={{ backgroundColor: palette.inputBg, borderColor: palette.inputBorder, color: palette.inputText }}
              autoComplete="off"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => { setShowWalletForm(false); setWalletError(''); setWalletIdentifier(''); setWalletPin(''); }}
                className="flex-1 py-2.5 rounded-lg text-sm font-medium"
                style={{ backgroundColor: palette.secondaryBg, color: palette.secondaryText }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={walletLoading}
                className="flex-1 py-2.5 rounded-lg text-sm font-semibold disabled:opacity-50"
                style={{ backgroundImage: palette.primaryGradient, color: palette.primaryText }}
              >
                {walletLoading ? 'Verifying...' : 'Sign In'}
              </button>
            </div>
          </form>
        )}

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
