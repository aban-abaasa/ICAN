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

export const useCmmsAccess = () => {
  const { user } = useAuth();
  const [hasCmmsAccess, setHasCmmsAccess] = useState(false);
  const [cmmsCompanyId, setCmmsCompanyId] = useState(null);
  const [cmmsIsAdmin, setCmmsIsAdmin] = useState(false);
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
          .order('created_at', { ascending: true })
          .limit(1);

        if (cancelled) return;

        if (error || !data || data.length === 0) {
          setHasCmmsAccess(false);
          setCmmsCompanyId(null);
          setCmmsIsAdmin(false);
          return;
        }

        const membership = data[0];
        setHasCmmsAccess(true);
        setCmmsCompanyId(membership.cmms_company_id);
        setCmmsIsAdmin(membership.effective_role === 'admin' || membership.is_creator === true);
      } catch (_) {
        if (!cancelled) {
          setHasCmmsAccess(false);
          setCmmsCompanyId(null);
          setCmmsIsAdmin(false);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    check();
    return () => { cancelled = true; };
  }, [user?.email]);

  return { hasCmmsAccess, cmmsCompanyId, cmmsIsAdmin, loading };
};

export default useCmmsAccess;
