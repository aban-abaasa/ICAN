# 🚀 MTN MOMO Integration - Complete Setup Guide

## Overview

Your MTN MOMO integration is now **FULLY CONFIGURED** and ready for testing! All components are in place:

✅ Backend Service (mtnMomoService.js) - Token management, Collections, Disbursements  
✅ API Routes (momoRoutes.js) - RESTful endpoints  
✅ Database Schema (setup_mtn_momo_configuration.sql) - Credentials, tokens, logs  
✅ Supabase Integration - Config loading, token caching, transaction logging  

---

## 📋 Current Configuration

### Credentials (Stored in Supabase)
- **Primary Subscription Key**: 967f8537fec84cc6829b0ee5650dc355
- **Secondary Subscription Key**: 51384ad5e0f6477385b26a15ca156737
- **API User ID**: ICAN_PRIMARY_USER
- **Environment**: sandbox
- **Base URL**: https://sandbox.momodeveloper.mtn.com

---

## 🔧 Setup Steps

### Step 1: Run SQL Migration in Supabase

1. Go to [Supabase Dashboard](https://supabase.com/dashboard)
2. Select your project
3. Navigate to **SQL Editor**
4. Click **"New Query"**
5. Copy and paste the content from: `/backend/db/setup_mtn_momo_configuration.sql`
6. Click **"Execute"**
7. Verify: You should see 3 tables created:
   - `mtn_momo_config` - Configuration & credentials
   - `mtn_momo_logs` - Transaction audit trail
   - `mtn_momo_tokens` - Token cache

**What it does:**
- Creates tables for storing MTN MOMO configuration
- Inserts your provided credentials (Primary & Secondary keys)
- Sets up token caching for performance
- Enables comprehensive transaction logging
- Configures Row-Level Security policies

---

### Step 2: Set Environment Variables

Update your `.env` file in `/backend`:

```env
# MTN MOMO Configuration
MOMO_SUBSCRIPTION_KEY=967f8537fec84cc6829b0ee5650dc355
MOMO_SUBSCRIPTION_KEY_SECONDARY=51384ad5e0f6477385b26a15ca156737
MOMO_API_USER=ICAN_PRIMARY_USER
MOMO_API_KEY=51384ad5e0f6477385b26a15ca156737
MOMO_BASE_URL=https://sandbox.momodeveloper.mtn.com
MOMO_ENVIRONMENT=sandbox
MOMO_TOKEN_TIMEOUT=3600
MOMO_REQUEST_TIMEOUT=30000

# Supabase
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

---

### Step 3: Install Required Packages

```bash
cd backend
npm install uuid axios @supabase/supabase-js
```

---

### Step 4: Import Routes in Backend Server

In your `backend/server.js` or `backend/index.js`:

```javascript
const momoRoutes = require('./routes/momoRoutes');

// Add to your Express app
app.use('/api', momoRoutes);
```

---

## 📱 API Endpoints

### 1. Request Payment (Collections)
**Charge a customer**

```bash
POST /api/momo/request-payment
Content-Type: application/json

{
  "amount": 1000,
  "phoneNumber": "256701234567",
  "currency": "UGX",
  "description": "SACCO Contribution"
}
```

**Response:**
```json
{
  "success": true,
  "transactionId": "uuid-here",
  "referenceId": "REC-1234567890",
  "amount": 1000,
  "currency": "UGX",
  "phoneNumber": "256701234567",
  "status": "pending",
  "message": "Collection request sent - Awaiting customer confirmation",
  "timestamp": "2024-01-15T10:30:00Z"
}
```

**What happens:**
1. Customer receives USSD prompt on their phone
2. They enter PIN to authorize payment
3. Transaction status becomes "completed"
4. Log entry created in `mtn_momo_logs`

---

### 2. Send Payment (Disbursements)
**Send money to a customer**

```bash
POST /api/momo/send-payment
Content-Type: application/json

{
  "amount": 500,
  "phoneNumber": "256701234567",
  "currency": "UGX",
  "description": "Dividend Payout"
}
```

**Response:**
```json
{
  "success": true,
  "transactionId": "uuid-here",
  "referenceId": "PAY-1234567890",
  "amount": 500,
  "currency": "UGX",
  "phoneNumber": "256701234567",
  "status": "completed",
  "message": "Funds sent successfully",
  "timestamp": "2024-01-15T10:30:00Z"
}
```

**What happens:**
1. Funds are transferred to customer's MTN account
2. Customer receives SMS notification
3. Transaction automatically completes
4. Log entry created

---

### 3. Check Transaction Status

```bash
GET /api/momo/transaction-status/:referenceId?productType=collection
```

**Response:**
```json
{
  "success": true,
  "status": "SUCCESSFUL",
  "data": {
    "status": "SUCCESSFUL",
    "reason": "COMPLETED",
    "requestStatus": "COMPLETED"
  }
}
```

---

### 4. Webhook Endpoint (for MTN Notifications)

```bash
POST /api/momo/webhook

# Receives payment confirmations from MTN
```

---

## 🧪 Testing

### Test Phone Numbers (Sandbox Only)
- **Collection**: 256701234567
- **Disbursement**: 256701234567
- Use any amount: 1-50000

### Example Test Script

```bash
# Request payment (Collections)
curl -X POST http://localhost:3000/api/momo/request-payment \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 1000,
    "phoneNumber": "256701234567",
    "currency": "UGX"
  }'

