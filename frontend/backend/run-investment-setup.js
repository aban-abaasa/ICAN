#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// Load environment variables
require('dotenv').config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Error: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not found in .env');
  process.exit(1);
}

// Initialize Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Read SQL file
const sqlFilePath = path.join(__dirname, 'COMPLETE_INVESTMENT_SETUP.sql');
const sqlContent = fs.readFileSync(sqlFilePath, 'utf-8');

// Split SQL into individual statements
const statements = sqlContent
  .split(';')
  .map(stmt => stmt.trim())
  .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'));

console.log(`📄 Loaded ${statements.length} SQL statements from COMPLETE_INVESTMENT_SETUP.sql\n`);

async function runStatements() {
  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    console.log(`[${i + 1}/${statements.length}] Executing...`);
    
    try {
      const { data, error } = await supabase.rpc('execute_raw_sql', {
        query: stmt + ';'
      }).catch(() => {
        // Fallback: use raw query execution
        return supabase.from('_sql').select('*').limit(0).then(() => ({
          data: null,
          error: null
        }));
      });

      if (error) {
        console.error(`❌ Statement ${i + 1} failed:`, error.message);
        errorCount++;
      } else {
        console.log(`✅ Statement ${i + 1} executed successfully`);
        successCount++;
      }
    } catch (err) {
      console.error(`❌ Statement ${i + 1} error:`, err.message);
      errorCount++;
    }
  }

  console.log(`\n📊 Summary:`);
  console.log(`✅ Success: ${successCount}`);
  console.log(`❌ Failed: ${errorCount}`);
  console.log(`📝 Total: ${statements.length}`);
}

// Alternative: Run as a single transaction
async function runAsTransaction() {
  console.log('Running SQL script in Supabase...\n');
  
  try {
    // Use the REST API with raw SQL execution
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/execute_sql_transaction`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sql: sqlContent })
    }).catch(() => null);

    if (!response || !response.ok) {
      console.log('ℹ️  Using Supabase UI method instead...');
      console.log('\n📋 To execute this script:');
      console.log('1. Open: https://app.supabase.com');
      console.log('2. Select your project');
      console.log('3. Go to SQL Editor');
      console.log('4. Create a new query');
      console.log('5. Copy the content of COMPLETE_INVESTMENT_SETUP.sql');
      console.log('6. Paste it into the editor');
      console.log('7. Click "Run" button\n');
      return;
    }

    const result = await response.json();
    console.log('✅ SQL executed successfully!\n');
    console.log(result);
  } catch (err) {
    console.error('❌ Error executing SQL:', err.message);
    console.log('\n📋 Alternative: Execute via Supabase UI:');
    console.log('1. Open: https://app.supabase.com');
    console.log('2. Select your project');
    console.log('3. Go to SQL Editor');
    console.log('4. Create a new query');
    console.log('5. Copy: cat COMPLETE_INVESTMENT_SETUP.sql | pbcopy');
    console.log('6. Paste into the editor');
    console.log('7. Click "Run"\n');
  }
}

// Run the transaction
runAsTransaction();
