// Schedule Optimizer API Route - Pillar IV: Human Capital
import express from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';

const router = express.Router();

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

router.post('/', async (req, res) => {
  try {
    const { 
      preferences = {}, 
      constraints = {}, 
      currentSchedule = {},
      goals = {},
      workStyle = 'hybrid'
    } = req.body;

    // Validate basic inputs
    if (!preferences.wakeUpTime) {
      preferences.wakeUpTime = '6:00 AM';
    }
    if (!preferences.sleepTime) {
      preferences.sleepTime = '10:00 PM';
    }

    // Security audit log
    const auditLog = {
      userId: req.user.id,
      action: 'SCHEDULE_OPTIMIZATION_REQUEST',
      timestamp: new Date().toISOString(),
      workStyle,
      ipAddress: req.ip
    };

    console.log('[PRODUCTIVITY AUDIT]', auditLog);

    // Build optimization prompt
    const optimizationPrompt = buildScheduleOptimizationPrompt(
      preferences, 
      constraints, 
      currentSchedule, 
      goals, 
      workStyle
    );

    // Get Gemini AI optimization
    const model = genAI.getGenerativeModel({ model: "gemini-pro" });
    
    const result = await model.generateContent({
      contents: [{ parts: [{ text: optimizationPrompt }] }],
      generationConfig: {
        temperature: 0.3,
        topK: 40,
        topP: 0.95,
        maxOutputTokens: 2048,
      }
    });

    const optimizationText = result.response.text();

    // Parse and structure the optimization
    const optimization = parseScheduleOptimization(optimizationText, preferences, workStyle);

    // Create detailed schedule blocks
    const scheduleBlocks = createOptimizedScheduleBlocks(optimization, preferences);

    // Generate implementation plan
    const implementationPlan = generateImplementationPlan(optimization, scheduleBlocks);

    // Calculate optimization score
    const optimizationScore = calculateOptimizationScore(scheduleBlocks, preferences, goals);

    // Generate holistic recommendations
    const recommendations = generateHolisticRecommendations(optimization, optimizationScore);

    // Create next actions
    const nextActions = generateNextActions(implementationPlan);

    // Prepare response
    const response = {
      success: true,
      optimization: {
        optimizationScore,
        scheduleBlocks,
        recommendations,
        nextActions,
        implementationPlan,
        alignmentBlocks: optimization.alignmentBlocks,
        hvwBlocks: optimization.hvwBlocks,
        energyOptimization: optimization.energyOptimization,
        productivityInsights: optimization.productivityInsights,
        balanceMetrics: calculateBalanceMetrics(scheduleBlocks),
        analysisId: generateAnalysisId(),
        timestamp: new Date().toISOString(),
        validUntil: calculateValidityDate(),
        confidence: optimization.confidence
      },
      metadata: {
        processingTime: Date.now() - new Date(auditLog.timestamp).getTime(),
        aiModel: 'gemini-pro',
        version: '1.0.0',
        optimizationApproach: 'holistic_human_capital'
      }
    };

    res.json(response);

  } catch (error) {
    console.error('Schedule optimization error:', error);
    
    res.status(500).json({
      success: false,
      error: {
        message: 'Schedule optimization failed',
        code: 'OPTIMIZATION_ERROR',
        timestamp: new Date().toISOString()
      }
    });
  }
});

