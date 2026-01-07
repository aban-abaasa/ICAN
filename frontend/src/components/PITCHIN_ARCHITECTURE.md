# Pitchin Architecture & Technical Documentation

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      ICAN Capital Engine                    │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              MainNavigation Component               │   │
│  │  [Dashboard] [Security] [Readiness] [Growth] [Trust]│   │
│  │  [SHARE] ← User clicks SHARE tab                    │   │
│  └─────────────────────────────────────────────────────┘   │
│                           ↓                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              SHAREHub Component                      │   │
│  │  Tabs: [Pitchin*] [Opportunities] [My Pitches]     │   │
│  │        [Invest] [Grants]  (* = Active)             │   │
│  └─────────────────────────────────────────────────────┘   │
│                           ↓                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                  Pitchin Component                   │   │
│  │                                                     │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐         │   │
│  │  │  Feed    │  │ My       │  │Interested│         │   │
│  │  │  Tab     │  │ Pitches  │  │ Tab      │         │   │
│  │  └──────────┘  └──────────┘  └──────────┘         │   │
│  │       ↓                                             │   │
│  │  ┌──────────────────────────────────────┐          │   │
│  │  │  Pitch Grid (1-2 columns)            │          │   │
│  │  │  ┌─────────────────────────────────┐ │          │   │
│  │  │  │ Pitch Card                      │ │          │   │
│  │  │  │ ├─ Video Preview                │ │          │   │
│  │  │  │ ├─ Pitch Title & Description    │ │          │   │
│  │  │  │ ├─ Funding Info                 │ │          │   │
│  │  │  │ ├─ Team Members                 │ │          │   │
│  │  │  │ └─ Like│Comment│Share│Contract  │ │          │   │
│  │  │  └─────────────────────────────────┘ │          │   │
│  │  └──────────────────────────────────────┘          │   │
│  │       ↓                                             │   │
│  │  ┌──────────────────────────────────────┐          │   │
│  │  │ [Create Pitch] Button                │          │   │
│  │  └──────────────────────────────────────┘          │   │
│  └─────────────────────────────────────────────────────┘   │
│            ↓ (User clicks Create Pitch)                    │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │      PitchVideoRecorder Component                   │   │
│  │                                                     │   │
│  │  ┌──────────────────────────────────────┐          │   │
│  │  │ Video Recording/Upload Area          │          │   │
│  │  │ ├─ Camera Feed Display               │          │   │
│  │  │ └─ Record│Stop│Upload Buttons        │          │   │
│  │  └──────────────────────────────────────┘          │   │
│  │                                                     │   │
│  │  ┌──────────────────────────────────────┐          │   │
│  │  │ Pitch Details Form                   │          │   │
│  │  │ ├─ Title Input                       │          │   │
│  │  │ ├─ Creator Name                      │          │   │
│  │  │ ├─ Description Textarea              │          │   │
│  │  │ ├─ Category Dropdown                 │          │   │
│  │  │ ├─ Pitch Type Dropdown               │          │   │
│  │  │ ├─ Funding Goals                     │          │   │
│  │  │ ├─ IP Checkbox                       │          │   │
│  │  │ └─ Team Members Manager              │          │   │
│  │  └──────────────────────────────────────┘          │   │
│  │                                                     │   │
│  │  [Launch Your Pitch] Button                        │   │
│  └─────────────────────────────────────────────────────┘   │
│            ↓ (User clicks Smart Contract)                  │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │   SmartContractGenerator Component (Modal)          │   │
│  │                                                     │   │
│  │  ┌──────────────────────────────────────┐          │   │
│  │  │ Step Indicator                       │          │   │
│  │  │ [1. MOU] [2. Review] [3. Sign] [4. Final] │ │   │
│  │  └──────────────────────────────────────┘          │   │
│  │                                                     │   │
│  │  ┌─ Step 1: MOU ────────────────────────┐          │   │
│  │  │ Memorandum of Understanding          │          │   │
│  │  │ ├─ Auto-generated MOU text           │          │   │
│  │  │ ├─ Team member list                  │          │   │
│  │  │ ├─ Add/Remove members                │          │   │
│  │  │ └─ [Review & Continue]               │          │   │
│  │  └──────────────────────────────────────┘          │   │
│  │                                                     │   │
│  │  ┌─ Step 2: Review ─────────────────────┐          │   │
│  │  │ Contract Details Review               │          │   │
│  │  │ ├─ Pitch info summary                 │          │   │
│  │  │ ├─ Financial terms                    │          │   │
│  │  │ ├─ Signatories list                   │          │   │
│  │  │ ├─ 60% requirement note               │          │   │
│  │  │ └─ [Proceed to Signing]               │          │   │
│  │  └──────────────────────────────────────┘          │   │
│  │                                                     │   │
│  │  ┌─ Step 3: Sign ───────────────────────┐          │   │
│  │  │ Digital Signatures                   │          │   │
│  │  │ For each member:                     │          │   │
│  │  │ ├─ Member name display               │          │   │
│  │  │ ├─ Signed/Pending status             │          │   │
│  │  │ └─ If pending:                       │          │   │
│  │  │    ├─ Canvas signature area          │          │   │
│  │  │    ├─ [Clear] [Sign] buttons         │          │   │
│  │  │    └─ Automatic timestamp/location   │          │   │
│  │  │ └─ If signed:                        │          │   │
│  │  │    └─ QR Code display                │          │   │
│  │  │                                      │          │   │
│  │  │ Progress bar: X/Y required signatures│          │   │
│  │  │ [Finalize Agreement] (when ≥60%)     │          │   │
│  │  └──────────────────────────────────────┘          │   │
│  │                                                     │   │
│  │  ┌─ Step 4: Finalize ───────────────────┐          │   │
│  │  │ Success Confirmation                 │          │   │
│  │  │ ├─ Green checkmark icon              │          │   │
│  │  │ ├─ "Agreement Finalized!" message    │          │   │
│  │  │ ├─ List of signatories               │          │   │
│  │  │ └─ Buttons:                          │          │   │
│  │  │    ├─ [Download Document]            │          │   │
│  │  │    ├─ [Share Agreement]              │          │   │
│  │  │    └─ [Done]                         │          │   │
│  │  └──────────────────────────────────────┘          │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Data Flow Diagram

