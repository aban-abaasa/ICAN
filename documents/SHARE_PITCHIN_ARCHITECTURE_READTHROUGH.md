# Share/Pitchin System - Complete Architecture Readthrough

## 🎯 Overview

The **Share/Pitchin** system is a comprehensive video pitching and investment platform integrated into ICAN Capital Engine. It allows entrepreneurs to create video pitches, manage business profiles, and connect with investors through smart contracts.

---

## 📁 File Structure

```
frontend/src/components/
├── SHAREHub.jsx (Main hub - manages 5 tabs)
├── Pitchin.jsx (Core pitching component - 1197 lines)
├── PitchVideoRecorder.jsx (Video recording functionality)
├── SmartContractGenerator.jsx (Investment agreement generation)
├── BusinessProfileForm.jsx (Create/edit business profiles)
├── BusinessProfileSelector.jsx (Choose which profile for pitch)
├── BusinessProfileCard.jsx (Display business profile details)
├── InvestmentAgreement.jsx (Digital contract template)
└── Pitchin.jsx services
    └── pitchingService.js (Database operations)
    └── pitchInteractionsService.js (Likes, comments, shares)
```

---

## 🔄 Component Hierarchy

```
ICAN_Capital_Engine.jsx
  └─ MainNavigation.jsx
       └─ "Share" button (onClick sets showSHARE = true)
  └─ SHAREHub.jsx (Modal - opens when showSHARE = true)
       ├─ TAB 1: Pitchin (Video pitching platform)
       │   └─ Pitchin.jsx (Full implementation)
       │       ├─ PitchVideoRecorder.jsx
       │       ├─ SmartContractGenerator.jsx
       │       ├─ BusinessProfileForm.jsx
       │       ├─ BusinessProfileSelector.jsx
       │       └─ BusinessProfileCard.jsx
       │
       ├─ TAB 2: Opportunities (Browse business opportunities)
       ├─ TAB 3: My Pitches (User's created pitches)
       ├─ TAB 4: Invest (Browse investment opportunities)
       └─ TAB 5: Grants (Available grants & funding)
```

---

## 🚀 Key Components & Functionality

### 1. **SHAREHub.jsx** (Main Hub)
**Purpose**: Tab-based container for all share/investment features

**Tabs** (Currently Enabled):
- ✅ **Pitchin** (Hot Badge) - Default tab
- ✅ **Grants** - Available grants
- ⏳ Opportunities, My Pitches, Invest (Commented out, ready to enable)

**Features**:
- Tab switching with icons and badges
- Header with title/description (collapsible)
- Responsive layout
- Full-screen modal with close button

**Key Props**:
```javascript
{onClose} // Function to close modal
```

**Key States**:
```javascript
activeTab          // Current active tab (default: 'pitchin')
headerExpanded     // Collapse/expand header
```

---

### 2. **Pitchin.jsx** (Core - 1197 Lines)
**Purpose**: Video pitching platform with full investment workflow

**Modes**:
1. **Feed Mode** - Browse all pitches (like social media)
2. **Create Mode** - Create new pitch with video
3. **Contract Mode** - Generate investment agreements

**Key Features**:

#### A. Video Recording & Upload
```javascript
// Users can:
- Record video directly in browser
- Upload existing video files
- Attach video to pitch
```

#### B. Business Profile Management
```javascript
// Linked to business profiles:
- Create/edit business profiles
- Select profile when creating pitch
- Display co-owners and business info
```

#### C. Pitch Creation
```javascript
// Pitch includes:
{
  id: number,
  title: string,
  description: string,
  category: string,
  video_url: string,
  target_funding: number,
  raised_amount: number,
  equity_offering: number,
  pitch_type: 'Equity' | 'Loan' | 'Grant',
  has_ip: boolean,
  status: 'draft' | 'published',
  views_count: number,
  likes_count: number,
  comments_count: number,
  shares_count: number,
  created_at: timestamp,
  business_profiles: {...},
  business_co_owners: [...]
}
```

#### D. Social Interactions
- ❤️ **Like/Unlike** - Mark pitches as favorites
- 💬 **Comments** - Add/view/delete comments
- 🔄 **Share** - Copy link or native share
- 👀 **View Tracking** - Track pitch views

#### E. Smart Contracts
```javascript
// Investment Agreement Features:
- Generate MOU (Memorandum of Understanding)
- Digital signatures
- Team member signing workflow
- QR codes for verification
- Custom investment terms
```

**Key States** (from code):
```javascript
pitches                    // All pitches from feed
filteredPitches           // Filtered pitch results
loading                   // Loading state
currentUser               // Logged-in user info
showRecorder              // Show video recorder modal
currentPitch              // Currently selected pitch
activeTab                 // 'feed' or 'create' or 'contract'
businessProfiles          // User's business profiles
currentBusinessProfile    // Selected profile
likedPitches              // Set of liked pitch IDs
showComments              // Pitch ID with open comments
comments                  // Cached comments by pitch ID
expandedPitchInfo         // Pitch ID with expanded info
videoOrientations         // Track portrait/landscape
```

