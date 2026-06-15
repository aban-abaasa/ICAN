# Business Documents Table Setup Guide

## Issue
The `business_documents` table doesn't exist in your Supabase database, causing 404 errors when trying to fetch pitch documents.

## Solution
Run the SQL migration to create the table.

### Steps to Create the Table:

1. **Go to Supabase Dashboard**
   - Navigate to: https://app.supabase.com
   - Select your project

2. **Open SQL Editor**
   - Click on "SQL Editor" in the left sidebar
   - Click "New Query"

3. **Copy and Paste the SQL**
   - Open the file: `CREATE_BUSINESS_DOCUMENTS_TABLE.sql`
   - Copy ALL the SQL code
   - Paste it into the Supabase SQL Editor

4. **Run the Query**
   - Click the "Run" button (or press Ctrl+Enter)
   - Wait for the query to complete successfully

5. **Verify**
   - Go to "Table Editor" in Supabase
   - You should now see a new table called `business_documents`
   - The table should have columns for:
     - business_plan_content
     - financial_projection_content
     - value_proposition_wants/fears/needs
     - mou_content
     - share_allocation_shares/share_price/total_amount
     - disclosure_notes
     - And more...

## What This Creates

### Main Table: `business_documents`
- Links to `business_profiles` (one document per profile)
- Stores all submitted pitch documents
- Includes completion status flags
- Has Row Level Security (RLS) policies
- Creators can CRUD their own documents
- Investors can VIEW documents for published pitches

### Policies Added:
1. **Creators** can view/edit their own business documents
2. **Investors** can view documents for published pitches only
3. **Anonymous users** can view published pitch documents

### Automatic Features:
- `created_at` timestamp (when first created)
- `updated_at` timestamp (auto-updates on changes)
- `all_documents_completed` flag (tracks if all required fields filled)
- `completed_at` timestamp (when all documents finished)

## After Setup

### Errors Should Stop:
- ❌ 404 errors gone
- ❌ "relation does not exist" errors gone
- ✅ Documents properly fetched and displayed
- ✅ Investors can see exact submitted content

### System Now Works:
1. Creators fill out pitch documents → Saved to `business_documents`
2. Creators publish pitches (checked for complete documents)
3. Investors click Invest ⚡ → See exact documents submitted
4. Investors review documents before investing

## SQL File Location
`c:\Users\MACROS\Desktop\LOVE\ICAN\CREATE_BUSINESS_DOCUMENTS_TABLE.sql`

## Need Help?
If you get errors when running the SQL:
1. Check that you're in the correct Supabase project
2. Make sure `business_profiles` and `pitches` tables exist first
3. Verify you have admin/owner role in Supabase
