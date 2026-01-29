#!/usr/bin/env python3
"""
ICAN NLP Transaction Processor - OpenAI Edition
================================================

Flask API endpoint that transforms natural language financial entries into 
structured JSON transactions using OpenAI GPT with precision data analysis.

Migrated from: Google Gemini AI
Author: ICAN Capital Engine
Version: 2.0.0
"""

import os
import json
import time
import logging
import requests
from typing import Dict, Any, Optional
from datetime import datetime
from flask import Flask, request, jsonify
from flask_cors import CORS
from functools import wraps

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Initialize Flask app
app = Flask(__name__)
CORS(app)

# ========================================
# 🔧 OPENAI CONFIGURATION
# ========================================
OPENAI_API_KEY = os.getenv('OPENAI_API_KEY', 'sk-proj-')
OPENAI_API_URL = "https://api.openai.com/v1/chat/completions"
OPENAI_MODEL = "gpt-3.5-turbo"  # or "gpt-4" for higher accuracy

if not OPENAI_API_KEY or OPENAI_API_KEY == 'sk-proj-':
    logger.warning('⚠️ OpenAI API key not configured!')

# ========================================
# 🎯 SYSTEM PROMPT FOR TRANSACTION PARSING
# ========================================
SYSTEM_INSTRUCTION = """You are a financial transaction parser specialized in East African finance (Uganda, Kenya, Tanzania).
Your job is to parse natural language financial entries and return ONLY valid JSON.

RULES:
1. ALWAYS return ONLY a JSON object, never include explanations or extra text
2. Default currency is UGX (Uganda Shilling)
3. Be specific with categories - use local terminology
4. Transaction types: INCOME, EXPENSE, TRANSFER, LOAN, INVESTMENT, SAVING, TITHING
5. Categories: Salary, Business, Food, Transport, Utilities, Shopping, Rent, Health, Education, Entertainment, Gifts, Charity, etc.

RESPONSE FORMAT - Return ONLY this JSON structure:
{
  "type": "INCOME|EXPENSE|TRANSFER|LOAN|INVESTMENT|SAVING|TITHING",
  "amount_ugx": number,
  "amount_usd": number,
  "currency": "UGX|USD|KES|etc",
  "category": "string",
  "description": "string",
  "date": "YYYY-MM-DD"
}

Examples:
- "bought groceries 50k" → {"type":"EXPENSE","amount_ugx":50000,"category":"Food","description":"Groceries shopping"}
- "salary 2.5M" → {"type":"INCOME","amount_ugx":2500000,"category":"Salary"}
- "borrowed 1.2M for business" → {"type":"LOAN","amount_ugx":1200000,"category":"Business"}
"""

# ========================================
# 🛡️ RESILIENCE & RETRY MECHANISMS
# ========================================

def exponential_backoff_retry(func, max_retries: int = 3, base_delay: float = 1.0) -> Any:
    """Exponential backoff retry decorator"""
    def wrapper(*args, **kwargs):
        delay = base_delay
        last_error = None
        
        for attempt in range(max_retries):
            try:
                return func(*args, **kwargs)
            except Exception as e:
                last_error = e
                if attempt < max_retries - 1:
                    logger.warning(f"Attempt {attempt + 1} failed: {str(e)}, retrying in {delay}s...")
                    time.sleep(delay)
                    delay *= 2
                else:
                    logger.error(f"All {max_retries} attempts failed")
        
        raise last_error
    return wrapper()

# ========================================
# 🤖 OPENAI API INTEGRATION
# ========================================

def call_openai_api(user_text: str) -> Dict[str, Any]:
    """
    Call OpenAI API with JSON mode for structured output.
    
    Args:
        user_text: Raw user input text
    
    Returns:
        Parsed transaction object
    """
    headers = {
        'Content-Type': 'application/json',
        'Authorization': f'Bearer {OPENAI_API_KEY}'
    }
    
    payload = {
        "model": OPENAI_MODEL,
        "messages": [
            {
                "role": "system",
                "content": SYSTEM_INSTRUCTION
            },
            {
                "role": "user",
                "content": f"Parse this financial transaction: '{user_text}'"
            }
        ],
        "temperature": 0.1,  # Low temperature for consistent parsing
        "max_tokens": 500,
        "response_format": { "type": "json_object" }  # Forces JSON output
    }
    
    def make_request():
        logger.info(f"🚀 Calling OpenAI API with model: {OPENAI_MODEL}")
        response = requests.post(
            OPENAI_API_URL,
            headers=headers,
            json=payload,
            timeout=30
        )
        response.raise_for_status()
        return response.json()
    
    return exponential_backoff_retry(make_request, max_retries=3)

# ========================================
# 📊 RESPONSE PROCESSING
# ========================================

def process_openai_response(response: Dict) -> Dict[str, Any]:
    """Extract and validate transaction from OpenAI response"""
    try:
        if 'choices' not in response or not response['choices']:
            raise ValueError('No choices in OpenAI response')
        
        message = response['choices'][0].get('message', {})
        content = message.get('content', '')
        
        if not content:
            raise ValueError('Empty content in OpenAI response')
        
        # Parse JSON from response
        transaction = json.loads(content)
        
        # Validate required fields
        required_fields = ['type', 'amount_ugx', 'category', 'description']
        for field in required_fields:
            if field not in transaction:
                transaction[field] = 'Unknown'
        
        # Ensure amount is numeric
        if not isinstance(transaction.get('amount_ugx'), (int, float)):
            transaction['amount_ugx'] = 0
        
        # Set defaults
        if 'currency' not in transaction:
            transaction['currency'] = 'UGX'
        if 'date' not in transaction:
            transaction['date'] = datetime.now().strftime('%Y-%m-%d')
        if 'amount_usd' not in transaction:
            transaction['amount_usd'] = transaction['amount_ugx'] / 3600
        
        logger.info(f"✅ Transaction parsed: {transaction}")
        return transaction
    
    except json.JSONDecodeError as e:
        logger.error(f"JSON parsing error: {e}")
        raise ValueError(f'Invalid JSON in response: {str(e)}')
    except Exception as e:
        logger.error(f"Response processing error: {e}")
        raise

