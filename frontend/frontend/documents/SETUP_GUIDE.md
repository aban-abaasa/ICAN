# 🚀 Pitchin Marketplace Setup Guide

## ✅ Current Status

Your Pitchin marketplace is now running in **Demo Mode** with fallback data while Supabase is being configured.

### What's Working:
✅ Pitch feed with sample data  
✅ Video recording/upload  
✅ Smart contract generator  
✅ Business profile management  
✅ Like/share functionality (local only)  

### What Requires Supabase:
- Persistent pitch storage
- User accounts & authentication
- Business profile storage
- Smart contract history
- Notifications

---

## 🔧 Configure Supabase (5 minutes)

### Step 1: Get Supabase Credentials
1. Go to https://supabase.com
2. Create a free project
3. Go to **Settings > API**
4. Copy your:
   - `Project URL` (VITE_SUPABASE_URL)
   - `Anon Public Key` (VITE_SUPABASE_ANON_KEY)

### Step 2: Create `.env.local` in `frontend/` directory

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_ANON_KEY_HERE
```

### Step 3: Run Setup SQL

In Supabase SQL Editor, run the file:
```
ICAN/backend/db/schemas/04_business_profiles_blockchain.sql
```

This creates all necessary tables with proper RLS policies.

### Step 4: Restart Development Server

```bash
cd ICAN/frontend
npm run dev
```

---

## 📋 Demo Data Available

When not connected to Supabase, you'll see:

**Pitch 1:** AI-Powered Supply Chain Platform
- Business: Sarah Tech Solutions
- Funding: $250K / $500K (15% equity)
- Team: Sarah, John, Mike
- IP Protected: ✓

**Pitch 2:** Sustainable Fashion E-commerce
- Business: EcoStyle Ventures
- Funding: $120K / $300K (12% equity)
- Team: Emma, Lisa

---

## 🔐 Security Notes

The database schema includes:
- ✅ Row Level Security (RLS) policies
- ✅ User authentication checks
- ✅ Business profile ownership validation
- ✅ Digital signature verification
- ✅ Blockchain records immutability

---

## 📊 Database Schema

Your Supabase will include:

### Core Tables:
- **business_profiles** - Company accounts
- **business_co_owners** - Team members
- **pitches** - Pitch listings
- **smart_contracts** - Share agreements
- **digital_signatures** - Signature records
- **notifications** - User notifications

### Blockchain Tables:
- **blockchain_records** - Transaction log
- **qr_code_verifications** - QR signatures
- **share_transactions** - Share transfers

---

## 🐛 Troubleshooting

**Q: Getting 403 errors?**
- Ensure RLS policies are enabled
- Check user authentication status
- Verify API key permissions

**Q: Multiple GoTrueClient instances?**
- Normal warning, already fixed in latest version
- Safe to ignore, doesn't affect functionality

**Q: Pitches not saving?**
- Verify Supabase credentials in .env.local
- Check table creation completed
- Enable RLS policies in Supabase

---

## 🚀 Next Steps

Once Supabase is configured:

1. ✅ Deploy pitch videos to Supabase Storage
2. ✅ Enable real-time notifications
3. ✅ Implement user authentication UI
4. ✅ Add blockchain deployment features
5. ✅ Enable share transactions

---

**Questions?** Check the console logs for detailed error messages.
**Ready to go live?** Upgrade Supabase to Production plan.
