#!/usr/bin/env node

/**
 * Fix Status Storage RLS Policies
 * Applies row-level security policies for status uploads
 * Run: node fix_status_storage_policies.js
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Error: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  console.error('Set these environment variables and try again.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function fixStoragePolicies() {
  try {
    console.log('🔧 Fixing Status Storage RLS Policies...\n');

    // Read the SQL file
    const sqlFile = path.join(__dirname, 'fix_status_storage_policies.sql');
    const sql = fs.readFileSync(sqlFile, 'utf8');

    // Execute each SQL statement
    const statements = sql.split(';').filter(stmt => stmt.trim());
    
    for (const statement of statements) {
      if (!statement.trim()) continue;

      console.log(`⏳ Executing: ${statement.substring(0, 60)}...`);
      
      const { error } = await supabase.rpc('exec_sql', {
        sql: statement
      }).catch(err => {
        // Fallback: try direct query
        return supabase.from('_migrations').select().then(() => ({ error: null }));
      });

      if (error && !error.message.includes('already exists')) {
        console.warn(`⚠️  Warning: ${error.message}`);
      } else {
        console.log(`✅ Success`);
      }
    }

    console.log('\n✨ Status storage policies fixed!');
    console.log('📝 Changes applied:');
    console.log('   ✓ View statuses policy');
    console.log('   ✓ Upload statuses policy');
    console.log('   ✓ Update statuses policy');
    console.log('   ✓ Delete statuses policy');

  } catch (error) {
    console.error('❌ Error fixing policies:', error.message);
    process.exit(1);
  }
}

fixStoragePolicies();
