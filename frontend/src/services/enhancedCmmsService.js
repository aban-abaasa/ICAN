/**
 * 🏭 Enhanced CMMS Service with Blockchain Approval Chain
 * Immutable approval tracking with currency conversion and audit trail
 */

import { supabase } from '../lib/supabase/client';
import enhancedTrustService from './enhancedTrustService';

export class EnhancedCmmsService {
  /**
   * Create approval chain for requisition
   * Each approval step is immutably recorded on blockchain
   */
  async createApprovalChain(requisition) {
    try {
      const sb = supabase;
      if (!sb) throw new Error('Supabase not available');

      const {
        requisitionId,
        workOrderId,
        itemDescription,
        quantity,
        estimatedCost,
        currency,
        companyId,
        approvalRequirements, // ['manager', 'finance', 'operations']
        initiatorId
      } = requisition;

      // Create approval chain record
      const { data: chainData, error: chainError } = await sb
        .from('cmms_approval_chains')
        .insert([
          {
            requisition_id: requisitionId,
            work_order_id: workOrderId,
            company_id: companyId,
            
            // Details
            item_description: itemDescription,
            quantity: quantity,
            estimated_cost: estimatedCost,
            currency: currency,
            
            // Approval flow
            required_approvals: approvalRequirements,
            current_step: 1,
            total_steps: approvalRequirements.length,
            
            // Status
            status: 'pending_approvals',
            initiated_by: initiatorId,
            initiated_at: new Date().toISOString()
          }
        ])
        .select();

      if (chainError) throw chainError;

      console.log('✅ Approval chain created:', chainData[0].id);

      return {
        success: true,
        chainId: chainData[0].id,
        chain: chainData[0]
      };
    } catch (error) {
      console.error('❌ Failed to create approval chain:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Record approval step with blockchain signature
   */
  async recordApprovalStep(approval) {
    try {
      const sb = supabase;
      if (!sb) throw new Error('Supabase not available');

      const {
        approvalChainId,
        approverId,
        approverRole,
        status, // 'approved', 'rejected', 'pending_revision'
        comment,
        exchangeRateAtApproval,
        approvalAmount,
        currency,
        blockchainSignature,
        ipAddress,
        deviceId
      } = approval;

      // Get current approval chain step
      const { data: chain, error: chainError } = await sb
        .from('cmms_approval_chains')
        .select('*')
        .eq('id', approvalChainId)
        .single();

      if (chainError) throw chainError;

      // Calculate USD equivalent
      const amountUsd = approvalAmount * exchangeRateAtApproval;

      // Record approval step
      const { data: stepData, error: stepError } = await sb
        .from('cmms_approval_steps')
        .insert([
          {
            approval_chain_id: approvalChainId,
            step_number: chain.current_step,
            required_role: chain.required_approvals[chain.current_step - 1],
            
            // Approver details
            approver_id: approverId,
            approver_role: approverRole,
            
            // Approval decision
            status: status,
            comment: comment,
            
            // Currency & exchange
            approval_currency: currency,
            approval_amount: approvalAmount,
            exchange_rate_at_approval: exchangeRateAtApproval,
            amount_usd: amountUsd,
            
            // Blockchain
            blockchain_signature: blockchainSignature,
            blockchain_hash: this.generateBlockchainHash({
              stepNumber: chain.current_step,
              approverId,
              status,
              amount: approvalAmount,
              timestamp: Date.now()
            }),
            
            // Audit
            ip_address: ipAddress,
            device_identifier: deviceId,
            approved_at: new Date().toISOString()
          }
        ])
        .select();

      if (stepError) throw stepError;

      // If approved, move to next step or finalize
      if (status === 'approved') {
        const isLastStep = chain.current_step >= chain.total_steps;
        
        const updateData = {
          current_step: isLastStep ? chain.total_steps : chain.current_step + 1,
          status: isLastStep ? 'fully_approved' : 'in_progress',
          updated_at: new Date().toISOString()
        };

        if (isLastStep) {
          updateData.approved_at = new Date().toISOString();
          updateData.total_approval_time_minutes = 
            Math.floor((Date.now() - new Date(chain.initiated_at)) / 60000);
        }

        await sb
          .from('cmms_approval_chains')
          .update(updateData)
          .eq('id', approvalChainId);
      } else if (status === 'rejected') {
        // Approval rejected - needs revision
        await sb
          .from('cmms_approval_chains')
          .update({
            status: 'rejected_awaiting_revision',
            rejection_reason: comment,
            rejected_at: new Date().toISOString()
          })
          .eq('id', approvalChainId);
      }

      console.log('✅ Approval step recorded:', {
        step: chain.current_step,
        status: status,
        amount: approvalAmount,
        hash: stepData[0].blockchain_hash
      });

      return {
        success: true,
        step: stepData[0],
        chainStatus: status === 'approved' ? 
          (chain.current_step >= chain.total_steps ? 'completed' : 'in_progress') : 
          'blocked'
      };
    } catch (error) {
      console.error('❌ Failed to record approval step:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Generate blockchain-style hash for approval
   */
  generateBlockchainHash(data) {
    const crypto = require('crypto');
    const hashInput = JSON.stringify(data);
    return crypto
      .createHash('sha256')
      .update(hashInput)
      .digest('hex');
  }

  /**
   * Execute payment after full approval
   */
  async executeApprovedPayment(approvalChainId, paymentMethod) {
    try {
      const sb = supabase;
      if (!sb) throw new Error('Supabase not available');

      // Get the full approval chain
      const { data: chain, error: chainError } = await sb
        .from('cmms_approval_chains')
        .select(`
          *,
          approval_steps:cmms_approval_steps(*)
        `)
        .eq('id', approvalChainId)
        .single();

      if (chainError) throw chainError;

      if (chain.status !== 'fully_approved') {
        throw new Error(`Cannot execute: Chain status is ${chain.status}`);
      }

      // Lock exchange rate for payment
      const ratelock = await enhancedTrustService.lockExchangeRate(
        chain.currency,
        'UGX',
        approvalChainId,
        'cmms_payment'
      );

      if (!ratelock.success) throw new Error('Failed to lock exchange rate');

      // Calculate total with all approvals
      const totalAmount = chain.estimated_cost;
      const conversion = enhancedTrustService.calculateConversion(
        totalAmount,
        ratelock.lockedRate,
        'UG', // Uganda default, should be company location
        'cmms_payment'
      );

      if (!conversion.success) throw new Error(conversion.error);

      const { breakdown } = conversion;

      // Record payment transaction
      const { data: paymentData, error: paymentError } = await sb
        .from('cmms_payment_transactions')
        .insert([
          {
            approval_chain_id: approvalChainId,
            company_id: chain.company_id,
            
            // Payment details
            payment_method: paymentMethod,
            gross_amount: totalAmount,
            currency: chain.currency,
            
            // Fees
            platform_fee: breakdown.platform_fee_ican,
            blockchain_fee: breakdown.blockchain_fee_ican,
            total_fees: breakdown.total_fee_ican,
            
            // Net amount
            net_amount: breakdown.net_local,
            amount_usd: breakdown.net_usd,
            
            // Exchange
            exchange_rate_locked: ratelock.lockedRate,
            exchange_rate_lock_id: ratelock.recordId,
            
            // Blockchain
            status: 'processing',
            blockchain_recorded: false,
            
            // Approval trail
            approvals_count: chain.approval_steps.length,
            all_approvals: chain.approval_steps,
            
            created_at: new Date().toISOString()
          }
        ])
        .select();

      if (paymentError) throw paymentError;

      // Record on blockchain
      const blockchainResult = await this.recordPaymentBlockchain({
        paymentId: paymentData[0].id,
        approvalChainId: approvalChainId,
        amount: breakdown.net_local,
        currency: chain.currency,
        approvals: chain.approval_steps
      });

      if (blockchainResult.success) {
        await sb
          .from('cmms_payment_transactions')
          .update({
            blockchain_recorded: true,
            blockchain_hash: blockchainResult.hash,
            status: 'completed',
            completed_at: new Date().toISOString()
          })
          .eq('id', paymentData[0].id);
      }

      // Update approval chain
      await sb
        .from('cmms_approval_chains')
        .update({
          status: 'payment_executed',
          payment_id: paymentData[0].id,
          executed_at: new Date().toISOString()
        })
        .eq('id', approvalChainId);

      console.log('✅ Payment executed:', {
        amount: breakdown.net_local,
        fee: breakdown.total_fee_isan,
        blockchainHash: blockchainResult.hash
      });

      return {
        success: true,
        payment: paymentData[0],
        breakdown: breakdown,
        blockchainHash: blockchainResult.hash
      };
    } catch (error) {
      console.error('❌ Failed to execute payment:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Record payment on blockchain
   */
  async recordPaymentBlockchain(data) {
    try {
      // Simulate blockchain recording
      const hash = this.generateBlockchainHash({
        paymentId: data.paymentId,
        amount: data.amount,
        currency: data.currency,
        timestamp: Date.now(),
        approvalCount: data.approvals.length
      });

      return {
        success: true,
        hash: hash
      };
    } catch (error) {
      console.error('❌ Blockchain recording failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get audit trail for requisition
   */
  async getAuditTrail(approvalChainId) {
    try {
      const sb = supabase;
      if (!sb) throw new Error('Supabase not available');

      // Get chain
      const { data: chain, error: chainError } = await sb
        .from('cmms_approval_chains')
        .select('*')
        .eq('id', approvalChainId)
        .single();

      if (chainError) throw chainError;

      // Get all approval steps
      const { data: steps, error: stepsError } = await sb
        .from('cmms_approval_steps')
        .select('*')
        .eq('approval_chain_id', approvalChainId)
        .order('step_number', { ascending: true });

      if (stepsError) throw stepsError;

      // Get payment (if executed)
      const { data: payment, error: paymentError } = await sb
        .from('cmms_payment_transactions')
        .select('*')
        .eq('approval_chain_id', approvalChainId)
        .single();

      const auditTrail = {
        requisition: {
          chainId: chain.id,
          description: chain.item_description,
          status: chain.status,
          createdAt: chain.initiated_at,
          totalApprovalTime: chain.total_approval_time_minutes || 'In progress'
        },
        approvals: steps.map((step, index) => ({
          step: step.step_number,
          role: step.required_role,
          approver: step.approver_id,
          status: step.status,
          comment: step.comment,
          amount: step.approval_amount,
          currency: step.approval_currency,
          amountUsd: step.amount_usd,
          approvedAt: step.approved_at,
          blockchainHash: step.blockchain_hash,
          signature: step.blockchain_signature
        })),
        payment: payment ? {
          id: payment.id,
          method: payment.payment_method,
          grossAmount: payment.gross_amount,
          netAmount: payment.net_amount,
          fees: payment.total_fees,
          amountUsd: payment.amount_usd,
          status: payment.status,
          blockchainHash: payment.blockchain_hash,
          completedAt: payment.completed_at
        } : null
      };

      return {
        success: true,
        auditTrail: auditTrail
      };
    } catch (error) {
      console.error('❌ Failed to get audit trail:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get compliance report for company
   */
  async getComplianceReport(companyId, monthYear) {
    try {
      const sb = supabase;
      if (!sb) throw new Error('Supabase not available');

      // Get all requisitions for month
      const startDate = new Date(`${monthYear}-01`);
      const endDate = new Date(startDate.getFullYear(), startDate.getMonth() + 1, 0);

      const { data: chains, error: chainsError } = await sb
        .from('cmms_approval_chains')
        .select(`
          *,
          approval_steps:cmms_approval_steps(*),
          payment_transactions:cmms_payment_transactions(*)
        `)
        .eq('company_id', companyId)
        .gte('initiated_at', startDate.toISOString())
        .lte('initiated_at', endDate.toISOString());

      if (chainsError) throw chainsError;

      // Summarize
      const totalRequisitions = chains.length;
      const fullyApproved = chains.filter(c => c.status === 'fully_approved').length;
      const executed = chains.filter(c => c.status === 'payment_executed').length;
      const rejected = chains.filter(c => c.status === 'rejected_awaiting_revision').length;

      const totalAmountRequested = chains.reduce((sum, c) => sum + c.estimated_cost, 0);
      const totalAmountApproved = chains
        .filter(c => c.status !== 'rejected_awaiting_revision')
        .reduce((sum, c) => sum + c.estimated_cost, 0);

      const approvalMetrics = {
        averageApprovalTime: Math.round(
          chains
            .filter(c => c.total_approval_time_minutes !== null)
            .reduce((sum, c) => sum + c.total_approval_time_minutes, 0) /
            chains.filter(c => c.total_approval_time_minutes !== null).length
        ),
        averageApprovalSteps: (
          chains.reduce((sum, c) => sum + c.total_steps, 0) / chains.length
        ).toFixed(1),
        blockchainRecordedPercentage: (
          chains.filter(c => {
            const payment = c.payment_transactions?.[0];
            return payment?.blockchain_recorded;
          }).length / executed * 100
        ).toFixed(1)
      };

      return {
        success: true,
        report: {
          month: monthYear,
          company: companyId,
          summary: {
            totalRequisitions,
            fullyApproved,
            executed,
            rejected,
            approvalRate: ((fullyApproved / totalRequisitions) * 100).toFixed(1),
            executionRate: ((executed / fullyApproved) * 100).toFixed(1)
          },
          financial: {
            totalRequested: totalAmountRequested,
            totalApproved: totalAmountApproved,
            totalExecuted: chains
              .filter(c => c.status === 'payment_executed')
              .reduce((sum, c) => sum + c.estimated_cost, 0)
          },
          metrics: approvalMetrics,
          details: chains
        }
      };
    } catch (error) {
      console.error('❌ Failed to generate compliance report:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

export default new EnhancedCmmsService();
