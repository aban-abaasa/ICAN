import React, { useState, useEffect } from 'react';
import { X, ChevronRight, CheckCircle, Clock, Lock, Fingerprint, QrCode, Download, AlertCircle, Users, TrendingUp, Shield, FileText, DollarSign } from 'lucide-react';
import QRCode from 'qrcode';
import { getSupabase } from '../services/pitchingService';

/**
 * ShareSigningFlow - Complete Investment Flow with Escrow & Multi-Signature
 * 
 * Flow:
 * 0. Investment Intent (Buy/Partner/Support)
 * 1. Pitch Documents (View submitted seller documents)
 * 2. Agreement (View Terms + I Agree)
 * 3. Share Allocation (Enter number of shares)
 * 4. Wallet Integration (Show amount in ICAN Wallet)
 * 5. Payment Execution (PIN verification - money to Escrow)
 * 6. Pending Signatures (Wait for 60% shareholder signatures)
 * 7. Finalization (QR Code Seal + Add to Profile)
 */

const ShareSigningFlow = ({ pitch, businessProfile, currentUser, onClose }) => {
  // Flow stages
  const [stage, setStage] = useState(0); // 0: Intent, 1: Documents, 2: Agreement, 3: Shares, 4: Wallet, 5: Payment, 6: Pending, 7: Finalized
  const [investmentType, setInvestmentType] = useState(null); // 'buy', 'partner', 'support'
  const [sharesAmount, setSharesAmount] = useState('');
  const [sharePrice, setSharePrice] = useState(pitch?.share_price || 100);
  const [totalInvestment, setTotalInvestment] = useState(0);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  
  // Documents
  const [sellerDocuments, setSellerDocuments] = useState(null);
  const [documentsLoading, setDocumentsLoading] = useState(false);
  
  // Payment & PIN
  const [pin, setPin] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [pinVerified, setPinVerified] = useState(false);
  
  // Signatures tracking
  const [signatures, setSignatures] = useState([]);
  const [signaturePercentage, setSignaturePercentage] = useState(0);
  const [qrCodeUrl, setQrCodeUrl] = useState('');
  const [escrowId, setEscrowId] = useState('');
  const [machineData, setMachineData] = useState({
    timestamp: new Date().toISOString(),
    location: 'Device Location',
    deviceId: 'Device-' + Math.random().toString(36).substr(2, 9)
  });
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Mock shareholders data (would come from API)
  const mockShareholders = [
    { id: 1, name: 'John Owner', email: 'john@business.com', isBusiness: true, signed: false },
    { id: 2, name: 'Sarah Partner', email: 'sarah@business.com', isBusiness: true, signed: false },
    { id: 3, name: 'Mike Investor', email: 'mike@investor.com', isBusiness: false, signed: false },
    { id: 4, name: 'Lisa Investor', email: 'lisa@investor.com', isBusiness: false, signed: false },
    { id: 5, name: 'Tom Advisor', email: 'tom@advisor.com', isBusiness: false, signed: false },
    { id: 6, name: 'Emma Board', email: 'emma@board.com', isBusiness: true, signed: false },
    { id: 7, name: 'David Member', email: 'david@member.com', isBusiness: false, signed: false },
    { id: 8, name: 'Nina Member', email: 'nina@member.com', isBusiness: false, signed: false },
    { id: 9, name: 'Chris Member', email: 'chris@member.com', isBusiness: false, signed: false },
    { id: 10, name: 'Rachel Member', email: 'rachel@member.com', isBusiness: false, signed: false },
    { id: 11, name: 'Steven Member', email: 'steven@member.com', isBusiness: false, signed: false },
    { id: 12, name: 'Karen Member', email: 'karen@member.com', isBusiness: false, signed: false },
  ];

  // Calculate total investment
  useEffect(() => {
    if (sharesAmount && sharePrice) {
      setTotalInvestment(parseFloat(sharesAmount) * parseFloat(sharePrice));
    }
  }, [sharesAmount, sharePrice]);

  // Fetch seller documents when component loads
  useEffect(() => {
    const fetchSellerDocuments = async () => {
      try {
        setDocumentsLoading(true);
        const supabase = getSupabase();
        
        if (supabase && businessProfile?.id) {
          try {
            const { data, error } = await supabase
              .from('business_documents')
              .select('*')
              .eq('business_profile_id', businessProfile.id)
              .single();
            
            if (data && !error) {
              console.log('✅ Documents fetched successfully:', data);
              setSellerDocuments(data);
            } else if (error) {
              // Handle different error types
              if (error.code === '404' || error.code === 'PGRST116' || error.message?.includes('No rows')) {
                // No records found - this is normal, use empty defaults
                console.warn('No documents found for this profile (expected if not saved yet)');
                setSellerDocuments({
                  business_plan_content: null,
                  financial_projection_content: null,
                  value_proposition_wants: null,
                  value_proposition_fears: null,
                  value_proposition_needs: null,
                  mou_content: null,
                  share_allocation_shares: null,
                  share_allocation_share_price: null,
                  disclosure_notes: null
                });
              } else if (error.code === '406' || error.message?.includes('406')) {
                // 406 Not Acceptable - likely RLS policy issue or server issue
                console.warn('Server returned 406 error - likely RLS policy issue. Using empty defaults.');
                setSellerDocuments({
                  business_plan_content: null,
                  financial_projection_content: null,
                  value_proposition_wants: null,
                  value_proposition_fears: null,
                  value_proposition_needs: null,
                  mou_content: null,
                  share_allocation_shares: null,
                  share_allocation_share_price: null,
                  disclosure_notes: null
                });
              } else {
                throw error;
              }
            }
          } catch (fetchError) {
            // Silently handle all fetch errors
            console.warn('Could not fetch documents:', fetchError?.message || fetchError);
            setSellerDocuments({
              business_plan_content: null,
              financial_projection_content: null,
              value_proposition_wants: null,
              value_proposition_fears: null,
              value_proposition_needs: null,
              mou_content: null,
              share_allocation_shares: null,
              share_allocation_share_price: null,
              disclosure_notes: null
            });
          }
        } else {
          // No supabase or business profile
          setSellerDocuments({
            business_plan_content: null,
            financial_projection_content: null,
            value_proposition_wants: null,
            value_proposition_fears: null,
            value_proposition_needs: null,
            mou_content: null,
            share_allocation_shares: null,
            share_allocation_share_price: null,
            disclosure_notes: null
          });
        }
      } catch (err) {
        console.warn('Document fetch error:', err?.message);
        setSellerDocuments({
          business_plan_content: null,
          financial_projection_content: null,
          value_proposition_wants: null,
          value_proposition_fears: null,
          value_proposition_needs: null,
          mou_content: null,
          share_allocation_shares: null,
          share_allocation_share_price: null,
          disclosure_notes: null
        });
      } finally {
        setDocumentsLoading(false);
      }
    };

    fetchSellerDocuments();
  }, [businessProfile?.id]);

  // Simulate shareholders signing over time
  useEffect(() => {
    if (stage === 6) {
      const interval = setInterval(() => {
        setSignatures(prev => {
          if (prev.length < mockShareholders.length) {
            const newSignatures = [...prev];
            const randomIndex = Math.floor(Math.random() * mockShareholders.length);
            if (!newSignatures.some(s => s.id === mockShareholders[randomIndex].id)) {
              newSignatures.push({
                id: mockShareholders[randomIndex].id,
                name: mockShareholders[randomIndex].name,
                timestamp: new Date().toISOString(),
                pin: Math.random().toString().substr(2, 4)
              });
            }
            return newSignatures;
          }
          return prev;
        });
      }, 2000);

      return () => clearInterval(interval);
    }
  }, [stage]);

  // Calculate signature percentage
  useEffect(() => {
    const percentage = (signatures.length / mockShareholders.length) * 100;
    setSignaturePercentage(percentage);

    // Auto-proceed to finalization when 60% signed
    if (percentage >= 60 && stage === 6) {
      setTimeout(() => {
        generateQRCode();
      }, 1000);
    }
  }, [signatures, stage]);

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

  // Generate QR Code seal
  const generateQRCode = async () => {
    try {
      setLoading(true);
      
      const sealData = {
        investmentId: 'INV-' + Math.random().toString(36).substr(2, 9).toUpperCase(),
        pitch: pitch.title,
        business: businessProfile.business_name,
        investor: currentUser.email,
        shares: sharesAmount,
        amount: totalInvestment,
        signatures: signatures.length,
        totalRequired: mockShareholders.length,
        percentageSigned: signaturePercentage,
        machineTime: machineData.timestamp,
        location: machineData.location,
        deviceId: machineData.deviceId,
        pin: pin.substr(-2) + '****', // Masked PIN
        status: 'SEALED'
      };

      const qrDataUrl = await QRCode.toDataURL(JSON.stringify(sealData));
      setQrCodeUrl(qrDataUrl);
      setEscrowId(sealData.investmentId);
      setStage(7); // Move to finalization
    } catch (err) {
      setError('Failed to generate QR code: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // Download agreement
  const downloadAgreement = async () => {
    try {
      const element = document.getElementById('agreement-content');
      const canvas = await html2canvas(element);
      const link = document.createElement('a');
      link.href = canvas.toDataURL('image/png');
      link.download = `Agreement-${escrowId}.png`;
      link.click();
    } catch (err) {
      console.error('Download failed:', err);
      alert('Failed to download agreement');
    }
  };

  // Download QR Code
  const downloadQRCode = () => {
    const link = document.createElement('a');
    link.href = qrCodeUrl;
    link.download = `Seal-${escrowId}.png`;
    link.click();
  };

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        
        {/* Header */}
        <div className="sticky top-0 bg-gradient-to-r from-purple-900 to-pink-900 p-6 flex items-center justify-between border-b border-purple-500/30">
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <TrendingUp className="w-6 h-6" />
            Investment Agreement
          </h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-white/20 rounded-lg transition text-slate-300"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          
          {/* Stage 0: Investment Intent */}
          {stage === 0 && (
            <div className="space-y-6">
              <h3 className="text-xl font-bold text-white">Choose Investment Type</h3>
              <p className="text-slate-400">How would you like to invest in {businessProfile.business_name}?</p>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {[
                  { id: 'buy', label: 'Buy Equity', icon: '📈', desc: 'Own shares of the business' },
                  { id: 'partner', label: 'Partner', icon: '🤝', desc: 'Strategic partnership deal' },
                  { id: 'support', label: 'Support', icon: '💰', desc: 'Provide financial support' }
                ].map(type => (
                  <button
                    key={type.id}
                    onClick={() => {
                      setInvestmentType(type.id);
                      setStage(1);
                    }}
                    className="p-6 border-2 border-slate-700 hover:border-pink-500 rounded-xl bg-slate-800/50 hover:bg-slate-800 transition text-left"
                  >
                    <div className="text-3xl mb-3">{type.icon}</div>
                    <h4 className="font-bold text-white mb-2">{type.label}</h4>
                    <p className="text-sm text-slate-400">{type.desc}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Stage 1: Pitch Documents Review */}
          {stage === 1 && (
            <div className="space-y-6">
              <div className="space-y-2">
                <h3 className="text-xl font-bold text-white flex items-center gap-2">
                  <FileText className="w-6 h-6" />
                  Seller's Pitch Documents
                </h3>
                <p className="text-slate-400">Review all documents submitted by {pitch?.creator_name}</p>
              </div>

              {documentsLoading ? (
                <div className="text-center py-8">
                  <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-pink-500"></div>
                  <p className="text-slate-400 mt-4">Loading documents...</p>
                </div>
              ) : sellerDocuments ? (
                <div className="space-y-4">
                  {/* Document Overview */}
                  <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700">
                    <div className="flex items-center justify-between mb-4">
                      <h4 className="font-semibold text-white">📋 Overall Progress</h4>
                      <span className="text-lg font-bold text-purple-400">
                        {[
                          sellerDocuments?.business_plan_content,
                          sellerDocuments?.financial_projection_content,
                          sellerDocuments?.mou_content,
                          (sellerDocuments?.share_allocation_shares && sellerDocuments?.share_allocation_share_price) ? 'yes' : null,
                          (sellerDocuments?.value_proposition_wants && sellerDocuments?.value_proposition_fears && sellerDocuments?.value_proposition_needs) ? 'yes' : null
                        ].filter(Boolean).length}/5 documents
                      </span>
                    </div>
                    <div className="w-full bg-slate-700 rounded-full h-2">
                      <div 
                        className="bg-gradient-to-r from-pink-500 to-purple-500 h-2 rounded-full transition-all"
                        style={{ 
                          width: `${(([
                            sellerDocuments?.business_plan_content,
                            sellerDocuments?.financial_projection_content,
                            sellerDocuments?.mou_content,
                            (sellerDocuments?.share_allocation_shares && sellerDocuments?.share_allocation_share_price) ? 'yes' : null,
                            (sellerDocuments?.value_proposition_wants && sellerDocuments?.value_proposition_fears && sellerDocuments?.value_proposition_needs) ? 'yes' : null
                          ].filter(Boolean).length / 5) * 100)}%` 
                        }}
                      ></div>
                    </div>
                  </div>

                  {/* Business Plan */}
                  <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700">
                    <div className="flex items-start gap-3">
                      <span className="text-2xl">📋</span>
                      <div className="flex-1">
                        <h4 className="font-semibold text-white mb-3">Business Plan</h4>
                        <p className="text-sm text-slate-400 mb-3">Your strategic foundation and business model</p>
                        {sellerDocuments?.business_plan_content ? (
                          <div className="bg-slate-900/50 p-3 rounded border border-slate-600 max-h-40 overflow-y-auto">
                            <p className="text-sm text-slate-200 whitespace-pre-wrap">{sellerDocuments.business_plan_content}</p>
                          </div>
                        ) : (
                          <p className="text-sm text-yellow-400">⚠️ Not submitted</p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Financial Projection */}
                  <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700">
                    <div className="flex items-start gap-3">
                      <span className="text-2xl">💰</span>
                      <div className="flex-1">
                        <h4 className="font-semibold text-white mb-3">Financial Projection</h4>
                        <p className="text-sm text-slate-400 mb-3">Revenue and expense estimates</p>
                        {sellerDocuments?.financial_projection_content ? (
                          <div className="bg-slate-900/50 p-3 rounded border border-slate-600 max-h-40 overflow-y-auto">
                            <p className="text-sm text-slate-200 whitespace-pre-wrap">{sellerDocuments.financial_projection_content}</p>
                          </div>
                        ) : (
                          <p className="text-sm text-yellow-400">⚠️ Not submitted</p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Value Proposition */}
                  <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700">
                    <div className="flex items-start gap-3">
                      <span className="text-2xl">🎯</span>
                      <div className="flex-1">
                        <h4 className="font-semibold text-white mb-3">Value Proposition</h4>
                        <p className="text-sm text-slate-400 mb-3">What you offer: Wants, Fears, and Needs</p>
                        {sellerDocuments?.value_proposition_wants && sellerDocuments?.value_proposition_fears && sellerDocuments?.value_proposition_needs ? (
                          <div className="space-y-3">
                            <div className="bg-slate-900/50 p-3 rounded border border-slate-600">
                              <p className="text-xs font-semibold text-pink-400 mb-2">Wants (Customer Desires)</p>
                              <p className="text-sm text-slate-200 whitespace-pre-wrap">{sellerDocuments.value_proposition_wants}</p>
                            </div>
                            <div className="bg-slate-900/50 p-3 rounded border border-slate-600">
                              <p className="text-xs font-semibold text-orange-400 mb-2">Fears (Customer Concerns)</p>
                              <p className="text-sm text-slate-200 whitespace-pre-wrap">{sellerDocuments.value_proposition_fears}</p>
                            </div>
                            <div className="bg-slate-900/50 p-3 rounded border border-slate-600">
                              <p className="text-xs font-semibold text-blue-400 mb-2">Needs (Customer Requirements)</p>
                              <p className="text-sm text-slate-200 whitespace-pre-wrap">{sellerDocuments.value_proposition_needs}</p>
                            </div>
                          </div>
                        ) : (
                          <p className="text-sm text-yellow-400">⚠️ Not submitted</p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* MOU */}
                  <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700">
                    <div className="flex items-start gap-3">
                      <span className="text-2xl">⚖️</span>
                      <div className="flex-1">
                        <h4 className="font-semibold text-white mb-3">Memorandum of Understanding</h4>
                        <p className="text-sm text-slate-400 mb-3">Legal and collaborative agreements</p>
                        {sellerDocuments?.mou_content ? (
                          <div className="bg-slate-900/50 p-3 rounded border border-slate-600 max-h-40 overflow-y-auto">
                            <p className="text-sm text-slate-200 whitespace-pre-wrap">{sellerDocuments.mou_content}</p>
                          </div>
                        ) : (
                          <p className="text-sm text-yellow-400">⚠️ Not submitted</p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Share Allocation */}
                  <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700">
                    <div className="flex items-start gap-3">
                      <span className="text-2xl">📊</span>
                      <div className="flex-1">
                        <h4 className="font-semibold text-white mb-3">Share Allocation</h4>
                        <p className="text-sm text-slate-400 mb-3">Ownership structure and equity distribution</p>
                        {sellerDocuments?.share_allocation_shares && sellerDocuments?.share_allocation_share_price ? (
                          <div className="bg-slate-900/50 p-3 rounded border border-slate-600 space-y-2">
                            <div className="flex justify-between">
                              <span className="text-sm text-slate-400">Total Shares:</span>
                              <span className="text-sm font-semibold text-blue-400">{sellerDocuments.share_allocation_shares}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-sm text-slate-400">Price per Share:</span>
                              <span className="text-sm font-semibold text-green-400">${sellerDocuments.share_allocation_share_price}</span>
                            </div>
                            {sellerDocuments.share_allocation_total_amount && (
                              <div className="flex justify-between border-t border-slate-600 pt-2 mt-2">
                                <span className="text-sm text-slate-400">Total Valuation:</span>
                                <span className="text-sm font-semibold text-purple-400">${sellerDocuments.share_allocation_total_amount.toLocaleString()}</span>
                              </div>
                            )}
                          </div>
                        ) : (
                          <p className="text-sm text-yellow-400">⚠️ Not submitted</p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Disclosure Notes */}
                  {sellerDocuments?.disclosure_notes && (
                    <div className="bg-amber-900/20 border border-amber-500/30 rounded-lg p-4">
                      <h4 className="font-semibold text-amber-300 mb-2">🔐 Privacy Restrictions</h4>
                      <p className="text-sm text-amber-200">{sellerDocuments.disclosure_notes}</p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="bg-yellow-900/20 border border-yellow-600/50 rounded-lg p-4 text-yellow-300">
                  <p className="text-sm">⚠️ No documents found for this pitch</p>
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={() => setStage(5)}
                  className="flex-1 px-6 py-3 bg-slate-700 hover:bg-slate-600 text-white font-semibold rounded-lg transition"
                >
                  Back
                </button>
                <button
                  onClick={() => setStage(2)}
                  className="flex-1 px-6 py-3 bg-gradient-to-r from-pink-500 to-purple-500 hover:from-pink-600 hover:to-purple-600 text-white font-semibold rounded-lg transition flex items-center justify-center gap-2"
                >
                  Review Terms <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* Stage 2: Agreement */}
          {stage === 2 && (
            <div className="space-y-6">
              <h3 className="text-xl font-bold text-white">Review Original Pitch Agreement</h3>
              
              <div className="bg-slate-800/50 rounded-lg p-6 border border-slate-700 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <h4 className="text-slate-400 text-sm font-semibold mb-1">📺 Pitch Title</h4>
                    <p className="text-white font-bold text-lg">{pitch?.title || 'N/A'}</p>
                  </div>
                  <div>
                    <h4 className="text-slate-400 text-sm font-semibold mb-1">👤 Creator</h4>
                    <p className="text-white font-bold text-lg">{pitch?.creator_name || 'Unknown'}</p>
                  </div>
                  <div>
                    <h4 className="text-slate-400 text-sm font-semibold mb-1">📊 Pitch Type</h4>
                    <p className="text-white font-bold">{pitch?.pitch_type || 'Equity'}</p>
                  </div>
                  <div>
                    <h4 className="text-slate-400 text-sm font-semibold mb-1">🏢 Category</h4>
                    <p className="text-white font-bold">{pitch?.category || 'Technology'}</p>
                  </div>
                </div>

                <div className="border-t border-slate-700 pt-4">
                  <h4 className="text-slate-400 text-sm font-semibold mb-2">📋 Pitch Description</h4>
                  <p className="text-slate-200 text-sm leading-relaxed">{pitch?.description || 'No description provided'}</p>
                </div>

                <div className="grid grid-cols-3 gap-3 bg-slate-900/50 p-4 rounded-lg border border-slate-600/30">
                  <div>
                    <p className="text-slate-400 text-xs">Already Raised</p>
                    <p className="text-green-400 font-bold text-lg">{pitch?.raised_amount || pitch?.raised || '$0'}</p>
                  </div>
                  <div>
                    <p className="text-slate-400 text-xs">Funding Goal</p>
                    <p className="text-blue-400 font-bold text-lg">{pitch?.target_funding || pitch?.goal || '$500K'}</p>
                  </div>
                  <div>
                    <p className="text-slate-400 text-xs">Equity Offering</p>
                    <p className="text-purple-400 font-bold text-lg">{pitch?.equity_offering || pitch?.equity || '10%'}</p>
                  </div>
                </div>

                {pitch?.has_ip && (
                  <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3 flex gap-2">
                    <span className="text-blue-300 text-sm">🔒 This pitch has intellectual property protection</span>
                  </div>
                )}
              </div>

              <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700">
                <h4 className="font-semibold text-white mb-3">📜 Investment Terms & Conditions</h4>
                <div className="text-slate-300 text-sm space-y-2 max-h-64 overflow-y-auto">
                  <p>✅ <strong>Investment Type:</strong> {investmentType === 'buy' ? 'Equity Purchase' : investmentType === 'partner' ? 'Partnership Agreement' : 'Financial Support'}</p>
                  <p>🏢 <strong>Business:</strong> {businessProfile.business_name}</p>
                  <p>💼 <strong>Pitch:</strong> {pitch.title}</p>
                  <p>📊 <strong>Pitch Description:</strong> {pitch.description}</p>
                  <p>💰 <strong>Funding Goal:</strong> {pitch?.target_funding || pitch?.goal || '$500K'}</p>
                  <p>📈 <strong>Equity Offered:</strong> {pitch?.equity_offering || pitch?.equity || '10%'}</p>
                  <p>🔐 <strong>Payment Method:</strong> ICAN Wallet with escrow protection</p>
                  <p>✅ <strong>Escrow Protection:</strong> All investments are held in ICAN escrow pending multi-signature approval from existing shareholders.</p>
                  <p>🔏 <strong>Release Requirement:</strong> 60% of shareholders (minimum 10 members) must sign to release funds.</p>
                  <p>📱 <strong>Verification:</strong> PIN and device location will be recorded on the sealed agreement.</p>
                  <p>👥 <strong>Shareholder Addition:</strong> You will be automatically added as a shareholder upon seal finalization.</p>
                </div>
              </div>

              <label className="flex items-center gap-3 text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={agreedToTerms}
                  onChange={(e) => setAgreedToTerms(e.target.checked)}
                  className="w-5 h-5"
                />
                I have read and agree to all terms and conditions
              </label>

              <button
                onClick={() => setStage(3)}
                disabled={!agreedToTerms}
                className="w-full px-6 py-3 bg-gradient-to-r from-pink-500 to-purple-500 hover:from-pink-600 hover:to-purple-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition flex items-center justify-center gap-2"
              >
                Continue <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Stage 3: Share Allocation */}
          {stage === 3 && (
            <div className="space-y-6">
              <h3 className="text-xl font-bold text-white">Share Allocation</h3>
              
              <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700 space-y-2 text-sm">
                <div className="flex justify-between text-slate-300">
                  <span>📊 Pitch:</span>
                  <span className="text-white font-semibold">{pitch?.title}</span>
                </div>
                <div className="flex justify-between text-slate-300">
                  <span>💰 Funding Goal:</span>
                  <span className="text-white font-semibold">{pitch?.target_funding || pitch?.goal || '$500K'}</span>
                </div>
                <div className="flex justify-between text-slate-300">
                  <span>📈 Total Equity:</span>
                  <span className="text-white font-semibold">{pitch?.equity_offering || pitch?.equity || '10%'}</span>
                </div>
                <div className="flex justify-between text-slate-300">
                  <span>💵 Per Share Price:</span>
                  <span className="text-white font-semibold">${sharePrice.toFixed(2)} ICAN</span>
                </div>
              </div>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-slate-300 font-semibold mb-2">Number of Shares to Purchase</label>
                  <input
                    type="number"
                    value={sharesAmount}
                    onChange={(e) => setSharesAmount(e.target.value)}
                    placeholder="Enter number of shares"
                    min="1"
                    className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-500"
                  />
                  <p className="text-xs text-slate-400 mt-1">Minimum 1 share recommended</p>
                </div>

                {totalInvestment > 0 && (
                  <div className="bg-gradient-to-r from-pink-500/20 to-purple-500/20 border border-pink-500/50 rounded-lg p-4 space-y-2">
                    <p className="text-slate-300">
                      <span className="font-semibold text-white">{sharesAmount} Share{sharesAmount !== '1' ? 's' : ''}</span>
                      <span className="text-slate-400"> × </span>
                      <span className="font-semibold text-white">${sharePrice.toFixed(2)}</span>
                    </p>
                    <div className="border-t border-pink-500/30 pt-2">
                      <p className="text-slate-300">
                        <span className="font-semibold text-white">Total Investment: </span>
                        <span className="text-2xl font-bold text-pink-400">${totalInvestment.toFixed(2)}</span>
                      </p>
                    </div>
                    <p className="text-xs text-slate-400">
                      Equity Stake: ~{((parseFloat(sharesAmount) / 1000) * (parseFloat(pitch?.equity_offering || '10') || 10)).toFixed(2)}% of {pitch?.equity_offering || '10%'} offering
                    </p>
                  </div>
                )}
              </div>

              <button
                onClick={() => setStage(4)}
                disabled={!sharesAmount || totalInvestment === 0}
                className="w-full px-6 py-3 bg-gradient-to-r from-pink-500 to-purple-500 hover:from-pink-600 hover:to-purple-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition"
              >
                Proceed to ICAN Wallet
              </button>
            </div>
          )}

          {/* Stage 5: Wallet Integration */}
          {stage === 5 && (
            <div className="space-y-6">
              <h3 className="text-xl font-bold text-white flex items-center gap-2">
                <Shield className="w-6 h-6" />
                ICAN Wallet - Investment Summary
              </h3>

              <div className="bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-700 rounded-lg p-6 space-y-4">
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between text-slate-300">
                    <span>📺 Pitch Title:</span>
                    <span className="text-white font-semibold">{pitch?.title}</span>
                  </div>
                  <div className="flex items-center justify-between text-slate-300">
                    <span>🏢 Business:</span>
                    <span className="text-white font-semibold">{businessProfile.business_name}</span>
                  </div>
                  <div className="flex items-center justify-between text-slate-300">
                    <span>👤 Creator:</span>
                    <span className="text-white font-semibold">{pitch?.creator_name || 'Unknown'}</span>
                  </div>
                </div>

                <div className="border-t border-slate-700 pt-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Investment Amount:</span>
                    <span className="text-2xl font-bold text-green-400">${totalInvestment.toFixed(2)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Shares Purchasing:</span>
                    <span className="text-xl font-semibold text-blue-400">{sharesAmount} shares @ ${sharePrice.toFixed(2)}/share</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Current Wallet Balance:</span>
                    <span className="text-xl font-semibold text-blue-400">$5,250.00</span>
                  </div>
                  <div className="border-t border-slate-700 pt-3 flex items-center justify-between">
                    <span className="text-slate-400">After Investment:</span>
                    <span className="text-xl font-semibold text-slate-300">${(5250 - totalInvestment).toFixed(2)}</span>
                  </div>
                </div>
              </div>

              <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 space-y-2">
                <p className="text-blue-300 text-sm flex gap-2">
                  <span>💳</span>
                  <span><strong>Escrow Protection:</strong> Your ${totalInvestment.toFixed(2)} investment will be securely held in ICAN Escrow until {signatures.length >= mockShareholders.length * 0.6 ? 'completed' : '60% of shareholders sign'}.</span>
                </p>
                <p className="text-blue-300 text-sm flex gap-2">
                  <span>🔐</span>
                  <span><strong>Security:</strong> Funds are protected and cannot be transferred until multi-signature approval is complete.</span>
                </p>
              </div>

              <button
                onClick={() => setStage(5)}
                className="w-full px-6 py-3 bg-gradient-to-r from-pink-500 to-purple-500 hover:from-pink-600 hover:to-purple-600 text-white font-semibold rounded-lg transition"
              >
                Authorize with PIN
              </button>
            </div>
          )}

          {/* Stage 5: Payment Execution & PIN */}
          {stage === 5 && (
            <div className="space-y-6">
              <h3 className="text-xl font-bold text-white flex items-center gap-2">
                <Lock className="w-6 h-6" />
                Secure Payment
              </h3>

              <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700">
                <p className="text-slate-300 mb-4">Enter your 4-6 digit PIN to authorize this investment:</p>
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-slate-300 font-semibold mb-2">Enter PIN</label>
                    <div className="flex gap-2">
                      <input
                        type={showPin ? 'text' : 'password'}
                        value={pin}
                        onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        placeholder="••••"
                        maxLength="6"
                        className="flex-1 px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-center text-2xl tracking-widest placeholder-slate-500"
                      />
                      <button
                        onClick={() => setShowPin(!showPin)}
                        className="p-2 hover:bg-slate-700 rounded-lg transition text-slate-400"
                      >
                        {showPin ? '👁️' : '🙈'}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-slate-300 font-semibold mb-2">Confirm PIN</label>
                    <input
                      type={showPin ? 'text' : 'password'}
                      value={pinConfirm}
                      onChange={(e) => setPinConfirm(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder="••••"
                      maxLength="6"
                      className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-center text-2xl tracking-widest placeholder-slate-500"
                    />
                  </div>
                </div>

                {error && (
                  <div className="mt-3 p-3 bg-red-500/20 border border-red-500/50 rounded text-red-300 text-sm">
                    {error}
                  </div>
                )}

                {pinVerified && (
                  <div className="mt-3 p-3 bg-green-500/20 border border-green-500/50 rounded text-green-300 text-sm flex items-center gap-2">
                    <CheckCircle className="w-4 h-4" />
                    PIN verified! Processing payment to escrow...
                  </div>
                )}
              </div>

              <button
                onClick={() => {
                  if (!pinVerified) {
                    verifyPin();
                  } else {
                    setStage(6);
                  }
                }}
                disabled={loading || (!pin || !pinConfirm)}
                className="w-full px-6 py-3 bg-gradient-to-r from-pink-500 to-purple-500 hover:from-pink-600 hover:to-purple-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition"
              >
                {loading ? 'Processing...' : pinVerified ? 'Continue to Signatures' : 'Verify PIN'}
              </button>
            </div>
          )}

          {/* Stage 7: Pending Signatures */}
          {stage === 7 && (
            <div className="space-y-6">
              <h3 className="text-xl font-bold text-white flex items-center gap-2">
                <Users className="w-6 h-6" />
                Awaiting Shareholder Signatures
              </h3>

              <div className="bg-gradient-to-r from-yellow-500/20 to-orange-500/20 border border-yellow-500/50 rounded-lg p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-yellow-300">Signatures Required: 60%</span>
                  <span className="text-2xl font-bold text-yellow-400">{signaturePercentage.toFixed(0)}%</span>
                </div>
                <div className="w-full bg-slate-800 rounded-full h-3 overflow-hidden">
                  <div
                    className="bg-gradient-to-r from-yellow-500 to-orange-500 h-full transition-all duration-500"
                    style={{ width: `${Math.min(signaturePercentage, 100)}%` }}
                  />
                </div>
                <p className="text-sm text-slate-300">
                  {signatures.length} of {mockShareholders.length} shareholders signed
                </p>
              </div>

              <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700 max-h-64 overflow-y-auto space-y-2">
                <h4 className="font-semibold text-white mb-3 flex items-center gap-2">
                  <Clock className="w-4 h-4" />
                  Signature Timeline
                </h4>
                {mockShareholders.map(shareholder => {
                  const signature = signatures.find(s => s.id === shareholder.id);
                  return (
                    <div
                      key={shareholder.id}
                      className={`flex items-center justify-between p-3 rounded-lg ${
                        signature
                          ? 'bg-green-500/10 border border-green-500/30'
                          : 'bg-slate-700/30 border border-slate-600/30'
                      }`}
                    >
                      <div>
                        <p className="font-medium text-white">{shareholder.name}</p>
                        <p className="text-xs text-slate-400">{shareholder.email}</p>
                      </div>
                      {signature ? (
                        <div className="text-right">
                          <CheckCircle className="w-5 h-5 text-green-400 ml-auto" />
                          <p className="text-xs text-green-400 mt-1">
                            {new Date(signature.timestamp).toLocaleTimeString()}
                          </p>
                        </div>
                      ) : (
                        <Clock className="w-5 h-5 text-slate-500" />
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
                <p className="text-blue-300 text-sm">
                  ⏳ Your payment of ${totalInvestment.toFixed(2)} is securely held in ICAN Escrow. Once 60% of shareholders sign, your investment will be automatically sealed and you'll be added to the business profile.
                </p>
              </div>
            </div>
          )}

          {/* Stage 7: Finalized */}
          {stage === 7 && (
            <div className="space-y-6">
              <div className="text-center space-y-3">
                <CheckCircle className="w-16 h-16 text-green-400 mx-auto animate-bounce" />
                <h3 className="text-2xl font-bold text-white">Investment Sealed!</h3>
                <p className="text-slate-400">Your agreement has been sealed and is now recorded.</p>
              </div>

              {qrCodeUrl && (
                <div className="bg-white p-4 rounded-lg flex justify-center">
                  <img src={qrCodeUrl} alt="Agreement Seal" className="w-64 h-64" />
                </div>
              )}

              <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700 space-y-3">
                <h4 className="font-semibold text-white">Investment Summary</h4>
                <div className="space-y-2 text-sm text-slate-300">
                  <div className="flex justify-between">
                    <span>Pitch:</span>
                    <span className="text-white font-semibold">{pitch?.title}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Business:</span>
                    <span className="text-white font-semibold">{businessProfile.business_name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Escrow ID:</span>
                    <span className="text-green-400 font-mono">{escrowId}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Shares:</span>
                    <span className="font-semibold">{sharesAmount} shares @ ${sharePrice.toFixed(2)}/share</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Investment Amount:</span>
                    <span className="font-semibold">${totalInvestment.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Shareholders Signed:</span>
                    <span className="font-semibold">{signatures.length}/{mockShareholders.length} (100%)</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Status:</span>
                    <span className="text-green-400 font-semibold">SEALED ✓</span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={downloadQRCode}
                  className="px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition flex items-center justify-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  Download Seal
                </button>
                <button
                  onClick={onClose}
                  className="px-4 py-3 bg-gradient-to-r from-pink-500 to-purple-500 hover:from-pink-600 hover:to-purple-600 text-white font-semibold rounded-lg transition"
                >
                  Complete
                </button>
              </div>

              <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4">
                <p className="text-green-300 text-sm">
                  ✅ You have been successfully added as a shareholder to <strong>{businessProfile.business_name}</strong> for the pitch "<strong>{pitch?.title}</strong>"! Your ${totalInvestment.toFixed(2)} investment ({sharesAmount} shares) is now active and you have full access to the business profile.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ShareSigningFlow;
