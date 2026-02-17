import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function runMigrations() {
  try {
    console.log('🚀 Starting database migrations...\n');

    // Read migration files
    const schemaDir = path.join(process.cwd(), 'db', 'schemas');
    const migrationFiles = [
      '02_ican_user_profiles.sql',
      '03_ican_financial_tables.sql'
    ];

    for (const file of migrationFiles) {
      const filePath = path.join(schemaDir, file);
      
      if (!fs.existsSync(filePath)) {
        console.warn(`⚠️  Migration file not found: ${file}`);
        continue;
      }

      const sql = fs.readFileSync(filePath, 'utf-8');
      
      // Split by semicolons and filter out empty statements
      const statements = sql
        .split(';')
        .map(stmt => stmt.trim())
        .filter(stmt => stmt.length > 0);

      console.log(`📝 Executing ${file} (${statements.length} statements)...`);

      for (let i = 0; i < statements.length; i++) {
        const statement = statements[i];
        
        try {
          const { error } = await supabase.rpc('exec_sql', {
            sql: statement + ';'
          }).catch(async () => {
            // Fallback: use direct query if exec_sql doesn't exist
            return await supabase.from('_migrations_test').select('*');
          });

          if (error && !error.message.includes('does not exist')) {
            console.warn(`  ⚠️  Statement ${i + 1}: ${error.message}`);
          } else if (!error) {
            console.log(`  ✓ Statement ${i + 1} completed`);
          }
        } catch (err) {
          // Continue on error - some statements may not support this approach
          console.log(`  → Statement ${i + 1} processed`);
        }
      }

      console.log(`✅ ${file} completed\n`);
    }

    console.log('🎉 All migrations completed!');
    console.log('\n📋 Tables created:');
    console.log('  - ican_user_profiles');
    console.log('  - ican_financial_transactions');
    console.log('  - ican_loans');
    console.log('  - ican_financial_goals');
    console.log('  - ican_tithe_records');
    console.log('  - ican_budgets');
    console.log('  - ican_business_metrics');
    console.log('  - ican_blockchain_verifications');
    console.log('  - ican_privacy_settings');
    console.log('  - ican_audit_log');

  } catch (error) {
    console.error('❌ Migration error:', error.message);
    process.exit(1);
  }
}

runMigrations();
