/**
 * SmartTransactionEntry - Direct Text Input Recording
 * Minimal UI - just text input with OK button for quick transaction logging
 * User types directly, smart detection happens in background
 */

import React, { useState, useRef, useEffect } from 'react';
import { Send, Check, DollarSign, Briefcase, Loader, Mic, MicOff } from 'lucide-react';
import { analyzeTransactionWithAI } from '../services/accountingAIService';


export const SmartTransactionEntry = ({ isOpen = false, transactionType = null, onClose = null, onSubmit = null, prefillText = '' }) => {
  const [textInput, setTextInput] = useState('');
  const [parsedData, setParsedData] = useState(null);
  const [aiAnalysis, setAiAnalysis] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  // Allow user to override/select transaction mode (business/personal)
  const [selectedMode, setSelectedMode] = useState(transactionType || 'personal');
  const [showModeSelector, setShowModeSelector] = useState(!transactionType); // Show selector if no transactionType
  const inputRef = useRef(null);

  // ── Voice recognition state ──
  const [isListening, setIsListening] = useState(false);
  const [voiceInterim, setVoiceInterim] = useState('');
  const recognitionRef = useRef(null);
  const voiceTranscriptRef = useRef('');
  const voiceSupported = !!(window.SpeechRecognition || window.webkitSpeechRecognition);

  const startVoiceRecognition = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    const recognition = new SR();
    recognitionRef.current = recognition;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    voiceTranscriptRef.current = '';

    recognition.onstart = () => { setIsListening(true); setVoiceInterim(''); };

    recognition.onresult = (e) => {
      let interim = '';
      let final = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) final += e.results[i][0].transcript;
        else interim += e.results[i][0].transcript;
      }
      if (final) voiceTranscriptRef.current += final;
      // Show combined final+interim so user sees their words live
      const combined = (voiceTranscriptRef.current + ' ' + interim).trim();
      setVoiceInterim(combined);
    };

    recognition.onend = () => {
      setIsListening(false);
      setVoiceInterim('');
      const spoken = voiceTranscriptRef.current.trim();
      voiceTranscriptRef.current = '';
      if (spoken) {
        setTextInput(spoken);
        setParsedData(parseSmartInputWithMode(spoken, selectedMode));
      }
    };

    recognition.onerror = (e) => {
      console.warn('Voice error:', e.error);
      setIsListening(false);
      setVoiceInterim('');
    };

    recognition.start();
  };

  const stopVoiceRecognition = () => recognitionRef.current?.stop();

  // Keywords for detecting expense vs income
  const incomeKeywords = ['salary', 'earned', 'received', 'income', 'bonus', 'interest', 'dividend', 'payment', 'refund', 'returned', 'paid', 'sales', 'revenue'];
  const expenseKeywords = ['bought', 'lunch', 'dinner', 'breakfast', 'transport', 'taxi', 'shopping', 'fuel', 'bills', 'paid for', 'spent', 'expense', 'cost'];
  const investmentKeywords = ['invested', 'purchased', 'acquired', 'equipment', 'property', 'vehicle', 'asset', 'capital'];

  // Business Accounting Categories for precise categorization
  const businessCategories = {
    revenue: {
      name: 'Revenue',
      keywords: ['sales', 'revenue', 'income', 'earned', 'received', 'payment'],
      emoji: '📈'
    },
    cogs: {
      name: 'Cost of Goods Sold',
      keywords: ['cost', 'material', 'inventory', 'purchased', 'goods'],
      emoji: '📦'
    },
    expenses: {
      name: 'Operating Expenses',
      keywords: ['paid', 'spent', 'expense', 'bill', 'utilities', 'rent', 'salary', 'fuel', 'transport'],
      emoji: '💸'
    },
    investments: {
      name: 'Investments & Assets',
      keywords: ['invested', 'purchased', 'acquired', 'capital', 'asset', 'equipment', 'vehicle', 'property'],
      emoji: '💰'
    },
    cashflow: {
      name: 'Cash Flow',
      keywords: ['loan', 'borrowed', 'lent', 'receivable', 'payable'],
      emoji: '💳'
    }
  };

  // Core parser — mode passed explicitly so it works from voice onend, mode switches, and typing
  const parseSmartInputWithMode = (input, mode) => {
    if (!input || !input.trim()) return null;

    const text = input.toLowerCase();

    // Extract amount — supports "500k", "1.5m", "500,000", plain numbers
    const amountMatch = text.match(/(\d[\d,]*\.?\d*)\s*(million|m\b|k\b|thousand)?/i);
    let amount = 0;
    if (amountMatch) {
      amount = parseFloat(amountMatch[1].replace(/,/g, ''));
      const mult = (amountMatch[2] || '').toLowerCase();
      if (mult === 'k' || mult === 'thousand') amount *= 1000;
      else if (mult === 'm' || mult === 'million') amount *= 1000000;
    }

    let isIncome = false;
    let detectedType = 'expense';
    let businessAccountingType = null;

    if (mode === 'business') {
      // 💼 BUSINESS ACCOUNTING RULES (Professional)
      // Rule 1: Large purchases with "bought/purchased" keywords = ASSET (investment)
      if ((amount > 1000000 || /bought|purchased|acquired|invest|capital/i.test(text)) && 
          /van|car|vehicle|truck|equipment|machinery|property|land|building|computer/i.test(text)) {
        detectedType = 'investment';
        businessAccountingType = 'asset';
      }
      // Rule 2: Revenue keywords = INCOME
      else if (/earned|received|sold|revenue|income|payment|sales/i.test(text)) {
        isIncome = true;
        detectedType = 'income';
        businessAccountingType = 'revenue';
      }
      // Rule 3: Loan keywords = LIABILITY
      else if (/borrowed|loan|financing|mortgage|credit|debt/i.test(text)) {
        detectedType = 'loan';
        businessAccountingType = 'liability';
      }
      // Rule 4: Operating expenses = EXPENSE
      else if (/salary|wage|rent|utility|bill|fuel|supply|expense|cost|paid/i.test(text)) {
        isIncome = false;
        detectedType = 'expense';
        businessAccountingType = 'expense';
      }
      // Rule 5: Default — large amounts = likely asset, otherwise expense
      else {
        if (amount > 5000000 && !(/spent|paid for|cost|bill/i.test(text))) {
          detectedType = 'investment';
          businessAccountingType = 'asset';
        } else {
          detectedType = 'expense';
          businessAccountingType = 'expense';
        }
      }
    } else {
      // 👤 PERSONAL ACCOUNT RULES
      const hasIncome = incomeKeywords.some(kw => text.includes(kw));
      const hasExpense = expenseKeywords.some(kw => text.includes(kw));
      if (hasIncome && !hasExpense) { isIncome = true; detectedType = 'income'; }
      else { isIncome = false; detectedType = 'expense'; }
    }

    // Extract source/destination/action
    let source = '';
    let action = '';

    if (text.includes('bought')) {
      action = 'bought';
      const boughtMatch = text.match(/bought\s+(?:from\s+)?(.+?)(?:\s+\d+|$)/);
      source = boughtMatch ? boughtMatch[1].trim() : '';
    } else if (text.includes('sold')) {
      action = 'sold';
      const soldMatch = text.match(/sold\s+(?:to\s+)?(.+?)(?:\s+\d+|$)/);
      source = soldMatch ? soldMatch[1].trim() : '';
    } else if (text.includes('from ')) {
      action = 'from';
      const fromMatch = text.match(/from\s+(.+?)(?:\s+\d+|$)/);
      source = fromMatch ? fromMatch[1].trim() : '';
    } else if (text.includes(' at ')) {
      action = 'at';
      const atMatch = text.match(/at\s+(.+?)(?:\s+\d+|$)/);
      source = atMatch ? atMatch[1].trim() : '';
    }

    // Clean up description
    let description = input.replace(/(\d[\d,]*\.?\d*)\s*(million|m\b|k\b|thousand)?/gi, '').trim();
    if (source) description = description.replace(new RegExp(`(?:from|at|bought|sold)\\s+${source}`, 'i'), '').trim();
    description = description.replace(/\s+/g, ' ').trim();
    description = description.charAt(0).toUpperCase() + description.slice(1);
    if (!description || description.length < 2)
      description = isIncome ? 'Income received' : detectedType === 'investment' ? 'Asset / Investment' : 'Expense';

    return {
      amount: Math.round(amount),
      description,
      type: detectedType,
      isIncome,
      source,
      action,
      businessAccountingType,
      category: mode === 'business'
        ? (investmentKeywords.some(kw => text.includes(kw))
            ? 'investments'
            : Object.keys(businessCategories).find(cat =>
                businessCategories[cat].keywords.some(kw => text.includes(kw))
              ) || null)
        : null,
      accountingType: mode,
      isValid: amount > 0,
    };
  };

  // Convenience wrapper uses current selectedMode
  const parseSmartInput = (input) => parseSmartInputWithMode(input, selectedMode);

  // Handle smart input change
  const handleSmartInput = (e) => {
    const value = e.target.value;
    setTextInput(value);
    setParsedData(parseSmartInputWithMode(value, selectedMode));
  };

  // Re-parse when mode switches so the classification card updates immediately
  const handleModeChange = (mode) => {
    setSelectedMode(mode);
    if (textInput.trim()) setParsedData(parseSmartInputWithMode(textInput, mode));
  };

  // Focus input when modal opens; pre-fill voice transcript if provided
  useEffect(() => {
    if (isOpen) {
      // Pre-fill text from voice recognition
      if (prefillText && prefillText.trim()) {
        setTextInput(prefillText.trim());
        const parsed = parseSmartInput(prefillText.trim());
        setParsedData(parsed);
      }
      if (inputRef.current) {
        setTimeout(() => inputRef.current?.focus(), 150);
      }
    } else {
      // Reset when modal closes
      setTextInput('');
      setParsedData(null);
      setAiAnalysis(null);
      setIsListening(false);
      setVoiceInterim('');
      recognitionRef.current?.stop();
      voiceTranscriptRef.current = '';
    }
    // Update selectedMode if transactionType prop changes
    if (transactionType && transactionType !== selectedMode) {
      setSelectedMode(transactionType);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, transactionType, prefillText]);

  // Submit transaction with AI analysis
  const handleSubmit = async () => {
    if (parsedData?.isValid) {
      setIsAnalyzing(true);
      
      try {
        // Get AI analysis if in business mode
        let finalTransaction = {
          type: 'smart_entry',
          amount: parsedData.amount,
          description: parsedData.description,
          entryType: parsedData.type,
          isIncome: parsedData.isIncome,
          source: parsedData.source,
          action: parsedData.action,
          timestamp: new Date().toISOString(),
          rawInput: textInput,
          accountingType: parsedData.accountingType,
          category: parsedData.category,
          categoryName: parsedData.category ? businessCategories[parsedData.category]?.name : null,
          aiConfidence: 0.95,
          auditTrail: `AI-Categorized as ${parsedData.category ? businessCategories[parsedData.category]?.name : 'General'}`
        };

        // Use OpenAI for professional accounting analysis in business mode
        if (selectedMode === 'business') {
          const enrichedTransaction = await analyzeTransactionWithAI(finalTransaction);
          finalTransaction = enrichedTransaction;
        }

        if (onSubmit) {
          onSubmit(finalTransaction);
        }

        // Reset
        setTextInput('');
        setParsedData(null);
        setAiAnalysis(null);
        if (onClose) onClose();
      } catch (error) {
        console.error('❌ Submit failed:', error);
      } finally {
        setIsAnalyzing(false);
      }
    }
  };

  // Handle Enter key
  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && parsedData?.isValid) {
      handleSubmit();
    }
  };

  if (!isOpen) return null;

  // Mode Selection Modal
  if (showModeSelector) {
    return (
      <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full space-y-6 animate-in">
          {/* Header */}
          <div className="text-center space-y-2">
            <h2 className="text-2xl font-bold text-gray-900">Select Account Type</h2>
            <p className="text-gray-600">Choose how you want to record this transaction</p>
          </div>

          {/* Option Cards */}
          <div className="space-y-3">
            {/* Personal Account */}
            <button
              onClick={() => {
                setSelectedMode('personal');
                setShowModeSelector(false);
              }}
              className="w-full p-4 border-2 border-purple-300 rounded-xl hover:bg-purple-50 hover:border-purple-500 transition group"
            >
              <div className="flex items-center gap-3">
                <div className="text-4xl">👤</div>
                <div className="text-left">
                  <div className="font-bold text-gray-900 group-hover:text-purple-700">Personal Account</div>
                  <div className="text-sm text-gray-600">Track personal expenses & income</div>
                </div>
              </div>
            </button>

            {/* Business Account */}
            <button
              onClick={() => {
                setSelectedMode('business');
                setShowModeSelector(false);
              }}
              className="w-full p-4 border-2 border-blue-300 rounded-xl hover:bg-blue-50 hover:border-blue-500 transition group"
            >
              <div className="flex items-center gap-3">
                <div className="text-4xl">🏢</div>
                <div className="text-left">
                  <div className="font-bold text-gray-900 group-hover:text-blue-700">Business Account</div>
                  <div className="text-sm text-gray-600">Professional accounting with assets</div>
                </div>
              </div>
            </button>
          </div>

          {/* Close button */}
          <button
            onClick={() => {
              setShowModeSelector(false);
              if (onClose) onClose();
            }}
            className="w-full py-2 text-gray-600 hover:text-gray-900 font-medium"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex flex-col justify-between">
      {/* Close on background click */}
      <div 
        className="flex-1 cursor-pointer"
        onClick={onClose}
      />

      {/* Input Bar - Bottom */}
      <div className={`${selectedMode === 'business' ? 'bg-gradient-to-r from-slate-50 to-blue-50' : 'bg-white'} border-t-2 ${selectedMode === 'business' ? 'border-blue-400' : 'border-purple-400'} shadow-2xl`}>
        <div className="p-3 pb-safe space-y-3" style={{paddingBottom: 'max(12px, env(safe-area-inset-bottom))'}}>
          {/* Mode Selector */}
          {!transactionType && (
            <div className="flex gap-2">
              <button
                onClick={() => handleModeChange('business')}
                className={`flex-1 px-4 py-3 rounded-lg font-semibold transition flex items-center justify-center gap-3 ${
                  selectedMode === 'business'
                    ? 'bg-blue-600 text-white border-2 border-blue-700'
                    : 'bg-gray-100 text-gray-700 border-2 border-gray-300 hover:border-blue-400'
                }`}
              >
                <span className="text-2xl">🏢</span>
                <span>Business</span>
              </button>
              <button
                onClick={() => handleModeChange('personal')}
                className={`flex-1 px-4 py-3 rounded-lg font-semibold transition flex items-center justify-center gap-3 ${
                  selectedMode === 'personal'
                    ? 'bg-purple-600 text-white border-2 border-purple-700'
                    : 'bg-gray-100 text-gray-700 border-2 border-gray-300 hover:border-purple-400'
                }`}
              >
                <span className="text-2xl">👤</span>
                <span>Personal</span>
              </button>
            </div>
          )}

          {/* Transaction Type Indicator */}
          {transactionType && (
            <div className={`px-3 py-2 rounded-lg flex items-center gap-2 text-sm font-semibold ${
              selectedMode === 'business' 
                ? 'bg-blue-600/20 text-blue-700 border border-blue-300' 
                : 'bg-green-600/20 text-green-700 border border-green-300'
            }`}>
              {selectedMode === 'business' ? (
                <>
                  <Briefcase className="w-4 h-4" />
                  <span>Business Account - Professional Accounting Mode</span>
                </>
              ) : (
                <>
                  <DollarSign className="w-4 h-4" />
                  <span>Personal Account</span>
                </>
              )}
            </div>
          )}

          {/* Current Mode Display (web only) */}
          {!transactionType && (
            <div className={`px-3 py-2 rounded-lg flex items-center gap-2 text-sm font-semibold ${
              selectedMode === 'business' 
                ? 'bg-blue-600/20 text-blue-700 border border-blue-300' 
                : 'bg-green-600/20 text-green-700 border border-green-300'
            }`}>
              {selectedMode === 'business' ? (
                <>
                  <Briefcase className="w-4 h-4" />
                  <span>Professional Accounting Mode</span>
                </>
              ) : (
                <>
                  <DollarSign className="w-4 h-4" />
                  <span>Personal Finance Mode</span>
                </>
              )}
            </div>
          )}

          {/* Input Field */}
          <div className="flex items-center gap-2 w-full">
            {/* Text input with mic inside */}
            <div className={`flex-1 min-w-0 flex items-center border-2 rounded-xl px-3 transition-all ${
              isListening
                ? 'border-red-400 bg-red-50'
                : selectedMode === 'business'
                  ? 'border-blue-300 bg-white focus-within:ring-2 focus-within:ring-blue-400'
                  : 'border-gray-300 bg-white focus-within:ring-2 focus-within:ring-purple-400'
            }`}>
              <input
                ref={inputRef}
                type="text"
                placeholder={
                  isListening
                    ? '🎙 Listening...'
                    : selectedMode === 'business'
                      ? '"Bought equipment 500k"'
                      : '"Lunch 15k" • "Salary 800k"'
                }
                value={isListening ? voiceInterim : textInput}
                onChange={(e) => { if (!isListening) handleSmartInput(e); }}
                onKeyDown={(e) => { if (e.key === 'Enter' && !isListening) handleKeyPress(e); }}
                readOnly={isListening}
                autoComplete="off"
                className="flex-1 min-w-0 py-3 text-base text-gray-900 bg-transparent focus:outline-none"
              />
              {/* Mic button — inside the input box, right side */}
              {voiceSupported && (
                <button
                  type="button"
                  onClick={() => isListening ? stopVoiceRecognition() : startVoiceRecognition()}
                  title={isListening ? 'Stop' : 'Speak'}
                  className={`flex-shrink-0 ml-1 p-2 rounded-lg transition active:scale-90 ${
                    isListening
                      ? 'text-red-500 animate-pulse'
                      : 'text-gray-400 hover:text-gray-600'
                  }`}
                >
                  {isListening ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                </button>
              )}
            </div>

            {/* Send button — always fully visible */}
            <button
              onClick={handleSubmit}
              disabled={!parsedData?.isValid || isAnalyzing || isListening}
              className={`flex-shrink-0 w-12 h-12 rounded-xl font-bold transition flex items-center justify-center ${
                parsedData?.isValid && !isAnalyzing && !isListening
                  ? 'bg-gradient-to-br from-blue-500 to-cyan-500 text-white shadow-md active:scale-95'
                  : 'bg-gray-200 text-gray-400 cursor-not-allowed'
              }`}
            >
              {isAnalyzing
                ? <Loader className="w-5 h-5 animate-spin" />
                : <Send className="w-5 h-5" />}
            </button>
          </div>

          {/* Smart Detection Display - Enhanced for Business */}
          {parsedData && (
            <div className={`rounded-lg p-4 flex flex-col gap-3 transition border-2 ${
              parsedData.isValid
                ? parsedData.type === 'investment'
                  ? 'bg-amber-50 border-amber-300'
                  : parsedData.isIncome
                  ? 'bg-green-50 border-green-300'
                  : 'bg-orange-50 border-orange-300'
                : 'bg-gray-50 border-gray-300'
            }`}>
              {/* Main Transaction Info */}
              <div className="flex items-center gap-3">
                <span className="text-3xl">
                  {/* Use accounting analysis icon if available (professional mode), otherwise use parsed type */}
                  {parsedData.accountingAnalysis?.displayIcon || (parsedData.type === 'investment' ? '💰' : parsedData.isIncome ? '📈' : '💸')}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-gray-900 text-sm">
                    {/* Show accounting classification if available, otherwise description */}
                    {parsedData.accountingAnalysis?.classification || parsedData.description}
                  </div>
                  {parsedData.source && (
                    <div className="text-xs text-gray-600 mt-1">
                      {parsedData.action === 'bought' && '🛍️ Vendor:'}
                      {parsedData.action === 'sold' && '💵 Customer:'}
                      {parsedData.action === 'from' && '📤 From:'}
                      {parsedData.action === 'at' && '📍 Location:'}
                      {!parsedData.action && '📌'} {parsedData.source}
                    </div>
                  )}
                  {parsedData.accountingAnalysis && (
                    <div className="text-xs text-gray-500 mt-1">
                      📊 {parsedData.accountingAnalysis.account}
                    </div>
                  )}
                </div>
                <div className="text-right flex-shrink-0">
                  <div className={`text-xl font-bold ${
                    parsedData.accountingAnalysis ? (
                      parsedData.accountingAnalysis.displaySign === '+' ? 'text-blue-600' :
                      parsedData.accountingAnalysis.displaySign === '-' ? 'text-red-600' :
                      'text-gray-600'
                    ) : (
                      parsedData.type === 'investment' ? 'text-amber-600' : parsedData.isIncome ? 'text-green-600' : 'text-orange-600'
                    )
                  }`}>
                    {parsedData.accountingAnalysis ? parsedData.accountingAnalysis.displayAmount : `${parsedData.type !== 'investment' && (parsedData.isIncome ? '+' : '-')} ${parsedData.amount.toLocaleString()}`}
                  </div>
                </div>
              </div>

              {/* Accounting Category Badge (Business Only) */}
              {selectedMode === 'business' && parsedData.category && businessCategories[parsedData.category] && (
                <div className="bg-white/60 rounded px-3 py-2 flex items-center gap-2 text-sm">
                  <span className="text-lg">{businessCategories[parsedData.category].emoji}</span>
                  <span className="font-semibold text-gray-800">{businessCategories[parsedData.category].name}</span>
                  <span className="text-xs text-gray-500 ml-auto">AI-Powered Categorization</span>
                </div>
              )}

              {/* Professional Accounting Analysis (AI-Powered) */}
              {selectedMode === 'business' && isAnalyzing && (
                <div className="bg-blue-50 border border-blue-200 rounded px-3 py-2 flex items-center gap-2">
                  <Loader className="w-4 h-4 animate-spin text-blue-600" />
                  <span className="text-xs text-blue-700">🤖 Consulting professional accountant...</span>
                </div>
              )}
            </div>
          )}

          {/* Helper Text */}
          {!textInput && !isListening && (
            <p className="text-xs text-gray-500 text-center">
              {selectedMode === 'business'
                ? '📊 "Bought van 40m" • "Salary expense 2m" • "Sales revenue 500k"'
                : '💡 "Lunch 15k" • "Salary 800k" • "Bought shoes 120k"'}
            </p>
          )}
          {isListening && (
            <p className="text-center text-xs text-red-500 animate-pulse font-medium">
              🎙 Listening... tap the mic to stop
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default SmartTransactionEntry;
