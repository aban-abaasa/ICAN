import React, { useState, useEffect, useRef } from 'react';
import { Bot, X, User, Send, Paperclip, File } from 'lucide-react';
import { generateSpendingAdvice, generateSavingsAdvice, generateGoalAdvice, generateGeneralAdvice, generateWealthStatusReport, analyzeContract, analyzeDocument, performSecurityCheck, uploadAndAnalyzeDocument } from '../../../services/simpleAIAdviceService';

/**
 * Simple & Precise ICAN AI Assistant - Now powered by OpenAI with no limits
 * Direct, actionable financial advice with unlimited AI intelligence
 */
const AIChat = ({ isOpen, onClose, user, transactions, currentJourneyStage, netWorth, journeyStages }) => {
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);

  // Initialize with business/personal breakdown
  useEffect(() => {
    if (isOpen && messages.length === 0) {
      const initializeChat = async () => {
        const stage = journeyStages[currentJourneyStage];
        const userContext = {
          netWorth,
          transactions,
          currentStage: stage
        };
        
        const wealthStatus = await generateWealthStatusReport(userContext);
        
        setMessages([{
          id: Date.now(),
          type: 'ai',
          content: `👋 Hi! I'm your money helper.

💰 **YOUR MONEY:**

🏢 **Work:** UGX ${wealthStatus.breakdown.business.wealth.toLocaleString()}
• Make/lose: ${wealthStatus.breakdown.business.netCashFlow >= 0 ? '+' : ''}UGX ${wealthStatus.breakdown.business.netCashFlow.toLocaleString()}/year
• Profit: ${wealthStatus.breakdown.business.profitMargin.toFixed(1)}%

👤 **Personal:** UGX ${wealthStatus.breakdown.personal.wealth.toLocaleString()}
• Save: ${wealthStatus.breakdown.personal.netCashFlow >= 0 ? '+' : ''}UGX ${wealthStatus.breakdown.personal.netCashFlow.toLocaleString()}/year
• Save rate: ${wealthStatus.breakdown.personal.savingsRate.toFixed(1)}%

📊 **Total:** UGX ${wealthStatus.breakdown.combined.totalWealth.toLocaleString()}

${wealthStatus.assessment}

💬 Ask me: Should I buy? How to save? What's my money status? Check contracts!`,
          timestamp: new Date().toISOString()
        }]);
      };
      
      initializeChat();
    }
  }, [isOpen]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // File handling functions
  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (file) {
      // Check file size (5MB limit)
      if (file.size > 5 * 1024 * 1024) {
        alert('File too large. Max size: 5MB');
        return;
      }
      
      // Check file type
      const allowedTypes = ['text/plain', 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
      if (!allowedTypes.includes(file.type)) {
        alert('File type not supported. Use: TXT, PDF, DOC, DOCX');
        return;
      }
      
      setSelectedFile(file);
      setInputMessage(`📎 ${file.name} - Click send to analyze`);
    }
  };

  const removeFile = () => {
    setSelectedFile(null);
    setInputMessage('');
  };

  const processMessage = async (message) => {
    const userMsg = {
      id: Date.now(),
      type: 'user',
      content: selectedFile ? `📎 Uploaded: ${selectedFile.name}` : message,
      timestamp: new Date().toISOString(),
      hasFile: !!selectedFile
    };
    
    setMessages(prev => [...prev, userMsg]);
    
    // Store file reference for processing
    const fileToProcess = selectedFile;
    setSelectedFile(null);
    setInputMessage('');
    setIsTyping(true);

    // Process file or text
    setTimeout(async () => {
      const response = fileToProcess ? 
        await generateFileResponse(fileToProcess) :
        await generateResponse(message.toLowerCase());
      setMessages(prev => [...prev, response]);
      setIsTyping(false);
    }, 800);
  };

  const generateFileResponse = async (file) => {
    try {
      const analysis = await uploadAndAnalyzeDocument(file);
      
      if (analysis.isValid) {
        const securityCheck = performSecurityCheck(analysis.extractedText || '');
        
        return {
          id: Date.now() + 1,
          type: 'ai',
          content: `📄 **Document Analysis: ${file.name}**

${analysis.analysis}

🛡️ **Security Check:**
• Score: ${securityCheck.securityScore}%
• Risk: ${analysis.riskLevel?.toUpperCase() || 'UNKNOWN'}
• Recommendation: ${securityCheck.recommendation}

${securityCheck.issues.length > 0 ? '⚠️ **Issues Found:**\n' + securityCheck.issues.map(issue => `• ${issue}`).join('\n') : '✅ **No major security issues found**'}

📊 **File Info:**
• Type: ${analysis.documentType || 'Document'}
• Size: ${(file.size / 1024).toFixed(1)} KB
• AI Powered: ${analysis.aiPowered ? 'Yes' : 'Basic'}`,
          timestamp: new Date().toISOString()
        };
      } else {
        return {
          id: Date.now() + 1,
          type: 'ai',
          content: `❌ **File Analysis Failed**

Error: ${analysis.error}

💡 **Tips:**
• Make sure file is readable text
• Try copying and pasting the text instead
• Supported formats: TXT files currently`,
          timestamp: new Date().toISOString()
        };
      }
    } catch (error) {
      console.error('File processing error:', error);
      return {
        id: Date.now() + 1,
        type: 'ai',
        content: `❌ **File Processing Error**

${error.message}

💡 **Try Again:**
• Check if file is corrupted
• Use supported file types
• Copy and paste text instead`,
        timestamp: new Date().toISOString()
      };
    }
  };

  const generateResponse = async (message) => {
    const stage = journeyStages[currentJourneyStage];
    const recentExpenses = transactions.filter(t => t.type === 'expense').slice(-5);
    const monthlyExpenses = recentExpenses.reduce((sum, t) => sum + (t.amount || 0), 0);
    const monthlyIncome = 500000; // Could be passed from props or calculated
    
    const userContext = {
      netWorth,
      recentExpenses,
      currentStage: stage,
      monthlyIncome,
      monthlyExpenses,
      transactions // Add this for business/personal analysis
    };

    let response = "";

    try {
      // SPENDING QUESTIONS
      if (message.includes('buy') || message.includes('spend') || message.includes('purchase')) {
        // Extract potential amount from message
        const amountMatch = message.match(/(\d+(?:,\d+)*)/);
        const amount = amountMatch ? parseInt(amountMatch[0].replace(/,/g, '')) : 50000;
        
        const transaction = {
          amount: amount,
          description: message
        };
        
        const advice = await generateSpendingAdvice(transaction, userContext);
        response = `💸 **Buy This?**

${advice.message}

📊 **Risk:** ${advice.riskLevel}
🤖 **AI Help:** ${advice.aiPowered ? 'Yes' : 'Basic'}`;
      }
      // CONTRACT & DOCUMENT ANALYSIS
      else if (message.includes('contract') || message.includes('terms') || message.includes('verify') || message.includes('agreement') || 
               message.includes('document') || message.includes('analyze') || message.includes('analyse') || message.includes('check this')) {
        
        // Check if user is asking HOW the analysis works
        const isAskingHow = message.includes('how you do') || message.includes('how do you') || message.includes('how does it work') || 
                           message.includes('anayse documents') || message.includes('analyze documents');
        
        if (isAskingHow) {
          const advice = await generateGeneralAdvice(message, userContext);
          response = advice.advice;
        }
        // Check if user pasted document/contract text for analysis
        else if (message.length > 200) {
          const isContract = message.includes('contract') || message.includes('terms') || message.includes('agreement');
          
          if (isContract) {
            const contractAnalysis = await analyzeContract(message, userContext);
            const securityCheck = performSecurityCheck(message);
            
            if (contractAnalysis.isValid) {
              response = `📄 **Contract Analysis:**

${contractAnalysis.analysis}

🛡️ **Security:**
• Score: ${securityCheck.securityScore}%
• Risk: ${contractAnalysis.riskLevel.toUpperCase()}
• Advice: ${securityCheck.recommendation}

${securityCheck.issues.length > 0 ? '⚠️ **Problems:**\n' + securityCheck.issues.join('\n') : '✅ **No major issues**'}

🤖 **AI:** ${contractAnalysis.aiPowered ? 'Full AI' : 'Basic'}`;
            } else {
              response = `❌ **Analysis Failed:** ${contractAnalysis.error}`;
            }
          } else {
            const docAnalysis = await analyzeDocument(message, 'document');
            
            if (docAnalysis.isValid) {
              response = `📄 **Document Analysis:**

${docAnalysis.analysis}

📊 **Info:**
• Type: ${docAnalysis.documentType}
• Risk: ${docAnalysis.riskLevel.toUpperCase()}
• AI: ${docAnalysis.aiPowered ? 'Yes' : 'Basic'}`;
            } else {
              response = `❌ **Analysis Failed:** ${docAnalysis.error}`;
            }
          }
        } else {
          const advice = await generateGeneralAdvice(message, userContext);
          response = advice.advice;
        }
      }
      // SAVINGS/ACCOUNT QUESTIONS - Direct answers  
      else if (message.includes('save') || message.includes('money') || message.includes('invest') || message.includes('account')) {
        // Check if asking for direct amounts
        const isDirectQuestion = message.includes('what is my') || message.includes('how much') || message.includes('show me') || message.includes('my savings');
        
        if (isDirectQuestion) {
          const advice = await generateGeneralAdvice(message, userContext);
          response = advice.advice;
        } else {
          const advice = await generateSavingsAdvice(userContext);
          response = `💰 **How to Save More:**

You save: ${advice.currentSavingsRate.toFixed(1)}% of what you earn
${advice.aiAdvice}

🎯 Goal: UGX ${advice.nextTarget.toLocaleString()}
⏰ Time: ${advice.timeline}`;
        }
      }
      // GOAL QUESTIONS
      else if (message.includes('goal') || message.includes('rich') || message.includes('wealthy')) {
        const targetAmount = stage?.threshold?.max || netWorth * 2;
        const advice = await generateGoalAdvice(targetAmount, userContext);
        response = `🎯 **Goal Achievement:**

Target: UGX ${advice.targetAmount.toLocaleString()}
Gap: UGX ${advice.gap.toLocaleString()}

${advice.aiAdvice}

📈 Timeline: ${advice.achievableTimeframe} months`;
      }
      // GENERAL QUESTIONS
      else {
        const advice = await generateGeneralAdvice(message, userContext);
        
        // If it's a direct answer (like account balance), show it simply
        if (advice.directAnswer) {
          response = advice.advice;
        } else {
          response = `💡 **Money Advice:**

${advice.advice}

📊 **Your Info:**
• Level: ${advice.context.stage}
• Save rate: ${advice.context.savingsRate.toFixed(1)}%
• 🤖 AI help: ${advice.aiPowered ? 'Yes' : 'No'}`;
        }
      }
    } catch (error) {
      console.error('AI response error:', error);
      response = `⚠️ **AI temporarily unavailable**

For ${stage?.name} stage:
• Monthly expenses: UGX ${monthlyExpenses.toLocaleString()}
• Focus: ${stage?.improvement || 'Save more, spend wisely'}
• Ask specific questions like "Should I buy a car for UGX 2,000,000?"`;
    }

    return {
      id: Date.now() + 1,
      type: 'ai',
      content: response,
      timestamp: new Date().toISOString()
    };
  };

  const handleSendMessage = (e) => {
    e.preventDefault();
    if (!inputMessage.trim() && !selectedFile) return;
    processMessage(inputMessage.trim());
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="glass-card p-0 max-w-lg w-full h-[70vh] flex flex-col">
        
        {/* Header */}
        <div className="p-4 border-b border-white border-opacity-20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-blue-500 bg-opacity-20 rounded-full flex items-center justify-center">
              <Bot className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <h3 className="text-white font-medium">Money Helper</h3>
              <p className="text-gray-400 text-xs">Simple Money Advice</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex gap-3 ${message.type === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              {message.type === 'ai' && (
                <div className="w-6 h-6 bg-blue-500 bg-opacity-20 rounded-full flex items-center justify-center flex-shrink-0">
                  <Bot className="w-3 h-3 text-blue-400" />
                </div>
              )}
              
              <div className={`max-w-[85%] p-3 rounded-lg text-sm ${
                message.type === 'user' 
                  ? 'bg-blue-600 bg-opacity-80 text-white' 
                  : 'bg-white bg-opacity-10 text-gray-100'
              }`}>
                <div className="whitespace-pre-line leading-relaxed">
                  {message.content}
                </div>
              </div>

              {message.type === 'user' && (
                <div className="w-6 h-6 bg-green-500 bg-opacity-20 rounded-full flex items-center justify-center flex-shrink-0">
                  <User className="w-3 h-3 text-green-400" />
                </div>
              )}
            </div>
          ))}

          {isTyping && (
            <div className="flex gap-3 justify-start">
              <div className="w-6 h-6 bg-blue-500 bg-opacity-20 rounded-full flex items-center justify-center">
                <Bot className="w-3 h-3 text-blue-400 animate-pulse" />
              </div>
              <div className="bg-white bg-opacity-10 text-gray-100 p-3 rounded-lg">
                <div className="flex items-center gap-1">
                  <div className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce"></div>
                  <div className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                  <div className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                  <span className="text-xs text-gray-400 ml-2">Thinking...</span>
                </div>
              </div>
            </div>
          )}
          
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <form onSubmit={handleSendMessage} className="p-4 border-t border-white border-opacity-20">
          
          {/* File attachment indicator */}
          {selectedFile && (
            <div className="mb-3 p-2 bg-blue-500 bg-opacity-20 rounded-lg flex items-center gap-2">
              <File className="w-4 h-4 text-blue-400" />
              <span className="text-blue-300 text-sm flex-1">{selectedFile.name}</span>
              <span className="text-blue-400 text-xs">{(selectedFile.size / 1024).toFixed(1)} KB</span>
              <button
                type="button"
                onClick={removeFile}
                className="text-blue-400 hover:text-blue-300 ml-2"
              >
                ×
              </button>
            </div>
          )}
          
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <input
                type="text"
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                placeholder={selectedFile ? "Click send to analyze file" : "Ask about spending, saving, investments, or your journey..."}
                className="w-full bg-white bg-opacity-10 border border-white border-opacity-20 rounded-lg px-3 py-2 pr-12 text-sm text-white placeholder-gray-400 focus:outline-none focus:border-blue-400"
                disabled={isTyping}
                readOnly={!!selectedFile}
              />
              
              {/* Upload icon inside input field */}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="absolute right-3 top-1/2 transform -translate-y-1/2 text-white hover:text-blue-400 transition-colors p-1 z-10"
                title="Upload document to analyze"
              >
                <Paperclip className="w-5 h-5" />
              </button>
            </div>
            
            <button
              type="submit"
              disabled={isTyping || (!inputMessage.trim() && !selectedFile)}
              className="px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white rounded-lg transition-colors"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
          
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.pdf,.doc,.docx,.rtf"
            onChange={handleFileSelect}
            className="hidden"
          />
        </form>

      </div>
    </div>
  );
};

export default AIChat;
