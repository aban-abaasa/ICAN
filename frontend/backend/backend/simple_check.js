#!/usr/bin/env node
/**
 * 🎬 Simple Pitch Storage Checker (No Dependencies)
 * ===============================================
 * 
 * Just checks configuration without needing npm packages
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('\n🔍 ICAN PITCH STORAGE CHECK\n');

// Check 1: Environment file exists
console.log('1️⃣  ENVIRONMENT CHECK');
const envPath = path.join(__dirname, '../frontend/.env');
const envExists = fs.existsSync(envPath);

if (envExists) {
  console.log('   ✅ .env file found');
  const envContent = fs.readFileSync(envPath, 'utf8');
  
  // Check for required keys
  const hasUrl = envContent.includes('VITE_SUPABASE_URL');
  const hasKey = envContent.includes('VITE_SUPABASE_ANON_KEY');
  
  console.log(`   ✅ VITE_SUPABASE_URL: ${hasUrl ? 'FOUND' : 'MISSING'}`);
  console.log(`   ✅ VITE_SUPABASE_ANON_KEY: ${hasKey ? 'FOUND' : 'MISSING'}`);
  
  if (hasUrl && hasKey) {
    // Extract values
    const urlMatch = envContent.match(/VITE_SUPABASE_URL=(.*)/);
    const keyMatch = envContent.match(/VITE_SUPABASE_ANON_KEY=(.*)/);
    
    if (urlMatch) console.log(`   URL: ${urlMatch[1].substring(0, 30)}...`);
    if (keyMatch) console.log(`   Key: ${keyMatch[1].substring(0, 20)}...`);
  }
} else {
  console.log('   ❌ .env file NOT FOUND');
  console.log('   → Create ICAN/frontend/.env with Supabase credentials');
}

// Check 2: SQL file
console.log('\n2️⃣  SQL POLICIES CHECK');
const sqlPath = path.join(__dirname, '../db/fix_pitches_storage_policies.sql');
const sqlExists = fs.existsSync(sqlPath);

if (sqlExists) {
  console.log('   ✅ fix_pitches_storage_policies.sql found');
  const sqlContent = fs.readFileSync(sqlPath, 'utf8');
  
  const hasDrops = sqlContent.includes('DROP POLICY');
  const hasPolicies = sqlContent.match(/CREATE POLICY/g) || [];
  
  console.log(`   ✅ DROP statements: ${hasDrops ? 'YES' : 'NO'}`);
  console.log(`   ✅ CREATE statements: ${hasPolicies.length} found`);
  
  if (hasPolicies.length >= 4) {
    console.log('   ✅ All 4 policies defined');
  } else {
    console.log(`   ⚠️  Only ${hasPolicies.length} policies found (need 4)`);
  }
} else {
  console.log('   ❌ SQL file NOT FOUND');
}

// Check 3: Upload service
console.log('\n3️⃣  UPLOAD SERVICE CHECK');
const servicePath = path.join(__dirname, '../frontend/src/services/pitchingService.js');
const serviceExists = fs.existsSync(servicePath);

if (serviceExists) {
  console.log('   ✅ pitchingService.js found');
  const serviceContent = fs.readFileSync(servicePath, 'utf8');
  
  const hasRetry = serviceContent.includes('for (let attempt');
  const hasErrorHandling = serviceContent.includes('🔐 RLS POLICY ERROR');
  const hasFallback = serviceContent.includes('Falling back to local blob');
  
  console.log(`   ✅ Retry logic: ${hasRetry ? 'YES' : 'NO'}`);
  console.log(`   ✅ Error handling: ${hasErrorHandling ? 'YES' : 'NO'}`);
  console.log(`   ✅ Fallback: ${hasFallback ? 'YES' : 'NO'}`);
} else {
  console.log('   ❌ pitchingService.js NOT FOUND');
}

// Check 4: Documentation
console.log('\n4️⃣  DOCUMENTATION CHECK');
const docs = [
  'FIX_NOW.md',
  'PITCH_VIDEO_COMPLETE_FIX.md',
  'WHAT_I_FIXED.md'
];

const docsPath = path.join(__dirname, '..');
docs.forEach(doc => {
  const exists = fs.existsSync(path.join(docsPath, doc));
  console.log(`   ${exists ? '✅' : '❌'} ${doc}`);
});

// Summary
console.log('\n📋 NEXT STEPS:\n');
console.log('1. Make sure .env has Supabase credentials');
console.log('2. Read: ICAN/FIX_NOW.md (5 minute quick fix)');
console.log('3. Create "pitches" bucket in Supabase Dashboard');
console.log('4. Copy & run the SQL from fix_pitches_storage_policies.sql');
console.log('5. Test by recording a video in the app');
console.log('\n');