```
                    ┌────────────────────┐
                    │  User Actions      │
                    └────────────────────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
        ↓                  ↓                  ↓
    Create Pitch      View Pitches      Smart Contract
        │                  │                  │
        ↓                  ↓                  ↓
   ┌─────────────┐ ┌──────────────┐ ┌──────────────┐
   │ Upload/     │ │ Fetch Pitch  │ │ Generate MOU │
   │ Record Video│ │ Data         │ │              │
   └─────────────┘ └──────────────┘ └──────────────┘
        │                  │                  │
        ↓                  ↓                  ↓
   ┌─────────────┐ ┌──────────────┐ ┌──────────────┐
   │ Fill Form   │ │ Display Grid │ │ Add Members  │
   │ Data        │ │ Layout       │ │              │
   └─────────────┘ └──────────────┘ └──────────────┘
        │                  │                  │
        ↓                  ↓                  ↓
   ┌─────────────┐ ┌──────────────┐ ┌──────────────┐
   │ Create Pitch│ │ Store State  │ │ Sign Document│
   │ Object      │ │ in Component │ │              │
   └─────────────┘ └──────────────┘ └──────────────┘
        │                              │
        └──────────────┬───────────────┘
                       │
                       ↓
            ┌────────────────────────┐
            │ Update Pitches Array   │
            │ Re-render Components   │
            └────────────────────────┘
```

## State Management

### Pitchin.jsx State
```javascript
{
  pitches: [
    {
      id: 1,
      creator: string,
      title: string,
      description: string,
      category: string,
      videoUrl: string,
      likes: number,
      comments: number,
      shares: number,
      raised: string,
      goal: string,
      equity: string,
      timestamp: string,
      members: string[],
      hasIP: boolean,
      pitchType: string
    }
  ],
  showRecorder: boolean,
  currentPitch: object | null,
  activeTab: 'feed' | 'myPitches' | 'interested',
  selectedForContract: object | null
}
```

### PitchVideoRecorder.jsx State
```javascript
{
  isRecording: boolean,
  recordedChunks: Blob[],
  previewUrl: string | null,
  formData: {
    title: string,
    description: string,
    creator: string,
    category: string,
    raised: string,
    goal: string,
    equity: string,
    pitchType: string,
    hasIP: boolean,
    members: string[]
  }
}
```