// Build comprehensive schedule optimization prompt
function buildScheduleOptimizationPrompt(preferences, constraints, currentSchedule, goals, workStyle) {
  return `
HOLISTIC SCHEDULE OPTIMIZATION REQUEST
Professional Productivity & Life Integration Analysis

OPTIMIZATION DATE: ${new Date().toLocaleDateString()}
WORK STYLE: ${workStyle}
OBJECTIVE: Maximum value creation with spiritual and physical alignment

CURRENT PROFILE:
- Wake up time: ${preferences.wakeUpTime || '6:00 AM'}
- Sleep time: ${preferences.sleepTime || '10:00 PM'}
- Work start: ${preferences.workStartTime || '8:00 AM'}
- Work end: ${preferences.workEndTime || '6:00 PM'}
- Chronotype: ${preferences.chronotype || 'morning'}
- Energy patterns: ${preferences.energyPatterns || 'morning peak'}
- Focus preference: ${preferences.focusPreference || '90-minute blocks'}

CURRENT SCHEDULE ANALYSIS:
${JSON.stringify(currentSchedule, null, 2)}

CONSTRAINTS:
- Total work hours: ${constraints.maxWorkHours || 45} hours/week maximum
- Family time: ${constraints.minFamilyTime || 15} hours/week minimum  
- Commute time: ${constraints.commuteTime || '1 hour daily'}
- Fixed commitments: ${JSON.stringify(constraints.fixedCommitments || [])}
- Energy limitations: ${constraints.energyLimitations || 'Standard'}

GOALS AND PRIORITIES:
- Primary goal: ${goals.primary || 'Increase productivity and value creation'}
- Secondary goals: ${JSON.stringify(goals.secondary || [])}
- Target net worth: ${goals.targetNetWorth || 'Not specified'}
- Career objective: ${goals.careerObjective || 'Professional growth'}

MANDATORY REQUIREMENTS (NON-NEGOTIABLE):

1. SPIRITUAL ALIGNMENT BLOCKS:
   - Morning spiritual practice: 20-30 minutes daily (prayer/meditation/reflection)
   - Evening gratitude/reflection: 15-20 minutes daily
   - Purpose: Spiritual centering, intention setting, stress reduction
   - Timing: Must align with natural energy patterns

2. PHYSICAL ALIGNMENT BLOCKS:
   - Daily movement: 15-30 minutes (morning preferred)
   - Structured exercise: 45-60 minutes, 3x per week
   - Purpose: Energy activation, health maintenance, stress relief
   - Integration: Should complement, not compete with work energy

3. HIGH-VALUE WORK (HVW) OPTIMIZATION:
   - Strategic work blocks: 4-6 hours/week
   - Creative/innovative work: 3-5 hours/week  
   - Skill development: 3-4 hours/week
   - Network building: 2-3 hours/week
   - System building: 2-4 hours/week
   - Timing: During peak energy and focus hours

OPTIMIZATION REQUIREMENTS:

1. DAILY STRUCTURE OPTIMIZATION:
   Design an optimized daily template that:
   - Maximizes high-value work during peak energy
   - Integrates spiritual and physical alignment seamlessly
   - Minimizes context switching and decision fatigue
   - Creates sustainable rhythms and habits
   - Balances intensity with recovery

2. ENERGY MANAGEMENT:
   - Match task intensity to natural energy rhythms
   - Create energy renewal periods
   - Optimize meal timing for sustained energy
   - Design environment for focus and creativity

3. TIME BLOCK ARCHITECTURE:
   - Create focused work blocks of 90-120 minutes
   - Build in transition buffers
   - Protect alignment blocks as non-negotiable
   - Schedule communication and admin efficiently

4. WEEKLY RHYTHM OPTIMIZATION:
   - Design different daily focuses for variety
   - Balance demanding and lighter days
   - Plan for weekly review and adjustment
   - Create flexibility for unexpected priorities

5. HABIT INTEGRATION STRATEGY:
   - Layer new habits onto existing routines
   - Create keystone habits that trigger other behaviors
   - Design accountability and tracking systems
   - Plan for gradual implementation

Please provide a comprehensive optimization that includes:

1. Optimized daily schedule template with specific time blocks
2. Weekly rhythm with daily themes and focuses  
3. Energy management strategies and meal timing
4. Implementation priorities (Week 1, 2, 3, 4 plan)
5. Habit formation recommendations
6. Productivity system recommendations
7. Balance metrics and success indicators
8. Adjustment protocols for continuous optimization

Focus on creating a schedule that transforms time into maximum value while maintaining holistic well-being and sustainable practices. The goal is professional excellence without sacrificing spiritual, physical, or relational health.
`;
}

