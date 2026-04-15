import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { CountryService } from '../../services/countryService';
import IcanEraLogo from '../../IcanEra.png';

const SignUp = ({ onSwitchToSignIn, onSuccess }) => {
  const { signUp } = useAuth();
  const { actualTheme } = useTheme();
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    confirmPassword: '',
    fullName: '',
    phone: '',
    countryCode: 'US', // NEW: Country selection
    operatingMode: 'SE', // 'SE' = Salaried Employee, 'BO' = Business Owner
    financialGoal: '',
    riskTolerance: 'moderate',
    walletAddress: '',
    blockchainConsent: false,
    termsAccepted: false
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [regions] = useState(CountryService.getRegions());
  const [selectedRegion, setSelectedRegion] = useState('East Africa');
  const [showCountrySelector, setShowCountrySelector] = useState(false);

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
      link: '#7dd3fc',
      linkHover: '#bae6fd',
      divider: 'rgba(125, 211, 252, 0.45)'
    }
  };

  const palette = themeStyles[actualTheme] || themeStyles.dark;
  const inputClassName = `w-full px-4 py-3 border rounded-xl focus:outline-none focus:ring-2 focus:border-transparent transition-all ${palette.inputPlaceholder}`;
  const inputStyle = {
    backgroundColor: palette.inputBg,
    borderColor: palette.inputBorder,
    color: palette.inputText,
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)'
  };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
    setError('');
  };

  const validateForm = () => {
    if (!formData.email || !formData.password || !formData.fullName || !formData.countryCode) {
      setError('Please fill in all required fields including country selection');
      return false;
    }
    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match');
      return false;
    }
    if (formData.password.length < 8) {
      setError('Password must be at least 8 characters long');
      return false;
    }
    if (!formData.termsAccepted) {
      setError('Please accept the terms and conditions');
      return false;
    }
    // Validate wallet address if provided
    if (formData.walletAddress && !isValidWalletAddress(formData.walletAddress)) {
      setError('Invalid wallet address format');
      return false;
    }
    return true;
  };

  const isValidWalletAddress = (address) => {
    // Ethereum/Polygon/BSC
    if (/^0x[a-fA-F0-9]{40}$/.test(address)) return true;
    // Solana
    if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return true;
    return false;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!validateForm()) return;

    setLoading(true);
    setError('');

    try {
      const result = await signUp(formData.email, formData.password, formData.fullName);
      
      if (result?.needsEmailConfirmation) {
        setSuccess(true);
      } else if (result && onSuccess) {
        onSuccess();
      }
    } catch (err) {
      console.error('Signup error:', err);
      setError(err.message || 'Failed to create account. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4" style={{ backgroundImage: palette.pageBg }}>
        <div className="max-w-md w-full backdrop-blur-xl rounded-[30px] shadow-2xl p-8 border" style={{ backgroundColor: palette.cardBg, borderColor: palette.cardBorder, boxShadow: palette.cardShadow }}>
          <div className="text-center">
            <div className="w-20 h-20 bg-gradient-to-r from-green-500 to-emerald-500 rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg shadow-green-500/30">
              <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold mb-2" style={{ color: palette.text }}>Check Your Email</h2>
            <p className="mb-6" style={{ color: palette.muted }}>
              We've sent a confirmation link to <span className="font-medium" style={{ color: palette.link }}>{formData.email}</span>
            </p>
            <p className="text-sm mb-6" style={{ color: palette.muted }}>
              Click the link in the email to verify your account and start building your capital empire.
            </p>
            <button
              onClick={() => setSuccess(false)}
              className="text-sm font-medium"
              style={{ color: palette.link }}
            >
              Didn't receive email? Try again
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-8" style={{ backgroundImage: palette.pageBg }}>
      <div className="max-w-md w-full backdrop-blur-xl rounded-[30px] shadow-2xl p-8 border" style={{ backgroundColor: palette.cardBg, borderColor: palette.cardBorder, boxShadow: palette.cardShadow }}>
        {/* Logo/Brand */}
        <div className="text-center mb-8">
          <div className={`w-20 h-20 mx-auto mb-4 rounded-2xl flex items-center justify-center relative transition-all duration-500 overflow-hidden ${
            loading
              ? 'bg-gradient-to-r from-blue-500 to-purple-500 shadow-lg shadow-blue-500/50 animate-spin'
              : 'bg-gradient-to-r from-purple-600 to-pink-600 shadow-lg shadow-purple-500/30'
          }`} style={{
            animation: loading ? 'spin 2s linear infinite' : 'logoFloat 4.5s ease-in-out infinite'
          }}>
            {loading && (
              <div className="absolute inset-0 bg-blue-500 rounded-2xl opacity-30 blur-lg animate-pulse"></div>
            )}
            <img 
              src={IcanEraLogo} 
              alt="IcanEra Logo" 
              className="w-16 h-16 object-contain relative z-10 filter drop-shadow-lg"
              onError={(e) => {
                e.target.style.display = 'none';
                e.target.parentElement.textContent = '💎';
                e.target.parentElement.style.fontSize = '2rem';
              }}
            />
          </div>
          <h2 className="text-2xl font-bold flex items-center justify-center gap-2" style={{ color: palette.text }}>
            IcanEra
            {loading && (
              <div className="flex gap-1">
                <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '0s' }}></span>
                <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '0.15s' }}></span>
                <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '0.3s' }}></span>
              </div>
            )}
          </h2>
          <p className="text-sm mt-2" style={{ color: palette.muted }}>Transform volatility into global capital</p>
          {loading && <p className="text-xs animate-pulse mt-2" style={{ color: palette.link }}>Creating your account...</p>}
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-xl">
            <p className="text-red-400 text-sm text-center">{error}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Full Name */}
          <div>
            <label className="block text-sm font-medium mb-2" style={{ color: palette.label }}>Full Name *</label>
            <input
              type="text"
              name="fullName"
              value={formData.fullName}
              onChange={handleChange}
              className={inputClassName}
              style={inputStyle}
              placeholder="Enter your full name"
              required
            />
          </div>

          {/* Email */}
          <div>
            <label className="block text-sm font-medium mb-2" style={{ color: palette.label }}>Email Address *</label>
            <input
              type="email"
              name="email"
              value={formData.email}
              onChange={handleChange}
              className={inputClassName}
              style={inputStyle}
              placeholder="you@example.com"
              required
            />
          </div>

          {/* 🌍 Country Selection */}
          <div>
            <label className="block text-sm font-medium mb-2" style={{ color: palette.label }}>Country/Region * 🌍</label>
            <button
              type="button"
              onClick={() => setShowCountrySelector((prev) => !prev)}
              className="w-full flex items-center justify-between px-4 py-3 rounded-xl border-2 transition-all"
              style={{
                borderColor: palette.inputBorder,
                backgroundColor: palette.inputBg,
                color: palette.inputText
              }}
            >
              <div className="text-left">
                <p className="text-sm font-semibold" style={{ color: palette.text }}>
                  {CountryService.getCountry(formData.countryCode)?.flag} {CountryService.getCountry(formData.countryCode)?.name}
                </p>
                <p className="text-xs" style={{ color: palette.muted }}>
                  {selectedRegion} • {CountryService.getCurrencyCode(formData.countryCode)}
                </p>
              </div>
              <span className="text-sm font-bold" style={{ color: palette.link }}>
                {showCountrySelector ? 'Hide' : 'Choose'}
              </span>
            </button>

            {showCountrySelector && (
              <div className="mt-3">
                <div className="mb-3">
                  <div className="grid grid-cols-3 gap-2 mb-3">
                    {regions.map(region => (
                      <button
                        key={region}
                        type="button"
                        onClick={() => setSelectedRegion(region)}
                        className={`p-2 rounded-lg border text-sm transition-all ${
                          selectedRegion === region
                            ? 'text-white'
                            : ''
                        }`}
                        style={selectedRegion === region
                          ? { borderColor: palette.link, backgroundColor: 'rgba(124, 58, 237, 0.24)' }
                          : { borderColor: palette.inputBorder, backgroundColor: palette.inputBg, color: palette.muted }}
                      >
                        {region}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="max-h-56 overflow-y-auto space-y-1.5 pr-1">
                  {Object.entries(CountryService.getCountriesByRegion(selectedRegion)).map(([code, country]) => (
                    <button
                      key={code}
                      type="button"
                      onClick={() => {
                        setFormData(prev => ({ ...prev, countryCode: code }));
                        setShowCountrySelector(false);
                      }}
                      className={`w-full px-3 py-2 rounded-lg border transition-all text-left text-sm font-medium ${
                        formData.countryCode === code
                          ? 'text-white'
                          : ''
                      }`}
                      style={formData.countryCode === code
                        ? { borderColor: palette.link, backgroundColor: 'rgba(124, 58, 237, 0.24)' }
                        : { borderColor: palette.inputBorder, backgroundColor: palette.inputBg, color: palette.text }}
                    >
                      {country.name}
                    </button>
                  ))}
                </div>
                <div className="mt-2 p-2 rounded-lg border" style={{ backgroundColor: 'rgba(124, 58, 237, 0.12)', borderColor: 'rgba(124, 58, 237, 0.4)' }}>
                  <p className="text-xs" style={{ color: palette.link }}>
                    💎 Selected: {CountryService.getCountry(formData.countryCode)?.name} ({CountryService.getCurrencyCode(formData.countryCode)})
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Password */}
          <div>
            <label className="block text-sm font-medium mb-2" style={{ color: palette.label }}>Password *</label>
            <input
              type="password"
              name="password"
              value={formData.password}
              onChange={handleChange}
              className={inputClassName}
              style={inputStyle}
              placeholder="Minimum 8 characters"
              required
              minLength={8}
            />
          </div>

          {/* Confirm Password */}
          <div>
            <label className="block text-sm font-medium mb-2" style={{ color: palette.label }}>Confirm Password *</label>
            <input
              type="password"
              name="confirmPassword"
              value={formData.confirmPassword}
              onChange={handleChange}
              className={inputClassName}
              style={inputStyle}
              placeholder="Confirm your password"
              required
            />
          </div>

          {/* Operating Mode Selection */}
          <div>
            <label className="block text-sm font-medium mb-2" style={{ color: palette.label }}>I am a...</label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setFormData(prev => ({ ...prev, operatingMode: 'SE' }))}
                className={`p-3 rounded-lg border-2 transition-all ${
                  formData.operatingMode === 'SE'
                    ? 'text-white'
                    : ''
                }`}
                style={formData.operatingMode === 'SE'
                  ? { borderColor: palette.link, backgroundColor: 'rgba(124, 58, 237, 0.24)' }
                  : { borderColor: palette.inputBorder, backgroundColor: palette.inputBg, color: palette.muted }}
              >
                <div className="text-lg mb-1">💼</div>
                <div className="text-sm font-medium">Employee</div>
                <div className="text-xs opacity-70">Career Growth</div>
              </button>
              <button
                type="button"
                onClick={() => setFormData(prev => ({ ...prev, operatingMode: 'BO' }))}
                className={`p-3 rounded-lg border-2 transition-all ${
                  formData.operatingMode === 'BO'
                    ? 'text-white'
                    : ''
                }`}
                style={formData.operatingMode === 'BO'
                  ? { borderColor: palette.link, backgroundColor: 'rgba(124, 58, 237, 0.24)' }
                  : { borderColor: palette.inputBorder, backgroundColor: palette.inputBg, color: palette.muted }}
              >
                <div className="text-lg mb-1">🚀</div>
                <div className="text-sm font-medium">Business Owner</div>
                <div className="text-xs opacity-70">Scale & Contracts</div>
              </button>
            </div>
          </div>

          {/* Advanced Options Toggle */}
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-2 text-sm transition-colors"
            style={{ color: palette.link }}
          >
            <svg 
              className={`w-4 h-4 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} 
              fill="none" 
              stroke="currentColor" 
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
            {showAdvanced ? 'Hide' : 'Show'} Blockchain Options
          </button>

          {/* Advanced/Blockchain Options */}
          {showAdvanced && (
            <div className="space-y-4 p-4 rounded-lg border" style={{ backgroundColor: palette.inputBg, borderColor: palette.inputBorder }}>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 bg-gradient-to-r from-orange-500 to-yellow-500 rounded-lg flex items-center justify-center">
                  <span className="text-sm">⛓️</span>
                </div>
                <div>
                  <p className="text-white text-sm font-medium">Blockchain Integration</p>
                  <p className="text-xs" style={{ color: palette.muted }}>Connect your wallet for enhanced features</p>
                </div>
              </div>

              {/* Wallet Address */}
              <div>
                <label className="block text-sm font-medium mb-2" style={{ color: palette.label }}>
                  Wallet Address (Optional)
                </label>
                <input
                  type="text"
                  name="walletAddress"
                  value={formData.walletAddress}
                  onChange={handleChange}
                  className={`${inputClassName} font-mono text-sm`}
                  style={inputStyle}
                  placeholder="0x... or Solana address"
                />
                <p className="text-xs mt-1" style={{ color: palette.muted }}>
                  Supports Ethereum, Polygon, BSC, and Solana
                </p>
              </div>

              {/* Blockchain Consent */}
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  name="blockchainConsent"
                  checked={formData.blockchainConsent}
                  onChange={handleChange}
                  className="w-5 h-5 mt-0.5 rounded border focus:ring-2 focus:ring-offset-0"
                  style={{ accentColor: palette.link, borderColor: palette.inputBorder, backgroundColor: palette.inputBg }}
                />
                <span className="text-sm" style={{ color: palette.muted }}>
                  I consent to storing a hash of my profile data on-chain for verification and cross-app integration
                </span>
              </label>

              {/* Risk Tolerance */}
              <div>
                <label className="block text-sm font-medium mb-2" style={{ color: palette.label }}>Risk Tolerance</label>
                <select
                  name="riskTolerance"
                  value={formData.riskTolerance}
                  onChange={handleChange}
                  className="w-full px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:border-transparent transition-all"
                  style={inputStyle}
                >
                  <option value="conservative">Conservative - Capital Preservation</option>
                  <option value="moderate">Moderate - Balanced Growth</option>
                  <option value="aggressive">Aggressive - Maximum Growth</option>
                </select>
              </div>
            </div>
          )}

          {/* Terms & Conditions */}
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              name="termsAccepted"
              checked={formData.termsAccepted}
              onChange={handleChange}
              className="w-5 h-5 mt-0.5 rounded border focus:ring-2 focus:ring-offset-0"
              style={{ accentColor: palette.link, borderColor: palette.inputBorder, backgroundColor: palette.inputBg }}
              required
            />
            <span className="text-sm" style={{ color: palette.muted }}>
              I agree to the{' '}
              <a href="/terms" style={{ color: palette.link }}>Terms of Service</a>
              {' '}and{' '}
              <a href="/privacy" style={{ color: palette.link }}>Privacy Policy</a>
            </span>
          </label>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 px-4 font-semibold rounded-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            style={{ backgroundImage: palette.primaryGradient, color: palette.primaryText, boxShadow: palette.primaryShadow }}
          >
            {loading ? (
              <>
                <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Creating Account...
              </>
            ) : (
              <>
                Create Account
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </>
            )}
          </button>
        </form>

        {/* Sign In Link */}
        <div className="mt-6 text-center">
          <p className="text-sm" style={{ color: palette.muted }}>
            Already have an account?{' '}
            <button
              onClick={onSwitchToSignIn}
              className="font-medium transition-colors"
              style={{ color: palette.link }}
            >
              Sign In
            </button>
          </p>
        </div>

        {/* Features Preview */}
        <div className="mt-8 pt-6 border-t" style={{ borderColor: palette.divider }}>
          <p className="text-xs text-center mb-3" style={{ color: palette.muted }}>Unlock these features:</p>
          <div className="grid grid-cols-4 gap-2 text-center">
            {[
              { icon: '📊', label: 'Velocity Engine' },
              { icon: '🛡️', label: 'Treasury Guardian' },
              { icon: '🌍', label: 'Global Navigator' },
              { icon: '⚡', label: 'Prosperity AI' }
            ].map((feature, i) => (
              <div key={i} className="p-2">
                <div className="text-lg">{feature.icon}</div>
                <div className="text-xs" style={{ color: palette.muted }}>{feature.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes spin {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }

        @keyframes logoFloat {
          0%, 100% {
            transform: translateY(0px);
          }
          50% {
            transform: translateY(-8px);
          }
        }
      `}</style>
    </div>
  );
};

export default SignUp;
