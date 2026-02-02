import React, { useState } from 'react';
import { Shield, CheckCircle, Clock, AlertTriangle, FileText, Upload, X } from 'lucide-react';
import { analyzeContract, performSecurityCheck, getVerificationStatus, uploadAndAnalyzeDocument, getSupportedFileTypes } from '../../../services/simpleAIAdviceService';

/**
 * Contract Verification Component
 * Secure contract analysis with file upload support
 */
const ContractVerification = ({ isOpen, onClose }) => {
  const [contractText, setContractText] = useState('');
  const [uploadedFile, setUploadedFile] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [verificationStatus, setVerificationStatus] = useState(null);
  const [inputMode, setInputMode] = useState('text'); // 'text' or 'file'
  const [dragActive, setDragActive] = useState(false);
  
  const supportedTypes = getSupportedFileTypes();

  // Load verification status on component mount
  React.useEffect(() => {
    if (isOpen) {
      const status = getVerificationStatus();
      setVerificationStatus(status);
    }
  }, [isOpen]);

  // File upload handlers
  const handleFileSelect = (file) => {
    if (file) {
      setUploadedFile(file);
      setContractText(''); // Clear text input
      setInputMode('file');
    }
  };

  const handleFileDrop = (e) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files[0];
    handleFileSelect(file);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setDragActive(true);
  };

  const handleDragLeave = () => {
    setDragActive(false);
  };

  const removeFile = () => {
    setUploadedFile(null);
    setInputMode('text');
  };

  const handleAnalyzeContract = async () => {
    if (inputMode === 'text') {
      if (!contractText.trim() || contractText.length < 50) {
        alert('Please paste contract text (at least 50 characters)');
        return;
      }
    } else if (inputMode === 'file') {
      if (!uploadedFile) {
        alert('Please select a file to analyze');
        return;
      }
    }

    setIsAnalyzing(true);
    try {
      let contractAnalysis;
      
      if (inputMode === 'file') {
        // Analyze uploaded file
        contractAnalysis = await uploadAndAnalyzeDocument(uploadedFile);
      } else {
        // Analyze text input
        contractAnalysis = await analyzeContract(contractText);
      }
      
      const textForSecurity = inputMode === 'file' ? contractAnalysis.extractedText : contractText;
      const securityCheck = performSecurityCheck(textForSecurity);
      
      setAnalysis({
        contract: contractAnalysis,
        security: securityCheck
      });
    } catch (error) {
      console.error('Contract analysis failed:', error);
      alert('Analysis failed. Please try again.');
    }
    setIsAnalyzing(false);
  };

  const clearAnalysis = () => {
    setContractText('');
    setUploadedFile(null);
    setAnalysis(null);
    setInputMode('text');
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="glass-card p-6 max-w-4xl w-full h-[80vh] flex flex-col">
        
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Shield className="w-6 h-6 text-blue-400" />
            <h2 className="text-xl font-semibold text-white">Contract Verification</h2>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-6">
          
          {/* Verification Status */}
          {verificationStatus && (
            <div className="bg-white bg-opacity-5 rounded-lg p-4">
              <h3 className="text-white font-medium mb-3 flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-green-400" />
                Verification Status
              </h3>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Email Verification */}
                <div className="flex items-center gap-3">
                  <div className={`w-3 h-3 rounded-full ${verificationStatus.email.verified ? 'bg-green-400' : 'bg-red-400'}`}></div>
                  <div>
                    <p className="text-white text-sm">Email Verified</p>
                    <p className="text-gray-400 text-xs">
                      {verificationStatus.email.verified 
                        ? `Verified on ${verificationStatus.email.verifiedDate}` 
                        : 'Not verified'}
                    </p>
                  </div>
                </div>
                
                {/* Phone Verification */}
                <div className="flex items-center gap-3">
                  <div className={`w-3 h-3 rounded-full ${verificationStatus.phone.verified ? 'bg-green-400' : 'bg-red-400'}`}></div>
                  <div>
                    <p className="text-white text-sm">Phone Verified</p>
                    <p className="text-gray-400 text-xs">
                      {verificationStatus.phone.verified 
                        ? `Verified on ${verificationStatus.phone.verifiedDate}` 
                        : 'Not verified'}
                    </p>
                  </div>
                </div>
                
                {/* Identity Verification */}
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 rounded-full bg-yellow-400"></div>
                  <div>
                    <p className="text-white text-sm">Identity Verification</p>
                    <p className="text-gray-400 text-xs">
                      {verificationStatus.identity.verified ? 'Verified' : 'Pending verification'}
                    </p>
                  </div>
                </div>
              </div>
              
              <div className="mt-4 p-3 bg-blue-500 bg-opacity-20 rounded-lg">
                <p className="text-blue-300 text-sm">
                  📊 Completion: {verificationStatus.overall.completionRate}% | 
                  🎯 Next: {verificationStatus.overall.nextStep}
                </p>
              </div>
            </div>
          )}

          {/* Contract Input */}
          <div className="bg-white bg-opacity-5 rounded-lg p-4">
            <h3 className="text-white font-medium mb-3 flex items-center gap-2">
              <FileText className="w-5 h-5 text-purple-400" />
              Contract Analysis
            </h3>
            
            {/* Input Mode Tabs */}
            <div className="flex mb-4 bg-white bg-opacity-5 rounded-lg p-1">
              <button
                onClick={() => setInputMode('text')}
                className={`flex-1 py-2 px-4 rounded-md transition-colors ${
                  inputMode === 'text' 
                    ? 'bg-purple-600 text-white' 
                    : 'text-gray-300 hover:text-white'
                }`}
              >
                📝 Paste Text
              </button>
              <button
                onClick={() => setInputMode('file')}
                className={`flex-1 py-2 px-4 rounded-md transition-colors ${
                  inputMode === 'file' 
                    ? 'bg-purple-600 text-white' 
                    : 'text-gray-300 hover:text-white'
                }`}
              >
                📄 Upload File
              </button>
            </div>

            {/* Text Input Mode */}
            {inputMode === 'text' && (
              <textarea
                value={contractText}
                onChange={(e) => setContractText(e.target.value)}
                placeholder="Paste contract or terms & conditions here..."
                className="w-full h-32 bg-white bg-opacity-10 border border-white border-opacity-20 rounded-lg p-3 text-white placeholder-gray-400 resize-none focus:outline-none focus:border-purple-400"
              />
            )}

            {/* File Upload Mode */}
            {inputMode === 'file' && (
              <div className="space-y-4">
                
                {!uploadedFile ? (
                  <div 
                    className={`border-2 border-dashed border-gray-400 rounded-lg p-6 text-center transition-colors ${
                      dragActive ? 'border-purple-400 bg-purple-400 bg-opacity-10' : 'hover:border-gray-300'
                    }`}
                    onDrop={handleFileDrop}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                  >
                    <Upload className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                    <p className="text-white mb-2">Drop your document here or click to browse</p>
                    <input
                      type="file"
                      accept=".txt,.pdf,.doc,.docx,.rtf"
                      onChange={(e) => handleFileSelect(e.target.files[0])}
                      className="hidden"
                      id="file-input"
                    />
                    <label
                      htmlFor="file-input"
                      className="inline-block px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg cursor-pointer transition-colors"
                    >
                      Browse Files
                    </label>
                    
                    {/* Supported formats */}
                    <div className="mt-4 text-gray-400 text-sm">
                      <p className="mb-2">📄 Currently supported:</p>
                      <div className="flex flex-wrap gap-2 justify-center">
                        {supportedTypes.currentlyWorking.map((type, index) => (
                          <span key={index} className="px-2 py-1 bg-green-500 bg-opacity-20 text-green-300 rounded text-xs">
                            {type === 'text/plain' ? 'TXT' : type}
                          </span>
                        ))}
                      </div>
                      <p className="mt-2 text-xs">🔄 Coming soon: PDF, Word docs (DOC, DOCX)</p>
                      <p className="text-xs">📏 Max file size: {supportedTypes.maxSize}</p>
                    </div>
                  </div>
                ) : (
                  <div className="bg-white bg-opacity-10 rounded-lg p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <FileText className="w-6 h-6 text-purple-400" />
                        <div>
                          <p className="text-white font-medium">{uploadedFile.name}</p>
                          <p className="text-gray-400 text-sm">
                            {(uploadedFile.size / 1024).toFixed(1)} KB • {uploadedFile.type || 'Unknown type'}
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={removeFile}
                        className="text-red-400 hover:text-red-300 transition-colors"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
            
            <div className="flex gap-3 mt-3">
              <button
                onClick={handleAnalyzeContract}
                disabled={isAnalyzing || (inputMode === 'text' && contractText.length < 50) || (inputMode === 'file' && !uploadedFile)}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 text-white rounded-lg transition-colors flex items-center gap-2"
              >
                {isAnalyzing ? (
                  <>
                    <div className="w-4 h-4 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
                    {inputMode === 'file' ? 'Processing File...' : 'Analyzing...'}
                  </>
                ) : (
                  <>
                    <Shield className="w-4 h-4" />
                    {inputMode === 'file' ? 'Analyze Document' : 'Analyze Contract'} (Secure)
                  </>
                )}
              </button>
              
              {(contractText || uploadedFile) && (
                <button
                  onClick={clearAnalysis}
                  className="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg transition-colors"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          {/* Analysis Results */}
          {analysis && (
            <div className="bg-white bg-opacity-5 rounded-lg p-4">
              <h3 className="text-white font-medium mb-4 flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-yellow-400" />
                Analysis Results
              </h3>
              
              {/* Risk Level */}
              <div className="mb-4 p-3 rounded-lg" style={{
                backgroundColor: analysis.contract.riskLevel === 'high' ? 'rgba(239, 68, 68, 0.2)' :
                                analysis.contract.riskLevel === 'medium' ? 'rgba(245, 158, 11, 0.2)' :
                                'rgba(34, 197, 94, 0.2)'
              }}>
                <p className="text-white font-medium">
                  Risk Level: <span className={
                    analysis.contract.riskLevel === 'high' ? 'text-red-400' :
                    analysis.contract.riskLevel === 'medium' ? 'text-yellow-400' :
                    'text-green-400'
                  }>
                    {analysis.contract.riskLevel.toUpperCase()}
                  </span>
                </p>
              </div>
              
              {/* Contract Analysis */}
              <div className="mb-4 p-3 bg-white bg-opacity-5 rounded-lg">
                <h4 className="text-white font-medium mb-2 flex items-center gap-2">
                  📋 {analysis.contract.isFileUpload ? 'Document' : 'Contract'} Review:
                  {analysis.contract.isFileUpload && (
                    <span className="text-purple-400 text-sm">({analysis.contract.fileName})</span>
                  )}
                </h4>
                <pre className="text-gray-300 text-sm whitespace-pre-wrap">{analysis.contract.analysis}</pre>
                
                {/* Show extracted text preview for file uploads */}
                {analysis.contract.isFileUpload && analysis.contract.extractedText && (
                  <details className="mt-3">
                    <summary className="text-purple-400 text-sm cursor-pointer hover:text-purple-300">
                      📄 View extracted text preview
                    </summary>
                    <div className="mt-2 p-2 bg-black bg-opacity-20 rounded text-xs text-gray-400 max-h-32 overflow-y-auto">
                      {analysis.contract.extractedText}
                    </div>
                  </details>
                )}
              </div>
              
              {/* Security Check */}
              <div className="p-3 bg-white bg-opacity-5 rounded-lg">
                <h4 className="text-white font-medium mb-2">🛡️ Security Assessment:</h4>
                <p className="text-gray-300 text-sm mb-2">
                  Security Score: <span className="text-blue-400">{analysis.security.securityScore}%</span>
                </p>
                <p className="text-gray-300 text-sm mb-2">
                  Recommendation: <span className="text-yellow-400">{analysis.security.recommendation}</span>
                </p>
                
                {analysis.security.issues.length > 0 && (
                  <div className="mt-3">
                    <p className="text-red-400 text-sm font-medium mb-1">⚠️ Issues Found:</p>
                    <ul className="text-red-300 text-sm space-y-1">
                      {analysis.security.issues.map((issue, index) => (
                        <li key={index}>• {issue}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
              
              <div className="mt-4 text-right">
                <p className="text-gray-400 text-xs">
                  🤖 AI-powered: {analysis.contract.aiPowered ? 'Yes' : 'Basic'} | 
                  📅 {new Date(analysis.contract.timestamp).toLocaleString()}
                </p>
              </div>
            </div>
          )}
          
        </div>
      </div>
    </div>
  );
};

export default ContractVerification;