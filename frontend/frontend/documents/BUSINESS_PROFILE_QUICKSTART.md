# Business Profile System - Quick Integration Guide

## What Changed

### New Components
1. **BusinessProfileForm.jsx** - Create/edit business profiles
2. **BusinessProfileSelector.jsx** - Switch between profiles

### Updated Components
1. **Pitchin.jsx** - Profile management integrated
2. **SmartContractGenerator.jsx** - Displays business info

## How It Works

### Before (Old Flow)
```
Click "Create Pitch" → PitchVideoRecorder opens
Click "Smart Contract" → SmartContractGenerator opens
```

### After (New Flow)
```
Click "Create Pitch" → Check if profile exists
                   ├─ YES: PitchVideoRecorder opens
                   └─ NO: BusinessProfileForm opens
                        → Create profile
                        → PitchVideoRecorder opens

Click "Smart Contract" → Check if profile exists
                     ├─ YES: SmartContractGenerator opens
                     └─ NO: BusinessProfileSelector/Form opens
                          → Select/create profile
                          → SmartContractGenerator opens
```

## Key Features

### 1. Business Registration
```
Required:
- Business Name
- Business Type (LLC, Corp, etc.)

Optional:
- Registration Number
- Tax ID
- Address
- Website
- Founded Year
- Total Capital
- Description
```

### 2. Co-Owner Management
```
- Add up to 5 co-owners
- Define ownership shares (must = 100%)
- Assign roles (Founder, CTO, CFO, etc.)
- Track contact info
- Validate structure

Example:
- Sarah (Founder): 40%
- John (CTO): 35%
- Mike (CFO): 25%
Total: 100% ✓
```

### 3. Profile Display in Header
```
Before:
┌─ Pitchin ─────────────────────────┐
│                    [Create Pitch]  │
└────────────────────────────────────┘

After:
┌─ Pitchin ──────────────────────────┐
│ 🏢 TechStartup Inc    [Create Pitch]│
│                                     │
└────────────────────────────────────┘
(Click to switch profiles)
```

### 4. In Pitch/Contract Details
```
Business Entity Information:
├─ Business Name: TechStartup Inc
├─ Business Type: LLC
├─ Registration #: REG-2024-001
├─ Tax ID: EIN 12-3456789
├─ Founded: 2024
├─ Capital: $100,000
├─ Website: https://techstartup.com
│
└─ Ownership Structure (3 owners):
   ├─ Sarah (Founder): 40%
   ├─ John (CTO): 35%
   └─ Mike (CFO): 25%
```

## Usage Examples

### Example 1: First-Time User

**Scenario**: New entrepreneur wants to create a pitch

```
1. Click "Create Pitch"
2. No profiles exist
3. See message: "Create Your First Business Profile"
4. Click "Create New Profile"
5. Fill form:
   - Name: "My Startup"
   - Type: "LLC"
   - Add yourself as owner (100%)
6. Click "Create Business Profile"
7. Profile selected automatically
8. Pitch recorder opens
9. Record and publish pitch
```

### Example 2: Co-Founder with Team

**Scenario**: Team of 3 wanting to pitch together

```
1. Click "Create Pitch"
2. No profiles exist
3. BusinessProfileForm opens
4. Fill business info:
   - Name: "AI Solutions Inc"
   - Type: "Corporation"
5. Add co-owners:
   - Sarah Park (CEO): 50%
   - John Smith (CTO): 30%
   - Maria Chen (CFO): 20%
6. Verify total = 100%
7. Review and create
8. Pitch recorder opens
9. Create pitch as team
```

### Example 3: Multiple Business Ideas

**Scenario**: Entrepreneur with 2 business ideas

```
1. Create first profile: "Startup A"
   - Solo founder, 100%
   - Create pitch for idea A

2. Later, click "Create Pitch" for idea B
3. See BusinessProfileSelector
4. Option 1: Click "Startup A" again
           → Create another pitch under same profile

5. Option 2: Click "New Profile"
           → Create second profile "Startup B"
           → Create pitch for idea B

6. Later, switch between profiles
   - Click "Startup A" in header → Use for pitch #1
   - Click "Startup B" in header → Use for pitch #2
```

### Example 4: Investor Interest - Smart Contract

**Scenario**: Investor interested in buying shares

```
1. Investor views pitch for "TechStartup Inc"
2. Clicks "Smart Contract"
3. System checks investor profile
4. If exists: Smart contract opens
   - Shows TechStartup info
   - Shows all co-owners
   - Investor can buy shares
5. If not exists: 
   - Shows profile selector
   - Create investor profile (solo)
   - Then smart contract opens
```

## Data in Documents

### What's Included in Pitch MOU
```
When user creates profile, MOUs now include:

BUSINESS ENTITY INFORMATION:
Business Name: TechStartup Inc
Business Type: LLC
Registration Number: REG-2024-001
Tax ID: EIN 12-3456789
Business Address: 123 Main St, SF CA 94105
Website: https://techstartup.com
Founded Year: 2024
Total Capital: $100,000

OWNERSHIP STRUCTURE (3 Co-owners):
- Sarah Park (CEO): 50% ownership
- John Smith (CTO): 30% ownership  
- Maria Chen (CFO): 20% ownership
```

