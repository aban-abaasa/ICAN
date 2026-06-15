# ⚡ TRUST SYSTEM ERROR QUICK DIAGNOSIS

## See Console Error? Use This Chart

### Error 42P01: "relation does not exist"
```
GET .../trust_transactions 404 (Not Found)
Error: relation "public.trust_transactions" does not exist
Code: 42P01
```

**Fix:** Run this in Supabase SQL Editor
```bash
✓ Copy: backend/db/DEPLOY_TRUST_SYSTEM.sql
✓ Paste → Run
✓ Refresh browser (Ctrl+F5)
✓ Done!
```

**Time:** 2 minutes

---

### Error 42P17: "infinite recursion in policy"
```
GET .../trust_transactions 500 (Internal Server Error)
Error: infinite recursion detected in policy for relation "trust_group_members"
Code: 42P17
```

**Fix:** Run this in Supabase SQL Editor
```bash
✓ Copy: backend/db/FIX_RLS_INFINITE_RECURSION.sql
✓ Paste → Run
✓ Wait 10-15 seconds
✓ Refresh browser (Ctrl+F5) - hard refresh: Ctrl+Shift+Delete first
✓ Done!
```

**Time:** 3 minutes

---

### No Errors But Data Not Loading?

**Checklist:**
- [ ] Logged in? (Check auth.uid() in console)
- [ ] Joined a group? (Need membership to see data)
- [ ] Cache cleared? (Ctrl+Shift+Delete)
- [ ] Data exists? (Create a transaction first)

---

## One-Minute Assessment

1. Open browser Console (F12)
2. Click "View Details" on a trust group
3. Look for error in Console

| Console Shows | Status | Action |
|-------|--------|--------|
| ✅ No errors, data loads | **WORKING** | Done! ✓ |
| 404 + "does not exist" | **Need Deploy** | → Run DEPLOY_TRUST_SYSTEM.sql |
| 500 + "infinite recursion" | **Need RLS Fix** | → Run FIX_RLS_INFINITE_RECURSION.sql |
| Different error | **Need Help** | Copy full error → debug |

---

## File Locations

```
backend/db/
├── DEPLOY_TRUST_SYSTEM.sql           ← 42P01 fix
└── FIX_RLS_INFINITE_RECURSION.sql    ← 42P17 fix
```

---

## Supabase SQL Editor Quick Link

https://app.supabase.com/project/YOUR-PROJECT-ID/sql/new

(Replace YOUR-PROJECT-ID with your actual ID)

---

## If You're Still Stuck

Run this diagnostic in Supabase SQL Editor:

```sql
-- Check tables exist
SELECT COUNT(*) as table_count FROM information_schema.tables 
WHERE table_schema = 'public' AND table_name LIKE 'trust_%';
-- Expected: 5

-- Check RLS enabled
SELECT COUNT(*) as rls_enabled FROM pg_class 
WHERE relkind = 'r' AND relname LIKE 'trust_%' AND relrowsecurity = true;
-- Expected: 5

-- Check policies exist
SELECT COUNT(*) as policy_count FROM pg_policies 
WHERE schemaname = 'public' AND tablename LIKE 'trust_%';
-- Expected: > 0

-- Try simple query
SELECT COUNT(*) FROM trust_transactions;
-- Expected: number or 0, NOT error
```

All 3 diagnostics succeed? Your database is fine. Issue is likely frontend cache.

→ Clear cache (Ctrl+Shift+Delete) and hard refresh (Ctrl+F5)

---

⚡ **Most common fix: Clear browser cache!**

Many 500 errors disappear after:
1. Ctrl+Shift+Delete (open settings)
2. Clear all data
3. Ctrl+F5 (hard refresh)

---

**Status:** Ready to help  
**Last Updated:** February 10, 2026
