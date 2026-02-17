# Smart Contract System - Technical API Documentation

## Component: SmartContractGenerator

### Props
```javascript
interface SmartContractGeneratorProps {
  pitch: {
    id: number;
    creator: string;
    title: string;
    description: string;
    goal: string;                    // e.g., "$500K"
    equity: string;                  // e.g., "15%"
    pitchType: string;               // e.g., "Equity", "Partnership"
    hasIP: boolean;
    members: string[];               // Initial team members
  };
  onClose: () => void;              // Callback when modal closes
}
```

### State Management

#### Share Purchase
```javascript
sharePurchase: {
  shares: string | number;          // Number of shares to buy
  buyerName: string;                // Name of purchaser
  totalAmount: string | number;     // Total investment amount
}

setSharePurchase(data: object)       // Update purchase details
```

#### Authentication
```javascript
authMethod: 'pin' | 'fingerprint'   // Selected auth method
pinInput: string;                   // PIN password input
pinConfirm: string;                 // PIN confirmation
showPin: boolean;                   // Show/hide PIN input
currentSigningMember: string;        // Member being authenticated

setAuthMethod(method: string)        // Change auth method
setPinInput(pin: string)             // Set PIN
setPinConfirm(pin: string)           // Confirm PIN
setShowPin(show: boolean)            // Toggle PIN visibility
setCurrentSigningMember(member: string)
```

#### Signatures
```javascript
signedMembers: {
  [memberName: string]: {
    member: string;
    method: 'pin' | 'fingerprint';
    timestamp: string;               // ISO format with locale
    location: {
      latitude: number;
      longitude: number;
      timestamp: string;
    };
    pitch: string;
    verified: boolean;
    shares: number | string;
  }
}

setSignedMembers(members: object)
```

#### Notifications
```javascript
notifications: Array<{
  id: number;                        // Unique ID
  from: string;                      // Who signed
  message: string;                   // What happened
  timestamp: string;                 // When it happened
  read: boolean;                     // Read status
}>

setNotifications(notifs: array)
```

#### Location
```javascript
location: {
  latitude: number;                  // GPS latitude
  longitude: number;                 // GPS longitude
  timestamp: string;                 // When captured
} | null

setLocation(loc: object)
```

## Key Functions

### Authentication

#### `verifyPIN(pin: string): boolean`
```javascript
// Verifies PIN matches confirmation
// Requirements:
// - pin.length >= 4
// - pin === pinConfirm
// Returns: true if valid, false otherwise

verifyPIN(pinInput)  // true or false
```

#### `authenticateAndSign(memberName: string): void`
```javascript
// Main authentication and signing function
// Steps:
// 1. Verify auth credentials (PIN/Fingerprint)
// 2. Get current timestamp
// 3. Get user location (if available)
// 4. Create signature data object
// 5. Update signedMembers state
// 6. Send notification to others
// 7. Generate QR code data
// 8. Clear auth inputs

authenticateAndSign('John')
```

#### `simulateFingerprint(): void`
```javascript
// Simulates fingerprint authentication
// In production: Would use WebAuthn/TouchID APIs
// Current: Calls authenticateAndSign directly

simulateFingerprint()
```

### Document Generation

#### `generateMOU(): string`
```javascript
// Generates complete Memorandum of Understanding
// Includes:
// - Header with generation timestamp
// - Location coordinates logged
// - All team members listed
// - Pitch details and terms
// - Share purchase agreement (if applicable)
// - Terms and conditions (8 items)
// - Signature requirements
// - Location and timestamp for each signer
// - Blockchain verification notes

const mou = generateMOU()
// Returns formatted text string
```

#### `generateQRCode(memberName: string): string`
```javascript
// Generates QR code reference string
// Format: "QR:{memberName}-{timestamp}-VERIFIED"
// Falls back to: "QR:{memberName}-PENDING" if not signed

const qrCode = generateQRCode('John')
// Returns: "QR:John-1/2/2026, 3:30:45 PM-VERIFIED"
```

#### `downloadDocument(): void`
```javascript
// Downloads generated MOU as text file
// Filename: "MOU-{PitchTitle}.txt"
// Creates temporary download link
// Auto-removes link after download

downloadDocument()
// Downloads file automatically
```

## Location Services

### Geolocation API Integration
```javascript
// Browser Geolocation API (automatic on mount)
navigator.geolocation.getCurrentPosition(
  (position) => {
    // Success: Store latitude, longitude
    location: {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      timestamp: new Date().toLocaleString()
    }
  },
  () => {
    // Error: Set as unavailable
    location: {
      latitude: null,
      longitude: null,
      timestamp: new Date().toLocaleString()
    }
  }
)
```

### Permission Handling
```javascript
// Browser asks user for location permission
// User can choose:
// ✓ Allow - GPS coordinates captured
// ✗ Deny - Coordinates shown as null
// Will be requested once per session
```

## State Flow

### Step 1: Purchase
```
Input → sharePurchase state
↓
Stores: shares, buyerName, totalAmount
↓
Next Step: MOU
```

