/**
 * 🎯 Magic Payment Method Detector
 * Automatically detects and routes to the correct payment method
 * 
 * Supported Methods:
 * - Credit/Debit Card (Visa, Mastercard, Verve)
 * - Mobile Money (MTN, Vodafone, Airtel)
 * - USSD
 * - Bank Transfer
 */

class PaymentMethodDetector {
  constructor() {
    this.detectionPatterns = {
      // Card patterns
      visa: {
        patterns: [/^4[0-9]{12}(?:[0-9]{3})?$/],
        name: 'Visa',
        type: 'card',
        icon: '💳',
        keywords: ['visa', 'card', 'credit'],
        color: '#1434CB'
      },
      mastercard: {
        patterns: [/^5[1-5][0-9]{14}$/, /^2(?:22[1-9]|[23]\d{2}|4[01]\d|5[0-5])\d{12}$/],
        name: 'Mastercard',
        type: 'card',
        icon: '💳',
        keywords: ['mastercard', 'master', 'mc'],
        color: '#EB001B'
      },
      verve: {
        patterns: [/^(506|507|508|509)[0-9]{12}(?:[0-9]{3})?$/],
        name: 'Verve',
        type: 'card',
        icon: '💳',
        keywords: ['verve'],
        color: '#FF6B00'
      },
      
      // Mobile Money patterns
      mtn: {
        patterns: [/^256(7[0-9]{1}|3[0-9]{1})[0-9]{7}$/, /^\+?256(7[0-9]{1}|3[0-9]{1})[0-9]{7}$/],
        name: 'MTN Mobile Money',
        type: 'mobile_money',
        icon: '📱',
        keywords: ['mtn', 'mobile money', 'momo'],
        color: '#FFCC00',
        provider: 'MTN'
      },
      vodafone: {
        patterns: [/^256(70|75)[0-9]{8}$/, /^\+?256(70|75)[0-9]{8}$/],
        name: 'Vodafone Cash',
        type: 'mobile_money',
        icon: '📱',
        keywords: ['vodafone', 'vodefone', 'vf'],
        color: '#E31E24',
        provider: 'Vodafone'
      },
      airtel: {
        patterns: [/^256(70|71|72|73|74|75|76)[0-9]{7}$/, /^\+?256(70|71|72|73|74|75|76)[0-9]{7}$/],
        name: 'Airtel Money',
        type: 'mobile_money',
        icon: '📱',
        keywords: ['airtel', 'airtel money', 'am'],
        color: '#C60C30',
        provider: 'Airtel'
      },
      
      // Regional patterns
      ussd: {
        patterns: [/^\*\d{2,3}#$/, /^#/],
        name: 'USSD',
        type: 'ussd',
        icon: '☎️',
        keywords: ['ussd', '*', '#'],
        color: '#4CAF50'
      },
      bank: {
        patterns: [/^\d{10,20}$/],
        name: 'Bank Transfer',
        type: 'bank_transfer',
        icon: '🏦',
        keywords: ['bank', 'account'],
        color: '#1976D2'
      }
    };
  }

  /**
   * Detect payment method from input
   * @param {string} input - User input (card number, phone, etc)
   * @returns {Object} - Detected method or null
   */
  detectMethod(input) {
    if (!input) return null;

    const cleanInput = input.replace(/\s|-/g, '').trim();
    
    console.log('🔍 Detecting payment method from input:', cleanInput.substring(0, 6) + '...');

    // Check patterns
    for (const [key, config] of Object.entries(this.detectionPatterns)) {
      for (const pattern of config.patterns) {
        if (pattern.test(cleanInput)) {
          console.log(`✅ Detected: ${config.name}`);
          return {
            method: key,
            name: config.name,
            type: config.type,
            icon: config.icon,
            color: config.color,
            provider: config.provider,
            input: cleanInput,
            confidence: 'high'
          };
        }
      }
    }

    // Check keywords
    const lowerInput = input.toLowerCase();
    for (const [key, config] of Object.entries(this.detectionPatterns)) {
      if (config.keywords.some(kw => lowerInput.includes(kw))) {
        console.log(`✅ Detected: ${config.name} (keyword match)`);
        return {
          method: key,
          name: config.name,
          type: config.type,
          icon: config.icon,
          color: config.color,
          provider: config.provider,
          input: cleanInput,
          confidence: 'medium'
        };
      }
    }

    console.log('❓ Could not detect payment method');
    return null;
  }

  /**
   * Validate payment input based on detected method
   */
  validateInput(input, method) {
    if (!method) return false;

    const config = this.detectionPatterns[method];
    const cleanInput = input.replace(/\s|-/g, '').trim();

    for (const pattern of config.patterns) {
      if (pattern.test(cleanInput)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Format input based on detected method
   */
  formatInput(input, method) {
    const cleanInput = input.replace(/\s|-/g, '').trim();

    // Phone number formatting
    if (['mtn', 'vodafone', 'airtel'].includes(method)) {
      if (cleanInput.startsWith('256')) {
        return `+${cleanInput}`;
      } else if (cleanInput.startsWith('+256')) {
        return cleanInput;
      } else if (cleanInput.startsWith('0')) {
        return `+256${cleanInput.substring(1)}`;
      }
      return `+${cleanInput}`;
    }

    // Card formatting (chunks of 4)
    if (['visa', 'mastercard', 'verve'].includes(method)) {
      return cleanInput.replace(/(\d{4})/g, '$1 ').trim();
    }

    return cleanInput;
  }

  /**
   * Get all payment methods
   */
  getAllMethods() {
    return Object.entries(this.detectionPatterns).map(([key, config]) => ({
      id: key,
      name: config.name,
      type: config.type,
      icon: config.icon,
      color: config.color,
      provider: config.provider
    }));
  }

  /**
   * Get methods by type
   */
  getMethodsByType(type) {
    return Object.entries(this.detectionPatterns)
      .filter(([_, config]) => config.type === type)
      .map(([key, config]) => ({
        id: key,
        name: config.name,
        type: config.type,
        icon: config.icon,
        color: config.color,
        provider: config.provider
      }));
  }

  /**
   * Get suggested input format for a method
   */
  getInputPlaceholder(method) {
    const placeholders = {
      visa: '4111 1111 1111 1111',
      mastercard: '5555 5555 5555 4444',
      verve: '5061 0000 0010 0001',
      mtn: '+256701234567 or 0701234567',
      vodafone: '+256701234567 or 0701234567',
      airtel: '+256701234567 or 0701234567',
      ussd: '*256# or #256#',
      bank: '1234567890'
    };

    return placeholders[method] || 'Enter payment details';
  }

  /**
   * Get service to handle the payment
   */
  getPaymentService(method) {
    const serviceMap = {
      visa: 'flutterwaveService',
      mastercard: 'flutterwaveService',
      verve: 'flutterwaveService',
      mtn: 'momoService',
      vodafone: 'momoService',
      airtel: 'airtelMoneyService',
      ussd: 'flutterwaveService',
      bank: 'flutterwaveService'
    };

    return serviceMap[method];
  }
}

export const paymentMethodDetector = new PaymentMethodDetector();
export default paymentMethodDetector;
