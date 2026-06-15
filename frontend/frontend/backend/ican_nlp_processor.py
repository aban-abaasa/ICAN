#!/usr/bin/env python3
"""
ICAN NLP Transaction Processor
==============================

Flask API endpoint that transforms natural language financial entries into 
structured JSON transactions using Gemini AI with precision data analysis.

Author: ICAN Capital Engine
Version: 1.0.0
"""

import os
import json
import time
import random
import logging
import requests
from typing import Dict, Any, Optional
from datetime import datetime
from flask import Flask, request, jsonify
from flask_cors import CORS

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Initialize Flask app
app = Flask(__name__)
CORS(app)  # Enable Cross-Origin Resource Sharing

# Configuration
GEMINI_API_KEY = os.getenv('GEMINI_API_KEY', 'your_gemini_api_key_here')
GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent"

# 🎯 MANDATORY STRUCTURED OUTPUT SCHEMA
SINGLE_TRANSACTION_SCHEMA = {
    "type": "OBJECT",
    "description": "A single financial transaction parsed from natural language.",
    "properties": {
        "amount_ugx": {
            "type": "NUMBER",
            "description": "The exact numerical value of the transaction. Must be a positive number."
        },
        "type": {
            "type": "STRING",
            "enum": ["INCOME", "EXPENSE", "LOAN", "TITHING"],
            "description": "The financial classification based on the nature of the transaction."
        },
        "category": {
            "type": "STRING",
            "description": "The inferred sub-category (e.g., 'Groceries', 'Salary', 'Rent')."
        },
        "description": {
            "type": "STRING",
            "description": "A concise, clean description of the transaction as it should appear in the log."
        }
    },
    "required": ["amount_ugx", "type", "category", "description"]
}

# 🧠 AI SYSTEM INSTRUCTION - Precision Data Analyst Persona
SYSTEM_INSTRUCTION = """
You are a PRECISION DATA ANALYST specializing in financial transaction processing for Uganda's economic context.

CORE MISSION: Transform ambiguous human language into concrete, structured financial data with mathematical precision.

CRITICAL GUIDELINES:

1. AMOUNT EXTRACTION (Priority #1):
   - Extract ALL numerical values (including abbreviated forms)
   - Convert: k/K = 1,000 | M = 1,000,000 | B = 1,000,000,000
   - Examples: "50k" = 50000, "2.5M" = 2500000, "800" = 800
   - If multiple amounts, choose the PRIMARY transaction amount
   - NEVER return 0 or negative amounts

2. TYPE CLASSIFICATION (Priority #2):
   - INCOME: Salary, business revenue, gifts received, profits, sales
   - EXPENSE: Purchases, bills, food, transport, services, shopping
   - LOAN: Money borrowed, credit, advance payments, loans taken
   - TITHING: Church offerings, religious donations, spiritual giving

3. CATEGORY INFERENCE (Uganda Context):
   - Use local terminology: "boda" (motorcycle transport), "posho" (food staple)
   - Common categories: Transport, Food, Utilities, Salary, Business, Church
   - Be specific but concise: "Grocery Shopping" vs just "Food"

4. DESCRIPTION CLEANING:
   - Create professional, clean descriptions
   - Remove redundant words, slang, or unclear terms
   - Keep essential context and location if relevant

5. EDGE CASES:
   - Ambiguous text: Make educated assumptions based on context
   - Multiple transactions: Focus on the MAIN transaction
   - Unclear amounts: Use reasonable estimation based on context

RESPONSE FORMAT: Return ONLY the structured JSON object matching the schema. No additional text or explanations.
"""

def exponential_backoff_retry(func, max_retries: int = 3, base_delay: float = 1.0) -> Any:
    """
    Execute a function with exponential backoff retry mechanism.
    
    Args:
        func: Function to execute
        max_retries: Maximum number of retry attempts
        base_delay: Base delay in seconds
    
    Returns:
        Function result or raises last exception
    """
    for attempt in range(max_retries + 1):
        try:
            return func()
        except Exception as e:
            if attempt == max_retries:
                logger.error(f"Function failed after {max_retries + 1} attempts: {str(e)}")
                raise e
            
            delay = base_delay * (2 ** attempt) + random.uniform(0, 1)
            logger.warning(f"Attempt {attempt + 1} failed: {str(e)}. Retrying in {delay:.2f}s...")
            time.sleep(delay)

