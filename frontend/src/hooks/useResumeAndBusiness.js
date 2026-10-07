import { useEffect, useState } from 'react';

/**
 * The signed-in user's personal details (My Resume) and business details
 * (Pitchin business profiles), loaded once so any screen can read them.
 * Each source fails on its own: no resume never hides the business, and vice versa.
 */
export default function useResumeAndBusiness(userId) {
  const [resume, setResume] = useState(null);
  const [resumeLoaded, setResumeLoaded] = useState(false);
  const [businesses, setBusinesses] = useState([]);
  const [businessLoaded, setBusinessLoaded] = useState(false);

  useEffect(() => {
    if (!userId) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const { getMyPortfolio } = await import('../services/portfolioService');
        const { portfolio } = await getMyPortfolio(userId);
        if (!cancelled) setResume(portfolio);
      } catch (err) {
        console.error('Resume load failed:', err);
      } finally {
        if (!cancelled) setResumeLoaded(true);
      }
      try {
        const { getSupabase } = await import('../services/pitchingService');
        const { data, error } = await getSupabase()
          .from('business_profiles')
          .select('id, business_name, business_type, registration_number, tax_id, country, description, website, business_address, founded_year, verification_status')
          .eq('user_id', userId)
          .order('created_at', { ascending: false });
        if (error) throw error;
        if (!cancelled) setBusinesses(data || []);
      } catch (err) {
        console.error('Business profile load failed:', err);
      } finally {
        if (!cancelled) setBusinessLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  return { resume, resumeLoaded, businesses, businessLoaded };
}
