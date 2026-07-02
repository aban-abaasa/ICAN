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
const cron = require('node-cron');
const { refreshGlobalInflation } = require('./services/inflationRefreshService');

// ES6 module imports for pinReset and email routes
let pinResetRoutes;
let emailRoutes;

// Load ES6 modules
(async () => {
  const pinResetModule = await import('./routes/pinResetRoutes.js');
  const emailModule = await import('./routes/emailRoutes.js');
  pinResetRoutes = pinResetModule.default;
  emailRoutes = emailModule.default;
})();

const app = express();
const PORT = process.env.PORT || 5000;

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

// ==========================================
// API Routes (ES6 modules - loaded dynamically)
// ==========================================

// Async function to load ES6 modules and start server
async function loadRoutesAndStartServer() {
  try {
    const pinResetModule = await import('./routes/pinResetRoutes.js');
    const emailModule = await import('./routes/emailRoutes.js');
    
    // PIN Reset Routes (account unlock, PIN recovery)
    app.use('/api', pinResetModule.default);
    
    // Email Routes (send PIN reset, unlock confirmations)
    app.use('/api/email', emailModule.default);
    
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

module.exports = app;