// Parse Gemini AI schedule optimization
function parseScheduleOptimization(optimizationText, preferences, workStyle) {
  // Extract key components from the AI response
  const sections = splitIntoSections(optimizationText);
  
  return {
    dailyTemplate: extractDailyTemplate(sections, preferences),
    weeklyRhythm: extractWeeklyRhythm(sections),
    alignmentBlocks: extractAlignmentBlocks(sections),
    hvwBlocks: extractHVWBlocks(sections),
    energyOptimization: extractEnergyStrategies(sections),
    productivityInsights: extractProductivityInsights(sections),
    implementationStrategy: extractImplementationStrategy(sections),
    confidence: calculateOptimizationConfidence(optimizationText, preferences)
  };
}

// Split optimization text into logical sections
function splitIntoSections(text) {
  const sectionHeaders = [
    'daily template', 'daily schedule', 'daily structure',
    'weekly rhythm', 'weekly focus', 'weekly plan',
    'energy management', 'energy strategy',
    'implementation', 'habit formation',
    'productivity', 'system', 'balance'
  ];

  const sections = {};
  
  // Simple section extraction based on headers
  sectionHeaders.forEach(header => {
    const regex = new RegExp(`(${header}[^]*?)(?=${sectionHeaders.join('|')}|$)`, 'i');
    const match = text.match(regex);
    if (match) {
      sections[header.replace(/\s+/g, '_')] = match[1].trim();
    }
  });

  // If no clear sections found, create default structure
  if (Object.keys(sections).length === 0) {
    sections.full_text = text;
  }

  return sections;
}

// Extract daily template from optimization
function extractDailyTemplate(sections, preferences) {
  const template = [
    {
      time: '6:00 AM',
      activity: 'Spiritual Alignment',
      type: 'alignment',
      duration: 30,
      description: 'Morning prayer/meditation/reflection for spiritual centering',
      nonNegotiable: true
    },
    {
      time: '6:30 AM', 
      activity: 'Physical Movement',
      type: 'alignment',
      duration: 30,
      description: 'Light exercise, stretching, or energizing movement',
      nonNegotiable: true
    },
    {
      time: '7:00 AM',
      activity: 'Personal Preparation',
      type: 'routine',
      duration: 60,
      description: 'Personal care, breakfast, day preparation'
    },
    {
      time: '8:00 AM',
      activity: 'High-Value Work Block 1',
      type: 'hvw',
      duration: 120,
      description: 'Strategic work during peak morning energy',
      focus: 'Strategic planning, important decisions, creative work'
    },
    {
      time: '10:00 AM',
      activity: 'Communication & Quick Tasks',
      type: 'admin',
      duration: 30,
      description: 'Email, messages, quick administrative tasks'
    },
    {
      time: '10:30 AM',
      activity: 'High-Value Work Block 2', 
      type: 'hvw',
      duration: 120,
      description: 'Deep work and skill development',
      focus: 'Complex projects, learning, system building'
    },
    {
      time: '12:30 PM',
      activity: 'Lunch & Recovery',
      type: 'break',
      duration: 60,
      description: 'Meal and mental restoration'
    },
    {
      time: '1:30 PM',
      activity: 'Collaborative Work',
      type: 'work',
      duration: 120,
      description: 'Meetings, teamwork, collaborative projects'
    },
    {
      time: '3:30 PM',
      activity: 'High-Value Work Block 3',
      type: 'hvw', 
      duration: 90,
      description: 'Innovation and strategic work',
      focus: 'Creative problem-solving, planning, optimization'
    },
    {
      time: '5:00 PM',
      activity: 'Daily Wrap-up',
      type: 'admin',
      duration: 30,
      description: 'Review day, plan tomorrow, administrative closure'
    },
    {
      time: '5:30 PM',
      activity: 'Structured Exercise',
      type: 'alignment',
      duration: 60,
      description: 'Focused physical training (3x per week)',
      frequency: '3x per week'
    },
    {
      time: '6:30 PM',
      activity: 'Family & Personal Time',
      type: 'personal',
      duration: 180,
      description: 'Family relationships, social connections, personal activities',
      nonNegotiable: true
    },
    {
      time: '9:30 PM',
      activity: 'Evening Reflection',
      type: 'alignment', 
      duration: 20,
      description: 'Gratitude practice, day review, spiritual reflection',
      nonNegotiable: true
    },
    {
      time: '10:00 PM',
      activity: 'Wind Down & Rest Preparation',
      type: 'routine',
      duration: 60,
      description: 'Prepare for restorative sleep'
    }
  ];

  // Adjust template based on preferences
  if (preferences.wakeUpTime) {
    const wakeTime = parseTime(preferences.wakeUpTime);
    template.forEach(block => {
      // Shift all times based on wake time preference
      const blockTime = parseTime(block.time);
      const baseWake = parseTime('6:00 AM');
      const offset = wakeTime - baseWake;
      block.time = formatTime(blockTime + offset);
    });
  }

  return template;
}

