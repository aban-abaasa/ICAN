// Security middleware for ICAN Capital Engine API
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

// Security headers and protection
const securityMiddleware = [
  // Helmet for security headers
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "fonts.googleapis.com"],
        fontSrc: ["'self'", "fonts.gstatic.com"],
        imgSrc: ["'self'", "data:", "https:"],
        scriptSrc: ["'self'"],
        connectSrc: ["'self'", "https://generativelanguage.googleapis.com"]
      }
    },
    crossOriginEmbedderPolicy: false
  }),

  // Custom security headers
  (req, res, next) => {
    // Remove server fingerprinting
    res.removeHeader('X-Powered-By');
    
    // Add custom security headers
    res.setHeader('X-API-Version', '1.0.0');
    res.setHeader('X-Security-Level', 'HIGH');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    
    // Prevent caching of sensitive endpoints
    if (req.path.includes('/api/ai/')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
    
    next();
  },

  // Request validation
  (req, res, next) => {
    // Validate content type for POST requests
    if (req.method === 'POST' && !req.is('application/json')) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Content-Type must be application/json',
          code: 'INVALID_CONTENT_TYPE'
        }
      });
    }

    // Validate request size
    const contentLength = parseInt(req.headers['content-length'] || '0');
    if (contentLength > 10 * 1024 * 1024) { // 10MB limit
      return res.status(413).json({
        success: false,
        error: {
          message: 'Request payload too large',
          code: 'PAYLOAD_TOO_LARGE'
        }
      });
    }

    // Log security-relevant requests
    if (req.path.includes('/api/ai/')) {
      console.log(`[SECURITY] ${req.method} ${req.path} - User: ${req.user?.id || 'unknown'} - IP: ${req.ip}`);
    }

    next();
  }
];

export default securityMiddleware;