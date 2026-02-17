#!/usr/bin/env python3
"""
🏛️ TREASURY GUARDIAN API - Institutional-Grade Legal Risk Assessment
MISSION: Multi-modal contract vetting with AI-powered financial safety scoring

This Flask API provides enterprise-level document analysis capabilities for
contract vetting, legal risk assessment, and financial safety evaluation.
Specialized for Ugandan law and financial regulations.
"""

import json
import time
import requests
from functools import wraps
from flask import Flask, request, jsonify
from flask_cors import CORS

# ========================================
# 🔧 CORE CONFIGURATION & INITIALIZATION
# ========================================

app = Flask(__name__)
CORS(app)  # Enable cross-origin requests from React frontend

# 🌟 GEMINI API CONFIGURATION
GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent"
API_KEY = ""  # TO BE CONFIGURED: Add your Gemini API key here

# ========================================
# 🛡️ RESILIENCE & STABILITY MECHANISMS
# ========================================

def retry_with_backoff(max_retries=3, backoff_factor=2):
    """
    🔄 Advanced Retry Decorator with Exponential Backoff
    
    Ensures connection stability and resilience for high-stakes financial requests.
    Critical for Treasury Guardian operations where reliability is paramount.
    
    Args:
        max_retries (int): Maximum number of retry attempts
        backoff_factor (float): Exponential backoff multiplier
    """
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            for attempt in range(max_retries + 1):
                try:
                    return func(*args, **kwargs)
                except requests.exceptions.RequestException as e:
                    if attempt == max_retries:
                        print(f"🚨 TREASURY GUARDIAN ERROR: Final attempt failed - {str(e)}")
                        raise e
                    
                    wait_time = backoff_factor ** attempt
                    print(f"⏳ Retry attempt {attempt + 1}/{max_retries} in {wait_time}s...")
                    time.sleep(wait_time)
                except Exception as e:
                    print(f"💥 TREASURY GUARDIAN CRITICAL ERROR: {str(e)}")
                    raise e
            return wrapper
        return decorator

# ========================================
# 📋 STRUCTURED OUTPUT SCHEMA DEFINITION
# ========================================

VETTING_SCHEMA = {
    "type": "object",
    "properties": {
        "financial_safety_score": {
            "type": "number",
            "minimum": 0,
            "maximum": 100,
            "description": "Overall financial safety score: 0 (High Risk) to 100 (Safe)"
        },
        "critical_risks": {
            "type": "array",
            "items": {"type": "string"},
            "minItems": 2,
            "maxItems": 5,
            "description": "Most severe liability exposures and legal risks identified"
        },
        "mitigation_steps": {
            "type": "array",
            "items": {"type": "string"},
            "minItems": 3,
            "maxItems": 8,
            "description": "Specific actionable steps to reduce risk and protect financial interests"
        },
        "key_financial_terms": {
            "type": "object",
            "properties": {
                "total_value_ugx": {
                    "type": "number",
                    "description": "Total contract value in Ugandan Shillings"
                },
                "payment_terms": {
                    "type": "string",
                    "description": "Payment schedule and terms summary"
                },
                "liability_cap": {
                    "type": "string",
                    "description": "Liability limitations or caps identified"
                },
                "termination_clauses": {
                    "type": "string",
                    "description": "Contract termination conditions and notice requirements"
                }
            },
            "required": ["total_value_ugx", "payment_terms"]
        },
        "risk_category": {
            "type": "string",
            "enum": ["LOW_RISK", "MEDIUM_RISK", "HIGH_RISK", "CRITICAL_RISK"],
            "description": "Overall risk classification for executive decision-making"
        },
        "executive_summary": {
            "type": "string",
            "maxLength": 300,
            "description": "Concise executive summary for senior leadership review"
        },
        "legal_compliance": {
            "type": "object",
            "properties": {
                "ugandan_law_compliance": {
                    "type": "boolean",
                    "description": "Whether contract complies with Ugandan legal requirements"
                },
                "regulatory_concerns": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Specific regulatory compliance issues identified"
                }
            }
        }
    },
    "required": [
        "financial_safety_score",
        "critical_risks", 
        "mitigation_steps",
        "key_financial_terms",
        "risk_category",
        "executive_summary"
    ]
}

