# 🚀 ICAN NLP Transaction Processor - Integration Guide

## API Status: ✅ RUNNING
- **Endpoint**: `http://localhost:5000/api/ai/parse_transaction`
- **Health Check**: `http://localhost:5000/api/health`
- **Test Suite**: `http://localhost:5000/api/test`

## 🔗 React Integration

### 1. Update Your Smart Transaction Entry Component

Add this API integration function to your `ICAN_Capital_Engine.jsx`:

```javascript
// Add this API integration function
const processTransactionWithAI = async (userText) => {
  try {
    const response = await fetch('http://localhost:5000/api/ai/parse_transaction', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: userText
      })
    });

    const result = await response.json();
    
    if (result.success) {
      return {
        success: true,
        transaction: result.transaction,
        confidence: result.ai_confidence,
        processingTime: result.processing_time
      };
    } else {
      throw new Error(result.error || 'Failed to process transaction');
    }
  } catch (error) {
    console.error('AI Processing Error:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

// Update your handleSmartEntry function
const handleSmartEntry = async () => {
  if (!smartEntry.trim()) return;

  setIsProcessing(true);
  
  try {
    // Process with AI API
    const aiResult = await processTransactionWithAI(smartEntry);
    
    if (aiResult.success) {
      const { transaction } = aiResult;
      
      // Create the transaction object with sequential ID
      const newTransaction = {
        id: transactions.length, // Sequential ID: 0, 1, 2, 3...
        amount: transaction.amount_ugx,
        type: transaction.type,
        category: transaction.category,
        description: transaction.description,
        date: new Date().toISOString().split('T')[0],
        timestamp: new Date().toISOString(),
        source: 'AI_PROCESSED',
        confidence: aiResult.confidence,
        originalText: smartEntry
      };

      // Add to transactions
      setTransactions(prev => [newTransaction, ...prev]);
      
      // Clear input and show success
      setSmartEntry('');
      setProcessingStatus(`✅ Processed with ${aiResult.confidence} confidence`);
      
      // Auto-clear status after 3 seconds
      setTimeout(() => setProcessingStatus(''), 3000);
      
    } else {
      // Fallback to your existing parsing if AI fails
      const parsed = intelligentNLPParser(smartEntry);
      // ... your existing fallback code
      setProcessingStatus('⚠️ Used fallback processing');
    }
  } catch (error) {
    setProcessingStatus('❌ Processing failed');
    console.error('Smart entry error:', error);
  } finally {
    setIsProcessing(false);
  }
};
```

### 2. Add Processing State Variables

Add these to your component state:

```javascript
const [isProcessing, setIsProcessing] = useState(false);
const [processingStatus, setProcessingStatus] = useState('');
```

### 3. Update Your Smart Entry UI

```javascript
{/* Smart Transaction Entry with AI Processing */}
<div className="bg-gradient-to-r from-purple-50 to-blue-50 p-6 rounded-xl border border-purple-200">
  <div className="flex items-center gap-3 mb-4">
    <Brain className="h-6 w-6 text-purple-600" />
    <h3 className="text-lg font-semibold text-gray-800">Smart Transaction Entry</h3>
    {isProcessing && (
      <div className="flex items-center gap-2 text-purple-600">
        <div className="animate-spin rounded-full h-4 w-4 border-2 border-purple-600 border-t-transparent"></div>
        <span className="text-sm">Processing...</span>
      </div>
    )}
  </div>

  <div className="space-y-4">
    <div className="relative">
      <input
        type="text"
        value={smartEntry}
        onChange={(e) => setSmartEntry(e.target.value)}
        placeholder="Tell me about your transaction... (e.g., 'bought groceries 50k at shoprite')"
        className="w-full p-4 border border-purple-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
        onKeyPress={(e) => e.key === 'Enter' && handleSmartEntry()}
        disabled={isProcessing}
      />
      <button
        onClick={handleSmartEntry}
        disabled={!smartEntry.trim() || isProcessing}
        className="absolute right-2 top-2 px-6 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {isProcessing ? 'Processing...' : 'Process'}
      </button>
    </div>

    {processingStatus && (
      <div className={`p-3 rounded-lg text-sm ${
        processingStatus.includes('✅') 
          ? 'bg-green-100 text-green-800 border border-green-200'
          : processingStatus.includes('⚠️')
          ? 'bg-yellow-100 text-yellow-800 border border-yellow-200'
          : 'bg-red-100 text-red-800 border border-red-200'
      }`}>
        {processingStatus}
      </div>
    )}
  </div>
</div>
```

## 🧪 API Testing Examples

You can test the API directly with these examples:

### Using PowerShell:
```powershell
# Test health endpoint
Invoke-RestMethod -Uri "http://localhost:5000/api/health" -Method GET

# Test transaction parsing
$body = @{
    text = "bought groceries 45000 at nakumatt"
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://localhost:5000/api/ai/parse_transaction" -Method POST -Body $body -ContentType "application/json"
```

### Expected Response:
```json
{
    "success": true,
    "transaction": {
        "amount_ugx": 45000,
        "type": "EXPENSE",
        "category": "Grocery Shopping", 
        "description": "Groceries at Nakumatt",
        "parsed_at": "2025-10-06T12:00:00.000Z",
        "original_text": "bought groceries 45000 at nakumatt"
    },
    "processing_time": 1.23,
    "ai_confidence": "high",
    "api_version": "1.0.0"
}
```

## 🎯 Creative Test Cases

The API handles these creative patterns:

1. **"sold a land at 100000000"** → Income: UGX 100,000,000
2. **"salary 2.5M monthly"** → Income: UGX 2,500,000
3. **"borrowed 800k for business"** → Loan: UGX 800,000
4. **"tithe 50000 church offering"** → Tithing: UGX 50,000
5. **"lunch at cafe 15k"** → Expense: UGX 15,000
6. **"bought shirt 900000000"** → Expense: UGX 900,000,000

## 🔧 Environment Setup

### Required Environment Variable:
Add your Gemini API key to environment variables or create `.env` file:

```bash
# .env file
GEMINI_API_KEY=your_actual_gemini_api_key_here
```

### Install python-dotenv for .env support:
```bash
pip install python-dotenv
```

## 🚀 Production Deployment

For production, consider:
1. Use a proper WSGI server (gunicorn, waitress)
2. Add rate limiting and authentication
3. Configure proper logging and monitoring
4. Set up HTTPS with SSL certificates
5. Use environment variables for all sensitive data

---

**Your ICAN NLP Transaction Processor is now ready for integration!** 

The API provides intelligent, creative transaction parsing with fallback mechanisms to ensure reliability. It perfectly matches your sequential ID requirements (0,1,2,3...) and integrates seamlessly with your existing React application.