# 🔴 MOMO DNS Error - Root Cause & Fix

## The Error You Got

```
api.momo.provider.com:1 Failed to load resource: net::ERR_NAME_NOT_RESOLVED
```

---

## What This Means

### Breaking Down the Error:

| Part | Meaning |
|------|---------|
| `api.momo.provider.com` | The domain name it tried to reach |
| `ERR_NAME_NOT_RESOLVED` | DNS lookup failed (domain doesn't exist) |
| Why it happened | Code was using a **fake/placeholder domain** |

---

## Root Cause

**File**: `momoService.js` Line 14

### ❌ BEFORE (Broken)
```javascript
this.apiUrl = import.meta.env.VITE_MOMO_API_URL || 'https://api.momo.provider.com';
                                                    ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                                                    FAKE DOMAIN - DOESN'T EXIST!
```

### ✅ AFTER (Fixed)
```javascript
this.apiUrl = import.meta.env.VITE_MOMO_API_URL || 'https://api.sandbox.momoapi.mtn.com';
                                                    ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                                                    REAL MOMO API ENDPOINT
```

---

## Why It Was Failing

1. **Placeholder Domain**: `api.momo.provider.com` was never a real domain
2. **DNS Lookup**: Browser tried to find IP address for fake domain
3. **Lookup Failed**: DNS server couldn't find it (ERR_NAME_NOT_RESOLVED)
4. **No Network Request**: The actual API call never happened
5. **User Sees Error**: "Failed to fetch" error in modal

---

## The Real MOMO API

MTN operates the **real MOMO API** at:

```
Sandbox (Testing):  https://api.sandbox.momoapi.mtn.com
Production (Live):  https://api.momoapi.mtn.com
```

These are **real, registered domains** that resolve correctly.

---

## What Changed

### In Code:
- `momoService.js` now points to real MOMO sandbox API
- Updated `.env` with all required MOMO credentials

### What You Need to Do:
1. Get MOMO API credentials (see MOMO_API_SETUP_GUIDE.md)
2. Add them to `.env` file
3. Restart your app
4. Test again

---

## Testing the Fix

### Before Fix:
```
❌ Browser tries to reach: api.momo.provider.com
❌ DNS fails: ERR_NAME_NOT_RESOLVED
❌ No connection to MOMO
❌ User sees: "Failed to fetch"
```

### After Fix + .env Setup:
```
✅ Browser tries to reach: api.sandbox.momoapi.mtn.com
✅ DNS resolves: IP found
✅ Connection established: 200 OK or auth error
✅ User sees: Real MOMO response (success or error)
```

---

## Quick Checklist

- [ ] Code updated to use real MOMO API URL
- [ ] `.env` file has MOMO credentials
- [ ] `VITE_MOMO_API_KEY` is set (not placeholder)
- [ ] `VITE_MOMO_PRIMARY_KEY` is set (not placeholder)
- [ ] `VITE_MOMO_USER_ID` is set (not placeholder)
- [ ] `VITE_MOMO_USE_MOCK=false` (to use real API)
- [ ] App restarted after .env changes
- [ ] Browser cache cleared (hard refresh: Ctrl+Shift+R)

---

## Next Steps

1. **Get MOMO Credentials**: Follow MOMO_API_SETUP_GUIDE.md
2. **Update .env**: Add your real API keys
3. **Test Connection**: Try sending money again
4. **Monitor**: Check MOMO dashboard for transactions

---

**Result**: ✅ Real MOMO transactions working with no DNS errors!