// Extract weekly rhythm
function extractWeeklyRhythm(sections) {
  return {
    monday: {
      focus: 'Strategic Planning & System Building',
      energy: 'HIGH', 
      hvwAllocation: 6,
      theme: 'Foundation setting and strategic work'
    },
    tuesday: {
      focus: 'Creative Work & Innovation',
      energy: 'HIGH',
      hvwAllocation: 5,
      theme: 'Creative projects and problem-solving'  
    },
    wednesday: {
      focus: 'Skill Development & Learning',
      energy: 'MEDIUM',
      hvwAllocation: 4,
      theme: 'Growth and capability building'
    },
    thursday: {
      focus: 'Network Building & Collaboration',
      energy: 'MEDIUM',
      hvwAllocation: 4,
      theme: 'Relationships and partnerships'
    },
    friday: {
      focus: 'Optimization & Week Review',
      energy: 'MEDIUM',
      hvwAllocation: 3,
      theme: 'System improvement and reflection'
    },
    saturday: {
      focus: 'Personal Development & Recovery',
      energy: 'LOW',
      hvwAllocation: 1,
      theme: 'Personal time and restoration'
    },
    sunday: {
      focus: 'Planning & Spiritual Alignment',
      energy: 'LOW',
      hvwAllocation: 1,
      theme: 'Week preparation and spiritual focus'
    }
  };
}

// Extract alignment blocks
function extractAlignmentBlocks(sections) {
  return {
    spiritual: {
      morning: {
        time: '6:00 AM - 6:30 AM',
        activity: 'Prayer/Meditation/Reflection',
        purpose: 'Spiritual centering and intention setting',
        nonNegotiable: true
      },
      evening: {
        time: '9:30 PM - 9:50 PM', 
        activity: 'Gratitude and Day Review',
        purpose: 'Reflection and spiritual closure',
        nonNegotiable: true
      }
    },
    physical: {
      daily: {
        time: '6:30 AM - 7:00 AM',
        activity: 'Morning Movement',
        purpose: 'Energy activation and physical wellness'
      },
      structured: {
        time: '5:30 PM - 6:30 PM',
        activity: 'Focused Exercise',
        frequency: '3x per week',
        purpose: 'Comprehensive physical fitness'
      }
    },
    integration: {
      weeklyHours: 7,
      dailyMinimum: 50,
      priority: 'HIGHEST',
      flexibility: 'Times adjustable, commitment non-negotiable'
    }
  };
}

// Extract HVW blocks  
function extractHVWBlocks(sections) {
  return [
    {
      name: 'Morning Strategic Block',
      time: '8:00 AM - 10:00 AM',
      duration: 120,
      type: 'strategic',
      purpose: 'High-impact strategic work during peak energy',
      activities: ['Strategic planning', 'Important decisions', 'Creative problem-solving'],
      environment: 'Distraction-free, high-energy space',
      protection: 'No meetings, calls, or interruptions allowed'
    },
    {
      name: 'Deep Work Block', 
      time: '10:30 AM - 12:30 PM',
      duration: 120,
      type: 'deep_work',
      purpose: 'Complex work requiring sustained focus',
      activities: ['Complex projects', 'Skill development', 'System building'],
      environment: 'Deep focus environment with all tools available'
    },
    {
      name: 'Innovation Block',
      time: '3:30 PM - 5:00 PM', 
      duration: 90,
      type: 'creative',
      purpose: 'Creative and innovative work',
      activities: ['Innovation projects', 'Creative work', 'Strategic optimization'],
      environment: 'Creative space allowing for experimentation'
    }
  ];
}

