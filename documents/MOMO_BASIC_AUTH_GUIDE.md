<!-- MOMO_BASIC_AUTH_GUIDE.md -->

# MTN MOMO Basic Authentication Guide

## Overview
The MTN MOMO API's `bc-authorize` endpoint requires **Basic Authentication**, not Bearer tokens. This guide explains the proper format and implementation.

---

## Credentials

### Raw Credentials (DO NOT USE DIRECTLY IN HEADERS)
```
API_User_ID:  550e8400-e29b-41d4-a716-446655440000
API_Key:      0c83153ce97f40c68622c16a2d69d69e
```

### Base64 Encoding
The credentials must be encoded as: `API_User_ID:API_Key`

**Encoded Value:**
```
UzUwZTg0MDAtZTI5Yi00MWQ0LWE3MTYtNDQ2NjU1NDQwMDAwOjBjODMxNTNjZTk3ZjQwYzY4NjIyYzE2YTJkNjlkNjll
```

**Authorization Header:**
```
Authorization: Basic UzUwZTg0MDAtZTI5Yi00MWQ0LWE3MTYtNDQ2NjU1NDQwMDAwOjBjODMxNTNjZTk3ZjQwYzY4NjIyYzE2YTJkNjlkNjll
```

---

## Implementation

### Node.js / JavaScript (Correct ✅)
```javascript
// Option 1: Automatic encoding (Recommended)
const credentials = `${apiUser}:${apiKey}`;
const auth = Buffer.from(credentials).toString('base64');
const authHeader = `Basic ${auth}`;

// Option 2: Manual encoding
const authHeader = 'Basic UzUwZTg0MDAtZTI5Yi00MWQ0LWE3MTYtNDQ2NjU1NDQwMDAwOjBjODMxNTNjZTk3ZjQwYzY4NjIyYzE2YTJkNjlkNjll';

// Using in Axios request
const response = await axios.post(
  'https://sandbox.momodeveloper.mtn.com/collection/token/',
  {},
  {
    headers: {
      'Authorization': authHeader,
      'Ocp-Apim-Subscription-Key': subscriptionKey,
      'Content-Type': 'application/json'
    }
  }
);
```

### Python (Correct ✅)
```python
import base64
import requests

api_user = "550e8400-e29b-41d4-a716-446655440000"
api_key = "0c83153ce97f40c68622c16a2d69d69e"
subscription_key = "bc94878b6776497da38d09c302c4380c"

# Create Basic Auth header
credentials = f"{api_user}:{api_key}"
auth_encoded = base64.b64encode(credentials.encode()).decode()
auth_header = f"Basic {auth_encoded}"

# Make request
headers = {
    'Authorization': auth_header,
    'Ocp-Apim-Subscription-Key': subscription_key,
    'Content-Type': 'application/json'
}

response = requests.post(
    'https://sandbox.momodeveloper.mtn.com/collection/token/',
    headers=headers
)
```

### cURL (Correct ✅)
```bash
curl -X POST https://sandbox.momodeveloper.mtn.com/collection/token/ \
  -H "Authorization: Basic UzUwZTg0MDAtZTI5Yi00MWQ0LWE3MTYtNDQ2NjU1NDQwMDAwOjBjODMxNTNjZTk3ZjQwYzY4NjIyYzE2YTJkNjlkNjll" \
  -H "Ocp-Apim-Subscription-Key: bc94878b6776497da38d09c302c4380c" \
  -H "Content-Type: application/json"
```

---

## Common Mistakes ❌

### ❌ WRONG: Using UUID directly as Bearer token
```javascript
// INCORRECT - This will fail with 401 Unauthorized
headers: {
  'Authorization': 'Bearer 550e8400-e29b-41d4-a716-446655440000'
}
```

### ❌ WRONG: Using API Key directly
```javascript
// INCORRECT - Missing the API_User_ID
headers: {
  'Authorization': 'Basic 0c83153ce97f40c68622c16a2d69d69e'
}
```

