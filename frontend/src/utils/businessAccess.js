// Who may assign "entry helpers" (people who record transactions on behalf of a
// business). The owner always can; so can co-owners in a management role. Passive
// holders (Investor, Shareholder, Guarantor) can't — what a helper records is
// permanent and moves the share value.
//
// Keep this list in step with fn_can_manage_business_helpers() in
// backend/BUSINESS_TEAM_MEMBERS_CO_OWNER_ACCESS.sql, which is what the database
// enforces; this file only decides whether the app shows the control.

const MANAGER_ROLES = new Set([
  'owner', 'coowner', 'founder', 'cofounder', 'ceo', 'cfo', 'cto', 'partner', 'administrator'
]);

// "Co-Founder", "co founder" and "cofounder" are the same role.
const normaliseRole = (role) => String(role || '').toLowerCase().replace(/[^a-z]/g, '');
const sameEmail = (a, b) => !!a && !!b && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

export const isBusinessOwner = (profile, userId) =>
  !!profile && !!userId && profile.user_id === userId;

export const canAssignBusinessHelpers = (profile, userId, userEmail) => {
  if (!profile) return false;
  if (isBusinessOwner(profile, userId)) return true;
  return (profile.business_co_owners || []).some((co) =>
    ((!!userId && co.user_id === userId) || sameEmail(co.owner_email, userEmail) || sameEmail(co.email, userEmail)) &&
    MANAGER_ROLES.has(normaliseRole(co.role))
  );
};