### Step 2: MOU
```
Members management → members state
↓
Add/Remove members
↓
Next Step: Review
```

### Step 3: Review
```
Display all details
↓
Calculate: requiredSignatures = 60% of members
↓
Next Step: Authenticate
```

### Step 4: Authenticate
```
Select member → currentSigningMember
↓
Choose auth method → authMethod
↓
Enter credentials → pinInput, pinConfirm
↓
Authenticate → verifyPIN()
↓
Update signedMembers → signatureData
↓
Generate QR → notifications
↓
Repeat for each member
```

### Step 5: Final
```
Display all signedMembers
↓
Show location, timestamp, QR for each
↓
Download MOU document
↓
Share agreement option
```

## Integration Examples

### Using in Pitchin Component
```jsx
import SmartContractGenerator from './SmartContractGenerator';

function Pitchin() {
  const [selectedForContract, setSelectedForContract] = useState(null);

  return (
    <>
      {selectedForContract && (
        <SmartContractGenerator 
          pitch={selectedForContract}
          onClose={() => setSelectedForContract(null)}
        />
      )}
    </>
  );
}
```

### Calling from Pitch Card
```jsx
<button 
  onClick={() => setSelectedForContract(pitch)}
  className="bg-purple-600 text-white px-4 py-2 rounded"
>
  Create Smart Contract
</button>
```

### Passing Pitch Data
```javascript
const pitch = {
  id: 1,
  creator: 'Sarah Tech Solutions',
  title: 'AI-Powered Supply Chain',
  goal: '$500K',
  equity: '15%',
  pitchType: 'Equity',
  hasIP: true,
  members: ['Sarah', 'John', 'Mike']
}
```

## Events & Callbacks

### onClose
```javascript
// Called when user clicks X or Done
// Parent component should hide SmartContractGenerator
onClose()
```

## Data Structures

### Signature Data Object
```javascript
{
  member: string,           // Member name
  method: 'pin' | 'fingerprint',
  timestamp: string,        // ISO or locale string
  location: {
    latitude: number | null,
    longitude: number | null,
    timestamp: string
  },
  pitch: string,            // Pitch title
  verified: boolean,        // Always true if signed
  shares: number | string   // If investor
}
```

### Notification Object
```javascript
{
  id: number,               // Unique timestamp-based ID
  from: string,            // Member who signed
  message: string,         // "{name} has signed..."
  timestamp: string,       // When they signed
  read: boolean           // Notification read status
}
```

## Constants

### Step Names
```javascript
'purchase'    // Share purchase input
'mou'         // MOU display and team management
'review'      // Contract details review
'authenticate' // PIN/Fingerprint authentication
'final'       // Completion and download
```

### Authentication Methods
```javascript
'pin'         // PIN code authentication
'fingerprint' // Biometric authentication
```

### Signature Threshold
```javascript
requiredSignatures = Math.ceil(members.length * 0.6)
// 60% of team members must sign
```

## Error Handling

### PIN Verification Failure
```javascript
if (!verifyPIN(pinInput)) {
  alert('PIN verification failed. Please try again.');
  return;  // Stop authentication
}
```

### Missing Location
```javascript
// Location will be null if denied
// Code handles gracefully:
location.latitude ? `${latitude}, ${longitude}` : 'N/A'
```

### Undefined Signature Data
```javascript
const data = signatureData[memberName];
if (!data || !data.timestamp) {
  return `QR:${memberName}-PENDING`;
}
```

## Performance Considerations

### Re-renders
- Each state update triggers component re-render
- useEffect dependencies: members, location (geolocation only)
- Optimize with React.memo for large member lists

### Memory
- Store signatures in state (grows with members)
- Notifications array can grow large (implement cleanup)
- QR codes generated on-demand

### Browser APIs
- Geolocation: Async, can timeout
- Canvas: Memory intensive for large signatures
- Local Storage: Not used (data stays in memory)

## Security Notes

### PIN
- Never logged or console printed
- Cleared after use
- Not transmitted until authenticated
- Should be hashed before storage

### Location
- Only captured with permission
- User can deny
- Deleted after session ends
- Consider privacy regulations

### Signatures
- QR codes are references, not credentials
- No private keys stored
- Authentication is local only
- Should integrate with blockchain for production

## Browser Compatibility

### Geolocation API
- Chrome: ✓ Full support
- Firefox: ✓ Full support
- Safari: ✓ Full support
- IE11: ✗ No support

### Canvas API
- All modern browsers: ✓ Full support
- Used for signature drawing

### Arrow Functions
- Requires ES6+ support
- All modern browsers

## Future Enhancement Points

1. **Real QR Code Generation**: Use qrcode.react
2. **Blockchain Integration**: Connect to smart contracts
3. **Database Storage**: Save signatures to backend
4. **Email Integration**: Send notifications via email
5. **Digital Wallet**: Connect to crypto wallets
6. **Multi-signature**: Require specific member approvals
7. **Time Locks**: Signature validity periods
8. **Escrow**: Hold funds during approval
9. **Legal Templates**: Auto-generate different agreement types
10. **Analytics**: Track signature completion rates