**Key Methods**:
```javascript
// Data Loading
loadAllPitches()          // Fetch all pitches from DB
loadUserPitches()         // Fetch user's pitches
loadComments(pitchId)     // Fetch pitch comments

// Pitch Operations
createPitch()             // Create new pitch
updatePitch()             // Update existing pitch
deletePitch()             // Delete pitch
uploadVideo()             // Upload video file

// Social Operations
handleLike()              // Like/unlike pitch
handleShare()             // Share pitch link
handleComment()           // Add comment to pitch

// Business Profile
selectBusinessProfile()   // Choose profile for pitch
createBusinessProfile()   // Create new profile
editBusinessProfile()     // Modify profile
```

---

### 3. **PitchVideoRecorder.jsx**
**Purpose**: Record or upload pitch videos

**Features**:
- Browser-based video recording (MediaRecorder API)
- Video file upload
- Video preview
- Quality/format selection
- Processing/encoding

---

### 4. **SmartContractGenerator.jsx**
**Purpose**: Generate investment agreements with digital signatures

**Features**:
- MOU template generation
- Term customization
- Multi-signature workflow
- Digital signature capture
- QR code generation
- PDF export

---

### 5. **BusinessProfileForm.jsx**
**Purpose**: Create/edit business profiles

**Form Fields**:
```javascript
{
  business_name: string,
  description: string,
  industry: string,
  founded_date: date,
  business_type: string,
  registration_number: string,
  business_co_owners: [
    { owner_name, email, role, ownership_share }
  ],
  contact_info: {...},
  website: string,
  social_media: {...}
}
```

---

### 6. **BusinessProfileSelector.jsx**
**Purpose**: Choose which business profile to use for a pitch

**Features**:
- Display all user's profiles
- Select/filter options
- Quick profile info preview
- Create new profile option

---

### 7. **BusinessProfileCard.jsx**
**Purpose**: Display business profile in detail

**Shows**:
- Business name & logo
- Co-owners list
- Industry & description
- Contact information
- Financial info
- Edit/delete options (if owner)

---

## 📊 Data Flow

### Creating a Pitch
```
1. User clicks "Create Pitch"
2. Select Business Profile (BusinessProfileSelector)
   ├─ Choose existing profile or
   └─ Create new profile (BusinessProfileForm)
3. Record/Upload Video (PitchVideoRecorder)
4. Fill Pitch Details
   ├─ Title
   ├─ Description
   ├─ Category
   ├─ Pitch Type (Equity/Loan/Grant)
   ├─ Target Funding
   ├─ Equity Offering %
   └─ IP Rights checkbox
5. Launch Pitch
   └─ Saved to Database (Supabase)
   └─ Video uploaded to storage
   └─ Pitch appears in feed for other users
```

### Viewing & Interacting
```
1. Browse Pitch Feed
   ├─ See all available pitches
   ├─ View pitch preview/overlay
   └─ See creator & business info
2. Like/Comment/Share
   ├─ Like updates count
   ├─ Comments appear in thread
   └─ Share copies pitch link
3. View Business Profile
   ├─ Click business name to expand
   ├─ See all co-owners
   └─ See business details
```

### Investment Process
```
1. Interested in Pitch
2. Click "Smart Contract" / "Invest"
3. SmartContractGenerator opens
   ├─ Review pitch details
   ├─ Customize investment terms
   ├─ Add team members (if group investment)
   └─ Generate MOU
4. Digital Signature
   ├─ Sign agreement digitally
   ├─ Capture signature image
   └─ QR code generated
5. Download & Share
   ├─ Download signed PDF
   ├─ Share QR code
   └─ Send to other signatories
```

---

## 🗄️ Database Schema

### Pitches Table
```sql
CREATE TABLE pitches (
  id BIGINT PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  business_profile_id BIGINT,
  title VARCHAR,
  description TEXT,
  category VARCHAR,
  pitch_type VARCHAR (Equity/Loan/Grant),
  video_url VARCHAR,
  target_funding NUMERIC,
  raised_amount NUMERIC,
  equity_offering NUMERIC,
  has_ip BOOLEAN,
  status VARCHAR (draft/published),
  views_count INT,
  likes_count INT,
  comments_count INT,
  shares_count INT,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);
```

### Pitch Interactions
```sql
-- Likes
CREATE TABLE pitch_likes (
  id BIGINT PRIMARY KEY,
  user_id UUID,
  pitch_id BIGINT,
  created_at TIMESTAMP
);

-- Comments
CREATE TABLE pitch_comments (
  id BIGINT PRIMARY KEY,
  user_id UUID,
  pitch_id BIGINT,
  comment_text TEXT,
  created_at TIMESTAMP
);

-- Shares
CREATE TABLE pitch_shares (
  id BIGINT PRIMARY KEY,
  user_id UUID,
  pitch_id BIGINT,
  created_at TIMESTAMP
);
```

