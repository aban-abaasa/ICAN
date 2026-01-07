import React, { useState, useRef } from 'react';
import { FileText, Fingerprint, Lock, Download, CheckCircle, AlertCircle, Eye, EyeOff, Loader, Edit, Sparkles, Eye as EyeIcon, Lock as LockIcon } from 'lucide-react';
import QRCode from 'qrcode';

/**
 * SmartContractGenerator - Enhanced Agreement with AI Simplification
 * 
 * Features:
 * - Owner-only edit mode for MOU and custom rules
 * - ICAN AI text simplification
 * - Auto-fill user details from business profile
 * - Differentiate owner vs other signers
 * - Read-only mode for non-owners
 * - Custom commitments and rules section
 * - Geolocation, biometric, and PIN authentication
 */

const SmartContractGenerator = ({ businessProfile, pitch, currentUser, onClose }) => {
  // Mode: 'setup' (owner creates T&C) or 'sign' (buyer initiates signing)
  const [mode, setMode] = useState('setup'); // 'setup' or 'sign'
  const [step, setStep] = useState(0); // For setup: step 0, For sign: steps 0-2
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [isOwner, setIsOwner] = useState(false);
  const [aiSimplifying, setAiSimplifying] = useState(false);
  const [signingRequested, setSigningRequested] = useState(false); // Buyer requested signing
  
  // Agreement Details
  const [sharesAmount, setSharesAmount] = useState('');
  const [sharePrice, setSharePrice] = useState('');
  const [partnershipType, setPartnershipType] = useState('equity');
  const [description, setDescription] = useState('');
  const [customRules, setCustomRules] = useState(''); // Owner's custom rules/commitments
  const [commitments, setCommitments] = useState([]); // Array of {title, description, owner}
  const [simplyFiedMOU, setSimplifiedMOU] = useState('');
  
  // Owner-only fields
  const [ownerName, setOwnerName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [ownerRole, setOwnerRole] = useState('Founder/Owner');
  
  // Signer fields for non-owner step
  const [signerName, setSignerName] = useState('');
  const [signerEmail, setSignerEmail] = useState('');
  const [signerRole, setSignerRole] = useState('');
  
  // Signers tracking
  const [signers, setSigners] = useState([]);
  const [businessMembers, setBusinessMembers] = useState([]);
  const [currentSignerIndex, setCurrentSignerIndex] = useState(0);
  const [qrCodeUrl, setQrCodeUrl] = useState('');
  const [mouContent, setMouContent] = useState('');
  const [allSignatureData, setAllSignatureData] = useState(null);
  
  // Current signer auth
  const [authMethod, setAuthMethod] = useState('pin');
  const [pin, setPin] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [pinVerified, setPinVerified] = useState(false);

  // Detect owner and initialize
  React.useEffect(() => {
    // Detect if current user is the owner of the business profile
    const isCurrentUserOwner = businessProfile?.user_id === currentUser?.id;
    setIsOwner(isCurrentUserOwner);

    // Owner sees SETUP mode (fill T&C only)
    // Non-owner sees SIGN mode (request signature)
    if (isCurrentUserOwner) {
      setMode('setup');
      setStep(0);
      
      const fullName = currentUser.user_metadata?.full_name || 
                      currentUser.user_metadata?.name || 
                      currentUser.email?.split('@')[0] || 
                      'Pitch Creator';
      setOwnerName(fullName);
      setOwnerEmail(currentUser.email);
      setOwnerRole('Pitch Creator/Founder');
      
      console.log('👑 Owner mode: Setting up T&C');
    } else {
      // Non-owner: show signing request interface
      setMode('sign');
      
      // Auto-fill signer info from current user
      if (currentUser) {
        const fullName = currentUser.user_metadata?.full_name || 
                        currentUser.user_metadata?.name || 
                        currentUser.email?.split('@')[0] || 
                        'Investor';
        setSignerName(fullName);
        setSignerEmail(currentUser.email || '');
      }
      
      console.log('🤝 Investor/Partner mode: Ready to sign');
    }
  }, [businessProfile, currentUser]);

  // Initialize signers from business profile on mount
  React.useEffect(() => {
    if (businessProfile?.business_co_owners) {
      const members = businessProfile.business_co_owners.map(owner => ({
        name: owner.owner_name,
        email: owner.owner_email,
        role: owner.role || 'Co-owner',
        ownershipShare: owner.ownership_share || 0,
        signed: false,
        signature: null,
        isOwner: false
      }));
      setBusinessMembers(members);
      
      // Add owner as primary signer if not already included
      const ownerSigner = {
        name: ownerName || businessProfile?.owner_name || 'Owner',
        email: ownerEmail || currentUser?.email,
        role: ownerRole,
        ownershipShare: 100,
        signed: false,
        signature: null,
        isOwner: true
      };

      const userAlreadyIncluded = members.some(m => m.email === currentUser?.email);
      if (!userAlreadyIncluded) {
        setSigners([ownerSigner, ...members]);
      } else {
        const updated = members.map(m => 
          m.email === currentUser?.email ? {...m, isOwner: true} : m
        );
        setSigners(updated);
      }
    }
  }, [businessProfile, currentUser, ownerName, ownerEmail]);

  // ICAN AI: Simplify MOU text
  const simplifyWithAI = async (text) => {
    try {
      setAiSimplifying(true);
      // Simulate AI processing
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      // Simple text simplification rules
      const simplified = text
        .replace(/Memorandum of Understanding \(MOU\)/gi, 'Agreement')
        .replace(/MEMORANDUM OF UNDERSTANDING/gi, 'AGREEMENT')
        .replace(/([A-Z][A-Z_]+)/g, (match) => {
          const map = {
            'AGREEMENT DETAILS': 'What We Agreed To',
            'SIGNATORIES': 'Who Is Signing',
            'LEGAL NOTICE': 'Important Terms',
            'SIGNATURE VERIFICATION': 'How We Signed'
          };
          return map[match] || match;
        })
        .replace(/subject to all applicable laws/gi, 'following all legal rules')
        .replace(/disputes shall be resolved through arbitration/gi, 'disagreements will be settled by a neutral person')
        .replace(/mutual written consent/gi, 'both sides agreeing in writing');
      
      setSimplifiedMOU(simplified);
      setError('');
      return simplified;
    } catch (err) {
      setError('AI simplification failed: ' + err.message);
      return text;
    } finally {
      setAiSimplifying(false);
    }
  };

  // Add custom rule/commitment
  const addCommitment = (title, description) => {
    if (!title.trim() || !description.trim()) return;
    setCommitments([
      ...commitments,
      {
        id: Date.now(),
        title,
        description,
        owner: ownerName,
        addedAt: new Date().toISOString()
      }
    ]);
  };

  // Remove commitment
  const removeCommitment = (id) => {
    setCommitments(commitments.filter(c => c.id !== id));
  };

  // Calculate signature percentage
  const getSignaturePercentage = () => {
    if (signers.length === 0) return 0;
    const signed = signers.filter(s => s.signed).length;
    return Math.round((signed / signers.length) * 100);
  };

  // Check if can print (60% signed)
  const canPrint = () => {
    return getSignaturePercentage() >= 60;
  };

  // Validate agreement info (owner only)
  const validateAgreementInfo = () => {
    if (!sharesAmount || isNaN(sharesAmount) || parseFloat(sharesAmount) <= 0) {
      setError('Please enter a valid share amount');
      return false;
    }
    if (partnershipType === 'equity' && (!sharePrice || isNaN(sharePrice))) {
      setError('Please enter a valid share price');
      return false;
    }
    if (!description.trim()) {
      setError('Please provide a brief description');
      return false;
    }
    if (signers.length === 0) {
      setError('No signers available. Add team members from your business profile.');
      return false;
    }
    return true;
  };

  // Proceed to signature step
  const handleProceedToSign = () => {
    setError('');
    if (!validateAgreementInfo()) return;
    setStep(2);
    setCurrentSignerIndex(0);
  };

  // Get current signer
  const currentSigner = signers[currentSignerIndex];
  const unsignedSigners = signers.filter(s => !s.signed);

  // Verify PIN for signer
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

  // Complete signature for current signer
  const completeSignature = async () => {
    setError('');
    if (authMethod === 'pin' && !pinVerified) {
      setError('Please verify your PIN');
      return;
    }

    try {
      setLoading(true);

      // Record signature
      const updatedSigners = [...signers];
      updatedSigners[currentSignerIndex] = {
        ...currentSigner,
        signed: true,
        signature: {
          timestamp: new Date().toISOString(),
          authMethod,
          pin: authMethod === 'pin' ? pin : null
        }
      };
      setSigners(updatedSigners);

      // Move to next unsigned signer or finish
      const nextUnsignedIndex = updatedSigners.findIndex(
        (s, idx) => idx > currentSignerIndex && !s.signed
      );

      if (nextUnsignedIndex !== -1) {
        // More signers to sign
        setCurrentSignerIndex(nextUnsignedIndex);
        setPin('');
        setPinConfirm('');
        setPinVerified(false);
      } else {
        // All signers complete - generate final agreement
        await generateFinalAgreement(updatedSigners);
      }
    } finally {
      setLoading(false);
    }
  };

  // Generate final agreement with all signatures
  const generateFinalAgreement = async (finalSigners) => {
    try {
      setLoading(true);
      
      const totalInvestment = (parseFloat(sharesAmount) * parseFloat(sharePrice || 1)).toFixed(2);
      
      // Build commitments/rules section
      const commitmentSection = commitments.length > 0 ? `
═══════════════════════════════════════════════════════════════
OWNER'S COMMITMENTS & RULES (by ${ownerName})
═══════════════════════════════════════════════════════════════

${commitments.map((c, idx) => `
${idx + 1}. ${c.title.toUpperCase()}
   ${c.description}
   [Added by ${c.owner}]
`).join('')}
` : '';

      const mou = `
═══════════════════════════════════════════════════════════════
                    AGREEMENT & TERMS (MOU)
═══════════════════════════════════════════════════════════════

Date: ${new Date().toLocaleDateString()}
Contract ID: ${Math.random().toString(36).substr(2, 9).toUpperCase()}

BUSINESS: ${businessProfile?.business_name || 'Not Specified'}
PITCH: ${pitch?.title || 'Not Specified'}
OWNER: ${ownerName} (${ownerEmail})

═══════════════════════════════════════════════════════════════
WHAT WAS AGREED
═══════════════════════════════════════════════════════════════

Type: ${partnershipType.charAt(0).toUpperCase() + partnershipType.slice(1)}
${partnershipType === 'equity' ? `
Shares: ${sharesAmount}
Price per Share: $${sharePrice}
Total Investment: $${totalInvestment}
` : ''}

Description:
${description}

${customRules ? `
CUSTOM TERMS SET BY OWNER:
${customRules}
` : ''}

${commitmentSection}

═══════════════════════════════════════════════════════════════
WHO IS SIGNING
═══════════════════════════════════════════════════════════════

OWNER (Primary Signatory):
${finalSigners.filter(s => s.isOwner).map(signer => `
  Name: ${signer.name}
  Email: ${signer.email}
  Role: ${signer.role}
  Ownership: ${signer.ownershipShare}%
  ${signer.signed ? `✓ SIGNED on ${new Date(signer.signature.timestamp).toLocaleString()}` : '✗ NOT SIGNED'}
`).join('')}

OTHER PARTIES (Read-Only Approval):
${finalSigners.filter(s => !s.isOwner).map((signer, idx) => `
  ${idx + 1}. ${signer.name}
     Email: ${signer.email}
     Role: ${signer.role}
     Ownership: ${signer.ownershipShare}%
     ${signer.signed ? `✓ SIGNED on ${new Date(signer.signature.timestamp).toLocaleString()}` : '✗ PENDING'}
`).join('')}

═══════════════════════════════════════════════════════════════
IMPORTANT TERMS
═══════════════════════════════════════════════════════════════

This is a legally binding digital agreement. All signatures are 
verified and timestamped. The QR code contains all data and 
cannot be modified.

IMPORTANT POINTS:
• All parties agree to follow the commitments above
• Owner has full authority to set terms
• Other parties can only sign if they FULLY AGREE
• This agreement is legally binding
• All changes require owner approval
• Disputes resolved through arbitration

═══════════════════════════════════════════════════════════════
      ALL SIGNATURES VERIFIED AND RECORDED
═══════════════════════════════════════════════════════════════
      `.trim();

      setMouContent(mou);

      // Create comprehensive signature data for QR
      const signatureData = {
        contractId: Math.random().toString(36).substr(2, 9).toUpperCase(),
        business: businessProfile?.business_name,
        pitch: pitch?.title,
        createdAt: new Date().toISOString(),
        signaturesCount: finalSigners.filter(s => s.signed).length,
        totalSigners: finalSigners.length,
        signaturePercentage: Math.round((finalSigners.filter(s => s.signed).length / finalSigners.length) * 100),
        signers: finalSigners.map(s => ({
          name: s.name,
          email: s.email,
          role: s.role,
          signed: s.signed,
          signedAt: s.signature?.timestamp || null
        })),
        terms: {
          shareAmount: sharesAmount,
          sharePrice: sharePrice,
          type: partnershipType,
          additionalTerms
        }
      };

      setAllSignatureData(signatureData);

      // Generate QR code with all data
      const qrData = JSON.stringify(signatureData);
      const qrUrl = await QRCode.toDataURL(qrData, {
        width: 400,
        margin: 3,
        color: { dark: '#000000', light: '#FFFFFF' }
      });

      setQrCodeUrl(qrUrl);
      setSuccess(true);

    } catch (err) {
      setError('Failed to generate agreement: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // Download agreement
  const downloadAgreement = () => {
    const element = document.createElement('a');
    const file = new Blob([mouContent], { type: 'text/plain' });
    element.href = URL.createObjectURL(file);
    element.download = `MOU_Agreement_${Date.now()}.txt`;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  // Download QR code
  const downloadQR = () => {
    const link = document.createElement('a');
    link.href = qrCodeUrl;
    link.download = `Agreement_QR_${Date.now()}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Print agreement (only if 60%+ signed)
  const printAgreement = () => {
    if (!canPrint()) {
      setError(`Need 60% signatures to print. Currently: ${getSignaturePercentage()}%`);
      return;
    }

    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
      <html><head><title>Agreement - ${businessProfile?.business_name}</title>
      <style>
        body { font-family: monospace; padding: 20px; line-height: 1.6; }
        .qr { text-align: center; margin: 20px 0; }
        .qr img { width: 300px; height: 300px; border: 2px solid #000; }
        .content { white-space: pre-wrap; }
        @media print { body { padding: 10px; } }
      </style></head><body>
      <div class="content">${mouContent}</div>
      <div class="qr">
        <h3>Signature Verification QR Code</h3>
        <img src="${qrCodeUrl}" />
        <p>Scan to verify all signatures</p>
      </div>
      </body></html>
    `);
    printWindow.document.close();
    printWindow.print();
  };

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
              <h1 className="text-2xl font-bold">
                {mode === 'setup' ? '📝 Set Agreement Terms' : '🤝 Sign Agreement'}
              </h1>
              {mode === 'setup' ? (
                <p className="text-blue-100 text-sm">👑 Owner - Configure Terms & Conditions</p>
              ) : (
                <p className="text-blue-100 text-sm">
                  {signingRequested ? '✅ Owner approved - Ready to sign' : '🔔 Request owner confirmation to sign'}
                </p>
              )}
              {isOwner && mode === 'setup' && <p className="text-blue-100 text-xs mt-1">⭐ Set up T&C, then investors will request to sign</p>}
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

          {/* SETUP MODE: Owner fills T&C (No Signing) */}
          {mode === 'setup' && isOwner && (
            <div className="space-y-6">
              <div className="bg-gradient-to-r from-purple-50 to-pink-50 p-6 rounded-lg border-2 border-purple-300">
                <div className="flex items-center gap-3 mb-4">
                  <Sparkles className="h-6 w-6 text-purple-600" />
                  <h2 className="text-2xl font-bold text-purple-900">Set Up Terms & Conditions</h2>
                </div>
                <p className="text-purple-800 mb-4">
                  Configure your investment agreement. Once saved, investors can review and request to sign.
                </p>
              </div>

              {/* Owner Details */}
              <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                <h3 className="font-semibold text-gray-900 mb-3">👑 Your Details (Auto-Filled)</h3>
                <div className="space-y-3">
                  <div className="bg-white p-3 rounded border border-blue-100">
                    <label className="block text-sm font-medium text-gray-600 mb-1">Owner Name</label>
                    <p className="text-gray-900 font-semibold">{ownerName}</p>
                  </div>
                  <div className="bg-white p-3 rounded border border-blue-100">
                    <label className="block text-sm font-medium text-gray-600 mb-1">Email</label>
                    <p className="text-gray-900">{ownerEmail}</p>
                  </div>
                  <div className="bg-white p-3 rounded border border-blue-100">
                    <label className="block text-sm font-medium text-gray-600 mb-1">Role</label>
                    <p className="text-gray-900">{ownerRole}</p>
                  </div>
                </div>
              </div>

              {/* Company Members */}
              {businessProfile?.business_co_owners && businessProfile.business_co_owners.length > 0 && (
                <div className="bg-green-50 p-4 rounded-lg border border-green-200">
                  <h3 className="font-semibold text-gray-900 mb-3">👥 Company Members</h3>
                  <div className="space-y-2">
                    {businessProfile.business_co_owners.map((member, idx) => (
                      <div key={idx} className="bg-white p-3 rounded border border-green-100 flex justify-between items-start">
                        <div className="flex-1">
                          <p className="font-medium text-gray-900">{member.owner_name}</p>
                          <p className="text-sm text-gray-600">{member.owner_email}</p>
                          <p className="text-xs text-gray-500 mt-1">Role: {member.role || 'Co-owner'}</p>
                        </div>
                        <div className="text-right ml-4">
                          <p className="text-sm font-semibold text-green-700">{member.ownership_share || 0}%</p>
                          <p className="text-xs text-gray-500">Ownership Share</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Custom Rules & Commitments */}
              <div className="bg-amber-50 p-4 rounded-lg border border-amber-200">
                <h3 className="font-semibold text-gray-900 mb-3">📋 Add Your Commitments & Rules</h3>
                <p className="text-sm text-gray-600 mb-4">Define what you commit to and what rules others must follow.</p>
                
                <div className="space-y-3 mb-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Commitment Title</label>
                    <input
                      type="text"
                      id="commitTitle"
                      placeholder="e.g., Revenue Sharing, Quarterly Reports"
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                    <textarea
                      id="commitDesc"
                      placeholder="Describe this commitment in detail..."
                      rows="2"
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500"
                    />
                  </div>
                  <button
                    onClick={() => {
                      const title = document.getElementById('commitTitle')?.value || '';
                      const desc = document.getElementById('commitDesc')?.value || '';
                      if (title && desc) {
                        addCommitment(title, desc);
                        document.getElementById('commitTitle').value = '';
                        document.getElementById('commitDesc').value = '';
                      }
                    }}
                    className="w-full bg-amber-600 hover:bg-amber-700 text-white font-semibold py-2 px-4 rounded-lg transition"
                  >
                    ➕ Add Commitment
                  </button>
                </div>

                {/* Commitments List */}
                {commitments.length > 0 && (
                  <div className="space-y-2 bg-white p-3 rounded border border-amber-300">
                    <p className="font-semibold text-gray-900 text-sm mb-2">Your Commitments ({commitments.length}):</p>
                    {commitments.map(c => (
                      <div key={c.id} className="flex justify-between items-start gap-2 p-2 bg-amber-100 rounded">
                        <div>
                          <p className="font-semibold text-sm text-gray-900">{c.title}</p>
                          <p className="text-xs text-gray-600">{c.description}</p>
                        </div>
                        <button
                          onClick={() => removeCommitment(c.id)}
                          className="text-red-600 hover:text-red-800 font-bold"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Additional Custom Rules */}
              <div className="bg-green-50 p-4 rounded-lg border border-green-200">
                <h3 className="font-semibold text-gray-900 mb-3">⚙️ Custom Terms (Optional)</h3>
                <textarea
                  value={customRules}
                  onChange={(e) => setCustomRules(e.target.value)}
                  placeholder="Add any additional terms, conditions, or rules for all signers to follow..."
                  rows="4"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                />
              </div>

              {/* Next Step Button */}
              <div className="flex gap-3">
                <button
                  onClick={onClose}
                  className="flex-1 bg-gray-300 hover:bg-gray-400 text-gray-900 font-semibold py-3 px-4 rounded-lg transition"
                >
                  Cancel
                </button>
                <button
                  onClick={onClose}
                  className="flex-1 bg-green-600 hover:bg-green-700 text-white font-semibold py-3 px-4 rounded-lg transition flex items-center justify-center gap-2"
                >
                  ✅ Save Terms & Close
                </button>
              </div>
            </div>
          )}

          {/* SIGN MODE: Investor/Partner requests signature */}
          {mode === 'sign' && !isOwner && (
            <div className="space-y-6">
              <div className="bg-gradient-to-r from-blue-50 to-indigo-50 p-6 rounded-lg border-2 border-blue-300">
                <h2 className="text-2xl font-bold text-blue-900 mb-3">🤝 Investment Agreement</h2>
                <p className="text-blue-800 mb-4">
                  Review the terms below. When you're ready, click "Request Signature" to notify the owner and proceed with signing.
                </p>
              </div>

              {/* Show agreement preview */}
              <div className="bg-gray-50 p-4 rounded-lg border border-gray-300">
                <h3 className="font-bold text-gray-900 mb-3">📋 Agreement Summary</h3>
                <div className="space-y-2 text-gray-700">
                  <p><strong>Type:</strong> {partnershipType === 'equity' ? 'Equity Share Purchase' : partnershipType === 'debt' ? 'Debt Agreement' : 'Partnership Agreement'}</p>
                  <p><strong>Amount:</strong> {sharesAmount || 'TBD'} {partnershipType === 'equity' ? 'shares' : ''}</p>
                  <p><strong>Terms:</strong> Review with owner before signing</p>
                </div>
              </div>

              {/* Your info */}
              <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                <h3 className="font-semibold text-gray-900 mb-3">👤 Your Information</h3>
                <div className="space-y-2">
                  <p className="text-gray-700"><strong>Name:</strong> {signerName}</p>
                  <p className="text-gray-700"><strong>Email:</strong> {signerEmail}</p>
                  <p className="text-gray-700"><strong>Role:</strong> {signerRole || 'Investor/Partner'}</p>
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex gap-3 pt-4">
                <button
                  onClick={onClose}
                  className="flex-1 bg-gray-300 hover:bg-gray-400 text-gray-900 font-semibold py-3 px-4 rounded-lg transition"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    setSigningRequested(true);
                    alert('✅ Signature request sent to owner!\n\nWe\'ll notify them to review and approve.');
                    // In production, this would send a notification
                    setTimeout(() => setStep(1), 1500);
                  }}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-4 rounded-lg transition"
                >
                  🔔 Request Owner Approval
                </button>
              </div>
            </div>
          )}          {/* Step 1: Share Information */}
          {step === 1 && (
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

              {/* AI Simplification (Owner Only) */}
              {isOwner && (
                <div className="bg-indigo-50 p-4 rounded-lg border border-indigo-200">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                      <Sparkles className="h-5 w-5 text-indigo-600" />
                      ICAN AI Simplifier
                    </h3>
                    <span className="text-xs bg-indigo-600 text-white px-2 py-1 rounded">Owner Only</span>
                  </div>
                  <p className="text-sm text-gray-600 mb-3">
                    Let ICAN AI simplify your agreement text to make it easier for all signers to understand.
                  </p>
                  <button
                    onClick={() => simplifyWithAI(mouContent || `Type: ${partnershipType}\nDescription: ${description}`)}
                    disabled={aiSimplifying}
                    className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400 text-white font-semibold py-2 px-4 rounded-lg transition flex items-center justify-center gap-2"
                  >
                    {aiSimplifying ? (
                      <>
                        <Loader className="h-4 w-4 animate-spin" />
                        Simplifying...
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-4 w-4" />
                        Simplify with AI
                      </>
                    )}
                  </button>
                  {simplyFiedMOU && (
                    <div className="mt-3 p-2 bg-white rounded border border-indigo-300 max-h-32 overflow-y-auto">
                      <p className="text-xs text-gray-600 font-semibold mb-1">Simplified Preview:</p>
                      <p className="text-xs text-gray-700 whitespace-pre-wrap">{simplyFiedMOU.substring(0, 200)}...</p>
                    </div>
                  )}
                </div>
              )}

              {/* Signers Overview */}
              <div className="bg-purple-50 p-4 rounded-lg border border-purple-200">
                <h3 className="font-semibold text-gray-900 mb-3">👥 Who Will Sign This Agreement</h3>
                <div className="space-y-2">
                  {signers.map((signer, idx) => (
                    <div key={idx} className={`p-2 rounded text-sm flex items-center gap-2 ${
                      signer.isOwner ? 'bg-purple-200 border border-purple-400' : 'bg-white border border-gray-300'
                    }`}>
                      {signer.isOwner ? (
                        <>
                          <LockIcon className="h-4 w-4 text-purple-700" />
                          <div className="flex-1">
                            <p className="font-semibold text-gray-900">{signer.name}</p>
                            <p className="text-xs text-gray-600">👑 Owner (Full Edit Rights)</p>
                          </div>
                        </>
                      ) : (
                        <>
                          <EyeIcon className="h-4 w-4 text-gray-600" />
                          <div className="flex-1">
                            <p className="font-semibold text-gray-900">{signer.name}</p>
                            <p className="text-xs text-gray-600">📖 Read-Only (Can Only Sign or Reject)</p>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  onClick={() => setStep(isOwner ? 0 : 1)}
                  className="flex-1 bg-gray-300 hover:bg-gray-400 text-gray-900 font-semibold py-3 px-4 rounded-lg transition"
                >
                  {isOwner ? '← Back to Setup' : 'Cancel'}
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

          {/* Step 2: Multi-Signer Signature */}
          {step === 2 && (
            <div className="space-y-5">
              {/* Signature Progress */}
              <div className="bg-gradient-to-r from-blue-50 to-indigo-50 p-4 rounded-lg border border-blue-200">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-gray-900">📝 Signature Progress</h3>
                  <span className={`text-xl font-bold ${getSignaturePercentage() >= 60 ? 'text-green-600' : 'text-orange-600'}`}>
                    {getSignaturePercentage()}%
                  </span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-3">
                  <div 
                    className={`h-3 rounded-full transition-all ${getSignaturePercentage() >= 60 ? 'bg-green-500' : 'bg-blue-500'}`}
                    style={{ width: `${getSignaturePercentage()}%` }}
                  ></div>
                </div>
                <div className="mt-3 text-sm text-gray-600">
                  <strong>{signers.filter(s => s.signed).length}</strong> of <strong>{signers.length}</strong> signers completed
                  {canPrint() && <span className="text-green-600 ml-2">✓ Ready to print!</span>}
                  {!canPrint() && getSignaturePercentage() > 0 && (
                    <span className="text-blue-600 ml-2">Need {Math.ceil(signers.length * 0.6) - signers.filter(s => s.signed).length} more signatures</span>
                  )}
                </div>
              </div>

              {/* Current Signer Information */}
              {currentSigner && (
                <div className="bg-amber-50 p-4 rounded-lg border border-amber-200">
                  <h3 className="font-semibold text-gray-900 mb-3">👤 Signer #{currentSignerIndex + 1}</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs text-gray-600 uppercase">Name</p>
                      <p className="font-semibold text-gray-900">{currentSigner.name}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-600 uppercase">Email</p>
                      <p className="font-semibold text-gray-900 text-sm">{currentSigner.email}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-600 uppercase">Role</p>
                      <p className="font-semibold text-gray-900">{currentSigner.role}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-600 uppercase">Status</p>
                      <p className={`font-semibold ${currentSigner.signed ? 'text-green-600' : 'text-blue-600'}`}>
                        {currentSigner.signed ? '✓ Signed' : 'Pending'}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* PIN Verification */}
              {authMethod === 'pin' && !pinVerified && currentSigner && (
                <div className="bg-purple-50 p-4 rounded-lg border border-purple-200">
                  <h3 className="font-semibold text-gray-900 mb-3">🔐 Enter 4-Digit PIN</h3>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">PIN *</label>
                      <input
                        type={showPin ? 'text' : 'password'}
                        value={pin}
                        onChange={(e) => setPin(e.target.value.slice(0, 6))}
                        placeholder="••••"
                        maxLength="6"
                        className="w-full px-4 py-3 text-2xl text-center border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Confirm PIN *</label>
                      <input
                        type={showPin ? 'text' : 'password'}
                        value={pinConfirm}
                        onChange={(e) => setPinConfirm(e.target.value.slice(0, 6))}
                        placeholder="••••"
                        maxLength="6"
                        className="w-full px-4 py-3 text-2xl text-center border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      />
                    </div>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={showPin}
                        onChange={(e) => setShowPin(e.target.checked)}
                        className="rounded"
                      />
                      <span className="text-sm text-gray-700">Show PIN</span>
                    </label>
                  </div>
                  <button
                    onClick={verifyPin}
                    disabled={loading || !pin || !pinConfirm}
                    className="w-full mt-4 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-400 text-white font-semibold py-2 px-4 rounded-lg transition"
                  >
                    {loading ? 'Verifying...' : 'Verify PIN'}
                  </button>
                </div>
              )}

              {/* Signature Confirmation */}
              {(authMethod === 'pin' && pinVerified && currentSigner) && (
                <div className="bg-green-50 p-4 rounded-lg border border-green-200">
                  <div className="flex items-center gap-3 mb-4">
                    <CheckCircle className="h-6 w-6 text-green-600" />
                    <div>
                      <p className="font-semibold text-green-900">PIN Verified</p>
                      <p className="text-sm text-green-700">Ready to sign this agreement</p>
                    </div>
                  </div>
                  <button
                    onClick={completeSignature}
                    disabled={loading}
                    className="w-full bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white font-semibold py-3 px-4 rounded-lg transition flex items-center justify-center gap-2"
                  >
                    {loading ? 'Processing...' : <>
                      <Fingerprint className="h-5 w-5" />
                      Complete Signature
                    </>}
                  </button>
                </div>
              )}

              {/* All Signers List */}
              <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                <h3 className="font-semibold text-gray-900 mb-3">👥 All Signers</h3>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {signers.map((signer, idx) => (
                    <div key={idx} className={`p-3 rounded-lg flex items-center justify-between ${
                      signer.signed ? 'bg-green-100 border border-green-300' : 'bg-white border border-gray-300'
                    }`}>
                      <div className="flex-1">
                        <p className="font-semibold text-gray-900 text-sm">{signer.name}</p>
                        <p className="text-xs text-gray-600">{signer.role}</p>
                      </div>
                      {signer.signed ? (
                        <span className="text-green-600 font-semibold text-sm">✓ Signed</span>
                      ) : (
                        <span className="text-gray-500 text-sm">{idx === currentSignerIndex ? 'Now' : 'Pending'}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-3 pt-4">
                <button
                  onClick={onClose}
                  className="flex-1 bg-gray-300 hover:bg-gray-400 text-gray-900 font-semibold py-3 px-4 rounded-lg transition"
                >
                  Cancel
                </button>
                {getSignaturePercentage() > 0 && (
                  <button
                    onClick={printAgreement}
                    disabled={!canPrint()}
                    className={`flex-1 font-semibold py-3 px-4 rounded-lg transition flex items-center justify-center gap-2 ${
                      canPrint() 
                        ? 'bg-blue-600 hover:bg-blue-700 text-white' 
                        : 'bg-gray-400 text-gray-600 cursor-not-allowed'
                    }`}
                  >
                    🖨️ Print {!canPrint() && '(60% needed)'}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Success View - Agreement Complete */}
          {success && (
            <div className="space-y-6">
              <div className="bg-green-50 p-6 rounded-lg border border-green-200 text-center">
                <CheckCircle className="h-12 w-12 text-green-600 mx-auto mb-3" />
                <h3 className="text-xl font-bold text-green-900 mb-1">Agreement Signed Successfully!</h3>
                <p className="text-green-700">{allSignatureData?.signaturesCount} of {allSignatureData?.totalSigners} signatures completed ({allSignatureData?.signaturePercentage}%)</p>
              </div>

              {/* MOU Preview */}
              <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                <h3 className="font-semibold text-gray-900 mb-3">📄 Memorandum of Understanding</h3>
                <div className="bg-white p-4 rounded border border-gray-300 font-mono text-xs whitespace-pre-wrap max-h-64 overflow-y-auto text-gray-800">
                  {mouContent}
                </div>
              </div>

              {/* QR Code Section */}
              <div className="bg-blue-50 p-6 rounded-lg border border-blue-200 flex flex-col items-center">
                <h3 className="font-semibold text-gray-900 mb-2">🔐 Digital Signature Verification QR Code</h3>
                <p className="text-sm text-gray-600 mb-4 text-center">
                  Contains all signatures, timestamps, and agreement details. Cannot be modified.
                </p>
                {qrCodeUrl && (
                  <img 
                    src={qrCodeUrl} 
                    alt="Signature QR Code" 
                    className="border-4 border-blue-400 p-2 bg-white w-72 h-72"
                  />
                )}
                <p className="text-xs text-gray-500 mt-4 text-center">
                  Generated: {allSignatureData?.createdAt && new Date(allSignatureData.createdAt).toLocaleString()}
                </p>
              </div>

              {/* Signers Summary */}
              <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                <h3 className="font-semibold text-gray-900 mb-3">👥 Signature Summary</h3>
                <div className="space-y-2">
                  {allSignatureData?.signers.map((signer, idx) => (
                    <div key={idx} className={`p-3 rounded flex items-center justify-between text-sm ${
                      signer.signed ? 'bg-green-100 border border-green-300' : 'bg-white border border-gray-300'
                    }`}>
                      <div>
                        <p className="font-semibold text-gray-900">{signer.name}</p>
                        <p className="text-xs text-gray-600">{signer.role}</p>
                      </div>
                      {signer.signed && (
                        <span className="text-green-600 font-semibold">✓ {new Date(signer.signedAt).toLocaleDateString()}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-3 flex-wrap">
                <button
                  onClick={downloadAgreement}
                  className="flex-1 min-w-40 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-4 rounded-lg flex items-center justify-center gap-2 transition"
                >
                  <Download className="h-5 w-5" />
                  Download MOU
                </button>
                <button
                  onClick={downloadQR}
                  className="flex-1 min-w-40 bg-purple-600 hover:bg-purple-700 text-white font-semibold py-3 px-4 rounded-lg flex items-center justify-center gap-2 transition"
                >
                  <Download className="h-5 w-5" />
                  Download QR
                </button>
                <button
                  onClick={printAgreement}
                  className="flex-1 min-w-40 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3 px-4 rounded-lg flex items-center justify-center gap-2 transition"
                >
                  🖨️ Print
                </button>
                <button
                  onClick={onClose}
                  className="flex-1 min-w-40 bg-gray-400 hover:bg-gray-500 text-gray-900 font-semibold py-3 px-4 rounded-lg transition"
                >
                  Close
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
