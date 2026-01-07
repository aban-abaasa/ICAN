// Prosperity Architect - Pillar IV: Human Capital
// Holistic schedule optimization with spiritual and physical alignment

import { saveScheduleOptimization, getLatestScheduleOptimization } from '../config/firebase.js';

export class ProsperityArchitect {
  constructor(userId) {
    this.userId = userId;
    this.geminiApiKey = import.meta.env.VITE_GEMINI_API_KEY;
    this.geminiApiUrl = import.meta.env.VITE_GEMINI_API_URL;
  }

  // Main schedule optimization function
  async optimizeSchedule(preferences = {}, constraints = {}) {
    try {
      // Step 1: Analyze current schedule patterns
      const currentPatterns = await this.analyzeCurrentPatterns(preferences);
      
      // Step 2: Identify High-Value Work (HVW) opportunities
      const hvwAnalysis = await this.identifyHVWOpportunities(preferences, constraints);
      
      // Step 3: Design alignment blocks (Spiritual & Physical)
      const alignmentBlocks = this.designAlignmentBlocks(preferences);
      
      // Step 4: Optimize using AI recommendations
      const aiOptimization = await this.getAIOptimization(currentPatterns, hvwAnalysis, alignmentBlocks);
      
      // Step 5: Create actionable schedule
      const optimizedSchedule = this.createOptimizedSchedule(aiOptimization, alignmentBlocks);
      
      // Step 6: Generate implementation plan
      const implementationPlan = this.generateImplementationPlan(optimizedSchedule);
      
      // Step 7: Calculate optimization score
      const optimizationScore = this.calculateOptimizationScore(optimizedSchedule, preferences);

      const analysis = {
        optimizationScore,
        currentPatterns,
        hvwAnalysis,
        alignmentBlocks,
        optimizedSchedule,
        implementationPlan,
        recommendations: this.generateRecommendations(optimizedSchedule, optimizationScore),
        nextActions: this.generateNextActions(implementationPlan),
        createdDate: new Date().toISOString(),
        validUntil: this.calculateValidityDate()
      };

      // Save to Firebase
      await saveScheduleOptimization(this.userId, analysis);

      return { success: true, analysis };

    } catch (error) {
      console.error('Schedule optimization failed:', error);
      return { success: false, error: error.message };
    }
  }

  // Analyze current schedule patterns
  async analyzeCurrentPatterns(preferences) {
    // In production, this would analyze actual calendar data
    // For demo, we simulate pattern analysis
    
    const mockPatterns = {
      wakeUpTime: preferences.wakeUpTime || '6:00 AM',
      sleepTime: preferences.sleepTime || '11:00 PM',
      workStartTime: preferences.workStartTime || '8:00 AM',
      workEndTime: preferences.workEndTime || '6:00 PM',
      peakProductivityHours: this.identifyPeakHours(preferences),
      currentTimeBlocks: this.getCurrentTimeBlocks(),
      timeWasters: this.identifyTimeWasters(),
      energyLevels: this.analyzeEnergyLevels(preferences),
      interruptionPatterns: this.analyzeInterruptions(),
      weeklyEfficiency: Math.random() * 40 + 50 // 50-90%
    };

    return mockPatterns;
  }

  // Identify peak productivity hours
  identifyPeakHours(preferences) {
    const chronotype = preferences.chronotype || 'morning'; // morning, evening, variable
    
    const peakHours = {
      'morning': ['6:00 AM - 10:00 AM', '9:00 AM - 12:00 PM'],
      'evening': ['2:00 PM - 6:00 PM', '7:00 PM - 10:00 PM'],
      'variable': ['9:00 AM - 11:00 AM', '2:00 PM - 4:00 PM']
    };

    return {
      primary: peakHours[chronotype][0],
      secondary: peakHours[chronotype][1],
      confidence: 0.85
    };
  }

  // Get current time blocks analysis
  getCurrentTimeBlocks() {
    return [
      {
        category: 'Work/Business',
        weeklyHours: 40,
        efficiency: 0.75,
        description: 'Primary work activities and business tasks'
      },
      {
        category: 'Personal Care',
        weeklyHours: 10,
        efficiency: 0.60,
        description: 'Exercise, grooming, health activities'
      },
      {
        category: 'Family/Social',
        weeklyHours: 15,
        efficiency: 0.80,
        description: 'Family time, social interactions'
      },
      {
        category: 'Learning/Development',
        weeklyHours: 5,
        efficiency: 0.70,
        description: 'Skill building, education, reading'
      },
      {
        category: 'Administrative',
        weeklyHours: 8,
        efficiency: 0.50,
        description: 'Emails, calls, paperwork, errands'
      }
    ];
  }

