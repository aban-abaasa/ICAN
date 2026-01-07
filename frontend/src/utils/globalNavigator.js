// Global Navigator - Pillar III: Regulatory Compliance
// Regulatory gap analysis and compliance checklist for global opportunities

import { saveComplianceCheck, getLatestComplianceCheck } from '../config/firebase.js';

export class GlobalNavigator {
  constructor(userId) {
    this.userId = userId;
    this.geminiApiKey = import.meta.env.VITE_GEMINI_API_KEY;
    this.geminiApiUrl = import.meta.env.VITE_GEMINI_API_URL;
  }

  // Main regulatory gap analysis function
  async performComplianceAnalysis(operatingCountry, mode, sector = 'general') {
    try {
      // Step 1: Get current regulatory requirements
      const currentRequirements = await this.getCurrentRequirements(operatingCountry, mode, sector);
      
      // Step 2: Analyze user's current compliance status
      const complianceStatus = await this.analyzeComplianceStatus(operatingCountry, mode);
      
      // Step 3: Identify gaps and priorities
      const gapAnalysis = this.identifyComplianceGaps(currentRequirements, complianceStatus);
      
      // Step 4: Generate prioritized action plan
      const actionPlan = this.generateActionPlan(gapAnalysis, mode);
      
      // Step 5: Calculate compliance percentage
      const compliancePercentage = this.calculateCompliancePercentage(gapAnalysis);

      const analysis = {
        operatingCountry,
        mode,
        sector,
        compliancePercentage,
        currentRequirements,
        complianceStatus,
        gapAnalysis,
        actionPlan,
        lastUpdated: new Date().toISOString(),
        nextReviewDate: this.calculateNextReviewDate()
      };

      // Save to Firebase
      await saveComplianceCheck(this.userId, analysis);

      return { success: true, analysis };

    } catch (error) {
      console.error('Compliance analysis failed:', error);
      return { success: false, error: error.message };
    }
  }

