# Creator Business Profile & Wallet Integration Guide

## Overview
This guide shows how to give pitch creators the ability to:
1. Create/manage business profiles
2. Add co-owners
3. Manage wallet transactions
4. Track pitch financials

## File Structure

### Business Profile Files
- **BusinessProfileCard.jsx** - Display business profile with co-owners
- **BusinessProfileForm.jsx** - Create/edit business profiles
- **BusinessProfileSelector.jsx** - Select business profile for pitch

### Wallet Files
- **ICANWallet.jsx** - Main wallet component (3748 lines)
- **WalletFunctions.jsx** - Wallet utility functions

## Integration Steps

### Step 1: Link CreatorPage to Business Profile
In `CreatorPage.jsx`, before showing the pitch form:
```jsx
const [selectedBusinessProfile, setSelectedBusinessProfile] = useState(null);

// Show business profile selector
<BusinessProfileSelector 
  onSelect={setSelectedBusinessProfile}
  userId={currentUserId}
/>
```

### Step 2: Add Business Profile to Pitch Details Form
Update `PitchDetailsForm.jsx`:
```jsx
const handlePitchSubmit = (formData) => {
  const pitchData = {
    ...formData,
    businessProfileId: selectedBusinessProfile?.id,
    creatorId: currentUserId,
    timestamp: new Date()
  };
  // Save to database
};
```

### Step 3: Connect Wallet to Pitch Earnings
When pitch gets funded:
```jsx
// Track pitch funding in wallet
const logPitchEarning = async (pitchId, amount) => {
  await walletTransactionService.recordTransaction({
    type: 'pitch_earning',
    amount: amount,
    pitchId: pitchId,
    businessProfileId: selectedBusinessProfile?.id,
    description: `Funding received for pitch: ${pitchTitle}`
  });
};
```

## Key Data Structure

### Pitch Data
```javascript
{
  id: string,
  title: string,
  description: string,
  creator: string,
  creatorId: string,
  businessProfileId: string,
  videoUrl: string,
  category: string,
  pitchType: 'Equity' | 'Debt' | 'Revenue Share',
  targetGoal: number,
  currentlyRaised: number,
  equityOffering: number,
  teamMembers: array,
  hasIP: boolean,
  createdAt: timestamp
}
```

### Business Profile Data
```javascript
{
  id: string,
  userId: string,
  businessName: string,
  businessType: string,
  registrationNumber: string,
  taxId: string,
  website: string,
  description: string,
  businessAddress: string,
  foundedYear: number,
  totalCapital: number,
  businessCoOwners: [
    {
      ownerName: string,
      ownerEmail: string,
      ownerPhone: string,
      role: string,
      ownershipShare: number
    }
  ]
}
```

### Wallet Transaction Data
```javascript
{
  id: string,
  userId: string,
  businessProfileId: string,
  type: 'pitch_earning' | 'investment' | 'withdrawal',
  amount: number,
  currency: 'USD' | 'KES' | 'UGX',
  pitchId?: string,
  description: string,
  status: 'pending' | 'completed' | 'failed',
  createdAt: timestamp
}
```

## Creator Powers

### 1. Business Profile Management
- Create multiple business profiles
- Add/remove co-owners
- Set ownership percentages
- Update company information
- Verify co-owner identities

### 2. Pitch Management
- Create pitches under business profile
- Record/upload videos
- Set fundraising goals
- Manage co-founder team
- Track pitch views and investor interest

### 3. Financial Management
- View pitch earnings
- Track investor commitments
- Manage wallet balance
- Withdraw funds
- View transaction history

### 4. Co-Owner Permissions
- Grant access to specific pitches
- Set role-based permissions
- Track co-owner contributions
- Approve transactions (if needed)

## Implementation Checklist

- [ ] Add BusinessProfileSelector to CreatorPage
- [ ] Link selected profile to PitchDetailsForm
- [ ] Create pitch with business profile reference
- [ ] Set up wallet transaction logging for pitch earnings
- [ ] Add pitch dashboard to view earnings
- [ ] Implement withdrawal functionality
- [ ] Add transaction history view
- [ ] Set up email notifications for pitch activity
- [ ] Create investor dashboard
- [ ] Add payment integration

## Services to Use

### Pitching Service
```javascript
import { 
  createBusinessProfile, 
  updateBusinessProfile,
  getSupabase,
  saveBusinessCoOwners 
} from '../services/pitchingService';
```

### Wallet Service
```javascript
import { walletService } from '../services/walletService';
import { walletTransactionService } from '../services/walletTransactionService';
import { walletAccountService } from '../services/walletAccountService';
```

### Agent Service (for payouts)
```javascript
import agentService from '../services/agentService';
```

## Next Steps
1. Review current business profile structure
2. Connect PitchDetailsForm to BusinessProfileSelector
3. Set up pitch-to-wallet earning tracking
4. Create dashboard for pitch creators
5. Implement withdrawal/payout system
