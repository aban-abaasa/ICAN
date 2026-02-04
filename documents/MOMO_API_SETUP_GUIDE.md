# 🔧 MTN MOMO API Setup Guide

## 🔴 Error Fixed

**Before**: `net::ERR_NAME_NOT_RESOLVED` on `api.momo.provider.com` (fake domain)
**After**: Using real **MTN MOMO Sandbox API** at `api.sandbox.momoapi.mtn.com`

---

## 📋 What You Need

To use real MOMO transactions (not mock data), you need:

1. **MOMO Sandbox Account** - For testing
2. **API Credentials** - From MOMO Developer Portal
3. **Environment Variables** - Configured in `.env`

---

## ✅ Step-by-Step Setup

### Step 1: Create MOMO Developer Account

1. Go to: **https://momoapi.mtn.com/**
2. Click **"Get Started"** or **"Sign Up"**
3. Fill in registration form:
   - Email address
   - Organization name (use "ICAN" or your company)
   - Country (Uganda, Kenya, etc.)
4. Create password and confirm
5. Check email for verification link
6. Verify your account

---

### Step 2: Create Sandbox Application

1. Login to **https://sandbox.momoapi.mtn.com/**
2. Navigate to **"Apps"** or **"My Applications"**
3. Click **"Create New App"**
4. Fill details:
   - **App Name**: `ICAN-Wallet` (or your app name)
   - **App Type**: Select appropriate (usually "Web Application")
5. Click **"Create"**
6. Wait for approval (usually instant)

---

### Step 3: Get Your API Credentials

After app creation, you'll see a dashboard with:

```
┌─────────────────────────────────────┐
│ ICAN-Wallet (Your App)              │
├─────────────────────────────────────┤
│ User ID (App ID):                   │
│ 1234567a-8b9c-0def-1234-567890ab    │
│                                     │
│ API Key (Primary Key):              │
│ 967f8537fec84cc6829b0ee5650dc355    │
│                                     │
│ Subscription Key:                   │
│ 51384ad5e0f6477385b26a15ca156737    │
│                                     │
│ Base URL:                           │
│ https://api.sandbox.momoapi.mtn.com │
└─────────────────────────────────────┘
```

**Copy these values** ⬇️

---

### Step 4: Update `.env` File

Open `frontend/.env` and replace:

```env
# ❌ BEFORE (placeholder values)
VITE_MOMO_PRIMARY_KEY=your_momo_api_key_here
VITE_MOMO_SECONDARY_KEY=your_momo_secondary_key_here
VITE_MOMO_SUBSCRIPTION_KEY=your_momo_subscription_key_here
VITE_MOMO_USER_ID=your_momo_user_id_here
VITE_MOMO_API_KEY=your_momo_api_key_here

# ✅ AFTER (your real values)
VITE_MOMO_PRIMARY_KEY=967f8537fec84cc6829b0ee5650dc355
VITE_MOMO_SECONDARY_KEY=51384ad5e0f6477385b26a15ca156737
VITE_MOMO_SUBSCRIPTION_KEY=51384ad5e0f6477385b26a15ca156737
VITE_MOMO_USER_ID=1234567a-8b9c-0def-1234-567890ab
VITE_MOMO_API_KEY=967f8537fec84cc6829b0ee5650dc355
VITE_MOMO_USE_MOCK=false
```

---

### Step 5: Verify API Connection

Add these test phone numbers to your system:

**Valid Test Phone Numbers**:
```
Uganda (MOMO):
- 256701234567 (MTN)
- 256774123456 (Airtel)

Kenya (MOMO):
- 254701234567 (Safaricom)

Tanzania:
- 255654123456

Burundi:
- 257675123456
```

---

## 🧪 Testing

### Test 1: Send Money

1. Click **Send** button in wallet
2. Enter test phone: `256701234567`
3. Amount: `100` UGX
4. Click **Send**

**Expected Result**:
- ✅ No DNS error
- ✅ Request reaches MOMO API
- ✅ Either success or MOMO-specific error (not network error)
- ✅ Transaction logged with real transaction ID

