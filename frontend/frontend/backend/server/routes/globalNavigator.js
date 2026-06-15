// Global Navigator API Route - Pillar III: Regulatory Compliance
import express from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';

const router = express.Router();

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

router.post('/', async (req, res) => {
  try {
    const { country, mode, sector = 'general', currentStatus = {} } = req.body;

    // Validate input
    if (!country || !mode) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Country and mode are required fields',
          code: 'MISSING_REQUIRED_FIELDS'
        }
      });
    }

    if (!['SE', 'BO'].includes(mode)) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Mode must be either "SE" (Salaried Employee) or "BO" (Business Owner)',
          code: 'INVALID_MODE'
        }
      });
    }

    // Security audit log
    const auditLog = {
      userId: req.user.id,
      action: 'REGULATORY_ANALYSIS_REQUEST',
      timestamp: new Date().toISOString(),
      country,
      mode,
      sector,
      ipAddress: req.ip
    };

    console.log('[COMPLIANCE AUDIT]', auditLog);

    // Build analysis prompt
    const analysisPrompt = buildRegulatoryAnalysisPrompt(country, mode, sector, currentStatus);

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
    const analysis = parseRegulatoryAnalysis(analysisText, country, mode, sector);

    // Perform compliance gap analysis
    const gapAnalysis = performComplianceGapAnalysis(analysis.requirements, currentStatus);

    // Generate prioritized action plan
    const actionPlan = generateComplianceActionPlan(gapAnalysis, mode);

    // Calculate compliance percentage
    const compliancePercentage = calculateCompliancePercentage(gapAnalysis);

    // Prepare response
    const response = {
      success: true,
      analysis: {
        country,
        mode,
        sector,
        compliancePercentage,
        requirements: analysis.requirements,
        gapAnalysis,
        actionPlan,
        riskAssessment: analysis.riskAssessment,
        timeline: analysis.timeline,
        costs: analysis.costs,
        resources: analysis.resources,
        analysisId: generateAnalysisId(),
        timestamp: new Date().toISOString(),
        validUntil: calculateValidityDate(),
        confidence: analysis.confidence
      },
      metadata: {
        processingTime: Date.now() - new Date(auditLog.timestamp).getTime(),
        aiModel: 'gemini-pro',
        version: '1.0.0',
        dataSource: 'ai_analysis_with_grounding'
      }
    };

    res.json(response);

  } catch (error) {
    console.error('Regulatory analysis error:', error);
    
    res.status(500).json({
      success: false,
      error: {
        message: 'Regulatory analysis failed',
        code: 'ANALYSIS_ERROR',
        timestamp: new Date().toISOString()
      }
    });
  }
});

// Build comprehensive regulatory analysis prompt
function buildRegulatoryAnalysisPrompt(country, mode, sector, currentStatus) {
  const modeDescription = mode === 'SE' ? 
    'Salaried Employee seeking career advancement and corporate opportunities' :
    'Business Owner seeking government contracts, tenders, and business expansion';

  return `
REGULATORY COMPLIANCE ANALYSIS - ${country.toUpperCase()}

ANALYSIS DATE: ${new Date().toLocaleDateString()}
TARGET PROFILE: ${mode} (${modeDescription})
SECTOR: ${sector}
OBJECTIVE: Global Opportunity Readiness Assessment

Please provide a comprehensive regulatory compliance analysis for someone operating in ${country} with the following profile:

CURRENT STATUS SUMMARY:
${JSON.stringify(currentStatus, null, 2)}

REQUIRED ANALYSIS COMPONENTS:

1. MANDATORY REGULATORY REQUIREMENTS:
   List ALL current mandatory requirements for ${mode === 'SE' ? 'employment eligibility and career advancement' : 'business operation and government contract eligibility'} including:
   - Business registration and licensing requirements
   - Tax registration and compliance (TIN, VAT, etc.)
   - Professional certifications and qualifications
   - Industry-specific permits and approvals
   - Banking and financial compliance requirements

2. DOCUMENTATION REQUIREMENTS:
   Specify exact documents needed:
   - Identity and address verification documents
   - Tax clearance certificates and validity periods
   - Business registration certificates (if applicable)
   - Professional qualification certificates
   - Insurance and bonding requirements

3. COMPLIANCE TIMELINE:
   For each requirement, provide:
   - Application processing time
   - Renewal periods and deadlines
   - Critical dates and deadlines for ${new Date().getFullYear()}
   - Seasonal or periodic requirements

4. COSTS AND FEES:
   Estimate costs for:
   - Initial application fees
   - Annual renewal fees
   - Professional service costs
   - Penalty costs for late compliance

5. RISK ASSESSMENT:
   Identify risks of non-compliance:
   - Legal penalties and fines
   - Business operation restrictions
   - Opportunity exclusions (government contracts, employment)
   - Reputation and credibility impacts

6. GOVERNMENT TENDER ELIGIBILITY (for BO mode):
   ${mode === 'BO' ? 'Specific requirements for government contract participation including PPDA registration, tax clearance, performance bonds, and technical qualifications.' : 'Employment compliance requirements for corporate and government positions.'}

7. RESOURCES AND CONTACTS:
   Provide specific:
   - Government office locations and contact information
   - Online portals and application systems
   - Required forms and application procedures
   - Professional service providers (lawyers, accountants)

Please ensure all information is current for ${new Date().getFullYear()} and specific to ${country}. Focus on actionable, specific requirements that enable participation in major economic opportunities.
`;
}

