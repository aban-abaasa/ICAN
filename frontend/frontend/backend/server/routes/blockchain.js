import express from 'express';
import { BlockchainService } from '../services/blockchainService.js';
import crypto from 'crypto';

const router = express.Router();

/**
 * GET /api/blockchain/pending
 * Get all data pending blockchain sync
 */
router.get('/pending', async (req, res) => {
  try {
    const pendingData = await BlockchainService.getAllPendingSync();
    
    res.json({
      success: true,
      data: pendingData,
      counts: {
        transactions: pendingData.transactions.length,
        contracts: pendingData.contracts.length,
        listings: pendingData.listings.length,
        total: pendingData.transactions.length + 
               pendingData.contracts.length + 
               pendingData.listings.length
      }
    });
  } catch (error) {
    console.error('Error fetching pending sync:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch pending sync data', code: 'FETCH_ERROR' }
    });
  }
});

/**
 * POST /api/blockchain/sync
 * Batch update blockchain sync status
 */
router.post('/sync', async (req, res) => {
  try {
    const { updates } = req.body;
    
    if (!updates || !Array.isArray(updates)) {
      return res.status(400).json({
        success: false,
        error: { message: 'Updates array is required', code: 'INVALID_INPUT' }
      });
    }

    const results = await BlockchainService.batchUpdateSyncStatus(updates);
    
    res.json({
      success: true,
      results,
      summary: {
        total: results.length,
        successful: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length
      }
    });
  } catch (error) {
    console.error('Error updating sync status:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to update sync status', code: 'UPDATE_ERROR' }
    });
  }
});

/**
 * GET /api/blockchain/profile/:userId
 * Get user's complete cross-app profile for blockchain
 */
router.get('/profile/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const profile = await BlockchainService.getUserCompleteProfile(userId);
    
    if (!profile.profile) {
      return res.status(404).json({
        success: false,
        error: { message: 'User not found', code: 'USER_NOT_FOUND' }
      });
    }

    // Generate a hash of user data for blockchain verification
    const dataHash = crypto
      .createHash('sha256')
      .update(JSON.stringify({
        userId,
        stats: profile.stats,
        timestamp: new Date().toISOString()
      }))
      .digest('hex');

    res.json({
      success: true,
      data: profile,
      dataHash,
      blockchainReady: profile.wallets?.some(w => w.is_verified) || false
    });
  } catch (error) {
    console.error('Error fetching blockchain profile:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch profile', code: 'FETCH_ERROR' }
    });
  }
});

/**
 * POST /api/blockchain/wallet/verify
 * Verify wallet ownership
 */
router.post('/wallet/verify', async (req, res) => {
  try {
    const { walletAddress, signature } = req.body;
    const userId = req.user?.id;

    if (!userId || !walletAddress || !signature) {
      return res.status(400).json({
        success: false,
        error: { message: 'Missing required fields', code: 'INVALID_INPUT' }
      });
    }

    const result = await BlockchainService.verifyWallet(userId, walletAddress, signature);
    
    if (result.error) {
      return res.status(400).json({
        success: false,
        error: { message: result.error.message, code: 'VERIFICATION_FAILED' }
      });
    }

    res.json({
      success: true,
      data: result.data,
      message: 'Wallet verified successfully'
    });
  } catch (error) {
    console.error('Error verifying wallet:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to verify wallet', code: 'VERIFICATION_ERROR' }
    });
  }
});

/**
 * POST /api/blockchain/log
 * Create a blockchain sync log entry
 */
router.post('/log', async (req, res) => {
  try {
    const { type, recordId, table, dataHash, network } = req.body;

    const result = await BlockchainService.logSync({
      type,
      recordId,
      table,
      dataHash,
      network
    });

    if (result.error) {
      return res.status(400).json({
        success: false,
        error: { message: result.error.message, code: 'LOG_FAILED' }
      });
    }

    res.json({
      success: true,
      data: result.data
    });
  } catch (error) {
    console.error('Error creating sync log:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to create sync log', code: 'LOG_ERROR' }
    });
  }
});

export default router;