### SmartContractGenerator.jsx State
```javascript
{
  step: 'mou' | 'review' | 'sign' | 'final',
  members: string[],
  newMember: string,
  signatories: {
    [memberName]: {
      signed: boolean,
      timestamp: string | null,
      location: string | null,
      signature: string | null (canvas data)
    }
  },
  signatureData: {
    [memberName]: {
      member: string,
      pitch: string,
      timestamp: string,
      location: string,
      verified: boolean
    }
  }
}
```

## Component Lifecycle

### Pitchin.jsx
```
Mount
  ↓
Initialize pitches state with sample data
  ↓
Render pitch feed grid
  ↓
User interactions:
  ├─ Click "Create Pitch" → Show PitchVideoRecorder
  ├─ Click Like → Update pitch.likes
  ├─ Click Share → Update pitch.shares
  ├─ Click "Smart Contract" → Show SmartContractGenerator
  └─ Select Tab → Update activeTab
  ↓
Re-render on state changes
```

### PitchVideoRecorder.jsx
```
Mount
  ↓
Initialize form state
  ↓
User starts recording/uploads video
  ↓
Real-time form validation
  ↓
User clicks "Launch Your Pitch"
  ↓
Validate all fields
  ↓
Create pitch object
  ↓
Call onPitchCreated callback
  ↓
Close recorder (parent component)
```

### SmartContractGenerator.jsx
```
Mount (when selectedForContract is set)
  ↓
Initialize signatories from members
  ↓
Step 1: MOU
  - Display MOU text
  - Allow add/remove members
  - Validate before proceeding
  ↓
Step 2: Review
  - Show pitch details
  - Show financial terms
  - Confirm 60% rule
  ↓
Step 3: Sign
  - For each member:
    - Canvas for drawing signature
    - Auto-capture timestamp
    - Generate QR code
  - Show progress bar
  ↓
Step 4: Finalize
  - Success confirmation
  - Download/Share options
  ↓
Unmount (when closed)
```

## Key Algorithms

### 60% Signing Rule
```javascript
const requiredSignatures = Math.ceil(members.length * 0.6);

// Examples:
// 3 members → ceil(3 * 0.6) = ceil(1.8) = 2 signatures needed
// 5 members → ceil(5 * 0.6) = ceil(3.0) = 3 signatures needed
// 10 members → ceil(10 * 0.6) = ceil(6.0) = 6 signatures needed
```

### MOU Generation
```javascript
// Template-based generation
const mou = `
MEMORANDUM OF UNDERSTANDING

DATE: ${new Date().toLocaleDateString()}

BETWEEN:
${members.map(m => `- ${m}`).join('\n')}

REGARDING:
${generateMOUContent(pitch)}

TERMS & CONDITIONS:
1. Pitch Details: ${pitch.title}
2. Creator: ${pitch.creator}
3. Target: ${pitch.goal}
4. Equity: ${pitch.equity}
5. Type: ${pitch.pitchType}
6. IP Status: ${pitch.hasIP ? 'Included' : 'Not included'}
7. Signing: Minimum ${requiredSignatures}/${members.length} signatures required

SIGNATURES:
${generateSignatureBlocks(members)}
`
```

### QR Code Generation
```javascript
// Metadata-based QR
const qrData = {
  member: memberName,
  pitch: pitch.title,
  timestamp: new Date().toISOString(),
  location: location || 'Digital',
  verified: true,
  signatureHash: hash(signature)
};

const qrCode = `QR:${memberName}-${timestamp}-VERIFIED`;
```

## Performance Optimizations

### Current
- No optimization needed for demo
- Component memoization not required with <100 pitches

### Future
```javascript
// Memoize pitch cards for large lists
const PitchCard = React.memo(({ pitch }) => {...});

// Virtualize long lists
import { FixedSizeList } from 'react-window';

// Lazy load video thumbnails
<img loading="lazy" src={thumbUrl} />

// Code split components
const Pitchin = lazy(() => import('./Pitchin'));
const SmartContractGenerator = lazy(() => import('./SmartContractGenerator'));
```

## Browser APIs Used

| API | Purpose | Support |
|-----|---------|---------|
| `MediaRecorder` | Video recording | Chrome, Firefox, Edge |
| `getUserMedia` | Camera/mic access | Chrome, Firefox, Safari |
| `Canvas` | Signature drawing | All modern browsers |
| `Blob` | Video file handling | All modern browsers |
| `URL.createObjectURL` | Video preview | All modern browsers |
| `localStorage` | Demo data storage | All browsers |
| `toLocaleString()` | Timestamp formatting | All browsers |