def call_gemini_api(user_text: str) -> Dict[str, Any]:
    """
    Call Gemini API with structured output for transaction parsing.
    
    Args:
        user_text: Raw user input text
    
    Returns:
        Parsed transaction object
    """
    headers = {
        'Content-Type': 'application/json',
        'x-goog-api-key': GEMINI_API_KEY
    }
    
    payload = {
        "contents": [{
            "parts": [{
                "text": f"Parse this financial transaction: '{user_text}'"
            }]
        }],
        "systemInstruction": {
            "parts": [{
                "text": SYSTEM_INSTRUCTION
            }]
        },
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseSchema": SINGLE_TRANSACTION_SCHEMA,
            "temperature": 0.1,  # Low temperature for consistent parsing
            "maxOutputTokens": 1024,
            "candidateCount": 1
        }
    }
    
    def make_request():
        response = requests.post(
            GEMINI_API_URL,
            headers=headers,
            json=payload,
            timeout=30
        )
        response.raise_for_status()
        return response.json()
    
    return exponential_backoff_retry(make_request)

def validate_transaction(transaction: Dict[str, Any]) -> Dict[str, Any]:
    """
    Validate and sanitize the transaction object.
    
    Args:
        transaction: Raw transaction from AI
    
    Returns:
        Validated and sanitized transaction
    """
    # Ensure amount is positive number
    amount = float(transaction.get('amount_ugx', 0))
    if amount <= 0:
        raise ValueError(f"Invalid amount: {amount}")
    
    # Validate transaction type
    valid_types = ['INCOME', 'EXPENSE', 'LOAN', 'TITHING']
    trans_type = transaction.get('type', '').upper()
    if trans_type not in valid_types:
        raise ValueError(f"Invalid transaction type: {trans_type}")
    
    # Clean and validate strings
    category = str(transaction.get('category', 'Miscellaneous')).strip()
    description = str(transaction.get('description', 'Transaction')).strip()
    
    if not category:
        category = 'Miscellaneous'
    if not description:
        description = 'Financial Transaction'
    
    return {
        'amount_ugx': round(amount, 2),
        'type': trans_type,
        'category': category[:50],  # Limit category length
        'description': description[:100]  # Limit description length
    }

def create_fallback_transaction(user_text: str) -> Dict[str, Any]:
    """
    Create a fallback transaction when AI parsing fails.
    
    Args:
        user_text: Original user input
    
    Returns:
        Basic transaction object
    """
    # Try to extract numbers from text
    import re
    numbers = re.findall(r'[\d,]+(?:\.\d+)?', user_text.replace(',', ''))
    amount = 0
    
    if numbers:
        try:
            # Take the first/largest number found
            amount = max([float(num) for num in numbers])
        except:
            amount = 1000  # Default fallback amount
    
    # Simple type detection
    expense_keywords = ['bought', 'paid', 'spent', 'cost', 'expense', 'bill']
    income_keywords = ['salary', 'earned', 'received', 'income', 'profit']
    loan_keywords = ['loan', 'borrowed', 'credit', 'advance']
    tithe_keywords = ['tithe', 'offering', 'church', 'donation']
    
    text_lower = user_text.lower()
    
    if any(keyword in text_lower for keyword in tithe_keywords):
        trans_type = 'TITHING'
        category = 'Religious Giving'
    elif any(keyword in text_lower for keyword in loan_keywords):
        trans_type = 'LOAN'
        category = 'Financial Loan'
    elif any(keyword in text_lower for keyword in income_keywords):
        trans_type = 'INCOME'
        category = 'Income Source'
    else:
        trans_type = 'EXPENSE'
        category = 'General Expense'
    
    return {
        'amount_ugx': max(amount, 1000),  # Minimum 1000 UGX
        'type': trans_type,
        'category': category,
        'description': user_text[:80] if user_text else 'Manual Transaction Entry'
    }