### Test 2: Check API Connection

Run in browser console:
```javascript
const response = await fetch('https://api.sandbox.momoapi.mtn.com/health');
console.log(await response.json());
```

**Expected**: `{ "status": "OK" }` or similar

---

## 🔄 API Endpoints (Real)

| Function | Endpoint | Method |
|----------|----------|--------|
| Send Money | `/v1_0/transfer` | `POST` |
| Check Status | `/v1_0/transfer/{transactionId}` | `GET` |
| Get Balance | `/v1_0/account/balance` | `GET` |
| Create Link | `/v1_0/payment-link` | `POST` |
| Health Check | `/health` | `GET` |

---

## 📁 Configuration Hierarchy

```
1. Environment Variables (.env) - HIGHEST PRIORITY
   └─ VITE_MOMO_API_URL
   └─ VITE_MOMO_PRIMARY_KEY
   └─ etc.

2. Fallback Values (momoService.js)
   └─ https://api.sandbox.momoapi.mtn.com
   └─ Empty string (requires .env setup)
```

**➜ Always set values in `.env`, not hardcoded in code!**

---

## 🛡️ Security Best Practices

### ❌ DO NOT:
- Push `.env` to GitHub
- Share API keys in chat/email
- Hardcode keys in code
- Use production keys in development

### ✅ DO:
- Keep `.env` in `.gitignore`
- Use separate keys for sandbox/production
- Rotate keys quarterly
- Monitor API usage on dashboard
- Use different users for different environments

---

## 🐛 Common Errors & Fixes

| Error | Cause | Fix |
|-------|-------|-----|
| `ERR_NAME_NOT_RESOLVED` | Fake domain used | Update `VITE_MOMO_API_URL` |
| `401 Unauthorized` | Invalid API key | Verify key in MOMO dashboard |
| `400 Bad Request` | Invalid phone format | Use `256701234567` format |
| `503 Service Unavailable` | API maintenance | Retry after 5 minutes |
| `Timeout` | Network issue | Check internet connection |

---

## 🔐 Sandbox vs Production

### Sandbox (Testing)
```
URL: https://api.sandbox.momoapi.mtn.com
Use: Development & testing
Keys: Test keys (safe)
Data: Not real transactions
Cost: FREE
```

### Production (Live)
```
URL: https://api.momoapi.mtn.com
Use: Real transactions
Keys: Live keys (secure)
Data: Real money transfers
Cost: Per-transaction fees apply
```

**⚠️ Switch to production URL only after full testing!**

---

## 📞 Resources

| Resource | URL |
|----------|-----|
| MOMO API Docs | https://momoapi.mtn.com/docs |
| Sandbox Console | https://sandbox.momoapi.mtn.com/ |
| Status Page | https://status.momoapi.mtn.com/ |
| Support Email | support@momoapi.mtn.com |
| API Test Tool | https://sandbox.momoapi.mtn.com/postman |

---

## ✅ Verification Checklist

- [ ] Created MOMO developer account
- [ ] Created sandbox application
- [ ] Copied User ID
- [ ] Copied Primary API Key
- [ ] Copied Secondary API Key
- [ ] Copied Subscription Key
- [ ] Updated `.env` with real values
- [ ] Set `VITE_MOMO_USE_MOCK=false`
- [ ] Verified `.env` is in `.gitignore`
- [ ] Tested with real phone number
- [ ] Verified no DNS errors
- [ ] Transaction logged to Supabase

---

## 🚀 Ready to Go!

Once `.env` is configured with real MOMO credentials:

1. Your app connects to **real MOMO API** ✅
2. Send/Receive/TopUp use **real payment methods** ✅
3. Transactions save to **real database** ✅
4. No more DNS errors ✅
5. Users can **actually transfer money** ✅

**Next Steps**:
1. Get your MOMO API key
2. Update `.env`
3. Test with real phone number
4. Monitor transactions on MOMO dashboard
5. Deploy to production

---

**Questions?** Check the [MOMO API Documentation](https://momoapi.mtn.com/docs) or contact MOMO support.
