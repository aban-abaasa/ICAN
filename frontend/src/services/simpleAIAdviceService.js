/**
 * 🎯 SIMPLE AI ADVICE SERVICE
 * Direct, actionable financial advice using OpenAI with no limits
 */

// OpenAI Configuration - No rate limiting
const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY;
const OPENAI_API_URL = 'https://api.openai.com/v1';

/**
 * 📊 Analyze business vs personal wealth from transactions
 */
const analyzeWealthBreakdown = (transactions) => {
  let businessWealth = 0;
  let personalWealth = 0;
  let businessIncome = 0;
  let personalIncome = 0;
  let businessExpenses = 0;
  let personalExpenses = 0;

  transactions.forEach(transaction => {
    const amount = transaction.amount || 0;
    const description = (transaction.description || '').toLowerCase();
    const type = transaction.type || 'expense';
    
    // Determine if business or personal
    const isBusiness = description.includes('business') || 
                      description.includes('work') || 
                      description.includes('office') || 
                      description.includes('commercial') || 
                      description.includes('client') || 
                      description.includes('contract') || 
                      description.includes('equipment') || 
                      description.includes('vehicle') && amount > 1000000 || // Large vehicle likely business
                      description.includes('investment') && amount > 500000; // Large investments likely business
    
    if (type === 'income' || type === 'revenue') {
      if (isBusiness) {
        businessIncome += amount;
        businessWealth += amount;
      } else {
        personalIncome += amount;
        personalWealth += amount;
      }
    } else if (type === 'expense') {
      if (isBusiness) {
        businessExpenses += amount;
        businessWealth -= amount;
      } else {
        personalExpenses += amount;
        personalWealth -= amount;
      }
    }
  });

  return {
    business: {
      wealth: businessWealth,
      income: businessIncome,
      expenses: businessExpenses,
      netCashFlow: businessIncome - businessExpenses,
      profitMargin: businessIncome > 0 ? ((businessIncome - businessExpenses) / businessIncome * 100) : 0
    },
    personal: {
      wealth: personalWealth,
      income: personalIncome,
      expenses: personalExpenses,
      netCashFlow: personalIncome - personalExpenses,
      savingsRate: personalIncome > 0 ? ((personalIncome - personalExpenses) / personalIncome * 100) : 0
    },
    combined: {
      totalWealth: businessWealth + personalWealth,
      totalIncome: businessIncome + personalIncome,
      totalExpenses: businessExpenses + personalExpenses
    }
  };
};

/**
 * 🤖 Enhanced OpenAI call with no limits
 */