# ========================================
# 🧠 AI SYSTEM INSTRUCTION - EXPERT PERSONA
# ========================================

TREASURY_GUARDIAN_SYSTEM_INSTRUCTION = """
🏛️ YOU ARE THE TREASURY GUARDIAN - World-Class Financial Contract Analyst

SPECIALIZATION: Ugandan Law & Financial Risk Assessment
MISSION: Institutional-grade contract vetting with zero tolerance for hidden liabilities

📋 YOUR EXPERTISE:
• Ugandan Contract Law, Commercial Law, and Financial Regulations
• International commercial agreements and cross-border transactions  
• Risk assessment methodologies used by Fortune 500 treasury departments
• Financial exposure analysis and liability quantification
• Regulatory compliance (Bank of Uganda, URA, URSB requirements)

🎯 ANALYSIS METHODOLOGY:
1. FINANCIAL SAFETY SCORING: Calculate 0-100 score based on:
   - Liability exposure magnitude (uncapped = major deduction)
   - Payment risk and cash flow impact
   - Termination and penalty clauses
   - Legal enforceability in Uganda

2. CRITICAL RISK IDENTIFICATION: Focus on:
   - Uncapped liability provisions
   - Immediate termination rights for counterparty  
   - Payment default consequences
   - Regulatory non-compliance risks
   - Currency and foreign exchange exposures

3. MITIGATION STRATEGY: Provide specific, actionable recommendations:
   - Exact clause modifications needed
   - Negotiation talking points
   - Legal safeguards to implement
   - Compliance steps required

⚖️ UGANDAN LAW FOCUS:
- Contract Act (Cap 73) compliance
- Companies Act 2012 requirements
- Exchange Control regulations
- Tax implications and URA compliance
- Stamp duty and registration requirements

🔍 OUTPUT REQUIREMENT: Always structure responses using the provided JSON schema.
Be precise, actionable, and executive-ready in all assessments.
"""

# ========================================
# 🎯 MULTI-MODAL CONTRACT VETTING ENDPOINT
# ========================================