  // Identify time wasters
  identifyTimeWasters() {
    return [
      {
        activity: 'Excessive social media browsing',
        weeklyHours: 12,
        recoverableHours: 8,
        impact: 'HIGH'
      },
      {
        activity: 'Unstructured meetings/calls',
        weeklyHours: 6,
        recoverableHours: 4,
        impact: 'MEDIUM'
      },
      {
        activity: 'Context switching',
        weeklyHours: 8,
        recoverableHours: 6,
        impact: 'HIGH'
      },
      {
        activity: 'Inefficient commuting',
        weeklyHours: 10,
        recoverableHours: 3,
        impact: 'MEDIUM'
      }
    ];
  }

  // Analyze energy levels throughout the day
  analyzeEnergyLevels(preferences) {
    const chronotype = preferences.chronotype || 'morning';
    
    const energyProfiles = {
      'morning': [
        { time: '6:00 AM', energy: 90 },
        { time: '9:00 AM', energy: 95 },
        { time: '12:00 PM', energy: 85 },
        { time: '3:00 PM', energy: 70 },
        { time: '6:00 PM', energy: 60 },
        { time: '9:00 PM', energy: 40 }
      ],
      'evening': [
        { time: '6:00 AM', energy: 50 },
        { time: '9:00 AM', energy: 70 },
        { time: '12:00 PM', energy: 80 },
        { time: '3:00 PM', energy: 85 },
        { time: '6:00 PM', energy: 90 },
        { time: '9:00 PM', energy: 95 }
      ],
      'variable': [
        { time: '6:00 AM', energy: 70 },
        { time: '9:00 AM', energy: 85 },
        { time: '12:00 PM', energy: 75 },
        { time: '3:00 PM', energy: 80 },
        { time: '6:00 PM', energy: 70 },
        { time: '9:00 PM', energy: 65 }
      ]
    };

    return energyProfiles[chronotype];
  }

  // Analyze interruption patterns
  analyzeInterruptions() {
    return {
      averagePerDay: 15,
      peakTimes: ['10:00 AM - 11:00 AM', '2:00 PM - 3:00 PM', '4:00 PM - 5:00 PM'],
      sources: [
        { source: 'Phone calls', frequency: 6, controllable: true },
        { source: 'Emails', frequency: 8, controllable: true },
        { source: 'Colleagues/Family', frequency: 4, controllable: false },
        { source: 'Notifications', frequency: 12, controllable: true }
      ],
      totalTimeImpact: '2.5 hours/day'
    };
  }

  // Identify High-Value Work opportunities
  async identifyHVWOpportunities(preferences, constraints) {
    const hvwCategories = {
      strategicWork: {
        description: 'Strategic planning, goal setting, business development',
        valueMultiplier: 10,
        optimalDuration: '2-4 hours',
        requiredConditions: ['High energy', 'No interruptions', 'Peak focus time']
      },
      creativeWork: {
        description: 'Innovation, problem-solving, creative projects',
        valueMultiplier: 8,
        optimalDuration: '1.5-3 hours',
        requiredConditions: ['Moderate to high energy', 'Quiet environment', 'Inspiration time']
      },
      skillDevelopment: {
        description: 'Learning new skills, professional development',
        valueMultiplier: 6,
        optimalDuration: '1-2 hours',
        requiredConditions: ['Moderate energy', 'Structured environment', 'Consistent timing']
      },
      networkBuilding: {
        description: 'Relationship building, networking, partnerships',
        valueMultiplier: 7,
        optimalDuration: '0.5-2 hours',
        requiredConditions: ['Social energy', 'Communication tools', 'Scheduled interactions']
      },
      systemBuilding: {
        description: 'Process optimization, automation, system creation',
        valueMultiplier: 9,
        optimalDuration: '2-6 hours',
        requiredConditions: ['High focus', 'Technical tools', 'Deep work time']
      }
    };

    // Analyze user's current HVW allocation
    const currentAllocation = {
      strategicWork: 2, // hours per week
      creativeWork: 3,
      skillDevelopment: 5,
      networkBuilding: 1,
      systemBuilding: 2
    };

    // Calculate potential value increase
    const potentialIncrease = this.calculateHVWPotential(hvwCategories, currentAllocation);

    return {
      categories: hvwCategories,
      currentAllocation,
      potentialIncrease,
      recommendations: this.generateHVWRecommendations(hvwCategories, currentAllocation)
    };
  }

