// Contract Vetting API Route - Pillar II: Treasury Guardian
import express from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';

const router = express.Router();

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

router.post('/', async (req, res) => {
  try {
    // Validate biometric authentication
    if (!req.user.biometricVerified) {
      return res.status(403).json({
        success: false,
        error: {
          message: 'Biometric authentication required for contract analysis',
          code: 'BIOMETRIC_REQUIRED'
        }
      });
    }

    const { contractText, metadata = {} } = req.body;

    // Validate input
    if (!contractText || typeof contractText !== 'string' || contractText.trim().length < 50) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Contract text must be at least 50 characters long',
          code: 'INVALID_CONTRACT_TEXT'
        }
      });
    }

    // Security audit log
    const auditLog = {
      userId: req.user.id,
      action: 'CONTRACT_ANALYSIS_REQUEST',
      timestamp: new Date().toISOString(),
      contractLength: contractText.length,
      biometricVerified: true,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    };

    console.log('[SECURITY AUDIT]', auditLog);

    // Prepare analysis prompt
    const analysisPrompt = buildContractAnalysisPrompt(contractText, metadata);

    // Get Gemini AI analysis
    const model = genAI.getGenerativeModel({ model: "gemini-pro" });
    
    const result = await model.generateContent({
      contents: [{ parts: [{ text: analysisPrompt }] }],
      generationConfig: {
        temperature: 0.1,
        topK: 40,
        topP: 0.95,
        maxOutputTokens: 2048,
      }
    });

    const analysisText = result.response.text();

    // Parse and structure the analysis
    const analysis = parseContractAnalysis(analysisText, contractText);

    // Perform additional security checks
    const securityFlags = performSecurityScan(contractText);

    // Calculate final safety score
    const finalSafetyScore = calculateSafetyScore(analysis, securityFlags);

    // Prepare response
    const response = {
      success: true,
      analysis: {
        safetyScore: finalSafetyScore,
        riskLevel: determineRiskLevel(finalSafetyScore),
        liabilityFlags: [...analysis.liabilityFlags, ...securityFlags],
        recommendations: analysis.recommendations,
        legalInsights: analysis.legalInsights,
        crossReferences: await performLegalCrossReference(contractText),
        contractHash: generateContractHash(contractText),
        analysisId: generateAnalysisId(),
        timestamp: new Date().toISOString(),
        biometricVerification: {
          verified: true,
          timestamp: req.user.biometricData.timestamp,
          confidence: req.user.biometricData.confidence
        }
      },
      metadata: {
        processingTime: Date.now() - new Date(auditLog.timestamp).getTime(),
        aiModel: 'gemini-pro',
        version: '1.0.0'
      }
    };

    res.json(response);

  } catch (error) {
    console.error('Contract vetting error:', error);
    
    res.status(500).json({
      success: false,
      error: {
        message: 'Contract analysis failed',
        code: 'ANALYSIS_ERROR',
        timestamp: new Date().toISOString()
      }
    });
  }
});

// Build comprehensive contract analysis prompt
function buildContractAnalysisPrompt(contractText, metadata) {
  return `
CONFIDENTIAL LEGAL CONTRACT RISK ANALYSIS

SECURITY CLEARANCE: HIGH
ANALYSIS TYPE: Financial Risk Assessment
CLIENT PROTECTION LEVEL: Maximum

CONTRACT FOR ANALYSIS:
${contractText}

METADATA:
- Contract Type: ${metadata.type || 'General Agreement'}
- Industry: ${metadata.industry || 'Not Specified'}
- Jurisdiction: ${metadata.jurisdiction || 'Not Specified'}
- Value: ${metadata.value || 'Not Specified'}

REQUIRED ANALYSIS FRAMEWORK:

1. FINANCIAL SAFETY SCORE (0-10 Scale):
   - Payment terms and security
   - Liability caps and limitations
   - Penalty and termination costs
   - Financial guarantee requirements
   - Currency and inflation risks

2. CRITICAL LIABILITY FLAGS:
   - Unlimited liability exposure
   - Broad indemnification clauses
   - IP ownership transfers
   - Automatic renewal terms
   - Penalty and liquidated damages
   - Regulatory compliance requirements

3. LEGAL RISK FACTORS:
   - Governing law and jurisdiction
   - Dispute resolution mechanisms
   - Force majeure provisions
   - Confidentiality and non-disclosure
   - Termination and exit clauses

4. PROTECTION GAPS:
   - Missing liability caps
   - Absent force majeure clauses
   - Inadequate termination rights
   - Weak dispute resolution
   - Insufficient IP protection

5. NEGOTIATION PRIORITIES:
   - Must-change clauses (deal breakers)
   - Should-change clauses (risk reducers)
   - Nice-to-change clauses (optimizations)

6. IMPLEMENTATION REQUIREMENTS:
   - Compliance obligations
   - Performance guarantees
   - Reporting requirements
   - Insurance needs

Please provide structured analysis with:
- Specific clause references
- Quantified risk levels
- Concrete recommendations
- Implementation timeline
- Cost implications

Focus on protecting the signing party's financial interests and minimizing legal exposure.
`;
}

