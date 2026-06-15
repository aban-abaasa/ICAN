#!/usr/bin/env node
/**
 * 🎬 ICAN Pitch Storage - Quick Debug
 * ===================================
 * 
 * Usage:
 *   node debug_pitch_upload.js
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env from frontend .env file
dotenv.config({ path: path.join(__dirname, '../frontend/.env') });

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_ANON_KEY;

console.log('\n🔍 ICAN PITCH STORAGE DEBUG\n');
console.log('Environment:');
console.log('  VITE_SUPABASE_URL:', url ? '✅' : '❌');
console.log('  VITE_SUPABASE_ANON_KEY:', key ? '✅' : '❌\n');

if (!url || !key) {
  console.error('❌ Missing env variables. Check ICAN/frontend/.env\n');
  process.exit(1);
}

const sb = createClient(url, key);

(async () => {
  try {
    console.log('1️⃣  Checking buckets...');
    const { data: buckets, error } = await sb.storage.listBuckets();
    
    if (error) {
      console.log('   ❌ Cannot list buckets:', error.message);
      console.log('   → Supabase connection issue\n');
    } else {
      const pitches = buckets.find(b => b.name === 'pitches');
      if (pitches) {
        console.log('   ✅ Bucket "pitches" found');
        console.log(`      Public: ${pitches.public}`);
      } else {
        console.log('   ❌ Bucket "pitches" NOT FOUND');
        console.log('   → Must create in Supabase Dashboard\n');
      }
    }

    console.log('\n2️⃣  Testing upload...');
    const testBlob = new Blob(['test'], { type: 'text/plain' });
    const testName = `_test_${Date.now()}.txt`;
    
    const { data, error: uploadErr } = await sb.storage
      .from('pitches')
      .upload(testName, testBlob);
    
    if (uploadErr) {
      console.log('   ❌ Upload failed');
      console.log('   Error:', uploadErr.message);
      
      if (uploadErr.message.includes('row violates')) {
        console.log('\n   🔐 RLS POLICY ISSUE');
        console.log('   → Run: fix_pitches_storage_policies.sql in SQL Editor');
      } else if (uploadErr.message.includes('Bucket not found')) {
        console.log('\n   🪣 BUCKET MISSING');
        console.log('   → Create "pitches" bucket in Supabase Storage');
      } else if (uploadErr.message.includes('403')) {
        console.log('\n   🔑 PERMISSION ISSUE');
        console.log('   → Check RLS policies are applied');
      }
    } else {
      console.log('   ✅ Upload successful!');
      
      // Clean up test file
      await sb.storage.from('pitches').remove([testName]);
      console.log('   ✅ Test file cleaned\n');
    }

  } catch (err) {
    console.error('\n❌ Error:', err.message);
  }
  
  console.log('\n📝 Next Steps:');
  console.log('  1. Read: ICAN/PITCH_VIDEO_COMPLETE_FIX.md');
  console.log('  2. Create "pitches" bucket if needed');
  console.log('  3. Run the SQL policies from fix_pitches_storage_policies.sql');
  console.log('  4. Test by recording a video in the app\n');
})();