// Extract energy strategies
function extractEnergyStrategies(sections) {
  return {
    peakEnergyUtilization: 'Schedule most demanding work during 8-12 AM peak energy window',
    energyRecovery: 'Build in 15-minute recovery periods between intense work blocks',
    mealTiming: 'Optimize meal timing: light breakfast 7 AM, substantial lunch 12:30 PM, dinner 7 PM',
    caffeeStrategy: 'Strategic caffeine use: 7:30 AM and 1:30 PM only, avoid after 3 PM',
    environmentDesign: 'Create distinct environments for different types of work',
    naturalRhythms: 'Align work intensity with natural circadian rhythms',
    recoveryPractices: 'Incorporate micro-recovery through breathing, movement, nature views',
    weeklyRhythm: 'Balance high-intensity days (Mon-Tue) with moderate days (Wed-Thu) and recovery (Fri-Sun)'
  };
}

// Extract productivity insights
function extractProductivityInsights(sections) {
  return {
    focusOptimization: '90-120 minute focused work blocks align with natural attention cycles',
    contextSwitching: 'Minimize context switching by batching similar activities',
    communicationBatching: 'Process communications in dedicated 30-minute blocks',
    decisionFatigue: 'Make important decisions during morning peak energy',
    environmentalCues: 'Use environmental changes to signal different types of work',
    habitStacking: 'Link new productivity habits to existing strong routines',
    systemsThinking: 'Invest time in building systems that reduce future effort',
    continuousImprovement: 'Weekly reviews enable continuous schedule optimization'
  };
}

// Extract implementation strategy
function extractImplementationStrategy(sections) {
  return {
    week1: {
      focus: 'Establish Alignment Routine',
      priority: 'Morning spiritual and physical alignment blocks',
      success_metric: 'Complete alignment routine 7/7 days'
    },
    week2: {
      focus: 'Implement HVW Blocks',
      priority: 'Protect and utilize high-value work time blocks',
      success_metric: 'Complete 3 HVW blocks daily with no interruptions'
    },
    week3: {
      focus: 'Optimize Energy Management',
      priority: 'Fine-tune energy utilization and recovery',
      success_metric: 'Sustain high energy throughout work day'
    },
    week4: {
      focus: 'System Integration',
      priority: 'Integrate all elements into seamless system',
      success_metric: 'Schedule feels natural and produces measurable results'
    }
  };
}

// Create optimized schedule blocks
function createOptimizedScheduleBlocks(optimization, preferences) {
  const blocks = {
    alignment: optimization.alignmentBlocks,
    hvw: optimization.hvwBlocks,
    daily: optimization.dailyTemplate,
    weekly: optimization.weeklyRhythm,
    rules: {
      alignmentNonNegotiable: true,
      hvwBlocksProtected: true,
      maxDailyMeetings: 3,
      minimumFocusBlockDuration: 90,
      noMeetingsBeforePeakHours: true
    }
  };

  return blocks;
}

// Generate implementation plan
function generateImplementationPlan(optimization, scheduleBlocks) {
  return {
    phase1: {
      duration: '1 week',
      focus: 'Foundation Building',
      actions: [
        'Establish morning alignment routine',
        'Set up work environment for focus',
        'Begin tracking energy levels',
        'Start evening reflection practice'
      ],
      success_criteria: [
        '100% alignment block completion',
        'Environment optimized for HVW',
        'Daily energy tracking established'
      ]
    },
    phase2: {
      duration: '2 weeks', 
      focus: 'HVW Integration',
      actions: [
        'Implement full HVW block schedule',
        'Optimize communication batching',
        'Refine focus techniques',
        'Build protection strategies'
      ],
      success_criteria: [
        'All HVW blocks protected and utilized',
        'Measured productivity increase',
        'Reduced interruption frequency'
      ]
    },
    phase3: {
      duration: '1 week',
      focus: 'Optimization & Refinement',
      actions: [
        'Fine-tune based on results',
        'Optimize energy management',
        'Establish weekly review process',
        'Build accountability systems'
      ],
      success_criteria: [
        'Schedule feels natural and sustainable',
        'Measurable value creation increase',
        'Strong habit formation'
      ]
    }
  };
}

