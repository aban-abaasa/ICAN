import { getSupabase } from './pitchingService';
import { getLiveShareOffer } from './pitchinValuationService';

/**
 * Idempotently promotes an investor to a real shareholder (business_co_owners
 * row, which is what BusinessProfileCard checks for view access) once their
 * investment_agreements row has reached 'sealed'. No-ops if the investor is
 * already a co-owner for this business.
 *
 * Why this exists: the original promotion (ShareSigningFlow.jsx) only ran
 * from a live React effect while that investor's browser tab happened to be
 * open at the exact moment the last shareholder signed. Anyone who closed
 * the tab before that, or whose approval came in after they left, paid but
 * never got added as a shareholder. Call this from anywhere an investor's
 * existing investment is displayed (e.g. InvestmentProgressView) so it
 * self-heals on next view instead of staying stuck forever.
 */
export async function reconcileInvestorShareholderStatus(agreement, pitch, currentUser) {
  const supabase = getSupabase();
  if (!supabase || !agreement?.id || !agreement?.business_profile_id || !currentUser?.id) {
    return { promoted: false, reason: 'missing input' };
  }

  const businessProfileId = agreement.business_profile_id;

  const { data: existingCoOwner } = await supabase
    .from('business_co_owners')
    .select('id')
    .eq('business_profile_id', businessProfileId)
    .or(`user_id.eq.${currentUser.id},owner_email.eq.${currentUser.email}`)
    .maybeSingle();

  if (existingCoOwner) {
    return { promoted: false, reason: 'already a shareholder' };
  }

  let sealedStatus = agreement.status;
  if (sealedStatus !== 'sealed') {
    const { data: freshAgreement } = await supabase
      .from('investment_agreements')
      .select('status, shares_amount, escrow_id')
      .eq('id', agreement.id)
      .maybeSingle();
    sealedStatus = freshAgreement?.status;
    if (sealedStatus !== 'sealed') {
      return { promoted: false, reason: 'not sealed yet' };
    }
    agreement = { ...agreement, ...freshAgreement };
  }

  const businessOwnerUserId = pitch?.business_profiles?.user_id || pitch?.user_id;
  const offer = await getLiveShareOffer(businessProfileId, businessOwnerUserId).catch(() => null);
  if (!offer?.totalShares || offer.totalShares <= 0) {
    return { promoted: false, reason: 'live share valuation unavailable' };
  }

  const sharesAmount = parseInt(agreement.shares_amount) || 0;
  const equityOffering = (sharesAmount / offer.totalShares) * 100;

  // Dilute existing shareholders proportionally, same math ShareSigningFlow uses
  const { data: currentOwners } = await supabase
    .from('business_co_owners')
    .select('id, ownership_share')
    .eq('business_profile_id', businessProfileId)
    .in('status', ['active', null]);

  const dilutionFactor = 1 - (equityOffering / 100);
  for (const owner of currentOwners || []) {
    const newShare = Math.round((Number(owner.ownership_share) || 0) * dilutionFactor * 100) / 100;
    await supabase
      .from('business_co_owners')
      .update({ ownership_share: newShare, updated_at: new Date().toISOString() })
      .eq('id', owner.id);
  }

  const { error: addInvestorError } = await supabase
    .from('business_co_owners')
    .insert([{
      business_profile_id: businessProfileId,
      owner_name: currentUser?.user_metadata?.full_name || 'Investor',
      owner_email: currentUser?.email,
      user_id: currentUser?.id,
      ownership_share: equityOffering,
      role: 'Shareholder (Investor)',
      status: 'active',
      created_at: new Date().toISOString()
    }]);

  if (addInvestorError) {
    return { promoted: false, reason: addInvestorError.message };
  }

  await supabase.rpc('confirm_investor_as_shareholder_after_approval', {
    p_investment_id: agreement.escrow_id || agreement.id,
    p_business_profile_id: businessProfileId,
    p_investor_id: currentUser.id,
    p_investor_email: currentUser.email,
    p_investor_name: currentUser?.user_metadata?.full_name || 'Investor',
    p_ownership_share: sharesAmount
  }).catch(() => null);

  return { promoted: true, equityOffering };
}