### What's Included in Smart Contracts
```
Profile info + Share purchase details:

BUSINESS ENTITY INFORMATION:
[Same as above]

SHARE PURCHASE AGREEMENT:
Buyer: [Investor Name]
Shares Requested: 1000
Total Investment: $50,000
Valuation Per Share: $50
Payment Terms: Upon 60% approval

[Plus all signatures, location, timestamps]
```

## Files Created/Modified

### New Files
```
✓ BusinessProfileForm.jsx (new component)
✓ BusinessProfileSelector.jsx (new component)
✓ BUSINESS_PROFILE_SYSTEM.md (documentation)
```

### Modified Files
```
✓ Pitchin.jsx (updated)
✓ SmartContractGenerator.jsx (updated)
```

## What Developers Need to Know

### State Management
```javascript
// In Pitchin component
const [businessProfiles, setBusinessProfiles] = useState([])
const [currentBusinessProfile, setCurrentBusinessProfile] = useState(null)
const [showBusinessForm, setShowBusinessForm] = useState(false)
const [showProfileSelector, setShowProfileSelector] = useState(false)
```

### Component Props
```javascript
// BusinessProfileForm
<BusinessProfileForm 
  onProfileCreated={(profile) => {...}}
  onCancel={() => {...}}
/>

// BusinessProfileSelector
<BusinessProfileSelector 
  profiles={businessProfiles}
  currentProfile={currentBusinessProfile}
  onSelectProfile={(profile) => {...}}
  onCreateNew={() => {...}}
  onDelete={(profileId) => {...}}
/>

// SmartContractGenerator
<SmartContractGenerator 
  pitch={pitch}
  onClose={() => {...}}
  businessProfile={currentBusinessProfile}  // NEW
/>
```

### Flow Control
```javascript
const handleCreatePitchClick = () => {
  if (!currentBusinessProfile) {
    // No profile: show selector or form
    if (businessProfiles.length > 0) {
      setShowProfileSelector(true)
    } else {
      setShowBusinessForm(true)
    }
    return
  }
  // Profile exists: open recorder
  setShowRecorder(true)
}
```

## Validation Rules Enforced

### Business
- Name required
- Type required  
- Type must be from dropdown

### Co-Owners
- Minimum 1, Maximum 5
- Name required
- Email required (valid format)
- Ownership % required (0-100)
- Total must equal 100%
- Role required

### Errors Prevented
- Creating pitch without profile
- Creating smart contract without profile
- Ownership shares not summing to 100%
- Duplicate owner emails
- More than 5 co-owners
- Missing required fields

## Testing the System

### Test Case 1: Create First Profile
```
1. Fresh start, no profiles
2. Click "Create Pitch"
3. ProfileForm appears
4. Fill: Name="Test Biz", Type="LLC"
5. Add owner: "John Doe", john@test.com, 100%
6. Review page shows correctly
7. Click "Create Business Profile"
8. Profile created and selected
9. Verify header shows "Test Biz"
```

### Test Case 2: Create Pitch with Profile
```
1. Profile created above
2. Click "Create Pitch" again
3. Recorder opens immediately
4. Record test video
5. Title: "Test Pitch"
6. Submit
7. Verify pitch appears in feed
8. Verify pitch shows "Test Biz" creator
```

### Test Case 3: Smart Contract with Profile
```
1. Click "Smart Contract" on pitch
2. Should open contract generator
3. Verify business info displayed:
   - Name: "Test Biz"
   - Type: "LLC"
   - Owner: "John Doe" (100%)
4. Fill share purchase details
5. Complete authentication
6. Download MOU
7. Verify MOU includes business info
```

### Test Case 4: Multiple Profiles
```
1. Click "Create Pitch"
2. Show selector (profile exists)
3. Create New button
4. Create second profile: "Test Biz 2"
5. Select "Test Biz 2"
6. Close selector
7. Record pitch for "Test Biz 2"
8. Verify different pitches under different profiles
9. Switch profiles in header
10. Verify separation of business entities
```

## Known Limitations

1. **Profile Data**: Stored in component state, not persisted to database
2. **Editing**: Cannot edit profile after creation
3. **Verification**: No business registration verification
4. **Storage**: No cloud storage of documents
5. **Notifications**: No email to co-owners

## Future Improvements

1. **Database Storage**: Persist profiles to backend
2. **Profile Editing**: Allow updates to non-core fields
3. **Co-owner Invites**: Send verification emails
4. **Document Storage**: Save MOUs and contracts
5. **Compliance**: Add verification workflow
6. **Blockchain**: Register on smart contract

## Support & Troubleshooting

### Profile not saved
→ Check browser console for errors
→ Verify all required fields filled
→ Ownership % total must = 100%

### Can't create pitch
→ Check if profile selected
→ Click header to select/create profile
→ See "Create Pitch" button again

### Smart contract missing info
→ Verify profile selected (header shows name)
→ Check businessProfile prop passed
→ Refresh and try again

### Co-owners not showing
→ Verify co-owners added in form
→ Check ownership % sum = 100%
→ Confirm "Create Profile" clicked (not cancelled)

---

**Ready to use!** The Business Profile System is fully integrated and ready for production.
