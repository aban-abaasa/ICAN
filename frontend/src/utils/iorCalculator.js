// ICAN Opportunity Rating (IOR) System
// Composite scoring system for global opportunity readiness

export class IORCalculator {
  constructor() {
    this.pillarWeights = {
      financial: 0.25,    // 25% - Financial Capital
      legal: 0.20,        // 20% - Legal Resilience
      regulatory: 0.25,   // 25% - Regulatory Compliance
      human: 0.20,        // 20% - Human Capital
      integrity: 0.10     // 10% - Base Integrity Score
    };
    
    this.benchmarks = {
      excellent: 90,
      good: 75,
      acceptable: 60,
      needs_improvement: 45,
      critical: 30
    };
  }

  // Main IOR calculation function
  calculateIOR(pillarData) {
    try {
      // Calculate individual pillar scores
      const pillarScores = {
        financial: this.calculateFinancialScore(pillarData.financial),
        legal: this.calculateLegalScore(pillarData.legal),
        regulatory: this.calculateRegulatoryScore(pillarData.regulatory),
        human: this.calculateHumanScore(pillarData.human),
        integrity: this.calculateIntegrityScore(pillarData.integrity)
      };

      // Calculate weighted composite score
      const compositeScore = Object.keys(pillarScores).reduce((total, pillar) => {
        return total + (pillarScores[pillar] * this.pillarWeights[pillar]);
      }, 0);

      // Perform gap analysis
      const gapAnalysis = this.performGapAnalysis(pillarScores);

      // Generate readiness assessment
      const readinessLevel = this.determineReadinessLevel(compositeScore);

      // Calculate confidence interval
      const confidence = this.calculateConfidence(pillarScores, pillarData);

      return {
        overallScore: Math.round(compositeScore),
        pillarScores,
        gapAnalysis,
        readinessLevel,
        confidence,
        recommendations: this.generateRecommendations(gapAnalysis, pillarScores),
        opportunityCategories: this.assessOpportunityCategories(pillarScores),
        nextActions: this.prioritizeNextActions(gapAnalysis),
        calculatedAt: new Date().toISOString(),
        validUntil: this.calculateExpiryDate()
      };
    } catch (error) {
      console.error('IOR calculation failed:', error);
      return this.getDefaultIOR();
    }
  }

  // Pillar I: Financial Capital Score (0-100)
  calculateFinancialScore(financialData = {}) {
    if (!financialData) return 50; // Default neutral score

    const {
      netWorth = 0,
      targetNetWorth = 1000000,
      velocity30Days = 0,
      consistencyScore = 50,
      diversificationScore = 50,
      liquidityRatio = 0.2
    } = financialData;

    let score = 0;

    // Net Worth Progress (40% weight)
    const netWorthRatio = Math.max(0, Math.min(1, netWorth / targetNetWorth));
    const netWorthScore = Math.pow(netWorthRatio, 0.5) * 40; // Square root for gradual progression
    score += netWorthScore;

    // Velocity Score (30% weight)
    const monthlyTarget = targetNetWorth * 0.01; // 1% monthly target
    const velocityRatio = Math.max(0, Math.min(2, velocity30Days / monthlyTarget));
    const velocityScore = Math.min(30, velocityRatio * 15); // Cap at 30 points
    score += velocityScore;

    // Consistency Score (20% weight)
    score += (consistencyScore / 100) * 20;

    // Financial Resilience (10% weight)
    const resilienceFactors = [
      diversificationScore / 100,
      Math.min(1, liquidityRatio / 0.3), // Target: 30% liquidity
      netWorth > 0 ? 1 : 0 // Positive net worth
    ];
    const resilienceScore = resilienceFactors.reduce((sum, factor) => sum + factor, 0) / resilienceFactors.length * 10;
    score += resilienceScore;

    return Math.round(Math.max(0, Math.min(100, score)));
  }

