# 🔧 Environment Variables Setup Guide

## For Local Development

### Step 1: Copy `.env.example` to `.env` or `.env.local`
```bash
cp .env.example .env.local
```

### Step 2: Verify all variables are set correctly

Your `.env.local` should look like this:

```
VITE_SUPABASE_URL=https://hswxazpxcgtqbxeqcxxw.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhzd3hhenB4Y2d0cWJ4ZXFjeHh3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIxNDE1NzAsImV4cCI6MjA2NzcxNzU3MH0.ryOHQGgiEFf25Q9XA2K0akCcrQ7NcZddVfnWMdAH0DU
VITE_API_BASE_URL=http://localhost:5000
```

### Step 3: Start the dev server
```bash
npm run dev
```

---

## For Vercel Deployment

### Step 1: Go to Vercel Dashboard
1. Navigate to your **ican-era** project
2. Click **Settings** → **Environment Variables**

### Step 2: Add these variables (FRONTEND ONLY)

| Variable | Value |
|----------|-------|
| **VITE_SUPABASE_URL** | `https://hswxazpxcgtqbxeqcxxw.supabase.co` |
| **VITE_SUPABASE_ANON_KEY** | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhzd3hhenB4Y2d0cWJ4ZXFjeHh3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIxNDE1NzAsImV4cCI6MjA2NzcxNzU3MH0.ryOHQGgiEFf25Q9XA2K0akCcrQ7NcZddVfnWMdAH0DU` |
| **VITE_API_BASE_URL** | `https://your-backend-domain.com` |

### Step 3: Save and Redeploy
1. Click **Save**
2. Go to **Deployments**
3. Click **Redeploy** on the latest deployment
4. Wait for build to complete

### Step 4: Verify in Browser
1. Open your deployed app: `https://ican-era.vercel.app`
2. Press **F12** to open DevTools
3. Go to **Console** tab
4. You should see:
   ```
   ✅ Supabase client initialized successfully
   ```

---

## Environment Variables Reference

### Required (Frontend)
- `VITE_SUPABASE_URL` - Your Supabase project URL
- `VITE_SUPABASE_ANON_KEY` - Supabase anonymous key (safe for frontend)

### Optional
- `VITE_API_BASE_URL` - Backend API URL (default: `http://localhost:5000`)
- `VITE_FIREBASE_API_KEY` - Firebase API key
- `VITE_GEMINI_API_KEY` - Google Gemini AI API key

### Never Share
- `SUPABASE_SERVICE_ROLE_KEY` - Backend only! Never in frontend!

---

## Troubleshooting

### "Supabase not initialized" error?
1. ✅ Check Vercel Environment Variables are set
2. ✅ Verify variable names start with `VITE_` for frontend
3. ✅ Redeploy after adding variables
4. ✅ Clear browser cache (Ctrl+Shift+Delete)

### Variables not updating?
1. Delete old deployments
2. Redeploy the latest version
3. Wait 2-3 minutes for cache to clear

---

## Quick Copy-Paste for Vercel

```
VITE_SUPABASE_URL=https://hswxazpxcgtqbxeqcxxw.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhzd3hhenB4Y2d0cWJ4ZXFjeHh3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIxNDE1NzAsImV4cCI6MjA2NzcxNzU3MH0.ryOHQGgiEFf25Q9XA2K0akCcrQ7NcZddVfnWMdAH0DU
```

Copy each value separately into Vercel Dashboard!
