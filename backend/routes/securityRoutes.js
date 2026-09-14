const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { decoyRouteTrap, honeytokenReportHandler } = require('../middleware/canweShield');

const router = express.Router();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
    : null;

if (!supabase) {
  console.warn('[canwe] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing — security routes will no-op');
}

const noopTrap = (req, res) => res.status(200).json({ success: true, data: [] });

// Client reports a filled honeytoken field from any auth form (SignIn/SignUp).
router.post('/report', supabase ? honeytokenReportHandler(supabase) : noopTrap);

// Decoy admin/debug endpoints live at app root (e.g. /admin/backup_wallet.json,
// /api/v1/debug/keys), not nested under /api/security — see server.js, which
// mounts `trap` directly on those exact paths so they match robots.txt and
// the hidden sr-only links byte-for-byte. Any hit here is, by construction,
// a scanner or a bot that ignored robots.txt on purpose.
const trap = supabase ? decoyRouteTrap(supabase) : noopTrap;

module.exports = { router, trap };
