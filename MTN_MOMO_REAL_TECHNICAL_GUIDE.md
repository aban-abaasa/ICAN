# REAL MTN MOMO API - Technical Deep Dive

**Date:** January 20, 2026  
**Purpose:** Understand EXACTLY how MTN MOMO API authentication works (no foolishness)

---

## Your Actual Credentials

| Credential | Value |
|-----------|-------|
| **API User ID** | `550e8400-e29b-41d4-a716-446655440000` |
| **API Key** | `0c83153ce97f40c68622c16a2d69d69e` |
| **Subscription Key** | `8b59afc46b7a43b0a32856e709af1de3` |
| **Environment** | `sandbox` |
| **Base URL** | `https://sandbox.momodeveloper.mtn.com` |

---

## The Three Parts of MTN Authentication

### Part 1: Initial Authentication (Get Bearer Token)

**Endpoint:** `POST /collection/token/`

**What You Send:**
```
Headers:
  Ocp-Apim-Subscription-Key: 8b59afc46b7a43b0a32856e709af1de3
  X-Reference-Id: [random UUID]

Auth (HTTP Basic):
  username: 550e8400-e29b-41d4-a716-446655440000
  password: 0c83153ce97f40c68622c16a2d69d69e
```

**How Axios Handles It:**
```javascript
// Axios automatically encodes credentials when you use auth field:
auth: {
  username: apiUser,
  password: apiKey
}

// Axios internally converts this to:
// Authorization: Basic [base64(username:password)]
// BUT more importantly: MTN API validates these credentials server-side
```

**What MTN Returns:**
```json
{
  "access_token": "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9...",
  "token_type": "Bearer",
  "expires_in": 3600
}
```

**Important:** 
- Token is valid for ~3600 seconds (1 hour)
- Cache the token - don't request a new one for every API call
- Include this token in all subsequent requests

---

### Part 2: Using the Bearer Token (Actual API Calls)

**Endpoint:** `POST /collection/v1_0/requesttopay`

**What You Send:**
```
Headers:
  Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9...
  Ocp-Apim-Subscription-Key: 8b59afc46b7a43b0a32856e709af1de3
  X-Reference-Id: [different random UUID for each request]

Body (JSON):
{
  "amount": "50000",
  "currency": "UGX",
  "externalId": "REQ-1705765432100",
  "payer": {
    "partyIdType": "MSISDN",
    "partyId": "256701234567"
  },
  "payerMessage": "ICAN Investment Payment",
  "payeeNote": "Payment received"
}
```

**What MTN Returns (202 Accepted):**
```json
{
  "referenceId": "a1b2c3d4e5f6g7h8i9j0",
  "status": "PENDING"
}
```

**Important:**
- Use the Bearer token from Part 1
- Each request needs a UNIQUE X-Reference-Id
- Status 202 means MTN accepted it (not yet completed)
- Save the referenceId to check status later

---

### Part 3: Checking Transaction Status

**Endpoint:** `GET /collection/v1_0/requesttopay/{referenceId}`

**What You Send:**
```
Headers:
  Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9...
  Ocp-Apim-Subscription-Key: 8b59afc46b7a43b0a32856e709af1de3
  X-Reference-Id: [another unique UUID]
```

**What MTN Returns:**
```json
{
  "referenceId": "a1b2c3d4e5f6g7h8i9j0",
  "status": "SUCCESSFUL",
  "amount": "50000",
  "currency": "UGX",
  "financialTransactionId": "1234567890",
  "reason": "Transaction Successful"
}
```

**Possible Status Values:**
- `PENDING` - Transaction still being processed
- `SUCCESSFUL` - Money received ✅
- `FAILED` - Transaction failed ❌
- `EXPIRED` - Request expired before customer responded

---

## The Complete Real Workflow

```
┌─────────────────────────────────────────────────────────────────┐
│                    YOUR APPLICATION                             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
    ┌──────────────────────────────────────────────────────┐
    │ STEP 1: Authenticate                                 │
    │ POST https://sandbox.momodeveloper.mtn.com/collection/token/
    │                                                       │
    │ Send: API User + API Key                             │
    │ Get: Bearer Token (valid 3600 seconds)               │
    └──────────────────────────────────────────────────────┘
                              │
                    Save token in cache
                              │
                              ▼
    ┌──────────────────────────────────────────────────────┐
    │ STEP 2: Request Money                                │
    │ POST /collection/v1_0/requesttopay                   │
    │                                                       │
    │ Send: Bearer Token + Phone + Amount                  │
    │ Get: Reference ID + Status (PENDING)                 │
    └──────────────────────────────────────────────────────┘
                              │
                    Save reference ID
                              │
                              ▼
    ┌──────────────────────────────────────────────────────┐
    │ STEP 3: Wait & Check Status                          │
    │ GET /collection/v1_0/requesttopay/{referenceId}      │
    │                                                       │
    │ Send: Bearer Token + Reference ID                    │
    │ Get: Final Status (SUCCESSFUL/FAILED/PENDING)        │
    └──────────────────────────────────────────────────────┘
                              │
                    Update database with result
                              │
                              ▼
                        ✅ DONE or ❌ FAILED
```

