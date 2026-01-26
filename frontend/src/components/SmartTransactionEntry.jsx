/**
 * SmartTransactionEntry - Direct Text Input Recording
 * Minimal UI - just text input with OK button for quick transaction logging
 * User types directly, smart detection happens in background
 */

import React, { useState, useRef, useEffect } from 'react';
import { Send, Check } from 'lucide-react';


export const SmartTransactionEntry = ({ isOpen = false, onClose = null, onSubmit = null }) => {
  const [textInput, setTextInput] = useState('');
  const [parsedData, setParsedData] = useState(null);
  const inputRef = useRef(null);

  // Keywords for detecting expense vs income
  const incomeKeywords = ['salary', 'earned', 'received', 'income', 'bonus', 'interest', 'dividend', 'payment', 'refund', 'returned', 'paid'];
  const expenseKeywords = ['bought', 'lunch', 'dinner', 'breakfast', 'transport', 'taxi', 'shopping', 'fuel', 'bills', 'paid for', 'spent', 'expense'];

  // 🧠 Smart text parser - detects expense/income and extracts amount + source/destination
  const parseSmartInput = (input) => {
    if (!input.trim()) return null;

    const text = input.toLowerCase();
    
    // Extract amount (e.g., "500k", "500,000", "500000", "50m", "50000")
    const amountMatch = text.match(/(\d+\.?\d*)\s*([km])?/i);
    let amount = 0;
    
    if (amountMatch) {
      amount = parseFloat(amountMatch[1]);
      const multiplier = amountMatch[2]?.toLowerCase();
      if (multiplier === 'k') amount *= 1000;
      else if (multiplier === 'm') amount *= 1000000;
    }

    // Detect if income or expense
    let isIncome = false;
    let detectedType = 'expense';

    const hasIncome = incomeKeywords.some(keyword => text.includes(keyword));
    const hasExpense = expenseKeywords.some(keyword => text.includes(keyword));

    if (hasIncome && !hasExpense) {
      isIncome = true;
      detectedType = 'income';
    } else if (hasExpense && !hasIncome) {
      isIncome = false;
      detectedType = 'expense';
    } else if (!hasIncome && !hasExpense) {
      isIncome = false;
      detectedType = 'expense';
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

    // Extract description
    let description = text.replace(/(\d+\.?\d*)\s*([km])?/i, '').trim();
    if (source) {
      description = description.replace(/(?:from|at|bought|sold)\s+.+?(?:\s|$)/i, '').trim();
    }
    description = description.charAt(0).toUpperCase() + description.slice(1);
    if (!description) description = isIncome ? 'Income' : 'Expense';

    return {
      amount: Math.round(amount),
      description,
      type: detectedType,
      isIncome,
      source,
      action,
      isValid: amount > 0
    };
  };

  // Handle smart input change
  const handleSmartInput = (e) => {
    const value = e.target.value;
    setTextInput(value);
    const parsed = parseSmartInput(value);
    setParsedData(parsed);
  };

  // Focus input when modal opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  // Submit transaction
  const handleSubmit = () => {
    if (parsedData?.isValid) {
      const transaction = {
        type: 'smart_entry',
        amount: parsedData.amount,
        description: parsedData.description,
        entryType: parsedData.type,
        isIncome: parsedData.isIncome,
        source: parsedData.source,
        action: parsedData.action,
        timestamp: new Date().toISOString(),
        rawInput: textInput
      };

      if (onSubmit) {
        onSubmit(transaction);
      }

      // Reset
      setTextInput('');
      setParsedData(null);
      if (onClose) onClose();
    }
  };

  // Handle Enter key
  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && parsedData?.isValid) {
      handleSubmit();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex flex-col justify-between">
      {/* Close on background click */}
      <div 
        className="flex-1 cursor-pointer"
        onClick={onClose}
      />

      {/* Input Bar - Bottom */}
      <div className="bg-white border-t-2 border-purple-400 shadow-2xl">
        <div className="p-4 space-y-2">
          {/* Input Field */}
          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              type="text"
              placeholder="Type expense or income..."
              value={textInput}
              onChange={handleSmartInput}
              onKeyPress={handleKeyPress}
              className="flex-1 px-4 py-3 border-2 border-gray-300 rounded-lg text-base text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              autoFocus
            />
            <button
              onClick={handleSubmit}
              disabled={!parsedData?.isValid}
              className={`p-3 rounded-lg font-bold transition ${
                parsedData?.isValid
                  ? 'bg-gradient-to-r from-blue-500 to-cyan-500 text-white hover:shadow-lg active:scale-95'
                  : 'bg-gray-200 text-gray-400 cursor-not-allowed'
              }`}
            >
              <Send className="w-5 h-5" />
            </button>
          </div>

          {/* Smart Detection Display */}
          {parsedData && (
            <div className={`rounded-lg p-3 flex items-center gap-3 transition ${
              parsedData.isValid
                ? parsedData.isIncome
                  ? 'bg-green-50 border border-green-200'
                  : 'bg-orange-50 border border-orange-200'
                : 'bg-gray-50 border border-gray-200'
            }`}>
              <span className="text-2xl">
                {parsedData.isIncome ? '💰' : '💸'}
              </span>
              <div className="flex-1 min-w-0">
                <div className="font-bold text-gray-900 text-sm">
                  {parsedData.description}
                </div>
                {parsedData.source && (
                  <div className="text-xs text-gray-600">
                    {parsedData.action === 'bought' && '🛍️ Bought from:'}
                    {parsedData.action === 'sold' && '💵 Sold to:'}
                    {parsedData.action === 'from' && '📤 From:'}
                    {parsedData.action === 'at' && '📍 At:'}
                    {!parsedData.action && '📌'} {parsedData.source}
                  </div>
                )}
              </div>
              <div className="text-right flex-shrink-0">
                <div className={`text-lg font-bold ${
                  parsedData.isIncome ? 'text-green-600' : 'text-orange-600'
                }`}>
                  {parsedData.isIncome ? '+' : '-'} {parsedData.amount.toLocaleString()}
                </div>
                <Check className={`w-4 h-4 mx-auto mt-0.5 ${
                  parsedData.isIncome ? 'text-green-600' : 'text-orange-600'
                }`} />
              </div>
            </div>
          )}

          {/* Helper Text */}
          {!textInput && (
            <p className="text-xs text-gray-500 text-center">
              e.g. "Lunch 8k" • "Salary 500k" • "Bought from amazon 50k"
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default SmartTransactionEntry;
