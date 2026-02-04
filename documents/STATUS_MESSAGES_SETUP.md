# Status Messages Setup Guide

## Overview
The send message functionality is now fully implemented in the status viewer. Users can send direct messages to status authors.

## What's New

### Frontend Components
1. **statusMessagesService.js** - New service for handling status messages
   - `sendStatusMessage()` - Send a message to a status
   - `getStatusMessages()` - Retrieve all messages for a status
   - `deleteStatusMessage()` - Delete a message
   - `subscribeToStatusMessages()` - Real-time message subscription

2. **FullscreenStatusViewer.jsx** - Updated with message functionality
   - Message input field with Send button
   - `handleSendMessage()` - Processes message submissions
   - Success feedback animation when message sent
   - Disabled state when not authenticated

### Database Schema
New table created: `ican_status_messages`

Fields:
- `id` (UUID) - Primary key
- `status_id` (UUID) - Reference to status
- `sender_id` (UUID) - Reference to sender user
- `message_text` (TEXT) - Message content
- `created_at` - Timestamp
- `updated_at` - Auto-updated timestamp

## Setup Instructions

### Step 1: Run Database Migration
1. Go to [Supabase Dashboard](https://supabase.com)
2. Navigate to your project
3. Go to **SQL Editor** → **New Query**
4. Copy and paste the contents of: `ICAN/db/schemas/08_status_messages_table.sql`
5. Click **Run**

This will:
- Create the `ican_status_messages` table
- Set up indexes for performance
- Enable RLS (Row Level Security)
- Set up policies for read/write/delete

### Step 2: Test the Feature
1. Open your app in browser
2. Click "View Stories" to open status feed
3. Click on a status to open fullscreen viewer
4. Type a message in the "Send a message..." field
5. Click the send button (arrow icon)
6. You should see a "✓ Message sent" confirmation

## How It Works

### Sending a Message
1. User types message in input field
2. Clicks send button or presses Enter
3. Message is validated (non-empty, signed in)
4. Message sent to database via `sendStatusMessage()`
5. Success feedback shown to user
6. Input field clears

### Security
- RLS policies enforce:
  - Anyone can read messages
  - Only authenticated users can send
  - Users can only delete their own messages
  - Automatic timestamps

### Future Enhancements
- [ ] Display messages in modal/panel
- [ ] Real-time message updates (Supabase Realtime)
- [ ] Message notifications
- [ ] Profile info in messages
- [ ] Message editing
- [ ] Threaded conversations

## Files Modified

### New Files
- `ICAN/frontend/src/services/statusMessagesService.js`
- `ICAN/db/schemas/08_status_messages_table.sql`

### Updated Files
- `ICAN/frontend/src/components/status/FullscreenStatusViewer.jsx`
  - Added message state (messageText, sendingMessage)
  - Added useAuth hook
  - Added Send icon import
  - Added handleSendMessage function
  - Updated message input JSX to be functional

## API Reference

### sendStatusMessage(statusId, senderId, messageText)
Sends a message to a status.

**Parameters:**
- `statusId` (string) - UUID of the status
- `senderId` (string) - UUID of the sender
- `messageText` (string) - Message content

**Returns:**
```javascript
{ 
  message: { id, status_id, sender_id, message_text, created_at },
  error: null 
}
```

### getStatusMessages(statusId)
Retrieves all messages for a status.

**Parameters:**
- `statusId` (string) - UUID of the status

**Returns:**
```javascript
{ 
  messages: [ /* array of message objects */ ],
  error: null 
}
```

### subscribeToStatusMessages(statusId, callback)
Subscribes to real-time message updates.

**Parameters:**
- `statusId` (string) - UUID of the status
- `callback` (function) - Called with new message data

**Returns:**
Unsubscribe function

## Troubleshooting

### "Message cannot be empty" error
- Ensure message text is not blank/whitespace only

### Messages not saving
- Check that user is authenticated
- Verify Supabase database migration was run
- Check browser console for detailed error

### RLS Policy errors
- Re-run the SQL migration
- Verify all policies were created successfully

## Next Steps

1. **Run the SQL migration** (see Step 1 above)
2. **Test sending a message** in the UI
3. **Consider adding** a messages panel to display received messages
4. **Enable real-time** updates using Supabase Realtime subscriptions
