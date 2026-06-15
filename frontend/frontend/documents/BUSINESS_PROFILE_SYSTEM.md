# Business Profile System - Complete Guide

## Overview

The Business Profile System enables entrepreneurs and business owners to create and manage business accounts with up to 5 co-owners before creating pitches or smart contracts. This ensures legitimacy and clear ownership structure.

## Features

### 1. **Complete Business Registration**
- Business name and type (LLC, Corporation, Partnership, etc.)
- Registration number and tax ID
- Business address and website
- Description and founding year
- Total capital information

### 2. **Co-Owner Management**
- Add up to 5 co-owners
- Define ownership percentages (must total 100%)
- Assign roles (Founder, Co-Founder, CTO, CFO, CEO, Partner, Investor)
- Contact information for each owner
- Validation of ownership structure

### 3. **Profile Switching**
- Create multiple business profiles
- Switch between profiles when creating pitches
- Select profile when creating smart contracts
- Delete profiles (if not currently active)

### 4. **Integration with Pitches & Contracts**
- Pitches linked to specific business profile
- Smart contracts include business entity information
- All co-owners displayed in contracts
- Ownership structure included in MOU documents

## System Workflow

### Step 1: Business Profile Creation

When user clicks "Create Pitch" or "Create Smart Contract":
```
↓
Check if business profile exists?
├─ YES → Proceed with pitch/contract
│
└─ NO → Two options:
    ├─ Create new profile → BusinessProfileForm
    └─ Select existing → BusinessProfileSelector
```

### Step 2: Business Profile Form

**Step 2.1: Business Information**
```
Required:
- Business Name
- Business Type

Optional:
- Registration Number
- Tax ID
- Founded Year
- Business Address
- Website
- Description
- Total Capital
```

**Step 2.2: Co-Owners**
```
Required (at least 1):
- Owner Name
- Email
- Ownership Share (%)
- Role

Optional:
- Phone number

Constraints:
- Maximum 5 co-owners
- Total ownership = 100%
- Can add/remove/edit
```

**Step 2.3: Review**
```
Review all business details
Review ownership structure
Confirm before creation
```

### Step 3: Profile Selector

When multiple profiles exist:
```
- Show all profiles
- Display business name, type, capital
- Show co-owners summary
- Current profile marked with ✓
- Switch profiles (click to select)
- Create new profile
- Delete unused profiles
```

### Step 4: Pitch/Contract Creation

Once profile selected:
```
Profile header shows:
- Business name
- All co-owners with shares
- Business type and capital
- Quick switch option (click header)

Included in documents:
- All business entity information
- Complete ownership structure
- All co-owner details
- Pitch/contract terms
```

## Components

### BusinessProfileForm.jsx
**Purpose**: Create or edit business profiles

**Props**:
```javascript
onProfileCreated: (profile) => void    // Called when profile created
onCancel: () => void                   // Called when cancelled
```

**State**:
```javascript
step: 'business' | 'owners' | 'review'
businessData: {
  businessName: string,
  businessType: string,
  registrationNumber: string,
  taxId: string,
  website: string,
  description: string,
  businessAddress: string,
  foundedYear: number,
  totalCapital: string
}
coOwners: Array<{
  id: number,
  name: string,
  email: string,
  phone: string,
  ownershipShare: number,
  role: string
}>
```

### BusinessProfileSelector.jsx
**Purpose**: View and switch between business profiles

**Props**:
```javascript
profiles: Array<BusinessProfile>       // All profiles
currentProfile: BusinessProfile | null // Selected profile
onSelectProfile: (profile) => void     // Profile selection handler
onCreateNew: () => void                // Create new handler
onDelete: (profileId) => void          // Delete handler
```

**Display**:
```
- Profile card for each
- Current profile highlighted
- Co-owners summary
- Business info preview
- Delete button
```

### Pitchin.jsx (Updated)
**New State**:
```javascript
businessProfiles: Array<BusinessProfile>
currentBusinessProfile: BusinessProfile | null
showBusinessForm: boolean
showProfileSelector: boolean
```

**New Functions**:
```javascript
handleCreatePitchClick()          // Check profile, show form if needed
handleSmartContractClick(pitch)   // Check profile, create contract if ready
handleBusinessProfileCreated()    // Add profile to list
handleSelectBusinessProfile()     // Switch active profile
handleDeleteBusinessProfile()     // Remove profile
```

**New Features**:
```
- Profile indicator in header
- Create Pitch requires profile
- Smart Contract requires profile
- Profile switching capability
- Business info display
```

### SmartContractGenerator.jsx (Updated)
**New Props**:
```javascript
businessProfile: BusinessProfile | null
```

**New Features**:
```
- Display business profile in purchase step
- Include business info in MOU
- Show co-owners in contract
- Full business entity details
```

## Data Structure

### BusinessProfile Object
```javascript
{
  id: number,                          // Unique ID (timestamp)
  businessName: string,
  businessType: string,
  registrationNumber: string,
  taxId: string,
  website: string,
  description: string,
  businessAddress: string,
  foundedYear: number,
  totalCapital: string,
  coOwners: Array<{
    id: number,
    name: string,
    email: string,
    phone: string,
    ownershipShare: number,            // 0-100%
    role: string                       // Founder, CTO, CFO, etc.
  }>,
  createdAt: string,                   // ISO timestamp
  status: 'active' | 'inactive'        // Profile status
}
```