// Parse Gemini AI regulatory analysis
function parseRegulatoryAnalysis(analysisText, country, mode, sector) {
  // Extract requirements by category
  const requirements = extractRequirements(analysisText);
  
  // Extract risk assessment
  const riskAssessment = extractRiskAssessment(analysisText);
  
  // Extract timeline information
  const timeline = extractTimeline(analysisText);
  
  // Extract cost information
  const costs = extractCosts(analysisText);
  
  // Extract resources and contacts
  const resources = extractResources(analysisText);
  
  // Calculate confidence based on analysis depth
  const confidence = calculateAnalysisConfidence(analysisText, country);

  return {
    requirements,
    riskAssessment,
    timeline,
    costs,
    resources,
    confidence
  };
}

// Extract requirements from analysis
function extractRequirements(analysisText) {
  const requirements = {
    mandatory: [],
    recommended: [],
    conditional: []
  };

  // Split analysis into sections
  const sections = analysisText.split(/\d+\.\s*/);
  
  sections.forEach(section => {
    // Look for requirement indicators
    const lines = section.split('\n').filter(line => line.trim().length > 10);
    
    lines.forEach(line => {
      if (isRequirement(line)) {
        const requirement = parseRequirement(line);
        
        if (requirement) {
          const category = categorizeRequirement(line);
          requirements[category].push(requirement);
        }
      }
    });
  });

  return requirements;
}

// Check if line describes a requirement
function isRequirement(line) {
  const requirementIndicators = [
    'required', 'must', 'mandatory', 'compulsory', 'obligatory',
    'register', 'obtain', 'apply', 'file', 'submit', 'renew',
    'certificate', 'license', 'permit', 'clearance', 'registration'
  ];
  
  return requirementIndicators.some(indicator => 
    line.toLowerCase().includes(indicator)
  );
}

// Parse individual requirement
function parseRequirement(line) {
  // Extract key information from requirement line
  const cleaned = line.trim().replace(/^[-•*]\s*/, '');
  
  if (cleaned.length < 10) return null;

  return {
    description: cleaned,
    priority: determinePriority(cleaned),
    category: determineCategory(cleaned),
    estimatedTime: estimateProcessingTime(cleaned),
    estimatedCost: estimateCost(cleaned),
    authority: extractAuthority(cleaned),
    renewalPeriod: extractRenewalPeriod(cleaned)
  };
}

// Categorize requirement
function categorizeRequirement(line) {
  const text = line.toLowerCase();
  
  if (text.includes('must') || text.includes('mandatory') || text.includes('required')) {
    return 'mandatory';
  }
  if (text.includes('should') || text.includes('recommended') || text.includes('advisable')) {
    return 'recommended';
  }
  if (text.includes('if') || text.includes('depending') || text.includes('may need')) {
    return 'conditional';
  }
  
  return 'mandatory'; // Default to mandatory for safety
}