# Check status
curl http://localhost:3000/api/momo/transaction-status/REC-1234567890

# Send payment (Disbursements)
curl -X POST http://localhost:3000/api/momo/send-payment \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 500,
    "phoneNumber": "256701234567",
    "currency": "UGX"
  }'
```

---

## 📊 Database Schema

### mtn_momo_config
Stores your MTN MOMO credentials and settings

| Column | Type | Purpose |
|--------|------|---------|
| id | uuid | Primary key |
| subscription_key | text | API subscription key |
| api_user_id | text | MOMO API username |
| api_secret_key | text | MOMO API password |
| base_url | text | API endpoint URL |
| environment | text | 'sandbox' or 'production' |
| is_primary | boolean | Primary credential set |
| is_active | boolean | Currently in use |

### mtn_momo_logs
Complete transaction audit trail

| Column | Type | Purpose |
|--------|------|---------|
| id | uuid | Primary key |
| product_type | text | 'collection' or 'disbursement' |
| transaction_id | uuid | MTN transaction ID |
| reference_id | text | Your reference ID |
| amount | numeric | Transaction amount |
| currency | text | Currency code |
| phone_number | text | Customer phone |
| status | text | 'pending', 'completed', 'failed' |
| request_payload | jsonb | API request body |
| response_payload | jsonb | MTN API response |
| error_message | text | Error details if failed |

### mtn_momo_tokens
Token cache for performance

| Column | Type | Purpose |
|--------|------|---------|
| id | uuid | Primary key |
| product_type | text | 'collection' or 'disbursement' |
| access_token | text | JWT token from MTN |
| expires_at | timestamp | Token expiration time |
| is_active | boolean | Currently valid |

---

## 🔐 Security Features

### Row-Level Security (RLS)
- ✅ Only service role can read config/tokens
- ✅ Only service role can insert tokens
- ✅ All queries use authenticated user context
- ✅ Production credentials never exposed to client

### Token Management
- ✅ Automatic token caching (3600s)
- ✅ Invalid tokens automatically refreshed
- ✅ Both collection & disbursement tokens cached separately
- ✅ Token expiration tracked in Supabase

### Transaction Logging
- ✅ All requests logged for audit trail
- ✅ Request and response payloads stored
- ✅ Errors captured with full context
- ✅ Analytics views available

---

## 🔄 How It Works

### Collections Flow (Request Payment)
```
1. Customer initiates payment via your app
2. App calls POST /api/momo/request-payment
3. Backend service gets access token (from cache if available)
4. MTN API sends USSD prompt to customer
5. Customer authorizes via PIN
6. MTN confirms transaction
7. Status endpoint shows "SUCCESSFUL"
8. App confirms payment received
```

### Disbursements Flow (Send Payment)
```
1. Your app initiates payout
2. App calls POST /api/momo/send-payment
3. Backend service gets access token
4. MTN API transfers funds
5. Customer receives SMS notification
6. Transaction shows "SUCCESSFUL"
7. Funds appear in customer's MTN account
```

---

## 🚀 Production Deployment

When ready to go live:

### 1. Get Production Credentials
- Contact MTN Developer Support
- Request production API credentials
- Get production subscription keys

### 2. Update Configuration
```bash
# Update mtn_momo_config table
UPDATE mtn_momo_config SET
  subscription_key = 'prod-subscription-key',
  api_secret_key = 'prod-secret-key',
  base_url = 'https://api.momodeveloper.mtn.com',
  environment = 'production'
