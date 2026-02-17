# Auto-Fill Search Feature - Test Guide

## What Changed
The search functionality now has improved auto-fill when you select a user from search results.

## How It Works

### Search Flow
```
1. Type partial email in "Search by Email" field
   ↓ (auto-searches after 2+ characters)
   
2. See matching ICAN users in dropdown
   - Shows: Name + Email
   - Shows: Result count "(2)"
   - Shows: ✓ checkmark indicating verified users
   
3. Click on a user in dropdown
   ↓
   
4. Form AUTO-FILLS:
   ✅ Email field → filled with selected email
   ✅ Name field → filled with selected name
   ✅ Verification → automatically verified
   ✅ Search clears → ready for next field
```

## Visual Indicators

### Search Results Dropdown
```
Search by Email
┌─────────────────────────────────────┐
│ 🔍 [typing...user@] (2)            │
├─────────────────────────────────────┤
│ Click to select and auto-fill       │ ← Help text
├─────────────────────────────────────┤
│ Alice Johnson                    ✓   │ ← Result 1
│ alice@ican.com                      │
├─────────────────────────────────────┤
│ Alex Johnson                    ✓   │ ← Result 2
│ alex@ican.com                      │
└─────────────────────────────────────┘
```

### Name Field After Selection
```
Full Name ✓
┌──────────────────────────────────────┐
│ Alice Johnson           ✓            │ ← Auto-filled + verified
└──────────────────────────────────────┘
```

## Step-by-Step Test

### Test 1: Auto-Fill by Search
1. **Click** "Search by Email" field
2. **Type** first few letters of user email (e.g., "ali" for alice@ican.com)
3. **See** dropdown appear with matching users
4. **Click** on a user in dropdown
5. **Verify**:
   - [ ] Email field populated with selected email ✓
   - [ ] Name field populated with selected name ✓
   - [ ] Green checkmark shows on name field ✓
   - [ ] Search dropdown closes
   - [ ] Ready to fill other fields

**Expected Result**: 
```
Email: alice@ican.com ✓
Name: Alice Johnson ✓
Role: (select from dropdown)
Ownership: (enter %)
```

### Test 2: Search with No Results
1. **Type** email that doesn't exist (e.g., "xyz@test.com")
2. **See** no dropdown (no results)
3. **Can still** manually type name and email
4. **Click Add** if co-owner has ICAN account

### Test 3: Multiple Character Search
1. **Type** just "a" - should show many results
2. **Type** "al" - narrows down
3. **Type** "ali" - shows specific user
4. **Type** full "alice@ican.com" - shows exact match
5. **Click** to select and auto-fill

### Test 4: Clear and Search Again
1. **Add** first co-owner (Alice)
2. **Search** for second co-owner
3. **Type** different email (e.g., "bob")
4. **Click** Bob from results
5. **Verify** form shows Bob's info and previous search cleared

## Features

✅ **Auto-Fill on Selection**
- Email auto-filled
- Name auto-filled
- Both verified together

✅ **Visual Feedback**
- Result count shown "(2)"
- Verification checkmarks in dropdown
- Name field shows "✓" when filled
- Green verified indicator

✅ **Smart Search**
- Shows 5 matching users max
- Works with partial email
- Real-time filtering
- Scrollable if > 5 results

✅ **Clean UI**
- Search clears after selection
- Form ready for next field
- Help text in dropdown
- Clear role/ownership fields

## Common Workflows

### Workflow 1: Add 2 Co-Owners Quickly
```
Search: Type "alice" → Click Alice → (auto-filled)
        ↓ Add ownership ↓ Add role ↓ Click Add
        
Search: Type "bob" → Click Bob → (auto-filled)
        ↓ Add ownership ↓ Add role ↓ Click Add
        
Result: Both co-owners added with auto-filled names ✓
```

### Workflow 2: Manual Entry (No Search)
```
Skip search field
Type manually in Name field
Type manually in Email field
No verification needed if doing manual entry
```

### Workflow 3: Partial Search Then Edit
```
Search: Type "john" → Click John Smith → (auto-filled)
Edit: Change name from "John Smith" to "John S."
Add: With edited name
```

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| Name not auto-filling | User not found | Check spelling of email |
| Search not showing | Need 2+ characters | Type at least 2 chars |
| Dropdown stuck open | Click elsewhere | Press Escape or click field again |
| Old search results | Cache | Type new search term |
| Name field empty | No name in user record | Type name manually |

## Console Feedback

When you select a user successfully, check console (F12):
```
✅ User verified: Alice Johnson (alice@ican.com)
```

If no console message, check that:
- User email is valid format
- User exists in ICAN system
- No network errors in DevTools

## After Auto-Fill

Once name is auto-filled:

1. ✓ Check the name (edit if needed)
2. Select role from dropdown
3. Enter ownership percentage
4. Click "Add" button
5. Co-owner added to list ✓

## Performance

**Search behavior**:
- Starts searching after 2+ characters typed
- Max 5 results shown
- Updates in real-time as you type
- Results disappear when field loses focus

**Auto-fill behavior**:
- Instant once user selected
- Verification happens automatically
- Search clears immediately
- Ready for next input

## Full Example

```
STEP 1: Click search field
        "Search by Email"
        
STEP 2: Type "ali"
        See dropdown:
        - Alice Johnson (alice@ican.com) ✓
        - Alison Lee (alison@ican.com) ✓
        
STEP 3: Click "Alice Johnson"
        Result:
        - Email field: alice@ican.com
        - Name field: Alice Johnson ✓
        - Verified: ✓ (green checkmark)
        
STEP 4: Select role and ownership
        - Role: Co-Founder
        - Ownership: 60%
        
STEP 5: Click "Add"
        ✅ Co-owner added!
        ✅ Alice Johnson (60%) appears in list
```

## Tips & Tricks

💡 **Faster Co-Owner Entry**:
- Use search for known users (auto-fills name)
- Saves typing name manually
- One click = instant name + verification

💡 **New/Unknown Users**:
- Still required to have ICAN account
- Can search and not find = user not in system yet
- They must sign up first

💡 **Editing After Auto-Fill**:
- Name field still editable
- Good for correcting display names
- Can shorten "Alice Elizabeth Johnson" to "Alice Johnson"

## Expected Behavior Summary

| Action | Expected Result |
|--------|-----------------|
| Type in search field | Auto-search starts after 2 chars |
| See results dropdown | Shows up to 5 matching users |
| Click result | Auto-fills email + name, clears search |
| Name field after | Shows "✓" indicator, verified status |
| Form state | Ready to select role + ownership |
| Click Add | Co-owner added to list |

All auto-fill happens instantly and smoothly! 🎯
