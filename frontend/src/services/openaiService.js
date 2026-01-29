/**
 * 🤖 OpenAI Service - Unified AI Integration
 * Handles all AI-powered features using OpenAI API
 * Replaces Gemini for: NLP, contract analysis, scheduling, financial guidance
 */

class OpenAIService {
  constructor() {
    this.apiKey = import.meta.env.VITE_OPENAI_API_KEY;
    this.apiUrl = import.meta.env.VITE_OPENAI_API_URL || 'https://api.openai.com/v1';
    this.model = 'gpt-4-turbo-preview';
    this.fallbackModel = 'gpt-3.5-turbo';
    
    if (!this.apiKey) {
      console.warn('⚠️ OpenAI API key not configured. AI features will be limited.');
    } else {
      console.log('✅ OpenAI Service initialized');
    }
  }

  /**
   * 💬 Generic chat completion request
   * @param {string} userMessage - User input message
   * @param {string} systemPrompt - System context/instructions
   * @param {Object} options - Additional options (temperature, max_tokens, etc.)
   * @returns {Promise<string>} AI response text
   */
  async chat(userMessage, systemPrompt = '', options = {}) {
    if (!this.apiKey) {
      throw new Error('OpenAI API key not configured');
    }

    const {
      temperature = 0.7,
      maxTokens = 1024,
      model = this.model,
      model_fallback = this.fallbackModel
    } = options;

    try {
      const response = await this.callOpenAI({
        messages: [
          ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
          { role: 'user', content: userMessage }
        ],
        temperature,
        max_tokens: maxTokens,
        model
      });

      return response;
    } catch (error) {
      // Fallback to GPT-3.5 if GPT-4 fails
      if (error.message.includes('model not found') && model !== model_fallback) {
        console.warn(`⚠️ Model ${model} not available, falling back to ${model_fallback}`);
        return this.chat(userMessage, systemPrompt, { ...options, model: model_fallback });
      }
      throw error;
    }
  }

