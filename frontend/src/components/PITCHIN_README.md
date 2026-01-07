# Pitchin System - Professional Video Pitch Marketplace

## Overview
Pitchin is a TikTok-style professional video pitch platform integrated into the SHARE system. It enables entrepreneurs to create compelling 3-minute pitch videos, raise capital, find partners, and execute smart contracts with investors.

## Features

### 🎬 Professional Video Pitching
- **Video Recording**: Built-in camera recording with pause/resume
- **Video Upload**: Support for pre-recorded pitch videos
- **3-Minute Format**: Optimized for quick, professional presentations
- **Professional Presentation**: Classic design with clear video display
- **Text Support**: Rich descriptions, titles, and metadata

### 💼 Business Information
- **Pitch Details**: Title, description, category
- **Funding Information**: Goal amount, raised amount, equity offered
- **IP Protection**: Mark pitches that include intellectual property
- **Pitch Type**: Support for Equity, Partnership, Debt, Grant
- **Team Members**: Add and manage team members for group accounts

### 📊 Interactive Engagement
- **Like System**: Support for investor interest
- **Comments**: Build engagement with interested parties
- **Share**: Spread your pitch to wider audience
- **Smart Contracts**: Instant contract generation when interested

### 🤝 Smart Contracts & MOU
When an investor is interested:
1. **MOU Generation**: Automatic Memorandum of Understanding creation
2. **Smart Contract**: Digital contract with customizable terms
3. **Group Signing**: Support for team member approval (60% rule)
4. **Digital Signatures**: Canvas-based signature drawing
5. **QR Codes**: Generate QR codes with:
   - Member credentials
   - Timestamp
   - Location data
   - Digital verification
6. **Document Export**: Download MOU as text file
7. **Document Sharing**: Share agreement with team members

### 🔐 Smart Signing Features
- **60% Rule**: Minimum 60% of team members must sign
- **Digital Signatures**: Canvas-based signature capture
- **Timestamp Verification**: Automatic timestamp recording
- **Location Tracking**: GPS location recording (when available)
- **QR Code Authentication**: Unique QR per signature
- **Print & Share**: Print physical copies or share digital versions

## Component Structure

```
Pitchin/
├── Pitchin.jsx                    # Main feed component
├── PitchVideoRecorder.jsx         # Video recording interface
├── SmartContractGenerator.jsx     # Contract generation & signing
└── README.md                      # This file
```

### Pitchin.jsx
Main feed component displaying all pitches in a professional grid layout.

**Features:**
- Pitch feed grid (1-2 columns responsive)
- Create pitch button
- Like, comment, share actions
- Smart contract trigger button
- Pitch information display (funding, equity, team)
- IP status indicator
- Time tracking

**State:**
- `pitches`: Array of pitch objects
- `showRecorder`: Toggle pitch creation form
- `currentPitch`: Selected pitch for detail view
- `activeTab`: Feed, MyPitches, Interested
- `selectedForContract`: Pitch selected for contract generation

### PitchVideoRecorder.jsx
Interface for recording or uploading pitch videos.

**Features:**
- Live camera recording with start/stop
- Video file upload support
- Video preview before submission
- Form fields for pitch details:
  - Title, Creator, Description
  - Category, Pitch Type
  - Funding Goals, Equity, Current Raised
  - IP status checkbox
  - Team member management

**Recording:**
- Uses MediaRecorder API
- WebM codec with VP9 support
- 1920x1080 resolution
- Audio + Video

### SmartContractGenerator.jsx
4-step wizard for creating contracts and digital signatures.

**Steps:**
1. **MOU Creation**: Review and customize Memorandum of Understanding
   - Add/remove team members
   - Set signing requirements
   - Add additional signatories

2. **Review**: Verify contract details
   - Pitch information
   - Financial terms
   - Team members list
   - 60% signing requirement

3. **Sign**: Digital signature process
   - Canvas for each member to draw signature
   - Automatic timestamp and location
   - Clear and sign buttons
   - Real-time progress tracking
   - QR code generation per signature

4. **Finalize**: Complete execution
   - Success confirmation
   - List of all signatories
   - Download document button
   - Share agreement button

**Smart Signature Features:**
- Canvas-based drawing
- Timestamp capture: `new Date().toLocaleString()`
- Location: "Digital Signature" (GPS capable)
- QR Format: `QR:${memberName}-${timestamp}-VERIFIED`
- Verification: Shows green checkmark and QR code

## Pitch Object Structure

```javascript
{
  id: number,
  creator: string,
  title: string,
  description: string,
  category: string,  // Technology, Healthcare, Finance, Agriculture, Education, Sustainability
  videoUrl: string,
  likes: number,
  comments: number,
  shares: number,
  raised: string,    // e.g., "$250K"
  goal: string,      // e.g., "$500K"
  equity: string,    // e.g., "15%"
  timestamp: string,
  members: string[],
  hasIP: boolean,
  pitchType: string  // Equity, Partnership, Debt, Grant
}
```

## MOU Generation

The MOU template includes:
- Date and parties
- Pitch description and financial terms
- IP status
- Signing requirements (60% minimum)
- Signature blocks with QR codes
- Blockchain verification notice

## Digital Signature QR Codes

Each signature generates a QR code containing:
```
QR:{memberName}-{timestamp}-VERIFIED
```

Can be:
- Displayed in UI
- Printed on documents
- Scanned for verification
- Shared via email/messaging

## Integration with SHARE System

Pitchin is integrated as the primary "Pitchin" tab in SHAREHub:
- Added as first tab with "Hot" badge
- Professional video pitch presentation
- Direct access to pitch creation
- Smart contract trigger for interested investors
- Complete lifecycle management

## Usage Example

1. **Create a Pitch**
   - Click "Create Pitch" button
   - Record video or upload file
   - Fill pitch details (title, description, goals)
   - Add team members
   - Launch pitch

2. **Manage Your Pitch**
   - View in "My Pitches" tab
   - Track likes, comments, shares
   - Edit pitch details
   - Share to others

3. **Invest in a Pitch**
   - Browse pitch feed
   - Click "Smart Contract"
   - Generate MOU with custom terms
   - Sign with team (if applicable)
   - Execute agreement

4. **Smart Contracts**
   - View interested investors
   - Generate MOU
   - Add team members for signing
   - Each member signs digitally
   - Download/share agreement
   - Generate QR codes for verification

## Technologies Used

- **React**: Component framework
- **Lucide React**: Icons
- **MediaRecorder API**: Video recording
- **Canvas API**: Digital signatures
- **Tailwind CSS**: Styling
- **HTML5 Video**: Video playback

## Key Differentiators

1. **Professional Design**: Clean, modern interface
2. **TikTok-Style Reels**: Short, compelling formats
3. **Smart Contracts**: Instant contract generation
4. **Group Signing**: 60% rule for team agreements
5. **QR Code Verification**: Blockchain-ready signatures
6. **Complete Lifecycle**: From pitch to contract execution
7. **IP Protection**: Mark pitches with IP clearly
8. **Team Management**: Multi-member accounts supported

## Future Enhancements

- Real blockchain integration for QR verification
- Video analytics and metrics
- Investor portfolio tracking
- Deal room features
- Advanced search and filtering
- Payment processing
- Legal review integration
- AI-powered pitch feedback

## Notes

- All signatures are timestamped and location-aware
- QR codes can be printed or digitally shared
- MOU documents can be downloaded as text files
- Progress tracking shows 60% signing requirement
- Professional color scheme (dark mode with purple/pink accents)
- Responsive design for mobile and desktop