// Determine requirement priority
function determinePriority(requirement) {
  const text = requirement.toLowerCase();
  
  // Critical priority indicators
  if (text.includes('tax') || text.includes('license') || text.includes('registration')) {
    return 'CRITICAL';
  }
  
  // High priority indicators
  if (text.includes('clearance') || text.includes('certificate') || text.includes('permit')) {
    return 'HIGH';
  }
  
  // Medium priority indicators
  if (text.includes('insurance') || text.includes('bond') || text.includes('qualification')) {
    return 'MEDIUM';
  }
  
  return 'LOW';
}

// Determine requirement category
function determineCategory(requirement) {
  const text = requirement.toLowerCase();
  
  if (text.includes('tax') || text.includes('revenue')) return 'TAX_COMPLIANCE';
  if (text.includes('license') || text.includes('permit')) return 'LICENSING';
  if (text.includes('register') || text.includes('incorporation')) return 'BUSINESS_REGISTRATION';
  if (text.includes('certificate') || text.includes('qualification')) return 'CERTIFICATION';
  if (text.includes('insurance') || text.includes('bond')) return 'FINANCIAL_SECURITY';
  if (text.includes('document') || text.includes('identity')) return 'DOCUMENTATION';
  
  return 'OTHER';
}

// Estimate processing time
function estimateProcessingTime(requirement) {
  const text = requirement.toLowerCase();
  
  if (text.includes('clearance') || text.includes('audit')) return '2-4 weeks';
  if (text.includes('license') || text.includes('registration')) return '1-3 weeks';
  if (text.includes('certificate')) return '1-2 weeks';
  if (text.includes('document') || text.includes('form')) return '1-5 days';
  
  return '1-2 weeks';
}

// Estimate cost
function estimateCost(requirement) {
  const text = requirement.toLowerCase();
  
  if (text.includes('clearance')) return 'UGX 50,000 - 150,000';
  if (text.includes('license')) return 'UGX 100,000 - 500,000';
  if (text.includes('registration')) return 'UGX 200,000 - 800,000';
  if (text.includes('certificate')) return 'UGX 25,000 - 100,000';
  if (text.includes('insurance')) return 'UGX 300,000 - 2,000,000/year';
  
  return 'Contact authority for current fees';
}

// Extract authority information
function extractAuthority(requirement) {
  const text = requirement.toLowerCase();
  
  if (text.includes('ura') || text.includes('tax')) return 'Uganda Revenue Authority (URA)';
  if (text.includes('ursb')) return 'Uganda Registration Services Bureau (URSB)';
  if (text.includes('local council')) return 'Local Council Offices';
  if (text.includes('ministry')) return 'Relevant Government Ministry';
  if (text.includes('nira')) return 'National ID Registration Authority';
  
  return 'Relevant Government Authority';
}

// Extract renewal period
function extractRenewalPeriod(requirement) {
  const text = requirement.toLowerCase();
  
  if (text.includes('annual')) return 'Annual';
  if (text.includes('monthly')) return 'Monthly';
  if (text.includes('quarterly')) return 'Quarterly';
  if (text.includes('biennial')) return 'Every 2 years';
  
  return 'Check with authority';
}

// Extract risk assessment
function extractRiskAssessment(analysisText) {
  const risks = [];
  const riskKeywords = ['penalty', 'fine', 'restriction', 'exclusion', 'prosecution'];
  
  const lines = analysisText.split('\n');
  lines.forEach(line => {
    if (riskKeywords.some(keyword => line.toLowerCase().includes(keyword))) {
      risks.push({
        risk: line.trim(),
        severity: determineSeverity(line),
        impact: determineImpact(line)
      });
    }
  });

  return {
    complianceRisks: risks.slice(0, 5),
    overallRiskLevel: calculateOverallRisk(risks)
  };
}

// Extract timeline information
function extractTimeline(analysisText) {
  return {
    immediate: extractTimelineItems(analysisText, ['immediate', 'urgent', 'asap']),
    short_term: extractTimelineItems(analysisText, ['1-4 weeks', 'month', 'short term']),
    medium_term: extractTimelineItems(analysisText, ['2-3 months', 'quarter', 'medium term']),
    long_term: extractTimelineItems(analysisText, ['6+ months', 'annual', 'long term'])
  };
}

