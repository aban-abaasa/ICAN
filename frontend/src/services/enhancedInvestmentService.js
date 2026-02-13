/**
 * 💼 Enhanced Investment Service with 60% Allocation Rule
 * Prevents concentration risk and ensures diverse investor base
 */

import { supabase } from '../lib/supabase/client';
import enhancedTrustService from './enhancedTrustService';

export class EnhancedInvestmentService {
  /**
   * Check if investor can make investment (60% rule enforcement)
   */
  async checkAllocationCap(investorId, businessId, pitchId, investmentIcan) {
    try {
      const sb = supabase;
      if (!sb) throw new Error('Supabase not available');

      // Get pitch target funding
      const { data: pitch, error: pitchError } = await sb
        .from('pitches')
        .select('target_funding')
        .eq('id', pitchId)
        .single();

      if (pitchError) throw pitchError;
      if (!pitch) throw new Error('Pitch not found');

      const targetFunding = pitch.target_funding;

      // Get existing allocations from this investor to this business
      const { data: existingAllocations, error: allocError } = await sb
        .from('investment_allocations')
        .select('ican_amount')
        .eq('investor_id', investorId)
        .eq('business_id', businessId)
        .eq('status', 'completed');

      if (allocError) throw allocError;

      // Calculate total after new investment
      const existingTotal = 
        (existingAllocations || []).reduce((sum, a) => sum + a.ican_amount, 0);
      const totalAfter = existingTotal + investmentIcan;

      // Convert to USD equivalent for percentage calculation
      // (assuming we use the same market price for consistency)
      const allocationPercentage = (totalAfter / targetFunding) * 100;

      // Log for audit trail
      console.log(`📊 Allocation Check:
        Existing: ${existingTotal} ICAN (${((existingTotal/targetFunding)*100).toFixed(1)}%)
        New: ${investmentIcan} ICAN
        Total: ${totalAfter} ICAN (${allocationPercentage.toFixed(1)}%)
        Limit: 60%
      `);

      // Check 60% rule
      const sixtyPercentOf = targetFunding * 0.60;
      const allowed = totalAfter <= sixtyPercentOf;

      return {
        success: true,
        allowed,
        details: {
          existingAllocation: existingTotal,
          newInvestment: investmentIcan,
          totalAllocation: totalAfter,
          allocationPercentage: allocationPercentage.toFixed(1),
          targetFunding: targetFunding,
          sixtyPercentCap: sixtyPercentOf,
          remainingAllocation: sixtyPercentOf - totalAfter,
          
          // For UI
          isAtCap: allocationPercentage >= 60,
          isOverCap: allocationPercentage > 60,
          percentageLeft: (100 - allocationPercentage).toFixed(1)
        },
        message: allowed
          ? `✅ Investment allowed. You can invest up to ${sixtyPercentOf} ICAN total.`
          : `❌ Investment exceeds 60% cap. Maximum remaining: ${Math.max(0, sixtyPercentOf - existingTotal)} ICAN`
      };
    } catch (error) {
      console.error('❌ Allocation check failed:', error);
      return {
        success: false,
        error: error.message,
        allowed: false
      };
    }
  }

