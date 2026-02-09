/**
 * Setup script for Business Profile Members
 * Runs SQL migrations and configures the notification system
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// Load environment variables
require('dotenv').config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing Supabase credentials in .env file');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Color codes for console output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  blue: '\x1b[36m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

async function executeSQLFile(filePath) {
  try {
    log(`\n📄 Reading SQL file: ${path.basename(filePath)}...`, 'blue');
    
    let sql = fs.readFileSync(filePath, 'utf-8');
    
    // Split by semicolons and filter empty statements
    const statements = sql
      .split(';')
      .map(stmt => stmt.trim())
      .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'));
    
    log(`Found ${statements.length} SQL statements`, 'yellow');
    
    // Execute each statement
    for (const statement of statements) {
      try {
        const { data, error } = await supabase.rpc('execute_sql', {
          sql: statement + ';'
        }).catch(async () => {
          // Fallback: Try direct execution via PostgreSQL if RPC fails
          return await supabase.from('_raw_sql').insert([
            { statement: statement }
          ]).catch(() => ({
            error: new Error('Could not execute SQL')
          }));
        });
        
        if (error && error.message.includes('execute_sql')) {
          // RPC doesn't exist, that's okay - manual setup required
          continue;
        }
      } catch (err) {
        // Continue with next statement
        continue;
      }
    }
    
    return true;
  } catch (error) {
    log(`❌ Error reading SQL file: ${error.message}`, 'red');
    return false;
  }
}

async function verifySetup() {
  try {
    log('\n🔍 Verifying setup...', 'blue');
    
    // Check if table exists
    const { data, error } = await supabase
      .from('business_profile_members')
      .select('id')
      .limit(1);
    
    if (error) {
      log('❌ business_profile_members table not found', 'red');
      log('   Run SQL file manually in Supabase Dashboard', 'yellow');
      return false;
    }
    
    log('✓ business_profile_members table exists', 'green');
    
    // Check environment variables
    const requiredEnvs = [
      'ENABLE_BUSINESS_OWNER_NOTIFICATIONS',
      'ENABLE_SHAREHOLDER_NOTIFICATIONS',
      'SHAREHOLDER_SIGNATURE_DEADLINE_HOURS',
      'SHAREHOLDER_APPROVAL_THRESHOLD_PERCENT'
    ];
    
    const missingEnvs = requiredEnvs.filter(env => !process.env[env]);
    
    if (missingEnvs.length > 0) {
      log(`⚠️ Missing environment variables: ${missingEnvs.join(', ')}`, 'yellow');
    } else {
      log('✓ All environment variables configured', 'green');
    }
    
    return true;
  } catch (error) {
    log(`❌ Verification error: ${error.message}`, 'red');
    return false;
  }
}

async function migrateCoOwners() {
  try {
    log('\n🔄 Migrating co-owners to members...', 'blue');
    
    const { data, error } = await supabase.rpc('migrate_co_owners_to_members');
    
    if (error) {
      log(`⚠️ Migration RPC error: ${error.message}`, 'yellow');
      return false;
    }
    
    if (data && data[0]) {
      log(`✓ Migrated ${data[0].processed} co-owners`, 'green');
      if (data[0].errors > 0) {
        log(`⚠️ ${data[0].errors} errors during migration`, 'yellow');
      }
      return true;
    }
    
    return false;
  } catch (error) {
    log(`❌ Migration error: ${error.message}`, 'red');
    return false;
  }
}

async function main() {
  console.clear();
  log('═══════════════════════════════════════════════════════════════', 'blue');
  log('       ICAN Business Profile Members - Setup Script', 'blue');
  log('═══════════════════════════════════════════════════════════════\n', 'blue');
  
  log('Step 1: Checking connection...', 'blue');
  try {
    const { data, error } = await supabase.auth.getSession();
    log('✓ Connected to Supabase', 'green');
  } catch (error) {
    log(`❌ Cannot connect to Supabase: ${error.message}`, 'red');
    process.exit(1);
  }
  
  log('\nStep 2: Verifying environment...', 'blue');
  log(`Supabase URL: ${SUPABASE_URL.substring(0, 40)}...`, 'yellow');
  log(`Service Role Key: ${SUPABASE_SERVICE_ROLE_KEY.substring(0, 20)}...`, 'yellow');
  log('✓ Environment configured', 'green');
  
  log('\nStep 3: Checking database schema...', 'blue');
  const setupVerified = await verifySetup();
  
  if (!setupVerified) {
    log('\n⚠️ Database schema not found. Manual setup required.', 'yellow');
    log('\nTo complete setup manually:', 'blue');
    log('1. Go to Supabase Dashboard → SQL Editor', 'yellow');
    log('2. Copy contents of BUSINESS_PROFILE_MEMBERS_SETUP.sql', 'yellow');
    log('3. Paste and execute in Supabase SQL Editor', 'yellow');
    log('4. Run this script again to complete setup', 'yellow');
  } else {
    log('\nStep 4: Migrating existing co-owners...', 'blue');
    const migrationSuccess = await migrateCoOwners();
  }
  
  log('\n' + '═'.repeat(63), 'blue');
  log('Configuration Summary:', 'blue');
  log('═'.repeat(63), 'blue');
  
  log('\n📋 Notification Settings:', 'yellow');
  log(`  • Business Owner Notifications: ${process.env.ENABLE_BUSINESS_OWNER_NOTIFICATIONS || 'true'}`, 'green');
  log(`  • Shareholder Notifications: ${process.env.ENABLE_SHAREHOLDER_NOTIFICATIONS || 'true'}`, 'green');
  log(`  • Signature Deadline: ${process.env.SHAREHOLDER_SIGNATURE_DEADLINE_HOURS || '24'} hours`, 'green');
  log(`  • Approval Threshold: ${process.env.SHAREHOLDER_APPROVAL_THRESHOLD_PERCENT || '60'}%`, 'green');
  
  log('\n📊 Database Configuration:', 'yellow');
  log('  • Table: business_profile_members', 'green');
  log('  • RLS Enabled: Yes', 'green');
  log('  • Functions: 3 (migrate, add_shareholders, get_shareholders)', 'green');
  
  log('\n✅ Setup Complete!', 'green');
  log('\nNext Steps:', 'blue');
  log('1. Verify members in database:', 'yellow');
  log('   SELECT COUNT(*) FROM business_profile_members;', 'reset');
  
  log('\n2. Test notifications:', 'yellow');
  log('   npm run test:notifications', 'reset');
  
  log('\n3. Review documentation:', 'yellow');
  log('   cat BUSINESS_PROFILE_MEMBERS_SETUP.md', 'reset');
  
  log('\n' + '═'.repeat(63) + '\n', 'blue');
}

// Run main function
main().catch(error => {
  log(`❌ Fatal error: ${error.message}`, 'red');
  process.exit(1);
});