// Extract costs information
function extractCosts(analysisText) {
  const costPattern = /UGX\s*[\d,]+(?:\s*-\s*[\d,]+)?/gi;
  const costs = analysisText.match(costPattern) || [];
  
  return {
    estimatedTotal: calculateEstimatedTotal(costs),
    breakdown: costs.slice(0, 10),
    currency: 'UGX',
    note: 'Costs are estimates and may vary'
  };
}

// Extract resources information
function extractResources(analysisText) {
  return {
    governmentPortals: extractPortals(analysisText),
    physicalOffices: extractOffices(analysisText),
    contactNumbers: extractContacts(analysisText),
    onlineServices: extractOnlineServices(analysisText),
    professionalServices: extractProfessionalServices(analysisText)
  };
}

// Utility functions for extraction
function extractTimelineItems(text, keywords) {
  const items = [];
  keywords.forEach(keyword => {
    const regex = new RegExp(`([^.]*${keyword}[^.]*\.)`, 'gi');
    const matches = text.match(regex);
    if (matches) {
      items.push(...matches.slice(0, 2));
    }
  });
  return items;
}

function calculateEstimatedTotal(costs) {
  // Simple cost calculation - extract numbers and sum
  let total = 0;
  costs.forEach(cost => {
    const numbers = cost.match(/\d+/g);
    if (numbers) {
      total += parseInt(numbers[numbers.length - 1]); // Take highest number
    }
  });
  return total > 0 ? `UGX ${total.toLocaleString()}` : 'Contact authorities for quotes';
}

function extractPortals(text) {
  const portalPattern = /(www\.[^\s]+|https?:\/\/[^\s]+)/gi;
  return text.match(portalPattern) || ['www.ura.go.ug', 'www.ursb.go.ug', 'www.gov.ug'];
}

function extractOffices(text) {
  return [
    'URA Head Office, Kampala',
    'URSB Registration Centers',
    'Local Council Offices',
    'Relevant Ministry Offices'
  ];
}

function extractContacts(text) {
  const phonePattern = /\+?\d{3}[-.\s]?\d{3}[-.\s]?\d{6}/g;
  return text.match(phonePattern) || ['+256-417-117000 (URA)', '+256-417-338000 (URSB)'];
}

function extractOnlineServices(text) {
  return [
    'URA Online Tax Services',
    'URSB Online Registration',
    'Government e-Services Portal'
  ];
}

function extractProfessionalServices(text) {
  return [
    'Licensed Tax Consultants',
    'Corporate Lawyers',
    'Certified Accountants',
    'Business Registration Agents'
  ];
}

function determineSeverity(riskText) {
  const text = riskText.toLowerCase();
  if (text.includes('prosecution') || text.includes('criminal')) return 'CRITICAL';
  if (text.includes('heavy') || text.includes('significant')) return 'HIGH';
  if (text.includes('moderate') || text.includes('standard')) return 'MEDIUM';
  return 'LOW';
}

function determineImpact(riskText) {
  const text = riskText.toLowerCase();
  if (text.includes('business closure') || text.includes('exclusion')) return 'BUSINESS_CRITICAL';
  if (text.includes('financial') || text.includes('penalty')) return 'FINANCIAL';
  if (text.includes('reputation') || text.includes('credibility')) return 'REPUTATIONAL';
  return 'OPERATIONAL';
}

function calculateOverallRisk(risks) {
  if (risks.length === 0) return 'LOW';
  
  const criticalRisks = risks.filter(r => r.severity === 'CRITICAL').length;
  const highRisks = risks.filter(r => r.severity === 'HIGH').length;
  
  if (criticalRisks > 0) return 'CRITICAL';
  if (highRisks > 2) return 'HIGH';
  if (risks.length > 3) return 'MEDIUM';
  return 'LOW';
}

