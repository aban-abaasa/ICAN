import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import contractVettingRouter from './routes/contractVetting.js';
import globalNavigatorRouter from './routes/globalNavigator.js';
import scheduleOptimizerRouter from './routes/scheduleOptimizer.js';
import authMiddleware from './middleware/auth.js';
import securityMiddleware from './middleware/security.js';
import rateLimitMiddleware from './middleware/rateLimit.js';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// CORS configuration
const corsOptions = {
  origin: process.env.NODE_ENV === 'production' 
    ? ['https://ican-capital-engine.com'] // Replace with actual domain
    : ['http://localhost:3000', 'http://127.0.0.1:3000'],
  credentials: true,
  optionsSuccessStatus: 200
};

// Middleware
app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Security middleware
app.use(securityMiddleware);

// Rate limiting
app.use('/api', rateLimitMiddleware);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    service: 'ICAN Capital Engine API'
  });
});

// API Routes with authentication
app.use('/api/ai/vet_contract', authMiddleware, contractVettingRouter);
app.use('/api/ai/global_navigator', authMiddleware, globalNavigatorRouter);
app.use('/api/ai/daily_schedule', authMiddleware, scheduleOptimizerRouter);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('API Error:', err);
  
  // Don't leak error details in production
  const isDevelopment = process.env.NODE_ENV === 'development';
  
  res.status(err.status || 500).json({
    success: false,
    error: {
      message: err.message || 'Internal Server Error',
      code: err.code || 'INTERNAL_ERROR',
      ...(isDevelopment && { stack: err.stack })
    },
    timestamp: new Date().toISOString()
  });
});

// Handle 404
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: {
      message: 'API endpoint not found',
      code: 'NOT_FOUND'
    },
    timestamp: new Date().toISOString()
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  process.exit(0);
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 ICAN Capital Engine API running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`🛡️ Security protocols active`);
  console.log(`🔥 Environment: ${process.env.NODE_ENV || 'development'}`);
});

export default app;