  /**
   * Record investment with allocation tracking
   */
  async recordInvestmentWithAllocation(investment) {
    try {
      const sb = supabase;
      if (!sb) throw new Error('Supabase not available');

      const {
        investorId,
        businessId,
        pitchId,
        icanAmount,
        lockedRate,
        countryCode,
        investmentType, // 'equity', 'debt', 'support'
        equityPercentage,
        blockchainHashSignature
      } = investment;

      // First check allocation
      const allocationCheck = await this.checkAllocationCap(
        investorId,
        businessId,
        pitchId,
        icanAmount
      );

      if (!allocationCheck.allowed) {
        return {
          success: false,
          error: allocationCheck.message,
          allocationDetails: allocationCheck.details
        };
      }

      // Calculate conversion
      const conversion = enhancedTrustService.calculateConversion(
        icanAmount,
        lockedRate,
        countryCode,
        'investment'
      );

      if (!conversion.success) throw new Error(conversion.error);

      const { breakdown } = conversion;

      // Create smart contract automatically
      const smartContract = await this.generateSmartContract({
        investorId,
        businessId,
        pitchId,
        investmentAmount: breakdown.net_local,
        investmentType,
        equityPercentage,
        exchangeRate: lockedRate,
        icanBefore: icanAmount,
        feeCharged: breakdown.total_fee_ican
      });

      // Record allocation
      const { data: allocationData, error: allocError } = await sb
        .from('investment_allocations')
        .insert([
          {
            investor_id: investorId,
            business_id: businessId,
            pitch_id: pitchId,
            ican_amount: icanAmount,
            allocated_percentage: 
              (allocationCheck.details.totalAllocation / 
               allocationCheck.details.targetFunding * 100),
            exchange_rate_locked: lockedRate,
            fee_percentage: parseFloat(breakdown.total_fee_percentage),
            total_allocated: breakdown.net_local,
            total_allocated_usd: breakdown.net_usd,
            status: 'pending_approval',
            investment_type: investmentType,
            equity_percentage: equityPercentage || 0,
            smart_contract_id: smartContract.id
          }
        ])
        .select();

      if (allocError) throw allocError;

      // Record actual investment (in separate table)
      const { data: investmentData, error: investError } = await sb
        .from('investor_investments')
        .insert([
          {
            investor_id: investorId,
            business_id: businessId,
            pitch_id: pitchId,
            allocation_id: allocationData[0].id,
            
            // ICAN & fees
            ican_invested: icanAmount,
            ican_fees: breakdown.total_fee_ican,
            ican_net: breakdown.net_ican,
            
            // Local currency
            amount_in_currency: breakdown.net_local,
            currency_code: breakdown.currency_code,
            amount_in_usd: breakdown.net_usd,
            
            // Exchange info
            exchange_rate_at_investment: lockedRate,
            exchange_rate_lock_id: investment.exchangeRateLockId,
            
            // Investment details
            investment_type: investmentType,
            equity_percentage: equityPercentage || 0,
            
            // Smart contract
            smart_contract_id: smartContract.id,
            smart_contract_hash: smartContract.blockchainHash,
            
            // Status
            status: 'pending_signature',
            blockchain_recorded: false,
            
            // Blockchain
            blockchain_signature: blockchainHashSignature,
            
            created_at: new Date().toISOString()
          }
        ])
        .select();

      if (investError) throw investError;

      console.log('✅ Investment recorded:', {
        icanInvested: icanAmount,
        localAmount: breakdown.net_local,
        allocationType: investmentType,
        smartContractId: smartContract.id,
        blockchainHash: smartContract.blockchainHash
      });

      return {
        success: true,
        investment: investmentData[0],
        allocation: allocationData[0],
        smartContract: smartContract,
        allocationDetails: allocationCheck.details,
        breakdown: breakdown
      };
    } catch (error) {
      console.error('❌ Failed to record investment:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Generate smart contract for investment
   */
  async generateSmartContract(investment) {
    try {
      const sb = supabase;
      if (!sb) throw new Error('Supabase not available');

      // Get business details
      const { data: business, error: bizError } = await sb
        .from('business_profiles')
        .select('business_name, owner_name, owner_email')
        .eq('id', investment.businessId)
        .single();

      if (bizError) throw bizError;

      // Get investor details
      const { data: investor, error: invError } = await sb
        .from('profiles')
        .select('email, full_name')
        .eq('id', investment.investorId)
        .single();

      if (invError) throw invError;

      // Get pitch details
      const { data: pitch, error: pitchError } = await sb
        .from('pitches')
        .select('title, description')
        .eq('id', investment.pitchId)
        .single();

      if (pitchError) throw pitchError;

      // Generate contract terms
      const contractTerms = {
        id: `SC_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        version: '1.0',
        
        // Parties
        business: business.business_name,
        businessOwner: business.owner_name,
        businessEmail: business.owner_email,
        
        investor: investor.full_name,
        investorEmail: investor.email,
        
        pitch: pitch.title,
        pitchDescription: pitch.description,
        
        // Investment terms
        investmentType: investment.investmentType,
        icanAmountBefore: investment.icanBefore,
        feeCharged: investment.feeCharged,
        investmentAmount: investment.investmentAmount,
        investmentCurrency: 'UGX',
        exchangeRate: investment.exchangeRate,
        
        // Equity details (if applicable)
        ...(investment.investmentType === 'equity' && {
          equityPercentage: investment.equityPercentage,
          vestingSchedule: '48 months linear',
          liquidationPreference: 'non-participating'
        }),
        
        // Execution
        executionDate: new Date().toISOString(),
        expiryDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        
        // Blockchain
        blockchainVerified: true,
        immutable: true
      };

      // Insert contract
      const { data: contractData, error: contractError } = await sb
        .from('smart_contracts')
        .insert([
          {
            investor_id: investment.investorId,
            business_id: investment.businessId,
            pitch_id: investment.pitchId,
            contract_type: 'investment_agreement',
            contract_terms: contractTerms,
            status: 'pending_signatures',
            created_at: new Date().toISOString()
          }
        ])
        .select();

      if (contractError) throw contractError;

      return {
        id: contractData[0].id,
        blockchainHash: contractTerms.id,
        terms: contractTerms,
        needsSignature: true
      };
    } catch (error) {
      console.error('❌ Failed to generate smart contract:', error);
      throw error;
    }
  }

  /**
   * Get allocation summary for investor
   */
  async getAllocationSummary(investorId, businessId) {
    try {
      const sb = supabase;
      if (!sb) throw new Error('Supabase not available');

      // Get all allocations
      const { data: allocations, error: allocError } = await sb
        .from('investment_allocations')
        .select(`
          *,
          pitches(target_funding)
        `)
        .eq('investor_id', investorId)
        .eq('business_id', businessId);

      if (allocError) throw allocError;

      if (!allocations || allocations.length === 0) {
        return {
          success: true,
          summary: {
            totalInvested: 0,
            totalAllocatedPercentage: 0,
            remainingAllocation: 100,
            investmentCount: 0,
            allocations: []
          }
        };
      }

      const targetFunding = allocations[0].pitches.target_funding;
      const totalInvested = allocations.reduce((sum, a) => sum + a.ican_amount, 0);
      const totalPercentage = (totalInvested / targetFunding) * 100;

      return {
        success: true,
        summary: {
          totalInvested: totalInvested,
          totalInvestedUsd: allocations.reduce((sum, a) => sum + (a.total_allocated_usd || 0), 0),
          totalAllocatedPercentage: totalPercentage.toFixed(1),
          remainingAllocation: (60 - totalPercentage).toFixed(1),
          canInvestMore: totalPercentage < 60,
          maxCanAdd: Math.max(0, (targetFunding * 0.60) - totalInvested),
          investmentCount: allocations.length,
          allocations: allocations
        }
      };
    } catch (error) {
      console.error('❌ Failed to get allocation summary:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get all investments for a business
   */
  async getBusinessInvestmentSnapshot(businessId) {
    try {
      const sb = supabase;
      if (!sb) throw new Error('Supabase not available');

      // Get business profile
      const { data: business, error: bizError } = await sb
        .from('business_profiles')
        .select('id, business_name')
        .eq('id', businessId)
        .single();

      if (bizError) throw bizError;

      // Get all allocations
      const { data: allocations, error: allocError } = await sb
        .from('investment_allocations')
        .select('*')
        .eq('business_id', businessId)
        .eq('status', 'completed');

      if (allocError) throw allocError;

      const totalAllocated = 
        (allocations || []).reduce((sum, a) => sum + a.ican_amount, 0);
      
      const totalInUSD = 
        (allocations || []).reduce((sum, a) => sum + (a.total_allocated_usd || 0), 0);

      // Find top investors
      const investorBreakdown = {};
      (allocations || []).forEach(a => {
        if (!investorBreakdown[a.investor_id]) {
          investorBreakdown[a.investor_id] = {
            investorId: a.investor_id,
            totalIcan: 0,
            totalUSD: 0,
            count: 0
          };
        }
        investorBreakdown[a.investor_id].totalIcan += a.ican_amount;
        investorBreakdown[a.investor_id].totalUSD += a.total_allocated_usd || 0;
        investorBreakdown[a.investor_id].count += 1;
      });

      const topInvestors = Object.values(investorBreakdown)
        .sort((a, b) => b.totalUSD - a.totalUSD)
        .slice(0, 5);

      return {
        success: true,
        snapshot: {
          businessName: business.business_name,
          totalRaised: {
            ican: totalAllocated,
            usd: totalInUSD
          },
          investorCount: Object.keys(investorBreakdown).length,
          topInvestors: topInvestors,
          diversificationScore: this.calculateDiversificationScore(investorBreakdown),
          concentrationRisk: this.calculateConcentrationRisk(investorBreakdown),
          allocationDetails: allocations
        }
      };
    } catch (error) {
      console.error('❌ Failed to get business snapshot:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Calculate diversification score (Herfindahl index)
   */
  calculateDiversificationScore(investorBreakdown) {
    const investors = Object.values(investorBreakdown);
    const totalUSD = investors.reduce((sum, i) => sum + i.totalUSD, 0);
    
    if (totalUSD === 0) return 0;
    
    const herfindahl = investors.reduce((sum, investor) => {
      const marketShare = (investor.totalUSD / totalUSD) * 100;
      return sum + (marketShare * marketShare);
    }, 0);
    
    // Convert to 0-100 scale (100 = perfect diversity)
    return Math.round(100 - (herfindahl / 10000) * 100);
  }

  /**
   * Calculate concentration risk
   */
  calculateConcentrationRisk(investorBreakdown) {
    const investors = Object.values(investorBreakdown);
    if (investors.length === 0) return { risk: 'N/A', topInvestorShare: 0 };
    
    const totalUSD = investors.reduce((sum, i) => sum + i.totalUSD, 0);
    const topInvestorShare = (investors[0].totalUSD / totalUSD) * 100;
    
    let risk = 'Low';
    if (topInvestorShare > 60) risk = 'Critical';
    else if (topInvestorShare > 45) risk = 'High';
    else if (topInvestorShare > 30) risk = 'Medium';
    
    return { risk, topInvestorShare: topInvestorShare.toFixed(1) };
  }
}

export default new EnhancedInvestmentService();