// Perform compliance gap analysis
function performComplianceGapAnalysis(requirements, currentStatus) {
  const allRequirements = [
    ...requirements.mandatory,
    ...requirements.recommended,
    ...requirements.conditional
  ];

  const gaps = [];
  const completed = [];
  const inProgress = [];

  allRequirements.forEach(req => {
    const statusKey = generateStatusKey(req.description);
    const status = currentStatus[statusKey] || { status: 'not_started' };

    const item = {
      ...req,
      currentStatus: status.status,
      statusDetails: status
    };

    switch (status.status) {
      case 'completed':
        completed.push(item);
        break;
      case 'in_progress':
        inProgress.push(item);
        break;
      default:
        gaps.push(item);
    }
  });

  // Sort gaps by priority
  gaps.sort((a, b) => {
    const priorityOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
    return priorityOrder[a.priority] - priorityOrder[b.priority];
  });

  return {
    gaps: gaps.slice(0, 10),
    completed,
    inProgress,
    summary: {
      totalRequirements: allRequirements.length,
      completedCount: completed.length,
      inProgressCount: inProgress.length,
      gapsCount: gaps.length
    }
  };
}

// Generate compliance action plan
function generateComplianceActionPlan(gapAnalysis, mode) {
  const plan = {
    immediate: [],
    shortTerm: [],
    longTerm: []
  };

  gapAnalysis.gaps.forEach(gap => {
    const action = {
      requirement: gap.description,
      priority: gap.priority,
      category: gap.category,
      estimatedTime: gap.estimatedTime,
      estimatedCost: gap.estimatedCost,
      authority: gap.authority,
      nextSteps: generateNextSteps(gap)
    };

    if (gap.priority === 'CRITICAL') {
      plan.immediate.push(action);
    } else if (gap.priority === 'HIGH') {
      plan.shortTerm.push(action);
    } else {
      plan.longTerm.push(action);
    }
  });

  return plan;
}

// Calculate compliance percentage
function calculateCompliancePercentage(gapAnalysis) {
  const { totalRequirements, completedCount, inProgressCount } = gapAnalysis.summary;
  
  if (totalRequirements === 0) return 100;
  
  const weightedCompleted = completedCount + (inProgressCount * 0.5);
  return Math.round((weightedCompleted / totalRequirements) * 100);
}

// Generate status key for requirement
function generateStatusKey(description) {
  return description
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, '_')
    .substring(0, 50);
}

// Generate next steps for requirement
function generateNextSteps(requirement) {
  const category = requirement.category;
  
  const stepTemplates = {
    TAX_COMPLIANCE: [
      'Visit URA offices or apply online',
      'Prepare required documents',
      'Pay applicable fees',
      'Follow up on application status'
    ],
    LICENSING: [
      'Contact licensing authority',
      'Submit application with documents',
      'Pay license fees',
      'Await approval and collection'
    ],
    BUSINESS_REGISTRATION: [
      'Prepare incorporation documents',
      'Submit to URSB',
      'Pay registration fees',
      'Collect certificate'
    ],
    CERTIFICATION: [
      'Contact professional body',
      'Submit qualification documents',
      'Complete any required training',
      'Pay certification fees'
    ],
    FINANCIAL_SECURITY: [
      'Contact insurance providers',
      'Get quotes and compare',
      'Purchase appropriate coverage',
      'Maintain policy current'
    ],
    DOCUMENTATION: [
      'Gather required documents',
      'Get certified copies',
      'Submit to relevant authority',
      'Keep records updated'
    ]
  };

  return stepTemplates[category] || [
    'Research specific requirements',
    'Contact relevant authority',
    'Prepare and submit application',
    'Follow up on progress'
  ];
}

// Calculate analysis confidence
function calculateAnalysisConfidence(analysisText, country) {
  let confidence = 60; // Base confidence
  
  // Increase confidence based on analysis quality indicators
  if (analysisText.length > 1500) confidence += 15;
  if (analysisText.includes(country)) confidence += 10;
  if (analysisText.match(/\d+/g)?.length > 5) confidence += 10; // Contains specific numbers
  if (analysisText.includes('UGX') || analysisText.includes('fees')) confidence += 5;
  
  return Math.max(40, Math.min(90, confidence));
}

// Calculate validity date
function calculateValidityDate() {
  const validUntil = new Date();
  validUntil.setMonth(validUntil.getMonth() + 3); // Valid for 3 months
  return validUntil.toISOString();
}

// Generate unique analysis ID
function generateAnalysisId() {
  return 'rga_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

export default router;