## Database Schema (Future)

```sql
-- Pitches table
CREATE TABLE pitches (
  id UUID PRIMARY KEY,
  creator_id UUID REFERENCES users(id),
  title VARCHAR(200),
  description TEXT,
  category VARCHAR(50),
  video_url VARCHAR(2048),
  likes_count INTEGER,
  comments_count INTEGER,
  shares_count INTEGER,
  raised_amount BIGINT,
  goal_amount BIGINT,
  equity_percent DECIMAL,
  pitch_type VARCHAR(50),
  has_ip BOOLEAN,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);

-- Team members table
CREATE TABLE pitch_team_members (
  id UUID PRIMARY KEY,
  pitch_id UUID REFERENCES pitches(id),
  member_name VARCHAR(100),
  member_email VARCHAR(100),
  role VARCHAR(50),
  created_at TIMESTAMP
);

-- Smart contracts table
CREATE TABLE smart_contracts (
  id UUID PRIMARY KEY,
  pitch_id UUID REFERENCES pitches(id),
  contract_type VARCHAR(50),
  contract_terms TEXT,
  status VARCHAR(50),
  created_at TIMESTAMP,
  executed_at TIMESTAMP
);

-- Digital signatures table
CREATE TABLE digital_signatures (
  id UUID PRIMARY KEY,
  contract_id UUID REFERENCES smart_contracts(id),
  signer_name VARCHAR(100),
  signature_data TEXT,
  signature_timestamp TIMESTAMP,
  signature_location VARCHAR(200),
  qr_code VARCHAR(500),
  verified BOOLEAN,
  created_at TIMESTAMP
);
```

## API Endpoints (Future)

```
POST /api/pitches
  Create new pitch

GET /api/pitches
  Get all pitches with filtering

GET /api/pitches/:id
  Get single pitch details

PUT /api/pitches/:id
  Update pitch

DELETE /api/pitches/:id
  Delete pitch

POST /api/pitches/:id/like
  Like a pitch

POST /api/contracts
  Create smart contract

GET /api/contracts/:id
  Get contract details

POST /api/contracts/:id/sign
  Add digital signature

GET /api/contracts/:id/verify
  Verify signatures

POST /api/documents/:id/download
  Download MOU as PDF
```

## Error Handling Strategy

```javascript
// Video recording errors
try {
  const stream = await navigator.mediaDevices.getUserMedia({...});
} catch (error) {
  if (error.name === 'NotAllowedError') {
    // Permission denied
  } else if (error.name === 'NotFoundError') {
    // No device found
  }
}

// Form validation errors
if (!formData.title.trim()) {
  setError('Title is required');
}

// Contract execution errors
try {
  handleSignDocument(memberName);
} catch (error) {
  alert('Error signing document: ' + error.message);
}
```

## Security Best Practices

1. **Input Validation**
   - All form inputs validated
   - Video file size limits
   - String length limits

2. **XSS Prevention**
   - No dangerouslySetInnerHTML
   - React auto-escapes content
   - DOMPurify for user content (future)

3. **File Handling**
   - Validate file types
   - Check file sizes
   - Scan for malware (future)

4. **Signature Verification**
   - Timestamp verification
   - Location tracking
   - QR code validation
   - Blockchain integration (future)

## Testing Strategy

```javascript
// Unit tests (jest + react-testing-library)
describe('Pitchin', () => {
  test('renders pitch feed', () => {...});
  test('creates new pitch', () => {...});
  test('generates smart contract', () => {...});
});

// E2E tests (cypress)
describe('Complete pitch flow', () => {
  test('user can create pitch and generate contract', () => {...});
});

// Manual testing
// 1. Record video pitch
// 2. Create pitch with all details
// 3. View pitch in feed
// 4. Generate contract for pitch
// 5. Sign with multiple members
// 6. Download document
```

## Deployment Checklist

- [ ] All components tested
- [ ] No console errors
- [ ] Video recording tested in target browsers
- [ ] Canvas signatures work on touch devices
- [ ] Responsive design verified
- [ ] Performance profiled
- [ ] Production build tested
- [ ] Environment variables set
- [ ] Database migrations run
- [ ] API endpoints deployed
- [ ] Security headers configured
- [ ] Error monitoring enabled