  // Pillar II: Legal Resilience Score (0-100)
  calculateLegalScore(legalData = {}) {
    if (!legalData) return 50; // Default neutral score

    const {
      contractAnalyses = [],
      averageSafetyScore = 5.0,
      recentAnalysisCount = 0,
      criticalFlagsResolved = 0,
      totalCriticalFlags = 1,
      legalKnowledgeScore = 50
    } = legalData;

    let score = 0;

    // Contract Analysis Quality (40% weight)
    if (recentAnalysisCount > 0) {
      const safetyScore = Math.max(0, Math.min(10, averageSafetyScore));
      score += (safetyScore / 10) * 40;
    } else {
      score += 20; // Partial credit for no analysis yet
    }

    // Risk Management (30% weight)
    const flagResolutionRate = totalCriticalFlags > 0 ? 
      criticalFlagsResolved / totalCriticalFlags : 1;
    score += flagResolutionRate * 30;

    // Legal Awareness (20% weight)
    score += (legalKnowledgeScore / 100) * 20;

    // Proactive Legal Management (10% weight)
    const proactiveScore = Math.min(10, recentAnalysisCount * 2); // Up to 5 analyses
    score += proactiveScore;

    return Math.round(Math.max(0, Math.min(100, score)));
  }

  // Pillar III: Regulatory Compliance Score (0-100)
  calculateRegulatoryScore(regulatoryData = {}) {
    if (!regulatoryData) return 50; // Default neutral score

    const {
      compliancePercentage = 50,
      criticalRequirementsMet = 0,
      totalCriticalRequirements = 5,
      expiringDocuments = 0,
      upToDateDocuments = 0,
      lastComplianceCheck = null
    } = regulatoryData;

    let score = 0;

    // Overall Compliance Percentage (50% weight)
    score += (compliancePercentage / 100) * 50;

    // Critical Requirements (30% weight)
    const criticalComplianceRate = totalCriticalRequirements > 0 ? 
      criticalRequirementsMet / totalCriticalRequirements : 0.5;
    score += criticalComplianceRate * 30;

    // Document Currency (15% weight)
    const totalDocuments = upToDateDocuments + expiringDocuments;
    const documentCurrencyRate = totalDocuments > 0 ? 
      upToDateDocuments / totalDocuments : 0.5;
    score += documentCurrencyRate * 15;

    // Recency of Check (5% weight)
    if (lastComplianceCheck) {
      const daysSinceCheck = (Date.now() - new Date(lastComplianceCheck).getTime()) / (1000 * 60 * 60 * 24);
      const recencyScore = Math.max(0, Math.min(5, 5 - (daysSinceCheck / 30))); // Decreases over 30 days
      score += recencyScore;
    }

    return Math.round(Math.max(0, Math.min(100, score)));
  }

  // Pillar IV: Human Capital Score (0-100)
  calculateHumanScore(humanData = {}) {
    if (!humanData) return 50; // Default neutral score

    const {
      scheduleOptimizationScore = 50,
      hvwHoursPerWeek = 10,
      alignmentBlocksConsistency = 50,
      productivityTrends = 'stable',
      skillDevelopmentHours = 5,
      networkingEffectiveness = 50
    } = humanData;

    let score = 0;

    // Schedule Optimization (25% weight)
    score += (scheduleOptimizationScore / 100) * 25;

    // High-Value Work Focus (25% weight)
    const optimalHVW = 25; // 25 hours per week target
    const hvwScore = Math.min(100, (hvwHoursPerWeek / optimalHVW) * 100);
    score += (hvwScore / 100) * 25;

    // Alignment & Balance (20% weight)
    score += (alignmentBlocksConsistency / 100) * 20;

    // Growth Trajectory (15% weight)
    const trendMultipliers = { improving: 1.0, stable: 0.7, declining: 0.3 };
    const trendScore = (trendMultipliers[productivityTrends] || 0.7) * 15;
    score += trendScore;

    // Continuous Development (10% weight)
    const developmentScore = Math.min(10, skillDevelopmentHours * 2); // Up to 5 hours/week
    score += developmentScore;

    // Network & Relationships (5% weight)
    score += (networkingEffectiveness / 100) * 5;

    return Math.round(Math.max(0, Math.min(100, score)));
  }

  // Pillar V: Integrity Score (0-100)
  calculateIntegrityScore(integrityData = {}) {
    // Base integrity score - represents ethical foundation
    const {
      ethicalDecisionHistory = 85,
      transparencyScore = 90,
      accountabilityScore = 80,
      consistencyScore = 85,
      stakeholderTrustScore = 85
    } = integrityData || {};

    const components = [
      ethicalDecisionHistory,
      transparencyScore,
      accountabilityScore,
      consistencyScore,
      stakeholderTrustScore
    ];

    const averageScore = components.reduce((sum, score) => sum + score, 0) / components.length;
    return Math.round(Math.max(0, Math.min(100, averageScore)));
  }

