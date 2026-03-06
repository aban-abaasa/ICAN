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
  const incomeKeywords = ['salary', 'earned', 'received', 'income', 'bonus', 'interest', 'dividend', 'payment', 'refund', 'returned', 'paid me', 'paid us', 'sales', 'revenue', 'sold', 'commission', 'tip', 'grant', 'profit'];
  const expenseKeywords = ['bought', 'lunch', 'dinner', 'breakfast', 'transport', 'taxi', 'shopping', 'fuel', 'bills', 'paid for', 'spent', 'expense', 'cost', 'subscription', 'fee'];

  // ─────────────────────────────────────────────────────────
  // BUSINESS ACCOUNTING CATEGORIES — Real business logic
  // ─────────────────────────────────────────────────────────
  const businessCategories = {
    sales: {
      name: 'Sales Income',
      // Any "sold" transaction is REVENUE — cash/receivable IN, income recognised
      keywords: [
        'sold', 'sale', 'sales', 'selling', 'delivered and paid', 'sold to',
        'made a sale', 'customer paid', 'client paid', 'received from customer',
        'received from client', 'invoice paid', 'payment received',
      ],
      emoji: '💵',
      accountingType: 'revenue',
      isIncome: true,
      taxNote: 'Taxable income — include in VAT return & income tax',
    },
    revenue: {
      name: 'Revenue / Service Income',
      keywords: [
        'revenue', 'earned', 'commission', 'service fee', 'consultation fee',
        'professional fee', 'rent received', 'interest received', 'royalty',
      ],
      emoji: '📈',
      accountingType: 'revenue',
      isIncome: true,
      taxNote: 'Taxable income — declare in annual return',
    },
    cogs: {
      name: 'Stock & Inventory (COGS)',
      keywords: [
        'stock', 'inventory', 'goods', 'merchandise', 'produce', 'wholesale',
        'raw material', 'materials', 'supplies', 'resell', 'for sale', 'to sell',
        'products', 'items to sell', 'buy goods', 'bought goods', 'stock up',
        'maize', 'rice', 'beans', 'sugar', 'flour', 'oil', 'timber', 'cement',
        'clothes', 'shoes', 'electronics', 'phones', 'fabric', 'charcoal',
      ],
      emoji: '📦',
      accountingType: 'cogs',
      isIncome: false,
      taxNote: 'Deductible cost — reduces taxable profit',
    },
    capital_asset: {
      name: 'Capital Asset',
      keywords: [
        'equipment', 'machinery', 'machine', 'vehicle', 'car', 'van', 'truck',
        'motorcycle', 'boda', 'computer', 'laptop', 'phone for business',
        'property', 'land', 'building', 'shop', 'office', 'warehouse',
        'solar', 'generator', 'fridge', 'freezer', 'refrigerator',
        'furniture', 'shelves', 'shelf', 'display', 'tools',
      ],
      emoji: '🏭',
      accountingType: 'asset',
      isIncome: false,
      taxNote: 'Depreciable asset — claim capital allowance',
    },
    tax_payment: {
      name: 'Tax Payment',
      // Tax paid to revenue authority = deductible business expense
      keywords: [
        'tax', 'income tax', 'corporate tax', 'business tax',
        'ura', 'kra', 'firs', 'sars', 'revenue authority',
        'withholding tax', 'wht', 'presumptive tax', 'local tax',
        'trading license', 'business permit fee',
      ],
      emoji: '🏛️',
      accountingType: 'tax_expense',
      isIncome: false,
      taxNote: 'Tax payment — record for annual tax reconciliation',
    },
    vat_collected: {
      name: 'VAT / Tax Collected on Sales',
      // VAT collected from customers is NOT income — it is a liability owed to govt
      keywords: [
        'vat collected', 'vat on sales', 'sales tax collected', 'collected vat',
        'output vat', 'gst collected', 'levied tax',
      ],
      emoji: '🧾',
      accountingType: 'tax_liability',
      isIncome: false,
      taxNote: 'VAT collected = liability — must be remitted to revenue authority',
    },
    paye: {
      name: 'PAYE / Payroll Tax',
      // Tax deducted from employee salaries — employer must remit to govt
      keywords: [
        'paye', 'payroll tax', 'employee tax', 'staff tax', 'nssf', 'nhif',
        'pension contribution', 'social security', 'deducted tax', 'tax withheld',
      ],
      emoji: '👷',
      accountingType: 'paye_liability',
      isIncome: false,
      taxNote: 'PAYE — deduct from salary, remit to revenue authority monthly',
    },
    operating_expense: {
      name: 'Operating Expense',
      keywords: [
        'rent', 'salary', 'wage', 'staff', 'worker', 'employee', 'payroll',
        'electricity', 'water', 'internet', 'airtime', 'data', 'utilities',
        'fuel', 'transport', 'delivery', 'marketing', 'advertising', 'signage',
        'printing', 'stationery', 'repairs', 'maintenance', 'cleaning',
        'insurance', 'security', 'guard', 'license', 'permit',
        'accountant', 'lawyer',
      ],
      emoji: '💸',
      accountingType: 'expense',
      isIncome: false,
      taxNote: 'Deductible expense — reduces taxable profit',
    },
    loan: {
      name: 'Loan / Liability',
      keywords: [
        'loan', 'borrowed', 'borrow', 'credit', 'financing', 'mortgage',
        'debt', 'overdraft', 'advance', 'lent me', 'microfinance', 'sacco',
      ],
      emoji: '🏦',
      accountingType: 'liability',
      isIncome: true,
      taxNote: 'Loan — not income, must be repaid. Interest is deductible',
    },
    loan_repayment: {
      name: 'Loan Repayment',
      keywords: ['repay', 'repayment', 'paid loan', 'loan payment', 'installment', 'instalment'],
      emoji: '🔄',
      accountingType: 'liability_payment',
      isIncome: false,
      taxNote: 'Principal repayment — not deductible. Interest portion is deductible',
    },
    owner_equity: {
      name: 'Owner Investment / Equity',
      keywords: ['invested my own', 'own capital', 'personal investment', 'owner contribution', 'capital injection', 'startup capital'],
      emoji: '💼',
      accountingType: 'equity',
      isIncome: true,
      taxNote: 'Capital contribution — not taxable income',
    },
  };

  // ─────────────────────────────────────────────────────────
  // PERSONAL CATEGORIES — Real personal finance
  // ─────────────────────────────────────────────────────────
  const personalCategories = {
    income: {
      name: 'Income',
      keywords: ['salary', 'earned', 'received', 'bonus', 'commission', 'dividend', 'allowance', 'pay', 'wages'],
      emoji: '💰',
    },
    food: {
      name: 'Food & Dining',
      keywords: ['food', 'lunch', 'dinner', 'breakfast', 'restaurant', 'eating', 'groceries', 'supermarket', 'market'],
      emoji: '🍽️',
    },
    transport: {
      name: 'Transport',
      keywords: ['taxi', 'boda', 'uber', 'transport', 'bus', 'fuel', 'petrol', 'fare'],
      emoji: '🚗',
    },
    bills: {
      name: 'Bills & Utilities',
      keywords: ['rent', 'electricity', 'water', 'internet', 'tv', 'airtime', 'data', 'utility'],
      emoji: '🧾',
    },
    health: {
      name: 'Health',
      keywords: ['hospital', 'clinic', 'doctor', 'medicine', 'pharmacy', 'medical', 'health'],
      emoji: '🏥',
    },
    education: {
      name: 'Education',
      keywords: ['school', 'fees', 'tuition', 'university', 'college', 'books', 'training', 'course'],
      emoji: '📚',
    },
    personal_investment: {
      name: 'Personal Investment',
      keywords: ['saved', 'saving', 'invested', 'shares', 'land', 'property', 'deposit', 'fixed deposit', 'sacco', 'chama', 'merry-go-round'],
      emoji: '📊',
    },
    loan_personal: {
      name: 'Personal Loan',
      keywords: ['borrowed', 'loan', 'lent', 'credit', 'advance'],
      emoji: '🏦',
    },
    entertainment: {
      name: 'Entertainment',
      keywords: ['movie', 'cinema', 'concert', 'game', 'sport', 'gym', 'subscription', 'netflix', 'youtube'],
      emoji: '🎬',
    },
    family: {
      name: 'Family & Giving',
      keywords: ['tithe', 'offering', 'church', 'charity', 'donation', 'sent', 'family', 'parent', 'sibling', 'child', 'kids', 'school fees'],
      emoji: '❤️',
    },
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
    let detectedCategory = null;
    let categoryEmoji = '💸';
    let categoryName = '';

    if (mode === 'business') {
      // ─── BUSINESS RULES ─── priority order matters ───

      // RULE 0: PAYE / PAYROLL TAX — check before salary/wages
      if (businessCategories.paye.keywords.some(kw => text.includes(kw))) {
        isIncome = false;
        detectedType = 'expense';
        businessAccountingType = 'paye_liability';
        detectedCategory = 'paye';
        categoryEmoji = '👷';
        categoryName = 'PAYE / Payroll Tax';
      }
      // RULE 1: VAT COLLECTED ON SALES — check before generic sales (it's not income!)
      else if (businessCategories.vat_collected.keywords.some(kw => text.includes(kw))) {
        isIncome = false;
        detectedType = 'expense';
        businessAccountingType = 'tax_liability';
        detectedCategory = 'vat_collected';
        categoryEmoji = '🧾';
        categoryName = 'VAT Collected (Tax Liability)';
      }
      // RULE 2: TAX PAYMENT — paying tax to govt
      else if (businessCategories.tax_payment.keywords.some(kw => text.includes(kw))) {
        isIncome = false;
        detectedType = 'expense';
        businessAccountingType = 'tax_expense';
        detectedCategory = 'tax_payment';
        categoryEmoji = '🏛️';
        categoryName = 'Tax Payment';
      }
      // RULE 3: SOLD / SALES — HIGHEST priority revenue rule
      //  "sold X to Y for Z" → always INCOME / REVENUE
      else if (/\bsold\b|\bsale\b|\bsales\b|\bselling\b|\bmade a sale\b/i.test(text) ||
               businessCategories.sales.keywords.some(kw => text.includes(kw))) {
        isIncome = true;
        detectedType = 'income';
        businessAccountingType = 'revenue';
        detectedCategory = 'sales';
        categoryEmoji = '💵';
        categoryName = 'Sales Income';
      }
      // RULE 4: OTHER REVENUE / SERVICE INCOME
      else if (businessCategories.revenue.keywords.some(kw => text.includes(kw))) {
        isIncome = true;
        detectedType = 'income';
        businessAccountingType = 'revenue';
        detectedCategory = 'revenue';
        categoryEmoji = '📈';
        categoryName = 'Revenue / Service Income';
      }
      // RULE 5: LOAN RECEIVED — cash in but it's a liability
      else if (businessCategories.loan.keywords.some(kw => text.includes(kw)) &&
               !businessCategories.loan_repayment.keywords.some(kw => text.includes(kw))) {
        isIncome = true;
        detectedType = 'loan';
        businessAccountingType = 'liability';
        detectedCategory = 'loan';
        categoryEmoji = '🏦';
        categoryName = 'Loan Received (Liability)';
      }
      // RULE 6: LOAN REPAYMENT — paying back
      else if (businessCategories.loan_repayment.keywords.some(kw => text.includes(kw))) {
        isIncome = false;
        detectedType = 'expense';
        businessAccountingType = 'liability_payment';
        detectedCategory = 'loan_repayment';
        categoryEmoji = '🔄';
        categoryName = 'Loan Repayment';
      }
      // RULE 7: CAPITAL ASSET — long-term fixed asset purchase
      else if (businessCategories.capital_asset.keywords.some(kw => text.includes(kw))) {
        isIncome = false;
        detectedType = 'investment';
        businessAccountingType = 'asset';
        detectedCategory = 'capital_asset';
        categoryEmoji = '🏭';
        categoryName = 'Capital Asset';
      }
      // RULE 8: STOCK / GOODS / INVENTORY (COGS) — buying goods to sell
      else if (businessCategories.cogs.keywords.some(kw => text.includes(kw))) {
        isIncome = false;
        detectedType = 'investment';
        businessAccountingType = 'cogs';
        detectedCategory = 'cogs';
        categoryEmoji = '📦';
        categoryName = 'Stock / Goods (COGS)';
      }
      // RULE 9: OWNER EQUITY — owner putting in own money
      else if (businessCategories.owner_equity.keywords.some(kw => text.includes(kw))) {
        isIncome = true;
        detectedType = 'income';
        businessAccountingType = 'equity';
        detectedCategory = 'owner_equity';
        categoryEmoji = '💼';
        categoryName = 'Owner Investment';
      }
      // RULE 10: OPERATING EXPENSE — day-to-day running costs
      else if (businessCategories.operating_expense.keywords.some(kw => text.includes(kw))) {
        isIncome = false;
        detectedType = 'expense';
        businessAccountingType = 'expense';
        detectedCategory = 'operating_expense';
        categoryEmoji = '💸';
        categoryName = 'Operating Expense';
      }
      // RULE 11: DEFAULT FALLBACK — use amount heuristics
      else {
        if (amount >= 2000000 && !/(spent|paid for|cost|bill|salary|rent)/i.test(text)) {
          detectedType = 'investment';
          businessAccountingType = 'asset';
          categoryEmoji = '🏭';
          categoryName = 'Possible Asset';
        } else if (/(bought|purchased)/i.test(text)) {
          detectedType = 'investment';
          businessAccountingType = 'cogs';
          categoryEmoji = '📦';
          categoryName = 'Goods Purchased';
        } else {
          detectedType = 'expense';
          businessAccountingType = 'expense';
          categoryEmoji = '💸';
          categoryName = 'Operating Expense';
        }
      }
    } else {
      // ─── PERSONAL RULES ───
      const hasIncome = incomeKeywords.some(kw => text.includes(kw));
      const hasExpense = expenseKeywords.some(kw => text.includes(kw));

      // Detect personal category
      for (const [key, cat] of Object.entries(personalCategories)) {
        if (cat.keywords.some(kw => text.includes(kw))) {
          detectedCategory = key;
          categoryEmoji = cat.emoji;
          categoryName = cat.name;
          break;
        }
      }

      if (hasIncome && !hasExpense) { isIncome = true; detectedType = 'income'; }
      else if (/borrowed|loan/i.test(text)) { isIncome = true; detectedType = 'loan'; }
      else if (/saved|saving|invested|deposit/i.test(text)) { isIncome = false; detectedType = 'saving'; }
      else { isIncome = false; detectedType = 'expense'; }
    }

    // Extract source/destination/action — including "sold to [customer]"
    let source = '';
    let action = '';

    const soldMatch = text.match(/\bsold\s+(?:to\s+)?([a-z][a-z\s]{1,20}?)(?:\s+\d|\s+for\s+|\s*$)/i);
    const boughtFromMatch = text.match(/bought\s+(?:from\s+)([a-z][a-z\s]{1,20}?)(?:\s+\d|\s*$)/i);
    const fromMatch = text.match(/from\s+([a-z][a-z\s]{1,20}?)(?:\s+\d|\s*$)/i);
    const atMatch = text.match(/at\s+([a-z][a-z\s]{1,20}?)(?:\s+\d|\s*$)/i);
    const toMatch = text.match(/to\s+([a-z][a-z\s]{1,20}?)(?:\s+\d|\s*$)/i);

    if (/\bsold\b/i.test(text)) {
      action = 'sold';
      if (soldMatch) source = soldMatch[1].trim();
      else if (toMatch) source = toMatch[1].trim();
    } else if (/\bbought\b/i.test(text)) {
      action = 'bought';
      if (boughtFromMatch) source = boughtFromMatch[1].trim();
      else if (fromMatch) source = fromMatch[1].trim();
    } else if (fromMatch) {
      action = 'from';
      source = fromMatch[1].trim();
    } else if (atMatch) {
      action = 'at';
      source = atMatch[1].trim();
    }

    // Clean up description
    let description = input.replace(/(\d[\d,]*\.?\d*)\s*(million|m\b|k\b|thousand)?/gi, '').trim();
    if (source) description = description.replace(new RegExp(`(?:from|at|bought|sold)\\s+${source}`, 'i'), '').trim();
    description = description.replace(/\s+/g, ' ').trim();
    description = description.charAt(0).toUpperCase() + description.slice(1);
    if (!description || description.length < 2) {
      if (detectedType === 'income' && detectedCategory === 'sales') description = source ? `Sale to ${source}` : 'Sales Revenue';
      else if (detectedType === 'income') description = 'Income received';
      else if (detectedType === 'investment') description = categoryName || 'Business Investment';
      else if (detectedType === 'loan') description = 'Loan received';
      else if (businessAccountingType === 'tax_expense') description = 'Tax Payment';
      else if (businessAccountingType === 'paye_liability') description = 'PAYE / Payroll Tax';
      else description = categoryName || 'Expense';
    }

    return {
      amount: Math.round(amount),
      description,
      type: detectedType,
      isIncome,
      source,
      action,
      businessAccountingType,
      detectedCategory,
      categoryEmoji,
      categoryName,
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
          category: parsedData.detectedCategory,
          categoryName: parsedData.categoryName,
          categoryEmoji: parsedData.categoryEmoji,
          businessAccountingType: parsedData.businessAccountingType,
          aiConfidence: 0.95,
          auditTrail: `Categorized as ${parsedData.categoryName || 'General'} (${parsedData.businessAccountingType || 'expense'})`
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
                      ? '"Sold goods 800k" • "Bought stock 500k" • "Paid tax 200k"'
                      : '"Lunch 15k" • "Salary 800k" • "Bought shoes 120k"'
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
          {parsedData && (() => {
            // Derive display properties from new category fields
            const acctType = parsedData.businessAccountingType;
            const isCOGS    = acctType === 'cogs';
            const isAsset   = acctType === 'asset';
            const isLiab    = acctType === 'liability' || acctType === 'liability_payment';
            const isEquity  = acctType === 'equity';
            const isRevenue = acctType === 'revenue';
            const isExpense = acctType === 'expense';

            const cardBg =
              !parsedData.isValid     ? 'bg-gray-50 border-gray-300' :
              isCOGS || isAsset      ? 'bg-amber-50 border-amber-300' :
              isRevenue || isEquity  ? 'bg-green-50 border-green-300' :
              isLiab                 ? 'bg-blue-50 border-blue-300' :
              isExpense              ? 'bg-orange-50 border-orange-300' :
              parsedData.isIncome    ? 'bg-green-50 border-green-300' :
                                       'bg-orange-50 border-orange-300';

            const amountColor =
              isCOGS || isAsset     ? 'text-amber-600' :
              isRevenue || isEquity ? 'text-green-600' :
              isLiab                ? 'text-blue-600' :
                                      'text-orange-600';

            const icon = parsedData.categoryEmoji ||
              (parsedData.type === 'investment' ? '💰' : parsedData.isIncome ? '📈' : '💸');

            const amountDisplay = parsedData.isIncome
              ? `+${parsedData.amount.toLocaleString()}`
              : (isCOGS || isAsset)
                ? `${parsedData.amount.toLocaleString()}`   // no +/- for assets
                : `-${parsedData.amount.toLocaleString()}`;

            // Badge label for business mode
            const badgeLabel = parsedData.categoryName ||
              (parsedData.type === 'investment' ? 'Business Investment' :
               parsedData.type === 'income'     ? 'Income / Revenue' : 'Expense');

            // Accounting label (shown under the amount)
            const acctLabel =
              acctType === 'revenue'          ? 'DR Cash / Receivable · CR Sales Revenue' :
              acctType === 'cogs'             ? 'DR Inventory/COGS · CR Cash — deductible' :
              acctType === 'asset'            ? 'DR Fixed Asset · CR Cash — claim capital allowance' :
              acctType === 'liability'        ? 'DR Cash · CR Loan Payable — not taxable' :
              acctType === 'liability_payment'? 'DR Loan Payable · CR Cash — principal not deductible' :
              acctType === 'equity'           ? 'DR Cash · CR Owner Equity — not taxable income' :
              acctType === 'expense'          ? 'DR Operating Expense · CR Cash — deductible' :
              acctType === 'tax_expense'      ? 'DR Tax Expense · CR Cash — declare in tax return' :
              acctType === 'tax_liability'    ? 'DR Cash · CR VAT Payable — remit to authority' :
              acctType === 'paye_liability'   ? 'DR Salary Expense · CR PAYE Payable — remit monthly' : null;

            return (
              <div className={`rounded-lg p-4 flex flex-col gap-3 transition border-2 ${cardBg}`}>
                {/* Main Transaction Info */}
                <div className="flex items-center gap-3">
                  <span className="text-3xl">{icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-gray-900 text-sm">{parsedData.description}</div>
                    {parsedData.source && (
                      <div className="text-xs text-gray-600 mt-1">
                        {parsedData.action === 'bought' && '� From:'}
                        {parsedData.action === 'sold'   && '🤝 Customer:'}
                        {parsedData.action === 'from'   && '📤 From:'}
                        {parsedData.action === 'at'     && '📍 At:'}
                        {!parsedData.action && '📌'} {parsedData.source}
                      </div>
                    )}
                    {selectedMode === 'business' && acctLabel && (
                      <div className="text-xs text-gray-500 mt-1 font-mono">📊 {acctLabel}</div>
                    )}
                  </div>
                  <div className={`text-xl font-bold text-right flex-shrink-0 ${amountColor}`}>
                    {amountDisplay}
                  </div>
                </div>

                {/* Accounting Category Badge (Business Only) */}
                {selectedMode === 'business' && parsedData.categoryName && (
                  <div className="bg-white/70 rounded-lg px-3 py-2 flex items-center gap-2 text-sm">
                    <span className="text-lg">{parsedData.categoryEmoji}</span>
                    <span className="font-semibold text-gray-800">{badgeLabel}</span>
                    {/* Tax note for business compliance */}
                    {businessCategories[parsedData.detectedCategory]?.taxNote && (
                      <span className="text-xs text-indigo-600 ml-1 hidden sm:inline">
                        📌 {businessCategories[parsedData.detectedCategory].taxNote}
                      </span>
                    )}
                    {acctType && (
                      <span className={`ml-auto text-xs font-bold px-2 py-0.5 rounded-full ${
                        isCOGS || isAsset     ? 'bg-amber-200 text-amber-800' :
                        isRevenue || isEquity ? 'bg-green-200 text-green-800' :
                        isLiab               ? 'bg-blue-200 text-blue-800' :
                                               'bg-gray-200 text-gray-700'
                      }`}>
                        {acctType.toUpperCase().replace('_', ' ')}
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })()}

          {/* Analyzing spinner (business mode) */}
          {selectedMode === 'business' && isAnalyzing && (
            <div className="bg-blue-50 border border-blue-200 rounded px-3 py-2 flex items-center gap-2">
              <Loader className="w-4 h-4 animate-spin text-blue-600" />
              <span className="text-xs text-blue-700">🤖 Consulting professional accountant...</span>
            </div>
          )}

          {/* Helper Text */}
          {!textInput && !isListening && (
            <p className="text-xs text-gray-500 text-center">
              {selectedMode === 'business'
                ? '💵 "Sold maize 800k" • 📦 "Bought stock 2m" • 🏛️ "Paid tax 300k" • 💸 "Paid salary 1.5m"'
                : '💡 "Lunch 15k" • "Salary 800k" • "Saved 100k" • "Transport 5k"'}
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
