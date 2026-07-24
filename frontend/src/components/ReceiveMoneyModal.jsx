/**
 * Receive Money Modal Component
 * Displays QR code, payment link, and handles payment requests
 */

import React, { useState, useEffect, useRef } from 'react';
import { ArrowDownLeft, ArrowUpRight, Copy, X, Download, Loader, QrCode, Send, Camera } from 'lucide-react';
import { QRCodeCanvas as QRCode } from 'qrcode.react';
import paymentRequestService from '../services/paymentRequestService';
import jsQR from 'jsqr';

const ReceiveMoneyModal = ({ 
  isOpen, 
  onClose, 
  userId,
  selectedCurrency = 'USD',
  onSuccess = null 
}) => {
  const initialFormData = {
    amount: '',
    description: ''
  };

  const [step, setStep] = useState('choice'); // 'choice', 'form', 'qrcode', 'active', 'pay', 'scanner'
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);
  
  // Form state
  const [formData, setFormData] = useState(initialFormData);

  // QR Code state
  const [qrData, setQrData] = useState(null);
  const [paymentLink, setPaymentLink] = useState('');
  const [activeRequests, setActiveRequests] = useState([]);
  
  // Scanner state
  const [cameraActive, setCameraActive] = useState(false);
  const [scannedData, setScannedData] = useState('');
  const [gunListening, setGunListening] = useState(true);
  const [scanBuffer, setScanBuffer] = useState('');
  
  // Refs for scanner
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const gunInputRef = useRef(null);
  const lastProcessedBarcodeRef = useRef(null);

  const resetModalState = () => {
    setStep('choice');
    setLoading(false);
    setError(null);
    setSuccessMessage(null);
    setFormData(initialFormData);
    setQrData(null);
    setPaymentLink('');
    setActiveRequests([]);
    setScannedData('');
    
    // Stop camera if active
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  };

  const handleCloseModal = () => {
    resetModalState();
    onClose();
  };

  useEffect(() => {
    if (!isOpen) return undefined;

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        handleCloseModal();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      resetModalState();
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && step === 'active') {
      loadActiveRequests();
    }
  }, [isOpen, step]);

  const loadActiveRequests = async () => {
    try {
      const result = await paymentRequestService.getActivePaymentRequests(userId);
      if (result.success) {
        setActiveRequests(result.data);
      }
    } catch (err) {
      console.error('Error loading active requests:', err);
    }
  };

  // ========== SCANNER FUNCTIONS ==========
  
  const initializeCamera = async () => {
    try {
      if (!videoRef.current) {
        console.error('❌ Video element not ready');
        setError('Camera element not ready');
        return;
      }

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Camera API not supported on this device');
      }

      console.log('📸 Requesting camera permissions...');
      
      let stream = null;
      
      try {
        // Try mobile-optimized constraints first
        stream = await Promise.race([
          navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: { ideal: 'environment' },
              width: { ideal: 1280, min: 480 },
              height: { ideal: 720, min: 320 }
            },
            audio: false
          }),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Timeout')), 3000)
          )
        ]);
      } catch (error) {
        console.warn('⚠️ Full HD constraints failed, trying basic...');
        
        // Fallback to basic constraints
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false
        });
      }
      
      if (!stream || !stream.active) {
        throw new Error('Failed to get active camera stream');
      }

      console.log('✅ Camera stream obtained');
      
      const video = videoRef.current;
      video.playsInline = true;
      video.muted = true;
      video.srcObject = stream;
      streamRef.current = stream;
      
      console.log('✅ Stream attached to video element');
      
      video.addEventListener('loadedmetadata', () => {
        video.play()
          .then(() => {
            console.log('✅ Video playback started');
            setCameraActive(true);
            setSuccessMessage('📸 Camera activated - point at QR code');
            startBarcodeDetection();
            setTimeout(() => setSuccessMessage(null), 2000);
          })
          .catch(err => {
            console.error('❌ Video play error:', err);
            setError('Failed to play video: ' + err.message);
            setCameraActive(false);
          });
      });
      
    } catch (error) {
      console.error('📸 Camera Error:', error);
      
      if (error.name === 'NotAllowedError') {
        setError('❌ Camera permission denied. Please allow camera access.');
      } else if (error.name === 'NotFoundError') {
        setError('❌ No camera found on this device.');
      } else if (error.name === 'NotSupportedError') {
        setError('❌ Camera access not supported. Use HTTPS connection.');
      } else {
        setError('❌ Camera error: ' + (error.message || 'Unknown error'));
      }
      
      setCameraActive(false);
    }
  };

  const startBarcodeDetection = () => {
    if (!canvasRef.current || !videoRef.current) {
      console.error('❌ Canvas or Video reference missing');
      return;
    }

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      console.error('❌ Cannot get canvas context');
      return;
    }
    
    const video = videoRef.current;
    let frameCount = 0;
    let isDetecting = true;

    console.log('🎬 Starting barcode detection loop...');

    const detectFrame = async () => {
      try {
        frameCount++;

        if (video.readyState >= 2) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

          let imageData;
          try {
            imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          } catch (err) {
            console.warn('⚠️ Cannot get image data:', err);
            if (isDetecting) {
              requestAnimationFrame(detectFrame);
            }
            return;
          }
          
          // Try jsQR detection for QR codes
          try {
            const code = jsQR(imageData.data, imageData.width, imageData.height);
            if (code && code.data && code.data.trim()) {
              const detectedBarcode = code.data.trim();
              
              // Prevent duplicate processing
              if (lastProcessedBarcodeRef.current !== detectedBarcode) {
                console.log('✅ QR Code Detected:', detectedBarcode);
                lastProcessedBarcodeRef.current = detectedBarcode;
                
                // Process the scanned code
                handleScannedCode(detectedBarcode);
                
                // Stop detection after successful scan
                isDetecting = false;
                return;
              }
            }
          } catch (e) {
            console.warn('⚠️ jsQR detection error:', e.message);
          }
        }
      } catch (error) {
        console.error('Frame detection error:', error);
      }

      if (isDetecting) {
        requestAnimationFrame(detectFrame);
      }
    };

    detectFrame();
  };

  const handleScannedCode = (code) => {
    console.log('📱 Processing scanned code:', code);
    setScannedData(code);
    setSuccessMessage('✅ QR Code scanned successfully!');
    
    // Stop camera
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
    
    // Go back to pay step with scanned data
    setStep('pay');
  };

  const initializeGunScanner = () => {
    setGunListening(true);
    console.log('🔫 Gun Scanner Initializing...');
    
    if (gunInputRef.current) {
      gunInputRef.current.focus();
      console.log('✅ Gun input focused and ready');
    }
  };

  const handleGunInput = (e) => {
    if (e.key === 'Enter') {
      if (scanBuffer.trim()) {
        console.log('🔫 Gun scanner input:', scanBuffer);
        handleScannedCode(scanBuffer.trim());
        setScanBuffer('');
      }
    } else if (e.key.length === 1) {
      setScanBuffer(prev => prev + e.key);
    }
  };

  // Initialize camera when scanner step is active
  useEffect(() => {
    if (step === 'scanner' && !cameraActive) {
      initializeCamera();
    }
    
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
        setCameraActive(false);
      }
    };
  }, [step]);

  // Initialize gun scanner
  useEffect(() => {
    if (step === 'scanner' && gunInputRef.current) {
      initializeGunScanner();
      gunInputRef.current.addEventListener('keydown', handleGunInput);
      
      return () => {
        if (gunInputRef.current) {
          gunInputRef.current.removeEventListener('keydown', handleGunInput);
        }
      };
    }
  }, [step, scanBuffer]);

  // ========== END SCANNER FUNCTIONS ==========

  const handleGenerateQR = async (e) => {
    e.preventDefault();
    
    if (!formData.amount || parseFloat(formData.amount) <= 0) {
      setError('Please enter a valid amount');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      
      // Create payment request
      const result = await paymentRequestService.createPaymentRequest(
        userId,
        formData.amount,
        selectedCurrency,
        formData.description
      );

      if (result.success) {
        setQrData(result.data);
        setPaymentLink(result.paymentLink);
        setSuccessMessage(`Payment request created for ${formData.amount} ${selectedCurrency}`);
        setStep('qrcode');
      }
    } catch (err) {
      setError(err.message || 'Failed to generate QR code');
      console.error('Error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(paymentLink);
    setSuccessMessage('Payment link copied to clipboard!');
    setTimeout(() => setSuccessMessage(null), 2000);
  };

  const handleDownloadQR = () => {
    const qrCodeElement = document.getElementById('qr-code-download');
    if (qrCodeElement) {
      const link = document.createElement('a');
      link.href = qrCodeElement.toDataURL('image/png');
      link.download = `payment-qr-${qrData.payment_code}.png`;
      link.click();
    }
  };

  const handleDeleteRequest = async (paymentCode) => {
    try {
      const result = await paymentRequestService.deletePaymentRequest(paymentCode);
      if (result.success) {
        setSuccessMessage('Payment request deleted');
        loadActiveRequests();
      }
    } catch (err) {
      setError('Failed to delete request');
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={handleCloseModal}
    >
      <div
        className="glass-card p-6 w-full max-w-md max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-xl font-bold text-white flex items-center gap-2">
            {step === 'choice' ? (
              <>
                <Send className="w-5 h-5 text-cyan-400" />
                Pay Or Receive
              </>
            ) : step === 'pay' ? (
              <>
                <Send className="w-5 h-5 text-orange-400" />
                Send Money
              </>
            ) : (
              <>
                <ArrowDownLeft className="w-5 h-5 text-cyan-400" />
                Receive Money
              </>
            )}
          </h3>
          <button
            onClick={handleCloseModal}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* STEP 0: CHOICE - Pay or Receive */}
        {step === 'choice' && (
          <div className="space-y-4">
            {/* Receive Card */}
            <button
              onClick={() => setStep('form')}
              className="w-full p-6 bg-gradient-to-br from-cyan-600/30 to-cyan-700/20 hover:from-cyan-600/40 hover:to-cyan-700/30 border border-cyan-500/50 rounded-xl transition-all transform hover:scale-105 cursor-pointer"
            >
              <div className="flex items-center gap-4">
                <div className="p-3 bg-cyan-500/30 rounded-lg">
                  <ArrowDownLeft className="w-8 h-8 text-cyan-400" />
                </div>
                <div className="text-left flex-1">
                  <p className="text-lg font-bold text-white">💰 RECEIVE</p>
                  <p className="text-sm text-gray-300 mt-1">Generate QR code</p>
                  <p className="text-xs text-gray-400 mt-2">Let others pay you instantly</p>
                </div>
              </div>
            </button>

            {/* Pay Card */}
            <button
              onClick={() => setStep('pay')}
              className="w-full p-6 bg-gradient-to-br from-orange-600/30 to-orange-700/20 hover:from-orange-600/40 hover:to-orange-700/30 border border-orange-500/50 rounded-xl transition-all transform hover:scale-105 cursor-pointer"
            >
              <div className="flex items-center gap-4">
                <div className="p-3 bg-orange-500/30 rounded-lg">
                  <ArrowUpRight className="w-8 h-8 text-orange-400" />
                </div>
                <div className="text-left flex-1">
                  <p className="text-lg font-bold text-white">💳 PAY</p>
                  <p className="text-sm text-gray-300 mt-1">Scan QR code</p>
                  <p className="text-xs text-gray-400 mt-2">Send money to others instantly</p>
                </div>
              </div>
            </button>

            <button
              onClick={handleCloseModal}
              className="w-full px-4 py-2 bg-white/10 text-white rounded-lg hover:bg-white/20 transition-all mt-4"
            >
              Close
            </button>
          </div>
        )}

        {/* STEP 1: PAY - Scan QR Code */}
        {step === 'pay' && (
          <div className="space-y-4">
            <div className="bg-orange-500/20 border border-orange-500/50 rounded-lg p-4">
              <p className="text-white text-center font-semibold mb-2">📱 Scan Payment QR Code</p>
              <p className="text-sm text-gray-300 text-center">Ask the receiver for their payment QR code or link</p>
            </div>

            <div className="bg-white/10 rounded-lg p-6 text-center">
              <button
                onClick={() => setStep('scanner')}
                className="w-full py-4 bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 rounded-lg text-white font-semibold transition-all transform hover:scale-105 flex items-center justify-center gap-2"
              >
                <Camera className="w-6 h-6" />
                📸 Open Camera Scanner
              </button>
              <p className="text-xs text-gray-400 mt-3">
                Works with camera, USB scanner, or Bluetooth scanner
              </p>
            </div>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-600"></div>
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-gray-800 text-gray-400">OR</span>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Payment Link
              </label>
              <input
                type="text"
                placeholder="Paste payment link or scanned code here"
                value={scannedData}
                onChange={(e) => setScannedData(e.target.value)}
                className="w-full px-4 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-400 focus:border-orange-400 focus:outline-none transition-all"
              />
            </div>

            {successMessage && (
              <div className="p-3 bg-green-500/20 border border-green-500/50 rounded-lg">
                <p className="text-sm text-green-400">✅ {successMessage}</p>
              </div>
            )}

            {error && (
              <div className="p-3 bg-red-500/20 border border-red-500/50 rounded-lg">
                <p className="text-sm text-red-400">❌ {error}</p>
              </div>
            )}

            <div className="flex gap-3 pt-4">
              <button
                onClick={() => {
                  setStep('choice');
                  setScannedData('');
                  setError(null);
                  setSuccessMessage(null);
                }}
                className="flex-1 px-4 py-2 bg-white/10 text-white rounded-lg hover:bg-white/20 transition-all"
              >
                Back
              </button>
              <button
                onClick={() => {
                  if (scannedData.trim()) {
                    setSuccessMessage('✅ Processing payment...');
                    // TODO: Process payment with scannedData
                  } else {
                    setError('Please scan a QR code or paste a payment link');
                  }
                }}
                disabled={!scannedData.trim()}
                className="flex-1 px-4 py-2 bg-gradient-to-r from-orange-500 to-orange-600 text-white rounded-lg hover:shadow-lg hover:shadow-orange-500/30 transition-all font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Proceed to Pay
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Generate Form (for Receive) */}
        {step === 'form' && (
          <form onSubmit={handleGenerateQR} className="space-y-4">
            <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-lg p-3">
              <p className="text-cyan-400 text-xs font-semibold">📌 RECEIVE MONEY</p>
              <p className="text-gray-300 text-sm mt-1">Enter amount for others to pay you</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Amount ({selectedCurrency})
              </label>
              <input
                type="number"
                placeholder="1000"
                step="0.01"
                value={formData.amount}
                onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                className="w-full px-4 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-400 focus:border-cyan-400 focus:outline-none transition-all"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Description (Optional)
              </label>
              <input
                type="text"
                placeholder="Invoice #123 - Product delivery"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="w-full px-4 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-400 focus:border-cyan-400 focus:outline-none transition-all"
              />
              <p className="text-xs text-gray-500 mt-1">
                Help the payer understand what this payment is for
              </p>
            </div>

            {error && (
              <div className="p-3 bg-red-500/20 border border-red-500/50 rounded-lg">
                <p className="text-sm text-red-400">❌ {error}</p>
              </div>
            )}

            {successMessage && (
              <div className="p-3 bg-green-500/20 border border-green-500/50 rounded-lg">
                <p className="text-sm text-green-400">✅ {successMessage}</p>
              </div>
            )}

            <div className="flex gap-3 pt-4">
              <button
                type="button"
                onClick={() => setStep('choice')}
                className="flex-1 px-4 py-2 bg-white/10 text-white rounded-lg hover:bg-white/20 transition-all"
              >
                Back
              </button>
              <button
                type="submit"
                disabled={loading}
                className="flex-1 px-4 py-2 bg-gradient-to-r from-cyan-500 to-cyan-600 text-white rounded-lg hover:shadow-lg hover:shadow-cyan-500/30 disabled:opacity-50 transition-all font-semibold flex items-center justify-center gap-2"
              >
                {loading && <Loader className="w-4 h-4 animate-spin" />}
                {loading ? 'Generating...' : '🔗 Generate QR Code'}
              </button>
            </div>
          </form>
        )}

        {/* Step 3: QR Code Display */}
        {step === 'qrcode' && qrData && (
          <div className="space-y-4">
            {/* QR Code */}
            <div className="flex justify-center p-4 bg-white/10 rounded-lg">
              <QRCode
                id="qr-code-download"
                value={paymentLink}
                size={256}
                level="H"
                includeMargin={true}
              />
            </div>

            {/* Payment Details */}
            <div className="bg-white/10 rounded-lg p-4 space-y-2">
              <div className="text-center">
                <p className="text-sm text-gray-400">Payment Amount</p>
                <p className="text-2xl font-bold text-cyan-400">
                  {qrData.amount} {qrData.currency}
                </p>
              </div>
              {qrData.description && (
                <div className="text-center">
                  <p className="text-sm text-gray-400">For</p>
                  <p className="text-white font-medium">{qrData.description}</p>
                </div>
              )}
              <div className="text-center text-xs text-gray-500 pt-2 border-t border-white/20">
                <p>Code: {qrData.payment_code}</p>
              </div>
            </div>

            {/* Payment Link */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-300">Payment Link</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={paymentLink}
                  readOnly
                  className="flex-1 px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white text-xs truncate"
                />
                <button
                  onClick={handleCopyLink}
                  className="px-3 py-2 bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/50 rounded-lg text-cyan-400 transition-all"
                  title="Copy link"
                >
                  <Copy className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Sharing Options */}
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={handleDownloadQR}
                className="px-3 py-2 bg-white/10 hover:bg-white/20 border border-white/20 rounded-lg text-white text-sm font-medium transition-all flex items-center justify-center gap-1"
              >
                <Download className="w-4 h-4" />
                Download QR
              </button>
              <button
                onClick={() => {
                  // Share via WhatsApp, copy, etc
                  const text = `Pay me ${qrData.amount} ${qrData.currency}${qrData.description ? ` for ${qrData.description}` : ''}. Tap to pay: ${paymentLink}`;
                  if (navigator.share) {
                    navigator.share({ title: 'Payment Request', text });
                  }
                }}
                className="px-3 py-2 bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/50 rounded-lg text-cyan-400 text-sm font-medium transition-all"
              >
                📤 Share
              </button>
            </div>

            <div className="flex gap-3 pt-4">
              <button
                onClick={() => setStep('form')}
                className="flex-1 px-4 py-2 bg-white/10 text-white rounded-lg hover:bg-white/20 transition-all"
              >
                Back
              </button>
              <button
                onClick={() => setStep('active')}
                className="flex-1 px-4 py-2 bg-white/10 text-white rounded-lg hover:bg-white/20 transition-all"
              >
                View Active
              </button>
            </div>
          </div>
        )}

        {/* Step 4: Active Requests */}
        {step === 'active' && (
          <div className="space-y-4">
            <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-lg p-3">
              <p className="text-cyan-400 text-xs font-semibold">📋 ACTIVE REQUESTS</p>
              <p className="text-gray-300 text-sm mt-1">Your pending payment requests</p>
            </div>

            {activeRequests.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-gray-400">No active payment requests</p>
                <button
                  onClick={() => setStep('form')}
                  className="mt-4 px-4 py-2 bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/50 rounded-lg text-cyan-400 text-sm"
                >
                  Create New
                </button>
              </div>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {activeRequests.map((req) => (
                  <div
                    key={req.id}
                    className="p-3 bg-white/10 border border-white/20 rounded-lg"
                  >
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <p className="font-semibold text-white">
                          {req.amount} {req.currency}
                        </p>
                        {req.description && (
                          <p className="text-xs text-gray-400">{req.description}</p>
                        )}
                      </div>
                      <span className="text-xs bg-cyan-500/20 text-cyan-400 px-2 py-1 rounded">
                        {req.status}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mb-2">
                      Expires: {new Date(req.expires_at).toLocaleString()}
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(req.payment_code);
                          setSuccessMessage('Code copied!');
                          setTimeout(() => setSuccessMessage(null), 2000);
                        }}
                        className="flex-1 px-2 py-1 bg-white/10 hover:bg-white/20 text-white text-xs rounded transition-all"
                      >
                        Copy Code
                      </button>
                      <button
                        onClick={() => handleDeleteRequest(req.payment_code)}
                        className="flex-1 px-2 py-1 bg-red-500/20 hover:bg-red-500/30 text-red-400 text-xs rounded transition-all"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {successMessage && (
              <div className="p-3 bg-green-500/20 border border-green-500/50 rounded-lg">
                <p className="text-sm text-green-400">✅ {successMessage}</p>
              </div>
            )}

            <div className="flex gap-3 pt-4">
              <button
                onClick={() => setStep('form')}
                className="flex-1 px-4 py-2 bg-white/10 text-white rounded-lg hover:bg-white/20 transition-all"
              >
                New Request
              </button>
              <button
                onClick={() => setStep('choice')}
                className="flex-1 px-4 py-2 bg-gradient-to-r from-cyan-500 to-cyan-600 text-white rounded-lg hover:shadow-lg hover:shadow-cyan-500/30 transition-all font-semibold"
              >
                Back
              </button>
            </div>
          </div>
        )}

        {/* STEP 5: SCANNER - Active Camera/Gun Scanner */}
        {step === 'scanner' && (
          <div className="space-y-4">
            <div className="bg-orange-500/20 border border-orange-500/50 rounded-lg p-4">
              <p className="text-white text-center font-semibold mb-2">📸 Scanning QR Code</p>
              <p className="text-sm text-gray-300 text-center">Point your camera at the payment QR code</p>
            </div>

            {/* Camera View */}
            <div className="relative bg-black rounded-lg overflow-hidden" style={{ aspectRatio: '4/3' }}>
              <video
                ref={videoRef}
                className="w-full h-full object-cover"
                playsInline
                muted
              />
              <canvas ref={canvasRef} className="hidden" />
              
              {/* Scanning Overlay */}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-64 h-64 border-4 border-orange-400 rounded-lg animate-pulse">
                  <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-orange-400"></div>
                  <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-orange-400"></div>
                  <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-orange-400"></div>
                  <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-orange-400"></div>
                </div>
              </div>

              {/* Status Indicator */}
              {!cameraActive && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/70">
                  <div className="text-center">
                    <Loader className="w-12 h-12 text-orange-400 animate-spin mx-auto mb-4" />
                    <p className="text-white font-semibold">Initializing camera...</p>
                  </div>
                </div>
              )}
            </div>

            {/* Hidden input for gun scanner */}
            <input
              ref={gunInputRef}
              type="text"
              className="sr-only"
              autoFocus
              value={scanBuffer}
              onChange={(e) => setScanBuffer(e.target.value)}
            />

            {/* Instructions */}
            <div className="bg-white/10 rounded-lg p-4">
              <p className="text-sm text-gray-300 text-center mb-2">
                <span className="inline-block px-3 py-1 bg-orange-500/20 rounded-full text-orange-400 font-semibold mb-2">
                  Multi-Device Support
                </span>
              </p>
              <ul className="text-xs text-gray-400 space-y-1">
                <li>📱 <strong>Camera:</strong> Point at QR code (auto-detect)</li>
                <li>🔫 <strong>Handheld Scanner:</strong> Scan barcode/QR</li>
                <li>🖥️ <strong>USB Scanner:</strong> Connected scanners work automatically</li>
                <li>📲 <strong>Bluetooth Scanner:</strong> Paired devices supported</li>
              </ul>
            </div>

            {error && (
              <div className="p-3 bg-red-500/20 border border-red-500/50 rounded-lg">
                <p className="text-sm text-red-400">❌ {error}</p>
              </div>
            )}

            {successMessage && (
              <div className="p-3 bg-green-500/20 border border-green-500/50 rounded-lg">
                <p className="text-sm text-green-400">✅ {successMessage}</p>
              </div>
            )}

            <div className="flex gap-3 pt-4">
              <button
                onClick={() => {
                  // Stop camera
                  if (streamRef.current) {
                    streamRef.current.getTracks().forEach(track => track.stop());
                    streamRef.current = null;
                  }
                  setCameraActive(false);
                  setStep('pay');
                  setError(null);
                }}
                className="flex-1 px-4 py-2 bg-white/10 text-white rounded-lg hover:bg-white/20 transition-all"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (scannedData.trim()) {
                    handleScannedCode(scannedData);
                  }
                }}
                disabled={!scannedData.trim()}
                className="flex-1 px-4 py-2 bg-gradient-to-r from-orange-500 to-orange-600 text-white rounded-lg hover:shadow-lg hover:shadow-orange-500/30 transition-all font-semibold disabled:opacity-50"
              >
                Use Scanned Code
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ReceiveMoneyModal;