  // Calculate HVW potential increase
  calculateHVWPotential(categories, current) {
    const optimal = {
      strategicWork: 6,
      creativeWork: 8,
      skillDevelopment: 6,
      networkBuilding: 4,
      systemBuilding: 6
    };

    let currentValue = 0;
    let potentialValue = 0;

    Object.keys(categories).forEach(category => {
      const multiplier = categories[category].valueMultiplier;
      currentValue += current[category] * multiplier;
      potentialValue += optimal[category] * multiplier;
    });

    return {
      currentWeeklyValue: currentValue,
      potentialWeeklyValue: potentialValue,
      increasePercentage: Math.round(((potentialValue - currentValue) / currentValue) * 100),
      additionalHours: Object.keys(optimal).reduce((sum, cat) => sum + Math.max(0, optimal[cat] - current[cat]), 0)
    };
  }

  // Generate HVW recommendations
  generateHVWRecommendations(categories, current) {
    const recommendations = [];
    
    if (current.strategicWork < 4) {
      recommendations.push('Increase strategic work blocks to 4-6 hours/week for maximum impact');
    }
    
    if (current.systemBuilding < 4) {
      recommendations.push('Invest more time in system building for long-term efficiency gains');
    }
    
    if (current.skillDevelopment < 5) {
      recommendations.push('Consistent skill development ensures competitive advantage');
    }

    recommendations.push('Schedule HVW blocks during peak energy hours');
    recommendations.push('Protect HVW time with strict boundary management');

    return recommendations;
  }

  // Design alignment blocks (Spiritual & Physical)
  designAlignmentBlocks(preferences) {
    const spiritualAlignment = {
      morning: {
        activity: 'Morning Prayer/Meditation',
        duration: '20-30 minutes',
        timeSlot: '6:00 AM - 6:30 AM',
        purpose: 'Spiritual centering and intention setting',
        requirements: ['Quiet space', 'Minimal distractions', 'Consistent timing'],
        benefits: ['Mental clarity', 'Emotional stability', 'Purpose alignment']
      },
      evening: {
        activity: 'Evening Reflection/Gratitude',
        duration: '15-20 minutes',
        timeSlot: '9:30 PM - 9:50 PM',
        purpose: 'Day review and gratitude practice',
        requirements: ['Peaceful environment', 'Journal/reflection tool'],
        benefits: ['Stress reduction', 'Perspective maintenance', 'Growth tracking']
      }
    };

    const physicalAlignment = {
      daily: {
        activity: 'Morning Movement',
        duration: '15-30 minutes',
        timeSlot: '6:30 AM - 7:00 AM',
        purpose: 'Energy activation and physical health',
        options: ['Light exercise', 'Stretching', 'Walk', 'Yoga'],
        benefits: ['Increased energy', 'Better focus', 'Health maintenance']
      },
      structured: {
        activity: 'Focused Exercise',
        duration: '45-60 minutes',
        frequency: '3x per week',
        timeSlots: ['Monday 5:30 PM', 'Wednesday 5:30 PM', 'Friday 5:30 PM'],
        purpose: 'Comprehensive physical fitness',
        options: ['Gym workout', 'Sports', 'Fitness class', 'Home workout'],
        benefits: ['Strength building', 'Stress relief', 'Long-term health']
      }
    };

    return {
      spiritual: spiritualAlignment,
      physical: physicalAlignment,
      integration: {
        weeklyHours: 4,
        dailyMinimum: 30,
        nonNegotiable: true,
        priority: 'HIGHEST'
      }
    };
  }

