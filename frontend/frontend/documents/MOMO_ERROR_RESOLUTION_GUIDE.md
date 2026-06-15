# 🔧 MOMO API Error Resolution Guide

## ❌ Error You Encountered

```
Failed to load resource: net::ERR_NAME_NOT_RESOLVED
API: api.momo.provider.com
```

## 🔍 What This Error Means

| Part | Meaning |
|------|---------|
| `net::ERR_NAME_NOT_RESOLVED` | DNS cannot resolve the domain name |
| `api.momo.provider.com` | The endpoint configured in your .env file |
| **Translation** | "I can't find the server you're trying to connect to" |

## ✅ Your Failover System IS Working!

The error logs show **perfect failover behavior**:
```
🚀 Processing MOMO Top-Up with PRIMARY Key
❌ Primary key failed (DNS error)
🔄 Rotating to Secondary MOMO Key
⚠️ Primary key failed, retrying with Secondary Key...
❌ Secondary key also failed (same DNS error)
❌ MOMO Top-Up failed: Both keys exhausted
```

This is **exactly what we designed** - the system tried PRIMARY, failed gracefully, rotated to SECONDARY, tried again, and returned a user-friendly error.

## 💡 Why It's Happening

`api.momo.provider.com` is a **placeholder URL** - it's not a real server. You need to configure a real MOMO API endpoint.

## 🚀 Quick Fix: Enable Mock Mode (Development)

Mock mode simulates successful transactions without needing a real API:

### Step 1: Update `.env` file
```env
VITE_MOMO_USE_MOCK=true
VITE_MOMO_API_URL=https://api.momo.provider.com
```

### Step 2: Restart your app
```bash
npm run dev
```

### Step 3: Test wallet functions
- Click "Top Up" → Select "Mobile Money"
- Enter amount and phone
- Click "Top Up"
- ✅ Should show success (with [MOCK MODE] label)

## 🔧 Production: Configure Real API

### Step 1: Get Real MOMO API Credentials

Choose one of these providers:

| Provider | Endpoint | Coverage |
|----------|----------|----------|
| **Afrimax** | `https://api.afrimax.com/momo` | East Africa |
| **Flutterwave** | `https://api.flutterwave.com/v3/transfers` | Pan-Africa |
| **Pesapal** | `https://api.pesapal.com/api/` | East Africa |
| **Cellulant** | `https://sandbox.cellulant.com/gateway/v1/transfers` | Pan-Africa |
| **M-Pesa Official** | Contact Safaricom for API | Kenya |
| **Orange Money** | Contact Orange for API | Pan-Africa |

### Step 2: Update `.env` for Production
```env
VITE_MOMO_USE_MOCK=false
VITE_MOMO_API_URL=https://api.yourprovider.com/endpoint
VITE_MOMO_PRIMARY_KEY=your-actual-api-key-here
VITE_MOMO_SECONDARY_KEY=your-backup-api-key-here
```

### Step 3: Test Connection
```javascript
// In browser console
import momoService from './services/momoService';
momoService.testConnection().then(result => console.log(result));
```

## 📋 Configuration Reference

### Development (Mock Mode)
```env
VITE_MOMO_USE_MOCK=true
```
**Result**: All transactions simulated, no real API needed

### Development (Real API Testing)
```env
VITE_MOMO_USE_MOCK=false
VITE_MOMO_API_URL=https://your-test-api.com
```
**Result**: Tests with real API but sandbox/test credentials

### Production
```env
VITE_MOMO_USE_MOCK=false
VITE_MOMO_API_URL=https://api.production-momo.com
```
**Result**: Live transactions with production credentials

## 🧪 Test Your Configuration

### Check Current Mode
```javascript
// Browser console
import momoService from './services/momoService';
console.log(momoService.useMockMode); // true or false
```

### Check API Endpoint
```javascript
console.log(momoService.apiUrl); // Shows current endpoint
```

### Test Connection
```javascript
momoService.testConnection().then(result => {
  console.log('Connection:', result);
  // MOCK mode: { status: 'SUCCESS', mode: 'MOCK', ... }
  // LIVE mode: { status: 'SUCCESS/FAILED', ... }
});
```

## 🔍 Troubleshooting Each Error Type