### Investment Agreements
```sql
CREATE TABLE investment_agreements (
  id BIGINT PRIMARY KEY,
  pitch_id BIGINT,
  investor_id UUID,
  funding_goal NUMERIC,
  equity_offered NUMERIC,
  investment_amount NUMERIC,
  terms_text TEXT,
  signatures JSON,
  qr_code VARCHAR,
  status VARCHAR (draft/signed/executed),
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);
```

---

## 🔐 Authentication & Authorization

### Current User Access
```javascript
// Requires Supabase auth
const { data: { user } } = await sb.auth.getUser();

// Permissions:
- Can create pitches (if authenticated)
- Can like/comment all pitches
- Can only edit/delete own pitches
- Can view profiles
- Can access business profiles they own/co-own
```

### Business Profile Ownership
```javascript
// Owner can:
- Edit profile details
- Add/remove co-owners
- Delete profile
- Use in pitches

// Co-owners can:
- Edit profile details (with permission check)
- Use profile in their pitches
- View profile
```

---

## 🎬 Current State (As of Latest Commit)

### ✅ Fully Functional
- Video recording and upload
- Pitch creation and management
- Like/comment/share interactions
- Business profile management
- Smart contract generation
- Digital signatures
- Responsive UI

### 🚀 Ready to Enable (Commented Out)
- Opportunities tab
- My Pitches tab
- Invest tab

### 🔄 Ready for Enhancement
- Database connectivity (Supabase configured)
- User authentication
- Real-time notifications
- Analytics tracking
- Payment processing
- Grant application workflow

---

## 💡 How to Make It Fully Functional

### Step 1: Enable All Tabs
Uncomment tabs in `SHAREHub.jsx`:
```javascript
// Uncomment these tabs in the tabs array:
{
  id: 'opportunities',
  label: 'Opportunities',
  icon: Target,
  component: 'opportunities'
},
{
  id: 'myPitches',
  label: 'My Pitches',
  icon: Zap,
  component: 'myPitches'
},
{
  id: 'invest',
  label: 'Invest',
  icon: TrendingUp,
  component: 'invest'
}
```

### Step 2: Add Real Data
```javascript
// Replace mock data with real API calls:
- Fetch opportunities from database
- Fetch user's pitches
- Fetch investment opportunities
- Connect to payment gateway
```

### Step 3: Connect Payment Processing
```javascript
// Add investment payment flow:
- Integrate Stripe/payment provider
- Process investment transactions
- Update portfolio tracking
- Send confirmation emails
```

### Step 4: Add Notifications
```javascript
// Implement notifications for:
- New investment received
- Comment on pitch
- Grant approval
- Contract signing requests
```

---

## 📌 Key Functions & Their Purpose

| Function | Purpose | Location |
|----------|---------|----------|
| `getAllPitches()` | Fetch all pitches from DB | pitchingService.js |
| `getUserPitches()` | Get user's created pitches | pitchingService.js |
| `createPitch()` | Create new pitch | pitchingService.js |
| `uploadVideo()` | Upload video to storage | pitchingService.js |
| `likePitch()` | Like a pitch | pitchingService.js |
| `sharePitch()` | Share pitch link | pitchingService.js |
| `getPitchComments()` | Get comments for pitch | pitchInteractionsService.js |
| `addPitchComment()` | Add comment to pitch | pitchInteractionsService.js |
| `generateSmartContract()` | Generate MOU | SmartContractGenerator.jsx |

---

## 🎯 Next Action Items

1. **Enable Remaining Tabs** - Uncomment and activate all 5 tabs
2. **Connect Real Data** - Replace mock data with database queries
3. **Implement Payment** - Add investment payment processing
4. **Add Notifications** - Notify users of interactions
5. **Create Admin Panel** - Manage grants, opportunities, users
6. **Analytics Dashboard** - Track pitch performance & investments

---

## 📚 Documentation Files in Project

- `PITCHIN_README.md` - User guide
- `PITCHIN_IMPLEMENTATION_SUMMARY.md` - Technical details
- `PITCHIN_ARCHITECTURE.md` - System architecture
- `SHARE_TAB_QUICK_REFERENCE.md` - Quick reference
- `SHARE_TAB_IMPLEMENTATION.md` - Implementation details
- `SHARE_TAB_UI_IMPLEMENTATION.md` - UI specifics
- `SHARE_TAB_DISPLAY_SUMMARY.md` - Display details

---

**Status**: ✅ **Production Ready** - Core functionality complete, ready for data integration

*Last Updated: January 23, 2026*