@app.route('/api/ai/parse_transaction', methods=['POST'])
def parse_transaction():
    """
    🎯 MAIN API ENDPOINT: Parse natural language text into structured transaction
    
    Expected Input:
    {
        "text": "bought groceries worth 45000 at nakumatt"
    }
    
    Returns:
    {
        "success": true,
        "transaction": {
            "amount_ugx": 45000,
            "type": "EXPENSE",
            "category": "Grocery Shopping",
            "description": "Groceries at Nakumatt"
        },
        "processing_time": 1.23,
        "ai_confidence": "high"
    }
    """
    start_time = time.time()
    
    try:
        # Get input data
        data = request.get_json()
        if not data or 'text' not in data:
            return jsonify({
                'success': False,
                'error': 'Missing required field: text',
                'code': 'MISSING_TEXT'
            }), 400
        
        user_text = data['text'].strip()
        if not user_text:
            return jsonify({
                'success': False,
                'error': 'Empty text provided',
                'code': 'EMPTY_TEXT'
            }), 400
        
        logger.info(f"Processing transaction text: {user_text}")
        
        # Try AI processing first
        transaction = None
        ai_confidence = 'low'
        
        try:
            # Call Gemini AI
            response = call_gemini_api(user_text)
            
            # Extract transaction from response
            if 'candidates' in response and response['candidates']:
                content = response['candidates'][0].get('content', {})
                parts = content.get('parts', [])
                if parts and 'text' in parts[0]:
                    transaction_text = parts[0]['text']
                    transaction = json.loads(transaction_text)
                    ai_confidence = 'high'
                    logger.info(f"AI parsed successfully: {transaction}")
            
        except Exception as ai_error:
            logger.warning(f"AI parsing failed: {str(ai_error)}")
            ai_confidence = 'fallback'
        
        # Use fallback if AI failed
        if not transaction:
            transaction = create_fallback_transaction(user_text)
            logger.info(f"Using fallback transaction: {transaction}")
        
        # Validate and sanitize
        validated_transaction = validate_transaction(transaction)
        
        # Calculate processing time
        processing_time = round(time.time() - start_time, 3)
        
        # Add metadata
        validated_transaction['parsed_at'] = datetime.utcnow().isoformat()
        validated_transaction['original_text'] = user_text
        
        return jsonify({
            'success': True,
            'transaction': validated_transaction,
            'processing_time': processing_time,
            'ai_confidence': ai_confidence,
            'api_version': '1.0.0'
        })
        
    except ValueError as ve:
        logger.error(f"Validation error: {str(ve)}")
        return jsonify({
            'success': False,
            'error': f'Transaction validation failed: {str(ve)}',
            'code': 'VALIDATION_ERROR'
        }), 400
        
    except Exception as e:
        logger.error(f"Unexpected error: {str(e)}")
        return jsonify({
            'success': False,
            'error': 'Internal server error occurred',
            'code': 'INTERNAL_ERROR'
        }), 500

@app.route('/api/health', methods=['GET'])
def health_check():
    """Health check endpoint for monitoring"""
    return jsonify({
        'status': 'healthy',
        'service': 'ICAN NLP Transaction Processor',
        'version': '1.0.0',
        'timestamp': datetime.utcnow().isoformat()
    })

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
            # Simulate request
            with app.test_request_context(
                '/api/ai/parse_transaction',
                method='POST',
                json={'text': text}
            ):
                response = parse_transaction()
                results.append({
                    'input': text,
                    'output': response.get_json(),
                    'status_code': response.status_code
                })
        except Exception as e:
            results.append({
                'input': text,
                'error': str(e),
                'status_code': 500
            })
    
    return jsonify({
        'test_results': results,
        'total_tests': len(sample_texts),
        'timestamp': datetime.utcnow().isoformat()
    })

if __name__ == '__main__':
    print("🚀 ICAN NLP Transaction Processor Starting...")
    print(f"📡 API Endpoint: http://localhost:5000/api/ai/parse_transaction")
    print(f"🏥 Health Check: http://localhost:5000/api/health")
    print(f"🧪 Test Endpoint: http://localhost:5000/api/test")
    
    # Run the Flask app
    app.run(
        host='0.0.0.0',
        port=5000,
        debug=True,
        threaded=True
    )