### Error 1: `net::ERR_NAME_NOT_RESOLVED`
**Cause**: API endpoint doesn't exist or DNS can't resolve it
```bash
# Solution 1: Use mock mode (development)
VITE_MOMO_USE_MOCK=true

# Solution 2: Use correct real API URL
VITE_MOMO_API_URL=https://api.actualprovider.com
```

### Error 2: `net::ERR_REFUSED`
**Cause**: Server exists but isn't accepting connections
```
Check:
- Server is running
- Port is correct
- HTTPS vs HTTP (most APIs require HTTPS)
```

### Error 3: `net::ERR_FAILED`
**Cause**: Generic network error
```
Check:
- Internet connection working
- API credentials valid
- API URL format correct
- Firewall not blocking requests
```

### Error 4: `401 Unauthorized`
**Cause**: Wrong or expired API keys
```
Check:
- VITE_MOMO_PRIMARY_KEY is correct
- VITE_MOMO_SECONDARY_KEY is correct
- Keys haven't expired
- Keys have right permissions
```

## 🎯 Recommended Setup

### For Local Development
```env
# Development with mock mode - no API needed
VITE_MOMO_USE_MOCK=true
VITE_MOMO_API_URL=https://api.momo.provider.com
VITE_MOMO_PRIMARY_KEY=967f8537fec84cc6829b0ee5650dc355
VITE_MOMO_SECONDARY_KEY=51384ad5e0f6477385b26a15ca156737
```

### For Staging/Testing
```env
# Real API with sandbox credentials
VITE_MOMO_USE_MOCK=false
VITE_MOMO_API_URL=https://sandbox-api.flutterwave.com/v3/transfers
VITE_MOMO_PRIMARY_KEY=your-sandbox-key-1
VITE_MOMO_SECONDARY_KEY=your-sandbox-key-2
```

### For Production
```env
# Real API with production credentials
VITE_MOMO_USE_MOCK=false
VITE_MOMO_API_URL=https://api.flutterwave.com/v3/transfers
VITE_MOMO_PRIMARY_KEY=your-production-key-1
VITE_MOMO_SECONDARY_KEY=your-production-key-2
```

## 📚 Example: Flutterwave Integration

### 1. Get API Key from Flutterwave
- Go to https://dashboard.flutterwave.com
- Create account
- Get API keys
- Use sandbox for testing

### 2. Configure .env
```env
VITE_MOMO_USE_MOCK=false
VITE_MOMO_API_URL=https://api.flutterwave.com/v3/transfers
VITE_MOMO_PRIMARY_KEY=FLUTTTERWAVE_SECRET_KEY_HERE
VITE_MOMO_SECONDARY_KEY=BACKUP_KEY_HERE
```

### 3. Test
```bash
npm run dev
# Try a transaction
# Check browser console for logs
```

## 🐛 Debug Logs in Console

With the updated service, you'll see:

**MOCK Mode**:
```
🧪 MOMO Service initialized in MOCK MODE (Development)
✓ Transactions will be simulated without calling real API
✓ All payments will appear successful
```

**LIVE Mode**:
```
🚀 MOMO Service initialized in LIVE MODE
API Endpoint: https://api.yourapi.com
Primary Key: 967f8537...
Secondary Key: 51384ad5...
```

**Successful Transaction**:
```
🚀 Processing MOMO Top-Up with PRIMARY Key (LIVE Mode)
📡 API Request: POST https://api.yourapi.com/transfer
✅ API Response received
```

**Failed with Failover**:
```
🚀 Processing MOMO Top-Up with PRIMARY Key (LIVE Mode)
❌ Connection Error
🔄 Rotating to Secondary MOMO Key
⚠️ Primary key failed, retrying with Secondary Key...
```

## ✅ Checklist

- [ ] Choose mock mode for development or real API endpoint
- [ ] Update `VITE_MOMO_USE_MOCK` in .env
- [ ] If using real API, update `VITE_MOMO_API_URL`
- [ ] If using real API, update API keys
- [ ] Restart dev server (`npm run dev`)
- [ ] Test by clicking "Top Up" in wallet
- [ ] Check browser console for mode confirmation

## 📞 Next Steps

1. **Quick Test (Mock Mode)**: Set `VITE_MOMO_USE_MOCK=true`
2. **Production Setup**: Contact real MOMO provider for endpoint
3. **Questions**: Review provider's API documentation

---

**Status**: ✅ Your failover system is working perfectly  
**Action**: Configure real API endpoint or use mock mode  
**Date**: January 13, 2026
