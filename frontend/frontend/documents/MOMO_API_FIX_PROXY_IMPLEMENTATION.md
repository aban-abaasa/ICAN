# MTN MOMO API - Frontend-Backend Proxy Fix

## Problem Identified

The frontend MOMO service was attempting to make direct API calls to MTN MOMO with the **wrong endpoint URL**:
- âŒ **Wrong:** `https://api.sandbox.momoapi.mtn.com` (not a real MTN API endpoint)
- âœ… **Correct:** `https://sandbox.momodeveloper.mtn.com` (real MTN API endpoint)

### Error Message
```
api.sandbox.momoapi.mtn.com/transfer:1 
Failed to load resource: net::ERR_NAME_NOT_RESOLVED
momoService.js:182 
TypeError: Failed to fetch
```

### Root Causes
1. **Direct API calls from browser** - Frontend was calling MOMO API directly (security issue)
2. **CORS violation** - Browser blocks cross-origin requests to external API
3. **Wrong endpoint URL** - Hardcoded incorrect MTN MOMO sandbox URL
4. **Credential exposure** - API keys would be exposed to browser

---

## Solution Implemented

### Architecture Change: Frontend â†’ Backend Proxy â†’ MTN MOMO API

```
Frontend momoService
    â†“
    POST http://localhost:5000/api/momo/*
    â†“
Backend Express Server (Frontend Server)
    â†“
Backend momoIntegrationService
    â†“
https://sandbox.momodeveloper.mtn.com (Real MTN API)
```

### Changes Made

#### 1. **Frontend Service Updated** (`frontend/src/services/momoService.js`)

**Before:**
```javascript
// âŒ WRONG - Direct API calls with wrong endpoint
this.apiUrl = 'https://api.sandbox.momoapi.mtn.com';
const response = await fetch(`${this.apiUrl}/transfer`, {...});
```

**After:**
```javascript
// âœ… CORRECT - Backend proxy pattern
this.backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000/api';
const response = await fetch(`${this.backendUrl}/momo/request-payment`, {...});
```

**Key Changes:**
- Removed direct MOMO API calls
- Implemented `callBackendAPI()` method for backend proxy calls
- Updated all transaction methods to use backend:
  - `processTopUp()` â†’ calls `/momo/request-payment`
  - `processTransfer()` â†’ calls `/momo/send-payment`
  - `checkTransactionStatus()` â†’ calls `/momo/check-status`
  - `getAccountBalance()` â†’ calls `/momo/get-balance`
  - `createPaymentLink()` â†’ calls `/momo/create-payment-link`

#### 2. **Backend Routes Enhanced** (`backend/routes/momoRoutes.js`)

**New Endpoints Added:**
```javascript
GET    /api/momo/health              // Health check
POST   /api/momo/check-status        // Check transaction status
POST   /api/momo/get-balance         // Get account balance
POST   /api/momo/create-payment-link // Create payment link
```

**Existing Endpoints:**
```javascript
POST   /api/momo/request-payment     // Collections (charge customer)
POST   /api/momo/send-payment        // Disbursement (pay customer)
```

#### 3. **Backend Server Updated** (`frontend/server/index.js`)

**Added MOMO Routes Import:**
```javascript
import momoRoutes from '../backend/routes/momoRoutes.js';

// Mount routes
app.use('/api/momo', momoRoutes);
```

#### 4. **Frontend Environment Updated** (`frontend/.env`)

**Added Backend URL:**
```dotenv
# Backend API Configuration
VITE_BACKEND_URL=http://localhost:5000/api

# Mock mode for development
VITE_MOMO_USE_MOCK=false
```

**Removed:**
- Direct MOMO API credentials from frontend `.env`
- Sensitive API keys now only in backend `.env`

---

## Security Benefits

âœ… **Credential Protection**
- API keys NO LONGER exposed in frontend code
- Credentials stored securely in backend environment variables
- Supabase database as secondary storage

âœ… **CORS Compliance**
- No direct cross-origin API calls from browser
- All requests proxied through same-origin backend

âœ… **Request Validation**
- Backend validates all inputs before calling MTN API
- Rate limiting on backend
- Request signing/authentication on backend

âœ… **Transaction Logging**
- All transactions logged in Supabase
- Audit trail for compliance

---

## How It Works Now

### Example Flow: Top-Up Transaction

1. **Frontend (momoService.js)**
   ```javascript
   await momoService.processTopUp({
     amount: 50000,
     currency: 'UGX',
     phoneNumber: '+256701234567',
     description: 'ICAN Wallet Top-Up'
   });
   ```