// Parse Gemini AI analysis response
function parseContractAnalysis(analysisText, originalContract) {
  // Extract financial safety score
  const safetyScoreMatch = analysisText.match(/(?:safety|financial)[\s\w]*score[\s:]*(\d+(?:\.\d+)?)/i);
  const safetyScore = safetyScoreMatch ? parseFloat(safetyScoreMatch[1]) : 5.0;

  // Extract liability flags
  const liabilityFlags = extractFlags(analysisText, [
    'unlimited liability', 'indemnification', 'penalty', 'liquidated damages',
    'automatic renewal', 'IP transfer', 'broad scope', 'termination costs'
  ]);

  // Extract recommendations
  const recommendations = extractRecommendations(analysisText);

  // Extract legal insights
  const legalInsights = extractInsights(analysisText);

  return {
    safetyScore: Math.max(0, Math.min(10, safetyScore)),
    liabilityFlags,
    recommendations,
    legalInsights,
    analysisConfidence: calculateAnalysisConfidence(analysisText, originalContract)
  };
}

// Extract liability flags from analysis
function extractFlags(analysisText, flagKeywords) {
  const flags = [];
  const lines = analysisText.toLowerCase().split('\n');

  flagKeywords.forEach(keyword => {
    const relevantLines = lines.filter(line => line.includes(keyword));
    relevantLines.forEach(line => {
      if (line.length > 10 && line.length < 200) {
        flags.push({
          flag: keyword.toUpperCase().replace(/\s+/g, '_'),
          description: line.trim(),
          severity: determineFlagSeverity(keyword, line)
        });
      }
    });
  });

  return flags.slice(0, 8); // Limit to most important flags
}

// Extract actionable recommendations
function extractRecommendations(analysisText) {
  const recommendations = [];
  const sections = analysisText.split(/\d+\.\s*/);

  sections.forEach(section => {
    if (section.toLowerCase().includes('recommend') || 
        section.toLowerCase().includes('should') ||
        section.toLowerCase().includes('negotiate')) {
      
      const lines = section.split('\n').filter(line => 
        line.trim().length > 20 && line.trim().length < 300
      );

      lines.forEach(line => {
        if (recommendations.length < 6) {
          recommendations.push({
            type: categorizeRecommendation(line),
            description: line.trim(),
            priority: determinePriority(line)
          });
        }
      });
    }
  });

  return recommendations;
}

// Extract legal insights
function extractInsights(analysisText) {
  return {
    governingLaw: extractPattern(analysisText, /governing\s+law[:\s]*([^.\n]+)/i),
    jurisdiction: extractPattern(analysisText, /jurisdiction[:\s]*([^.\n]+)/i),
    disputeResolution: extractPattern(analysisText, /dispute[:\s]*([^.\n]+)/i),
    terminationRights: extractPattern(analysisText, /termination[:\s]*([^.\n]+)/i),
    keyRisks: extractKeyRisks(analysisText)
  };
}

// Utility functions
function extractPattern(text, pattern) {
  const match = text.match(pattern);
  return match ? match[1].trim() : null;
}

function extractKeyRisks(text) {
  const riskKeywords = ['risk', 'liability', 'exposure', 'penalty', 'obligation'];
  const risks = [];
  
  riskKeywords.forEach(keyword => {
    const regex = new RegExp(`([^.]*${keyword}[^.]*\.)`, 'gi');
    const matches = text.match(regex);
    if (matches) {
      risks.push(...matches.slice(0, 2)); // Max 2 per keyword
    }
  });

  return risks.slice(0, 5);
}

function determineFlagSeverity(keyword, context) {
  const highSeverityKeywords = ['unlimited liability', 'broad scope', 'liquidated damages'];
  const mediumSeverityKeywords = ['indemnification', 'automatic renewal', 'penalty'];
  
  if (highSeverityKeywords.includes(keyword)) return 'HIGH';
  if (mediumSeverityKeywords.includes(keyword)) return 'MEDIUM';
  return 'LOW';
}

