// Rate limiting middleware for ICAN Capital Engine API
import rateLimit from 'express-rate-limit';

// General API rate limiting
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: {
    success: false,
    error: {
      message: 'Too many requests from this IP, please try again later',
      code: 'RATE_LIMIT_EXCEEDED'
    }
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// AI API specific rate limiting (more restrictive)
const aiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // Limit each IP to 10 AI requests per minute
  message: {
    success: false,
    error: {
      message: 'AI request limit exceeded. Please wait before making another request',
      code: 'AI_RATE_LIMIT_EXCEEDED'
    }
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Contract vetting specific limiting (most restrictive)
const contractLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 3, // Limit each IP to 3 contract analyses per 5 minutes
  message: {
    success: false,
    error: {
      message: 'Contract analysis limit exceeded. This is a high-security operation with restricted access',
      code: 'CONTRACT_RATE_LIMIT_EXCEEDED'
    }
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Combined rate limiting middleware
const rateLimitMiddleware = (req, res, next) => {
  // Apply contract-specific limiting for contract vetting
  if (req.path.includes('/vet_contract')) {
    return contractLimiter(req, res, next);
  }
  
  // Apply AI limiting for all AI endpoints
  if (req.path.includes('/ai/')) {
    return aiLimiter(req, res, next);
  }
  
  // Apply general limiting for all other API endpoints
  return generalLimiter(req, res, next);
};

export default rateLimitMiddleware;