  /**
   * 📊 Parse natural language financial transaction
   * @param {string} userText - Natural language financial entry
   * @returns {Promise<Object>} Structured transaction object
   */
  async parseTransaction(userText) {
    const prompt = `You are a financial transaction parser. Parse the following natural language financial entry and return ONLY a valid JSON object with this exact structure:
{
  "type": "income|expense|transfer|loan|investment|saving",
  "amount_ugx": number,
  "amount_usd": number,
  "currency": "UGX|USD|KES|etc",
  "category": "string",
  "description": "string",
  "date": "YYYY-MM-DD"
}

Rules:
- UGX is default currency for Uganda
- Convert to USD at 1 USD = ~3600 UGX
- Be specific with categories (e.g., "Grocery Shopping" not just "Food")
- Return ONLY JSON, no additional text

Transaction: "${userText}"`;

    try {
      const response = await this.chat(userText, prompt, {
        temperature: 0.1,
        maxTokens: 500,
        model: this.model
      });

      // Extract JSON from response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('Invalid JSON response from OpenAI');
      }

      return JSON.parse(jsonMatch[0]);
    } catch (error) {
      console.error('❌ Transaction parsing failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 🏛️ Analyze contract for legal/financial risks
   * @param {string} contractText - Contract content
   * @param {string} analysisType - Type of analysis (legal|financial|both)
   * @returns {Promise<Object>} Risk assessment and recommendations
   */
  async analyzeContract(contractText, analysisType = 'both') {
    const prompt = `You are a legal and financial contract analyzer specialized in Ugandan law and finance. 
Analyze this contract for ${analysisType === 'legal' ? 'legal risks' : analysisType === 'financial' ? 'financial risks' : 'both legal and financial risks'}.

Return a JSON object with:
{
  "safety_score": number (0-100),
  "risk_level": "low|medium|high|critical",
  "risks": [
    { "type": "string", "description": "string", "severity": "low|medium|high|critical" }
  ],
  "financial_impacts": [
    { "impact": "string", "severity": "low|medium|high|critical" }
  ],
  "recommendations": ["string"],
  "summary": "string"
}

Contract to analyze:
${contractText.substring(0, 5000)}`;

    try {
      const response = await this.chat(contractText, prompt, {
        temperature: 0.2,
        maxTokens: 1500,
        model: this.model
      });

      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('Invalid JSON response');
      }

      return JSON.parse(jsonMatch[0]);
    } catch (error) {
      console.error('❌ Contract analysis failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 📅 Optimize daily schedule
   * @param {Object} preferences - User preferences
   * @param {Array} tasks - Tasks to schedule
   * @returns {Promise<Object>} Optimized schedule
   */
  async optimizeSchedule(preferences, tasks) {
    const prompt = `You are a productivity coach. Optimize this daily schedule based on preferences and tasks.

Preferences:
- Wake time: ${preferences.wakeUpTime || '6:00 AM'}
- Sleep time: ${preferences.sleepTime || '10:00 PM'}
- Work style: ${preferences.workStyle || 'hybrid'}
- Energy peak: ${preferences.energyPeak || 'morning'}
- Focus duration: ${preferences.focusDuration || '90 minutes'}

Tasks:
${tasks.map((t, i) => `${i + 1}. ${t.name} (${t.duration || '30'} min, priority: ${t.priority || 'medium'})`).join('\n')}

Return a JSON object with optimized schedule:
{
  "daily_template": {
    "morning": ["activity 1", "activity 2"],
    "afternoon": ["activity 1", "activity 2"],
    "evening": ["activity 1", "activity 2"]
  },
  "time_blocks": [
    { "start": "HH:MM", "end": "HH:MM", "activity": "string", "type": "focus|admin|break|personal" }
  ],
  "recommendations": ["string"],
  "optimization_score": number (0-100)
}`;

    try {
      const response = await this.chat(JSON.stringify(preferences), prompt, {
        temperature: 0.5,
        maxTokens: 2000,
        model: this.model
      });

      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('Invalid JSON response');
      }

      return JSON.parse(jsonMatch[0]);
    } catch (error) {
      console.error('❌ Schedule optimization failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 💼 Generate financial guidance and insights
   * @param {Object} metrics - Financial metrics
   * @param {string} question - User question
   * @returns {Promise<string>} AI guidance
   */
  async getFinancialGuidance(metrics, question) {
    const systemPrompt = `You are a financial advisor helping users improve their finances. 
Be encouraging, practical, and specific. Consider the user's financial situation.`;

    const contextMessage = `
Financial Metrics:
- Monthly Income: ${metrics.income || 'Unknown'}
- Monthly Expenses: ${metrics.expenses || 'Unknown'}
- Savings Rate: ${metrics.savingsRate || 'Unknown'}%
- Net Worth: ${metrics.netWorth || 'Unknown'}
- Financial Goals: ${metrics.goals?.join(', ') || 'Not specified'}

User Question: ${question}`;

    try {
      const response = await this.chat(contextMessage, systemPrompt, {
        temperature: 0.7,
        maxTokens: 1024,
        model: this.model
      });

      return response;
    } catch (error) {
      console.error('❌ Financial guidance failed:', error);
      return `I'm unable to provide guidance at the moment. Error: ${error.message}`;
    }
  }

  /**
   * 🎯 Generate business pitch feedback
   * @param {Object} pitch - Pitch details
   * @returns {Promise<Object>} Feedback and improvements
   */
  async generatePitchFeedback(pitch) {
    const prompt = `You are an experienced pitch coach and investor. Review this pitch and provide constructive feedback.

Pitch:
- Title: ${pitch.title}
- Description: ${pitch.description}
- Funding Goal: ${pitch.goal}
- Equity Offered: ${pitch.equity}
- Type: ${pitch.pitchType}

Return JSON with:
{
  "strengths": ["string"],
  "improvements": ["string"],
  "investment_readiness": "not_ready|developing|ready|excellent",
  "estimated_success": number (0-100),
  "key_messages": ["string"],
  "next_steps": ["string"]
}`;

    try {
      const response = await this.chat(JSON.stringify(pitch), prompt, {
        temperature: 0.6,
        maxTokens: 1500,
        model: this.model
      });

      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('Invalid JSON response');
      }

      return JSON.parse(jsonMatch[0]);
    } catch (error) {
      console.error('❌ Pitch feedback generation failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 🔧 Internal: Make OpenAI API call
   * @private
   */
  async callOpenAI(payload) {
    try {
      const response = await fetch(`${this.apiUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          ...payload,
          model: payload.model || this.model
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(`OpenAI API Error: ${error.error?.message || response.statusText}`);
      }

      const data = await response.json();
      return data.choices[0]?.message?.content || '';
    } catch (error) {
      console.error('❌ OpenAI API call failed:', error);
      throw error;
    }
  }
}

// Export singleton instance
export default new OpenAIService();
export { OpenAIService };
