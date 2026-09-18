/**
 * 🚀 ICAN Backend Express Server
 * Handles all API requests including MOMO payments, user management, etc.
 * 
 * ✅ Features:
 * - MOMO API proxy (routes frontend requests to MTN API)
 * - User authentication
 * - Payment processing
 * - Supabase integration
 */

// Load environment variables from backend/.env
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const express = require('express');
const cors = require('cors');
const momoRoutes = require('./routes/momoRoutes');
const p2pTransferRoutes = require('./routes/p2pTransferRoutes');
const paymentsRoutes = require('./routes/paymentsRoutes');
const withdrawalRoutes = require('./routes/withdrawalRoutes');
const accountRoutes = require('./routes/accountRoutes');
const aiAnalysisRoutes = require('./routes/aiAnalysisRoutes');
const taxRulesRoutes = require('./routes/taxRulesRoutes');
const storageRoutes = require('./routes/storageRoutes');
const { router: securityRoutes, trap: decoyTrap } = require('./routes/securityRoutes');
const { ipReputationGate } = require('./middleware/canweShield');
const cron = require('node-cron');
const { refreshGlobalInflation } = require('./services/inflationRefreshService');
const { refreshLiveFxRates } = require('./services/fxRateRefreshService');
const { processPendingPaydayAdvisories } = require('./services/cmmsPaydayAdvisoryService');

// ES6 module imports for email routes
// pinResetRoutes.js is intentionally NOT mounted — the dev-panel-reviewed
// flow (ICAN/backend/PIN_RECOVERY_AND_ACCOUNT_UNLOCK.sql, "Recovery" tab in
// ICANDevPanel.jsx) still goes only through that panel. There IS now a
// separate self-service path though: POST /api/email/request-pin-reset in
// emailRoutes.js emails a magic reset link (see
// backend/PIN_RESET_EMAIL_SELFSERVICE.sql), mirroring the sign-in page's
// Forgot Password. Offered as an alternative, not a replacement.
let emailRoutes;

// Load ES6 modules
(async () => {
  const emailModule = await import('./routes/emailRoutes.js');
  emailRoutes = emailModule.default;
})();

const app = express();
const PORT = process.env.PORT || 5000;

// Trust exactly one reverse-proxy hop (Vercel / nginx in front of this
// process) so req.ip resolves the real client IP from X-Forwarded-For
// instead of a value an attacker could spoof from further out.
app.set('trust proxy', 1);

// ==========================================
// Canwe Shield — mounted before everything else so a flagged IP is
// tarpitted/redirected before it reaches any real route, and before body
// parsing does any work on its request.
// ==========================================
const { createClient } = require('@supabase/supabase-js');
const canweSupabase =
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
    : null;

if (canweSupabase) {
  app.use(ipReputationGate(canweSupabase));
} else {
  console.warn('[canwe] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing — IP reputation gate disabled');
}

// ==========================================
// Middleware
// ==========================================