  // Get current regulatory requirements using Gemini API with grounding
  async getCurrentRequirements(country, mode, sector) {
    if (!this.geminiApiKey) {
      return this.getMockRequirements(country, mode, sector);
    }

    try {
      const prompt = this.buildRequirementsPrompt(country, mode, sector);
      
      const response = await fetch(`${this.geminiApiUrl}?key=${this.geminiApiKey}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: prompt
            }]
          }],
          generationConfig: {
            temperature: 0.1,
            topK: 40,
            topP: 0.95,
            maxOutputTokens: 2048,
          }
        })
      });

      if (!response.ok) {
        throw new Error(`Gemini API error: ${response.status}`);
      }

      const data = await response.json();
      
      if (data.candidates && data.candidates[0] && data.candidates[0].content) {
        const requirementsText = data.candidates[0].content.parts[0].text;
        return this.parseRequirementsResponse(requirementsText);
      }
      
      throw new Error('Invalid response from Gemini API');

    } catch (error) {
      console.error('Requirements API call failed:', error);
      return this.getMockRequirements(country, mode, sector);
    }
  }

  // Build requirements analysis prompt
  buildRequirementsPrompt(country, mode, sector) {
    const modeDescription = mode === 'SE' ? 
      'Salaried Employee seeking career advancement and corporate opportunities' :
      'Business Owner seeking government tenders, contracts, and business opportunities';

    return `
REGULATORY COMPLIANCE ANALYSIS REQUEST

Analyze current regulatory requirements for ${country} in ${new Date().getFullYear()}.

TARGET PROFILE:
- Mode: ${mode} (${modeDescription})
- Country: ${country}
- Sector: ${sector}
- Purpose: Global opportunity readiness

REQUIRED ANALYSIS:

1. BUSINESS/EMPLOYMENT REQUIREMENTS:
   - Business registration/licensing
   - Professional certifications
   - Employment eligibility
   - Industry-specific permits

2. TAX COMPLIANCE:
   - Tax registration requirements
   - Current tax clearance needs
   - VAT/GST registration thresholds
   - Withholding tax obligations

3. LEGAL DOCUMENTATION:
   - Identity verification requirements
   - Address verification needs
   - Banking documentation
   - Insurance requirements

4. REGULATORY FILINGS:
   - Annual filing requirements
   - Periodic reporting obligations
   - Compliance certifications
   - Audit requirements

5. INTERNATIONAL READINESS:
   - Export/import permits
   - Foreign exchange compliance
   - Anti-money laundering requirements
   - International tax agreements

Please provide specific, actionable requirements with:
- Exact document names and issuing authorities
- Application processes and timelines
- Renewal dates and validity periods
- Penalties for non-compliance
- Recent regulatory changes

Focus on requirements that enable participation in major opportunities like:
- Government tenders and contracts
- International business partnerships
- Corporate employment opportunities
- Investment and funding access
`;
  }

  // Parse Gemini API requirements response
  parseRequirementsResponse(responseText) {
    try {
      const requirements = {
        business: this.extractRequirements(responseText, 'business', 'license', 'registration'),
        tax: this.extractRequirements(responseText, 'tax', 'clearance', 'revenue'),
        legal: this.extractRequirements(responseText, 'legal', 'document', 'identity'),
        regulatory: this.extractRequirements(responseText, 'regulat', 'filing', 'report'),
        international: this.extractRequirements(responseText, 'international', 'export', 'foreign')
      };

      return requirements;
    } catch (error) {
      console.error('Error parsing requirements response:', error);
      return this.getMockRequirements();
    }
  }

  // Extract requirements from text
  extractRequirements(text, ...keywords) {
    const lines = text.split('\n');
    const relevantLines = lines.filter(line => 
      keywords.some(keyword => 
        line.toLowerCase().includes(keyword.toLowerCase())
      ) && line.trim().length > 10
    );

    return relevantLines.map(line => {
      const cleaned = line.trim().replace(/^[-•*]\s*/, '').replace(/^\d+\.\s*/, '');
      return {
        requirement: cleaned,
        priority: this.determinePriority(cleaned),
        category: this.categorizeRequirement(cleaned),
        estimatedTime: this.estimateCompletionTime(cleaned)
      };
    }).slice(0, 8); // Limit results
  }

  // Determine requirement priority
  determinePriority(requirement) {
    const text = requirement.toLowerCase();
    
    if (text.includes('tax clearance') || text.includes('business license') || text.includes('registration')) {
      return 'CRITICAL';
    }
    if (text.includes('certificate') || text.includes('permit') || text.includes('compliance')) {
      return 'HIGH';
    }
    if (text.includes('insurance') || text.includes('audit') || text.includes('filing')) {
      return 'MEDIUM';
    }
    return 'LOW';
  }

  // Categorize requirement
  categorizeRequirement(requirement) {
    const text = requirement.toLowerCase();
    
    if (text.includes('tax') || text.includes('revenue')) return 'TAX';
    if (text.includes('license') || text.includes('permit')) return 'LICENSING';
    if (text.includes('certificate') || text.includes('qualification')) return 'CERTIFICATION';
    if (text.includes('document') || text.includes('identity')) return 'DOCUMENTATION';
    if (text.includes('audit') || text.includes('filing')) return 'REPORTING';
    return 'OTHER';
  }

  // Estimate completion time
  estimateCompletionTime(requirement) {
    const text = requirement.toLowerCase();
    
    if (text.includes('clearance') || text.includes('audit')) return '2-4 weeks';
    if (text.includes('license') || text.includes('registration')) return '1-3 weeks';
    if (text.includes('certificate') || text.includes('permit')) return '1-2 weeks';
    if (text.includes('document') || text.includes('form')) return '1-5 days';
    return '1-2 weeks';
  }

  // Mock requirements for demo
  getMockRequirements(country = 'Uganda', mode = 'SE', sector = 'general') {
    const baseRequirements = {
      business: [
        {
          requirement: 'Business License from Local Council',
          priority: 'CRITICAL',
          category: 'LICENSING',
          estimatedTime: '2-3 weeks'
        },
        {
          requirement: 'Company Registration with URSB',
          priority: 'HIGH',
          category: 'LICENSING',
          estimatedTime: '1-2 weeks'
        }
      ],
      tax: [
        {
          requirement: 'Tax Identification Number (TIN) from URA',
          priority: 'CRITICAL',
          category: 'TAX',
          estimatedTime: '1 week'
        },
        {
          requirement: '2024 Tax Clearance Certificate',
          priority: 'CRITICAL',
          category: 'TAX',
          estimatedTime: '2-4 weeks'
        },
        {
          requirement: 'VAT Registration (if applicable)',
          priority: 'MEDIUM',
          category: 'TAX',
          estimatedTime: '1-2 weeks'
        }
      ],
      legal: [
        {
          requirement: 'National ID or Passport Verification',
          priority: 'CRITICAL',
          category: 'DOCUMENTATION',
          estimatedTime: '1-3 days'
        },
        {
          requirement: 'Professional Indemnity Insurance',
          priority: 'MEDIUM',
          category: 'DOCUMENTATION',
          estimatedTime: '1 week'
        }
      ],
      regulatory: [
        {
          requirement: 'Annual Returns Filing',
          priority: 'HIGH',
          category: 'REPORTING',
          estimatedTime: '1 week'
        }
      ],
      international: [
        {
          requirement: 'Export License (for international business)',
          priority: 'LOW',
          category: 'LICENSING',
          estimatedTime: '2-3 weeks'
        }
      ]
    };

    // Customize based on mode
    if (mode === 'BO') {
      baseRequirements.business.push({
        requirement: 'PPDA Contractor Registration',
        priority: 'CRITICAL',
        category: 'LICENSING',
        estimatedTime: '3-4 weeks'
      });
    }

    return baseRequirements;
  }

  // Analyze current compliance status
  async analyzeComplianceStatus(country, mode) {
    // In production, this would check actual user documents/certificates
    // For demo, we simulate based on localStorage or random status
    
    const mockStatus = {
      'Tax Identification Number (TIN) from URA': {
        status: 'completed',
        expiryDate: '2025-12-31',
        documentNumber: 'TIN12345678',
        verifiedDate: '2024-01-15'
      },
      'National ID or Passport Verification': {
        status: 'completed',
        expiryDate: '2029-05-20',
        documentNumber: 'ID*******789',
        verifiedDate: '2024-01-10'
      },
      'Business License from Local Council': {
        status: 'pending',
        expiryDate: null,
        documentNumber: null,
        verifiedDate: null,
        applicationDate: '2024-09-15'
      },
      '2024 Tax Clearance Certificate': {
        status: 'not-started',
        expiryDate: null,
        documentNumber: null,
        verifiedDate: null
      },
      'Company Registration with URSB': {
        status: mode === 'BO' ? 'completed' : 'not-applicable',
        expiryDate: mode === 'BO' ? '2025-08-30' : null,
        documentNumber: mode === 'BO' ? 'URSB123456' : null,
        verifiedDate: mode === 'BO' ? '2024-08-30' : null
      }
    };

    return mockStatus;
  }

  // Identify compliance gaps
  identifyComplianceGaps(requirements, status) {
    const gaps = [];
    const completed = [];
    const inProgress = [];
    
    // Flatten all requirements
    const allRequirements = [
      ...requirements.business || [],
      ...requirements.tax || [],
      ...requirements.legal || [],
      ...requirements.regulatory || [],
      ...requirements.international || []
    ];

    allRequirements.forEach(req => {
      const reqStatus = status[req.requirement] || { status: 'not-started' };
      
      const item = {
        ...req,
        currentStatus: reqStatus.status,
        expiryDate: reqStatus.expiryDate,
        documentNumber: reqStatus.documentNumber,
        verifiedDate: reqStatus.verifiedDate,
        applicationDate: reqStatus.applicationDate,
        daysUntilExpiry: reqStatus.expiryDate ? 
          Math.ceil((new Date(reqStatus.expiryDate) - new Date()) / (1000 * 60 * 60 * 24)) : null
      };

      if (reqStatus.status === 'completed') {
        // Check if expired or expiring soon
        if (item.daysUntilExpiry !== null && item.daysUntilExpiry < 90) {
          item.priority = 'HIGH';
          item.action = 'RENEWAL_REQUIRED';
          gaps.push(item);
        } else {
          completed.push(item);
        }
      } else if (reqStatus.status === 'pending') {
        item.action = 'FOLLOW_UP_REQUIRED';
        inProgress.push(item);
      } else if (reqStatus.status !== 'not-applicable') {
        item.action = 'ACTION_REQUIRED';
        gaps.push(item);
      }
    });

    // Sort gaps by priority
    gaps.sort((a, b) => {
      const priorityOrder = { 'CRITICAL': 0, 'HIGH': 1, 'MEDIUM': 2, 'LOW': 3 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });

    return {
      gaps: gaps.slice(0, 10), // Top 10 gaps
      completed: completed.slice(0, 10),
      inProgress: inProgress.slice(0, 5),
      summary: {
        totalRequirements: allRequirements.length,
        completedCount: completed.length,
        gapsCount: gaps.length,
        inProgressCount: inProgress.length
      }
    };
  }

  // Generate prioritized action plan
  generateActionPlan(gapAnalysis, mode) {
    const actionPlan = {
      immediate: [], // Next 30 days
      shortTerm: [], // 30-90 days
      longTerm: [], // 90+ days
      recommendations: []
    };

    gapAnalysis.gaps.forEach(gap => {
      const action = {
        task: this.generateActionTask(gap),
        requirement: gap.requirement,
        priority: gap.priority,
        estimatedTime: gap.estimatedTime,
        category: gap.category,
        nextSteps: this.getNextSteps(gap),
        resources: this.getResources(gap),
        cost: this.estimateCost(gap)
      };

      if (gap.priority === 'CRITICAL' || gap.action === 'RENEWAL_REQUIRED') {
        actionPlan.immediate.push(action);
      } else if (gap.priority === 'HIGH') {
        actionPlan.shortTerm.push(action);
      } else {
        actionPlan.longTerm.push(action);
      }
    });

    // Generate recommendations
    actionPlan.recommendations = this.generateRecommendations(gapAnalysis, mode);

    return actionPlan;
  }

  // Generate action task description
  generateActionTask(gap) {
    switch (gap.action) {
      case 'RENEWAL_REQUIRED':
        return `Renew ${gap.requirement} (expires in ${gap.daysUntilExpiry} days)`;
      case 'FOLLOW_UP_REQUIRED':
        return `Follow up on pending ${gap.requirement}`;
      default:
        return `Obtain ${gap.requirement}`;
    }
  }

  // Get next steps for requirement
  getNextSteps(gap) {
    const category = gap.category;
    const requirement = gap.requirement.toLowerCase();
    
    if (category === 'TAX') {
      if (requirement.includes('tin')) {
        return [
          'Visit URA offices or apply online',
          'Bring National ID and passport photos',
          'Complete TIN application form',
          'Pay application fee'
        ];
      }
      if (requirement.includes('clearance')) {
        return [
          'Ensure all tax returns are filed',
          'Pay any outstanding tax liabilities',
          'Apply for tax clearance certificate',
          'Follow up on application status'
        ];
      }
    }

    if (category === 'LICENSING') {
      if (requirement.includes('business license')) {
        return [
          'Visit Local Council offices',
          'Submit business registration documents',
          'Pay license fees',
          'Await approval and collection'
        ];
      }
    }

    return [
      'Research specific application requirements',
      'Prepare necessary documentation',
      'Submit application with fees',
      'Follow up on processing status'
    ];
  }

  // Get resources for requirement
  getResources(gap) {
    const category = gap.category;
    
    const resourceMap = {
      'TAX': {
        website: 'https://www.ura.go.ug',
        office: 'URA Customer Service Centers',
        helpline: 'URA Helpline: +256-417-117000'
      },
      'LICENSING': {
        website: 'https://www.ursb.go.ug',
        office: 'URSB Registration Centers',
        helpline: 'URSB Helpline: +256-417-338000'
      },
      'DOCUMENTATION': {
        website: 'National Identification and Registration Authority',
        office: 'NIRA Registration Centers',
        helpline: 'NIRA Helpline: 0800-100-200'
      },
      'CERTIFICATION': {
        website: 'Relevant Professional Bodies',
        office: 'Professional Association Offices',
        helpline: 'Association Contact Centers'
      }
    };

    return resourceMap[category] || {
      website: 'Government Portal: www.gov.ug',
      office: 'Relevant Government Ministry',
      helpline: 'Government Information Center'
    };
  }

  // Estimate cost for requirement
  estimateCost(gap) {
    const requirement = gap.requirement.toLowerCase();
    
    if (requirement.includes('tin')) return 'Free';
    if (requirement.includes('clearance')) return 'UGX 50,000 - 100,000';
    if (requirement.includes('business license')) return 'UGX 100,000 - 300,000';
    if (requirement.includes('company registration')) return 'UGX 200,000 - 500,000';
    if (requirement.includes('insurance')) return 'UGX 500,000 - 2,000,000/year';
    
    return 'Variable - Contact Authority';
  }

  // Generate recommendations
  generateRecommendations(gapAnalysis, mode) {
    const recommendations = [];
    
    if (gapAnalysis.summary.gapsCount > 5) {
      recommendations.push('High compliance gap detected - prioritize critical requirements first');
    }
    
    if (mode === 'BO') {
      recommendations.push('Business owners should maintain PPDA registration for government contracts');
      recommendations.push('Consider professional indemnity insurance for credibility');
    } else {
      recommendations.push('Salaried employees should focus on professional certifications');
      recommendations.push('Maintain tax compliance for employment opportunities');
    }

    recommendations.push('Set up calendar reminders for document renewals');
    recommendations.push('Keep digital copies of all compliance documents');
    recommendations.push('Review compliance status quarterly');

    return recommendations;
  }

  // Calculate compliance percentage
  calculateCompliancePercentage(gapAnalysis) {
    const total = gapAnalysis.summary.totalRequirements;
    const completed = gapAnalysis.summary.completedCount;
    const inProgress = gapAnalysis.summary.inProgressCount;
    
    if (total === 0) return 100;
    
    // Weight: completed = 100%, in-progress = 50%
    const weightedCompleted = completed + (inProgress * 0.5);
    return Math.round((weightedCompleted / total) * 100);
  }

  // Calculate next review date
  calculateNextReviewDate() {
    const nextReview = new Date();
    nextReview.setMonth(nextReview.getMonth() + 3); // Review every 3 months
    return nextReview.toISOString();
  }

  // Get latest compliance data
  async getLatestCompliance(country, mode) {
    try {
      const result = await getLatestComplianceCheck(this.userId, country, mode);
      return result;
    } catch (error) {
      console.error('Error getting latest compliance:', error);
      return { success: false, error };
    }
  }

  // Export compliance report
  generateComplianceReport(analysis) {
    return {
      executiveSummary: {
        overallScore: analysis.compliancePercentage,
        riskLevel: analysis.compliancePercentage > 80 ? 'LOW' : 
                   analysis.compliancePercentage > 60 ? 'MEDIUM' : 'HIGH',
        totalRequirements: analysis.gapAnalysis.summary.totalRequirements,
        completedRequirements: analysis.gapAnalysis.summary.completedCount,
        pendingActions: analysis.gapAnalysis.summary.gapsCount
      },
      criticalActions: analysis.actionPlan.immediate,
      upcomingRenewals: analysis.gapAnalysis.gaps.filter(g => g.action === 'RENEWAL_REQUIRED'),
      recommendations: analysis.actionPlan.recommendations,
      generatedDate: new Date().toISOString(),
      nextReviewDate: analysis.nextReviewDate
    };
  }
}

// Factory function
export const createGlobalNavigator = (userId) => {
  return new GlobalNavigator(userId);
};

export default GlobalNavigator;