---

## Real Code Example (Node.js)

```javascript
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

const API_USER = '550e8400-e29b-41d4-a716-446655440000';
const API_KEY = '0c83153ce97f40c68622c16a2d69d69e';
const SUBSCRIPTION_KEY = '8b59afc46b7a43b0a32856e709af1de3';
const BASE_URL = 'https://sandbox.momodeveloper.mtn.com';

// STEP 1: Get Bearer Token
async function getToken() {
  const response = await axios.post(
    `${BASE_URL}/collection/token/`,
    {},
    {
      headers: {
        'Ocp-Apim-Subscription-Key': SUBSCRIPTION_KEY,
        'X-Reference-Id': uuidv4()
      },
      auth: {
        username: API_USER,
        password: API_KEY
      }
    }
  );

  return response.data.access_token;
}

// STEP 2: Request Money
async function requestMoney(token, phone, amount) {
  const response = await axios.post(
    `${BASE_URL}/collection/v1_0/requesttopay`,
    {
      amount: String(amount),
      currency: 'UGX',
      externalId: `REQ-${Date.now()}`,
      payer: {
        partyIdType: 'MSISDN',
        partyId: phone
      },
      payerMessage: 'ICAN Payment',
      payeeNote: 'Payment received'
    },
    {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Ocp-Apim-Subscription-Key': SUBSCRIPTION_KEY,
        'X-Reference-Id': uuidv4()
      }
    }
  );

  return response.data;
}

// STEP 3: Check Status
async function checkStatus(token, referenceId) {
  const response = await axios.get(
    `${BASE_URL}/collection/v1_0/requesttopay/${referenceId}`,
    {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Ocp-Apim-Subscription-Key': SUBSCRIPTION_KEY,
        'X-Reference-Id': uuidv4()
      }
    }
  );

  return response.data;
}

// USAGE:
async function main() {
  try {
    // Get token
    const token = await getToken();
    console.log('✅ Got Bearer Token');

    // Request money
    const result = await requestMoney(token, '256701234567', 50000);
    console.log('✅ Money Requested:', result);

    // Wait 2 seconds
    await new Promise(r => setTimeout(r, 2000));

    // Check status
    const status = await checkStatus(token, result.referenceId);
    console.log('✅ Status:', status);
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

main();
```

---

## Error Handling

### Common Errors & Solutions

| Error | Cause | Solution |
|-------|-------|----------|
| 401 Unauthorized | Invalid API User or API Key | Verify credentials from database |
| 403 Forbidden | Invalid Subscription Key | Check Subscription Key value |
| 400 Bad Request | Invalid request body | Check JSON format, currency, phone format |
| 429 Too Many Requests | Rate limited | Implement backoff and retry logic |
| 500 Internal Server Error | MTN API issue | Retry after 5 seconds |

---

## Integration with Supabase

Your credentials and tokens are stored in:

### Table: `mtn_momo_config`
```sql
SELECT * FROM mtn_momo_config WHERE is_primary = true;
-- Gets your API_User, API_Key, Subscription_Key
```

### Table: `mtn_momo_tokens`
```sql
-- Cache retrieved tokens here to avoid repeated authentication
INSERT INTO mtn_momo_tokens (config_id, product_type, access_token, expires_at)
VALUES (...);
```

### Table: `mtn_momo_logs`
```sql
-- Log all transactions for audit trail
INSERT INTO mtn_momo_logs (transaction_id, product_type, status, amount, ...)
VALUES (...);
```

---

## Important Notes

1. **API User is NOT a UUID** - It's a credentials field used for authentication
2. **API Key is NOT Basic Auth** - It's used with the auth field in axios
3. **Subscription Key identifies your subscription** - Required in every request header
4. **Bearer Token is temporary** - Cache it, don't request new one for each call
5. **X-Reference-Id must be unique** - Generate new UUID for each request
6. **Phone format matters** - Use E.164 format (256701234567 for Uganda)

---

## Files in This Implementation

- `realMTNMomoAuth.js` - Real authentication with detailed logging
- `momoIntegrationService.js` - Production-ready service with Supabase
- `momoIntegrationExamples.js` - Usage examples

Run real test:
```bash
node backend/services/realMTNMomoAuth.js
```

---

**Last Updated:** January 20, 2026  
**Status:** ✅ Real Implementation (No Foolishness)
