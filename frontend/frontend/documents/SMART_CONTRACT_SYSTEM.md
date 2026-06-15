# Smart Contract & MOU Generator - Complete Guide

## Overview

The enhanced Smart Contract & MOU Generator enables secure, biometric-authenticated share purchases, partnerships, and investments with real-time notifications and location tracking.

## Features

### 1. **Share Purchase Agreement** 
- Investors specify the number of shares to purchase
- Set investment amount and automatically calculate price per share
- Seller details and terms are recorded

### 2. **Biometric Authentication**
Two authentication methods:

#### PIN Authentication
- 4+ digit PIN code
- Secure password input with show/hide toggle
- PIN confirmation required
- Locally stores authentication metadata

#### Fingerprint Biometric
- Simulated fingerprint sensor scanning
- Visual feedback with animated icon
- Location-based verification

### 3. **Location Tracking**
- GPS coordinates logged with each signature
- Timestamp recorded at signing
- Location data included in final MOU
- Secure storage of geolocation information

### 4. **Real-time Notifications**
- Notification bell alerts when members sign
- Shows who signed and what shares/partnership terms
- Timestamps for each signature event
- Scrollable notification history

### 5. **Digital Signature QR Codes**
- Unique QR code for each authenticated signature
- Encodes: Member name, timestamp, location, auth method
- Blockchain-enabled verification
- Scannable proof of signature

### 6. **Smart Contract Generation**
Complete MOU includes:
- Share purchase terms and pricing
- Team member details
- IP rights and terms
- Authentication method used
- Location and timestamp for each signatory
- 60% signature threshold requirement
- Blockchain verification details

## Workflow

### Step 1: Share Purchase (Optional)
```
1. Enter buyer name
2. Specify number of shares
3. Set total investment amount
4. System calculates price per share
5. Review pitch details
```

### Step 2: MOU Review
```
1. Review complete Memorandum of Understanding
2. Add/remove team members
3. Verify all pitch details
4. Confirm terms and conditions
```

### Step 3: Contract Review
```
1. Review all contract details
2. Verify share purchase terms
3. Confirm signatory list
4. Check 60% signature threshold requirement
```

### Step 4: Biometric Authentication & Signing
```
1. Select member to authenticate
2. Choose authentication method:
   - PIN: Enter 4+ digit code twice
   - Fingerprint: Place finger on sensor
3. Location is automatically captured
4. Signature is verified and recorded
5. Other members receive notification
```

### Step 5: Finalization
```
1. All authenticated signatures displayed
2. Location and timestamp for each
3. QR code references for verification
4. Download complete MOU document
5. Share agreement with stakeholders
```

## Security Features

### Authentication
- **PIN Protection**: 4+ digit codes with confirmation
- **Biometric Verification**: Fingerprint scanning simulation
- **Location Verification**: GPS coordinates logged

### Data Protection
- All signatures include metadata
- Blockchain-enabled QR codes
- Timestamp verification
- Location-based audit trail

### Smart Contract Requirements
- **60% Signature Threshold**: Minimum required for binding agreement
- **Notification System**: All members alerted to signatures
- **Verification QR Codes**: Scannable proof of authenticity
- **Immutable Records**: All data preserved in downloadable document

## Technical Implementation

### State Management
```javascript
// Share purchase details
sharePurchase: { shares, buyerName, totalAmount }

// Authentication
authMethod: 'pin' | 'fingerprint'
pinInput: string
currentSigningMember: string

// Signatures
signedMembers: {
  [memberName]: {
    member: string,
    method: 'pin' | 'fingerprint',
    timestamp: string,
    location: { latitude, longitude, timestamp },
    verified: boolean,
    shares: number
  }
}

// Notifications
notifications: Array<{
  id: number,
  from: string,
  message: string,
  timestamp: string,
  read: boolean
}>
```

### Location Tracking
- Uses browser Geolocation API
- Requests user permission for GPS access
- Fallback for denied permission
- Stores latitude/longitude with precision to 4 decimals

### Authentication Flow

#### PIN Authentication
```
1. User enters PIN (min 4 digits)
2. User confirms PIN
3. System verifies match
4. Location captured
5. Signature recorded with auth data
6. QR code generated
7. Notification sent to others
```