@app.route('/api/ai/vet_contract', methods=['POST'])
@retry_with_backoff(max_retries=3, backoff_factor=2)
def vet_contract():
    """
    🏛️ TREASURY GUARDIAN - Multi-Modal Contract Vetting Endpoint
    
    Performs institutional-grade legal risk assessment on contracts and documents
    using advanced AI analysis with structured financial safety scoring.
    
    Request Format:
    {
        "prompt": "User's analysis question",
        "file_base64": "Base64 encoded document data", 
        "mime_type": "Document MIME type (application/pdf, image/jpeg, etc.)"
    }
    
    Returns:
    Structured JSON with financial_safety_score, critical_risks, mitigation_steps,
    key_financial_terms, and executive-ready risk assessment.
    """
    
    try:
        # 📥 SECURE INPUT EXTRACTION AND VALIDATION
        if not request.is_json:
            return jsonify({
                "error": "TREASURY_GUARDIAN_ERROR",
                "message": "Request must contain JSON data",
                "status": "INVALID_REQUEST_FORMAT"
            }), 400
        
        data = request.get_json()
        
        # Extract and validate required inputs
        prompt = data.get('prompt', '').strip()
        file_base64 = data.get('file_base64', '').strip()
        mime_type = data.get('mime_type', '').strip()
        
        if not prompt:
            return jsonify({
                "error": "TREASURY_GUARDIAN_ERROR",
                "message": "Analysis prompt is required",
                "status": "MISSING_PROMPT"
            }), 400
            
        if not file_base64:
            return jsonify({
                "error": "TREASURY_GUARDIAN_ERROR", 
                "message": "Document file (Base64 encoded) is required for analysis",
                "status": "MISSING_DOCUMENT"
            }), 400
            
        if not mime_type:
            return jsonify({
                "error": "TREASURY_GUARDIAN_ERROR",
                "message": "Document MIME type is required",
                "status": "MISSING_MIME_TYPE" 
            }), 400
        
        # Validate API key configuration
        if not API_KEY:
            return jsonify({
                "error": "TREASURY_GUARDIAN_ERROR",
                "message": "Gemini API key not configured",
                "status": "API_KEY_MISSING"
            }), 500
        
        print(f"🏛️ TREASURY GUARDIAN: Analyzing document of type {mime_type}")
        print(f"📋 Analysis Request: {prompt[:100]}...")
        
        # ========================================
        # 🚀 MULTI-MODAL AI ANALYSIS CONSTRUCTION  
        # ========================================
        
        # Enhanced prompt with Treasury Guardian context
        enhanced_prompt = f"""
        🏛️ TREASURY GUARDIAN ANALYSIS REQUEST:
        
        USER QUESTION: {prompt}
        
        📋 ANALYSIS REQUIREMENTS:
        • Perform institutional-grade legal risk assessment
        • Focus on financial liability exposure and cash flow impact
        • Identify regulatory compliance issues under Ugandan law
        • Calculate precise financial safety score (0-100)
        • Provide executive-ready mitigation strategies
        
        🎯 SPECIAL FOCUS AREAS:
        • Uncapped liability provisions (major red flag)
        • Payment default consequences and penalty structures  
        • Termination clauses and counterparty protection
        • Currency exposure and foreign exchange risks
        • Regulatory compliance (URA, Bank of Uganda, URSB)
        
        ⚖️ Apply expertise in Ugandan Contract Law, Commercial Law, and financial regulations.
        Structure response according to Treasury Guardian schema for executive decision-making.
        """
        
        # Multi-modal payload construction (CRITICAL: Both text + file)
        payload = {
            "contents": [
                {
                    "parts": [
                        {
                            "text": enhanced_prompt
                        },
                        {
                            "inlineData": {
                                "mimeType": mime_type,
                                "data": file_base64
                            }
                        }
                    ]
                }
            ],
            "systemInstruction": {
                "parts": [
                    {
                        "text": TREASURY_GUARDIAN_SYSTEM_INSTRUCTION
                    }
                ]
            },
            "generationConfig": {
                "temperature": 0.1,  # Low temperature for precise legal analysis
                "topK": 40,
                "topP": 0.95,
                "maxOutputTokens": 8192,
                "responseMimeType": "application/json",
                "responseSchema": VETTING_SCHEMA
            }
        }
        
        # ========================================
        # 📡 SECURE API EXECUTION WITH MONITORING
        # ========================================
        
        headers = {
            'Content-Type': 'application/json',
            'User-Agent': 'ICAN-Treasury-Guardian/1.0'
        }
        
        api_url_with_key = f"{GEMINI_API_URL}?key={API_KEY}"
        
        print("🚀 Sending multi-modal analysis request to Gemini API...")
        start_time = time.time()
        
        response = requests.post(
            api_url_with_key,
            headers=headers,
            json=payload,
            timeout=60  # 60 second timeout for complex document analysis
        )
        
        processing_time = time.time() - start_time
        print(f"⏱️ Analysis completed in {processing_time:.2f} seconds")
        
        # ========================================
        # 📊 RESPONSE PROCESSING AND VALIDATION
        # ========================================
        
        if response.status_code != 200:
            error_details = response.text
            print(f"🚨 GEMINI API ERROR: {response.status_code} - {error_details}")
            return jsonify({
                "error": "TREASURY_GUARDIAN_API_ERROR",
                "message": f"AI analysis service returned error: {response.status_code}",
                "status": "EXTERNAL_API_FAILURE",
                "details": error_details[:500]  # Limit error details
            }), 502
        
        # Parse and validate AI response
        try:
            ai_response = response.json()
            
            # Extract the structured analysis from Gemini response
            if 'candidates' in ai_response and len(ai_response['candidates']) > 0:
                candidate = ai_response['candidates'][0]
                if 'content' in candidate and 'parts' in candidate['content']:
                    analysis_text = candidate['content']['parts'][0]['text']
                    
                    # Parse the structured JSON response
                    vetting_analysis = json.loads(analysis_text)
                    
                    # Add metadata for Treasury Guardian tracking
                    vetting_analysis['treasury_guardian_metadata'] = {
                        "analysis_timestamp": int(time.time()),
                        "processing_time_seconds": round(processing_time, 2),
                        "document_type": mime_type,
                        "api_version": "treasury_guardian_v1.0",
                        "risk_assessment_grade": "INSTITUTIONAL"
                    }
                    
                    print("✅ TREASURY GUARDIAN: Analysis completed successfully")
                    print(f"📊 Financial Safety Score: {vetting_analysis.get('financial_safety_score', 'N/A')}")
                    print(f"⚠️ Risk Category: {vetting_analysis.get('risk_category', 'N/A')}")
                    
                    return jsonify({
                        "success": True,
                        "analysis": vetting_analysis,
                        "status": "ANALYSIS_COMPLETE"
                    })
                else:
                    raise ValueError("Invalid response structure from AI service")
            else:
                raise ValueError("No analysis candidates returned from AI service")
                
        except (json.JSONDecodeError, ValueError, KeyError) as e:
            print(f"🚨 RESPONSE PARSING ERROR: {str(e)}")
            return jsonify({
                "error": "TREASURY_GUARDIAN_PARSE_ERROR",
                "message": "Failed to parse AI analysis response",
                "status": "RESPONSE_PARSE_FAILURE",
                "details": str(e)
            }), 500
    
    except requests.exceptions.Timeout:
        print("⏰ TREASURY GUARDIAN: Request timeout")
        return jsonify({
            "error": "TREASURY_GUARDIAN_TIMEOUT",
            "message": "Document analysis request timed out",
            "status": "REQUEST_TIMEOUT"
        }), 408
    
    except requests.exceptions.RequestException as e:
        print(f"🌐 TREASURY GUARDIAN NETWORK ERROR: {str(e)}")
        return jsonify({
            "error": "TREASURY_GUARDIAN_NETWORK_ERROR",
            "message": "Network error during document analysis",
            "status": "NETWORK_FAILURE"
        }), 503
    
    except Exception as e:
        print(f"💥 TREASURY GUARDIAN CRITICAL ERROR: {str(e)}")
        return jsonify({
            "error": "TREASURY_GUARDIAN_SYSTEM_ERROR",
            "message": "Internal system error during analysis",
            "status": "SYSTEM_FAILURE"
        }), 500

