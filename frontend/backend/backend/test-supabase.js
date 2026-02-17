/**
 * 🧪 Supabase Connection Test
 * Verifies that backend can connect to Supabase and access MOMO config tables
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

console.log('\n📋 Environment Variables Check:');
console.log('================================');
console.log(`SUPABASE_URL: ${SUPABASE_URL ? '✅ SET' : '❌ MISSING'}`);
console.log(`SUPABASE_SERVICE_ROLE_KEY: ${SUPABASE_SERVICE_ROLE_KEY ? '✅ SET' : '❌ MISSING'}`);

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('\n❌ Missing required environment variables!');
  process.exit(1);
}

console.log('\n🔗 Initializing Supabase Client...');
console.log('===================================');

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

console.log('✅ Supabase client created\n');

// Test 1: Check if we can connect
async function testConnection() {
  console.log('📡 Test 1: Basic Connection');
  console.log('----------------------------');
  try {
    const { data, error } = await supabase.auth.admin.listUsers();
    if (error) {
      throw error;
    }
    console.log('✅ Successfully connected to Supabase');
    console.log(`   Found ${data.users.length} users\n`);
    return true;
  } catch (error) {
    console.error('❌ Connection failed:', error.message, '\n');
    return false;
  }
}

// Test 2: Check if mtn_momo_config table exists
async function testMomoConfigTable() {
  console.log('📡 Test 2: Check mtn_momo_config Table');
  console.log('----------------------------------------');
  try {
    const { data, error, status } = await supabase
      .from('mtn_momo_config')
      .select('*')
      .limit(1);

    if (error) {
      console.error('❌ Error:', error.message);
      if (error.code === 'PGRST116') {
        console.log('   → Table "mtn_momo_config" does not exist');
        console.log('   → Need to run setup_mtn_momo_configuration.sql\n');
      }
      return false;
    }

    console.log('✅ Table "mtn_momo_config" exists');
    console.log(`   Found ${data.length} configurations\n`);
    
    if (data.length > 0) {
      console.log('   First config:');
      console.log(`   - Name: ${data[0].name}`);
      console.log(`   - Environment: ${data[0].environment}`);
      console.log(`   - Active: ${data[0].is_active}`);
      console.log(`   - Primary: ${data[0].is_primary}\n`);
    }
    
    return true;
  } catch (error) {
    console.error('❌ Unexpected error:', error.message, '\n');
    return false;
  }
}

// Test 3: Check if mtn_momo_logs table exists
async function testMomoLogsTable() {
  console.log('📡 Test 3: Check mtn_momo_logs Table');
  console.log('--------------------------------------');
  try {
    const { data, error } = await supabase
      .from('mtn_momo_logs')
      .select('*')
      .limit(1);

    if (error) {
      console.error('❌ Error:', error.message);
      if (error.code === 'PGRST116') {
        console.log('   → Table "mtn_momo_logs" does not exist\n');
      }
      return false;
    }

    console.log('✅ Table "mtn_momo_logs" exists');
    console.log(`   Found ${data.length} log entries\n`);
    return true;
  } catch (error) {
    console.error('❌ Unexpected error:', error.message, '\n');
    return false;
  }
}

// Test 4: Check if mtn_momo_tokens table exists
async function testMomoTokensTable() {
  console.log('📡 Test 4: Check mtn_momo_tokens Table');
  console.log('----------------------------------------');
  try {
    const { data, error } = await supabase
      .from('mtn_momo_tokens')
      .select('*')
      .limit(1);

    if (error) {
      console.error('❌ Error:', error.message);
      if (error.code === 'PGRST116') {
        console.log('   → Table "mtn_momo_tokens" does not exist\n');
      }
      return false;
    }

    console.log('✅ Table "mtn_momo_tokens" exists');
    console.log(`   Found ${data.length} token entries\n`);
    return true;
  } catch (error) {
    console.error('❌ Unexpected error:', error.message, '\n');
    return false;
  }
}

// Run all tests
async function runTests() {
  console.log('\n🧪 RUNNING SUPABASE TESTS\n');
  console.log('═════════════════════════════════════════\n');

  const results = [];
  
  results.push(await testConnection());
  results.push(await testMomoConfigTable());
  results.push(await testMomoLogsTable());
  results.push(await testMomoTokensTable());

  // Summary
  console.log('📊 TEST SUMMARY');
  console.log('═════════════════════════════════════════');
  const passed = results.filter(r => r).length;
  const total = results.length;
  console.log(`Passed: ${passed}/${total}`);

  if (passed === total) {
    console.log('\n✅ All tests passed! Backend can connect to Supabase.\n');
    process.exit(0);
  } else {
    console.log('\n⚠️  Some tests failed. See above for details.\n');
    console.log('📝 Next steps:');
    console.log('1. Verify SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in backend/.env');
    console.log('2. Run setup_mtn_momo_configuration.sql in Supabase SQL editor');
    console.log('3. Check Row Level Security policies\n');
    process.exit(1);
  }
}

runTests().catch(error => {
  console.error('\n❌ Test runner error:', error);
  process.exit(1);
});