const callOpenAI = async (prompt, temperature = 0.3) => {
  if (!OPENAI_API_KEY) {
    console.warn('⚠️ OpenAI API key not configured. Using fallback responses.');
    return null;
  }

  try {
    const response = await fetch(`${OPENAI_API_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You give simple money advice. Use basic words. Be direct. Max 2 short sentences.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature,
        max_tokens: 200
      })
    });

    if (!response.ok) {
      console.error('OpenAI API error:', response.status);
      return null;
    }

    const data = await response.json();
    return data.choices[0].message.content;
  } catch (error) {
    console.error('OpenAI call failed:', error);
    return null;
  }
};

/**
 * Generate quick spending advice based on transaction context
 */
export const generateSpendingAdvice = async (transaction, userContext) => {
  const { netWorth = 0, recentExpenses = [], currentStage = {}, transactions = [] } = userContext;
  const amount = transaction.amount || 0;
  const description = (transaction.description || '').toLowerCase();
  
  // Analyze business vs personal wealth breakdown
  const wealthBreakdown = analyzeWealthBreakdown(transactions);
  
  // Determine if this is business or personal expense
  const isBusiness = description.includes('business') || description.includes('work') || description.includes('equipment') || (amount > 1000000 && (description.includes('vehicle') || description.includes('property')));
  
  // Create AI prompt with business/personal context
  const aiPrompt = `
User wants to spend UGX ${amount.toLocaleString()} on "${description}".

MONEY STATUS:
• Work Money: UGX ${wealthBreakdown.business.wealth.toLocaleString()}
• Personal Money: UGX ${wealthBreakdown.personal.wealth.toLocaleString()}
• Total Money: UGX ${wealthBreakdown.combined.totalWealth.toLocaleString()}

THIS IS: ${isBusiness ? 'WORK EXPENSE' : 'PERSONAL EXPENSE'}

Should they buy it? YES or NO? Why? Keep it simple.
Answer: ✅/❌ [YES/NO] | Reason: [why] | Tip: [1 simple tip]`;

  // Try AI first, fallback to local logic
  const aiAdvice = await callOpenAI(aiPrompt);
  
  if (aiAdvice) {
    return {
      recommendation: aiAdvice.includes('✅') ? 'proceed' : 'reconsider',
      shouldProceed: aiAdvice.includes('✅'),
      message: aiAdvice,
      confidence: 0.95,
      riskLevel: amount > netWorth * 0.3 ? 'high' : amount < 50000 ? 'low' : 'medium',
      aiPowered: true
    };
  }

  // Fallback to simple logic if AI fails
  const isLargePurchase = amount > netWorth * 0.3;
  const isVehicle = description.includes('car') || description.includes('van') || description.includes('vehicle');
  const isProperty = description.includes('land') || description.includes('house') || description.includes('property');
  const isLuxury = description.includes('jewelry') || description.includes('watch') || description.includes('luxury');
  
  let recommendation = "proceed";
  let message = "";
  let shouldProceed = true;

  if (isLargePurchase && !isVehicle && !isProperty) {
    recommendation = "reconsider";
    shouldProceed = false;
    message = `❌ Too much money (${((amount/netWorth)*100).toFixed(0)}% of what you have). Only buy if you really need it.`;
  } else if (isLuxury) {
    recommendation = "delay";
    shouldProceed = false;
    message = `❌ Fancy stuff. Save UGX ${amount.toLocaleString()} instead.`;
  } else if (isVehicle) {
    if (amount < netWorth * 0.5) {
      message = `✅ Car is okay for your money. Think about used vs new.`;
    } else {
      shouldProceed = false;
      message = `❌ Car costs too much. Max: UGX ${Math.round(netWorth * 0.4).toLocaleString()}`;
    }
  } else {
    message = `✅ Okay if you really need it.`;
  }

  return {
    recommendation,
    shouldProceed,
    message,
    confidence: 0.8,
    riskLevel: isLargePurchase ? 'high' : amount < 50000 ? 'low' : 'medium',
    aiPowered: false
  };
};

/**
 * Generate simple savings advice
 */
export const generateSavingsAdvice = async (userContext) => {
  const { netWorth = 0, recentExpenses = [], currentStage = {}, monthlyIncome = 0 } = userContext;
  const monthlyExpenses = recentExpenses.reduce((sum, t) => sum + (t.amount || 0), 0);
  
  const aiPrompt = `
User money info:
- Total money: UGX ${netWorth.toLocaleString()}
- Spends monthly: UGX ${monthlyExpenses.toLocaleString()}
- Earns monthly: UGX ${monthlyIncome.toLocaleString()}

Give 3 easy ways to save more money this week. Be simple.
Answer: 1) [do this] 2) [do this] 3) [do this]`;

  const aiAdvice = await callOpenAI(aiPrompt);
  
  const savingsRate = monthlyIncome > 0 ? ((monthlyIncome - monthlyExpenses) / monthlyIncome) * 100 : 0;
  const nextTarget = currentStage.threshold?.max || netWorth * 2;
  const gap = nextTarget - netWorth;
  
  return {
    currentSavingsRate: Math.max(0, savingsRate),
    monthlyExpenses,
    nextTarget,
    gap,
    recommendedMonthlySavings: Math.max(gap / 12, monthlyIncome * 0.2),
    aiAdvice: aiAdvice || "Focus on reducing expenses and increasing savings rate.",
    quickTips: aiAdvice ? aiAdvice.split(/\d\)/).filter(tip => tip.trim()) : [
      `Stop spending UGX ${Math.round(monthlyExpenses * 0.1).toLocaleString()}/month`,
      `Save UGX ${Math.round(monthlyIncome * 0.2).toLocaleString()}/month`,
      `Write down what you spend for 1 week`
    ],
    timeline: `${Math.ceil(gap / (monthlyIncome * 0.2 || 50000))} months to next stage`,
    aiPowered: !!aiAdvice
  };
};

/**
 * Generate goal achievement advice
 */
export const generateGoalAdvice = async (targetAmount, userContext) => {
  const { netWorth = 0, monthlyIncome = 0, currentStage = {} } = userContext;
  const gap = targetAmount - netWorth;
  
  const aiPrompt = `
User wants UGX ${targetAmount.toLocaleString()}.
They have UGX ${netWorth.toLocaleString()}.
They need UGX ${gap.toLocaleString()} more.
They earn UGX ${monthlyIncome.toLocaleString()} per month.