  // Perform gap analysis to identify lowest scoring areas
  performGapAnalysis(pillarScores) {
    const sortedPillars = Object.entries(pillarScores)
      .sort(([,a], [,b]) => a - b);

    const lowestPillar = sortedPillars[0];
    const highestPillar = sortedPillars[sortedPillars.length - 1];
    
    // Identify critical gaps (scores below 60)
    const criticalGaps = sortedPillars.filter(([, score]) => score < 60);
    
    // Identify improvement opportunities (scores 60-80)
    const improvementOpportunities = sortedPillars.filter(([, score]) => score >= 60 && score < 80);

    return {
      lowestPillar: {
        name: this.getPillarDisplayName(lowestPillar[0]),
        score: lowestPillar[1],
        key: lowestPillar[0]
      },
      highestPillar: {
        name: this.getPillarDisplayName(highestPillar[0]),
        score: highestPillar[1],
        key: highestPillar[0]
      },
      criticalGaps: criticalGaps.map(([key, score]) => ({
        key,
        name: this.getPillarDisplayName(key),
        score,
        severity: score < 30 ? 'CRITICAL' : score < 45 ? 'HIGH' : 'MEDIUM'
      })),
      improvementOpportunities: improvementOpportunities.map(([key, score]) => ({
        key,
        name: this.getPillarDisplayName(key),
        score,
        potential: Math.min(25, 80 - score) // Potential improvement to reach 80
      })),
      scoreDistribution: {
        excellent: sortedPillars.filter(([, score]) => score >= 90).length,
        good: sortedPillars.filter(([, score]) => score >= 75 && score < 90).length,
        acceptable: sortedPillars.filter(([, score]) => score >= 60 && score < 75).length,
        needsWork: sortedPillars.filter(([, score]) => score < 60).length
      }
    };
  }

  // Determine overall readiness level
  determineReadinessLevel(compositeScore) {
    if (compositeScore >= this.benchmarks.excellent) {
      return {
        level: 'EXCELLENT',
        description: 'Ready for premium global opportunities',
        color: 'green',
        opportunities: ['Fortune 500 partnerships', 'International contracts', 'Major investments']
      };
    } else if (compositeScore >= this.benchmarks.good) {
      return {
        level: 'GOOD',
        description: 'Well-positioned for significant opportunities',
        color: 'blue',
        opportunities: ['Regional partnerships', 'Government contracts', 'Corporate positions']
      };
    } else if (compositeScore >= this.benchmarks.acceptable) {
      return {
        level: 'ACCEPTABLE',
        description: 'Ready for standard opportunities with focused improvement',
        color: 'yellow',
        opportunities: ['Local contracts', 'Standard employment', 'Small partnerships']
      };
    } else if (compositeScore >= this.benchmarks.needs_improvement) {
      return {
        level: 'DEVELOPING',
        description: 'Building readiness - focus on critical gaps',
        color: 'orange',
        opportunities: ['Entry-level positions', 'Skill-based opportunities', 'Learning partnerships']
      };
    } else {
      return {
        level: 'FOUNDATIONAL',
        description: 'Early stage - establish core fundamentals',
        color: 'red',
        opportunities: ['Basic employment', 'Skill development programs', 'Mentorship opportunities']
      };
    }
  }

  // Calculate confidence interval based on data completeness and recency
  calculateConfidence(pillarScores, pillarData) {
    let confidenceFactors = [];

    // Data completeness factor
    const dataPoints = Object.values(pillarData).filter(data => data && Object.keys(data).length > 0).length;
    confidenceFactors.push(Math.min(1, dataPoints / 5)); // 5 pillars

    // Score consistency factor (lower variance = higher confidence)
    const scores = Object.values(pillarScores);
    const mean = scores.reduce((sum, score) => sum + score, 0) / scores.length;
    const variance = scores.reduce((sum, score) => sum + Math.pow(score - mean, 2), 0) / scores.length;
    const consistencyFactor = Math.max(0, 1 - (variance / 1000)); // Normalize variance
    confidenceFactors.push(consistencyFactor);

    // Recency factor (recent updates = higher confidence)
    const hasRecentData = Object.values(pillarData).some(data => 
      data && data.lastUpdated && 
      (Date.now() - new Date(data.lastUpdated).getTime()) < (7 * 24 * 60 * 60 * 1000) // 7 days
    );
    confidenceFactors.push(hasRecentData ? 1 : 0.7);

    const overallConfidence = confidenceFactors.reduce((sum, factor) => sum + factor, 0) / confidenceFactors.length;
    
    return {
      percentage: Math.round(overallConfidence * 100),
      level: overallConfidence >= 0.8 ? 'HIGH' : overallConfidence >= 0.6 ? 'MEDIUM' : 'LOW',
      factors: {
        dataCompleteness: Math.round(confidenceFactors[0] * 100),
        scoreConsistency: Math.round(confidenceFactors[1] * 100),
        dataRecency: Math.round(confidenceFactors[2] * 100)
      }
    };
  }