### ❌ WRONG: Forgetting to concatenate with colon
```javascript
// INCORRECT - Should be API_User_ID:API_Key (with colon)
const credentials = `${apiUser}${apiKey}`;  // Missing ":"
```

### ❌ WRONG: Not encoding in Base64
```javascript
// INCORRECT - Raw credentials in header
headers: {
  'Authorization': `Basic 550e8400-e29b-41d4-a716-446655440000:0c83153ce97f40c68622c16a2d69d69e`
}
```

---

## Environment Variables

### Backend (.env)
```env
MOMO_SUBSCRIPTION_KEY=bc94878b6776497da38d09c302c4380c
MOMO_API_USER=550e8400-e29b-41d4-a716-446655440000
MOMO_API_KEY=0c83153ce97f40c68622c16a2d69d69e
MOMO_BASIC_AUTH_ENCODED=UzUwZTg0MDAtZTI5Yi00MWQ0LWE3MTYtNDQ2NjU1NDQwMDAwOjBjODMxNTNjZTk3ZjQwYzY4NjIyYzE2YTJkNjlkNjll
MOMO_AUTH_HEADER=Basic UzUwZTg0MDAtZTI5Yi00MWQ0LWE3MTYtNDQ2NjU1NDQwMDAwOjBjODMxNTNjZTk3ZjQwYzY4NjIyYzE2YTJkNjlkNjll
MOMO_BASE_URL=https://sandbox.momodeveloper.mtn.com
MOMO_ENVIRONMENT=sandbox
```

### Used in mtnMomoService.js
The service automatically creates the Basic Auth header:
```javascript
// Line 185 in mtnMomoService.js
const credentials = `${this.config.apiUser}:${this.config.apiKey}`;
const auth = Buffer.from(credentials).toString('base64');
headers['Authorization'] = `Basic ${auth}`;
```

---

## Verification

### Test the Authorization Header

#### Using curl:
```bash
curl -i -X POST https://sandbox.momodeveloper.mtn.com/collection/token/ \
  -H "Authorization: Basic UzUwZTg0MDAtZTI5Yi00MWQ0LWE3MTYtNDQ2NjU1NDQwMDAwOjBjODMxNTNjZTk3ZjQwYzY4NjIyYzE2YTJkNjlkNjll" \
  -H "Ocp-Apim-Subscription-Key: bc94878b6776497da38d09c302c4380c" \
  -H "Content-Type: application/json"
```

**Expected Success Response (200):**
```json
{
  "access_token": "eyJ0eXAiOiJKV1QiLCJhbGc...",
  "token_type": "Bearer",
  "expires_in": 3600
}
```

**Error Response (401) - Usually means:**
- ❌ Invalid credentials
- ❌ Credentials not properly Base64 encoded
- ❌ Wrong subscription key
- ❌ Credentials not formatted as `ID:Key` before encoding

---

## Reference

| Item | Value |
|------|-------|
| **API_User_ID** | 550e8400-e29b-41d4-a716-446655440000 |
| **API_Key** | 0c83153ce97f40c68622c16a2d69d69e |
| **Subscription Key** | bc94878b6776497da38d09c302c4380c |
| **Base64 Encoded** | UzUwZTg0MDAtZTI5Yi00MWQ0LWE3MTYtNDQ2NjU1NDQwMDAwOjBjODMxNTNjZTk3ZjQwYzY4NjIyYzE2YTJkNjlkNjll |
| **Auth Header** | Basic UzUwZTg0MDAtZTI5Yi00MWQ0LWE3MTYtNDQ2NjU1NDQwMDAwOjBjODMxNTNjZTk3ZjQwYzY4NjIyYzE2YTJkNjlkNjll |
| **Endpoint** | /collection/token/ (for Collections) |
| **Base URL** | https://sandbox.momodeveloper.mtn.com |
| **Environment** | sandbox |

---

## For More Info

- MTN MOMO API Docs: https://momodeveloper.mtn.com
- Basic Authentication: https://en.wikipedia.org/wiki/Basic_access_authentication
- Base64 Encoding: https://tools.ietf.org/html/rfc4648#section-4
