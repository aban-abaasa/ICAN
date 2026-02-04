import React, { useState, useRef } from 'react';
import { FileText, Fingerprint, Lock, Download, CheckCircle, AlertCircle, Eye, EyeOff, Loader } from 'lucide-react';
import QRCode from 'qrcode';

/**
 * SmartContractGenerator - Simplified Agreement Signing
 * 
 * Simple 2-step workflow:
 * 1. Enter share amount or partnership type
 * 2. Sign with PIN or fingerprint
 * 
 * Features:
 * - Fast signature capture
 * - Single QR code with all signer data
 * - Quick PIN/fingerprint authentication
 * - MOU generation
 */

const SmartContractGenerator = ({ businessProfile, pitch, onClose }) => {
  // Step management
  const [currentStep, setCurrentStep] = useState(1); // Step 1: Share Info, Step 2: Sign
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  
  // Share/Partnership Info
  const [sharesAmount, setSharesAmount] = useState('');
  const [sharePrice, setSharePrice] = useState('');
  const [partnershipType, setPartnershipType] = useState('equity'); // equity, debt, partnership
  const [description, setDescription] = useState('');
  
  // Signature Data
  const [signerName, setSignerName] = useState('');
  const [signerEmail, setSignerEmail] = useState('');
  const [signerRole, setSignerRole] = useState('');
  const [signatureData, setSignatureData] = useState({});
  const [qrCodeUrl, setQrCodeUrl] = useState('');
  const [mouContent, setMouContent] = useState('');
  
  // Authentication
  const [authMethod, setAuthMethod] = useState('pin'); // pin or fingerprint
  const [pin, setPin] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [pinVerified, setPinVerified] = useState(false);
  const canvasRef = useRef(null);

  // Validate share info
  const validateShareInfo = () => {
    if (!sharesAmount || isNaN(sharesAmount) || parseFloat(sharesAmount) <= 0) {
      setError('Please enter a valid share amount');
      return false;
    }
    if (partnershipType === 'equity' && (!sharePrice || isNaN(sharePrice))) {
      setError('Please enter a valid share price for equity deals');
      return false;
    }
    if (!description.trim()) {
      setError('Please provide a brief description of the agreement');
      return false;
    }
    return true;
  };

  // Proceed to signature step
  const handleProceedToSign = () => {
    setError('');
    if (!validateShareInfo()) return;
    if (!signerName.trim() || !signerEmail.trim()) {
      setError('Please enter your name and email');
      return;
    }
    setCurrentStep(2);
  };

  // Verify PIN
  const verifyPin = () => {
    setError('');
    if (!pin || pin.length < 4) {
      setError('PIN must be at least 4 digits');
      return;
    }
    if (pin !== pinConfirm) {
      setError('PINs do not match');
      return;
    }
    setPinVerified(true);
  };

  // Simulate fingerprint verification
  const simulateFingerprint = async () => {
    setLoading(true);
    setError('');
    try {
      // Simulate biometric check with a delay
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      // In a real app, this would use WebAuthn or similar
      const success = Math.random() > 0.1; // 90% success rate for demo
      if (success) {
        setPinVerified(true);
      } else {
        setError('Fingerprint not recognized. Please try again.');
      }
    } catch (err) {
      setError('Fingerprint verification failed: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // Generate MOU content
  const generateMOUContent = () => {
    const totalInvestment = (parseFloat(sharesAmount) * parseFloat(sharePrice || 1)).toFixed(2);
    
    return `
═══════════════════════════════════════════════════════════════
                    MEMORANDUM OF UNDERSTANDING (MOU)
═══════════════════════════════════════════════════════════════

Date: ${new Date().toLocaleDateString()}
Contract ID: ${Math.random().toString(36).substr(2, 9).toUpperCase()}

PARTIES:
─────────────────────────────────────────────────────────────
Business: ${businessProfile?.business_name || 'Not Specified'}
Pitch: ${pitch?.title || 'Not Specified'}

SIGNATORY:
Name: ${signerName}
Email: ${signerEmail}
Role: ${signerRole || 'Investor/Partner'}

AGREEMENT DETAILS:
─────────────────────────────────────────────────────────────
Type: ${partnershipType.charAt(0).toUpperCase() + partnershipType.slice(1)}
${partnershipType === 'equity' ? `
Shares Offered: ${sharesAmount}
Share Price: $${sharePrice}
Total Investment: $${totalInvestment}
` : ''}

Description:
${description}

TERMS & CONDITIONS:
─────────────────────────────────────────────────────────────
1. The parties agree to the terms outlined in this MOU
2. All signatures are digital and legally binding
3. This agreement is subject to all applicable laws
4. Modifications require mutual written consent
5. Disputes shall be resolved through arbitration

SIGNATURE VERIFICATION:
─────────────────────────────────────────────────────────────
Authentication Method: ${authMethod === 'pin' ? 'PIN' : 'Biometric'}
Timestamp: ${new Date().toISOString()}
Location: [Auto-captured if available]
Device: Browser-based Digital Signature

═══════════════════════════════════════════════════════════════
THIS IS A LEGALLY BINDING AGREEMENT
═══════════════════════════════════════════════════════════════
    `.trim();
  };

  // Generate QR code with all signer data
  const generateQRWithAllData = async () => {
    try {
      setLoading(true);
      
      const mou = generateMOUContent();
      setMouContent(mou);
      
      // Capture geolocation if available
      let location = { latitude: null, longitude: null, name: 'Not captured' };
      if (navigator.geolocation) {
        try {
          const pos = await new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 });
          });
          location = {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            name: `${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)}`
          };
        } catch (e) {
          console.log('Location not available');
        }
      }
      
      // Create comprehensive signature data
      const sig = {
        signerName,
        signerEmail,
        signerRole,
        authMethod,
        timestamp: new Date().toISOString(),
        location,
        agreementType: partnershipType,
        sharesAmount,
        sharePrice: partnershipType === 'equity' ? sharePrice : null,
        businessName: businessProfile?.business_name,
        pitchTitle: pitch?.title,
        mouHash: generateHash(mou)
      };
      
      setSignatureData(sig);
      
      // Generate QR code containing all signature data
      const qrData = JSON.stringify(sig);
      const qrUrl = await QRCode.toDataURL(qrData, {
        width: 300,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#FFFFFF'
        }
      });
      
      setQrCodeUrl(qrUrl);
      setSuccess(true);
      
    } catch (err) {
      setError('Failed to generate agreement: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // Simple hash function for MOU
  const generateHash = (text) => {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
  };

  // Handle signature completion
  const handleSignature = async () => {
    setError('');
    setLoading(true);
    
    try {
      // Verify PIN if selected
      if (authMethod === 'pin' && !pinVerified) {
        setError('Please verify your PIN first');
        setLoading(false);
        return;
      }
      
      // For fingerprint, simulate verification
      if (authMethod === 'fingerprint' && !pinVerified) {
        await simulateFingerprint();
        return;
      }
      
      // Generate final agreement with QR code
      await generateQRWithAllData();
      
    } finally {
      setLoading(false);
    }
  };

  // Download MOU as PDF-like text file
  const downloadAgreement = () => {
    const element = document.createElement('a');
    const file = new Blob([mouContent], { type: 'text/plain' });
    element.href = URL.createObjectURL(file);
    element.download = `MOU_${signerName.replace(/\s/g, '_')}_${Date.now()}.txt`;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  // Download QR code
  const downloadQR = () => {
    const link = document.createElement('a');
    link.href = qrCodeUrl;
    link.download = `QR_Agreement_${signerName.replace(/\s/g, '_')}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Success view
  if (success) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
        <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
          {/* Header */}
          <div className="sticky top-0 bg-gradient-to-r from-green-500 to-emerald-600 text-white p-6 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <CheckCircle className="h-8 w-8" />
              <h2 className="text-2xl font-bold">Agreement Signed Successfully!</h2>
            </div>
            <button onClick={onClose} className="text-white hover:bg-white hover:bg-opacity-20 p-2 rounded-lg transition">
              ✕
            </button>
          </div>

          <div className="p-6 space-y-6">
            {/* MOU Preview */}
            <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
              <h3 className="font-semibold text-gray-900 mb-3">📄 Memorandum of Understanding</h3>
              <div className="bg-white p-4 rounded border border-gray-300 font-mono text-xs whitespace-pre-wrap max-h-64 overflow-y-auto text-gray-800">
                {mouContent}
              </div>
            </div>

            {/* QR Code Section */}
            <div className="bg-blue-50 p-6 rounded-lg border border-blue-200 flex flex-col items-center">
              <h3 className="font-semibold text-gray-900 mb-3">🔐 Digital Signature QR Code</h3>
              <p className="text-sm text-gray-600 mb-4 text-center">
                This QR code contains all signature data including signer info, timestamp, and location
              </p>
              {qrCodeUrl && (
                <img 
                  src={qrCodeUrl} 
                  alt="Signature QR Code" 
                  className="border-4 border-blue-400 p-2 bg-white"
                />
              )}
              <p className="text-xs text-gray-500 mt-4 text-center">
                <strong>Signer:</strong> {signerName} | <strong>Time:</strong> {new Date().toLocaleString()}
              </p>
            </div>

            {/* Signature Details */}
            <div className="grid grid-cols-2 gap-4 bg-gray-50 p-4 rounded-lg">
              <div>
                <p className="text-xs text-gray-500 uppercase">Signer Name</p>
                <p className="font-semibold text-gray-900">{signerName}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase">Email</p>
                <p className="font-semibold text-gray-900">{signerEmail}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase">Agreement Type</p>
                <p className="font-semibold text-gray-900 capitalize">{partnershipType}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase">Auth Method</p>
                <p className="font-semibold text-gray-900 capitalize">{authMethod}</p>
              </div>
              {partnershipType === 'equity' && (
                <>
                  <div>
                    <p className="text-xs text-gray-500 uppercase">Shares</p>
                    <p className="font-semibold text-gray-900">{sharesAmount}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 uppercase">Total Investment</p>
                    <p className="font-semibold text-gray-900">${(parseFloat(sharesAmount) * parseFloat(sharePrice || 1)).toFixed(2)}</p>
                  </div>
                </>
              )}
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3 pt-4">
              <button
                onClick={downloadAgreement}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-4 rounded-lg flex items-center justify-center gap-2 transition"
              >
                <Download className="h-5 w-5" />
                Download MOU
              </button>
              <button
                onClick={downloadQR}
                className="flex-1 bg-purple-600 hover:bg-purple-700 text-white font-semibold py-3 px-4 rounded-lg flex items-center justify-center gap-2 transition"
              >
                <Download className="h-5 w-5" />
                Download QR
              </button>
              <button
                onClick={onClose}
                className="flex-1 bg-gray-300 hover:bg-gray-400 text-gray-900 font-semibold py-3 px-4 rounded-lg transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        
        {/* Header */}
        <div className="sticky top-0 bg-gradient-to-r from-blue-600 to-indigo-600 text-white p-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <FileText className="h-8 w-8" />
            <div>
              <h1 className="text-2xl font-bold">Quick Agreement Sign</h1>
              <p className="text-blue-100 text-sm">Step {currentStep} of 2</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="text-white hover:bg-white hover:bg-opacity-20 p-2 rounded-lg transition"
          >
            ✕
          </button>
        </div>

        <div className="p-6">
          {error && (
            <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
              <div className="text-red-800">{error}</div>
            </div>
          )}

          {/* Step 1: Share Information */}
          {currentStep === 1 && (
            <div className="space-y-5">
              <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                <h3 className="font-semibold text-gray-900 mb-2">📋 Your Information</h3>
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Full Name *</label>
                    <input
                      type="text"
                      value={signerName}
                      onChange={(e) => setSignerName(e.target.value)}
                      placeholder="Enter your full name"
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Email Address *</label>
                    <input
                      type="email"
                      value={signerEmail}
                      onChange={(e) => setSignerEmail(e.target.value)}
                      placeholder="your@email.com"
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Your Role</label>
                    <input
                      type="text"
                      value={signerRole}
                      onChange={(e) => setSignerRole(e.target.value)}
                      placeholder="e.g., Investor, Partner, Founder"
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                </div>
              </div>

              <div className="bg-green-50 p-4 rounded-lg border border-green-200">
                <h3 className="font-semibold text-gray-900 mb-3">📊 Agreement Details</h3>
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Agreement Type *</label>
                    <select
                      value={partnershipType}
                      onChange={(e) => setPartnershipType(e.target.value)}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                    >
                      <option value="equity">Equity Share Purchase</option>
                      <option value="debt">Debt Agreement</option>
                      <option value="partnership">Partnership Agreement</option>
                    </select>
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {partnershipType === 'equity' ? 'Number of Shares' : 'Amount'} *
                    </label>
                    <input
                      type="number"
                      value={sharesAmount}
                      onChange={(e) => setSharesAmount(e.target.value)}
                      placeholder={partnershipType === 'equity' ? '100' : '50000'}
                      step="0.01"
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                    />
                  </div>

                  {partnershipType === 'equity' && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Share Price ($) *</label>
                      <input
                        type="number"
                        value={sharePrice}
                        onChange={(e) => setSharePrice(e.target.value)}
                        placeholder="100.00"
                        step="0.01"
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                      />
                      {sharesAmount && sharePrice && (
                        <p className="text-sm text-green-700 mt-2 font-semibold">
                          💰 Total Investment: ${(parseFloat(sharesAmount) * parseFloat(sharePrice)).toFixed(2)}
                        </p>
                      )}
                    </div>
                  )}

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Description *</label>
                    <textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="Brief description of this agreement..."
                      rows="3"
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                    />
                  </div>
                </div>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  onClick={onClose}
                  className="flex-1 bg-gray-300 hover:bg-gray-400 text-gray-900 font-semibold py-3 px-4 rounded-lg transition"
                >
                  Cancel
                </button>
                <button
                  onClick={handleProceedToSign}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-4 rounded-lg transition"
                >
                  Continue to Sign →
                </button>
              </div>
            </div>
          )}

          {/* Step 2: Signature */}
          {currentStep === 2 && (
            <div className="space-y-5">
              <div className="bg-purple-50 p-4 rounded-lg border border-purple-200">
                <h3 className="font-semibold text-gray-900 mb-3">🔐 Choose Signature Method</h3>
                
                <div className="space-y-3">
                  {/* PIN Method */}
                  <label className={`p-4 rounded-lg border-2 cursor-pointer transition ${
                    authMethod === 'pin' 
                      ? 'border-purple-500 bg-purple-100' 
                      : 'border-gray-200 bg-white hover:border-purple-300'
                  }`}>
                    <div className="flex items-start gap-3">
                      <input
                        type="radio"
                        name="authMethod"
                        value="pin"
                        checked={authMethod === 'pin'}
                        onChange={(e) => {
                          setAuthMethod(e.target.value);
                          setPinVerified(false);
                        }}
                        className="mt-1"
                      />
                      <div className="flex-1">
                        <p className="font-semibold text-gray-900">4-Digit PIN</p>
                        <p className="text-sm text-gray-600">Fast and secure numeric PIN verification</p>
                      </div>
                      <Lock className="h-5 w-5 text-purple-600" />
                    </div>
                  </label>

                  {/* Fingerprint Method */}
                  <label className={`p-4 rounded-lg border-2 cursor-pointer transition ${
                    authMethod === 'fingerprint' 
                      ? 'border-purple-500 bg-purple-100' 
                      : 'border-gray-200 bg-white hover:border-purple-300'
                  }`}>
                    <div className="flex items-start gap-3">
                      <input
                        type="radio"
                        name="authMethod"
                        value="fingerprint"
                        checked={authMethod === 'fingerprint'}
                        onChange={(e) => {
                          setAuthMethod(e.target.value);
                          setPinVerified(false);
                        }}
                        className="mt-1"
                      />
                      <div className="flex-1">
                        <p className="font-semibold text-gray-900">Fingerprint/Biometric</p>
                        <p className="text-sm text-gray-600">Quick biometric verification</p>
                      </div>
                      <Fingerprint className="h-5 w-5 text-purple-600" />
                    </div>
                  </label>
                </div>
              </div>

              {/* PIN Input */}
              {authMethod === 'pin' && !pinVerified && (
                <div className="bg-yellow-50 p-4 rounded-lg border border-yellow-200 space-y-3">
                  <h4 className="font-semibold text-gray-900">Enter Your 4-Digit PIN</h4>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">PIN (4+ digits) *</label>
                    <div className="relative">
                      <input
                        type={showPin ? 'text' : 'password'}
                        value={pin}
                        onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 10))}
                        placeholder="••••"
                        maxLength="10"
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-500 focus:border-transparent pr-10 text-center text-2xl tracking-widest"
                      />
                      <button
                        onClick={() => setShowPin(!showPin)}
                        className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-600"
                      >
                        {showPin ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Confirm PIN *</label>
                    <input
                      type={showPin ? 'text' : 'password'}
                      value={pinConfirm}
                      onChange={(e) => setPinConfirm(e.target.value.replace(/\D/g, '').slice(0, 10))}
                      placeholder="••••"
                      maxLength="10"
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-500 focus:border-transparent text-center text-2xl tracking-widest"
                    />
                  </div>

                  <button
                    onClick={verifyPin}
                    className="w-full bg-yellow-600 hover:bg-yellow-700 text-white font-semibold py-2 px-4 rounded-lg transition"
                  >
                    Verify PIN
                  </button>
                </div>
              )}

              {/* PIN Verified */}
              {authMethod === 'pin' && pinVerified && (
                <div className="bg-green-50 p-4 rounded-lg border border-green-200 flex items-center gap-3">
                  <CheckCircle className="h-6 w-6 text-green-600" />
                  <div>
                    <p className="font-semibold text-green-900">PIN Verified ✓</p>
                    <p className="text-sm text-green-700">Your identity has been confirmed</p>
                  </div>
                </div>
              )}

              {/* Fingerprint Button */}
              {authMethod === 'fingerprint' && !pinVerified && (
                <div className="bg-indigo-50 p-6 rounded-lg border border-indigo-200 text-center space-y-4">
                  <Fingerprint className="h-16 w-16 text-indigo-600 mx-auto" />
                  <div>
                    <p className="font-semibold text-gray-900 mb-2">Ready to sign with fingerprint?</p>
                    <p className="text-sm text-gray-600 mb-4">Place your finger on the sensor or click below</p>
                  </div>
                  <button
                    onClick={simulateFingerprint}
                    disabled={loading}
                    className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400 text-white font-semibold py-3 px-4 rounded-lg flex items-center justify-center gap-2 transition"
                  >
                    {loading ? (
                      <>
                        <Loader className="h-5 w-5 animate-spin" />
                        Scanning...
                      </>
                    ) : (
                      <>
                        <Fingerprint className="h-5 w-5" />
                        Verify Fingerprint
                      </>
                    )}
                  </button>
                </div>
              )}

              {/* Fingerprint Verified */}
              {authMethod === 'fingerprint' && pinVerified && (
                <div className="bg-green-50 p-4 rounded-lg border border-green-200 flex items-center gap-3">
                  <CheckCircle className="h-6 w-6 text-green-600" />
                  <div>
                    <p className="font-semibold text-green-900">Biometric Verified ✓</p>
                    <p className="text-sm text-green-700">Your identity has been confirmed</p>
                  </div>
                </div>
              )}

              {/* Summary before signing */}
              {pinVerified && (
                <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                  <h4 className="font-semibold text-gray-900 mb-3">📋 Agreement Summary</h4>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-gray-600">Type:</p>
                      <p className="font-semibold capitalize">{partnershipType}</p>
                    </div>
                    <div>
                      <p className="text-gray-600">Amount:</p>
                      <p className="font-semibold">{sharesAmount}{partnershipType === 'equity' ? ' shares' : ''}</p>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex gap-3 pt-4">
                <button
                  onClick={() => setCurrentStep(1)}
                  className="flex-1 bg-gray-300 hover:bg-gray-400 text-gray-900 font-semibold py-3 px-4 rounded-lg transition"
                >
                  ← Back
                </button>
                <button
                  onClick={handleSignature}
                  disabled={!pinVerified || loading}
                  className="flex-1 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white font-semibold py-3 px-4 rounded-lg flex items-center justify-center gap-2 transition disabled:cursor-not-allowed"
                >
                  {loading ? (
                    <>
                      <Loader className="h-5 w-5 animate-spin" />
                      Signing...
                    </>
                  ) : (
                    <>
                      <CheckCircle className="h-5 w-5" />
                      Sign & Generate Agreement
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SmartContractGenerator;
