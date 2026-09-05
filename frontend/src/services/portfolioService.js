/**
 * Portfolio Service — "My Resume / Portfolio" tab
 * Manual timeline entries + CMMS-synced entries for CMMS members, plus a
 * public (anon-readable) lookup by handle for the /portfolio/<handle> page.
 */

import { supabase } from '../lib/supabase/client';
import { getUserStatuses } from './statusService';

// ─── Own portfolio (authenticated) ─────────────────────────────────────────

export async function getMyPortfolio(userId) {
  const [{ data: portfolio, error: portfolioError }, { data: profile, error: profileError }] = await Promise.all([
    supabase.from('user_portfolios').select('*').eq('user_id', userId).maybeSingle(),
    supabase.from('profiles').select('handle').eq('id', userId).maybeSingle(),
  ]);

  if (portfolioError) throw portfolioError;
  if (profileError) throw profileError;

  return { portfolio: portfolio || null, handle: profile?.handle || null };
}

export async function upsertPortfolio(userId, { headline, summary, skills, links, isPublic, location, phone, contactEmail } = {}) {
  const { data, error } = await supabase
    .from('user_portfolios')
    .upsert(
      {
        user_id: userId,
        headline,
        summary,
        skills: skills || [],
        links: links || {},
        is_public: isPublic !== undefined ? isPublic : true,
        location: location || null,
        phone: phone || null,
        contact_email: contactEmail || null,
      },
      { onConflict: 'user_id' }
    )
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function setHandle(userId, handle) {
  const normalized = String(handle || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  if (!normalized || normalized.length < 3) {
    throw new Error('Handle must be at least 3 characters (letters, numbers, - or _)');
  }

  const { data, error } = await supabase
    .from('profiles')
    .update({ handle: normalized })
    .eq('id', userId)
    .select('handle')
    .single();

  if (error) {
    if (error.code === '23505') throw new Error('That handle is already taken — try another.');
    throw error;
  }
  return data.handle;
}

export async function getPortfolioItems(userId) {
  const { data, error } = await supabase
    .from('user_portfolio_items')
    .select('*')
    .eq('user_id', userId)
    .order('start_date', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function addPortfolioItem(userId, item) {
  const { data, error } = await supabase
    .from('user_portfolio_items')
    .insert({
      user_id: userId,
      source: 'manual',
      item_type: item.itemType || 'experience',
      title: item.title,
      org_name: item.orgName || null,
      description: item.description || null,
      start_date: item.startDate || null,
      end_date: item.endDate || null,
      is_public: item.isPublic !== undefined ? item.isPublic : true,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updatePortfolioItem(userId, itemId, updates) {
  const { data, error } = await supabase
    .from('user_portfolio_items')
    .update({
      item_type: updates.itemType,
      title: updates.title,
      org_name: updates.orgName || null,
      description: updates.description || null,
      start_date: updates.startDate || null,
      end_date: updates.endDate || null,
      is_public: updates.isPublic,
    })
    .eq('id', itemId)
    .eq('user_id', userId)
    .eq('source', 'manual')
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function deletePortfolioItem(userId, itemId) {
  const { error } = await supabase
    .from('user_portfolio_items')
    .delete()
    .eq('id', itemId)
    .eq('user_id', userId)
    .eq('source', 'manual');

  if (error) throw error;
}

// ─── References ─────────────────────────────────────────────────────────────

export async function getPortfolioReferences(userId) {
  const { data, error } = await supabase
    .from('portfolio_references')
    .select('*')
    .eq('user_id', userId)
    .order('display_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) throw error;
  return data || [];
}

export async function addPortfolioReference(userId, ref) {
  const { data, error } = await supabase
    .from('portfolio_references')
    .insert({
      user_id: userId,
      name: ref.name,
      title: ref.title || null,
      organization: ref.organization || null,
      email: ref.email || null,
      phone: ref.phone || null,
      is_public: ref.isPublic !== undefined ? ref.isPublic : true,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updatePortfolioReference(userId, referenceId, updates) {
  const { data, error } = await supabase
    .from('portfolio_references')
    .update({
      name: updates.name,
      title: updates.title || null,
      organization: updates.organization || null,
      email: updates.email || null,
      phone: updates.phone || null,
      is_public: updates.isPublic,
    })
    .eq('id', referenceId)
    .eq('user_id', userId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function deletePortfolioReference(userId, referenceId) {
  const { error } = await supabase
    .from('portfolio_references')
    .delete()
    .eq('id', referenceId)
    .eq('user_id', userId);
  if (error) throw error;
}

// ─── CMMS membership + auto-sync ───────────────────────────────────────────

/**
 * A user is a "CMMS member" if there's an active cmms_users row matching
 * their email (cmms_users is keyed by email, not auth user id — see
 * CMMS_COMPLETE_SCHEMA.sql). Returns the active company/role assignments.
 */
export async function getCmmsMemberships(userEmail) {
  if (!userEmail) return [];

  const { data: cmmsUsers, error: usersError } = await supabase
    .from('cmms_users')
    .select('id, cmms_company_id, department_id, role, is_active')
    .eq('email', userEmail)
    .eq('is_active', true);

  if (usersError) throw usersError;
  if (!cmmsUsers || cmmsUsers.length === 0) return [];

  const cmmsUserIds = cmmsUsers.map((u) => u.id);

  const { data: roleRows, error: rolesError } = await supabase
    .from('cmms_user_roles')
    .select(`
      cmms_user_id,
      cmms_company_id,
      cmms_role_id,
      assigned_at,
      is_active,
      cmms_roles:cmms_role_id(role_name),
      cmms_company_profiles:cmms_company_id(company_name)
    `)
    .in('cmms_user_id', cmmsUserIds)
    .eq('is_active', true);

  if (rolesError) throw rolesError;

  return (roleRows || []).map((row) => ({
    cmmsCompanyId: row.cmms_company_id,
    cmmsRoleId: row.cmms_role_id,
    roleName: row.cmms_roles?.role_name || 'Team Member',
    companyName: row.cmms_company_profiles?.company_name || 'CMMS Company',
    assignedAt: row.assigned_at,
  }));
}

export async function isCmmsMember(userEmail) {
  const memberships = await getCmmsMemberships(userEmail);
  return memberships.length > 0;
}

/**
 * Syncs one 'cmms' experience row per active company/role membership.
 * Matches against existing rows by metadata.cmms_company_id/cmms_role_id in
 * application code (rather than a DB upsert) so re-running never duplicates.
 */
export async function syncCmmsPortfolioItems(userId, userEmail) {
  const memberships = await getCmmsMemberships(userEmail);
  if (memberships.length === 0) return [];

  const { data: existing, error: existingError } = await supabase
    .from('user_portfolio_items')
    .select('id, metadata')
    .eq('user_id', userId)
    .eq('source', 'cmms');

  if (existingError) throw existingError;

  const findExisting = (companyId, roleId) =>
    (existing || []).find(
      (row) => row.metadata?.cmms_company_id === companyId && row.metadata?.cmms_role_id === roleId
    );

  const results = [];
  for (const m of memberships) {
    const match = findExisting(m.cmmsCompanyId, m.cmmsRoleId);
    const payload = {
      user_id: userId,
      source: 'cmms',
      item_type: 'experience',
      title: m.roleName,
      org_name: m.companyName,
      description: `Auto-tracked from CMMS — active ${m.roleName} at ${m.companyName}.`,
      start_date: m.assignedAt ? m.assignedAt.slice(0, 10) : null,
      end_date: null,
      metadata: { cmms_company_id: m.cmmsCompanyId, cmms_role_id: m.cmmsRoleId },
      is_public: true,
    };

    if (match) {
      const { data, error } = await supabase
        .from('user_portfolio_items')
        .update(payload)
        .eq('id', match.id)
        .select()
        .single();
      if (error) throw error;
      results.push(data);
    } else {
      const { data, error } = await supabase.from('user_portfolio_items').insert(payload).select().single();
      if (error) throw error;
      results.push(data);
    }
  }

  return results;
}

// ─── Public (anonymous) lookup by handle ───────────────────────────────────

// ─── Ratings & recommendations ─────────────────────────────────────────────

export async function getRatingSummary(userId) {
  const { data, error } = await supabase
    .from('portfolio_rating_summary')
    .select('avg_rating, ratings_count')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw error;
  return data || { avg_rating: 0, ratings_count: 0 };
}

export async function getRatings(userId) {
  const { data, error } = await supabase
    .from('portfolio_ratings')
    .select('id, rating, recommendation_text, created_at, rater_user_id, rater:rater_user_id(full_name, avatar_url)')
    .eq('ratee_user_id', userId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function getMyRatingFor(raterUserId, rateeUserId) {
  const { data, error } = await supabase
    .from('portfolio_ratings')
    .select('*')
    .eq('rater_user_id', raterUserId)
    .eq('ratee_user_id', rateeUserId)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

export async function rateProfessional(raterUserId, rateeUserId, { rating, recommendationText }) {
  if (raterUserId === rateeUserId) throw new Error("You can't rate your own profile.");

  const { data, error } = await supabase
    .from('portfolio_ratings')
    .upsert(
      {
        rater_user_id: raterUserId,
        ratee_user_id: rateeUserId,
        rating,
        recommendation_text: recommendationText || null,
      },
      { onConflict: 'ratee_user_id,rater_user_id' }
    )
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function deleteMyRating(raterUserId, rateeUserId) {
  const { error } = await supabase
    .from('portfolio_ratings')
    .delete()
    .eq('rater_user_id', raterUserId)
    .eq('ratee_user_id', rateeUserId);

  if (error) throw error;
}

// ─── Document verification ─────────────────────────────────────────────────

export async function uploadVerificationDocument(userId, file, documentType = 'id_document') {
  const path = `${userId}/${Date.now()}_${file.name}`;

  const { error: uploadError } = await supabase.storage
    .from('verification-documents')
    .upload(path, file, { upsert: false });

  if (uploadError) throw uploadError;

  const { data, error } = await supabase
    .from('document_verifications')
    .insert({ user_id: userId, document_url: path, document_type: documentType, status: 'pending' })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getMyVerifications(userId) {
  const { data, error } = await supabase
    .from('document_verifications')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

/** Pending documents this user (as a CMMS firm admin or platform admin) is allowed to review. */
export async function getReviewableVerifications() {
  const { data, error } = await supabase
    .from('document_verifications')
    .select('*, profile:user_id(full_name, email, avatar_url)')
    .eq('status', 'pending')
    .order('created_at', { ascending: true });

  if (error) throw error;
  return data || [];
}

export async function reviewVerification(documentId, approve, notes = null) {
  const { data, error } = await supabase.rpc('verify_user_document', {
    p_document_id: documentId,
    p_approve: approve,
    p_notes: notes,
  });

  if (error) throw error;
  return data;
}

// ─── Professionals directory ───────────────────────────────────────────────

export async function listProfessionals({ search = '', limit = 60 } = {}) {
  let query = supabase
    .from('public_professionals')
    .select('*')
    .order('avg_rating', { ascending: false })
    .limit(limit);

  if (search) {
    query = query.or(`full_name.ilike.%${search}%,headline.ilike.%${search}%`);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function listFeaturedProfessionals(limit = 12) {
  const { data, error } = await supabase
    .from('public_professionals')
    .select('*')
    .order('avg_rating', { ascending: false })
    .order('ratings_count', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data || [];
}

export async function getPublicPortfolio(handle) {
  const normalized = String(handle || '').toLowerCase().trim();
  if (!normalized) return null;

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, full_name, avatar_url, handle, is_verified')
    .eq('handle', normalized)
    .maybeSingle();

  if (profileError) throw profileError;
  if (!profile) return null;

  const [portfolio, items, ratingSummary, ratings, references, statusesResult] = await Promise.all([
    supabase.from('user_portfolios').select('*').eq('user_id', profile.id).eq('is_public', true).maybeSingle().then((r) => r.data),
    supabase
      .from('user_portfolio_items')
      .select('*')
      .eq('user_id', profile.id)
      .eq('is_public', true)
      .order('start_date', { ascending: false, nullsFirst: false })
      .then((r) => r.data),
    getRatingSummary(profile.id),
    getRatings(profile.id),
    supabase
      .from('portfolio_references')
      .select('*')
      .eq('user_id', profile.id)
      .eq('is_public', true)
      .order('display_order', { ascending: true })
      .then((r) => r.data),
    // Scoped to this profile's owner — RLS further restricts what a non-owner
    // viewer (anon or another user) can see to visibility='public' rows only
    // (allow_public_statuses_anon_select.sql / 04_status_sharing_tables.sql),
    // so this can never surface anyone else's updates or the owner's private ones.
    getUserStatuses(profile.id),
  ]);

  return {
    profile,
    portfolio: portfolio || null,
    items: items || [],
    ratingSummary,
    ratings,
    references: references || [],
    statuses: statusesResult?.statuses || [],
  };
}
