import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';

const SignUp = ({ onSwitchToSignIn, onSuccess }) => {
  const { signUp } = useAuth();
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    confirmPassword: '',
    fullName: '',
    phone: '',
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

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
    setError('');
  };

  const validateForm = () => {
    if (!formData.email || !formData.password || !formData.fullName) {
      setError('Please fill in all required fields');
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
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 px-4">
        <div className="max-w-md w-full bg-slate-800/80 backdrop-blur-xl rounded-2xl shadow-2xl p-8 border border-purple-500/20">
          <div className="text-center">
            <div className="w-20 h-20 bg-gradient-to-r from-green-500 to-emerald-500 rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg shadow-green-500/30">
              <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">Check Your Email</h2>
            <p className="text-gray-400 mb-6">
              We've sent a confirmation link to <span className="text-purple-400 font-medium">{formData.email}</span>
            </p>
            <p className="text-sm text-gray-500 mb-6">
              Click the link in the email to verify your account and start building your capital empire.
            </p>
            <button
              onClick={() => setSuccess(false)}
              className="text-purple-400 hover:text-purple-300 text-sm font-medium"
            >
              Didn't receive email? Try again
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 px-4 py-8">
      <div className="max-w-md w-full bg-slate-800/80 backdrop-blur-xl rounded-2xl shadow-2xl p-8 border border-purple-500/20">
        {/* Logo/Brand */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-gradient-to-r from-purple-600 to-pink-600 rounded-xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-purple-500/30">
            <span className="text-2xl font-bold text-white">IC</span>
          </div>
          <h2 className="text-2xl font-bold text-white">Join ICAN Capital Engine</h2>
          <p className="text-gray-400 text-sm mt-2">Transform volatility into global capital</p>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
            <p className="text-red-400 text-sm text-center">{error}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Full Name */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Full Name *</label>
            <input
              type="text"
              name="fullName"
              value={formData.fullName}
              onChange={handleChange}
              className="w-full px-4 py-3 bg-slate-700/50 border border-slate-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
              placeholder="Enter your full name"
              required
            />
          </div>

          {/* Email */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Email Address *</label>
            <input
              type="email"
              name="email"
              value={formData.email}
              onChange={handleChange}
              className="w-full px-4 py-3 bg-slate-700/50 border border-slate-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
              placeholder="you@example.com"
              required
            />
          </div>

          {/* Password */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Password *</label>
            <input
              type="password"
              name="password"
              value={formData.password}
              onChange={handleChange}
              className="w-full px-4 py-3 bg-slate-700/50 border border-slate-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
              placeholder="Minimum 8 characters"
              required
              minLength={8}
            />
          </div>

          {/* Confirm Password */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Confirm Password *</label>
            <input
              type="password"
              name="confirmPassword"
              value={formData.confirmPassword}
              onChange={handleChange}
              className="w-full px-4 py-3 bg-slate-700/50 border border-slate-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
              placeholder="Confirm your password"
              required
            />
          </div>

          {/* Operating Mode Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">I am a...</label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setFormData(prev => ({ ...prev, operatingMode: 'SE' }))}
                className={`p-3 rounded-lg border-2 transition-all ${
                  formData.operatingMode === 'SE'
                    ? 'border-purple-500 bg-purple-500/20 text-white'
                    : 'border-slate-600 bg-slate-700/50 text-gray-400 hover:border-slate-500'
                }`}
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
                    ? 'border-purple-500 bg-purple-500/20 text-white'
                    : 'border-slate-600 bg-slate-700/50 text-gray-400 hover:border-slate-500'
                }`}
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
            className="flex items-center gap-2 text-sm text-purple-400 hover:text-purple-300 transition-colors"
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
            <div className="space-y-4 p-4 bg-slate-700/30 rounded-lg border border-slate-600/50">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 bg-gradient-to-r from-orange-500 to-yellow-500 rounded-lg flex items-center justify-center">
                  <span className="text-sm">⛓️</span>
                </div>
                <div>
                  <p className="text-white text-sm font-medium">Blockchain Integration</p>
                  <p className="text-gray-500 text-xs">Connect your wallet for enhanced features</p>
                </div>
              </div>

              {/* Wallet Address */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Wallet Address (Optional)
                </label>
                <input
                  type="text"
                  name="walletAddress"
                  value={formData.walletAddress}
                  onChange={handleChange}
                  className="w-full px-4 py-3 bg-slate-700/50 border border-slate-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all font-mono text-sm"
                  placeholder="0x... or Solana address"
                />
                <p className="text-xs text-gray-500 mt-1">
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
                  className="w-5 h-5 mt-0.5 rounded border-slate-600 bg-slate-700 text-purple-500 focus:ring-purple-500 focus:ring-offset-0"
                />
                <span className="text-sm text-gray-400">
                  I consent to storing a hash of my profile data on-chain for verification and cross-app integration
                </span>
              </label>

              {/* Risk Tolerance */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Risk Tolerance</label>
                <select
                  name="riskTolerance"
                  value={formData.riskTolerance}
                  onChange={handleChange}
                  className="w-full px-4 py-3 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
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
              className="w-5 h-5 mt-0.5 rounded border-slate-600 bg-slate-700 text-purple-500 focus:ring-purple-500 focus:ring-offset-0"
              required
            />
            <span className="text-sm text-gray-400">
              I agree to the{' '}
              <a href="/terms" className="text-purple-400 hover:text-purple-300">Terms of Service</a>
              {' '}and{' '}
              <a href="/privacy" className="text-purple-400 hover:text-purple-300">Privacy Policy</a>
            </span>
          </label>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 px-4 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white font-semibold rounded-lg shadow-lg shadow-purple-500/30 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
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
          <p className="text-gray-400 text-sm">
            Already have an account?{' '}
            <button
              onClick={onSwitchToSignIn}
              className="text-purple-400 hover:text-purple-300 font-medium transition-colors"
            >
              Sign In
            </button>
          </p>
        </div>

        {/* Features Preview */}
        <div className="mt-8 pt-6 border-t border-slate-700">
          <p className="text-xs text-gray-500 text-center mb-3">Unlock these features:</p>
          <div className="grid grid-cols-4 gap-2 text-center">
            {[
              { icon: '📊', label: 'Velocity Engine' },
              { icon: '🛡️', label: 'Treasury Guardian' },
              { icon: '🌍', label: 'Global Navigator' },
              { icon: '⚡', label: 'Prosperity AI' }
            ].map((feature, i) => (
              <div key={i} className="p-2">
                <div className="text-lg">{feature.icon}</div>
                <div className="text-xs text-gray-500">{feature.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SignUp;