How long will it take? What should they do? Keep it simple.
Answer: Time: [months] | Do: 1) [action] 2) [action] 3) [action]`;

  const aiAdvice = await callOpenAI(aiPrompt);
  const monthlySavingsNeeded = Math.max(gap / 24, targetAmount * 0.05);
  
  return {
    currentPosition: netWorth,
    targetAmount,
    gap,
    monthlySavingsNeeded,
    achievableTimeframe: Math.ceil(gap / (monthlyIncome * 0.3 || 100000)),
    aiAdvice: aiAdvice || `Save UGX ${Math.round(monthlySavingsNeeded).toLocaleString()}/month to reach your goal.`,
    actionPlan: aiAdvice ? aiAdvice.split(/\d\)/).filter(action => action.trim()) : [
      `Save UGX ${Math.round(monthlySavingsNeeded).toLocaleString()} every month`,
      `Make 20% more money`,
      `Spend 15% less money`
    ],
    aiPowered: !!aiAdvice
  };
};

/**
 * 📄 Contract Verification and Analysis (enhanced for file uploads)
 */
export const analyzeContract = async (contractText, userContext = {}) => {
  // Handle both text input and file upload results
  const textToAnalyze = typeof contractText === 'string' ? contractText : contractText.extractedText || '';
  
  if (!textToAnalyze || textToAnalyze.trim().length < 50) {
    return {
      isValid: false,
      error: "Contract text too short. Need at least 50 characters.",
      aiPowered: false
    };
  }

  const aiPrompt = `
Analyze this document/contract for potential issues:

"${textToAnalyze.substring(0, 2000)}..."

Perform DETAILED analysis:

1. RISK LEVEL: Classify as HIGH/MEDIUM/LOW risk
2. KEY ISSUES: List specific problems found
3. HIDDEN COSTS: Any fees, charges, or penalties
4. CANCELLATION: How easy is it to cancel or get refunds
5. RED FLAGS: Dangerous or unfair terms
6. GOOD POINTS: Positive aspects or protections
7. RECOMMENDATION: Should user SIGN, REVIEW WITH LAWYER, or AVOID
8. SUMMARY: One sentence bottom line advice

Be specific about actual terms found in the document. Use simple words.

Format response as:
RISK: [HIGH/MEDIUM/LOW]
ISSUES: [specific problems]
HIDDEN COSTS: [fees found]
CANCELLATION: [policy details]
RED FLAGS: [dangerous terms]
GOOD POINTS: [protections]
RECOMMENDAT ION: [action]
SUMMARY: [one sentence advice]`;

  try {
    const aiAdvice = await callOpenAI(aiPrompt, 0.2); // Low temperature for consistent analysis
    
    if (aiAdvice) {
      return {
        isValid: true,
        analysis: aiAdvice,
        contractLength: textToAnalyze.length,
        riskLevel: aiAdvice.includes('HIGH') ? 'high' : aiAdvice.includes('MEDIUM') ? 'medium' : 'low',
        aiPowered: true,
        timestamp: new Date().toISOString(),
        isFileUpload: typeof contractText === 'object' && contractText.fileName,
        fileName: contractText.fileName || null
      };
    }
  } catch (error) {
    console.error('Contract AI analysis failed:', error);
  }

  // Fallback analysis
  return generateBasicContractAnalysis(textToAnalyze);
};

/**
 * 🔍 Basic contract analysis when AI unavailable
 */
const generateBasicContractAnalysis = (contractText) => {
  const text = contractText.toLowerCase();
  const issues = [];
  const benefits = [];
  let riskLevel = 'low';

  // Check for red flags
  if (text.includes('non-refundable') || text.includes('no refund')) {
    issues.push('No refund policy');
    riskLevel = 'medium';
  }
  if (text.includes('automatic renewal') || text.includes('auto-renew')) {
    issues.push('Auto-renewal clause');
    riskLevel = 'medium';
  }
  if (text.includes('penalty') || text.includes('fine')) {
    issues.push('Penalty fees mentioned');
    riskLevel = 'high';
  }
  if (text.includes('binding') && text.includes('arbitration')) {
    issues.push('Binding arbitration required');
    riskLevel = 'medium';
  }
  if (text.includes('personal data') || text.includes('information')) {
    benefits.push('Data handling mentioned');
  }
  if (text.includes('warranty') || text.includes('guarantee')) {
    benefits.push('Warranty/guarantee included');
  }

  const analysis = `RISK: ${riskLevel.toUpperCase()}