  // Generate targeted recommendations based on gap analysis
  generateRecommendations(gapAnalysis, pillarScores) {
    const recommendations = [];

    // Critical gap recommendations
    gapAnalysis.criticalGaps.forEach(gap => {
      const pillarRecommendations = this.getPillarRecommendations(gap.key, gap.score);
      recommendations.push({
        priority: 'CRITICAL',
        pillar: gap.name,
        issue: `${gap.name} score (${gap.score}%) is below minimum threshold`,
        actions: pillarRecommendations.critical,
        timeline: '1-4 weeks',
        impact: 'HIGH'
      });
    });

    // Improvement opportunity recommendations
    gapAnalysis.improvementOpportunities.forEach(opp => {
      const pillarRecommendations = this.getPillarRecommendations(opp.key, opp.score);
      recommendations.push({
        priority: 'MEDIUM',
        pillar: opp.name,
        issue: `${opp.name} has ${opp.potential}% improvement potential`,
        actions: pillarRecommendations.improvement,
        timeline: '2-8 weeks',
        impact: 'MEDIUM'
      });
    });

    // Excellence maintenance recommendations
    Object.entries(pillarScores)
      .filter(([, score]) => score >= 85)
      .forEach(([key, score]) => {
        const pillarRecommendations = this.getPillarRecommendations(key, score);
        recommendations.push({
          priority: 'LOW',
          pillar: this.getPillarDisplayName(key),
          issue: `Maintain excellence in ${this.getPillarDisplayName(key)}`,
          actions: pillarRecommendations.maintenance,
          timeline: 'Ongoing',
          impact: 'MAINTENANCE'
        });
      });

    return recommendations.slice(0, 8); // Limit to top 8 recommendations
  }

  // Get specific recommendations for each pillar
  getPillarRecommendations(pillarKey, score) {
    const recommendations = {
      financial: {
        critical: [
          'Establish emergency fund (3-6 months expenses)',
          'Create structured savings plan',
          'Track all income and expenses daily',
          'Identify and eliminate financial leaks'
        ],
        improvement: [
          'Increase high-value work income streams',
          'Optimize investment allocation',
          'Improve financial tracking consistency',
          'Build passive income sources'
        ],
        maintenance: [
          'Review and rebalance portfolio quarterly',
          'Maintain consistent wealth accumulation',
          'Explore advanced investment strategies',
          'Consider wealth protection measures'
        ]
      },
      legal: {
        critical: [
          'Conduct immediate contract review training',
          'Establish legal document checklist',
          'Build relationship with legal counsel',
          'Review all existing agreements'
        ],
        improvement: [
          'Improve contract analysis skills',
          'Standardize legal review processes',
          'Build legal knowledge library',
          'Implement preventive legal measures'
        ],
        maintenance: [
          'Continue regular contract reviews',
          'Stay updated on legal changes',
          'Maintain legal advisor relationships',
          'Share legal insights with network'
        ]
      },
      regulatory: {
        critical: [
          'Complete all missing critical documents',
          'Set up compliance tracking system',
          'Schedule immediate regulatory review',
          'Address all expired certifications'
        ],
        improvement: [
          'Automate compliance renewal reminders',
          'Build comprehensive compliance calendar',
          'Develop regulatory knowledge base',
          'Establish compliance review routine'
        ],
        maintenance: [
          'Maintain proactive compliance monitoring',
          'Stay ahead of regulatory changes',
          'Help others with compliance knowledge',
          'Optimize compliance processes'
        ]
      },
      human: {
        critical: [
          'Establish basic daily routine structure',
          'Block time for high-value activities',
          'Eliminate major time wasters',
          'Set up energy management system'
        ],
        improvement: [
          'Optimize schedule for peak performance',
          'Increase high-value work allocation',
          'Improve focus and productivity systems',
          'Build stronger professional relationships'
        ],
        maintenance: [
          'Continue schedule optimization',
          'Mentor others in productivity',
          'Explore advanced performance techniques',
          'Maintain work-life integration'
        ]
      },
      integrity: {
        critical: [
          'Clarify personal values and ethics',
          'Address any ethical concerns immediately',
          'Build accountability systems',
          'Establish transparent practices'
        ],
        improvement: [
          'Strengthen stakeholder relationships',
          'Improve communication transparency',
          'Build trust through consistency',
          'Develop ethical leadership skills'
        ],
        maintenance: [
          'Continue exemplary ethical behavior',
          'Mentor others in integrity',
          'Champion ethical practices',
          'Build reputation as trusted advisor'
        ]
      }
    };

    return recommendations[pillarKey] || {
      critical: ['Assess and address fundamental gaps'],
      improvement: ['Focus on consistent improvement'],
      maintenance: ['Maintain current performance level']
    };
  }