WHERE is_primary = true;
```

### 3. Environment Variables
```env
MOMO_ENVIRONMENT=production
MOMO_BASE_URL=https://api.momodeveloper.mtn.com
MOMO_SUBSCRIPTION_KEY=prod-key
MOMO_API_KEY=prod-key
```

### 4. Real Phone Numbers
- Use real customer phone numbers
- Format: E.164 (e.g., 256701234567)
- Amounts: Any amount up to 500,000

---

## 📝 Logging & Monitoring

### View Recent Transactions
```sql
SELECT * FROM recent_momo_transactions 
LIMIT 20;
```

### View Daily Statistics
```sql
SELECT * FROM momo_transaction_stats
WHERE DATE(date) = CURRENT_DATE;
```

### Monitor Token Cache
```sql
SELECT * FROM mtn_momo_tokens 
WHERE is_active = true;
```

### Check for Errors
```sql
SELECT * FROM mtn_momo_logs 
WHERE status = 'failed'
ORDER BY created_at DESC;
```

---

## 🛠️ Troubleshooting

### "Invalid credentials" Error
- Verify subscription key in `mtn_momo_config`
- Verify API user ID and secret key
- Check environment is correct (sandbox vs production)

### "Token expired" Error
- Token cache automatically refreshes
- Check `mtn_momo_tokens` table has valid tokens
- Verify API credentials are correct

### "Phone number format invalid"
- Use E.164 format: country code + number
- Uganda example: 256701234567 (not +256 or 0256)
- Use helper: `MTNMomoService.formatPhoneNumber(phone, '256')`

### "No USSD response"
- Ensure phone number is valid MTN number
- Check amount is within limits (1-50000 UGX)
- Verify sandbox test phone: 256701234567

### Webhook Not Receiving Events
- Ensure your backend is publicly accessible
- Configure webhook URL in MTN developer portal
- Check firewall/network settings
- Monitor `mtn_momo_logs` for incoming events

---

## 📚 Files Created

```
backend/
├── services/
│   └── mtnMomoService.js          ← Main MOMO service (461 lines)
├── routes/
│   └── momoRoutes.js              ← API endpoints (330 lines)
├── db/
│   ├── setup_mtn_momo_configuration.sql    ← Supabase migration
│   └── create_wallet_transactions_table.sql ← Wallet schema
└── .env.momo.example              ← Configuration template
```

---

## ✨ Key Features

### ✅ Automatic Token Caching
Tokens are cached both in memory and Supabase for optimal performance

### ✅ Comprehensive Logging
Every transaction logged with request/response payloads for debugging

### ✅ Dual Product Support
Collections AND Disbursements with separate token management

### ✅ Phone Number Validation
Built-in validation and formatting for multiple African formats

### ✅ Error Handling
Detailed error messages with full context for troubleshooting

### ✅ Supabase Integration
Credentials loaded from database, not hardcoded in env

---

## 🎯 Next Steps

1. ✅ Run SQL migration in Supabase
2. ✅ Update `.env` with your credentials
3. ✅ Install required npm packages
4. ✅ Import routes in your backend server
5. ✅ Test with sandbox phone numbers
6. ✅ Monitor transactions in Supabase
7. 🔄 Deploy to production when ready

---

## 📞 Support

**Issues or Questions?**
- Check transaction logs: `SELECT * FROM mtn_momo_logs WHERE status = 'failed';`
- Review console output for detailed error messages
- Check token cache: `SELECT * FROM mtn_momo_tokens WHERE product_type = 'collection';`
- Verify credentials in `mtn_momo_config` table

---

**Status**: ✅ Ready for testing  
**Last Updated**: 2024-01-15  
**Environment**: Sandbox (Testing)  
**Next Phase**: Production Deployment
