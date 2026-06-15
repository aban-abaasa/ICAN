#!/usr/bin/env python3
"""
🏛️ TREASURY GUARDIAN API - OpenAI Edition
==========================================

Institutional-Grade Legal Risk Assessment for Contracts
Migrated from: Google Gemini AI
Version: 2.0.0
"""

import json
import time
import requests
import base64
from functools import wraps
from flask import Flask, request, jsonify
from flask_cors import CORS
import os
from datetime import datetime

app = Flask(__name__)
CORS(app)

# ========================================
# 🔧 OPENAI CONFIGURATION
# ========================================
OPENAI_API_KEY = os.getenv('OPENAI_API_KEY', 'sk-proj-')
OPENAI_API_URL = "https://api.openai.com/v1/chat/completions"
OPENAI_MODEL = "gpt-4-turbo-preview"  # Better for complex document analysis

# ========================================
# 🛡️ RESILIENCE MECHANISMS
# ========================================

def retry_with_backoff(max_retries=3, backoff_factor=2):
    """Retry decorator with exponential backoff"""
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            delay = 1
            last_error = None
            
            for attempt in range(max_retries):
                try:
                    return func(*args, **kwargs)
                except Exception as e:
                    last_error = e
                    if attempt < max_retries - 1:
                        print(f"⚠️ Attempt {attempt + 1} failed, retrying in {delay}s...")
                        time.sleep(delay)
                        delay *= backoff_factor
            
            raise last_error
        return wrapper
    return decorator

# ========================================
# 🤖 OPENAI ANALYSIS ENGINE
# ========================================

def call_openai_for_analysis(prompt: str, max_tokens: int = 2000) -> str:
    """Call OpenAI API for contract analysis"""
    headers = {
        'Content-Type': 'application/json',
        'Authorization': f'Bearer {OPENAI_API_KEY}'
    }
    
    payload = {
        "model": OPENAI_MODEL,
        "messages": [
            {
                "role": "system",
                "content": """You are an expert legal and financial contract analyzer. 
Analyze contracts for risks, providing structured JSON responses.
Always respond with ONLY valid JSON, no additional text."""
            },
            {
                "role": "user",
                "content": prompt
            }
        ],
        "temperature": 0.2,  # Low temperature for consistent analysis
        "max_tokens": max_tokens,
        "response_format": { "type": "json_object" }
    }
    
    response = requests.post(
        OPENAI_API_URL,
        headers=headers,
        json=payload,
        timeout=60
    )
    
    if response.status_code != 200:
        error_details = response.text
        raise Exception(f"OpenAI API error: {response.status_code} - {error_details}")
    
    data = response.json()
    return data['choices'][0]['message']['content']

# ========================================
# 📊 CONTRACT ANALYSIS FUNCTIONS
# ========================================

@app.route('/api/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'OK',
        'service': 'Treasury Guardian API',
        'version': '2.0.0',
        'ai_provider': 'OpenAI',
        'model': OPENAI_MODEL,
        'timestamp': datetime.now().isoformat()
    })

