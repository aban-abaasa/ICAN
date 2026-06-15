#!/usr/bin/env node
/**
 * 🔍 ICAN Pitches Storage Diagnostics
 * ==================================
 * 
 * Checks what's ACTUALLY happening with video uploads
 * 
 * Usage:
 *   node diagnose_pitch_storage.js
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../../frontend/.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

console.log('🔍 ICAN PITCHES STORAGE DIAGNOSTICS\n');

// Check 1: Environment
console.log('1️⃣  ENVIRONMENT CHECK');
console.log('   Supabase URL:', supabaseUrl ? '✅' : '❌');
console.log('   Anon Key:', anonKey ? '✅' : '❌');
console.log('   Service Key:', serviceKey ? '✅' : '❌\n');

if (!supabaseUrl || !anonKey) {
  console.error('❌ Missing environment variables. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env\n');
  process.exit(1);
}

// Check 2: Bucket exists
console.log('2️⃣  BUCKET CHECK');
const sb = createClient(supabaseUrl, anonKey);

try {
  // List all buckets
  const { data: buckets, error } = await sb.storage.listBuckets();
  
  if (error) {
    console.error('   ❌ Cannot list buckets:', error.message);
    console.error('   This likely means Supabase auth is not working\n');
  } else {
    console.log('   Buckets found:', buckets.length);
    const pitchesBucket = buckets.find(b => b.name === 'pitches');
    
    if (pitchesBucket) {
      console.log('   ✅ "pitches" bucket EXISTS');
      console.log('      ID:', pitchesBucket.id);
      console.log('      Public:', pitchesBucket.public);
      console.log('      Created:', pitchesBucket.created_at);
    } else {
      console.log('   ❌ "pitches" bucket NOT FOUND');
      console.log('   Available buckets:');
      buckets.forEach(b => console.log(`      - ${b.name}`));
      console.log('   ⚠️  CREATE the bucket manually in Supabase Dashboard\n');
    }
  }
} catch (err) {
  console.error('   ❌ Error:', err.message);
}

// Check 3: Test upload permissions
console.log('\n3️⃣  UPLOAD PERMISSIONS CHECK');
console.log('   Attempting test upload...');

try {
  // Try uploading a test file
  const testFile = new Blob(['test'], { type: 'text/plain' });
  const testName = `test/${Date.now()}_test.txt`;
  
  const { data, error } = await sb.storage
    .from('pitches')
    .upload(testName, testFile, { upsert: true });
  
  if (error) {
    console.error('   ❌ Upload failed:', error.message);
    
    // Analyze error
    if (error.message.includes('row violates row-level security policy')) {
      console.error('   🔐 RLS POLICY ERROR - Policies not configured correctly');
      console.error('   Fix: Run the SQL from fix_pitches_storage_policies.sql');
    } else if (error.message.includes('Bucket not found')) {
      console.error('   🪣 BUCKET NOT FOUND - Need to create it');
    } else if (error.message.includes('JWT expired') || error.message.includes('Unauthorized')) {
      console.error('   🔑 AUTHENTICATION ERROR - Token invalid');
    } else if (error.message.includes('403') || error.message.includes('Forbidden')) {
      console.error('   🚫 PERMISSION DENIED - Check RLS policies');
    }
  } else {
    console.log('   ✅ Test upload successful!');
    console.log('      Path:', data.path);
    
    // Try to delete test file
    await sb.storage.from('pitches').remove([testName]);
    console.log('   ✅ Test file cleaned up');
  }
} catch (err) {
  console.error('   ❌ Unexpected error:', err.message);
}

// Check 4: Policies (if service key available)
console.log('\n4️⃣  RLS POLICIES CHECK');
if (!serviceKey) {
  console.log('   ⓘ  Service key not set - cannot check policies');
  console.log('   Set SUPABASE_SERVICE_ROLE_KEY in .env to verify\n');
} else {
  console.log('   Service key available - checking policies...');
  try {
    const sbAdmin = createClient(supabaseUrl, serviceKey);
    
    // Query policies
    const { data: policies, error } = await sbAdmin.rpc('get_policies_for_table', {
      schema_name: 'storage',
      table_name: 'objects'
    }).catch(() => ({ data: null, error: { message: 'RPC not available' } }));
    
    if (error) {
      console.log('   ⓘ  Could not query policies (expected - manual check recommended)');
      console.log('   To verify policies:');
      console.log('      1. Go to Supabase Dashboard');
      console.log('      2. Storage → pitches → Policies tab');
      console.log('      3. Should see 4 policies listed\n');
    } else if (policies) {
      const pitchPolicies = policies.filter(p => p.tablename === 'objects');
      console.log('   Found', pitchPolicies.length, 'policies');
      pitchPolicies.forEach(p => {
        console.log('      ✅', p.policyname);
      });
    }
  } catch (err) {
    console.log('   ⓘ  Could not check policies:', err.message);
  }
}

// Summary
console.log('\n📋 SUMMARY & NEXT STEPS\n');
console.log('If you see ❌ errors above:');
console.log('');
console.log('1. ❌ Missing "pitches" bucket?');
console.log('   → Create in Supabase Dashboard: Storage → Create Bucket');
console.log('');
console.log('2. ❌ Upload permissions failed?');
console.log('   → Check if RLS is enabled on pitches bucket');
console.log('   → Run: fix_pitches_storage_policies.sql in SQL Editor');
console.log('');
console.log('3. ❌ RLS Policy Error?');
console.log('   → Policies not applied. Run SQL again');
console.log('   → Or check file: ICAN/backend/db/fix_pitches_storage_policies.sql');
console.log('');
console.log('4. ❌ Authentication Error?');
console.log('   → Check VITE_SUPABASE_ANON_KEY is correct');
console.log('   → Try logging out and back in');
console.log('');
console.log('All checks passed? 🎉');
console.log('   → Try recording a video in the app');
console.log('   → Check browser console (F12) for upload messages');
console.log('   → Videos should now upload successfully!');