# ========================================
# 🔍 HEALTH CHECK AND STATUS ENDPOINTS
# ========================================

@app.route('/api/treasury_guardian/health', methods=['GET'])
def health_check():
    """Treasury Guardian API health check endpoint"""
    return jsonify({
        "status": "OPERATIONAL",
        "service": "Treasury Guardian API",
        "version": "1.0",
        "timestamp": int(time.time()),
        "api_key_configured": bool(API_KEY),
        "capabilities": [
            "multi_modal_analysis",
            "contract_vetting", 
            "financial_risk_assessment",
            "ugandan_law_compliance"
        ]
    })

@app.route('/api/treasury_guardian/schema', methods=['GET'])  
def get_vetting_schema():
    """Return the structured output schema for Treasury Guardian analysis"""
    return jsonify({
        "schema": VETTING_SCHEMA,
        "description": "Treasury Guardian structured analysis output format",
        "version": "1.0"
    })

# ========================================
# 🚀 APPLICATION STARTUP CONFIGURATION
# ========================================

if __name__ == '__main__':
    print("🏛️ TREASURY GUARDIAN API - Starting up...")
    print("📋 Multi-modal contract vetting service initialized")
    print("⚖️ Ugandan law compliance analysis ready")
    print("🔐 Configure GEMINI API_KEY before production use")
    
    # Development server configuration
    app.run(
        host='0.0.0.0',  # Accept connections from any IP
        port=5000,       # Treasury Guardian API port
        debug=True,      # Enable debug mode for development
        threaded=True    # Handle multiple requests concurrently
    )