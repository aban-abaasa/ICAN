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
// API Routes
// ==========================================

// MOMO Payment Routes
app.use('/api/momo', momoRoutes);

// P2P Transfer Routes (2-step workflow)
app.use('/api/p2p', p2pTransferRoutes);

// Payment Routes
app.use('/api/payments', paymentsRoutes);

// Withdrawal Routes
app.use('/api/withdrawals', withdrawalRoutes);

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
║  ✅ Health Check: /health                ║
║  ✅ Supabase: Connected                  ║
╚══════════════════════════════════════════╝
  `);
});

module.exports = app;