// Calculate optimization score
function calculateOptimizationScore(scheduleBlocks, preferences, goals) {
  let score = 0;
  const maxScore = 100;

  // Alignment integration (25 points)
  const hasSpiritual = scheduleBlocks.alignment?.spiritual;
  const hasPhysical = scheduleBlocks.alignment?.physical;
  if (hasSpiritual && hasPhysical) {
    score += 25;
  } else if (hasSpiritual || hasPhysical) {
    score += 15;
  }

  // HVW optimization (30 points)  
  const hvwHours = scheduleBlocks.hvw?.reduce((total, block) => total + (block.duration / 60), 0) || 0;
  const hvwScore = Math.min(30, (hvwHours / 5.5) * 30); // Target 5.5 HVW hours daily
  score += hvwScore;

  // Energy optimization (20 points)
  const peakUtilization = calculatePeakEnergyUtilization(scheduleBlocks);
  score += peakUtilization * 20;

  // Balance metrics (15 points)
  const balance = calculateBalance(scheduleBlocks);
  score += balance * 15;

  // Sustainability (10 points)
  const sustainability = calculateSustainability(scheduleBlocks);
  score += sustainability * 10;

  return Math.round(Math.min(maxScore, score));
}

// Calculate peak energy utilization
function calculatePeakEnergyUtilization(scheduleBlocks) {
  // Check if HVW blocks are scheduled during peak hours (8-12 AM)
  const morningHVWBlocks = scheduleBlocks.hvw?.filter(block => {
    const hour = parseInt(block.time.split(':')[0]);
    return hour >= 8 && hour <= 12;
  }) || [];

  return Math.min(1.0, morningHVWBlocks.length / 2);
}

// Calculate balance metrics  
function calculateBalance(scheduleBlocks) {
  const daily = scheduleBlocks.daily || [];
  
  const workTime = daily.filter(item => ['hvw', 'work'].includes(item.type))
    .reduce((sum, item) => sum + item.duration, 0);
    
  const personalTime = daily.filter(item => ['alignment', 'personal', 'break'].includes(item.type))
    .reduce((sum, item) => sum + item.duration, 0);

  if (workTime + personalTime === 0) return 0;

  const workRatio = workTime / (workTime + personalTime);
  const idealRatio = 0.6; // 60% work, 40% personal
  const deviation = Math.abs(workRatio - idealRatio);
  
  return Math.max(0, 1 - (deviation * 2));
}

// Calculate sustainability
function calculateSustainability(scheduleBlocks) {
  let sustainability = 1.0;

  const daily = scheduleBlocks.daily || [];
  
  // Check total work hours
  const totalWorkMinutes = daily
    .filter(item => ['hvw', 'work', 'admin'].includes(item.type))
    .reduce((sum, item) => sum + item.duration, 0);
    
  if (totalWorkMinutes > 600) sustainability -= 0.3; // More than 10 hours
  if (totalWorkMinutes < 300) sustainability -= 0.2; // Less than 5 hours

  // Check alignment blocks
  const alignmentMinutes = daily
    .filter(item => item.type === 'alignment')
    .reduce((sum, item) => sum + item.duration, 0);
    
  if (alignmentMinutes < 50) sustainability -= 0.3; // Less than 50 minutes

  return Math.max(0, sustainability);
}