  // Assess opportunity categories based on IOR profile
  assessOpportunityCategories(pillarScores) {
    const categories = [];

    // Government/Public Sector Opportunities
    if (pillarScores.regulatory >= 75 && pillarScores.legal >= 70) {
      categories.push({
        category: 'Government Contracts & Tenders',
        readiness: 'HIGH',
        requirements: ['Strong regulatory compliance', 'Legal risk management'],
        examples: ['Public infrastructure projects', 'Government service contracts', 'Policy consulting']
      });
    } else if (pillarScores.regulatory >= 60 || pillarScores.legal >= 60) {
      categories.push({
        category: 'Government Contracts & Tenders',
        readiness: 'DEVELOPING',
        requirements: ['Improve regulatory compliance', 'Strengthen legal foundation'],
        examples: ['Smaller government contracts', 'Subcontracting opportunities']
      });
    }

    // Corporate Opportunities
    if (pillarScores.financial >= 70 && pillarScores.human >= 75) {
      categories.push({
        category: 'Corporate Partnerships & Employment',
        readiness: 'HIGH',
        requirements: ['Strong financial foundation', 'Excellent productivity'],
        examples: ['Executive positions', 'Strategic partnerships', 'Board appointments']
      });
    } else if (pillarScores.financial >= 50 || pillarScores.human >= 60) {
      categories.push({
        category: 'Corporate Partnerships & Employment',
        readiness: 'DEVELOPING',
        requirements: ['Build financial stability', 'Optimize personal productivity'],
        examples: ['Management roles', 'Consulting opportunities', 'Professional services']
      });
    }

    // International Opportunities
    const internationalReadiness = (pillarScores.legal + pillarScores.regulatory + pillarScores.financial) / 3;
    if (internationalReadiness >= 75) {
      categories.push({
        category: 'International Business & Investment',
        readiness: 'HIGH',
        requirements: ['Comprehensive compliance', 'Strong legal & financial foundation'],
        examples: ['International partnerships', 'Cross-border investments', 'Global consulting']
      });
    } else if (internationalReadiness >= 60) {
      categories.push({
        category: 'International Business & Investment',
        readiness: 'DEVELOPING',
        requirements: ['Strengthen international compliance', 'Build global network'],
        examples: ['Regional partnerships', 'Export/import opportunities']
      });
    }

    return categories;
  }

  // Prioritize next actions based on impact and effort
  prioritizeNextActions(gapAnalysis) {
    const actions = [];

    // Immediate critical actions (high impact, urgent)
    gapAnalysis.criticalGaps.forEach(gap => {
      actions.push({
        action: `Address critical ${gap.name} deficiency`,
        impact: 'HIGH',
        effort: 'HIGH',
        urgency: 'CRITICAL',
        timeline: '1-2 weeks',
        pillar: gap.key,
        expectedGain: `+${Math.min(20, 60 - gap.score)} points`
      });
    });

    // Quick wins (high impact, low effort)
    gapAnalysis.improvementOpportunities
      .filter(opp => opp.potential >= 15)
      .forEach(opp => {
        actions.push({
          action: `Optimize ${opp.name} processes`,
          impact: 'MEDIUM',
          effort: 'LOW',
          urgency: 'MEDIUM',
          timeline: '2-4 weeks',
          pillar: opp.key,
          expectedGain: `+${Math.min(15, opp.potential)} points`
        });
      });

    // Sort by priority score (impact/effort ratio × urgency multiplier)
    return actions
      .map(action => ({
        ...action,
        priorityScore: this.calculateActionPriority(action)
      }))
      .sort((a, b) => b.priorityScore - a.priorityScore)
      .slice(0, 5); // Top 5 actions
  }

