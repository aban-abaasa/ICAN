# ✅ MTN MOMO Setup - READY FOR EXECUTION

## Updated Credentials 🔑

```
Primary Subscription Key: 7307f0bb655542248f520187b63b12d5
Secondary API Key:        0c83153ce97f40c68622c16a2d69d69e
API User ID (UUID):       550e8400-e29b-41d4-a716-446655440000
Environment:              sandbox
Base URL:                 https://sandbox.momodeveloper.mtn.com
```

## ✅ What's Been Done

1. ✅ SQL file updated with new credentials
2. ✅ .env file updated with new credentials
3. ✅ All configuration tables ready

## 🚀 NEXT STEP: Run SQL Migration

### In Supabase Dashboard:

1. Go to: https://supabase.com/dashboard
2. Select your project
3. Go to **SQL Editor**
4. Click **New Query**
5. Copy the entire content from: `backend/db/setup_mtn_momo_configuration.sql`
6. Paste into Supabase
7. Click **Execute**

## ✅ Expected Result

After running the SQL, you should see:
```
✅ Success - No errors
```

Then verify by running this query:
```sql
SELECT id, name, subscription_key, api_user_id, api_secret_key, environment, is_primary
FROM public.mtn_momo_config 
WHERE is_primary = true;
```

You should see **ONE ROW** with:
- subscription_key: `7307f0bb655542248f520187b63b12d5`
- api_user_id: `550e8400-e29b-41d4-a716-446655440000`
- api_secret_key: `0c83153ce97f40c68622c16a2d69d69e`

## 🧪 Test the Integration

Once SQL is done, restart your backend:
```bash
cd backend
npm start
```

Test collection endpoint:
```bash
curl -X POST http://localhost:3000/api/momo/request-payment \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 1000,
    "phoneNumber": "256701234567",
    "currency": "UGX"
  }'
```

---

**Status**: ✅ Ready for Supabase migration  
**Next**: Run SQL in Supabase  
**Time**: ~2 minutes
