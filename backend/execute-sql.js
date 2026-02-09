#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

require('dotenv').config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Error: Missing Supabase credentials in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const sqlFilePath = path.join(__dirname, 'COMPLETE_INVESTMENT_SETUP.sql');
const sqlContent = fs.readFileSync(sqlFilePath, 'utf-8');

// Split into individual statements, handling comments
const statements = sqlContent
  .split('\n')
  .filter(line => {
    const trimmed = line.trim();
    return trimmed && !trimmed.startsWith('--');
  })
  .join('\n')
  .split(';')
  .map(stmt => stmt.trim())
  .filter(stmt => stmt.length > 0);

console.log(`\n📄 Loaded ${statements.length} SQL statements\n`);

async function executeSQL() {
  let succeeded = 0;
  let failed = 0;

  for (let i = 0; i < statements.length; i++) {
    const statement = statements[i] + ';';
    const preview = statement.substring(0, 80).replace(/\n/g, ' ') + '...';
    
    process.stdout.write(`[${i + 1}/${statements.length}] ${preview} `);

    try {
      const { data, error } = await supabase.rpc('exec_sql', {
        query: statement
      }).catch(async () => {
        // Fallback: Try using the query directly
        return await supabase.from('_raw_sql').insert({ sql: statement }).catch(err => ({
          data: null,
          error: err
        }));
      });

      if (error) {
        console.log(`❌ FAILED`);
        console.error(`   Error: ${error.message}\n`);
        failed++;
      } else {
        console.log(`✅`);
        succeeded++;
      }
    } catch (err) {
      console.log(`❌ FAILED`);
      console.error(`   Error: ${err.message}\n`);
      failed++;
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`✅ Succeeded: ${succeeded}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📝 Total: ${statements.length}`);
  console.log(`${'='.repeat(60)}\n`);

  if (failed > 0) {
    console.log('⚠️  Some statements failed. Check errors above.\n');
    process.exit(1);
  } else {
    console.log('🎉 All SQL statements executed successfully!\n');
    process.exit(0);
  }
}

console.log(`🚀 Executing COMPLETE_INVESTMENT_SETUP.sql...\n`);
executeSQL();
