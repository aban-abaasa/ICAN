/**
 * useCmmsAccess Hook
 * Lightweight check: does the current user belong to a CMMS company?
 * Used to decide whether to show the home-screen CMMS activity widget.
 * Mirrors the access view CSSModule.jsx already trusts (cmms_users_with_roles);
 * fails silent (no access) on any error so it never disrupts the home screen.
 */

import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase/client';

// Mirrors CMSSModule.jsx's own getCmmsMembershipStorageKey/getStoredActiveCompanyId
// exactly -- that's where a user's actively-selected company (via its company
// switcher) is persisted. Without reading the same key, this hook had no way
// to know which company the user last switched to and always fell back to
// their OLDEST membership instead -- so anyone belonging to more than one
// CMMS company (a second business, an old test company, etc.) saw the home
// screen's activity card show a completely different company's real numbers
// than the one they were actually looking at in CMMS itself.
const getStoredActiveCompanyId = (userEmail) => {
  try {
    const normalizedEmail = String(userEmail || '').trim().toLowerCase();
    const scopedKey = normalizedEmail ? `cmms_active_company::${normalizedEmail}` : 'cmms_company_id';
    return localStorage.getItem(scopedKey) || localStorage.getItem('cmms_company_id');
  } catch {
    return null;
  }
};

// Mirrors CMSSModule.jsx's own persistActiveCompanyId exactly, so switching
// which company's slide the home-screen widget is showing (e.g. tapping
// "Open CMMS" from a second business's slide) opens CMSSModule on that same
// company instead of whichever one happened to be active before.
export const persistActiveCompanyId = (userEmail, companyId) => {
  if (!companyId) return;
  try {
    localStorage.setItem('cmms_company_id', companyId);
    const normalizedEmail = String(userEmail || '').trim().toLowerCase();
    if (normalizedEmail) {
      localStorage.setItem(`cmms_active_company::${normalizedEmail}`, companyId);
    }
  } catch {
    // best-effort persistence only
  }
};

export const useCmmsAccess = () => {
  const { user } = useAuth();
  const [hasCmmsAccess, setHasCmmsAccess] = useState(false);
  const [cmmsCompanyId, setCmmsCompanyId] = useState(null);
  const [cmmsIsAdmin, setCmmsIsAdmin] = useState(false);
  // Every active company this user genuinely belongs to (per cmms_users_with_roles),
  // not just whichever one is "active" in the CMMS switcher -- so the home-screen
  // widget can show each real business's own numbers, not silently drop the rest.
  const [cmmsMemberships, setCmmsMemberships] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      if (!user?.email) {
        setLoading(false);
        return;
      }

      try {
        const { data, error } = await supabase
          .from('cmms_users_with_roles')
          .select('cmms_company_id, effective_role, is_creator, created_at')
          .ilike('email', user.email)
          .eq('is_active', true)
          .order('created_at', { ascending: true });

        if (cancelled) return;

        if (error || !data || data.length === 0) {
          setHasCmmsAccess(false);
          setCmmsCompanyId(null);
          setCmmsIsAdmin(false);
          setCmmsMemberships([]);
          return;
        }

        const storedCompanyId = getStoredActiveCompanyId(user.email);
        const membership = (storedCompanyId && data.find((m) => m.cmms_company_id === storedCompanyId)) || data[0];
        setHasCmmsAccess(true);
        setCmmsCompanyId(membership.cmms_company_id);
        setCmmsIsAdmin(membership.effective_role === 'admin' || membership.is_creator === true);

        // Company names live on cmms_company_profiles, not the roles view --
        // same two-step lookup CMSSModule.jsx already does for its own switcher.
        const companyIds = [...new Set(data.map((m) => m.cmms_company_id).filter(Boolean))];
        let companyNameMap = new Map();
        if (companyIds.length > 0) {
          const { data: profiles } = await supabase
            .from('cmms_company_profiles')
            .select('id, company_name')
            .in('id', companyIds);
          companyNameMap = new Map((profiles || []).map((p) => [p.id, p.company_name]));
        }

        if (cancelled) return;
        setCmmsMemberships(data.map((m) => ({
          companyId: m.cmms_company_id,
          companyName: companyNameMap.get(m.cmms_company_id) || null,
          isAdmin: m.effective_role === 'admin' || m.is_creator === true,
        })));
      } catch (_) {
        if (!cancelled) {
          setHasCmmsAccess(false);
          setCmmsCompanyId(null);
          setCmmsIsAdmin(false);
          setCmmsMemberships([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    check();
    return () => { cancelled = true; };
  }, [user?.email]);

  return { hasCmmsAccess, cmmsCompanyId, cmmsIsAdmin, cmmsMemberships, loading };
};

export default useCmmsAccess;