2. **Frontend calls Backend**
   ```
   POST http://localhost:5000/api/momo/request-payment
   {
     "amount": "50000",
     "currency": "UGX",
     "phoneNumber": "+256701234567",
     "description": "ICAN Wallet Top-Up"
   }
   ```

3. **Backend Service (momoIntegrationService.js)**
   - Retrieves credentials from Supabase
   - Validates phone number format
   - Gets or creates Bearer token
   - Calls MTN MOMO API with correct endpoint:
     ```
     POST https://sandbox.momodeveloper.mtn.com/collection/v1_0/requesttopay
     Authorization: Bearer {token}
     ```

4. **Backend Response to Frontend**
   ```json
   {
     "success": true,
     "transactionId": "TXN-123456",
     "amount": 50000,
     "currency": "UGX",
     "status": "COMPLETED",
     "timestamp": "2024-01-15T10:30:00.000Z"
   }
   ```

5. **Frontend Updates UI**
   - Displays success message
   - Updates wallet balance
   - Logs transaction

---

## Configuration

### Development

**.env (Frontend)**
```dotenv
VITE_BACKEND_URL=http://localhost:5000/api
VITE_MOMO_USE_MOCK=false
```

**.env (Backend)**
```dotenv
PORT=5000
SUPABASE_URL=https://hswxazpxcgtqbxeqcxxw.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_key

# MOMO Credentials (from Supabase database)
MOMO_SUBSCRIPTION_KEY=YOUR_SUBSCRIPTION_KEY_HERE
MOMO_API_USER=550e8400-e29b-41d4-a716-446655440000
MOMO_API_KEY=YOUR_API_SECRET_HERE
MOMO_BASE_URL=https://sandbox.momodeveloper.mtn.com
```

### Production

```dotenv
VITE_BACKEND_URL=https://api.ican-capital.com/api
VITE_MOMO_USE_MOCK=false
```

---

## Testing

### 1. Health Check
```bash
curl http://localhost:5000/api/momo/health
```

**Expected Response:**
```json
{
  "success": true,
  "status": "healthy",
  "message": "MOMO API proxy is running"
}
```

### 2. Test Transaction (Mock Mode)

In `.env`, set:
```dotenv
VITE_MOMO_USE_MOCK=true
```

Then in ICANWallet, click "Top-Up" with:
- Amount: 50000
- Phone: 256701234567
- Currency: UGX

Expected: Simulated success response (no real API call)

### 3. Real Transaction

When ready, set:
```dotenv
VITE_MOMO_USE_MOCK=false
```

Same steps as above, but will call real MTN API

---

## Files Modified

| File | Change | Status |
|------|--------|--------|
| `frontend/src/services/momoService.js` | Refactored to use backend proxy | âœ… Complete |
| `backend/routes/momoRoutes.js` | Added health & utility endpoints | âœ… Complete |
| `frontend/server/index.js` | Mounted MOMO routes | âœ… Complete |
| `frontend/.env` | Added VITE_BACKEND_URL | âœ… Complete |
| `ICANWallet.jsx` | No changes needed (already calls momoService correctly) | âœ… Already compatible |
| `walletService.js` | No changes needed (calls momoService) | âœ… Already compatible |

---

## Error Resolution

### Previous Error
```
api.sandbox.momoapi.mtn.com/transfer:1
Failed to load resource: net::ERR_NAME_NOT_RESOLVED
TypeError: Failed to fetch
```

### Root Cause
- Frontend directly calling wrong MTN MOMO endpoint
- CORS blocking cross-origin request
- DNS unable to resolve fake endpoint

### Fixed By
- âœ… Frontend now calls backend proxy (`/api/momo/*`)
- âœ… Backend calls real MTN endpoint
- âœ… No CORS issues (same origin)
- âœ… Correct endpoint URL used

---

## Next Steps

1. **Testing**
   - Test with mock mode first
   - Verify Supabase logging
   - Test with real transaction

2. **Monitoring**
   - Check backend logs for errors
   - Monitor Supabase transaction table
   - Set up alerts for failed transactions

3. **Documentation**
   - Update API documentation
   - Create developer guide for MOMO integration
   - Document callback/webhook handling

---

## Status

ðŸŸ¢ **COMPLETE** - Frontend-Backend MOMO API integration now properly implemented with security best practices.

All transactions now properly routed through backend proxy to real MTN MOMO API.

**Ready for testing and deployment!**