// Enable CORS for frontend requests
app.use(cors({
  origin: [
    'http://localhost:5173',    // Vite dev server default port
    'http://localhost:3001',    // Alternative dev port
    'http://localhost:3000',    // Alternative dev port
    'http://localhost:5000',    // Current server
    'http://127.0.0.1:5173',
    'http://127.0.0.1:3001',
    'http://127.0.0.1:3000'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  optionsSuccessStatus: 200
}));

// Parse JSON bodies
app.use(express.json());

// Parse URL-encoded bodies
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req, res, next) => {
  console.log(`📨 ${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// ==========================================
// Health Check Endpoint
// ==========================================

app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    message: 'ICAN Backend API is running'
  });
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    message: 'ICAN Backend API is running'
  });
});

// ==========================================
// API Routes (CommonJS)
// ==========================================

// MOMO Payment Routes
app.use('/api/momo', momoRoutes);

// P2P Transfer Routes (2-step workflow)
app.use('/api/p2p', p2pTransferRoutes);

// Payment Routes
app.use('/api/payments', paymentsRoutes);

// Withdrawal Routes
app.use('/api/withdrawals', withdrawalRoutes);

// Account Routes (danger zone account deletion)
app.use('/api/account', accountRoutes);

// AI Analysis Routes (OpenAI proxy for transaction analysis)
app.use('/api/ai-analysis', aiAnalysisRoutes);
app.use('/api/tax-rules', taxRulesRoutes);

// Storage Routes (Cloudflare R2 presigned URLs for video/image feeds)
app.use('/api/storage', storageRoutes);

// Honeytoken report intake + decoy admin/debug endpoints. Paths below must
// match frontend/public/robots.txt Disallow entries and the hidden sr-only
// links in LandingPage.jsx byte-for-byte — that mismatch is the whole trap.
app.use('/api/security', securityRoutes);
app.all('/admin/backup_wallet.json', decoyTrap);
app.all('/api/v1/debug/keys', decoyTrap);

// ==========================================
// API Routes (ES6 modules - loaded dynamically)
// ==========================================

// Async function to load ES6 modules and start server
async function loadRoutesAndStartServer() {
  try {
    const emailModule = await import('./routes/emailRoutes.js');
    const reportShareModule = await import('./routes/reportShareRoutes.js');

    // Email Routes (send PIN reset, unlock confirmations)
    app.use('/api/email', emailModule.default);

    // CMMS Report Share Routes (email the OTP for a "restricted to
    // specific emails" shared report link — see CMMS_REPORT_SHARING_SYSTEM.sql)
    app.use('/api/report-shares', reportShareModule.default);

    console.log('✅ ES6 module routes loaded successfully');
  } catch (error) {
    console.error('❌ Error loading ES6 module routes:', error);
    process.exit(1);
  }

  // ==========================================
  // Error Handling
  // ==========================================

  // 404 Handler
  app.use((req, res) => {
    console.error(`❌ 404 - ${req.method} ${req.path}`);
    res.status(404).json({
      success: false,
      error: 'Endpoint not found',
      path: req.path,
      method: req.method
    });
  });

  // Global Error Handler
  app.use((err, req, res, next) => {
    console.error('❌ Error:', err);
    res.status(err.status || 500).json({
      success: false,
      error: err.message || 'Internal server error',
      statusCode: err.status || 500
    });
  });

  // ==========================================
  // Start Server
  // ==========================================

  app.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════╗
║   🚀 ICAN Backend API Server Started    ║
╠══════════════════════════════════════════╣
║  🌐 Listening on: http://localhost:${PORT}  ║
║  ✅ MOMO Routes: /api/momo/*             ║
║  ✅ P2P Routes: /api/p2p/*               ║
║  ✅ Withdrawal Routes: /api/withdrawals/*║
║  ✅ Payment Routes: /api/payments/*      ║
║  ✅ PIN Reset Routes: /api/admin/*       ║
║  ✅ Email Routes: /api/email/*           ║
║  ✅ AI Analysis Routes: /api/ai-analysis/*║
║  ✅ Storage Routes: /api/storage/*       ║
║  ✅ Health Check: /health                ║
║  ✅ Supabase: Connected                  ║
╚══════════════════════════════════════════╝
    `);
  });
}

// Load routes and start server
loadRoutesAndStartServer();

// ==========================================
// Live World Bank Inflation Refresh
// Runs once at startup, then daily at 03:00 — official inflation figures
// are published annually per country, so daily is just "check for the
// newest published number", not a live tick.
// ==========================================
refreshGlobalInflation().catch(err => console.error('[inflation] Initial refresh failed:', err.message));
cron.schedule('0 3 * * *', () => {
  refreshGlobalInflation().catch(err => console.error('[inflation] Scheduled refresh failed:', err.message));
});

// ==========================================
// Live FX Rate Refresh
// Runs once at startup, then daily at 03:05 — keeps ican_currency_rates.
// rate_to_ugx current for every currency so the USD-anchored price engine's
// FX shield (and each currency's own appreciation vs its launch rate) tracks
// real exchange-rate movement instead of the one-time seed values.
// ==========================================
refreshLiveFxRates().catch(err => console.error('[fx-rates] Initial refresh failed:', err.message));
cron.schedule('5 3 * * *', () => {
  refreshLiveFxRates().catch(err => console.error('[fx-rates] Scheduled refresh failed:', err.message));
});

// ==========================================
// CMMS Payday AI Advisory Worker
// Every payroll payment queues a fact-only "today is payday" notification
// inline (see CMMS_PAYDAY_ADVISORY_NOTIFICATIONS.sql); this enriches it with
// a one-line AI recommendation a few seconds later, off the payment's own
// transaction. Runs every 2 minutes — frequent enough that employees see
// the advice land almost immediately after their fact notification.
// ==========================================
processPendingPaydayAdvisories().catch(err => console.error('[payday-advisory] Initial run failed:', err.message));
cron.schedule('*/2 * * * *', () => {
  processPendingPaydayAdvisories().catch(err => console.error('[payday-advisory] Scheduled run failed:', err.message));
});

module.exports = app;