  // Calculate action priority score
  calculateActionPriority(action) {
    const impactScores = { HIGH: 3, MEDIUM: 2, LOW: 1 };
    const effortScores = { LOW: 3, MEDIUM: 2, HIGH: 1 }; // Lower effort = higher score
    const urgencyMultipliers = { CRITICAL: 2, HIGH: 1.5, MEDIUM: 1.2, LOW: 1 };

    const impact = impactScores[action.impact] || 1;
    const effort = effortScores[action.effort] || 1;
    const urgencyMultiplier = urgencyMultipliers[action.urgency] || 1;

    return (impact * effort * urgencyMultiplier);
  }

  // Get pillar display names
  getPillarDisplayName(key) {
    const names = {
      financial: 'Financial Capital',
      legal: 'Legal Resilience',
      regulatory: 'Regulatory Compliance',
      human: 'Human Capital',
      integrity: 'Integrity Foundation'
    };
    return names[key] || key;
  }

  // Calculate expiry date for IOR score
  calculateExpiryDate() {
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + 30); // Valid for 30 days
    return expiryDate.toISOString();
  }

  // Get default IOR for error cases
  getDefaultIOR() {
    return {
      overallScore: 50,
      pillarScores: {
        financial: 50,
        legal: 50,
        regulatory: 50,
        human: 50,
        integrity: 75
      },
      gapAnalysis: {
        lowestPillar: { name: 'Unknown', score: 50, key: 'unknown' },
        highestPillar: { name: 'Integrity Foundation', score: 75, key: 'integrity' },
        criticalGaps: [],
        improvementOpportunities: [],
        scoreDistribution: { excellent: 0, good: 0, acceptable: 5, needsWork: 0 }
      },
      readinessLevel: {
        level: 'DEVELOPING',
        description: 'Building readiness - data collection needed',
        color: 'gray',
        opportunities: ['Assessment required']
      },
      confidence: { percentage: 30, level: 'LOW' },
      recommendations: [{
        priority: 'HIGH',
        pillar: 'All Pillars',
        issue: 'Insufficient data for accurate assessment',
        actions: ['Complete pillar assessments', 'Input current status data'],
        timeline: '1 week',
        impact: 'HIGH'
      }],
      opportunityCategories: [],
      nextActions: [{
        action: 'Complete comprehensive assessment',
        impact: 'HIGH',
        effort: 'MEDIUM',
        urgency: 'HIGH',
        timeline: '1 week',
        pillar: 'all',
        expectedGain: 'Accurate IOR calculation'
      }],
      calculatedAt: new Date().toISOString(),
      validUntil: this.calculateExpiryDate()
    };
  }

  // Generate IOR trend analysis (when historical data available)
  calculateTrend(currentIOR, historicalIORs = []) {
    if (historicalIORs.length === 0) {
      return {
        direction: 'STABLE',
        velocity: 0,
        confidence: 0,
        prediction: null
      };
    }

    const recent = historicalIORs.slice(-3); // Last 3 calculations
    if (recent.length < 2) {
      return {
        direction: 'INSUFFICIENT_DATA',
        velocity: 0,
        confidence: 0,
        prediction: null
      };
    }

    // Calculate trend direction and velocity
    const changes = [];
    for (let i = 1; i < recent.length; i++) {
      changes.push(recent[i].overallScore - recent[i-1].overallScore);
    }

    const avgChange = changes.reduce((sum, change) => sum + change, 0) / changes.length;
    const direction = avgChange > 2 ? 'IMPROVING' : avgChange < -2 ? 'DECLINING' : 'STABLE';
    
    // Predict next score based on trend
    const prediction = Math.max(0, Math.min(100, currentIOR.overallScore + avgChange));

    return {
      direction,
      velocity: Math.abs(avgChange),
      confidence: this.calculateTrendConfidence(changes),
      prediction: Math.round(prediction),
      timeframe: '30 days'
    };
  }

  // Calculate trend confidence based on consistency
  calculateTrendConfidence(changes) {
    if (changes.length < 2) return 0;
    
    const variance = changes.reduce((sum, change, index, arr) => {
      const mean = arr.reduce((s, c) => s + c, 0) / arr.length;
      return sum + Math.pow(change - mean, 2);
    }, 0) / changes.length;

    // Lower variance = higher confidence
    return Math.max(0, Math.min(100, 100 - (variance * 10)));
  }
}

// Factory function to create IOR calculator
export const createIORCalculator = () => {
  return new IORCalculator();
};

export default IORCalculator;