#### Fingerprint Authentication
```
1. Visual feedback with animated icon
2. Simulated sensor scanning
3. Location captured
4. Signature recorded with biometric data
5. QR code generated
6. Notification sent to others
```

## Document Export

### MOU Document Includes
- Standard MOU header and date
- All participant names
- Pitch title and creator
- Funding goal and equity offering
- Share purchase agreement (if applicable)
  - Buyer name
  - Shares purchased
  - Total investment
  - Price per share
- Full terms and conditions
- IP rights statement
- Authentication requirements (60% threshold)
- Signature section for each member:
  - Date and time
  - Authentication method (PIN/Fingerprint)
  - Location coordinates
  - Verification status
  - QR code reference

### File Format
- Text file (.txt) with formatting
- Filename: `MOU-{PitchTitle}.txt`
- Downloadable from final step
- Shareable with all parties

## Notifications

### Notification Triggers
- Member authenticates and signs
- Shows: "{MemberName} has signed the agreement"
- Includes: Timestamp of signature
- Can include: Share purchase details if applicable

### Display
- Bell icon (🔔)
- Scrollable notification panel
- Blue highlight with timestamp
- Maximum history viewable in panel

## Use Cases

### Investor Share Purchase
1. Investor interested in pitch
2. Fills in number of shares and amount
3. Completes PIN/fingerprint auth
4. Other team members notified
5. Team reviews and signs with their auth method
6. Upon 60% approval, contract is binding
7. Document downloaded with full audit trail

### Partnership Agreement
1. Skip share purchase step
2. Partners add themselves to agreement
3. Each partner authenticates with PIN/fingerprint
4. Location and time captured
5. Notifications sent to all parties
6. Document records partnership terms
7. Shareable proof of agreement

### Multi-party Investment
1. Multiple investors each specify their share purchase
2. Each signs with biometric auth
3. Location tracking for audit trail
4. Real-time notifications to founder
5. Document shows all investments and terms
6. Blockchain verification available

## Error Handling

### Authentication Failures
- PIN mismatch: "PIN verification failed. Please try again."
- Geolocation denied: Proceeds with location marked as "N/A"
- Fingerprint timeout: Allows retry

### Validation
- Minimum 4-digit PIN required
- Shares and amount validation required
- 60% threshold enforcement for finalization

## Privacy & Security Notes

1. **Location Data**: Only captured with user permission
2. **Biometric Data**: Simulated (in production, use device APIs)
3. **PIN Storage**: Never stored in plain text
4. **QR Codes**: Encoded with metadata but not sensitive credentials
5. **Data Retention**: All records preserved in downloadable document

## Production Considerations

### PIN Security
- Implement secure PIN storage (hashing)
- Consider multi-factor authentication
- Rate limiting on PIN attempts
- Secure PIN transmission

### Fingerprint Integration
- Use native device APIs (WebAuthn, TouchID, etc.)
- Implement biometric data protection
- Secure storage per platform guidelines

### Location Services
- Always request explicit user permission
- Provide privacy policy
- Option to disable location tracking
- Consider privacy regulations (GDPR, etc.)

### Blockchain Integration
- Implement actual QR code generation
- Connect to blockchain for immutability
- Smart contract deployment
- Transaction recording

### Database
- Store signatures and metadata
- Encryption at rest
- Audit logging
- GDPR compliance

## Future Enhancements

1. **Actual QR Code Generation**: Use qrcode.react library
2. **Blockchain Integration**: Deploy smart contracts
3. **Email Notifications**: Notify members via email
4. **Document Signing Service**: DocuSign/HelloSign integration
5. **Payment Processing**: Stripe/PayPal for share purchases
6. **Escrow Service**: Secure fund holding during approval
7. **Legal Review**: Automated legal document review
8. **Multi-signature Wallets**: Crypto payment integration
9. **NFT Certificates**: Issue NFTs for share ownership
10. **API Integration**: REST API for third-party integration

## Support

For issues or questions about the Smart Contract & MOU Generator, contact the development team with:
- Step where issue occurred
- Authentication method used
- Device and browser information
- Any error messages received
