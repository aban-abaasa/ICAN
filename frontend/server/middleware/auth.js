// Authentication middleware for ICAN Capital Engine API
import jwt from 'jsonwebtoken';

const authMiddleware = (req, res, next) => {
  try {
    // Get token from header
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: {
          message: 'Access denied. No valid token provided.',
          code: 'NO_TOKEN'
        }
      });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    // For demo purposes, we'll use a simple validation
    // In production, integrate with Firebase Auth or your auth system
    if (process.env.NODE_ENV === 'development') {
      // Development mode - accept any token format that looks like a user ID
      if (token && token.length > 10) {
        req.user = {
          id: token,
          authenticated: true,
          timestamp: new Date().toISOString()
        };
        return next();
      }
    } else {
      // Production mode - verify JWT token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = decoded;
    }

    // Validate biometric token for high-security operations
    if (req.path.includes('vet_contract') || req.headers['x-biometric-token']) {
      const biometricToken = req.headers['x-biometric-token'];
      
      if (!biometricToken) {
        return res.status(403).json({
          success: false,
          error: {
            message: 'Biometric authentication required for this operation',
            code: 'BIOMETRIC_REQUIRED'
          }
        });
      }

      // Validate biometric token (simplified for demo)
      try {
        const biometricData = JSON.parse(atob(biometricToken));
        const tokenAge = Date.now() - new Date(biometricData.timestamp).getTime();
        
        if (tokenAge > 300000) { // 5 minutes
          return res.status(403).json({
            success: false,
            error: {
              message: 'Biometric token expired',
              code: 'BIOMETRIC_EXPIRED'
            }
          });
        }

        req.user.biometricVerified = true;
        req.user.biometricData = biometricData;
      } catch (error) {
        return res.status(403).json({
          success: false,
          error: {
            message: 'Invalid biometric token',
            code: 'BIOMETRIC_INVALID'
          }
        });
      }
    }

    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        error: {
          message: 'Invalid token',
          code: 'INVALID_TOKEN'
        }
      });
    }

    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: {
          message: 'Token expired',
          code: 'TOKEN_EXPIRED'
        }
      });
    }

    res.status(500).json({
      success: false,
      error: {
        message: 'Authentication error',
        code: 'AUTH_ERROR'
      }
    });
  }
};

export default authMiddleware;