// Calculate balance metrics for response
function calculateBalanceMetrics(scheduleBlocks) {
  const daily = scheduleBlocks.daily || [];
  
  const metrics = {
    workLifeBalance: calculateBalance(scheduleBlocks),
    energyOptimization: calculatePeakEnergyUtilization(scheduleBlocks),
    alignmentIntegration: daily.filter(item => item.type === 'alignment').length > 0 ? 1 : 0,
    focusTime: daily.filter(item => item.type === 'hvw').reduce((sum, item) => sum + item.duration, 0),
    recoveryTime: daily.filter(item => ['break', 'personal'].includes(item.type)).reduce((sum, item) => sum + item.duration, 0),
    sustainability: calculateSustainability(scheduleBlocks)
  };

  return {
    ...metrics,
    overallBalance: Object.values(metrics).reduce((sum, val) => sum + val, 0) / Object.keys(metrics).length
  };
}

// Generate holistic recommendations
function generateHolisticRecommendations(optimization, score) {
  const recommendations = [];

  if (score < 60) {
    recommendations.push({
      priority: 'CRITICAL',
      category: 'Foundation',
      recommendation: 'Focus on establishing basic alignment routines before optimizing productivity',
      timeline: '1-2 weeks'
    });
  }

  if (score >= 60 && score < 80) {
    recommendations.push({
      priority: 'HIGH', 
      category: 'Optimization',
      recommendation: 'Fine-tune HVW blocks and energy management for maximum effectiveness',
      timeline: '2-3 weeks'
    });
  }

  if (score >= 80) {
    recommendations.push({
      priority: 'MEDIUM',
      category: 'Excellence', 
      recommendation: 'Maintain excellence and explore advanced productivity techniques',
      timeline: 'Ongoing'
    });
  }

  // Universal recommendations
  recommendations.push(
    {
      priority: 'HIGH',
      category: 'Alignment',
      recommendation: 'Never compromise on spiritual and physical alignment blocks - they are the foundation of sustainable success',
      timeline: 'Daily'
    },
    {
      priority: 'MEDIUM',
      category: 'HVW Focus',
      recommendation: 'Protect high-value work time with strict boundary management and environmental design',
      timeline: 'Daily'
    },
    {
      priority: 'MEDIUM',
      category: 'Energy Management',
      recommendation: 'Match task intensity to natural energy rhythms for maximum efficiency',
      timeline: 'Daily'
    },
    {
      priority: 'LOW',
      category: 'Continuous Improvement',
      recommendation: 'Conduct weekly reviews to optimize and adjust schedule based on results',
      timeline: 'Weekly'
    }
  );

  return recommendations;
}

// Generate next actions
function generateNextActions(implementationPlan) {
  const currentPhase = implementationPlan.phase1; // Start with phase 1
  
  return [
    `Phase Focus: ${currentPhase.focus}`,
    ...currentPhase.actions.slice(0, 3),
    'Set up tracking system for energy levels and productivity',
    'Schedule weekly review to assess progress and adjust'
  ];
}

// Utility functions
function parseTime(timeString) {
  const [time, period] = timeString.split(' ');
  const [hours, minutes] = time.split(':').map(Number);
  let hour24 = hours;
  
  if (period === 'PM' && hours !== 12) hour24 += 12;
  if (period === 'AM' && hours === 12) hour24 = 0;
  
  return hour24 * 60 + minutes; // Return minutes from midnight
}

function formatTime(minutes) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const period = hours >= 12 ? 'PM' : 'AM';
  const displayHour = hours > 12 ? hours - 12 : hours === 0 ? 12 : hours;
  
  return `${displayHour}:${mins.toString().padStart(2, '0')} ${period}`;
}

function calculateOptimizationConfidence(optimizationText, preferences) {
  let confidence = 70; // Base confidence
  
  // Increase confidence based on analysis quality
  if (optimizationText.length > 1500) confidence += 10;
  if (optimizationText.includes('alignment')) confidence += 10;
  if (optimizationText.includes('energy')) confidence += 5;
  if (Object.keys(preferences).length > 3) confidence += 5;
  
  return Math.max(50, Math.min(95, confidence));
}

function calculateValidityDate() {
  const validUntil = new Date();
  validUntil.setMonth(validUntil.getMonth() + 1); // Valid for 1 month
  return validUntil.toISOString();
}

function generateAnalysisId() {
  return 'sco_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

export default router;