function categorizeRecommendation(recommendation) {
  const text = recommendation.toLowerCase();
  if (text.includes('negotiate') || text.includes('change')) return 'NEGOTIATION';
  if (text.includes('add') || text.includes('include')) return 'ADDITION';
  if (text.includes('remove') || text.includes('delete')) return 'REMOVAL';
  if (text.includes('clarify') || text.includes('define')) return 'CLARIFICATION';
  return 'GENERAL';
}

function determinePriority(recommendation) {
  const text = recommendation.toLowerCase();
  if (text.includes('critical') || text.includes('must') || text.includes('essential')) return 'HIGH';
  if (text.includes('should') || text.includes('important')) return 'MEDIUM';
  return 'LOW';
}

function calculateAnalysisConfidence(analysisText, originalContract) {
  let confidence = 70; // Base confidence
  
  // Increase confidence based on analysis depth
  if (analysisText.length > 1000) confidence += 10;
  if (analysisText.includes('clause') && analysisText.includes('section')) confidence += 10;
  if (originalContract.length > 1000) confidence += 5;
  
  // Decrease confidence for very short contracts or analysis
  if (originalContract.length < 500) confidence -= 15;
  if (analysisText.length < 500) confidence -= 20;
  
  return Math.max(30, Math.min(95, confidence));
}

// Perform additional security scanning
function performSecurityScan(contractText) {
  const securityFlags = [];
  const text = contractText.toLowerCase();

  // Security pattern detection
  const securityPatterns = [
    { pattern: /unlimited\s+liability/i, flag: 'UNLIMITED_LIABILITY', severity: 'CRITICAL' },
    { pattern: /liquidated\s+damages/i, flag: 'LIQUIDATED_DAMAGES', severity: 'HIGH' },
    { pattern: /non-compete/i, flag: 'NON_COMPETE_CLAUSE', severity: 'MEDIUM' },
    { pattern: /intellectual\s+property\s+assignment/i, flag: 'IP_ASSIGNMENT', severity: 'MEDIUM' },
    { pattern: /automatic\s+renewal/i, flag: 'AUTO_RENEWAL', severity: 'MEDIUM' },
    { pattern: /sole\s+discretion/i, flag: 'DISCRETIONARY_POWER', severity: 'MEDIUM' }
  ];

  securityPatterns.forEach(({ pattern, flag, severity }) => {
    if (pattern.test(contractText)) {
      securityFlags.push({
        flag,
        description: `Contract contains ${flag.replace('_', ' ').toLowerCase()} clause`,
        severity,
        source: 'AUTOMATED_SECURITY_SCAN'
      });
    }
  });

  return securityFlags;
}

// Calculate final safety score
function calculateSafetyScore(analysis, securityFlags) {
  let score = analysis.safetyScore;

  // Adjust based on security flags
  securityFlags.forEach(flag => {
    switch (flag.severity) {
      case 'CRITICAL': score -= 2.0; break;
      case 'HIGH': score -= 1.0; break;
      case 'MEDIUM': score -= 0.5; break;
      default: score -= 0.2;
    }
  });

  // Adjust based on analysis confidence
  const confidenceAdjustment = (analysis.analysisConfidence - 70) / 100;
  score += confidenceAdjustment;

  return Math.max(0, Math.min(10, parseFloat(score.toFixed(1))));
}

// Determine risk level
function determineRiskLevel(safetyScore) {
  if (safetyScore >= 8.0) return 'LOW';
  if (safetyScore >= 6.0) return 'MEDIUM';
  if (safetyScore >= 4.0) return 'HIGH';
  return 'CRITICAL';
}

// Perform legal cross-reference (simulated)
async function performLegalCrossReference(contractText) {
  // In production, this would query legal databases
  // For demo, return structured mock data
  return {
    relevantLaws: [
      'Contract Act (Local Jurisdiction)',
      'Consumer Protection Laws',
      'Commercial Arbitration Rules'
    ],
    precedentCases: [
      'Similar contract dispute case #1',
      'Relevant liability limitation case #2'
    ],
    complianceRequirements: [
      'Local business registration required',
      'Tax implications for contract value',
      'Industry-specific regulations may apply'
    ],
    crossReferenceConfidence: 75
  };
}

// Generate contract hash
function generateContractHash(contractText) {
  // Simple hash for demo - in production use cryptographic hash
  let hash = 0;
  for (let i = 0; i < contractText.length; i++) {
    const char = contractText.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16);
}

// Generate unique analysis ID
function generateAnalysisId() {
  return 'ca_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

export default router;