# ========================================
# 🔍 FALLBACK PARSING (When AI fails)
# ========================================

def parse_transaction_fallback(user_text: str) -> Dict[str, Any]:
    """Simple regex-based fallback when AI fails"""
    import re
    
    text = user_text.lower()
    
    # Try to extract amount
    amount_match = re.search(r'(\d+)\s*[mkKM]?', text)
    amount = int(amount_match.group(1)) if amount_match else 0
    
    # Multiply by thousands if M/k is present
    if 'k' in text:
        amount *= 1000
    elif 'm' in text:
        amount *= 1000000
    
    # Determine type
    tx_type = 'EXPENSE'
    if any(word in text for word in ['salary', 'income', 'earned', 'received']):
        tx_type = 'INCOME'
    elif any(word in text for word in ['borrowed', 'loan', 'lent']):
        tx_type = 'LOAN'
    elif any(word in text for word in ['tithe', 'church', 'offering', 'donation']):
        tx_type = 'TITHING'
    
    # Determine category
    category = 'Other'
    if 'food' in text or 'eat' in text or 'cafe' in text:
        category = 'Food'
    elif 'transport' in text or 'boda' in text:
        category = 'Transport'
    elif 'salary' in text:
        category = 'Salary'
    
    return {
        'type': tx_type,
        'amount_ugx': amount,
        'amount_usd': amount / 3600,
        'currency': 'UGX',
        'category': category,
        'description': user_text,
        'date': datetime.now().strftime('%Y-%m-%d'),
        'source': 'FALLBACK_PARSER'
    }

# ========================================
# 🎯 MAIN API ENDPOINTS
# ========================================

@app.route('/api/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'OK',
        'service': 'ICAN NLP Transaction Processor',
        'version': '2.0.0',
        'ai_provider': 'OpenAI',
        'model': OPENAI_MODEL,
        'timestamp': datetime.now().isoformat()
    })

@app.route('/api/ai/parse_transaction', methods=['POST'])
def parse_transaction():
    """Parse natural language transaction to structured JSON"""
    try:
        data = request.get_json()
        user_text = data.get('text', '').strip()
        
        if not user_text:
            return jsonify({
                'success': False,
                'error': 'Empty text provided',
                'code': 'EMPTY_TEXT'
            }), 400
        
        logger.info(f"Processing transaction text: {user_text}")
        start_time = time.time()
        
        # Try OpenAI processing first
        transaction = None
        ai_confidence = 'low'
        
        try:
            # Call OpenAI API
            response = call_openai_api(user_text)
            transaction = process_openai_response(response)
            ai_confidence = 'high'
            logger.info(f"AI parsed successfully: {transaction}")
            
        except Exception as ai_error:
            logger.warning(f"AI parsing failed: {str(ai_error)}")
            # Fall back to simple parsing
            transaction = parse_transaction_fallback(user_text)
            ai_confidence = 'fallback'
            logger.info(f"Fallback parser result: {transaction}")
        
        processing_time = time.time() - start_time
        
        return jsonify({
            'success': True,
            'transaction': transaction,
            'ai_confidence': ai_confidence,
            'processing_time': f"{processing_time:.2f}s",
            'timestamp': datetime.now().isoformat()
        })
    
    except Exception as error:
        logger.error(f"❌ Error in parse_transaction: {str(error)}")
        return jsonify({
            'success': False,
            'error': str(error),
            'code': 'PROCESSING_ERROR'
        }), 500

@app.route('/api/test', methods=['POST'])
def test_parsing():
    """Test endpoint with sample transactions"""
    sample_texts = [
        "bought groceries 50000 at shoprite",
        "salary 2.5M monthly payment",
        "borrowed 1.2M for business",
        "tithe 100k church offering",
        "lunch 15000 at cafe javas"
    ]
    
    results = []
    for text in sample_texts:
        try:
            with app.test_request_context(
                '/api/ai/parse_transaction',
                method='POST',
                json={'text': text}
            ):
                response = parse_transaction()
                results.append({
                    'input': text,
                    'output': response[0].get_json() if hasattr(response, 'get_json') else response,
                    'status': 'success'
                })
        except Exception as e:
            results.append({
                'input': text,
                'error': str(e),
                'status': 'error'
            })
    
    return jsonify({
        'test_results': results,
        'total_tests': len(sample_texts),
        'passed': sum(1 for r in results if r['status'] == 'success'),
        'failed': sum(1 for r in results if r['status'] == 'error'),
        'timestamp': datetime.now().isoformat()
    })

# ========================================
# 🚀 APPLICATION STARTUP
# ========================================

if __name__ == '__main__':
    logger.info('=' * 60)
    logger.info('🚀 ICAN NLP Transaction Processor (OpenAI Edition)')
    logger.info(f'📡 API Provider: OpenAI')
    logger.info(f'🤖 Model: {OPENAI_MODEL}')
    logger.info(f'🌐 Running on: http://localhost:5000')
    logger.info(f'📝 Endpoints:')
    logger.info(f'   - Health: GET /api/health')
    logger.info(f'   - Parse: POST /api/ai/parse_transaction')
    logger.info(f'   - Test: POST /api/test')
    logger.info('=' * 60)
    
    app.run(
        host='0.0.0.0',
        port=5000,
        debug=True,
        use_reloader=False
    )
