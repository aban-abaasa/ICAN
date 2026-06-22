# Pre-Commit Checklist - Prevent Build Failures

## Before Every Commit

### ✅ 1. Check for Merge Conflicts
```bash
git grep "<<<<<<< HEAD"
git grep "======="
git grep ">>>>>>>"
```
**Should return:** Empty (no results)

---

### ✅ 2. Validate JSON Files
```bash
# Check vercel.json
cat vercel.json | ConvertFrom-Json

# Check package.json
cat package.json | ConvertFrom-Json

# Check frontend/vercel.json
cat frontend/vercel.json | ConvertFrom-Json
```
**Should:** Not show errors

---

### ✅ 3. Check Git Status
```bash
git status
```
**Look for:**
- ❌ "both modified" - Unresolved conflicts
- ❌ "unmerged paths" - Conflicts need resolving
- ✅ "modified" - Normal changes

---

### ✅ 4. Run Build Locally (Optional but recommended)
```bash
cd frontend
npm run build
```
**Should:** Complete without errors

---

### ✅ 5. Check for Sensitive Files
```bash
git status
```
**Make sure NOT committing:**
- ❌ `.env` files (except `.env.example`)
- ❌ `node_modules/`
- ❌ API keys or secrets
- ❌ Database credentials

---

## Before Force Push

### ⚠️ Force Push Risks
Force push (`git push --force`) can cause:
- Lost commits
- Merge conflicts
- Broken deployments
- Team member confusion

### Alternative to Force Push
```bash
# Instead of force push, try:
git pull --rebase origin master
git push origin master
```

### If You Must Force Push
```bash
# 1. Warn your team first
# 2. Make sure you're on the right branch
git branch

# 3. Check what will be pushed
git log origin/master..HEAD

# 4. Force push with lease (safer)
git push --force-with-lease origin master
```

---

## Quick Commands

### Check Everything
```bash
# Run all checks at once
git grep "<<<<<<< HEAD" ; git status ; npm run build --prefix frontend
```

### Fix Common Issues
```bash
# Regenerate package-lock.json
cd frontend
rm package-lock.json
npm install

# Format JSON files
cat vercel.json | ConvertFrom-Json | ConvertTo-Json -Depth 10 | Set-Content vercel.json
```

---

## Emergency Rollback

### If You Pushed Bad Code
```bash
# Find last good commit
git log --oneline -10

# Reset to that commit
git reset --hard <commit-hash>

# Force push to fix remote
git push --force origin master
```

### If Vercel Build Fails
1. Check Vercel dashboard for exact error
2. Fix the error locally
3. Commit and push fix
4. Or trigger manual redeploy in Vercel

---

## Common Errors & Solutions

### "Invalid vercel.json"
**Cause:** Merge conflicts or invalid JSON  
**Fix:** Check for `<<<<<<<` markers, validate JSON

### "Module not found"
**Cause:** Missing dependencies  
**Fix:** `npm install`, commit `package-lock.json`

### "Build failed"
**Cause:** TypeScript errors, ESLint errors  
**Fix:** Run `npm run build` locally, fix errors

### "Environment variables missing"
**Cause:** Missing env vars in Vercel  
**Fix:** Add in Vercel Dashboard → Settings → Environment Variables

---

## Best Practices

### ✅ DO:
- Commit small, focused changes
- Write clear commit messages
- Test locally before pushing
- Check for conflicts regularly
- Pull before pushing

### ❌ DON'T:
- Force push without checking
- Commit merge conflict markers
- Push without testing
- Commit sensitive data
- Skip the checklist

---

## Quick Reference

| Issue | Command | Expected Result |
|-------|---------|-----------------|
| Check conflicts | `git grep "<<<<<<< HEAD"` | Empty |
| Validate JSON | `cat file.json \| ConvertFrom-Json` | No errors |
| Test build | `npm run build --prefix frontend` | Success |
| Check status | `git status` | No conflicts |
| Preview push | `git log origin/master..HEAD` | Your commits |

---

**Save this checklist and run through it before every commit!**

It takes 30 seconds and prevents hours of debugging. 🎯
