# 🏛️ Treasury Guardian API

## Institutional-Grade Legal Risk Assessment & Contract Vetting

The Treasury Guardian API provides enterprise-level document analysis capabilities for contract vetting, legal risk assessment, and financial safety evaluation, specialized for Ugandan law and financial regulations.

## 🚀 Quick Start

### 1. Install Dependencies
```bash
pip install -r requirements.txt
```

### 2. Configure API Key
```bash
# Copy configuration template
cp treasury_guardian_config.env .env

# Edit .env and add your Gemini API key
GEMINI_API_KEY=your_actual_api_key_here
```

### 3. Start the API Server
```bash
python treasury_guardian_api.py
```

The API will be available at: `http://localhost:5000`

## 📋 API Endpoints

### Contract Vetting Endpoint
**POST** `/api/ai/vet_contract`

Performs multi-modal analysis of contracts and legal documents.

#### Request Format
```json
{
    "prompt": "Is this lease agreement safe for our company?",
    "file_base64": "base64_encoded_document_data",
    "mime_type": "application/pdf"
}
```

#### Response Format
```json
{
    "success": true,
    "analysis": {
        "financial_safety_score": 75,
        "risk_category": "MEDIUM_RISK",
        "critical_risks": [
            "Uncapped liability clause in section 12",
            "30-day termination right for landlord"
        ],
        "mitigation_steps": [
            "Request liability cap at 6 months rent",
            "Negotiate 90-day termination notice",
            "Add tenant protection clause"
        ],
        "key_financial_terms": {
            "total_value_ugx": 24000000,
            "payment_terms": "Monthly advance payment",
            "liability_cap": "Unlimited",
            "termination_clauses": "30 days notice required"
        },
        "executive_summary": "Medium risk lease with uncapped liability requiring negotiation of protective clauses.",
        "legal_compliance": {
            "ugandan_law_compliance": true,
            "regulatory_concerns": ["No stamp duty provision mentioned"]
        }
    }
}
```

### Health Check
**GET** `/api/treasury_guardian/health`

Returns API status and configuration information.

### Schema Information  
**GET** `/api/treasury_guardian/schema`

Returns the structured output schema for analysis results.

## 🎯 Supported File Types

- **PDF Documents**: `application/pdf`
- **Images**: `image/jpeg`, `image/png`, `image/webp`
- **Microsoft Word**: `application/vnd.openxmlformats-officedocument.wordprocessingml.document`

## 🛡️ Features

### 🧠 AI-Powered Analysis
- **Multi-modal Processing**: Analyzes both text prompts and document files
- **Structured Output**: Consistent JSON schema for integration
- **Ugandan Law Specialization**: Expert knowledge of local regulations

### 📊 Financial Risk Assessment
- **Safety Scoring**: 0-100 scale financial safety assessment
- **Risk Categorization**: LOW/MEDIUM/HIGH/CRITICAL classifications  
- **Liability Analysis**: Identification of financial exposure points
- **Mitigation Strategies**: Actionable steps to reduce risk

### ⚖️ Legal Compliance
- **Contract Act Compliance**: Uganda Contract Act (Cap 73) analysis
- **Regulatory Review**: URA, Bank of Uganda, URSB requirements
- **Commercial Law**: International and domestic commercial agreements
- **Risk Quantification**: Precise financial impact assessment

### 🔄 Enterprise Features  
- **Retry Logic**: Exponential backoff for reliability
- **Error Handling**: Comprehensive error response system
- **Monitoring**: Request tracking and performance metrics
- **Security**: Input validation and sanitization

## 🔧 Configuration Options

### Environment Variables
```bash
# Required
GEMINI_API_KEY=your_gemini_api_key

# Optional
TG_API_PORT=5000
TG_DEBUG_MODE=True
TG_MAX_RETRIES=3
TG_TIMEOUT_SECONDS=60
```

### Production Deployment
```bash
# Using Gunicorn for production
gunicorn -w 4 -b 0.0.0.0:5000 treasury_guardian_api:app
```

## 📈 Financial Safety Score Methodology

| Score Range | Classification | Risk Level | Recommended Action |
|-------------|---------------|------------|-------------------|
| 90-100 | LOW_RISK | ✅ Safe | Proceed with minor review |
| 70-89 | MEDIUM_RISK | ⚠️ Caution | Review and negotiate key terms |
| 40-69 | HIGH_RISK | ⛔ Warning | Major revisions required |
| 0-39 | CRITICAL_RISK | 🚨 Danger | Do not proceed without legal counsel |

## 🎯 Use Cases

### 📝 Contract Types Supported
- **Real Estate**: Lease agreements, purchase contracts, property development
- **Business**: Service agreements, supplier contracts, partnership deals  
- **Financial**: Loan agreements, investment contracts, banking documents
- **Employment**: Employment contracts, consultant agreements, NDAs
- **International**: Cross-border agreements, import/export contracts

### 💼 Industry Applications
- **Banking & Finance**: Loan document review and risk assessment
- **Real Estate**: Property transaction analysis and due diligence
- **Corporate Legal**: Contract negotiation support and risk management
- **Government**: Procurement contract evaluation and compliance
- **Insurance**: Policy analysis and claims assessment

## 🔐 Security & Compliance

- **Data Privacy**: No document storage, analysis only
- **Encryption**: HTTPS/TLS for all communications  
- **Input Validation**: Comprehensive request sanitization
- **Rate Limiting**: Protection against abuse
- **Audit Trail**: Request logging for compliance

## 📞 Support & Integration

### Integration Examples
```python
import requests
import base64

# Example: Analyze a PDF contract
with open('contract.pdf', 'rb') as f:
    file_data = base64.b64encode(f.read()).decode('utf-8')

response = requests.post('http://localhost:5000/api/ai/vet_contract', 
    json={
        'prompt': 'Analyze this lease agreement for financial risks',
        'file_base64': file_data,
        'mime_type': 'application/pdf'
    }
)

analysis = response.json()['analysis']
safety_score = analysis['financial_safety_score']
```

### Error Handling
All API responses include proper HTTP status codes and structured error messages:

```json
{
    "error": "TREASURY_GUARDIAN_ERROR",
    "message": "Descriptive error message",
    "status": "ERROR_CODE",
    "details": "Additional context if available"
}
```

## 📚 Documentation

- **API Reference**: Complete endpoint documentation with examples
- **Integration Guide**: Step-by-step integration instructions  
- **Legal Framework**: Ugandan law compliance requirements
- **Best Practices**: Optimal usage patterns for different scenarios

---

**🏛️ Treasury Guardian** - Protecting your financial interests with AI-powered legal intelligence.