@app.route('/api/ai/vet_contract', methods=['POST'])
@retry_with_backoff(max_retries=3, backoff_factor=2)
def vet_contract():
    """
    Analyze contract for legal and financial risks
    """
    try:
        data = request.get_json()
        prompt = data.get('prompt', '')
        contract_text = data.get('contract_text', '')
        file_base64 = data.get('file_base64', '')
        mime_type = data.get('mime_type', 'text/plain')
        
        # Validate inputs
        if not prompt:
            return jsonify({
                "error": "TREASURY_GUARDIAN_ERROR",
                "message": "Analysis prompt is required",
                "status": "MISSING_PROMPT"
            }), 400
        
        if not contract_text and not file_base64:
            return jsonify({
                "error": "TREASURY_GUARDIAN_ERROR",
                "message": "Contract text or file is required",
                "status": "MISSING_CONTENT"
            }), 400
        
        # Use provided text or decode file
        analysis_text = contract_text or file_base64[:5000]
        
        print(f"🏛️ TREASURY GUARDIAN: Analyzing document")
        print(f"📋 Analysis Request: {prompt[:100]}...")
        
        # ========================================
        # 🚀 OPENAI ANALYSIS
        # ========================================
        
        enhanced_prompt = f"""
🏛️ TREASURY GUARDIAN ANALYSIS REQUEST:

USER QUESTION: {prompt}

CONTRACT/DOCUMENT EXCERPT (First 5000 chars):
{analysis_text[:5000]}

---

Please analyze this contract and return ONLY a JSON object with:
{{
  "financial_safety_score": number (0-100),
  "legal_risk_level": "low|medium|high|critical",
  "financial_risk_level": "low|medium|high|critical",
  "key_risks": ["string"],
  "financial_impacts": ["string"],
  "legal_concerns": ["string"],
  "recommendations": ["string"],
  "summary": "string",
  "critical_sections": ["string"],
  "estimated_financial_exposure": "string"
}}
"""
        
        print("🚀 Sending analysis request to OpenAI API...")
        start_time = time.time()
        
        analysis_response = call_openai_for_analysis(enhanced_prompt, max_tokens=2000)
        
        processing_time = time.time() - start_time
        print(f"⏱️ Analysis completed in {processing_time:.2f} seconds")
        
        # ========================================
        # 📊 RESPONSE PROCESSING
        # ========================================
        
        try:
            analysis = json.loads(analysis_response)
        except json.JSONDecodeError:
            # Extract JSON from response if wrapped in text
            import re
            json_match = re.search(r'\{[\s\S]*\}', analysis_response)
            if json_match:
                analysis = json.loads(json_match.group())
            else:
                raise ValueError('Invalid JSON response from OpenAI')
        
        # Build response
        response = {
            "success": True,
            "analysis": analysis,
            "processing_time": f"{processing_time:.2f}s",
            "timestamp": datetime.now().isoformat(),
            "ai_provider": "OpenAI",
            "model": OPENAI_MODEL
        }
        
        print(f"✅ Analysis complete. Safety Score: {analysis.get('financial_safety_score', 'N/A')}")
        
        return jsonify(response)
    
    except Exception as error:
        print(f"🚨 TREASURY GUARDIAN ERROR: {str(error)}")
        return jsonify({
            "error": "TREASURY_GUARDIAN_ERROR",
            "message": f"Analysis failed: {str(error)}",
            "status": "ANALYSIS_FAILURE",
            "timestamp": datetime.now().isoformat()
        }), 500

@app.route('/api/ai/contract_summary', methods=['POST'])
@retry_with_backoff(max_retries=3, backoff_factor=2)
def contract_summary():
    """Generate executive summary of contract"""
    try:
        data = request.get_json()
        contract_text = data.get('contract_text', '')
        
        if not contract_text:
            return jsonify({
                "error": "Missing contract text"
            }), 400
        
        prompt = f"""
Provide a concise executive summary of this contract in JSON format:
{{
  "title": "string",
  "parties": ["string"],
  "key_terms": ["string"],
  "duration": "string",
  "financial_terms": "string",
  "termination_clause": "string",
  "main_obligations": ["string"],
  "critical_dates": ["string"]
}}

Contract:
{contract_text[:5000]}
"""
        
        response_text = call_openai_for_analysis(prompt, max_tokens=1000)
        summary = json.loads(response_text)
        
        return jsonify({
            "success": True,
            "summary": summary,
            "timestamp": datetime.now().isoformat()
        })
    
    except Exception as error:
        return jsonify({
            "error": str(error),
            "status": "SUMMARY_FAILED"
        }), 500

# ========================================
# 🚀 APPLICATION STARTUP
# ========================================

if __name__ == '__main__':
    print("=" * 60)
    print("🏛️ TREASURY GUARDIAN API - OpenAI Edition")
    print(f"📡 AI Provider: OpenAI")
    print(f"🤖 Model: {OPENAI_MODEL}")
    print(f"🌐 Running on: http://localhost:5000")
    print(f"📝 Endpoints:")
    print(f"   - Health: GET /api/health")
    print(f"   - Vet Contract: POST /api/ai/vet_contract")
    print(f"   - Summary: POST /api/ai/contract_summary")
    print("=" * 60)
    
    app.run(
        host='0.0.0.0',
        port=5000,
        debug=True,
        use_reloader=False
    )