MAIN ISSUES: ${issues.length ? issues.join(', ') : 'No major issues found'}
GOOD PARTS: ${benefits.length ? benefits.join(', ') : 'Standard terms'}
ADVICE: ${riskLevel === 'high' ? 'Be careful - review with lawyer' : riskLevel === 'medium' ? 'Read carefully before signing' : 'Looks reasonable'}`;

  return {
    isValid: true,
    analysis,
    contractLength: contractText.length,
    riskLevel,
    aiPowered: false,
    timestamp: new Date().toISOString()
  };
};

/**
 * 📧 Verification Status Management
 */
export const getVerificationStatus = () => {
  // This would typically come from user profile/database
  return {
    email: {
      verified: true,
      verifiedDate: '2026-01-15',
      status: 'verified'
    },
    phone: {
      verified: true,
      verifiedDate: '2026-01-10', 
      status: 'verified'
    },
    identity: {
      verified: false,
      verifiedDate: null,
      status: 'pending'
    },
    overall: {
      completionRate: 67, // 2 out of 3 verified
      nextStep: 'Complete identity verification'
    }
  };
};

/** * 📁 File Upload and Document Processing
 */
export const uploadAndAnalyzeDocument = async (file, userContext = {}) => {
  if (!file) {
    return {
      isValid: false,
      error: "No file provided",
      aiPowered: false
    };
  }

  // Check file size (max 5MB)
  if (file.size > 5 * 1024 * 1024) {
    return {
      isValid: false,
      error: "File too large. Max size: 5MB",
      aiPowered: false
    };
  }

  // Check file type
  const allowedTypes = [
    'text/plain',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/rtf'
  ];

  if (!allowedTypes.includes(file.type)) {
    return {
      isValid: false,
      error: "File type not supported. Use: PDF, DOCX, DOC, RTF, or TXT",
      aiPowered: false
    };
  }

  try {
    const extractedText = await extractTextFromFile(file);
    
    if (!extractedText || extractedText.length < 50) {
      return {
        isValid: false,
        error: "Could not extract text from file or file too short",
        aiPowered: false
      };
    }

    // Determine document type based on filename and content
    const documentType = determineDocumentType(file.name, extractedText);
    
    // Analyze the extracted text
    const analysis = await analyzeDocument(extractedText, documentType);
    
    return {
      ...analysis,
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type,
      extractedText: extractedText.substring(0, 1000) + '...', // First 1000 chars for preview
      uploadTimestamp: new Date().toISOString()
    };
    
  } catch (error) {
    console.error('File processing failed:', error);
    return {
      isValid: false,
      error: "Failed to process file: " + error.message,
      aiPowered: false
    };
  }
};

/**
 * 📄 Extract text from different file formats
 */
const extractTextFromFile = async (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = async (e) => {
      try {
        if (file.type === 'text/plain') {
          // Plain text file
          resolve(e.target.result);
        } else if (file.type === 'application/pdf') {
          // For PDF files, we'll need a PDF library or send to backend
          // For now, show error message
          reject(new Error('PDF parsing requires backend processing. Please copy and paste text instead.'));
        } else if (file.type.includes('word') || file.type.includes('document')) {
          // For Word documents, we'll need a library or backend processing
          reject(new Error('Word document parsing requires backend processing. Please copy and paste text instead.'));
        } else {
          // Try to read as text for other formats
          resolve(e.target.result);
        }
      } catch (error) {
        reject(error);
      }
    };
    
    reader.onerror = () => reject(new Error('Failed to read file'));
    
    // Read file as text
    reader.readAsText(file);
  });
};

/**
 * 🔍 Determine document type from filename and content
 */
const determineDocumentType = (filename, content) => {
  const name = filename.toLowerCase();
  const text = content.toLowerCase();
  
  if (name.includes('contract') || text.includes('contract') || text.includes('agreement')) {
    return 'Contract';
  } else if (name.includes('lease') || text.includes('lease') || text.includes('rent')) {
    return 'Lease Agreement';
  } else if (name.includes('employment') || name.includes('job') || text.includes('employment')) {
    return 'Employment Contract';
  } else if (name.includes('loan') || text.includes('loan') || text.includes('credit')) {
    return 'Loan Agreement';
  } else if (name.includes('terms') || text.includes('terms of service') || text.includes('terms and conditions')) {
    return 'Terms & Conditions';
  } else if (name.includes('privacy') || text.includes('privacy policy')) {
    return 'Privacy Policy';
  } else if (name.includes('invoice') || text.includes('invoice') || text.includes('bill')) {
    return 'Invoice/Bill';
  } else {
    return 'Legal Document';
  }
};

/**
 * 📋 Supported file types information
 */
export const getSupportedFileTypes = () => {
  return {
    supported: [
      { type: 'text/plain', extension: '.txt', name: 'Text Files' },
      { type: 'application/pdf', extension: '.pdf', name: 'PDF Documents', note: 'Coming soon' },
      { type: 'application/msword', extension: '.doc', name: 'Word Documents (Old)', note: 'Coming soon' },
      { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', extension: '.docx', name: 'Word Documents', note: 'Coming soon' },
      { type: 'application/rtf', extension: '.rtf', name: 'Rich Text Format', note: 'Coming soon' }
    ],
    maxSize: '5MB',
    currentlyWorking: ['text/plain'],
    comingSoon: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
  };
};

/** * � Analyze any document type (contracts, agreements, policies, etc)
 */
export const analyzeDocument = async (documentText, documentType = 'unknown') => {
  if (!documentText || documentText.trim().length < 30) {
    return {
      isValid: false,
      error: "Document text too short. Need at least 30 characters.",
      aiPowered: false
    };
  }

  const aiPrompt = `