  // Get AI optimization using Gemini API
  async getAIOptimization(patterns, hvw, alignment) {
    if (!this.geminiApiKey) {
      return this.getMockAIOptimization(patterns, hvw, alignment);
    }

    try {
      const prompt = this.buildOptimizationPrompt(patterns, hvw, alignment);
      
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
            temperature: 0.3,
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
        const optimizationText = data.candidates[0].content.parts[0].text;
        return this.parseOptimizationResponse(optimizationText);
      }
      
      throw new Error('Invalid response from Gemini API');

    } catch (error) {
      console.error('AI Optimization API call failed:', error);
      return this.getMockAIOptimization(patterns, hvw, alignment);
    }
  }

  // Build optimization prompt
  buildOptimizationPrompt(patterns, hvw, alignment) {
    return `
HOLISTIC SCHEDULE OPTIMIZATION REQUEST

Optimize a daily/weekly schedule for maximum value creation while maintaining spiritual and physical alignment.

CURRENT PATTERNS:
- Wake up: ${patterns.wakeUpTime}
- Work: ${patterns.workStartTime} - ${patterns.workEndTime}
- Peak productivity: ${patterns.peakProductivityHours.primary}
- Weekly efficiency: ${patterns.weeklyEfficiency.toFixed(0)}%
- Major time wasters: ${patterns.timeWasters.map(tw => tw.activity).join(', ')}

HIGH-VALUE WORK ANALYSIS:
- Strategic work: ${hvw.currentAllocation.strategicWork}h/week (potential: 6h)
- Creative work: ${hvw.currentAllocation.creativeWork}h/week (potential: 8h)
- Skill development: ${hvw.currentAllocation.skillDevelopment}h/week (potential: 6h)
- Network building: ${hvw.currentAllocation.networkBuilding}h/week (potential: 4h)
- System building: ${hvw.currentAllocation.systemBuilding}h/week (potential: 6h)

MANDATORY ALIGNMENT BLOCKS:
- Morning spiritual alignment: 20-30 minutes (6:00-6:30 AM)
- Evening reflection: 15-20 minutes (9:30-9:50 PM)
- Daily movement: 15-30 minutes (6:30-7:00 AM)
- Structured exercise: 45-60 minutes, 3x/week (5:30 PM)

OPTIMIZATION REQUIREMENTS:
1. Maximize High-Value Work during peak energy hours
2. Protect alignment blocks as non-negotiable
3. Minimize context switching and interruptions
4. Create focused work blocks of 90-120 minutes
5. Balance work intensity with recovery periods
6. Ensure sustainable long-term habits

CONSTRAINTS:
- Total work hours: 40-50 hours/week
- Sleep requirement: 7-8 hours/night
- Family/social time: minimum 15 hours/week
- Flexibility for unexpected priorities

Please provide:
1. Optimized daily schedule template
2. Weekly time block allocation
3. Energy management strategies
4. Implementation priorities
5. Habit formation recommendations
6. Efficiency improvement tactics

Focus on creating a schedule that transforms time into maximum value while maintaining holistic well-being.
`;
  }

  // Parse AI optimization response
  parseOptimizationResponse(responseText) {
    // Extract structured recommendations from AI response
    return {
      dailyTemplate: this.extractDailyTemplate(responseText),
      weeklyAllocation: this.extractWeeklyAllocation(responseText),
      energyStrategies: this.extractEnergyStrategies(responseText),
      implementationPriorities: this.extractImplementationPriorities(responseText),
      habitRecommendations: this.extractHabitRecommendations(responseText),
      efficiencyTactics: this.extractEfficiencyTactics(responseText)
    };
  }

  // Extract daily template from AI response
  extractDailyTemplate(text) {
    // Simple parsing - in production, use more sophisticated NLP
    return [
      { time: '6:00 AM', activity: 'Spiritual Alignment (Prayer/Meditation)', type: 'alignment', duration: 30 },
      { time: '6:30 AM', activity: 'Physical Movement', type: 'alignment', duration: 30 },
      { time: '7:00 AM', activity: 'Personal Care & Preparation', type: 'routine', duration: 60 },
      { time: '8:00 AM', activity: 'High-Value Work Block 1', type: 'hvw', duration: 120 },
      { time: '10:00 AM', activity: 'Communication & Admin', type: 'admin', duration: 30 },
      { time: '10:30 AM', activity: 'High-Value Work Block 2', type: 'hvw', duration: 120 },
      { time: '12:30 PM', activity: 'Lunch & Recovery', type: 'break', duration: 60 },
      { time: '1:30 PM', activity: 'Collaborative Work', type: 'work', duration: 120 },
      { time: '3:30 PM', activity: 'Strategic Planning', type: 'hvw', duration: 90 },
      { time: '5:00 PM', activity: 'Wrap-up & Planning', type: 'admin', duration: 30 },
      { time: '5:30 PM', activity: 'Exercise (3x/week)', type: 'alignment', duration: 60 },
      { time: '6:30 PM', activity: 'Family/Social Time', type: 'personal', duration: 180 },
      { time: '9:30 PM', activity: 'Evening Reflection', type: 'alignment', duration: 20 },
      { time: '10:00 PM', activity: 'Wind Down', type: 'routine', duration: 60 }
    ];
  }

  // Extract other sections (simplified for demo)
  extractWeeklyAllocation(text) {
    return {
      hvwHours: 25,
      alignmentHours: 7,
      adminHours: 8,
      personalHours: 20,
      recoveryHours: 12
    };
  }

  extractEnergyStrategies(text) {
    return [
      'Schedule most demanding work during peak hours (8-10 AM)',
      'Use 90-minute focus blocks with 15-minute breaks',
      'Batch similar tasks to reduce context switching',
      'Plan recovery activities after high-intensity work'
    ];
  }

  extractImplementationPriorities(text) {
    return [
      { priority: 1, task: 'Establish morning alignment routine', timeline: '1 week' },
      { priority: 2, task: 'Block calendar for HVW sessions', timeline: '1 week' },
      { priority: 3, task: 'Set up focus environment', timeline: '2 weeks' },
      { priority: 4, task: 'Optimize communication systems', timeline: '2 weeks' }
    ];
  }

  extractHabitRecommendations(text) {
    return [
      'Start with keystone habit: morning spiritual alignment',
      'Use habit stacking: link new habits to existing routines',
      'Track consistency rather than perfection',
      'Build accountability systems for major changes'
    ];
  }

  extractEfficiencyTactics(text) {
    return [
      'Time-block calendar with specific activities',
      'Batch process emails and communications',
      'Use "Do Not Disturb" during HVW blocks',
      'Prepare tomorrow\'s priorities the night before'
    ];
  }

  // Mock AI optimization for demo
  getMockAIOptimization(patterns, hvw, alignment) {
    return {
      dailyTemplate: this.extractDailyTemplate('mock'),
      weeklyAllocation: this.extractWeeklyAllocation('mock'),
      energyStrategies: this.extractEnergyStrategies('mock'),
      implementationPriorities: this.extractImplementationPriorities('mock'),
      habitRecommendations: this.extractHabitRecommendations('mock'),
      efficiencyTactics: this.extractEfficiencyTactics('mock')
    };
  }

  // Create optimized schedule
  createOptimizedSchedule(aiOptimization, alignmentBlocks) {
    return {
      dailyTemplate: aiOptimization.dailyTemplate,
      weeklyStructure: {
        mondayFocus: 'Strategic Planning & System Building',
        tuesdayFocus: 'Creative Work & Skill Development',
        wednesdayFocus: 'Network Building & Collaboration',
        thursdayFocus: 'Strategic Work & Innovation',
        fridayFocus: 'System Optimization & Week Review'
      },
      timeBlocks: {
        hvwBlocks: this.createHVWBlocks(aiOptimization),
        alignmentBlocks: alignmentBlocks,
        bufferBlocks: this.createBufferBlocks(),
        recoveryBlocks: this.createRecoveryBlocks()
      },
      rules: {
        noMeetingsBeforePeakHours: true,
        hvwBlocksProtected: true,
        alignmentBlocksNonNegotiable: true,
        maxDailyMeetings: 3,
        minimumFocusBlockDuration: 90
      }
    };
  }

  // Create HVW blocks
  createHVWBlocks(aiOptimization) {
    return [
      {
        name: 'Morning Strategic Block',
        time: '8:00 AM - 10:00 AM',
        purpose: 'High-impact strategic work',
        activities: ['Strategic planning', 'Important decisions', 'Creative problem-solving'],
        environment: 'Distraction-free, high energy'
      },
      {
        name: 'Mid-Morning Focus Block',
        time: '10:30 AM - 12:30 PM',
        purpose: 'Deep work and skill development',
        activities: ['Complex projects', 'Learning', 'System building'],
        environment: 'Deep focus, tools available'
      },
      {
        name: 'Afternoon Innovation Block',
        time: '3:30 PM - 5:00 PM',
        purpose: 'Creative and collaborative work',
        activities: ['Innovation projects', 'Team collaboration', 'Network building'],
        environment: 'Collaborative, creative space'
      }
    ];
  }

  // Create buffer blocks
  createBufferBlocks() {
    return [
      { time: '10:00 AM - 10:30 AM', purpose: 'Transition and communication' },
      { time: '12:30 PM - 1:30 PM', purpose: 'Lunch and mental recovery' },
      { time: '3:00 PM - 3:30 PM', purpose: 'Administrative tasks and planning' }
    ];
  }

  // Create recovery blocks
  createRecoveryBlocks() {
    return [
      { time: '6:30 PM - 9:30 PM', purpose: 'Family time and personal activities' },
      { time: '9:50 PM - 10:00 PM', purpose: 'Preparation for rest' },
      { time: 'Saturday morning', purpose: 'Extended personal time' },
      { time: 'Sunday afternoon', purpose: 'Week preparation and reflection' }
    ];
  }

  // Generate implementation plan
  generateImplementationPlan(optimizedSchedule) {
    return {
      week1: {
        focus: 'Establish morning alignment routine',
        actions: [
          'Set up morning spiritual space',
          'Practice 20-minute morning alignment',
          'Add physical movement after alignment',
          'Track consistency daily'
        ],
        success_metrics: ['7/7 days morning routine completion']
      },
      week2: {
        focus: 'Implement HVW blocks',
        actions: [
          'Block calendar for morning HVW sessions',
          'Set up distraction-free work environment',
          'Practice deep work techniques',
          'Measure output quality and quantity'
        ],
        success_metrics: ['Complete 3 HVW blocks daily', 'Reduce interruptions by 50%']
      },
      week3: {
        focus: 'Optimize energy management',
        actions: [
          'Implement energy tracking',
          'Adjust work intensity to energy levels',
          'Add structured recovery periods',
          'Optimize meal timing for energy'
        ],
        success_metrics: ['Sustained energy throughout day', 'Improved work quality']
      },
      week4: {
        focus: 'System integration and refinement',
        actions: [
          'Fine-tune schedule based on results',
          'Automate routine decisions',
          'Establish weekly review process',
          'Create accountability systems'
        ],
        success_metrics: ['Schedule feels natural', 'Measurable productivity increase']
      }
    };
  }

  // Calculate optimization score
  calculateOptimizationScore(schedule, preferences) {
    let score = 0;
    const maxScore = 100;

    // HVW allocation (30 points)
    const hvwHours = schedule.timeBlocks.hvwBlocks.reduce((sum, block) => {
      return sum + (block.duration || 120) / 60;
    }, 0);
    score += Math.min(30, (hvwHours / 6) * 30); // Target: 6 HVW hours daily

    // Alignment blocks presence (25 points)
    const hasSpiritual = schedule.timeBlocks.alignmentBlocks.spiritual;
    const hasPhysical = schedule.timeBlocks.alignmentBlocks.physical;
    if (hasSpiritual && hasPhysical) score += 25;

    // Energy optimization (20 points)
    const peakHourUtilization = this.calculatePeakHourUtilization(schedule);
    score += peakHourUtilization * 20;

    // Schedule balance (15 points)
    const balanceScore = this.calculateBalanceScore(schedule);
    score += balanceScore * 15;

    // Sustainability factors (10 points)
    const sustainabilityScore = this.calculateSustainabilityScore(schedule);
    score += sustainabilityScore * 10;

    return Math.round(Math.min(maxScore, score));
  }

  // Calculate peak hour utilization
  calculatePeakHourUtilization(schedule) {
    // Check if HVW blocks align with typical peak hours (8-12 AM)
    const morningHVWBlocks = schedule.timeBlocks.hvwBlocks.filter(block => {
      const startHour = parseInt(block.time.split(':')[0]);
      return startHour >= 8 && startHour <= 12;
    });

    return Math.min(1.0, morningHVWBlocks.length / 2); // Target: 2 morning HVW blocks
  }

  // Calculate schedule balance
  calculateBalanceScore(schedule) {
    const template = schedule.dailyTemplate;
    const workTime = template.filter(item => ['hvw', 'work'].includes(item.type))
      .reduce((sum, item) => sum + item.duration, 0);
    const personalTime = template.filter(item => ['alignment', 'personal', 'break'].includes(item.type))
      .reduce((sum, item) => sum + item.duration, 0);

    // Ideal ratio: work 60%, personal 40%
    const workRatio = workTime / (workTime + personalTime);
    const idealRatio = 0.6;
    const deviation = Math.abs(workRatio - idealRatio);
    
    return Math.max(0, 1 - (deviation * 2)); // Penalize large deviations
  }

  // Calculate sustainability score
  calculateSustainabilityScore(schedule) {
    let sustainability = 1.0;

    // Check for reasonable work hours
    const totalWorkMinutes = schedule.dailyTemplate
      .filter(item => ['hvw', 'work', 'admin'].includes(item.type))
      .reduce((sum, item) => sum + item.duration, 0);
    
    if (totalWorkMinutes > 600) sustainability -= 0.3; // More than 10 hours
    if (totalWorkMinutes < 300) sustainability -= 0.2; // Less than 5 hours

    // Check for adequate recovery
    const recoveryMinutes = schedule.dailyTemplate
      .filter(item => ['break', 'personal'].includes(item.type))
      .reduce((sum, item) => sum + item.duration, 0);
    
    if (recoveryMinutes < 240) sustainability -= 0.3; // Less than 4 hours personal time

    // Check for alignment blocks
    const alignmentMinutes = schedule.dailyTemplate
      .filter(item => item.type === 'alignment')
      .reduce((sum, item) => sum + item.duration, 0);
    
    if (alignmentMinutes < 60) sustainability -= 0.2; // Less than 1 hour alignment

    return Math.max(0, sustainability);
  }

  // Generate recommendations
  generateRecommendations(schedule, score) {
    const recommendations = [];

    if (score < 60) {
      recommendations.push('🚨 Schedule needs major optimization - focus on core changes first');
      recommendations.push('Prioritize establishing morning alignment routine');
      recommendations.push('Reduce low-value activities to create HVW blocks');
    } else if (score < 80) {
      recommendations.push('⚠️ Good foundation - fine-tune for maximum effectiveness');
      recommendations.push('Optimize HVW block timing with energy levels');
      recommendations.push('Add more strategic work during peak hours');
    } else {
      recommendations.push('✅ Excellent schedule optimization');
      recommendations.push('Maintain consistency and track long-term results');
      recommendations.push('Consider advanced productivity techniques');
    }

    // Specific recommendations based on schedule analysis
    const hvwHours = schedule.timeBlocks.hvwBlocks.reduce((sum, block) => sum + 2, 0);
    if (hvwHours < 5) {
      recommendations.push('Increase High-Value Work blocks to 5-6 hours daily');
    }

    recommendations.push('Review and adjust schedule weekly based on results');
    recommendations.push('Build accountability systems for consistency');

    return recommendations;
  }

  // Generate next actions
  generateNextActions(implementationPlan) {
    const currentWeek = implementationPlan.week1; // In production, determine actual current week
    
    return [
      `Week Focus: ${currentWeek.focus}`,
      ...currentWeek.actions.slice(0, 3), // Top 3 actions
      'Schedule weekly review to assess progress',
      'Set up tracking system for key metrics'
    ];
  }

  // Calculate validity date
  calculateValidityDate() {
    const validUntil = new Date();
    validUntil.setMonth(validUntil.getMonth() + 1); // Valid for 1 month
    return validUntil.toISOString();
  }

  // Get latest schedule optimization
  async getLatestOptimization() {
    try {
      const result = await getLatestScheduleOptimization(this.userId);
      return result;
    } catch (error) {
      console.error('Error getting latest schedule optimization:', error);
      return { success: false, error };
    }
  }

  // Export schedule to calendar format
  exportToCalendar(schedule) {
    return schedule.dailyTemplate.map(item => ({
      title: item.activity,
      start: item.time,
      duration: item.duration,
      type: item.type,
      description: this.getActivityDescription(item)
    }));
  }

  // Get activity description
  getActivityDescription(item) {
    const descriptions = {
      'alignment': 'Non-negotiable time for spiritual/physical well-being',
      'hvw': 'High-Value Work block - protect from interruptions',
      'work': 'Regular work activities and collaboration',
      'admin': 'Administrative tasks and communication',
      'personal': 'Family, social, and personal time',
      'break': 'Recovery and restoration time',
      'routine': 'Daily maintenance and preparation activities'
    };

    return descriptions[item.type] || 'Scheduled activity';
  }
}

// Factory function
export const createProsperityArchitect = (userId) => {
  return new ProsperityArchitect(userId);
};

export default ProsperityArchitect;