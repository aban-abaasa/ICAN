# Pitchin Setup & Implementation Guide

## Quick Start

### 1. Access Pitchin
- Open ICAN Capital Engine
- Click "Share" in the navigation menu
- Select the "Pitchin" tab (marked as "Hot" - first tab)

### 2. Create Your First Pitch
```
Click "Create Pitch" → Record/Upload Video → Fill Details → Launch
```

### 3. Generate Smart Contract
```
View Pitch → Click "Smart Contract" → Follow 4-step wizard → Execute
```

## File Locations

```
ICAN/frontend/src/components/
├── Pitchin.jsx                    (Main feed - 280 lines)
├── PitchVideoRecorder.jsx         (Recording interface - 380 lines)
├── SmartContractGenerator.jsx     (Contract & signing - 420 lines)
├── SHAREHub.jsx                   (Updated with Pitchin tab)
└── PITCHIN_README.md              (Feature documentation)
```

## Key Features Implementation

### 🎬 Video Recording
```javascript
// Start recording
const stream = await navigator.mediaDevices.getUserMedia({
  video: { width: { ideal: 1920 }, height: { ideal: 1080 } },
  audio: true
});
const mediaRecorder = new MediaRecorder(stream);
mediaRecorder.start();

// Stop and create blob
mediaRecorder.stop();
const blob = new Blob(chunks, { type: 'video/webm' });
const url = URL.createObjectURL(blob);
```

### 📝 Smart MOU Generation
```javascript
// MOU includes:
const mou = `
MEMORANDUM OF UNDERSTANDING

Parties:
${members.map(m => `- ${m}`).join('\n')}

Pitch: ${pitch.title}
Target: ${pitch.goal}
Equity: ${pitch.equity}
Type: ${pitch.pitchType}

Signing Requirements:
- Minimum 60% of team (${requiredSignatures}/${members.length})
- Digital signatures legally binding
- QR codes verify authenticity
`;
```

### 🖊️ Digital Signatures
```javascript
// Canvas signature capture
canvas.addEventListener('mousemove', (e) => {
  const ctx = canvas.getContext('2d');
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#a78bfa';
  ctx.lineTo(e.offsetX, e.offsetY);
  ctx.stroke();
});

// Store signature with metadata
const signature = {
  member: 'John Doe',
  timestamp: new Date().toLocaleString(),
  location: 'Digital Signature',
  signature: canvas.toDataURL(),
  verified: true
};
```

### 🔐 QR Code Generation
```javascript
// Generate QR from signature
const qrData = {
  member: memberName,
  pitch: pitch.title,
  timestamp: timestamp,
  location: location,
  verified: true
};

const qrCode = `QR:${memberName}-${timestamp}-VERIFIED`;
// Can be displayed as text or converted to actual QR code
```

## Pitch Flow Diagram

```
User Opens SHARE
    ↓
Click "Pitchin" Tab
    ↓
Browse Pitch Feed
    ↓
┌─ Create Pitch ─┐     ┌─ View Pitch ─┐     ┌─ My Pitches ─┐
│                │     │              │     │              │
├─ Record Video ─┤     ├─ Like/Share ─┤     ├─ Edit Pitch ─┤
├─ Upload Video ─┤     │              │     │              │
├─ Add Details  ─┤     └─ Smart       ─┘     └─ Track       ─┘
├─ Add Team    ─┤         Contract           Stats
└─ Launch      ─┘           ↓
                    ┌─ Create MOU ─┐
                    │              │
                    ├─ Add Members ─┤
                    │              │
                    ├─ Sign        ─┤
                    │ (60% rule)    │
                    │              │
                    ├─ Generate QR ─┤
                    │              │
                    └─ Download    ─┘
```

## Component Props

### Pitchin.jsx
```javascript
// No required props
<Pitchin />

// Internal state manages everything
```

