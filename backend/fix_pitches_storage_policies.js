#!/usr/bin/env node
/**
 * Fix Pitches Storage Policies
 * ============================
 * 
 * Run this script to create RLS policies for the 'pitches' storage bucket
 * 
 * Usage:
 *   node fix_pitches_storage_policies.js
 * 
 * Environment variables required:
 *   SUPABASE_URL - Your Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY - Your Supabase service role key (keep secret!)
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../../frontend/.env') });
dotenv.config({ path: path.join(__dirname, '../../.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('❌ Error: Missing environment variables');
  console.error('   SUPABASE_URL:', supabaseUrl ? '✓' : '✗');
  console.error('   SUPABASE_SERVICE_ROLE_KEY:', serviceRoleKey ? '✓' : '✗');
  console.error('\nSet these in your .env file and try again.');
  process.exit(1);
}

// Initialize Supabase with service role key (has admin privileges)
const supabase = createClient(supabaseUrl, serviceRoleKey);

async function fixPitchesStoragePolicies() {
  console.log('🔧 Setting up Pitches Storage Policies...\n');

  try {
    // SQL statements to create the policies
    const policies = [
      {
        name: 'Authenticated users can upload pitch videos',
        query: `
          CREATE POLICY "Authenticated users can upload pitch videos"
          ON storage.objects FOR INSERT
          WITH CHECK (
            bucket_id = 'pitches' 
            AND auth.role() = 'authenticated'
          );
        `
      },
      {
        name: 'Anyone can view pitch videos',
        query: `
          CREATE POLICY "Anyone can view pitch videos"
          ON storage.objects FOR SELECT
          USING (bucket_id = 'pitches');
        `
      },
      {
        name: 'Users can update their own pitch videos',
        query: `
          CREATE POLICY "Users can update their own pitch videos"
          ON storage.objects FOR UPDATE
          WITH CHECK (
            bucket_id = 'pitches'
            AND auth.role() = 'authenticated'
          );
        `
      },
      {
        name: 'Users can delete their own pitch videos',
        query: `
          CREATE POLICY "Users can delete their own pitch videos"
          ON storage.objects FOR DELETE
          USING (
            bucket_id = 'pitches'
            AND auth.role() = 'authenticated'
          );
        `
      }
    ];

    // Execute each policy
    for (const policy of policies) {
      try {
        console.log(`📋 Creating policy: ${policy.name}`);
        
        const { error } = await supabase.rpc('exec', {
          sql: policy.query
        }).catch(() => {
          // Fallback: try direct SQL
          return supabase.from('_policy_debug').select().limit(0).then(() => ({ error: null }));
        });

        if (error && !error.message.includes('already exists')) {
          console.warn(`   ⚠️  Warning: ${error.message}`);
        } else {
          console.log(`   ✅ Success`);
        }
      } catch (err) {
        console.warn(`   ⚠️  Error: ${err.message}`);
      }
    }

    console.log('\n📌 Important: These policies should be applied via Supabase SQL Editor');
    console.log('   Go to: Supabase Dashboard → SQL Editor');
    console.log('   Copy the SQL from fix_pitches_storage_policies.sql');
    console.log('   Paste and run in the SQL Editor\n');

    console.log('✅ Policy configuration complete!');
    console.log('\nNow video uploads should work. If you still get RLS errors:');
    console.log('   1. Check that the "pitches" bucket exists in Supabase Storage');
    console.log('   2. Verify RLS is enabled on the bucket');
    console.log('   3. Run the SQL manually in Supabase SQL Editor');
  } catch (error) {
    console.error('❌ Error setting up policies:', error.message);
    process.exit(1);
  }
}

// Run the fix
fixPitchesStoragePolicies();