## User Flows

### Flow 1: New User Creating First Pitch
```
1. Click "Create Pitch"
2. No profiles exist
3. BusinessProfileForm opens
4. Fill business information
5. Add co-owners and shares
6. Review and confirm
7. Profile created and selected
8. Pitch recorder opens
9. Create and publish pitch
```

### Flow 2: User with Multiple Profiles
```
1. Click "Create Pitch"
2. Profiles exist
3. BusinessProfileSelector opens
4. Show all profiles
5. Click profile to select
6. Selector closes
7. Pitch recorder opens
```

### Flow 3: Add New Co-Owner to Existing Business
```
1. Create new profile (duplicate)
2. Fill same business info
3. Add new co-owner
4. Adjust all ownership %
5. Confirm totals = 100%
6. Review and create
7. Switch to new profile
8. Continue with pitch
```

### Flow 4: Smart Contract with Business Info
```
1. Interested investor clicks "Smart Contract"
2. Not authenticated - show profile selector
3. Select/create business profile
4. SmartContractGenerator opens
5. Business info displayed
6. Co-owners listed
7. Full business details in MOU
8. Share purchase details
9. All signatories can see business info
```

## Validation Rules

### Business Information
```
✓ Business Name: Required, non-empty
✓ Business Type: Required, from dropdown
✓ Registration Number: Optional
✓ Tax ID: Optional
✓ Website: Optional, URL format
✓ Address: Optional
✓ Description: Optional
✓ Founded Year: Valid year
✓ Total Capital: Optional, numeric
```

### Co-Owners
```
✓ Minimum 1 co-owner required
✓ Maximum 5 co-owners allowed
✓ Name: Required, non-empty
✓ Email: Required, valid email
✓ Phone: Optional
✓ Ownership Share: Required, 0-100%
✓ Role: Required, from dropdown
✓ Total Shares: Must equal 100%
```

### Profile Management
```
✓ Can create multiple profiles
✓ Can only delete unused profiles
✓ Must have active profile to create pitch
✓ Can switch profiles anytime
✓ Profile data immutable after creation
```

## Error Handling

### Creation Errors
```
"Please fill in business name"
  → Business name required

"Please add at least one owner"
  → Must have minimum 1 owner

"Ownership shares must total 100%"
  → Verify all percentages sum to 100%

"Maximum 5 co-owners allowed"
  → Cannot exceed 5 owners

"Total ownership would exceed 100%"
  → Warning when adding new owner
```

### Selection Errors
```
"No business profiles found"
  → Show create new profile option

"Profile deleted"
  → Clear selection, show selector

"Profile no longer exists"
  → Refresh profile list
```

## Security Considerations

### Data Protection
✓ No sensitive financial data stored in component
✓ Ownership shares for transparency
✓ Contact info shared with co-signers only
✓ Profile deletion available to creator
✓ No encryption needed (not PII-heavy)

### Validation
✓ Ownership percentages verified (0-100%, sum=100%)
✓ Maximum 5 co-owners enforced
✓ Email format validation
✓ Required fields verified
✓ No duplicate entries allowed

### Privacy
✓ Profile only visible to creator and co-owners
✓ Business info included in contracts shared with signatories
✓ Co-owner details visible in signed contracts
✓ No public profile directory

## Future Enhancements

1. **Profile Verification**
   - Verify business registration
   - Validate tax ID
   - Confirm co-owner identity

2. **Document Integration**
   - Upload business license
   - Upload certificate of incorporation
   - Upload tax documents

3. **Banking Integration**
   - Link bank account
   - Verify business bank
   - Enable automatic payouts

4. **Legal Templates**
   - Different MOU templates by type
   - Auto-fill business info
   - State-specific legal documents

5. **Blockchain Integration**
   - Register profile on blockchain
   - NFT certificate of registration
   - Immutable ownership records

6. **Co-owner Invitations**
   - Send invites to co-owners
   - Co-owner approval flow
   - Digital signatures from all

7. **Profile Analytics**
   - Track pitches by profile
   - Monitor investor interest
   - Revenue attribution by owner

8. **Multi-currency**
   - Support different currencies
   - Exchange rate calculation
   - Regional customization

9. **API Integration**
   - Export business data
   - Integration with accounting
   - ERP system sync

10. **Compliance**
    - GDPR compliance
    - CCPA compliance
    - Regular audit logs

## Integration Checklist

✅ BusinessProfileForm component created
✅ BusinessProfileSelector component created
✅ Pitchin updated with profile management
✅ SmartContractGenerator integrated
✅ Profile display in header
✅ Create pitch with profile check
✅ Smart contract with profile info
✅ MOU includes business details
✅ No syntax errors
✅ Full documentation

## Testing Checklist

- [ ] Create new business profile (all fields)
- [ ] Add multiple co-owners
- [ ] Verify ownership % validation
- [ ] Create profile without optional fields
- [ ] Switch between profiles
- [ ] Create pitch with profile
- [ ] Create smart contract with profile
- [ ] View business info in MOU
- [ ] Delete unused profile
- [ ] Test validation errors
- [ ] Test with different business types
- [ ] Verify profile indicator in header

## Support

For issues with Business Profiles:
- Check ownership percentages total 100%
- Verify all required fields filled
- Ensure unique co-owner emails
- Confirm business name not empty
- Contact development team with details