### PitchVideoRecorder.jsx
```javascript
// Required prop
<PitchVideoRecorder 
  onPitchCreated={(pitchData) => {
    // Handle newly created pitch
    setPitches([pitchData, ...pitches]);
  }}
/>

// Returns pitch object with:
{
  videoUrl: blob URL,
  title: string,
  creator: string,
  description: string,
  category: string,
  goal: string,
  equity: string,
  hasIP: boolean,
  members: string[],
  // ... more fields
}
```

### SmartContractGenerator.jsx
```javascript
// Required props
<SmartContractGenerator 
  pitch={pitchObject}
  onClose={() => setSelectedForContract(null)}
/>

// Pitch object needs:
{
  id: number,
  title: string,
  creator: string,
  goal: string,
  equity: string,
  pitchType: string,
  hasIP: boolean,
  members: string[]
}
```

## Advanced Features

### 1. Pitch Categories
- Technology
- Healthcare
- Finance
- Agriculture
- Education
- Sustainability

### 2. Pitch Types
- Equity: Offering company shares
- Partnership: Seeking strategic partners
- Debt: Looking for loans
- Grant: Applying for grants/awards

### 3. Team Management
- Add multiple team members
- Each member shown as avatar
- 60% must sign for group contracts
- Can be individual or group account

### 4. Smart Signature Requirements

**60% Rule Implementation:**
```javascript
const requiredSignatures = Math.ceil(members.length * 0.6);

// Progress tracking
if (signedCount >= requiredSignatures) {
  // Contract is valid, can proceed to finalize
}
```

## Data Persistence (Future)

Currently using local state. Future enhancement with:
- Database storage (Supabase/Firebase)
- File uploads to cloud storage (AWS S3)
- Video transcoding
- Real QR code generation library
- PDF document generation

## Testing Checklist

- [ ] Video recording works in browser
- [ ] Video upload accepts MP4/WebM
- [ ] Pitch form validates all fields
- [ ] Team member addition/removal works
- [ ] Smart contract 4-step wizard completes
- [ ] Digital signature drawing captures
- [ ] QR code text generates correctly
- [ ] 60% signing rule enforces correctly
- [ ] Document download works
- [ ] Responsive design on mobile

## Performance Notes

- Video files can be large (~100MB for 3-minute HD)
- Consider adding video compression
- Canvas drawing is GPU-accelerated
- Use React.memo for list items if >50 pitches

## Security Considerations

- Digital signatures are client-side only (future: blockchain)
- QR codes contain only metadata (no sensitive data)
- MOU is text-based (not cryptographically signed yet)
- Implement backend verification for production

## Browser Compatibility

- Chrome/Edge: ✅ Full support
- Firefox: ✅ Full support
- Safari: ⚠️ Check MediaRecorder support
- Mobile: ⚠️ Test video recording permission handling

## Common Issues & Solutions

### Video Recording Fails
- Check browser permissions
- Ensure camera/microphone accessible
- Try different video codec

### Large Video Files
- Implement video compression
- Set max duration (3 minutes)
- Consider WebP or H.264 codec

### Signature Not Drawing
- Check canvas element exists
- Verify mouse event binding
- Test on different browsers

### QR Code Not Displaying
- Ensure QR code library added
- Verify string format correct
- Check container size

## Next Steps

1. **Test Complete Flow**
   - Create pitch → Get interest → Generate contract → Sign

2. **Add Missing Features**
   - Real database integration
   - Video storage/CDN
   - Email notifications
   - User profiles

3. **Enhance UI**
   - Add loading states
   - Error handling
   - Success notifications
   - Progress bars

4. **Legal & Compliance**
   - Terms of service
   - Contract review process
   - Dispute resolution
   - AML/KYC integration

## Support Resources

- See `PITCHIN_README.md` for feature details
- Check component JSX comments
- Review Tailwind classes for styling
- Test with demo data first

## Contact & Feedback

For improvements or bug reports:
1. Document the issue
2. Provide reproduction steps
3. Screenshot or video
4. Expected vs actual behavior