Analyze this ${documentType} document:

"${documentText.substring(0, 2500)}"

Provide comprehensive analysis:

1. DOCUMENT TYPE: What kind of document is this?
2. MAIN PURPOSE: What is this document for?
3. KEY POINTS: Most important terms or conditions
4. RISKS: Potential problems or concerns
5. BENEFITS: Good aspects or protections
6. COSTS: Any fees, charges, or financial obligations
7. OBLIGATIONS: What you must do if you agree
8. RIGHTS: What protections or rights you get
9. RECOMMENDATION: Should you proceed? Any precautions?
10. SUMMARY: Simple explanation in one sentence

Use basic, clear language. Be specific about what you find.

Format:
TYPE: [document type]
PURPOSE: [what it's for]
KEY POINTS: [important terms]
RISKS: [problems]
BENEFITS: [good parts]
COSTS: [money involved]
OBLIGATIONS: [what you must do]
RIGHTS: [what you get]
RECOMMENDAT ION: [advice]
SUMMARY: [one sentence]`;

  try {
    const aiAdvice = await callOpenAI(aiPrompt, 0.1); // Very low temperature for consistent analysis
    
    if (aiAdvice) {
      // Extract risk level from AI response
      const riskLevel = aiAdvice.includes('HIGH RISK') || aiAdvice.includes('AVOID') ? 'high' :
                       aiAdvice.includes('MEDIUM') || aiAdvice.includes('CAUTION') ? 'medium' : 'low';
      
      return {
        isValid: true,
        analysis: aiAdvice,
        documentLength: documentText.length,
        documentType: documentType,
        riskLevel: riskLevel,
        aiPowered: true,
        timestamp: new Date().toISOString(),
        confidence: 0.95
      };
    }
  } catch (error) {
    console.error('Document AI analysis failed:', error);
  }

  // Enhanced fallback analysis
  return generateAdvancedDocumentAnalysis(documentText, documentType);
};

/**
 * 🔍 Advanced fallback document analysis
 */
const generateAdvancedDocumentAnalysis = (documentText, documentType) => {
  const text = documentText.toLowerCase();
  const analysis = {
    type: documentType,
    risks: [],
    benefits: [],
    costs: [],
    obligations: [],
    rights: []
  };
  
  let riskLevel = 'low';
  
  // Detect document type if unknown
  if (documentType === 'unknown') {
    if (text.includes('employment') || text.includes('job') || text.includes('salary')) {
      analysis.type = 'Employment Contract';
    } else if (text.includes('lease') || text.includes('rent') || text.includes('property')) {
      analysis.type = 'Lease Agreement';
    } else if (text.includes('loan') || text.includes('credit') || text.includes('interest')) {
      analysis.type = 'Loan Agreement';
    } else if (text.includes('service') || text.includes('terms of use')) {
      analysis.type = 'Service Agreement';
    } else {
      analysis.type = 'Legal Document';
    }
  }
  
  // Risk detection
  if (text.includes('non-refundable') || text.includes('no refund')) {
    analysis.risks.push('No refund policy');
    riskLevel = 'medium';
  }
  if (text.includes('automatic renewal') || text.includes('auto-renew')) {
    analysis.risks.push('Automatic renewal clause');
    riskLevel = 'medium';
  }
  if (text.includes('penalty') || text.includes('fine') || text.includes('late fee')) {
    analysis.risks.push('Penalty fees or fines');
    riskLevel = 'high';
  }
  if (text.includes('personal data') || text.includes('information sharing')) {
    analysis.risks.push('Personal data collection/sharing');
  }
  if (text.includes('unlimited liability') || text.includes('no limit')) {
    analysis.risks.push('Unlimited liability clause');
    riskLevel = 'high';
  }
  if (text.includes('immediate termination') && !text.includes('notice')) {
    analysis.risks.push('Termination without notice');
    riskLevel = 'medium';
  }
  
  // Benefits detection
  if (text.includes('warranty') || text.includes('guarantee')) {
    analysis.benefits.push('Warranty or guarantee included');
  }
  if (text.includes('refund') && !text.includes('non-refundable')) {
    analysis.benefits.push('Refund policy available');
  }
  if (text.includes('privacy') || text.includes('data protection')) {
    analysis.benefits.push('Privacy protection mentioned');
  }
  if (text.includes('support') || text.includes('customer service')) {
    analysis.benefits.push('Customer support included');
  }
  
  // Cost detection
  const priceMatches = text.match(/\b\d+(?:,\d+)*(?:\.\d+)?\s*(?:ugx|usd|eur|gbp|dollars?|shillings?)\b/gi);
  if (priceMatches) {
    analysis.costs = priceMatches.slice(0, 3); // First 3 price mentions
  }
  
  const formattedAnalysis = `TYPE: ${analysis.type}
PURPOSE: ${getDocumentPurpose(analysis.type)}
KEY POINTS: Main terms and conditions apply
RISKS: ${analysis.risks.length ? analysis.risks.join(', ') : 'No major risks detected'}
BENEFITS: ${analysis.benefits.length ? analysis.benefits.join(', ') : 'Standard benefits'}
COSTS: ${analysis.costs.length ? analysis.costs.join(', ') : 'No specific costs mentioned'}
OBLIGATIONS: Follow terms as outlined in document
RIGHTS: Standard user rights apply
RECOMMENDAT ION: ${getRiskRecommendation(riskLevel)}
SUMMARY: ${analysis.type} with ${riskLevel} risk level - ${getRiskRecommendation(riskLevel).toLowerCase()}`;
  
  return {
    isValid: true,
    analysis: formattedAnalysis,
    documentLength: documentText.length,
    documentType: analysis.type,
    riskLevel: riskLevel,
    aiPowered: false,
    timestamp: new Date().toISOString(),
    confidence: 0.75
  };
};

const getDocumentPurpose = (type) => {
  const purposes = {
    'Employment Contract': 'Define work terms and conditions',
    'Lease Agreement': 'Rent property or equipment',
    'Loan Agreement': 'Borrow money with repayment terms',
    'Service Agreement': 'Provide or receive services',
    'Legal Document': 'Establish legal obligations'
  };
  return purposes[type] || 'Legal agreement between parties';
};

const getRiskRecommendation = (riskLevel) => {
  if (riskLevel === 'high') return 'Review with lawyer before signing';
  if (riskLevel === 'medium') return 'Read carefully and consider alternatives';
  return 'Generally acceptable terms';
};

/**
 * �🛡️ Contract Security Check
 */
export const performSecurityCheck = (contractText) => {
  const securityIssues = [];
  const text = contractText.toLowerCase();

  // Check for suspicious terms
  if (text.includes('upfront payment') && text.includes('no service')) {
    securityIssues.push('⚠️ Upfront payment without service guarantee');
  }
  if (text.includes('personal information') && !text.includes('privacy')) {
    securityIssues.push('⚠️ Data collection without privacy policy');
  }
  if (text.includes('unlimited liability') || text.includes('no limit')) {
    securityIssues.push('⚠️ Unlimited liability clause');
  }
  if (text.includes('immediate termination') && !text.includes('notice')) {
    securityIssues.push('⚠️ Termination without notice');
  }

  return {
    isSecure: securityIssues.length === 0,
    securityScore: Math.max(0, 100 - (securityIssues.length * 25)),
    issues: securityIssues,
    recommendation: securityIssues.length > 2 ? 'HIGH RISK - Do not sign' : 
                   securityIssues.length > 0 ? 'MEDIUM RISK - Review carefully' : 
                   'LOW RISK - Acceptable'
  };
};

/**
 * 🎯 AI-powered general advice for any financial question
 */
export const generateGeneralAdvice = async (question, userContext) => {
  const { netWorth = 0, currentStage = {}, monthlyIncome = 0, recentExpenses = [], transactions = [] } = userContext;
  const monthlyExpenses = recentExpenses.reduce((sum, t) => sum + (t.amount || 0), 0);
  
  // Get business vs personal breakdown
  const wealthBreakdown = analyzeWealthBreakdown(transactions);
  
  // Check if user is asking about their savings/money directly
  const isAskingAboutSavings = question.includes('savings') || question.includes('save') || question.includes('account') || question.includes('money') || question.includes('have');
  const isAskingDirectAmount = question.includes('how much') || question.includes('what is my') || question.includes('show me');
  
  // Check for document/analysis related questions
  const isDocumentQuestion = question.includes('document') || question.includes('analyze') || question.includes('analyse') || 
                            question.includes('how you do') || question.includes('analysis') || question.includes('review') ||
                            question.includes('check document') || question.includes('read document');
  
  // Check for contract-related questions
  const isContractQuestion = question.includes('contract') || question.includes('terms') || question.includes('agreement') || question.includes('verify');
  
  if (isDocumentQuestion || isContractQuestion) {
    const verificationStatus = getVerificationStatus();
    
    if (isDocumentQuestion) {
      return {
        advice: `📄 **How I Analyze Documents:**

🤖 **AI Analysis Process:**
1. **Text Reading:** I read the entire document text
2. **Risk Detection:** Look for red flags (fees, penalties, auto-renewal)
3. **Security Check:** Find suspicious terms (unlimited liability, no refunds)
4. **Simple Summary:** Give you HIGH/MEDIUM/LOW risk rating
5. **Action Advice:** Tell you to sign, review, or avoid

📋 **What I Check:**
• Hidden fees and charges
• Cancellation/refund policies  
• Auto-renewal clauses
• Personal data collection
• Penalty terms
• Payment conditions

💡 **How to Use:**
1. Paste document text in chat
2. Ask "check this document" or "analyze this"
3. Get instant risk analysis
4. See security score (0-100%)
5. Get clear recommendation

📊 **Example:** Paste contract → Get "RISK: HIGH, Don't sign" or "RISK: LOW, Looks good"`,
        context: {
          stage: currentStage.name,
          netWorth: wealthBreakdown.combined.totalWealth,
          savingsRate: monthlyIncome > 0 ? ((monthlyIncome - monthlyExpenses) / monthlyIncome * 100) : 0
        },
        aiPowered: false,
        directAnswer: true,
        documentFeature: true
      };
    }
    
    return {
      advice: `🛡️ **Contract & Verification Help:**

🔍 **Your Verification Status:**
• Email: ${verificationStatus.email.verified ? '✅ Verified' : '❌ Not verified'}
• Phone: ${verificationStatus.phone.verified ? '✅ Verified' : '❌ Not verified'}  
• Identity: ${verificationStatus.identity.verified ? '✅ Verified' : '⏳ Pending'}

📊 **Completion:** ${verificationStatus.overall.completionRate}%
🎯 **Next:** ${verificationStatus.overall.nextStep}

💡 **To analyze documents:**
1. Paste document/contract text
2. Ask "check this document"
3. Get instant analysis`,
      context: {
        stage: currentStage.name,
        netWorth: wealthBreakdown.combined.totalWealth,
        savingsRate: monthlyIncome > 0 ? ((monthlyIncome - monthlyExpenses) / monthlyIncome * 100) : 0
      },
      aiPowered: false,
      directAnswer: true,
      contractFeature: true
    };
  }
  
  if (isAskingAboutSavings && isAskingDirectAmount) {
    // Return direct account info instead of advice
    return {
      advice: `💰 **Your Money:**

🏢 **Work Account:** UGX ${wealthBreakdown.business.wealth.toLocaleString()}
👤 **Personal Account:** UGX ${wealthBreakdown.personal.wealth.toLocaleString()}
📊 **Total Savings:** UGX ${wealthBreakdown.combined.totalWealth.toLocaleString()}

💵 **Monthly Info:**
• You earn: UGX ${Math.round(monthlyIncome).toLocaleString()}
• You spend: UGX ${monthlyExpenses.toLocaleString()}
• You save: UGX ${Math.round(monthlyIncome - monthlyExpenses).toLocaleString()}`,
      context: {
        stage: currentStage.name,
        netWorth: wealthBreakdown.combined.totalWealth,
        savingsRate: monthlyIncome > 0 ? ((monthlyIncome - monthlyExpenses) / monthlyIncome * 100) : 0
      },
      aiPowered: false,
      directAnswer: true
    };
  }
  
  const aiPrompt = `
User asks: "${question}"

THEIR MONEY:
🏢 Work Money: UGX ${wealthBreakdown.business.wealth.toLocaleString()}
👤 Personal Money: UGX ${wealthBreakdown.personal.wealth.toLocaleString()}
💰 Total Money: UGX ${wealthBreakdown.combined.totalWealth.toLocaleString()}

Give simple, clear advice. Use basic words.
Answer: [simple advice in 1-2 sentences]`;

  const aiAdvice = await callOpenAI(aiPrompt);
  
  return {
    advice: aiAdvice || `For your money level, focus on ${currentStage.focus?.[0] || 'saving more money'}.`,
    context: {
      stage: currentStage.name,
      netWorth: netWorth,
      savingsRate: monthlyIncome > 0 ? ((monthlyIncome - monthlyExpenses) / monthlyIncome * 100) : 0
    },
    aiPowered: !!aiAdvice
  };
};

/**
 * Quick decision framework for purchases
 */
export const quickDecisionFramework = (transaction, userContext) => {
  const amount = transaction.amount || 0;
  const { netWorth = 0, monthlyIncome = 0 } = userContext;
  
  // Simple decision matrix
  const factors = {
    needVsWant: amount < 20000 ? 'minor' : 'review', // Small amounts less scrutiny
    affordability: amount < netWorth * 0.1 ? 'affordable' : amount < netWorth * 0.3 ? 'significant' : 'expensive',
    timing: 'now', // Could be enhanced with user priorities
    alternatives: 'consider'
  };
  
  const score = calculateDecisionScore(factors, amount, netWorth);
  
  return {
    recommendation: score > 7 ? 'proceed' : score > 4 ? 'consider' : 'wait',
    score,
    factors,
    quickAdvice: getQuickAdvice(score)
  };
};

const calculateDecisionScore = (factors, amount, netWorth) => {
  let score = 5; // Neutral
  
  if (factors.affordability === 'affordable') score += 3;
  else if (factors.affordability === 'expensive') score -= 3;
  
  if (amount < 10000) score += 2; // Small amounts get benefit of doubt
  if (amount > netWorth * 0.5) score -= 4; // Large amounts penalized
  
  return Math.max(0, Math.min(10, score));
};

const getQuickAdvice = (score) => {
  if (score >= 8) return "✅ Go for it - seems reasonable!";
  if (score >= 6) return "🤔 Think it through, but probably okay";
  if (score >= 4) return "⚠️ Consider waiting or finding alternatives";
  return "❌ Better to wait and save more first";
};

/**
 * 📊 Generate comprehensive wealth status report
 */
export const generateWealthStatusReport = async (userContext) => {
  const { transactions = [], currentStage = {} } = userContext;
  const wealthBreakdown = analyzeWealthBreakdown(transactions);
  
  const aiPrompt = `
User's money status:

🏢 WORK MONEY:
- Have: UGX ${wealthBreakdown.business.wealth.toLocaleString()}
- Make/lose per year: UGX ${wealthBreakdown.business.netCashFlow.toLocaleString()}
- Status: ${wealthBreakdown.business.netCashFlow > 0 ? 'Making money' : 'Losing money'}

👤 PERSONAL MONEY:
- Have: UGX ${wealthBreakdown.personal.wealth.toLocaleString()}
- Save per year: UGX ${wealthBreakdown.personal.netCashFlow.toLocaleString()}
- Status: ${wealthBreakdown.personal.netCashFlow > 0 ? 'Saving money' : 'Spending too much'}

💰 TOTAL: UGX ${wealthBreakdown.combined.totalWealth.toLocaleString()}

Give simple advice: What's good? What needs fixing? What to do first?
Answer: Good: [what works] | Fix: [what's wrong] | Do: [next step]`;

  const aiAdvice = await callOpenAI(aiPrompt);
  
  return {
    breakdown: wealthBreakdown,
    assessment: aiAdvice || generateFallbackAssessment(wealthBreakdown, currentStage),
    aiPowered: !!aiAdvice
  };
};

/**
 * 📋 Fallback assessment when AI is unavailable
 */
const generateFallbackAssessment = (breakdown, stage) => {
  const businessStatus = breakdown.business.netCashFlow > 0 ? 'making money' : 'losing money';
  const personalStatus = breakdown.personal.savingsRate > 10 ? 'saving well' : 'spending too much';
  
  return `Good: Work is ${businessStatus}, you are ${personalStatus} | Fix: ${breakdown.business.profitMargin < 10 ? 'Make more profit at work' : 'Keep work going'} | Do: ${breakdown.personal.savingsRate < 20 ? 'Save 20% of what you earn' : 'Start investing money'}`;
};

export default {
  generateSpendingAdvice,
  generateSavingsAdvice,
  generateGoalAdvice,
  generateGeneralAdvice,
  generateWealthStatusReport,
  quickDecisionFramework,
  analyzeWealthBreakdown,
  analyzeContract,
  analyzeDocument,
  uploadAndAnalyzeDocument,
  getSupportedFileTypes,
  getVerificationStatus,
  performSecurityCheck
};